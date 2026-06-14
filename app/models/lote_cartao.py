# app/models/lote_cartao.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .conta import Conta
    from .lancamento import Lancamento
    from .lote_cartao_item import LoteCartaoItem

class LoteCartao(AuditMixin, SQLModel, table=True):
    __tablename__ = "lotes_cartao"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    data_pagamento: datetime.date = Field(index=True)
    valor_bruto: Decimal = Field(max_digits=15, decimal_places=2)
    valor_taxa: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_liquido: Decimal = Field(max_digits=15, decimal_places=2)
    
    conta_destino_id: int = Field(foreign_key="contas.id", index=True)
    lancamento_deposito_id: Optional[int] = Field(default=None, foreign_key="lancamentos.id", index=True, nullable=True)
    status: str = Field(default="CONCILIADO", index=True)  # ex: CONCILIADO, PREVISTO

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    conta_destino: "Conta" = Relationship(sa_relationship=relationship("Conta"))
    lancamento_deposito: Optional["Lancamento"] = Relationship(
        sa_relationship=relationship(
            "Lancamento",
            foreign_keys="[LoteCartao.lancamento_deposito_id]"
        )
    )
    itens: list["LoteCartaoItem"] = Relationship(
        sa_relationship=relationship(
            "LoteCartaoItem",
            back_populates="lote_cartao",
            cascade="all, delete-orphan"
        )
    )
