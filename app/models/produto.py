from __future__ import annotations

# app/models/produto.py
from typing import Optional
from sqlmodel import Field, SQLModel
from decimal import Decimal
from .base_audit import AuditMixin

class Produto(AuditMixin, SQLModel, table=True):
    __tablename__ = "produtos"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    preco_unitario: Decimal = Field(max_digits=12, decimal_places=2)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    is_active: bool = Field(default=True, index=True)
    tipo: str = Field(default="PRODUTO", index=True)

