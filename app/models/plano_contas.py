from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .empresa import Empresa

class PlanoContas(SQLModel, table=True):
    __tablename__ = "plano_contas"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(index=True)  # 'R' ou 'D'
    codigo: Optional[str] = None
    permite_lancamentos: bool = Field(default=True)
    
    conta_pai_id: Optional[int] = Field(default=None, foreign_key="plano_contas.id")
    empresa_id: int = Field(foreign_key="empresas.id")

    empresa: "Empresa" = Relationship(back_populates="plano_contas")
    
    conta_pai: Optional["PlanoContas"] = Relationship(
        back_populates="contas_filhas",
        sa_relationship_kwargs={"remote_side": "PlanoContas.id"}
    )
    contas_filhas: List["PlanoContas"] = Relationship(back_populates="conta_pai")