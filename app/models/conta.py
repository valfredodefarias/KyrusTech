# app/models/conta.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal # <--- Essencial para financeiro
import datetime

from .base_audit import AuditMixin # <--- Auditoria

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento
    from .centro_custo import CentroCusto
    from .integracao_bancaria import IntegracaoBancaria
    from .cartao import Cartao

class Conta(AuditMixin, SQLModel, table=True):
    __tablename__ = "contas"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Dados Básicos
    nome: str = Field(index=True) # Ex: "Itaú PJ", "Caixinha"
    tipo: str = Field(index=True) # Ex: "CORRENTE", "POUPANCA", "CAIXA", "INVESTIMENTO"
    banco: Optional[str] = None   # Nome do banco (visual)
    agencia: Optional[str] = None  # Agência bancária
    conta_numero: Optional[str] = None  # Número da conta
    conta_digito: Optional[str] = None  # Dígito verificador da conta
    logo_url: Optional[str] = None  # Logo/foto do banco ou conta
    
    # --- Financeiro Robusto ---
    saldo_inicial: Decimal = Field(default=0.0, max_digits=15, decimal_places=2)
    data_saldo_inicial: Optional[datetime.date] = None
    
    status: str = Field(default='ATIVO', index=True)
    conta_como_disponibilidade: bool = Field(default=True, nullable=False)
    cor: Optional[str] = Field(default="#808080")
    
    # --- Integração ---
    # Define se essa conta é manual ou automatizada
    tipo_integracao: str = Field(default="MANUAL", index=True) # Opções: MANUAL, ASAAS, ITAU
    ofx_bank_id: Optional[str] = Field(default=None, index=True)
    ofx_agencia: Optional[str] = Field(default=None)
    ofx_conta_numero: Optional[str] = Field(default=None)
    
    # Chaves Estrangeiras
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", back_populates="contas"))
    centro_custo: Optional["CentroCusto"] = Relationship(sa_relationship=relationship("CentroCusto"))
    lancamentos: list["Lancamento"] = Relationship(
        sa_relationship=relationship("Lancamento", back_populates="conta")
    )
    cartoes: list["Cartao"] = Relationship(
        sa_relationship=relationship("Cartao", back_populates="conta")
    )
    
    # Acesso à configuração da integração (se houver)
    integracao: Optional["IntegracaoBancaria"] = Relationship(
        sa_relationship=relationship("IntegracaoBancaria", back_populates="conta", uselist=False)
    )