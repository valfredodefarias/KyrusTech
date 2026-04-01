from __future__ import annotations

# app/schemas/empresa.py
from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

class EmpresaBase(SQLModel):
    nome_fantasia: str
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    tipo_pessoa: str = "PJ"
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = "#0d6efd"
    is_active: bool = True

class EmpresaCreate(EmpresaBase):
    pass

class EmpresaUpdate(SQLModel):
    nome_fantasia: Optional[str] = None
    razao_social: Optional[str] = None
    cnpj: Optional[str] = None
    tipo_pessoa: Optional[str] = None
    logo_url: Optional[str] = None
    cor_primaria: Optional[str] = None
    is_active: Optional[bool] = None

class EmpresaRead(EmpresaBase, AuditReadMixin):
    pass