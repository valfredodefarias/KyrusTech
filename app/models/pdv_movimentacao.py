# app/models/pdv_movimentacao.py
from __future__ import annotations
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime
from sqlalchemy.orm import relationship
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .centro_custo import CentroCusto
    from .conta import Conta
    from .pdv_venda import PdvVenda

class PdvMovimentacao(AuditMixin, SQLModel, table=True):
    __tablename__ = "pdv_movimentacoes"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    tipo: str = Field(index=True)  # ENTRADA, SAIDA
    descricao: str = Field(index=True)
    valor: Decimal = Field(max_digits=12, decimal_places=2)
    forma_pagamento: str = Field(index=True)  # DINHEIRO, PIX, DEBITO, CREDITO_AVISTA, CREDITO_PARCELADO
    bandeira: Optional[str] = "OUTROS"
    parcelas: Optional[int] = 1
    numero_parcela: int = Field(default=1)
    data: datetime.date = Field(index=True)
    
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True, nullable=True)
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id", index=True, nullable=True)
    conciliado: bool = Field(default=False)
    
    venda_id: Optional[str] = Field(default=None, foreign_key="pdv_vendas.id", index=True, nullable=True)
    import_hash: Optional[str] = Field(default=None, index=True)

    # Vínculo Real de Origem do Recebível
    origem_tipo: Optional[str] = Field(default=None, index=True, nullable=True)
    origem_id: Optional[str] = Field(default=None, index=True, nullable=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    centro_custo: "CentroCusto" = Relationship(sa_relationship=relationship("CentroCusto"))
    conta: "Conta" = Relationship(sa_relationship=relationship("Conta"))
    venda: Optional["PdvVenda"] = Relationship(sa_relationship=relationship("PdvVenda"))
