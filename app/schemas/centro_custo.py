# app/schemas/centro_custo.py
from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

# --- BASE (Campos comuns que o Frontend ENVIA) ---
# Removemos empresa_id daqui. O Frontend não precisa enviar isso.
class CentroCustoBase(SQLModel):
    nome: str
    codigo: Optional[str] = None
    status: str = "ATIVO"

# --- CREATE (Validação na criação) ---
class CentroCustoCreate(CentroCustoBase):
    pass

# --- UPDATE (Campos opcionais para edição) ---
class CentroCustoUpdate(SQLModel):
    nome: Optional[str] = None
    codigo: Optional[str] = None
    status: Optional[str] = None

# --- READ (O que o Backend DEVOLVE) ---
# Aqui sim, devolvemos o ID e o Empresa ID para leitura
class CentroCustoRead(CentroCustoBase, AuditReadMixin):
    id: int
    empresa_id: int