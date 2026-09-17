# app/models/user_invite.py
from __future__ import annotations

from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .usuario import Usuario


class UserInvite(SQLModel, table=True):
    __tablename__ = "user_invites"

    id: Optional[int] = Field(default=None, primary_key=True)
    usuario_id: int = Field(foreign_key="usuarios.id", index=True, nullable=False)
    email: str = Field(index=True, nullable=False, max_length=255)
    token_hash: str = Field(index=True, nullable=False, max_length=128)
    expires_at: datetime = Field(index=True, nullable=False)
    used: bool = Field(default=False, index=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
