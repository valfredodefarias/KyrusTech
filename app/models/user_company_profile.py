from typing import ClassVar, Optional, TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .access_profile import AccessProfile
    from .empresa import Empresa
    from .usuario import Usuario


class UserCompanyProfile(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "user_company_profiles"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    usuario_id: int = Field(foreign_key="usuarios.id", index=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    profile_id: int = Field(foreign_key="access_profiles.id", index=True)
    is_active: bool = Field(default=True, index=True)

    usuario: "Usuario" = Relationship(back_populates="company_profiles")
    empresa: "Empresa" = Relationship(back_populates="user_company_profiles")
    profile: "AccessProfile" = Relationship(back_populates="user_assignments")
