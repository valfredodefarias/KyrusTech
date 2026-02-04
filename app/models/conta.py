# app/models/conta.py
from typing import Optional, List, TYPE_CHECKING
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
    cor: Optional[str] = Field(default="#808080")
    
    # --- Integração ---
    # Define se essa conta é manual ou automatizada
    tipo_integracao: str = Field(default="MANUAL", index=True) # Opções: MANUAL, ASAAS, ITAU
    
    # Chaves Estrangeiras
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="contas")
    centro_custo: Optional["CentroCusto"] = Relationship()
    lancamentos: List["Lancamento"] = Relationship(back_populates="conta")
    cartoes: List["Cartao"] = Relationship(back_populates="conta")
    
    # Acesso à configuração da integração (se houver)
    integracao: Optional["IntegracaoBancaria"] = Relationship(
        back_populates="conta",
        sa_relationship_kwargs={"uselist": False} # 1-para-1
    )