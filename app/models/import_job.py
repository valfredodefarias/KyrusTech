from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class ImportJob(SQLModel, table=True):
    __tablename__ = "import_jobs"

    job_id: str = Field(primary_key=True, index=True)
    kind: str = Field(index=True)
    empresa_id: int = Field(index=True)
    user_id: int = Field(index=True)
    filename: str
    status: str = Field(default="PENDING", index=True)
    progress: int = Field(default=0)
    message: str = Field(default="Aguardando processamento")
    error: Optional[str] = None
    result: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
