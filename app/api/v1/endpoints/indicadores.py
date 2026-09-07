# app/api/v1/endpoints/indicadores.py
from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user, require_any_permission
from app.services.indicadores_service import get_indicadores_resumo

router = APIRouter()


@router.get(
    "/resumo",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_any_permission(["page:boletim:view", "page:lancamentos:view"]))],
)
def obter_resumo_indicadores(
    ano: Optional[int] = Query(None, ge=2000, le=2100),
    mes: Optional[int] = Query(None, ge=1, le=12),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Retorna resumo analítico de indicadores financeiros agregados por mês e situação.
    """
    return get_indicadores_resumo(
        db=db,
        empresa_id=empresa_id,
        ano=ano,
        mes=mes,
        centro_custo_id=centro_custo_id,
    )
