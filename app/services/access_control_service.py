from __future__ import annotations

import time
from typing import Iterable

from sqlmodel import Session, select

from app.enums import ConsultorRole
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile

_PERMISSION_CACHE_TTL_SECONDS = 60
_permission_cache: dict[tuple[int, int], tuple[float, set[str]]] = {}


def _is_super_consultor(*, is_consultor: bool, consultor_role: str) -> bool:
    return bool(is_consultor and consultor_role == ConsultorRole.SUPER_CONSULTOR.value)


def invalidate_permission_cache(*, user_id: int | None = None, empresa_id: int | None = None) -> None:
    if user_id is None and empresa_id is None:
        _permission_cache.clear()
        return

    keys_to_remove: list[tuple[int, int]] = []
    for cache_user_id, cache_empresa_id in _permission_cache.keys():
        if user_id is not None and cache_user_id != user_id:
            continue
        if empresa_id is not None and cache_empresa_id != empresa_id:
            continue
        keys_to_remove.append((cache_user_id, cache_empresa_id))

    for key in keys_to_remove:
        _permission_cache.pop(key, None)


def _load_all_active_permission_codes(db: Session) -> set[str]:
    return {
        str(row)
        for row in db.exec(
            select(AccessPermission.code).where(
                AccessPermission.is_deleted == False,
                AccessPermission.is_active == True,
            )
        ).all()
        if row
    }


def _load_permission_codes_for_assignment(
    db: Session,
    *,
    user_id: int,
    empresa_id: int,
) -> set[str]:
    statement = select(AccessPermission.code).where(
        AccessProfilePermission.permission_id == AccessPermission.id,
        AccessProfilePermission.profile_id == AccessProfile.id,
        UserCompanyProfile.profile_id == AccessProfile.id,
        UserCompanyProfile.usuario_id == user_id,
        UserCompanyProfile.empresa_id == empresa_id,
        UserCompanyProfile.is_active == True,
        UserCompanyProfile.is_deleted == False,
        AccessProfile.is_active == True,
        AccessProfile.is_deleted == False,
        AccessProfilePermission.allowed == True,
        AccessProfilePermission.is_deleted == False,
        AccessPermission.is_active == True,
        AccessPermission.is_deleted == False,
    )

    rows = db.exec(statement).all()
    return {str(row) for row in rows if row}


def get_effective_permission_codes(
    db: Session,
    *,
    user_id: int,
    empresa_id: int,
    is_consultor: bool,
    consultor_role: str,
) -> set[str]:
    if _is_super_consultor(is_consultor=is_consultor, consultor_role=consultor_role):
        return {"*"}

    cache_key = (int(user_id), int(empresa_id))
    now = time.time()
    cached = _permission_cache.get(cache_key)
    if cached and cached[0] >= now:
        return set(cached[1])

    permissions = _load_permission_codes_for_assignment(
        db,
        user_id=int(user_id),
        empresa_id=int(empresa_id),
    )

    # Durante a transicao do rollout, fallback para evitar lockout se backfill ainda nao rodou.
    if not permissions:
        permissions = _load_all_active_permission_codes(db)

    _permission_cache[cache_key] = (now + _PERMISSION_CACHE_TTL_SECONDS, set(permissions))
    return permissions


def has_permission(
    db: Session,
    *,
    user_id: int,
    empresa_id: int,
    is_consultor: bool,
    consultor_role: str,
    permission_code: str,
) -> bool:
    permissions = get_effective_permission_codes(
        db,
        user_id=user_id,
        empresa_id=empresa_id,
        is_consultor=is_consultor,
        consultor_role=consultor_role,
    )
    return "*" in permissions or permission_code in permissions


def has_any_permission(
    db: Session,
    *,
    user_id: int,
    empresa_id: int,
    is_consultor: bool,
    consultor_role: str,
    permission_codes: Iterable[str],
) -> bool:
    permissions = get_effective_permission_codes(
        db,
        user_id=user_id,
        empresa_id=empresa_id,
        is_consultor=is_consultor,
        consultor_role=consultor_role,
    )
    if "*" in permissions:
        return True
    for code in permission_codes:
        if code in permissions:
            return True
    return False
