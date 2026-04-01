from __future__ import annotations

from typing import ClassVar, Optional, TYPE_CHECKING

from sqlalchemy.orm import relationship

from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .access_profile_permission import AccessProfilePermission


class AccessPermission(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "access_permissions"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True, max_length=120)
    module: str = Field(index=True, max_length=64)
    action: str = Field(index=True, max_length=64)
    description: Optional[str] = Field(default=None, max_length=255)
    is_page_level: bool = Field(default=False, index=True)
    is_active: bool = Field(default=True, index=True)

    profile_links: list["AccessProfilePermission"] = Relationship(
        sa_relationship=relationship(
            "AccessProfilePermission",
            back_populates="permission",
            lazy="selectin",
            cascade="all, delete-orphan",
        )
    )
