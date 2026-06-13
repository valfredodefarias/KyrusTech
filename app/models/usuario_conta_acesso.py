from __future__ import annotations

# app/models/usuario_conta_acesso.py
from typing import Optional
from sqlmodel import Field, SQLModel

class UsuarioContaAcesso(SQLModel, table=True):
    __tablename__ = "usuario_conta_acesso"

    usuario_id: int = Field(foreign_key="usuarios.id", primary_key=True, index=True)
    conta_id: int = Field(foreign_key="contas.id", primary_key=True, index=True)
