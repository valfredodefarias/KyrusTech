# app/api/v1/endpoints/plano_contas.py

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger # <-- Import do logger

from app.db.session import get_db
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasRead, PlanoContasUpdate
from app.crud import crud_plano_contas
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[PlanoContasRead])
def read_plano_contas(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista todas as categorias do plano de contas da empresa."""
    logger.info(f"Listando plano de contas para empresa ID: {empresa_id}")
    return crud_plano_contas.get_by_empresa(db=db, empresa_id=empresa_id)

@router.post("/", response_model=PlanoContasRead, status_code=201)
def create_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_in: PlanoContasCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Cria uma nova categoria no plano de contas."""
    logger.info(f"Empresa {empresa_id} criando categoria: '{conta_in.nome}'")
    conta = crud_plano_contas.create(db=db, obj_in=conta_in, empresa_id=empresa_id)
    logger.success(f"Categoria '{conta.nome}' criada com ID: {conta.id}")
    return conta

@router.patch("/{conta_id}", response_model=PlanoContasRead)
def update_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    conta_in: PlanoContasUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Atualiza uma categoria existente."""
    logger.info(f"Empresa {empresa_id} atualizando categoria ID: {conta_id}")
    db_obj = crud_plano_contas.get(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        logger.warning(f"Categoria ID {conta_id} não encontrada.")
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    
    conta = crud_plano_contas.update(db=db, db_obj=db_obj, obj_in=conta_in)
    logger.success(f"Categoria ID {conta.id} atualizada com sucesso.")
    return conta

@router.delete("/{conta_id}")
def delete_plano_contas(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Remove uma categoria."""
    logger.info(f"Empresa {empresa_id} deletando categoria ID: {conta_id}")
    db_obj = crud_plano_contas.delete(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        logger.warning(f"Categoria ID {conta_id} não encontrada.")
        raise HTTPException(status_code=404, detail="Categoria não encontrada")
    
    logger.success(f"Categoria ID {conta_id} removida com sucesso.")
    return {"ok": True}