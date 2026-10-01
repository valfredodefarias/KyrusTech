# app/api/v1/endpoints/api_keys.py
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.v1.deps import (
    get_empresa_id_from_user,
    get_human_user,
    require_permission,
)
from app.core.api_keys import mask_api_key
from app.db.session import get_db
from app.models.access_profile import AccessProfile
from app.models.api_key import ApiKey
from app.models.usuario import Usuario
from app.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreatedResponse,
    ApiKeyProfileOption,
    ApiKeyRead,
    ApiKeyUpdate,
)
from app.services import api_key_service
from app.services.access_control_service import get_effective_permission_codes

router = APIRouter(
    prefix="/api-keys",
    tags=["Chaves de API"],
    include_in_schema=False,
    dependencies=[
        Depends(get_human_user),
        Depends(require_permission("config.api_keys.manage")),
    ],
)


def _serialize_api_key(api_key: ApiKey, db: Session, key: Optional[str] = None) -> dict:
    profile = db.get(AccessProfile, api_key.profile_id)
    creator = db.get(Usuario, api_key.created_by_user_id)
    data = {
        "id": api_key.id,
        "empresa_id": api_key.empresa_id,
        "name": api_key.name,
        "description": api_key.description,
        "key_prefix": api_key.key_prefix,
        "masked_key": mask_api_key(api_key.key_prefix),
        "environment": api_key.environment,
        "profile_id": api_key.profile_id,
        "profile_name": profile.name if profile else None,
        "expires_at": api_key.expires_at,
        "last_used_at": api_key.last_used_at,
        "last_used_ip": api_key.last_used_ip,
        "revoked_at": api_key.revoked_at,
        "is_active": api_key.is_active,
        "created_by_user_id": api_key.created_by_user_id,
        "created_by_name": creator.nome or creator.email if creator else None,
        "created_at": api_key.created_at,
        "updated_at": api_key.updated_at,
    }
    if key is not None:
        data["key"] = key
    return data


@router.get("", response_model=List[ApiKeyRead])
@router.get("/", response_model=List[ApiKeyRead], include_in_schema=False)
def list_api_keys(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista todas as chaves de API da empresa atual, com mascaramento de segredo."""
    keys = db.exec(
        select(ApiKey)
        .where(
            ApiKey.empresa_id == empresa_id,
            ApiKey.is_deleted == False,
        )
        .order_by(ApiKey.is_active.desc(), ApiKey.created_at.desc())
    ).all()

    return [_serialize_api_key(k, db) for k in keys]


@router.get("/profiles", response_model=List[ApiKeyProfileOption])
def list_allowed_profiles(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_human_user),
):
    """
    Retorna os perfis RBAC disponíveis para atribuição a chaves de API,
    filtrados rigorosamente pela regra anti-escalada.
    """
    creator_perms = get_effective_permission_codes(
        db,
        user_id=current_user.id,
        empresa_id=empresa_id,
        is_consultor=current_user.is_consultor,
        consultor_role=current_user.consultor_role,
    )
    is_super = "*" in creator_perms

    profiles = db.exec(
        select(AccessProfile).where(
            AccessProfile.is_deleted == False,
            AccessProfile.is_active == True,
            (AccessProfile.empresa_id == empresa_id)
            | ((AccessProfile.empresa_id == None) & (AccessProfile.is_template == True)),  # noqa: E711
        )
    ).all()

    options: List[ApiKeyProfileOption] = []
    for p in profiles:
        p_perms = api_key_service.get_profile_permission_codes(db, p.id)
        if not is_super and not p_perms.issubset(creator_perms):
            continue

        options.append(
            ApiKeyProfileOption(
                id=p.id,
                name=p.name,
                description=p.description,
                is_template=bool(p.is_template),
                permissions_count=len(p_perms),
            )
        )

    options.sort(key=lambda x: (not x.is_template, x.name))
    return options


@router.post("", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_api_key(
    payload: ApiKeyCreate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_human_user),
):
    """
    Cria uma nova Chave de API e respectiva conta de serviço.
    Retorna a chave em texto plano uma única vez no campo `key`.
    """
    api_key, plain_key = api_key_service.create_api_key(
        db,
        empresa_id=empresa_id,
        created_by=current_user,
        name=payload.name,
        description=payload.description,
        profile_id=payload.profile_id,
        expires_at=payload.expires_at,
    )
    return _serialize_api_key(api_key, db, key=plain_key)


@router.patch("/{key_id}", response_model=ApiKeyRead)
def update_api_key(
    key_id: int,
    payload: ApiKeyUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_human_user),
):
    """Atualiza metadados ou perfil RBAC de uma Chave de API existente."""
    api_key = api_key_service.update_api_key(
        db,
        key_id=key_id,
        empresa_id=empresa_id,
        updated_by=current_user,
        name=payload.name,
        description=payload.description,
        profile_id=payload.profile_id,
        expires_at=payload.expires_at,
    )
    return _serialize_api_key(api_key, db)


@router.post("/{key_id}/rotate", response_model=ApiKeyCreatedResponse)
def rotate_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_human_user),
):
    """
    Gera um novo segredo para a chave de API mantendo permissões e conta de serviço.
    A chave anterior é revogada imediatamente.
    """
    api_key, plain_key = api_key_service.rotate_api_key(
        db,
        key_id=key_id,
        empresa_id=empresa_id,
        rotated_by=current_user,
    )
    return _serialize_api_key(api_key, db, key=plain_key)


@router.delete("/{key_id}", response_model=ApiKeyRead)
def revoke_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_human_user),
):
    """Revoga a Chave de API e inativa sua respectiva conta de serviço."""
    api_key = api_key_service.revoke_api_key(
        db,
        key_id=key_id,
        empresa_id=empresa_id,
        revoked_by=current_user,
    )
    return _serialize_api_key(api_key, db)
