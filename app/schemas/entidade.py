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

# --- CREATE (sem empresa_id, o backend extrai do user autenticado) ---
class EntidadeCreate(EntidadeBase):
    pass

# --- UPDATE ---
class EntidadeUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    status: Optional[str] = None

# --- READ ---
class EntidadeRead(EntidadeBase, AuditReadMixin):
    id: int
    empresa_id: int