from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from .base_audit import AuditMixin


class PlanoContasTemplateConfig(AuditMixin, SQLModel, table=True):
    __tablename__ = "plano_contas_template_configs"

    id: Optional[int] = Field(default=None, primary_key=True)
    tipo_pessoa: str = Field(index=True, unique=True, max_length=2)
    config_key: str = Field(index=True, unique=True, max_length=120)
    items: Any = Field(default_factory=list, sa_column=Column(JSON, nullable=False))