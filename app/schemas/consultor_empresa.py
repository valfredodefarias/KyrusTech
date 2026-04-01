# app/schemas/consultor_empresa.py
"""
Schemas para o relacionamento Consultor-Empresa.
"""
from __future__ import annotations

from typing import Optional
from sqlmodel import SQLModel


class ConsultorEmpresaCreate(SQLModel):
    """Request para adicionar empresa a um consultor."""
    usuario_id: int
    empresa_id: int


class ConsultorEmpresaUpdate(SQLModel):
    """Request para atualizar acesso de consultor a empresa."""
    ativo: Optional[bool] = None


class ConsultorEmpresaRead(SQLModel):
    """Response com dados do relacionamento."""
    id: int
    usuario_id: int
    empresa_id: int
    ativo: bool
