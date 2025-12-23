# app/api/v1/endpoints/cartoes.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger # <-- Import do logger

from app.db.session import get_db
from app.schemas.cartao import CartaoCreate, CartaoRead, CartaoUpdate
from app.crud import crud_cartao
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[CartaoRead])
def read_cartoes(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Listando cartões para empresa ID: {empresa_id}")
    return crud_cartao.get_multi(db=db, empresa_id=empresa_id)

@router.post("/", response_model=CartaoRead, status_code=201)
def create_cartao(
    *,
    db: Session = Depends(get_db),
    obj_in: CartaoCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} criando cartão: '{obj_in.nome_cartao}'")
    cartao = crud_cartao.create(db=db, obj_in=obj_in, empresa_id=empresa_id)
    logger.success(f"Cartão '{cartao.nome_cartao}' criado com ID: {cartao.id}")
    return cartao

@router.put("/{id}", response_model=CartaoRead)
def update_cartao(
    *,
    db: Session = Depends(get_db),
    id: int,
    obj_in: CartaoUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} atualizando cartão ID: {id}")
    cartao = crud_cartao.update(db=db, id=id, obj_in=obj_in, empresa_id=empresa_id)
    if not cartao:
        logger.warning(f"Cartão ID {id} não encontrado para atualização.")
        raise HTTPException(status_code=404, detail="Cartão não encontrado")
    logger.success(f"Cartão ID {id} atualizado com sucesso.")
    return cartao

@router.delete("/{id}")
def delete_cartao(
    *,
    db: Session = Depends(get_db),
    id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} deletando cartão ID: {id}")
    cartao = crud_cartao.delete(db=db, id=id, empresa_id=empresa_id)
    if not cartao:
        logger.warning(f"Cartão ID {id} não encontrado para exclusão.")
        raise HTTPException(status_code=404, detail="Cartão não encontrado")
    logger.success(f"Cartão ID {id} removido com sucesso.")
    return {"ok": True}