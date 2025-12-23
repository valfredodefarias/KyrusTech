from typing import Optional
from sqlmodel import SQLModel, Field

class PlanoContasBase(SQLModel):
    nome: str
    tipo: str
    codigo: Optional[str] = None
    permite_lancamentos: bool = True
    conta_pai_id: Optional[int] = None

class PlanoContasCreate(PlanoContasBase):
    pass

class PlanoContasRead(PlanoContasBase):
    id: int

class PlanoContasUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    permite_lancamentos: Optional[bool] = None