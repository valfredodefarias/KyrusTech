"""
Endpoints para importacao de arquivos OFX (multibancos).
"""
from datetime import date, datetime
from difflib import SequenceMatcher
from decimal import Decimal
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlmodel import Session, select
from loguru import logger
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.services.integracao_ofx import processar_ofx
from app.services.integracao_itau import (
    verificar_duplicata,
    verificar_duplicata_ofx_por_fallback,
    buscar_lancamento_previsto_mesmo_dia_valor,
    buscar_lancamento_atrasado_mesmo_valor,
    criar_entidade_se_nao_existir,
    gerar_import_hash,
)
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto

router = APIRouter()
OFX_FILE_SIZE_LIMIT = 10 * 1024 * 1024
MATCH_TOLERANCIA_VALOR = Decimal("1.00")
MATCH_DIAS_ATRASO = 30
STATUS_ABERTOS = ("PENDENTE", "EM ABERTO")


class RelacionamentoResumo(BaseModel):
    descricao: str
    data_vencimento: str
    valor_previsto: float
    score: int
    motivo: str


class DuplicataResumo(BaseModel):
    descricao: str
    data_pagamento: Optional[str] = None
    valor_pago: Optional[float] = None
    origem: Optional[str] = None
    motivo: Optional[str] = None


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
    referencia_externa: Optional[str] = None
    movimento_uid: Optional[str] = None
    ofx_bank_id: Optional[str] = None
    ofx_agencia: Optional[str] = None
    ofx_conta_numero: Optional[str] = None
    lancamento_previsto_id: Optional[int] = None
    lancamentos_atrasados_ids: List[int] = Field(default_factory=list)
    duplicata_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    era_previsto: bool = False
    sugestao_acao: str = "CRIAR_NOVO"
    score_conciliacao: int = 0
    motivo_conciliacao: Optional[str] = None
    lancamento_previsto_resumo: Optional[RelacionamentoResumo] = None
    lancamentos_atrasados_resumo: List[RelacionamentoResumo] = Field(default_factory=list)
    duplicata_resumo: Optional[DuplicataResumo] = None


def _serializar_lancamento(lanc_raw: Dict) -> Dict:
    payload = dict(lanc_raw)
    data_val = payload.get("data")
    if isinstance(data_val, date):
        payload["data"] = data_val.isoformat()
    data_hora_val = payload.get("data_hora")
    if isinstance(data_hora_val, datetime):
        payload["data_hora"] = data_hora_val.isoformat()
    return payload


def _normalizar_texto(texto: Optional[str]) -> str:
    if not texto:
        return ""
    return " ".join(str(texto).lower().split())


def _calcular_similaridade_texto(origem: Dict, lancamento: Lancamento) -> float:
    descricao_ofx = _normalizar_texto(origem.get("descricao"))
    descricao_sistema = _normalizar_texto(lancamento.descricao)
    entidade_ofx = _normalizar_texto(origem.get("razao_social"))
    referencia_ofx = _normalizar_texto(origem.get("referencia"))
    base = " ".join(part for part in [descricao_ofx, entidade_ofx, referencia_ofx] if part).strip()
    alvo = " ".join(part for part in [descricao_sistema, _normalizar_texto(lancamento.observacao)] if part).strip()
    if not base or not alvo:
        return 0.0
    return SequenceMatcher(None, base, alvo).ratio()


def _build_match_reason(data_diferenca: int, valor_diferenca: Decimal, similaridade: float, kind: str) -> str:
    partes = []
    if kind == "previsto":
        partes.append("vence no mesmo dia")
    else:
        dias = abs(data_diferenca)
        partes.append(f"atrasado ha {dias} dia{'s' if dias != 1 else ''}")
    partes.append(f"diferenca de valor de R$ {float(valor_diferenca):.2f}")
    if similaridade >= 0.72:
        partes.append("descricao muito parecida")
    elif similaridade >= 0.48:
        partes.append("descricao com boa semelhanca")
    return ", ".join(partes)


def _score_candidate(origem: Dict, lancamento: Lancamento, kind: str) -> tuple[int, str]:
    valor = Decimal(str(origem["valor"]))
    valor_previsto = Decimal(str(lancamento.valor_previsto))
    valor_diferenca = abs(valor_previsto - valor)
    data_diferenca = (origem["data"] - lancamento.data_vencimento).days
    similaridade = _calcular_similaridade_texto(origem, lancamento)

    score = 55 if kind == "previsto" else 28
    score += max(0, 22 - int(valor_diferenca * 18))
    score += min(18, int(similaridade * 18))
    if kind == "previsto":
        score += 8
    else:
        score += max(0, 12 - abs(data_diferenca))

    return score, _build_match_reason(data_diferenca, valor_diferenca, similaridade, kind)


def _build_resumo(lancamento: Lancamento, score: int, motivo: str) -> RelacionamentoResumo:
    return RelacionamentoResumo(
        descricao=lancamento.descricao,
        data_vencimento=lancamento.data_vencimento.isoformat(),
        valor_previsto=float(lancamento.valor_previsto),
        score=score,
        motivo=motivo,
    )


def _buscar_melhores_relacionamentos(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int],
) -> tuple[Optional[tuple[Lancamento, int, str]], List[tuple[Lancamento, int, str]]]:
    previsto = buscar_lancamento_previsto_mesmo_dia_valor(
        db,
        lancamento_ofx,
        empresa_id,
        centro_custo_id=centro_custo_id,
        tolerancia_valor=MATCH_TOLERANCIA_VALOR,
    )

    melhor_previsto = None
    if previsto:
        score, motivo = _score_candidate(lancamento_ofx, previsto, "previsto")
        melhor_previsto = (previsto, score, motivo)

    atrasados = buscar_lancamento_atrasado_mesmo_valor(
        db,
        lancamento_ofx,
        empresa_id,
        centro_custo_id=centro_custo_id,
        dias_tolerancia=MATCH_DIAS_ATRASO,
        tolerancia_valor=MATCH_TOLERANCIA_VALOR,
    )
    ranked_atrasados = [
        (candidato, *_score_candidate(lancamento_ofx, candidato, "atrasado"))
        for candidato in atrasados
    ]
    ranked_atrasados.sort(key=lambda item: item[1], reverse=True)
    return melhor_previsto, ranked_atrasados[:3]


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

    if arquivo.size and arquivo.size > OFX_FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo OFX excede o limite de 10 MB.",
        )

    try:
        conta, centro_custo_id_resolvido = _resolver_conta_e_centro(db, empresa_id, conta_id, centro_custo_id)
        conteudo = await arquivo.read()
        if len(conteudo) > OFX_FILE_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo OFX excede o limite de 10 MB.",
            )
        lancamentos_raw = processar_ofx(conteudo, empresa_id)

        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0
        hashes_vistos: set[str] = set()

        for lanc_raw in lancamentos_raw:
            lanc_raw["conta_id"] = conta.id
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            referencia_movimento = str(lanc_raw.get("referencia") or "").strip()
            lanc_raw["movimento_uid"] = referencia_movimento or f"fallback:{conta.id}:{lanc_raw['linha_arquivo']}"
            lanc_raw["referencia_externa"] = f"{conta.id}:{lanc_raw['movimento_uid']}"
            lanc_raw["referencia"] = lanc_raw["referencia_externa"]
            lanc_raw["import_hash"] = gerar_import_hash(lanc_raw, conta_id=conta.id)

            if lanc_raw["import_hash"] in hashes_vistos:
                duplicatas += 1
                lanc_raw["sugestao_acao"] = "IGNORAR_DUPLICATA"
                lanc_raw["motivo_conciliacao"] = "Movimento repetido dentro do mesmo arquivo OFX."
                lanc_raw["duplicata_resumo"] = DuplicataResumo(
                    descricao=lanc_raw["descricao"],
                    data_pagamento=lanc_raw.get("data_pagamento"),
                    valor_pago=float(lanc_raw["valor"]),
                    origem="OFX_EXTRATO",
                    motivo="Movimento repetido no arquivo",
                )
                continue
            hashes_vistos.add(lanc_raw["import_hash"])

            duplicata = verificar_duplicata(db, lanc_raw, empresa_id, conta_id=conta.id)
            if not duplicata:
                duplicata = verificar_duplicata_ofx_por_fallback(db, lanc_raw, empresa_id, conta_id=conta.id)
            if duplicata:
                duplicatas += 1
                lanc_raw["duplicata_id"] = duplicata.id
                lanc_raw["sugestao_acao"] = "IGNORAR_DUPLICATA"
                lanc_raw["motivo_conciliacao"] = "Movimento ja importado anteriormente para esta conta."
                lanc_raw["duplicata_resumo"] = DuplicataResumo(
                    descricao=duplicata.descricao,
                    data_pagamento=duplicata.data_pagamento.isoformat() if duplicata.data_pagamento else None,
                    valor_pago=float(duplicata.valor_pago) if duplicata.valor_pago is not None else None,
                    origem=duplicata.origem,
                    motivo="Mesmo banco selecionado e mesmo identificador de movimentacao",
                )
                continue

            melhor_previsto, melhores_atrasados = _buscar_melhores_relacionamentos(
                db,
                lanc_raw,
                empresa_id,
                centro_custo_id_resolvido,
            )
            if melhor_previsto:
                previstos += 1
                lanc_previsto, score_previsto, motivo_previsto = melhor_previsto
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True
                lanc_raw["sugestao_acao"] = "BAIXAR_PREVISTO"
                lanc_raw["score_conciliacao"] = score_previsto
                lanc_raw["motivo_conciliacao"] = motivo_previsto
                lanc_raw["lancamento_previsto_resumo"] = _build_resumo(lanc_previsto, score_previsto, motivo_previsto)

            if melhores_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l, _, _ in melhores_atrasados]
                lanc_raw["lancamentos_atrasados_resumo"] = [
                    _build_resumo(lancamento, score, motivo)
                    for lancamento, score, motivo in melhores_atrasados
                ]
                if not melhor_previsto:
                    lanc_raw["sugestao_acao"] = "RELACIONAR_ATRASADOS"
                    lanc_raw["score_conciliacao"] = melhores_atrasados[0][1]
                    lanc_raw["motivo_conciliacao"] = melhores_atrasados[0][2]

            entidade_id = criar_entidade_se_nao_existir(
                db,
                lanc_raw.get("razao_social", ""),
                lanc_raw.get("cpf_cnpj", ""),
                empresa_id,
            )
            lanc_raw["entidade_id"] = entidade_id

            if not melhor_previsto and not melhores_atrasados:
                lanc_raw["sugestao_acao"] = "CRIAR_NOVO"
                lanc_raw["motivo_conciliacao"] = "Nenhum previsto ou atraso compativel foi encontrado com o mesmo tipo e tolerancia de R$ 1,00."

            lancamentos_processados.append(LancamentoImportado(**_serializar_lancamento(lanc_raw)))

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

    if centro_custo_resolvido is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nao foi possivel resolver o centro de custo da conta selecionada.",
        )

    return conta, centro_custo_resolvido
