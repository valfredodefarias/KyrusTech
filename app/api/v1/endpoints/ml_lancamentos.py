from datetime import date
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user, require_permission
from app.services.ml_lancamentos_service import MLLancamentosService

router = APIRouter()


class PrevisaoLancamentoRequest(BaseModel):
    descricao: str = Field(..., description="Descrição do lançamento ou transação bancária")
    valor: float = Field(0.0, description="Valor da transação")
    tipo: str = Field("DESPESA", description="Tipo (RECEITA ou DESPESA)")
    data: Optional[date] = Field(None, description="Data da transação")
    interessado: Optional[str] = Field(None, description="Nome do favorecido/pagador ou contraparte")
    conta_id: Optional[int] = Field(None, description="ID da conta bancária")


class PrevisaoLancamentoResponse(BaseModel):
    plano_contas_id: Optional[int] = None
    plano_contas_nome: Optional[str] = None
    score_plano: float = 0.0

    centro_custo_id: Optional[int] = None
    centro_custo_nome: Optional[str] = None
    score_centro: float = 0.0

    entidade_id: Optional[int] = None
    entidade_nome: Optional[str] = None
    score_entidade: float = 0.0

    confianca_geral: float = 0.0
    features_relevantes: List[str] = []
    explicacao: str = ""


@router.post(
    "/prever-classificacao",
    response_model=PrevisaoLancamentoResponse,
    dependencies=[Depends(require_permission("lancamentos:read"))],
)
def prever_classificacao(
    request: PrevisaoLancamentoRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Realiza predição via Machine Learning para sugerir categoria, centro de custo e interessado.
    """
    previsao = MLLancamentosService.prever(
        db=db,
        empresa_id=empresa_id,
        descricao=request.descricao,
        valor=request.valor,
        tipo=request.tipo,
        data=request.data,
        interessado=request.interessado,
        conta_id=request.conta_id,
    )
    return PrevisaoLancamentoResponse(
        plano_contas_id=previsao.plano_contas_id,
        plano_contas_nome=previsao.plano_contas_nome,
        score_plano=previsao.score_plano,
        centro_custo_id=previsao.centro_custo_id,
        centro_custo_nome=previsao.centro_custo_nome,
        score_centro=previsao.score_centro,
        entidade_id=previsao.entidade_id,
        entidade_nome=previsao.entidade_nome,
        score_entidade=previsao.score_entidade,
        confianca_geral=previsao.confianca_geral,
        features_relevantes=previsao.features_relevantes,
        explicacao=previsao.explicacao,
    )


@router.post(
    "/retreinar",
    dependencies=[Depends(require_permission("lancamentos:create"))],
)
def retreinar_modelo(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Força o retreinamento do motor de Machine Learning com todos os lançamentos recentes da empresa.
    """
    MLLancamentosService.invalidar_cache(empresa_id)
    modelo = MLLancamentosService.obter_ou_treinar_modelo(db, empresa_id, forcar_retreino=True)
    return {
        "sucesso": True,
        "empresa_id": empresa_id,
        "total_amostras": modelo.total_amostras,
        "mensagem": f"Modelo preditivo retreinado com sucesso ({modelo.total_amostras} amostras aprendidas).",
    }
