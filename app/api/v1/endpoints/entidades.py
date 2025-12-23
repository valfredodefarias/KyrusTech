# app/api/v1/endpoints/entidades.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger # <-- Import do logger

from app.db.session import get_db
from app.schemas.entidade import EntidadeCreate, EntidadeRead, EntidadeUpdate
from app.crud import crud_entidade
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[EntidadeRead])
def read_entidades(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Listando entidades para empresa ID: {empresa_id}")
    return crud_entidade.get_multi(db=db, empresa_id=empresa_id)

@router.post("/", response_model=EntidadeRead, status_code=201)
def create_entidade(
    *,
    db: Session = Depends(get_db),
    obj_in: EntidadeCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} criando entidade: '{obj_in.nome}' ({obj_in.tipo})")
    entidade = crud_entidade.create(db=db, obj_in=obj_in, empresa_id=empresa_id)
    logger.success(f"Entidade '{entidade.nome}' criada com ID: {entidade.id}")
    return entidade

@router.put("/{id}", response_model=EntidadeRead)
def update_entidade(
    *,
    db: Session = Depends(get_db),
    id: int,
    obj_in: EntidadeUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} atualizando entidade ID: {id}")
    entidade = crud_entidade.update(db=db, id=id, obj_in=obj_in, empresa_id=empresa_id)
    if not entidade:
        logger.warning(f"Entidade ID {id} não encontrada para atualização.")
        raise HTTPException(status_code=404, detail="Entidade não encontrada")
    
    logger.success(f"Entidade ID {id} atualizada com sucesso.")
    return entidade

@router.delete("/{id}")
def delete_entidade(
    *,
    db: Session = Depends(get_db),
    id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} deletando entidade ID: {id}")
    entidade = crud_entidade.delete(db=db, id=id, empresa_id=empresa_id)
    if not entidade:
        logger.warning(f"Entidade ID {id} não encontrada para exclusão.")
        raise HTTPException(status_code=404, detail="Entidade não encontrada")
    
    logger.success(f"Entidade ID {id} removida com sucesso.")
    return {"ok": True}