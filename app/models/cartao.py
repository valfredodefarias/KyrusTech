# app/models/cartao.py
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa
    from .centro_custo import CentroCusto 
    from .conta import Conta

class Cartao(SQLModel, table=True):
    __tablename__ = "cartoes"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome_cartao: str
    limite_total: Decimal = Field(default=0.0, max_digits=12, decimal_places=2)
    dia_fechamento: int
    dia_vencimento: int
    status: str = Field(default="ATIVO")
    id_conta_padrao: Optional[int] = None 

    # --- 2. Novos Campos ---
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id")
    
    empresa_id: int = Field(foreign_key="empresas.id")
    
    # --- 3. Relacionamentos ---
    empresa: "Empresa" = Relationship()
    centro_custo: Optional["CentroCusto"] = Relationship()
    conta: Optional["Conta"] = Relationship()
    lancamentos: List["Lancamento"] = Relationship(back_populates="cartao")