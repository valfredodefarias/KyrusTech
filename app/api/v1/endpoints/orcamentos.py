from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import get_empresa_id_from_user, require_permission
from app.crud import crud_orcamento
from app.db.session import get_db
from app.schemas.orcamento import (
    OrcamentoCreate,
    OrcamentoBatchRead,
    OrcamentoMatrizNodeRead,
)


router = APIRouter()


@router.post(
    "/batch",
    response_model=List[OrcamentoBatchRead],
    status_code=201,
    dependencies=[Depends(require_permission("page:dre:view"))],
)
def create_orcamentos_batch(
    *,
    db: Session = Depends(get_db),
    items_in: List[OrcamentoCreate],
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    return crud_orcamento.upsert_batch(db=db, items_in=items_in, empresa_id=empresa_id)


@router.get(
    "/matriz/{ano}",
    response_model=List[OrcamentoMatrizNodeRead],
    dependencies=[Depends(require_permission("page:dre:view"))],
)
def read_orcamentos_matriz(
    *,
    db: Session = Depends(get_db),
    ano: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    return crud_orcamento.get_matriz(db=db, ano=ano, empresa_id=empresa_id)