from typing import Optional
from sqlmodel import SQLModel

class EmpresaCreate(SQLModel):
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None

class EmpresaRead(SQLModel):
    id: int
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = None