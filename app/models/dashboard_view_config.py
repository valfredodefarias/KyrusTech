from __future__ import annotations

from typing import Optional, Any, TYPE_CHECKING

from sqlalchemy import Column, JSON
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa


class DashboardViewConfig(AuditMixin, SQLModel, table=True):
    __tablename__ = "dashboard_view_configs"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: Optional[int] = Field(default=None, foreign_key="empresas.id", index=True, unique=True)
    scope: str = Field(default="empresa", index=True, max_length=32)
    config_key: str = Field(index=True, unique=True, max_length=120)
    views: Any = Field(default_factory=list, sa_column=Column(JSON, nullable=False))

    empresa: Optional["Empresa"] = Relationship(
        sa_relationship=relationship("Empresa", back_populates="dashboard_view_config")
    )