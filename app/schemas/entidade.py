# app/schemas/entidade.py
from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

# --- BASE ---
class EntidadeBase(SQLModel):
    nome: str
    tipo: str = "AMBOS" # CLIENTE, FORNECEDOR, AMBOS
    cpf_cnpj: Optional[str] = None
    status: str = "ATIVO"
    empresa_id: int

# --- CREATE ---
class EntidadeCreate(EntidadeBase):
    pass

# --- UPDATE (A classe que estava faltando) ---
class EntidadeUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    status: Optional[str] = None
    # empresa_id geralmente não se altera na edição, por isso não coloquei

# --- READ ---
class EntidadeRead(EntidadeBase, AuditReadMixin):
    id: int