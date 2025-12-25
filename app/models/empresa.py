from typing import List, Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
import datetime

if TYPE_CHECKING:
    from .usuario import Usuario
    from .plano_contas import PlanoContas
    from .conta import Conta
    from .entidade import Entidade
    from .cartao import Cartao
    from .centro_custo import CentroCusto
    from .lancamento import Lancamento

class Empresa(SQLModel, table=True):
    __tablename__ = "empresas"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome_fantasia: str = Field(index=True)
    razao_social: Optional[str] = None
    cnpj: Optional[str] = Field(unique=True, index=True)
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = Field(default="#0d6efd")
    created_at: datetime.datetime = Field(default_factory=datetime.datetime.utcnow)

    # Relacionamentos
    usuarios: List["Usuario"] = Relationship(back_populates="empresa")
    plano_contas: List["PlanoContas"] = Relationship(back_populates="empresa")
    contas: List["Conta"] = Relationship(back_populates="empresa")
    entidades: List["Entidade"] = Relationship(back_populates="empresa")
    cartoes: List["Cartao"] = Relationship(back_populates="empresa")
    centros_custo: List["CentroCusto"] = Relationship(back_populates="empresa")
    lancamentos: List["Lancamento"] = Relationship(back_populates="empresa")