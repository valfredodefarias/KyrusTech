from __future__ import annotations

from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

class AnexoCreate(SQLModel):
    nome_arquivo: str
    url: str
    tipo: str = "OUTROS"
    tamanho_bytes: Optional[int] = None
    content_type: Optional[str] = None
    lancamento_id: int
    empresa_id: int

class AnexoRead(AnexoCreate, AuditReadMixin):
    id: int