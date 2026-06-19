# app/models/user_session.py
from __future__ import annotations
from typing import Optional
from sqlmodel import Field, SQLModel
from datetime import datetime

class UserSession(SQLModel, table=True):
    __tablename__ = "user_sessions"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="usuarios.id", index=True)
    session_id: str = Field(index=True, unique=True)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    is_active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    last_activity_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
