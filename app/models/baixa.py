from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime

from .base_audit import AuditMixin
from .movimento import Movimento

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento


class Baixa(AuditMixin, SQLModel, table=True):
    __tablename__ = "baixas"

    id: Optional[int] = Field(default=None, primary_key=True)
    lancamento_id: int = Field(foreign_key="lancamentos.id", index=True)
    movimento_id: int = Field(foreign_key="movimentos.id", index=True)
    valor_pago: Decimal = Field(max_digits=12, decimal_places=2)
    data_baixa: datetime.date = Field(index=True)
    tipo_baixa: str = Field(default="PRINCIPAL", index=True)  # PRINCIPAL, JUROS, MULTA, DESCONTO

    empresa_id: int = Field(foreign_key="empresas.id", index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", lazy="joined"))
    lancamento: "Lancamento" = Relationship(sa_relationship=relationship("Lancamento", back_populates="baixas", lazy="joined"))
    movimento: "Movimento" = Relationship(
        sa_relationship=relationship("Movimento", back_populates="baixas", lazy="joined")
    )
