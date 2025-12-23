# app/models/lancamento.py

from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime

if TYPE_CHECKING:
    from .empresa import Empresa
    from .plano_contas import PlanoContas
    from .conta import Conta
    from .entidade import Entidade
    from .cartao import Cartao
    from .centro_custo import CentroCusto

class Lancamento(SQLModel, table=True):
    __tablename__ = "lancamentos"

    id: Optional[int] = Field(default=None, primary_key=True)
    descricao: str = Field(index=True)
    tipo: str = Field(index=True)
    status: str = Field(default="PENDENTE", index=True)
    origem: str = Field(default="WEB", index=True) # WEB, RECORRENCIA, TRANSFERENCIA
    
    valor_previsto: Decimal = Field(max_digits=12, decimal_places=2)
    valor_pago: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    valor_juros: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    valor_desconto: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    valor_multa: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)

    data_vencimento: datetime.date = Field(index=True)
    data_pagamento: Optional[datetime.date] = None
    data_competencia: datetime.date = Field(index=True)
    
    numero_parcela: Optional[str] = None
    id_parcelamento: Optional[str] = None
    
    observacao: Optional[str] = None
    anexo_url: Optional[str] = None
    conciliado: bool = Field(default=False)

    # Chaves Estrangeiras
    empresa_id: int = Field(foreign_key="empresas.id")
    plano_contas_id: int = Field(foreign_key="plano_contas.id")
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id")
    entidade_id: Optional[int] = Field(default=None, foreign_key="entidades.id")
    cartao_id: Optional[int] = Field(default=None, foreign_key="cartoes.id")
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")

    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="lancamentos")
    plano_contas: "PlanoContas" = Relationship() # Não precisa de back_populates aqui
    conta: Optional["Conta"] = Relationship(back_populates="lancamentos")
    entidade: Optional["Entidade"] = Relationship(back_populates="lancamentos")
    cartao: Optional["Cartao"] = Relationship(back_populates="lancamentos")
    centro_custo: Optional["CentroCusto"] = Relationship(back_populates="lancamentos")