# app/schemas/todo.py
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin


class TodoBase(SQLModel):
    titulo: str
    descricao: Optional[str] = None
    status: str = "PENDENTE"  # PENDENTE | EM_ANDAMENTO | CONCLUIDO
    prioridade: str = "MEDIA"  # BAIXA | MEDIA | ALTA
    due_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    periodicidade: str = "UNICA"  # UNICA | DIARIA | SEMANAL
    dias_semana: Optional[str] = None
    inclui_sabado: bool = False
    tipo_alvo: str = "EMPRESA"  # EMPRESA | CONSULTOR
    empresa_id: Optional[int] = None
    consultor_id: Optional[int] = None


class TodoCreate(TodoBase):
    pass


class TodoUpdate(SQLModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    status: Optional[str] = None
    prioridade: Optional[str] = None
    due_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    periodicidade: Optional[str] = None
    dias_semana: Optional[str] = None
    inclui_sabado: Optional[bool] = None
    tipo_alvo: Optional[str] = None
    empresa_id: Optional[int] = None
    consultor_id: Optional[int] = None


class TodoRead(TodoBase, AuditReadMixin):
    last_started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    total_seconds: int = 0
