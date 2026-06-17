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
    from .baixa import Baixa


class MovimentoOFX(AuditMixin, SQLModel, table=True):
    __tablename__ = "movimentos_ofx"

    id: Optional[int] = Field(default=None, primary_key=True)
    descricao: str = Field(index=True)
    valor: Decimal = Field(max_digits=12, decimal_places=2)
    tipo: str = Field(index=True)  # RECEITA, DESPESA
    data: datetime.date = Field(index=True)
    import_hash: str = Field(index=True, unique=True)
    status: str = Field(default="ABERTO", index=True)  # ABERTO, CONCILIADO

    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    conta_id: int = Field(foreign_key="contas.id", index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", lazy="joined"))
    conta: "Conta" = Relationship(sa_relationship=relationship("Conta", lazy="joined"))
    baixas: list["Baixa"] = Relationship(
        sa_relationship=relationship(
            "Baixa",
            back_populates="movimento_ofx",
            cascade="all, delete-orphan"
        )
    )

