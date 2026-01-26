# app/schemas/conta.py
from typing import Optional
from sqlmodel import SQLModel
import datetime

class ContaBase(SQLModel):
    nome: str
    tipo: str
    banco: Optional[str] = None
    logo_url: Optional[str] = None
    saldo_inicial: float = 0.0
    data_saldo_inicial: Optional[datetime.date] = None
    status: str = 'ATIVO'
    cor: Optional[str] = "#808080"
    
    # --- NOVO CAMPO NO BASE (Serve para Create e Read) ---
    centro_custo_id: Optional[int] = None

class ContaCreate(ContaBase):
    pass

class ContaRead(ContaBase):
    id: int
    empresa_id: int

class ContaUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    banco: Optional[str] = None
    logo_url: Optional[str] = None
    saldo_inicial: Optional[float] = None
    status: Optional[str] = None
    # --- NOVO CAMPO UPDATE ---
    centro_custo_id: Optional[int] = None