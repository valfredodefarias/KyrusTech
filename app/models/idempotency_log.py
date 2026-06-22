from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class IdempotencyLog(SQLModel, table=True):
    __tablename__ = "idempotency_logs"

    idempotency_key: str = Field(primary_key=True, max_length=255)
    status: str = Field(max_length=50, index=True)  # processing, completed, failed
    response_body: Optional[Any] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
