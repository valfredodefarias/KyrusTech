# app/models/conta.py
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, SQLModel, Relationship 
from decimal import Decimal
import datetime

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento
    from .centro_custo import CentroCusto # <--- IMPORT NOVO

class Conta(SQLModel, table=True):
    __tablename__ = "contas"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(index=True)
    banco: Optional[str] = None
    saldo_inicial: float = Field(default=0.0)
    data_saldo_inicial: Optional[datetime.date] = None
    status: str = Field(default='ATIVO')
    cor: Optional[str] = Field(default="#808080")
    
    # --- NOVO CAMPO ---
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")

    empresa_id: int = Field(foreign_key="empresas.id")
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="contas")
    centro_custo: Optional["CentroCusto"] = Relationship() # <--- NOVO VÍNCULO
    lancamentos: List["Lancamento"] = Relationship(back_populates="conta")