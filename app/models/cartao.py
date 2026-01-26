# app/models/cartao.py
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa
    from .centro_custo import CentroCusto 
    from .conta import Conta

class Cartao(AuditMixin, SQLModel, table=True):
    __tablename__ = "cartoes"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome_cartao: str = Field(index=True)
    
    # Decimal para segurança financeira
    limite_total: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    
    dia_fechamento: int
    dia_vencimento: int
    status: str = Field(default="ATIVO", index=True)
    
    # Conta Bancária Padrão para débito da fatura
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id")
    
    # Vínculo opcional com Centro de Custo
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")
    
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="cartoes")
    centro_custo: Optional["CentroCusto"] = Relationship()
    conta: Optional["Conta"] = Relationship(back_populates="cartoes")
    lancamentos: List["Lancamento"] = Relationship(back_populates="cartao")