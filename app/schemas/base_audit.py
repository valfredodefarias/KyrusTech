# app/schemas/base_audit.py
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel

class AuditReadMixin(SQLModel):
    """
    Mixin para padronizar a resposta de leitura da API.
    Adiciona ID, datas e quem criou/editou automaticamente.
    """
    id: int
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[int] = None
    updated_by_id: Optional[int] = None
    is_deleted: bool = False