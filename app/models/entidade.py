# app/models/entidade.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from pydantic import field_validator
import re
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class Entidade(AuditMixin, SQLModel, table=True):
    __tablename__ = "entidades"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(default="AMBOS", index=True) # CLIENTE, FORNECEDOR, AMBOS
    tipo_pessoa: str = Field(default="PJ", index=True) # PF, PJ
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = Field(index=True)
    email: Optional[str] = None
    telefone: Optional[str] = None
    celular: Optional[str] = None
    contato_nome: Optional[str] = None
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    observacoes: Optional[str] = None
    status: str = Field(default="ATIVO")

    @field_validator("nome", "nome_fantasia", mode="before")
    @classmethod
    def clean_spaces(cls, v):
        if isinstance(v, str):
            v = v.replace("&nbsp;", " ").strip()
            v = re.sub(r"\s+", " ", v)
        return v
    
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", back_populates="entidades"))
    
    lancamentos: list["Lancamento"] = Relationship(
        sa_relationship=relationship("Lancamento", back_populates="entidade")
    )