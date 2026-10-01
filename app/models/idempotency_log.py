from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON, UniqueConstraint
from sqlmodel import Field, SQLModel


class IdempotencyLog(SQLModel, table=True):
    __tablename__ = "idempotency_logs"
    __table_args__ = (
        UniqueConstraint("empresa_id", "idempotency_key", name="uq_idempotency_empresa_key"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: Optional[int] = Field(default=None, foreign_key="empresas.id", index=True, nullable=True)
    idempotency_key: str = Field(max_length=255, index=True, nullable=False)
    status: str = Field(max_length=50, index=True)  # processing, completed, failed
    response_body: Optional[Any] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
