# app/models/meta_vendedor.py
from __future__ import annotations
from typing import Optional
from sqlmodel import Field, SQLModel
from decimal import Decimal
from .base_audit import AuditMixin

class MetaVendedor(AuditMixin, SQLModel, table=True):
    __tablename__ = "metas_vendedores"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    vendedor_id: int = Field(foreign_key="usuarios.id", index=True)
    mes: int = Field(index=True)
    ano: int = Field(index=True)
    valor_meta: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
