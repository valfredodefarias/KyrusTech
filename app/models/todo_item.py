# app/models/todo_item.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .usuario import Usuario


class TodoItem(AuditMixin, SQLModel, table=True):
    __tablename__ = "todo_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    titulo: str = Field(index=True)
    descricao: Optional[str] = None
    status: str = Field(default="PENDENTE", index=True)
    prioridade: str = Field(default="MEDIA", index=True)
    due_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

    periodicidade: str = Field(default="UNICA", index=True)  # UNICA | DIARIA | SEMANAL
    dias_semana: Optional[str] = Field(default=None, description="Dias da semana (ex: SEG,TER,QUA)")
    inclui_sabado: bool = Field(default=False)

    tipo_alvo: str = Field(default="EMPRESA", index=True)  # EMPRESA | CONSULTOR

    empresa_id: Optional[int] = Field(default=None, foreign_key="empresas.id", index=True)
    consultor_id: Optional[int] = Field(default=None, foreign_key="usuarios.id", index=True)

    last_started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    total_seconds: int = Field(default=0)

    empresa: Optional["Empresa"] = Relationship(sa_relationship=relationship("Empresa"))
    consultor: Optional["Usuario"] = Relationship(sa_relationship=relationship("Usuario"))
