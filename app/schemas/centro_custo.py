# app/schemas/centro_custo.py
from typing import Optional
from sqlmodel import SQLModel

class CentroCustoBase(SQLModel):
    nome: str
    codigo: Optional[str] = None
    status: str = "ATIVO"

class CentroCustoCreate(CentroCustoBase):
    pass

class CentroCustoRead(CentroCustoBase):
    id: int
    empresa_id: int

class CentroCustoUpdate(SQLModel):
    nome: Optional[str] = None
    codigo: Optional[str] = None
    status: Optional[str] = None