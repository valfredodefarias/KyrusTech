# app/schemas/cartao.py
from typing import Optional
from decimal import Decimal
from sqlmodel import SQLModel

class CartaoBase(SQLModel):
    nome_cartao: str
    limite_total: float
    dia_fechamento: int
    dia_vencimento: int
    status: str = "ATIVO"
    id_conta_padrao: Optional[int] = None # Para vincular pagamento automático no futuro

class CartaoCreate(CartaoBase):
    pass

class CartaoRead(CartaoBase):
    id: int
    empresa_id: int

class CartaoUpdate(SQLModel):
    nome_cartao: Optional[str] = None
    limite_total: Optional[float] = None
    dia_fechamento: Optional[int] = None
    dia_vencimento: Optional[int] = None
    status: Optional[str] = None