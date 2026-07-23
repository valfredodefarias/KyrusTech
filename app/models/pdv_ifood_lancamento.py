# app/models/pdv_ifood_lancamento.py

from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento

class PdvIfoodLancamento(AuditMixin, SQLModel, table=True):
    __tablename__ = "pdv_ifood_lancamentos"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    forma_recebimento: str = Field(index=True)  # ex: credito_vista, debito_ifood
    valor_bruto: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_liquido: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    
    data_venda: date = Field(index=True)
    hora_venda: str = Field(default="00:00:00")
    data_recebimento_ajustada: date = Field(index=True)
    
    # Armazena despesas extras como lista serializada (ex: "cupom_descontos,entrega_gratis")
    despesas_extras_str: Optional[str] = Field(default=None)
    status_conciliado: bool = Field(default=False)
    
    lancamento_consolidado_id: Optional[int] = Field(default=None, foreign_key="lancamentos.id", index=True, nullable=True)

    empresa: Optional["Empresa"] = Relationship(sa_relationship=relationship("Empresa"))
    lancamento_consolidado: Optional["Lancamento"] = Relationship(sa_relationship=relationship("Lancamento"))
