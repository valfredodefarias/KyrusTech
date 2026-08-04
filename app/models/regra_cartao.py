# app/models/regra_cartao.py
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
    from .plano_contas import PlanoContas
    from .centro_custo import CentroCusto

class RegraCartao(AuditMixin, SQLModel, table=True):
    __tablename__ = "regras_cartao"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    tipo_pagamento: str = Field(index=True)  # ex: cartao_credito_vista, cartao_credito_parcelado, cartao_debito
    bandeira: str = Field(default="OUTROS", index=True)  # ex: VISA, MASTERCARD, ELO, PIX, OUTROS
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True, nullable=True)
    
    data_inicio: Optional[datetime.date] = Field(default=None, index=True)
    
    taxa_porcentagem: Decimal = Field(default=Decimal("0.00"), max_digits=5, decimal_places=2)
    dias_payout: int = Field(default=30)
    
    tipo_prazo: str = Field(default="DIAS_CORRIDOS", index=True)  # DIAS_CORRIDOS, DIAS_UTEIS, DIA_FIXO_MES
    dia_fixo: Optional[int] = Field(default=None)
    fds_proximo_dia_util: bool = Field(default=True)
    modo_parcelamento: str = Field(default="PRO_RATA", index=True)  # PRO_RATA, ANTECIPADO
    taxa_antecipacao: Decimal = Field(default=Decimal("0.00"), max_digits=5, decimal_places=2)
    
    conta_destino_id: Optional[int] = Field(default=None, foreign_key="contas.id", index=True, nullable=True)
    plano_contas_taxa_id: Optional[int] = Field(default=None, foreign_key="plano_contas.id", index=True, nullable=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    centro_custo: Optional["CentroCusto"] = Relationship(sa_relationship=relationship("CentroCusto"))
    conta_destino: Optional["Conta"] = Relationship(sa_relationship=relationship("Conta"))
    plano_contas_taxa: Optional["PlanoContas"] = Relationship(sa_relationship=relationship("PlanoContas"))
