from __future__ import annotations

# app/models/base_audit.py
from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel


class AuditMixin(SQLModel):
    """
    Mixin para adicionar campos de auditoria e Soft Delete automaticamente
    em qualquer tabela que herdar desta classe.
    """
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, sa_column_kwargs={"onupdate": datetime.utcnow})
    
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
        self.deleted_at = datetime.utcnow()
        self.deleted_by_id = user_id