from __future__ import annotations

# app/models/empresa.py
from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
import datetime
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .access_profile import AccessProfile
    from .user_company_profile import UserCompanyProfile
    from .dashboard_view_config import DashboardViewConfig
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
    categoria_nfe_fornecedores_id: Optional[int] = Field(default=None, index=True)
    pdv_config: Optional[str] = Field(default=None, description="Configuração do PDV em JSON")
    data_bloqueio_periodo: Optional[datetime.date] = Field(default=None, description="Data limite para bloqueio de lançamentos retroativos")
    is_active: bool = Field(default=True, index=True)
    
    # created_at e updated_at já vêm do AuditMixin, mas mantemos o default
    # caso queira lógica específica, ou removemos daqui pois o Mixin já provê.
    # O Mixin é suficiente, mas para garantir compatibilidade com código legado,
    # o Mixin sobrescreve se não declarar, ou complementa.
    
    # Relacionamentos
    usuarios: list["Usuario"] = Relationship(
        sa_relationship=relationship("Usuario", back_populates="empresa")
    )
    plano_contas: list["PlanoContas"] = Relationship(
        sa_relationship=relationship("PlanoContas", back_populates="empresa")
    )
    contas: list["Conta"] = Relationship(
        sa_relationship=relationship("Conta", back_populates="empresa")
    )
    entidades: list["Entidade"] = Relationship(
        sa_relationship=relationship("Entidade", back_populates="empresa")
    )
    cartoes: list["Cartao"] = Relationship(
        sa_relationship=relationship("Cartao", back_populates="empresa")
    )
    centros_custo: list["CentroCusto"] = Relationship(
        sa_relationship=relationship("CentroCusto", back_populates="empresa")
    )
    lancamentos: list["Lancamento"] = Relationship(
        sa_relationship=relationship("Lancamento", back_populates="empresa")
    )
    consultores: list["ConsultorEmpresa"] = Relationship(
        sa_relationship=relationship(
            "ConsultorEmpresa",
            back_populates="empresa",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )
    integracoes_bancarias: list["IntegracaoBancaria"] = Relationship(
        sa_relationship=relationship("IntegracaoBancaria", back_populates="empresa")
    )
    access_profiles: list["AccessProfile"] = Relationship(
        sa_relationship=relationship(
            "AccessProfile",
            back_populates="empresa",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )
    user_company_profiles: list["UserCompanyProfile"] = Relationship(
        sa_relationship=relationship(
            "UserCompanyProfile",
            back_populates="empresa",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )
    dashboard_view_config: Optional["DashboardViewConfig"] = Relationship(
        sa_relationship=relationship(
            "DashboardViewConfig",
            back_populates="empresa",
            uselist=False,
            cascade="all, delete-orphan",
        )
    )
    # anexo_lancamento não precisa de back_populates direto aqui geralmente, mas pode ter se necessário


# Garante registro do model no mapper em runtime para resolver a relationship por nome.
from .dashboard_view_config import DashboardViewConfig  # noqa: F401