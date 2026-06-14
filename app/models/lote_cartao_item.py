# app/models/lote_cartao_item.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal

if TYPE_CHECKING:
    from .lote_cartao import LoteCartao
    from .lancamento import Lancamento

class LoteCartaoItem(SQLModel, table=True):
    __tablename__ = "lote_cartao_itens"

    id: Optional[int] = Field(default=None, primary_key=True)
    lote_cartao_id: int = Field(foreign_key="lotes_cartao.id", index=True)
    lancamento_id: int = Field(foreign_key="lancamentos.id", index=True)
    
    valor_bruto: Decimal = Field(max_digits=12, decimal_places=2)
    valor_taxa: Decimal = Field(default=Decimal("0.00"), max_digits=10, decimal_places=2)
    valor_liquido: Decimal = Field(max_digits=12, decimal_places=2)

    # Relacionamentos
    lote_cartao: "LoteCartao" = Relationship(
        sa_relationship=relationship("LoteCartao", back_populates="itens")
    )
    lancamento: "Lancamento" = Relationship(sa_relationship=relationship("Lancamento"))
