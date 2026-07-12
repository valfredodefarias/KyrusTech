# app/models/pdv_venda_item.py
from __future__ import annotations
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
from sqlalchemy.orm import relationship

if TYPE_CHECKING:
    from .pdv_venda import PdvVenda
    from .produto import Produto

class PdvVendaItem(SQLModel, table=True):
    __tablename__ = "pdv_venda_itens"

    id: Optional[int] = Field(default=None, primary_key=True)
    venda_id: str = Field(foreign_key="pdv_vendas.id", index=True)
    produto_id: int = Field(foreign_key="produtos.id", index=True)
    
    quantidade: Decimal = Field(max_digits=10, decimal_places=2)
    preco_unitario: Decimal = Field(max_digits=12, decimal_places=2)
    desconto: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    subtotal: Decimal = Field(max_digits=12, decimal_places=2)
    nome_customizado: Optional[str] = None

    # Relacionamentos
    venda: "PdvVenda" = Relationship(
        sa_relationship=relationship("PdvVenda", back_populates="itens")
    )
    produto: "Produto" = Relationship(sa_relationship=relationship("Produto"))
