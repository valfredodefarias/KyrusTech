from __future__ import annotations

from typing import Optional
from decimal import Decimal
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

# --- BASE ---
class CartaoBase(SQLModel):
    nome_cartao: str
    bandeira: Optional[str] = None
    limite_total: Decimal = Decimal("0.00") # <--- RENOMEADO PARA IGUALAR AO BANCO
    dia_fechamento: int
    dia_vencimento: int
    conta_id: Optional[int] = None
    empresa_id: Optional[int] = None
    centro_custo_id: Optional[int] = None

# --- CREATE ---
class CartaoCreate(CartaoBase):
    pass

# --- UPDATE ---
class CartaoUpdate(SQLModel):
    nome_cartao: Optional[str] = None
    bandeira: Optional[str] = None
    limite_total: Optional[Decimal] = None # <--- RENOMEADO
    dia_fechamento: Optional[int] = None
    dia_vencimento: Optional[int] = None
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None

# --- READ ---
class CartaoRead(CartaoBase, AuditReadMixin):
    id: int


class CartaoResumoRead(CartaoRead):
    gastos_pendentes: Decimal = Decimal("0.00")
    saldo_disponivel: Decimal = Decimal("0.00")