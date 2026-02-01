# app/models/usuario.py
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin
from app.enums import ConsultorRole

if TYPE_CHECKING:
    from .empresa import Empresa
    from .consultor_empresa import ConsultorEmpresa

class Usuario(AuditMixin, SQLModel, table=True):
    __tablename__ = "usuarios"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: Optional[str] = Field(default=None, index=False)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    foto_url: Optional[str] = None
    
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
    empresa: Optional["Empresa"] = Relationship(back_populates="usuarios")
    
    # Para consultores: lista de empresas que pode acessar
    empresas_acesso: List["ConsultorEmpresa"] = Relationship(
        back_populates="usuario",
        sa_relationship_kwargs=dict(lazy="selectin", cascade="all, delete-orphan")
    )