from __future__ import annotations

import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.v1.deps import get_empresa_id_from_user, require_permission
from app.db.session import get_db
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.usuario import Usuario
from app.services.access_seed_service import ensure_rbac_seed
from app.services.access_control_service import invalidate_permission_cache

router = APIRouter()


class PermissionRead(BaseModel):
    id: int
    code: str
    module: str
    action: str
    description: Optional[str] = None
    is_page_level: bool = False
    is_active: bool = True


class AccessProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: Optional[str] = Field(default=None, max_length=80)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: bool = True
    permission_ids: list[int] = Field(default_factory=list)


class AccessProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    code: Optional[str] = Field(default=None, max_length=80)
    description: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None


class AccessProfilePermissionsUpdate(BaseModel):
    permission_ids: list[int] = Field(default_factory=list)


class AccessProfileRead(BaseModel):
    id: int
    empresa_id: Optional[int] = None
    name: str
    code: str
    description: Optional[str] = None
    is_active: bool = True
    is_system: bool = False
    is_template: bool = False
    base_template_code: Optional[str] = None
    editable: bool = True
    permission_count: int = 0
    user_count: int = 0
    permissions: list[PermissionRead] = Field(default_factory=list)


class RbacUserRead(BaseModel):
    id: int
    nome: Optional[str] = None
    email: str
    foto_url: Optional[str] = None
    is_active: bool = True
    is_consultor: bool = False
    consultor_role: str = "USUARIO_NORMAL"
    empresa_id: Optional[int] = None
    profile_id: Optional[int] = None
    profile_name: Optional[str] = None
    profile_code: Optional[str] = None


class RbacUserProfileUpdate(BaseModel):
    profile_id: int


def _normalize_code(value: str) -> str:
    base = unicodedata.normalize("NFKD", str(value or ""))
    no_accents = "".join(char for char in base if not unicodedata.combining(char))
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", no_accents).strip("_")
    return normalized.upper() or "PERFIL"


def _unique_profile_code(
    db: Session,
    *,
    empresa_id: int,
    base_code: str,
    exclude_profile_id: int | None = None,
) -> str:
    prefix = (base_code or "PERFIL")[:80]
    candidate = prefix
    suffix = 2

    while True:
        statement = select(AccessProfile.id).where(
            AccessProfile.empresa_id == empresa_id,
            AccessProfile.code == candidate,
            AccessProfile.is_deleted == False,
        )
        if exclude_profile_id is not None:
            statement = statement.where(AccessProfile.id != exclude_profile_id)

        existing = db.exec(statement).first()
        if not existing:
            return candidate

        suffix_text = f"_{suffix}"
        trimmed = prefix[: max(1, 80 - len(suffix_text))]
        candidate = f"{trimmed}{suffix_text}"
        suffix += 1


def _load_permissions(db: Session) -> list[PermissionRead]:
    ensure_rbac_seed(db)
    permissions = db.exec(
        select(AccessPermission)
        .where(
            AccessPermission.is_deleted == False,
            AccessPermission.is_active == True,
        )
        .order_by(AccessPermission.module, AccessPermission.action, AccessPermission.code)
    ).all()

    return [
        PermissionRead(
            id=int(permission.id),
            code=permission.code,
            module=permission.module,
            action=permission.action,
            description=permission.description,
            is_page_level=bool(permission.is_page_level),
            is_active=bool(permission.is_active),
        )
        for permission in permissions
        if permission.id is not None
    ]


def _load_company_profiles(db: Session, *, empresa_id: int) -> list[AccessProfileRead]:
    ensure_rbac_seed(db)
    profiles = db.exec(
        select(AccessProfile)
        .options(selectinload(AccessProfile.permissions).selectinload(AccessProfilePermission.permission))
        .where(
            AccessProfile.empresa_id == empresa_id,
            AccessProfile.is_deleted == False,
        )
        .order_by(AccessProfile.is_system.desc(), AccessProfile.name)
    ).all()

    user_counts = {
        int(profile_id): int(total)
        for profile_id, total in db.exec(
            select(UserCompanyProfile.profile_id, func.count(UserCompanyProfile.id))
            .where(
                UserCompanyProfile.empresa_id == empresa_id,
                UserCompanyProfile.is_deleted == False,
                UserCompanyProfile.is_active == True,
            )
            .group_by(UserCompanyProfile.profile_id)
        ).all()
        if profile_id is not None
    }

    result: list[AccessProfileRead] = []
    for profile in profiles:
        if profile.id is None:
            continue

        active_permissions: list[PermissionRead] = []
        for link in profile.permissions or []:
            permission = link.permission
            if not link.allowed or link.is_deleted or not permission or permission.is_deleted or not permission.is_active:
                continue
            if permission.id is None:
                continue
            active_permissions.append(
                PermissionRead(
                    id=int(permission.id),
                    code=permission.code,
                    module=permission.module,
                    action=permission.action,
                    description=permission.description,
                    is_page_level=bool(permission.is_page_level),
                    is_active=bool(permission.is_active),
                )
            )

        result.append(
            AccessProfileRead(
                id=int(profile.id),
                empresa_id=profile.empresa_id,
                name=profile.name,
                code=profile.code,
                description=profile.description,
                is_active=bool(profile.is_active),
                is_system=bool(profile.is_system),
                is_template=bool(profile.is_template),
                base_template_code=profile.base_template_code,
                editable=not bool(profile.is_system),
                permission_count=len(active_permissions),
                user_count=user_counts.get(int(profile.id), 0),
                permissions=active_permissions,
            )
        )

    return result


def _load_company_users(db: Session, *, empresa_id: int) -> list[RbacUserRead]:
    ensure_rbac_seed(db)
    consultor_ids = select(ConsultorEmpresa.usuario_id).where(
        ConsultorEmpresa.empresa_id == empresa_id,
        ConsultorEmpresa.ativo == True,
        ConsultorEmpresa.is_deleted == False,
    )

    users = db.exec(
        select(Usuario)
        .where(
            Usuario.is_deleted == False,
            Usuario.is_active == True,
            or_(Usuario.empresa_id == empresa_id, Usuario.id.in_(consultor_ids)),
        )
        .order_by(Usuario.nome, Usuario.email)
    ).all()

    assignments = db.exec(
        select(UserCompanyProfile)
        .options(selectinload(UserCompanyProfile.profile))
        .where(
            UserCompanyProfile.empresa_id == empresa_id,
            UserCompanyProfile.is_deleted == False,
            UserCompanyProfile.is_active == True,
        )
    ).all()
    assignment_map = {
        int(assignment.usuario_id): assignment
        for assignment in assignments
        if assignment.usuario_id is not None
    }

    result: list[RbacUserRead] = []
    for user in users:
        if user.id is None:
            continue

        assignment = assignment_map.get(int(user.id))
        profile = assignment.profile if assignment else None
        result.append(
            RbacUserRead(
                id=int(user.id),
                nome=user.nome,
                email=user.email,
                foto_url=getattr(user, "foto_url", None),
                is_active=bool(user.is_active),
                is_consultor=bool(user.is_consultor),
                consultor_role=str(user.consultor_role or "USUARIO_NORMAL"),
                empresa_id=user.empresa_id,
                profile_id=int(profile.id) if profile and profile.id is not None else None,
                profile_name=profile.name if profile else None,
                profile_code=profile.code if profile else None,
            )
        )

    return result


def _get_profile_or_404(db: Session, *, profile_id: int, empresa_id: int) -> AccessProfile:
    profile = db.exec(
        select(AccessProfile).where(
            AccessProfile.id == profile_id,
            AccessProfile.empresa_id == empresa_id,
            AccessProfile.is_deleted == False,
        )
    ).first()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Perfil de acesso não encontrado para esta empresa")
    return profile


def _sync_profile_permissions(
    db: Session,
    *,
    profile_id: int,
    permission_ids: list[int],
) -> None:
    normalized_ids = sorted({int(permission_id) for permission_id in permission_ids if int(permission_id) > 0})
    if not normalized_ids:
        existing_links = db.exec(
            select(AccessProfilePermission).where(
                AccessProfilePermission.profile_id == profile_id,
                AccessProfilePermission.is_deleted == False,
            )
        ).all()
        for link in existing_links:
            link.allowed = False
            db.add(link)
        return

    permissions = db.exec(
        select(AccessPermission).where(
            AccessPermission.id.in_(normalized_ids),
            AccessPermission.is_deleted == False,
            AccessPermission.is_active == True,
        )
    ).all()
    permission_map = {int(permission.id): permission for permission in permissions if permission.id is not None}
    missing_ids = [permission_id for permission_id in normalized_ids if permission_id not in permission_map]
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uma ou mais permissões informadas não existem mais")

    existing_links = db.exec(
        select(AccessProfilePermission).where(
            AccessProfilePermission.profile_id == profile_id,
            AccessProfilePermission.is_deleted == False,
        )
    ).all()
    existing_map = {
        int(link.permission_id): link
        for link in existing_links
        if link.permission_id is not None
    }

    target_ids = set(normalized_ids)

    for permission_id in target_ids:
        link = existing_map.get(permission_id)
        if link:
            link.allowed = True
            link.is_deleted = False
            db.add(link)
            continue

        db.add(
            AccessProfilePermission(
                profile_id=profile_id,
                permission_id=permission_id,
                allowed=True,
                is_deleted=False,
            )
        )

    for permission_id, link in existing_map.items():
        if permission_id not in target_ids:
            link.allowed = False
            link.is_deleted = False
            db.add(link)


@router.get(
    "/permissions",
    response_model=list[PermissionRead],
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def list_permissions(db: Session = Depends(get_db)):
    return _load_permissions(db)


@router.get(
    "/profiles",
    response_model=list[AccessProfileRead],
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def list_profiles(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    return _load_company_profiles(db, empresa_id=empresa_id)


@router.post(
    "/profiles",
    response_model=AccessProfileRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def create_profile(
    payload: AccessProfileCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    ensure_rbac_seed(db)
    code_source = payload.code or payload.name
    code = _unique_profile_code(db, empresa_id=empresa_id, base_code=_normalize_code(code_source))

    profile = AccessProfile(
        empresa_id=empresa_id,
        name=payload.name.strip(),
        code=code,
        description=payload.description.strip() if payload.description else None,
        is_active=payload.is_active,
        is_system=False,
        is_template=False,
        base_template_code=None,
        is_deleted=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)

    if payload.permission_ids:
        _sync_profile_permissions(db, profile_id=int(profile.id), permission_ids=payload.permission_ids)
        db.commit()
        db.refresh(profile)

    invalidate_permission_cache(empresa_id=empresa_id)

    created = next((item for item in _load_company_profiles(db, empresa_id=empresa_id) if item.id == int(profile.id)), None)
    if not created:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao criar perfil")
    return created


@router.patch(
    "/profiles/{profile_id}",
    response_model=AccessProfileRead,
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def update_profile(
    profile_id: int,
    payload: AccessProfileUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    ensure_rbac_seed(db)
    profile = _get_profile_or_404(db, profile_id=profile_id, empresa_id=empresa_id)
    if profile.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Perfis de sistema não podem ser editados")

    if payload.name is not None:
        profile.name = payload.name.strip()
    if payload.code is not None:
        profile.code = _unique_profile_code(
            db,
            empresa_id=empresa_id,
            base_code=_normalize_code(payload.code),
            exclude_profile_id=int(profile.id),
        )
    if payload.description is not None:
        profile.description = payload.description.strip() or None
    if payload.is_active is not None:
        profile.is_active = bool(payload.is_active)

    db.add(profile)
    db.commit()
    db.refresh(profile)
    invalidate_permission_cache(empresa_id=empresa_id)

    profiles = _load_company_profiles(db, empresa_id=empresa_id)
    for item in profiles:
        if item.id == profile_id:
            return item

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao atualizar perfil")


@router.put(
    "/profiles/{profile_id}/permissions",
    response_model=AccessProfileRead,
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def replace_profile_permissions(
    profile_id: int,
    payload: AccessProfilePermissionsUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    ensure_rbac_seed(db)
    profile = _get_profile_or_404(db, profile_id=profile_id, empresa_id=empresa_id)
    if profile.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Perfis de sistema não podem ter permissões alteradas")

    _sync_profile_permissions(db, profile_id=profile_id, permission_ids=payload.permission_ids)
    db.commit()
    db.refresh(profile)
    invalidate_permission_cache(empresa_id=empresa_id)

    profiles = _load_company_profiles(db, empresa_id=empresa_id)
    for item in profiles:
        if item.id == profile_id:
            return item

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao atualizar permissões")


@router.get(
    "/users",
    response_model=list[RbacUserRead],
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def list_users(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    ensure_rbac_seed(db)
    return _load_company_users(db, empresa_id=empresa_id)


@router.put(
    "/users/{user_id}/profile",
    response_model=RbacUserRead,
    dependencies=[Depends(require_permission("profiles:manage"))],
)
def assign_user_profile(
    user_id: int,
    payload: RbacUserProfileUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    ensure_rbac_seed(db)
    user = db.exec(
        select(Usuario).where(
            Usuario.id == user_id,
            Usuario.is_deleted == False,
            Usuario.is_active == True,
        )
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado")

    allowed_user = False
    if user.empresa_id == empresa_id:
        allowed_user = True
    else:
        consultant_access = db.exec(
            select(ConsultorEmpresa.id).where(
                ConsultorEmpresa.usuario_id == user_id,
                ConsultorEmpresa.empresa_id == empresa_id,
                ConsultorEmpresa.ativo == True,
                ConsultorEmpresa.is_deleted == False,
            )
        ).first()
        allowed_user = consultant_access is not None

    if not allowed_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="O usuário informado não possui acesso a esta empresa")

    profile = _get_profile_or_404(db, profile_id=payload.profile_id, empresa_id=empresa_id)
    if not profile.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Não é possível atribuir um perfil inativo")

    assignment = db.exec(
        select(UserCompanyProfile).where(
            UserCompanyProfile.usuario_id == user_id,
            UserCompanyProfile.empresa_id == empresa_id,
            UserCompanyProfile.is_deleted == False,
        )
    ).first()

    if assignment:
        assignment.profile_id = int(profile.id)
        assignment.is_active = True
        db.add(assignment)
    else:
        assignment = UserCompanyProfile(
            usuario_id=user_id,
            empresa_id=empresa_id,
            profile_id=int(profile.id),
            is_active=True,
            is_deleted=False,
        )
        db.add(assignment)

    db.commit()
    invalidate_permission_cache(user_id=user_id, empresa_id=empresa_id)

    users = _load_company_users(db, empresa_id=empresa_id)
    for item in users:
        if item.id == user_id:
            return item

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao atualizar perfil do usuário")