# app/models/password_reset_code.py
from __future__ import annotations

from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class PasswordResetCode(SQLModel, table=True):
    __tablename__ = "password_reset_codes"

    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, nullable=False, max_length=255)
    code_hash: str = Field(index=True, nullable=False, max_length=128)
    expires_at: datetime = Field(index=True, nullable=False)
    used: bool = Field(default=False, index=True, nullable=False)
    attempts: int = Field(default=0, nullable=False)
    ip_address: Optional[str] = Field(default=None, max_length=45)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
