from __future__ import annotations

from typing import ClassVar, Optional, TYPE_CHECKING

from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .access_permission import AccessPermission
    from .access_profile import AccessProfile


class AccessProfilePermission(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "access_profile_permissions"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="access_profiles.id", index=True)
    permission_id: int = Field(foreign_key="access_permissions.id", index=True)
    allowed: bool = Field(default=True)

    profile: "AccessProfile" = Relationship(
        sa_relationship=relationship("AccessProfile", back_populates="permissions")
    )
    permission: "AccessPermission" = Relationship(
        sa_relationship=relationship("AccessPermission", back_populates="profile_links")
    )
