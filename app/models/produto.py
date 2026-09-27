from __future__ import annotations

# app/models/produto.py
from typing import Optional
from sqlmodel import Field, SQLModel
from decimal import Decimal
from .base_audit import AuditMixin

from sqlalchemy import UniqueConstraint

class Produto(AuditMixin, SQLModel, table=True):
    __tablename__ = "produtos"
    __table_args__ = (
        UniqueConstraint("empresa_id", "codigo_barras", name="uq_produtos_empresa_codigo_barras"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    preco_unitario: Decimal = Field(max_digits=12, decimal_places=2)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    is_active: bool = Field(default=True, index=True)
    tipo: str = Field(default="PRODUTO", index=True)

    # Novos campos para Compras e Gestão de Estoque
    codigo_barras: Optional[str] = Field(default=None, index=True)
    imagem_url: Optional[str] = Field(default=None)
    preco_custo_medio: Optional[float] = Field(default=0.0)
    ncm: Optional[str] = Field(default=None)
    cest: Optional[str] = Field(default=None)
    cfop_padrao: Optional[str] = Field(default=None)
    revisao_pendente: bool = Field(default=False, index=True)



