# app/models/usuario.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin
from app.enums import ConsultorRole

if TYPE_CHECKING:
    from .empresa import Empresa
    from .consultor_empresa import ConsultorEmpresa
    from .user_company_profile import UserCompanyProfile

class Usuario(AuditMixin, SQLModel, table=True):
    __tablename__ = "usuarios"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: Optional[str] = Field(default=None, index=False)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    foto_url: Optional[str] = None
    telefone: Optional[str] = Field(default=None, max_length=50, nullable=True)
    email_confirmado: bool = Field(default=False, nullable=False)
    
    is_active: bool = Field(default=True)
    is_consultor: bool = Field(default=False, description="Consultor Link Financeiro")
    
    # Papel do consultor (SUPER_CONSULTOR, CONSULTOR, USUARIO_NORMAL)
    consultor_role: str = Field(
        default=ConsultorRole.USUARIO_NORMAL.value,
        description="Papel do usuário se for consultor"
    )
    
    # A empresa atual que ele está visualizando/operando
    # Para usuários normais: obrigatória
    # Para consultores: pode ser None inicialmente e ser preenchida ao primeiro acesso
    empresa_id: Optional[int] = Field(default=None, foreign_key="empresas.id", index=True)
    empresa: Optional["Empresa"] = Relationship(
        sa_relationship=relationship("Empresa", back_populates="usuarios")
    )
    
    # Para consultores: lista de empresas que pode acessar
    empresas_acesso: list["ConsultorEmpresa"] = Relationship(
        sa_relationship=relationship(
            "ConsultorEmpresa",
            back_populates="usuario",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )
    company_profiles: list["UserCompanyProfile"] = Relationship(
        sa_relationship=relationship(
            "UserCompanyProfile",
            back_populates="usuario",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )