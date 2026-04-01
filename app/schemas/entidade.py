# app/schemas/entidade.py
from __future__ import annotations

from typing import Optional, List
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

# --- BASE ---
class EntidadeBase(SQLModel):
    nome: str
    tipo: str = "AMBOS" # CLIENTE, FORNECEDOR, AMBOS
    tipo_pessoa: str = "PJ"
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = None
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
    status: str = "ATIVO"

# --- CREATE (sem empresa_id, o backend extrai do user autenticado) ---
class EntidadeCreate(EntidadeBase):
    pass

# --- UPDATE ---
class EntidadeUpdate(SQLModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    tipo_pessoa: Optional[str] = None
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = None
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
    status: Optional[str] = None

# --- READ ---
class EntidadeRead(EntidadeBase, AuditReadMixin):
    id: int
    empresa_id: int


class EntidadeLookup(SQLModel):
    id: int
    nome: str
    tipo: str = "AMBOS"
    tipo_pessoa: str = "PJ"


class EntidadePage(SQLModel):
    items: List[EntidadeRead]
    total: int
    skip: int
    limit: int