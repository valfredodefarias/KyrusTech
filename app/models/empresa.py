# app/models/empresa.py
from typing import List, Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
import datetime
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .usuario import Usuario
    from .plano_contas import PlanoContas
    from .conta import Conta
    from .entidade import Entidade
    from .cartao import Cartao
    from .centro_custo import CentroCusto
    from .lancamento import Lancamento
    from .integracao_bancaria import IntegracaoBancaria
    from .anexo_lancamento import AnexoLancamento
    from .consultor_empresa import ConsultorEmpresa

class Empresa(AuditMixin, SQLModel, table=True):
    __tablename__ = "empresas"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome_fantasia: str = Field(index=True)
    razao_social: Optional[str] = None
    cnpj: Optional[str] = Field(unique=True, index=True)
    tipo_pessoa: str = Field(default="PJ", index=True, description="PF ou PJ")
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = Field(default="#0d6efd")
    is_active: bool = Field(default=True, index=True)
    
    # created_at e updated_at já vêm do AuditMixin, mas mantemos o default
    # caso queira lógica específica, ou removemos daqui pois o Mixin já provê.
    # O Mixin é suficiente, mas para garantir compatibilidade com código legado,
    # o Mixin sobrescreve se não declarar, ou complementa.
    
    # Relacionamentos
    usuarios: List["Usuario"] = Relationship(back_populates="empresa")
    plano_contas: List["PlanoContas"] = Relationship(back_populates="empresa")
    contas: List["Conta"] = Relationship(back_populates="empresa")
    entidades: List["Entidade"] = Relationship(back_populates="empresa")
    cartoes: List["Cartao"] = Relationship(back_populates="empresa")
    centros_custo: List["CentroCusto"] = Relationship(back_populates="empresa")
    lancamentos: List["Lancamento"] = Relationship(back_populates="empresa")
    consultores: List["ConsultorEmpresa"] = Relationship(
        back_populates="empresa",
        sa_relationship_kwargs=dict(lazy="selectin", cascade="all, delete-orphan")
    )
    integracoes_bancarias: List["IntegracaoBancaria"] = Relationship(back_populates="empresa")
    # anexo_lancamento não precisa de back_populates direto aqui geralmente, mas pode ter se necessário