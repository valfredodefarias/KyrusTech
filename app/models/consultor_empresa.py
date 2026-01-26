# app/models/consultor_empresa.py
"""
Tabela de relacionamento: um consultor pode acessar múltiplas empresas.
"""
from typing import Optional, TYPE_CHECKING, ClassVar
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .usuario import Usuario
    from .empresa import Empresa


class ConsultorEmpresa(AuditMixin, SQLModel, table=True):
    """
    Relacionamento many-to-many entre Consultor (Usuario com is_consultor=True) e Empresa.
    Permite que um consultor acesse múltiplas empresas.
    """
    __tablename__: ClassVar[str] = "consultor_empresa"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Foreign Keys
    usuario_id: int = Field(foreign_key="usuarios.id", index=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    
    # Relationships
    usuario: "Usuario" = Relationship(back_populates="empresas_acesso")
    empresa: "Empresa" = Relationship(back_populates="consultores")
    
    # Metadata
    ativo: bool = Field(default=True, description="Se o consultor ainda tem acesso a essa empresa")
