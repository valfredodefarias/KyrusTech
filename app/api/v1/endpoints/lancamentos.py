# app/api/v1/endpoints/lancamentos.py

from typing import List
import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger # <-- Import do Logger

from app.db.session import get_db
# Importamos TODOS os schemas necessários
from app.schemas.lancamento import (
    LancamentoCreate, 
    LancamentoRead, 
    LancamentoUpdate, 
    BulkActionSchema, 
    TransferenciaCreate
)
from app.crud import crud_lancamento
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.get("/", response_model=List[LancamentoRead])
def read_lancamentos(
    *,
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 2000,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Lista os lançamentos da empresa.
    """
    return crud_lancamento.get_by_empresa(db=db, empresa_id=empresa_id, skip=skip, limit=limit)

@router.post("/", response_model=LancamentoRead)
def create_lancamento(
    *,
    db: Session = Depends(get_db),
    lancamento_in: LancamentoCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Cria um único lançamento.
    """
    return crud_lancamento.create_lancamento(db=db, obj_in=lancamento_in, empresa_id=empresa_id)

@router.put("/{lancamento_id}", response_model=LancamentoRead)
def update_lancamento(
    *,
    db: Session = Depends(get_db),
    lancamento_id: int,
    lancamento_in: LancamentoUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Atualiza um lançamento existente.
    """
    lancamento = crud_lancamento.update_lancamento(db=db, id=lancamento_id, obj_in=lancamento_in, empresa_id=empresa_id)
    if not lancamento:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado")
    return lancamento

# --- ENDPOINTS DE AÇÃO EM MASSA (BULK) ---

@router.post("/bulk", response_model=List[LancamentoRead], status_code=201)
def create_lancamentos_bulk(
    *,
    db: Session = Depends(get_db),
    lista_in: List[LancamentoCreate],
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Cria múltiplos lançamentos de uma vez.
    """
    return crud_lancamento.create_multi(db=db, list_obj_in=lista_in, empresa_id=empresa_id)

@router.post("/bulk-delete")
def delete_bulk(
    *,
    db: Session = Depends(get_db),
    payload: BulkActionSchema,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Deleta múltiplos lançamentos de uma vez.
    """
    return crud_lancamento.delete_multi(db=db, ids=payload.ids, empresa_id=empresa_id)

@router.post("/bulk-pay")
def pay_bulk(
    *,
    db: Session = Depends(get_db),
    payload: BulkActionSchema,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Baixa (paga) múltiplos lançamentos de uma vez."""
    # ... (lógica de data igual estava) ...
    if payload.data_pagamento:
        data_final = str(payload.data_pagamento)
    else:
        data_final = datetime.date.today().isoformat()
    
    return crud_lancamento.pay_multi(
        db=db, 
        ids=payload.ids, 
        data_pagamento=data_final, 
        empresa_id=empresa_id,
        conta_id=payload.conta_id # <--- PASSA O NOVO PARAMETRO
    )

@router.post("/transferir")
def transferir_valores(
    *,
    db: Session = Depends(get_db),
    transf_in: TransferenciaCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Realiza transferência de valores entre contas bancárias.
    """
    logger.info(f"Empresa {empresa_id} transferindo R$ {transf_in.valor} de Conta {transf_in.conta_origem_id} para {transf_in.conta_destino_id}")
    
    res = crud_lancamento.realizar_transferencia(db=db, transf_in=transf_in, empresa_id=empresa_id)
    
    logger.success(f"Transferência realizada com sucesso. IDs gerados: {res}")
    return res