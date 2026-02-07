"""
Endpoints para importacao de arquivos OFX (multibancos).
"""
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlmodel import Session, select
from loguru import logger
from pydantic import BaseModel

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.services.integracao_ofx import processar_ofx
from app.services.integracao_itau import (
    verificar_duplicata,
    buscar_lancamento_previsto_mesmo_dia_valor,
    buscar_lancamento_atrasado_mesmo_valor,
    criar_entidade_se_nao_existir,
    gerar_import_hash,
)
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto

router = APIRouter()


class LancamentoImportado(BaseModel):
    data: str
    data_hora: Optional[str] = None
    descricao: str
    razao_social: str
    cpf_cnpj: str
    referencia: Optional[str] = None
    valor: float
    tipo: str
    origem: str
    linha_arquivo: int
    import_hash: Optional[str] = None
    lancamento_previsto_id: Optional[int] = None
    lancamentos_atrasados_ids: List[int] = []
    duplicata_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    era_previsto: bool = False


class ProcessarArquivoResponse(BaseModel):
    lancamentos: List[LancamentoImportado]
    total_processado: int
    duplicatas_encontradas: int
    lancamentos_previstos_encontrados: int
    lancamentos_atrasados_encontrados: int


@router.post("/ofx/upload", response_model=ProcessarArquivoResponse)
async def upload_ofx(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not arquivo.filename or not arquivo.filename.lower().endswith((".ofx", ".qfx")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser OFX ou QFX"
        )

    try:
        conta, centro_custo_id_resolvido = _resolver_conta_e_centro(db, empresa_id, conta_id, centro_custo_id)
        conteudo = await arquivo.read()
        lancamentos_raw = processar_ofx(conteudo, empresa_id)

        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0

        for lanc_raw in lancamentos_raw:
            lanc_raw["conta_id"] = conta.id
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            lanc_raw["import_hash"] = gerar_import_hash(lanc_raw, conta_id=conta.id)

            duplicata = verificar_duplicata(db, lanc_raw, empresa_id, conta_id=conta.id)
            if duplicata:
                duplicatas += 1
                lanc_raw["duplicata_id"] = duplicata.id
                continue

            lanc_previsto = buscar_lancamento_previsto_mesmo_dia_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lanc_previsto:
                previstos += 1
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True

            lancs_atrasados = buscar_lancamento_atrasado_mesmo_valor(
                db, lanc_raw, empresa_id, centro_custo_id=centro_custo_id_resolvido
            )
            if lancs_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l in lancs_atrasados]

            entidade_id = criar_entidade_se_nao_existir(
                db,
                lanc_raw.get("razao_social", ""),
                lanc_raw.get("cpf_cnpj", ""),
                empresa_id,
            )
            lanc_raw["entidade_id"] = entidade_id

            lancamentos_processados.append(LancamentoImportado(**lanc_raw))

        return ProcessarArquivoResponse(
            lancamentos=lancamentos_processados,
            total_processado=len(lancamentos_raw),
            duplicatas_encontradas=duplicatas,
            lancamentos_previstos_encontrados=previstos,
            lancamentos_atrasados_encontrados=atrasados,
        )

    except Exception as e:
        logger.error(f"Erro ao processar OFX: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


def _resolver_conta_e_centro(
    db: Session,
    empresa_id: int,
    conta_id: Optional[int],
    centro_custo_id: Optional[int],
) -> tuple[Conta, int]:
    if not conta_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecione uma conta para importar."
        )

    conta = db.exec(
        select(Conta).where(
            Conta.id == conta_id,
            Conta.empresa_id == empresa_id,
        )
    ).first()

    if not conta:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")

    centro_custo_resolvido = centro_custo_id or conta.centro_custo_id
    if not centro_custo_resolvido:
        centros = db.exec(
            select(CentroCusto.id).where(CentroCusto.empresa_id == empresa_id)
        ).all()
        if len(centros) == 1:
            centro_custo_resolvido = centros[0]
            conta.centro_custo_id = centro_custo_resolvido
            db.add(conta)
            db.commit()
            db.refresh(conta)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conta precisa estar vinculada a um centro de custo."
            )

    return conta, centro_custo_resolvido
