from typing import ClassVar, List, Optional, TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .access_profile_permission import AccessProfilePermission
    from .empresa import Empresa
    from .user_company_profile import UserCompanyProfile


class AccessProfile(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "access_profiles"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: Optional[int] = Field(default=None, foreign_key="empresas.id", index=True)
    name: str = Field(index=True, max_length=100)
    code: str = Field(index=True, max_length=80)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = Field(default=True, index=True)
    is_system: bool = Field(default=False, index=True)
    is_template: bool = Field(default=False, index=True)
    base_template_code: Optional[str] = Field(default=None, max_length=80)

    empresa: Optional["Empresa"] = Relationship(back_populates="access_profiles")
    permissions: List["AccessProfilePermission"] = Relationship(
        back_populates="profile",
        sa_relationship_kwargs=dict(lazy="selectin", cascade="all, delete-orphan"),
    )
    user_assignments: List["UserCompanyProfile"] = Relationship(
        back_populates="profile",
        sa_relationship_kwargs=dict(lazy="selectin", cascade="all, delete-orphan"),
    )
