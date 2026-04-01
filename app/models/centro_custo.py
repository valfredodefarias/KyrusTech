# app/models/centro_custo.py

from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class CentroCusto(AuditMixin, SQLModel, table=True):
    __tablename__ = "centros_custo" 

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True) # Ex: "Vendas", "TI"
    codigo: Optional[str] = None # Ex: "1.01"
    status: str = Field(default="ATIVO") 

    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", back_populates="centros_custo"))

    lancamentos: list["Lancamento"] = Relationship(
        sa_relationship=relationship("Lancamento", back_populates="centro_custo")
    )