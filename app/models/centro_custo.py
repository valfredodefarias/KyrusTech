# app/models/centro_custo.py

from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class CentroCusto(SQLModel, table=True):
    __tablename__ = "centros_custo" # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True) # Ex: "Departamento de Vendas", "Projeto Alpha"
    codigo: Optional[str] = None # Ex: "1.01", "VEND"
    status: str = Field(default="ATIVO") # ATIVO ou INATIVO

    # Vínculo com a empresa (Multi-tenancy)
    empresa_id: int = Field(foreign_key="empresas.id")
    empresa: "Empresa" = Relationship()

    # Relacionamento inverso para ver todos os lançamentos deste centro de custo
    lancamentos: List["Lancamento"] = Relationship(back_populates="centro_custo")