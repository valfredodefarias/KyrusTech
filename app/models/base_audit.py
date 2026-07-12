from __future__ import annotations

# app/models/base_audit.py
from typing import Optional
from datetime import datetime, timezone
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    """Retorna datetime UTC naive moderno para evitar deprecacoes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuditMixin(SQLModel):
    """
    Mixin para adicionar campos de auditoria e Soft Delete automaticamente
    em qualquer tabela que herdar desta classe.
    """
    created_at: datetime = Field(default_factory=utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=utcnow, sa_column_kwargs={"onupdate": utcnow})
    
    # Rastreabilidade de Usuário
    created_by_id: Optional[int] = Field(default=None, description="ID do usuário que criou")
    updated_by_id: Optional[int] = Field(default=None, description="ID do último usuário que alterou")

    # Soft Delete (Segurança de Dados)
    is_deleted: bool = Field(default=False, index=True, description="Se True, o registro foi excluído logicamente")
    deleted_at: Optional[datetime] = None
    deleted_by_id: Optional[int] = None

    def soft_delete(self, user_id: int):
        """Método helper para realizar a exclusão lógica"""
        self.is_deleted = True
        self.deleted_at = utcnow()
        self.deleted_by_id = user_id