# app/models/conta.py

from typing import Optional, List, TYPE_CHECKING
# CORREÇÃO: Adicionamos List, TYPE_CHECKING e Relationship
from sqlmodel import Field, SQLModel, Relationship 
from decimal import Decimal
import datetime

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento # <-- Nova importação para o relacionamento

class Conta(SQLModel, table=True):
    __tablename__ = "contas" # type: ignore

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(index=True) # CORRENTE, CAIXA, INVESTIMENTO
    banco: Optional[str] = None
    saldo_inicial: float = Field(default=0.0)
    data_saldo_inicial: Optional[datetime.date] = None
    status: str = Field(default='ATIVO')
    cor: Optional[str] = Field(default="#808080")

    empresa_id: int = Field(foreign_key="empresas.id")
    empresa: "Empresa" = Relationship(back_populates="contas")
    
    # --- CORREÇÃO AQUI: Adicionamos a outra ponta do relacionamento ---
    lancamentos: List["Lancamento"] = Relationship(back_populates="conta")