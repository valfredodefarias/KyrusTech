# app/models/usuario.py
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa

class Usuario(AuditMixin, SQLModel, table=True):
    __tablename__ = "usuarios"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    
    is_active: bool = Field(default=True)
    is_consultor: bool = Field(default=False, description="Consultor Link Financeiro")
    
    # A empresa atual que ele está visualizando/operando
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    empresa: "Empresa" = Relationship(back_populates="usuarios")