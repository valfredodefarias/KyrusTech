# app/schemas/mapeamento.py
from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

class MapeamentoBase(SQLModel):
    categoria_externa: str
    plano_contas_id: int
    integracao_id: int

class MapeamentoCreate(MapeamentoBase):
    pass

# --- UPDATE (Adicionado para evitar erro futuro) ---
class MapeamentoUpdate(SQLModel):
    categoria_externa: Optional[str] = None
    plano_contas_id: Optional[int] = None
    integracao_id: Optional[int] = None

class MapeamentoRead(MapeamentoBase, AuditReadMixin):
    id: int