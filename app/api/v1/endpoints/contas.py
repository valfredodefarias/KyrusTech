# app/api/v1/endpoints/contas.py

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
from app.crud import crud_conta
from app.schemas.conta import ContaCreate, ContaRead, ContaUpdate
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[ContaRead])
def read_all_contas(
    *,
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    """
    Lista todas as contas da empresa.
    """
    return crud_conta.get_by_empresa(db=db, empresa_id=empresa_id)

@router.post("/", response_model=ContaRead, status_code=201)
def create_conta(
    *,
    db: Session = Depends(get_db), 
    conta_in: ContaCreate, 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    """
    Cria uma nova conta.
    """
    logger.info(f"Criando conta: {conta_in.nome}")
    # Agora chama .create() corretamente
    return crud_conta.create(db=db, obj_in=conta_in, empresa_id=empresa_id)

@router.patch("/{conta_id}", response_model=ContaRead)
def update_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    conta_in: ContaUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza uma conta.
    """
    # Agora chama .get_by_id() corretamente
    db_obj = crud_conta.get_by_id(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    
    # Agora chama .update() corretamente
    return crud_conta.update(db=db, db_obj=db_obj, obj_in=conta_in)

@router.delete("/{conta_id}")
def delete_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Remove uma conta.
    """
    # Agora chama .delete() corretamente
    db_obj = crud_conta.delete(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    
    return {"ok": True, "detail": "Conta deletada com sucesso"}