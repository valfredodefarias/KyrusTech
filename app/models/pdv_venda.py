# app/models/pdv_venda.py
from __future__ import annotations
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime
from sqlalchemy.orm import relationship
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .entidade import Entidade
    from .usuario import Usuario
    from .centro_custo import CentroCusto
    from .pdv_venda_item import PdvVendaItem

class PdvVenda(AuditMixin, SQLModel, table=True):
    __tablename__ = "pdv_vendas"

    id: Optional[str] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    entidade_id: Optional[int] = Field(default=None, foreign_key="entidades.id", index=True, nullable=True)
    vendedor_id: Optional[int] = Field(default=None, foreign_key="usuarios.id", index=True, nullable=True)
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True, nullable=True)

    data_venda: datetime.date = Field(index=True)
    hora_venda: str = Field(default="00:00:00")
    valor_subtotal: Decimal = Field(max_digits=12, decimal_places=2)
    valor_desconto: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_total: Decimal = Field(max_digits=12, decimal_places=2)
    status: str = Field(default="REALIZADO", index=True)  # REALIZADO, CANCELADO, ORCAMENTO
    observacao: Optional[str] = None
    rv: Optional[str] = Field(default=None, index=True)
    is_direct_sale: bool = Field(default=False)
    import_hash: Optional[str] = Field(default=None, index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    cliente: "Entidade" = Relationship(sa_relationship=relationship("Entidade"))
    vendedor: "Usuario" = Relationship(sa_relationship=relationship("Usuario"))
    centro_custo: "CentroCusto" = Relationship(sa_relationship=relationship("CentroCusto"))
    itens: list["PdvVendaItem"] = Relationship(
        sa_relationship=relationship(
            "PdvVendaItem",
            back_populates="venda",
            cascade="all, delete-orphan"
        )
    )
