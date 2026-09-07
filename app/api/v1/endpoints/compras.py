from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlmodel import Session, select, SQLModel
from loguru import logger

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user, require_permission, require_any_permission
from app.services.compras_service import confirmar_e_processar_compra_xml, get_compras_resumo
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia

from pydantic import BaseModel

router = APIRouter()


@router.get(
    "/resumo",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_any_permission(["page:boletim:view", "page:lancamentos:view"]))],
)
def obter_resumo_compras(
    ano: Optional[int] = Query(None, ge=2000, le=2100),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Retorna resumo analítico de compras agregadas por tipo e mês para o ano informado.
    """
    return get_compras_resumo(
        db=db,
        empresa_id=empresa_id,
        ano=ano,
        centro_custo_id=centro_custo_id,
    )


class EquivalenciaCreate(BaseModel):
    fornecedor_id: int
    codigo_produto_fornecedor: str
    produto_interno_id: int


@router.post(
    "/importar-xml",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def importar_xml_compra(
    arquivo: UploadFile = File(...),
    plano_contas_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Importa um arquivo XML de NF-e de compra de forma transacional.
    Associa fornecedores, gera contas a pagar e atualiza o Kardex de estoque/custo médio.
    Retorna sucesso parcial se houver itens que necessitam de mapeamento (De/Para).
    """
    if not arquivo.filename or not arquivo.filename.lower().endswith(".xml"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Por favor, selecione um arquivo XML valido da NF-e."
        )

    try:
        conteudo = arquivo.file.read()
        resultado = confirmar_e_processar_compra_xml(
            db=db,
            empresa_id=empresa_id,
            xml_content=conteudo,
            plano_contas_id=plano_contas_id,
            centro_custo_id=centro_custo_id
        )
        return resultado
    except ValueError as exc:
        logger.warning(
            f"[COMPRAS ENDPOINT] Erro de validacao ao processar XML para empresa {empresa_id}: {str(exc)}"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )
    except Exception as exc:
        logger.error(
            f"[COMPRAS ENDPOINT] Falha inesperada ao processar XML de compras para empresa {empresa_id}: {str(exc)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ocorreu um erro interno ao processar a importacao da NF-e."
        )


@router.post(
    "/equivalencias",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def criar_equivalencia(
    payload: EquivalenciaCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Cria ou atualiza uma equivalencia de produto de fornecedor (De/Para).
    """
    try:
        equivalencia = db.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.empresa_id == empresa_id,
                FornecedorProdutoEquivalencia.fornecedor_id == payload.fornecedor_id,
                FornecedorProdutoEquivalencia.codigo_produto_fornecedor == payload.codigo_produto_fornecedor,
                FornecedorProdutoEquivalencia.is_deleted == False
            )
        ).first()

        if equivalencia:
            equivalencia.produto_interno_id = payload.produto_interno_id
        else:
            equivalencia = FornecedorProdutoEquivalencia(
                empresa_id=empresa_id,
                fornecedor_id=payload.fornecedor_id,
                codigo_produto_fornecedor=payload.codigo_produto_fornecedor,
                produto_interno_id=payload.produto_interno_id
            )
        db.add(equivalencia)
        db.commit()
        db.refresh(equivalencia)
        return {"status": "sucesso", "id": equivalencia.id}
    except Exception as exc:
        db.rollback()
        logger.error(
            f"[COMPRAS ENDPOINT] Erro ao cadastrar equivalencia para empresa {empresa_id}: {str(exc)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ocorreu um erro ao salvar o mapeamento do produto."
        )

