from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class Cartao(SQLModel, table=True):
    __tablename__ = "cartoes"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome_cartao: str
    limite_total: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    dia_fechamento: int
    dia_vencimento: int
    status: str = Field(default="ATIVO")
    id_conta_padrao: Optional[int] = None # ID de uma conta bancária para débito automático (opcional)

    empresa_id: int = Field(foreign_key="empresas.id")
    empresa: "Empresa" = Relationship()

    # Relacionamento inverso para ver a fatura (todos os lançamentos deste cartão)
    lancamentos: List["Lancamento"] = Relationship(back_populates="cartao")