# app/api/v1/endpoints/centro_custo.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
# Adicionei o CentroCustoUpdate na importação abaixo
from app.schemas.centro_custo import CentroCustoCreate, CentroCustoRead, CentroCustoUpdate
from app.crud import crud_centro_custo
from app.api.v1.deps import get_empresa_id_from_user, require_permission

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

@router.post(
    "/",
    response_model=CentroCustoRead,
    status_code=201,
    dependencies=[Depends(require_permission("centro_custo:create"))],
)
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

@router.put(
    "/{id}",
    response_model=CentroCustoRead,
    dependencies=[Depends(require_permission("centro_custo:update"))],
)
def update_centro_custo(
    *,
    db: Session = Depends(get_db),
    id: int,
    obj_in: CentroCustoUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza um centro de custo existente."""
    logger.info(f"Empresa {empresa_id} atualizando centro de custo ID: {id}")
    
    cc = crud_centro_custo.update(db=db, id=id, obj_in=obj_in, empresa_id=empresa_id)
    
    if not cc:
        logger.warning(f"Centro de custo ID {id} não encontrado para atualização.")
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado")
    
    logger.success(f"Centro de custo ID {id} atualizado com sucesso.")
    return cc

@router.delete(
    "/{id}",
    dependencies=[Depends(require_permission("centro_custo:delete"))],
)
def delete_centro_custo(
    *,
    db: Session = Depends(get_db),
    id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Remove um centro de custo."""
    logger.info(f"Empresa {empresa_id} deletando centro de custo ID: {id}")
    
    cc = crud_centro_custo.delete(db=db, id=id, empresa_id=empresa_id)
    
    if not cc:
        logger.warning(f"Centro de custo ID {id} não encontrado para exclusão.")
        raise HTTPException(status_code=404, detail="Centro de custo não encontrado")
    
    logger.success(f"Centro de custo ID {id} removido com sucesso.")
    return {"ok": True}