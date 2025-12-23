# app/api/v1/endpoints/centro_custo.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException # Adicionado HTTPException
from sqlmodel import Session
from loguru import logger # <-- Import do logger

from app.db.session import get_db
from app.schemas.centro_custo import CentroCustoCreate, CentroCustoRead
from app.crud import crud_centro_custo
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[CentroCustoRead])
def read_centros_custo(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista todos os centros de custo da empresa."""
    logger.info(f"Listando centros de custo para empresa ID: {empresa_id}")
    return crud_centro_custo.get_multi(db=db, empresa_id=empresa_id)

@router.post("/", response_model=CentroCustoRead, status_code=201)
def create_centro_custo(
    *,
    db: Session = Depends(get_db),
    obj_in: CentroCustoCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cria um novo centro de custo."""
    logger.info(f"Empresa {empresa_id} criando centro de custo: '{obj_in.nome}'")
    cc = crud_centro_custo.create(db=db, obj_in=obj_in, empresa_id=empresa_id)
    logger.success(f"Centro de Custo '{cc.nome}' criado com ID: {cc.id}")
    return cc