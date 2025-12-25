# app/api/v1/endpoints/contas.py

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func, case
from loguru import logger

from app.db.session import get_db
from app.crud import crud_conta
from app.schemas.conta import ContaCreate, ContaRead, ContaUpdate
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

# Schema para retorno do saldo
from pydantic import BaseModel
class ContaSaldo(ContaRead):
    saldo_atual: float

@router.get("/", response_model=List[ContaSaldo])
def read_all_contas(
    *,
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    """
    Lista contas com SALDO CALCULADO (Inicial + Entradas - Saídas).
    """
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    resultado = []

    for conta in contas:
        # Calcula Receitas Pagas na conta
        receitas = db.exec(
            select(func.sum(Lancamento.valor_pago))
            .where(
                Lancamento.conta_id == conta.id,
                Lancamento.status == 'PAGO',
                Lancamento.tipo == 'RECEITA'
            )
        ).one() or 0

        # Calcula Despesas Pagas na conta
        despesas = db.exec(
            select(func.sum(Lancamento.valor_pago))
            .where(
                Lancamento.conta_id == conta.id,
                Lancamento.status == 'PAGO',
                Lancamento.tipo == 'DESPESA'
            )
        ).one() or 0

        # Saldo Final
        saldo_real = conta.saldo_inicial + float(receitas) - float(despesas)
        
        # Monta objeto de retorno
        conta_dict = conta.model_dump()
        conta_dict['saldo_atual'] = saldo_real
        resultado.append(conta_dict)

    return resultado

@router.post("/", response_model=ContaRead, status_code=201)
def create_conta(
    *,
    db: Session = Depends(get_db), 
    conta_in: ContaCreate, 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    return crud_conta.create(db=db, obj_in=conta_in, empresa_id=empresa_id)

@router.patch("/{conta_id}", response_model=ContaRead)
def update_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    conta_in: ContaUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    db_obj = crud_conta.get_by_id(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return crud_conta.update(db=db, db_obj=db_obj, obj_in=conta_in)

@router.delete("/{conta_id}")
def delete_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    db_obj = crud_conta.delete(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return {"ok": True}