from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class Entidade(SQLModel, table=True):
    __tablename__ = "entidades"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(default="AMBOS") # CLIENTE, FORNECEDOR, AMBOS
    cpf_cnpj: Optional[str] = None
    status: str = Field(default="ATIVO")
    
    empresa_id: int = Field(foreign_key="empresas.id")
    empresa: "Empresa" = Relationship()
    
    # Relacionamento inverso para acessar o histórico financeiro desta entidade
    lancamentos: List["Lancamento"] = Relationship(back_populates="entidade")