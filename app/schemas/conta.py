# app/schemas/conta.py
from __future__ import annotations

from typing import Optional
from sqlmodel import SQLModel
import datetime

class ContaBase(SQLModel):
    nome: str
    tipo: str
    banco: Optional[str] = None
    agencia: Optional[str] = None
    conta_numero: Optional[str] = None
    conta_digito: Optional[str] = None
    logo_url: Optional[str] = None
    saldo_inicial: float = 0.0
    data_saldo_inicial: Optional[datetime.date] = None
    status: str = 'ATIVO'
    conta_como_disponibilidade: bool = True
    cor: Optional[str] = "#808080"
    tipo_integracao: Optional[str] = "MANUAL"
    
    # --- NOVO CAMPO NO BASE (Serve para Create e Read) ---
    centro_custo_id: Optional[int] = None

class ContaCreate(ContaBase):
    allowed_user_ids: Optional[list[int]] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "nome": "Banco Itaú - Conta Operacional",
                "tipo": "CORRENTE",
                "banco": "ITAÚ",
                "agencia": "0123",
                "conta_numero": "45678",
                "conta_digito": "9",
                "saldo_inicial": 10000.00,
                "status": "ATIVO",
                "conta_como_disponibilidade": True,
            }
        }
    }


class ContaRead(ContaBase):
    id: int
    empresa_id: int
    allowed_user_ids: Optional[list[int]] = None

class ContaUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    banco: Optional[str] = None
    agencia: Optional[str] = None
    conta_numero: Optional[str] = None
    conta_digito: Optional[str] = None
    logo_url: Optional[str] = None
    saldo_inicial: Optional[float] = None
    status: Optional[str] = None
    conta_como_disponibilidade: Optional[bool] = None
    tipo_integracao: Optional[str] = None
    # --- NOVO CAMPO UPDATE ---
    centro_custo_id: Optional[int] = None
    allowed_user_ids: Optional[list[int]] = None