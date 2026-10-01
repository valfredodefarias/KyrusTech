# app/models/api_key.py
from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .usuario import Usuario
    from .access_profile import AccessProfile


class ApiKey(AuditMixin, SQLModel, table=True):
    __tablename__ = "api_keys"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True, nullable=False)
    service_user_id: int = Field(foreign_key="usuarios.id", unique=True, index=True, nullable=False)
    name: str = Field(max_length=100, nullable=False)
    description: Optional[str] = Field(default=None, max_length=255, nullable=True)
    key_prefix: str = Field(max_length=16, unique=True, index=True, nullable=False)
    key_hash: str = Field(max_length=64, nullable=False)
    environment: str = Field(default="live", max_length=10, nullable=False)
    profile_id: int = Field(foreign_key="access_profiles.id", index=True, nullable=False)

    expires_at: Optional[datetime] = Field(default=None, nullable=True)
    last_used_at: Optional[datetime] = Field(default=None, nullable=True)
    last_used_ip: Optional[str] = Field(default=None, max_length=64, nullable=True)
    revoked_at: Optional[datetime] = Field(default=None, nullable=True)
    revoked_by_user_id: Optional[int] = Field(default=None, foreign_key="usuarios.id", nullable=True)
    created_by_user_id: int = Field(foreign_key="usuarios.id", nullable=False)
    is_active: bool = Field(default=True, index=True, nullable=False)

    # Relacionamentos com foreign_keys em formato de string seguro para SQLModel
    empresa: Optional["Empresa"] = Relationship(
        sa_relationship=relationship("Empresa")
    )
    service_user: Optional["Usuario"] = Relationship(
        sa_relationship=relationship("Usuario", foreign_keys="[ApiKey.service_user_id]")
    )
    profile: Optional["AccessProfile"] = Relationship(
        sa_relationship=relationship("AccessProfile")
    )
    created_by_user: Optional["Usuario"] = Relationship(
        sa_relationship=relationship("Usuario", foreign_keys="[ApiKey.created_by_user_id]")
    )
    revoked_by_user: Optional["Usuario"] = Relationship(
        sa_relationship=relationship("Usuario", foreign_keys="[ApiKey.revoked_by_user_id]")
    )
