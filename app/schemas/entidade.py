# app/schemas/entidade.py
from typing import Optional
from sqlmodel import SQLModel

class EntidadeBase(SQLModel):
    nome: str
    tipo: str # CLIENTE, FORNECEDOR, AMBOS
    cpf_cnpj: Optional[str] = None
    status: str = "ATIVO"

class EntidadeCreate(EntidadeBase):
    pass

class EntidadeRead(EntidadeBase):
    id: int
    empresa_id: int

class EntidadeUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    status: Optional[str] = None