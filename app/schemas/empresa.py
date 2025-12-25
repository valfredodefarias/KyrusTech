from typing import Optional
from sqlmodel import SQLModel

# Base comum
class EmpresaBase(SQLModel):
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = "#0d6efd"

# Para criação (POST)
class EmpresaCreate(EmpresaBase):
    pass

# Para leitura (GET)
class EmpresaRead(EmpresaBase):
    id: int

# Para atualização (PATCH) - Todos os campos opcionais
class EmpresaUpdate(SQLModel):
    nome_fantasia: Optional[str] = None
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = None