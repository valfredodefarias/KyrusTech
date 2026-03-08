from typing import Optional, Any, TYPE_CHECKING

from sqlalchemy import Column, JSON
from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa


class DashboardViewConfig(AuditMixin, SQLModel, table=True):
    __tablename__ = "dashboard_view_configs"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True, unique=True)
    views: Any = Field(default_factory=list, sa_column=Column(JSON, nullable=False))

    empresa: Optional["Empresa"] = Relationship(back_populates="dashboard_view_config")