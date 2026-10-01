# app/services/api_key_service.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, Sequence

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.api_keys import (
    compare_api_key_hash,
    extract_key_prefix,
    generate_api_key,
)
from app.core.config import settings
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.api_key import ApiKey
from app.models.base_audit import utcnow
from app.models.empresa import Empresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.usuario import Usuario
from app.services.access_control_service import (
    get_effective_permission_codes,
    invalidate_permission_cache,
)


def get_profile_permission_codes(db: Session, profile_id: int) -> set[str]:
    """Retorna o conjunto de códigos de permissão ativos concedidos por um perfil de acesso."""
    statement = select(AccessPermission.code).where(
        AccessProfilePermission.permission_id == AccessPermission.id,
        AccessProfilePermission.profile_id == profile_id,
        AccessProfilePermission.allowed == True,
        AccessProfilePermission.is_deleted == False,
        AccessPermission.is_active == True,
        AccessPermission.is_deleted == False,
    )
    rows = db.exec(statement).all()
    return {str(r) for r in rows if r}


def validate_anti_escalation(
    db: Session,
    *,
    creator: Usuario,
    empresa_id: int,
    target_profile_id: int,
) -> None:
    """
    Garante que o criador/atualizador não possa conceder a uma chave de API
    permissões superiores àquelas que ele mesmo possui efetivamente na empresa.
    Super consultores com '*' possuem permissão total irrestrita.
    """
    creator_perms = get_effective_permission_codes(
        db,
        user_id=creator.id,
        empresa_id=empresa_id,
        is_consultor=creator.is_consultor,
        consultor_role=creator.consultor_role,
    )
    if "*" in creator_perms:
        return

    target_perms = get_profile_permission_codes(db, target_profile_id)
    if not target_perms.issubset(creator_perms):
        unauthorized = target_perms - creator_perms
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Regra anti-escalada: Você não pode conceder permissões superiores às suas "
                f"próprias permissões efetivas. Permissões excedentes: {', '.join(sorted(unauthorized))}"
            ),
        )


def _generate_unique_api_key(
    db: Session,
    *,
    environment: Optional[str] = None,
    exclude_key_id: Optional[int] = None,
    max_attempts: int = 5,
) -> tuple[str, str, str]:
    """
    Gera uma tupla (plain_key, key_prefix, key_hash) garantindo prefixo único.
    Trata colisão de key_prefix com retry de até 5 tentativas.
    """
    for _ in range(max_attempts):
        cand_plain, cand_prefix, cand_hash = generate_api_key(environment)
        statement = select(ApiKey.id).where(ApiKey.key_prefix == cand_prefix)
        if exclude_key_id is not None:
            statement = statement.where(ApiKey.id != exclude_key_id)
        if not db.exec(statement).first():
            return cand_plain, cand_prefix, cand_hash

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Falha ao gerar prefixo único de Chave de API após 5 tentativas.",
    )


def create_api_key(
    db: Session,
    *,
    empresa_id: int,
    created_by: Usuario,
    name: str,
    description: Optional[str] = None,
    profile_id: int,
    expires_at: Optional[datetime] = None,
) -> tuple[ApiKey, str]:
    """
    Cria uma nova Chave de API, sua Conta de Serviço 1:1 e respectivo UserCompanyProfile na mesma transação.
    Aplica validação anti-escalada de privilégios.
    Retorna a instância do modelo ApiKey e a chave em texto plano (plain_key).
    """
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome da chave é obrigatório")

    # 1. Validar perfil RBAC: deve pertencer à empresa ou ser template do sistema
    profile = db.exec(
        select(AccessProfile).where(
            AccessProfile.id == profile_id,
            AccessProfile.is_deleted == False,
            AccessProfile.is_active == True,
            (AccessProfile.empresa_id == empresa_id)
            | ((AccessProfile.empresa_id == None) & (AccessProfile.is_template == True)),  # noqa: E711
        )
    ).first()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Perfil de acesso não encontrado, inativo ou indisponível para esta empresa.",
        )

    # 2. Anti-escalada de permissões
    validate_anti_escalation(db, creator=created_by, empresa_id=empresa_id, target_profile_id=profile_id)

    # 3. Cria conta de serviço vinculada à empresa
    service_email = f"apikey+{uuid.uuid4().hex[:16]}@service.kyrus.invalid"
    service_user = Usuario(
        nome=f"Integração: {clean_name}",
        email=service_email,
        hashed_password="!",  # Hash inutilizável
        email_confirmado=True,
        is_active=True,
        is_consultor=False,
        is_service_account=True,
        empresa_id=empresa_id,
        created_by_id=created_by.id,
    )
    db.add(service_user)
    db.flush()

    # 4. Vincula conta de serviço ao perfil RBAC na empresa
    user_company_profile = UserCompanyProfile(
        usuario_id=service_user.id,
        empresa_id=empresa_id,
        profile_id=profile_id,
        is_active=True,
        created_by_id=created_by.id,
    )
    db.add(user_company_profile)
    db.flush()
    # 5. Gera chave, prefixo e hash HMAC (com retry anti-colisão)
    plain_key, key_prefix, key_hash = _generate_unique_api_key(db)
    api_key = ApiKey(
        empresa_id=empresa_id,
        service_user_id=service_user.id,
        name=clean_name,
        description=description.strip() if description else None,
        key_prefix=key_prefix,
        key_hash=key_hash,
        environment="live" if settings.ENVIRONMENT.lower() == "production" else "test",
        profile_id=profile_id,
        expires_at=expires_at,
        created_by_user_id=created_by.id,
        created_by_id=created_by.id,
        is_active=True,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return api_key, plain_key


def authenticate(
    db: Session,
    plain_key: str,
    *,
    client_ip: Optional[str] = None,
) -> tuple[Usuario, int]:
    """
    Autentica uma chave de API:
    - Busca pelo prefixo
    - Compara o hash HMAC em tempo constante
    - Valida status da chave, expiração, empresa e conta de serviço
    - Throttle de 60s para atualizar last_used_at e last_used_ip
    Retorna a tupla (Usuario da conta de serviço, api_key_id).
    Em qualquer inconsistência, retorna erro 401 genérico para evitar enumeração.
    """
    unauthorized_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Chave de API inválida",
        headers={"WWW-Authenticate": "Bearer error=\"invalid_token\""},
    )

    if not plain_key or len(plain_key.strip()) < 16:
        raise unauthorized_exc

    key_prefix = extract_key_prefix(plain_key)
    api_key = db.exec(
        select(ApiKey).where(
            ApiKey.key_prefix == key_prefix,
            ApiKey.is_deleted == False,
        )
    ).first()

    if not api_key:
        raise unauthorized_exc

    if not compare_api_key_hash(plain_key, api_key.key_hash):
        raise unauthorized_exc

    # Validações de integridade da chave
    if not api_key.is_active or api_key.revoked_at is not None:
        raise unauthorized_exc

    now = utcnow()
    if api_key.expires_at is not None and api_key.expires_at < now:
        raise unauthorized_exc

    # Validação da empresa
    empresa = db.get(Empresa, api_key.empresa_id)
    if not empresa or not empresa.is_active or empresa.is_deleted:
        raise unauthorized_exc

    # Validação da conta de serviço
    service_user = db.get(Usuario, api_key.service_user_id)
    if not service_user or not service_user.is_active or not service_user.is_service_account or service_user.is_deleted:
        raise unauthorized_exc

    # Atualização com throttle de 60s de last_used_at/ip
    if not api_key.last_used_at or (now - api_key.last_used_at).total_seconds() >= 60:
        api_key.last_used_at = now
        api_key.last_used_ip = client_ip[:64] if client_ip else None
        db.add(api_key)
        try:
            db.commit()
        except Exception:
            db.rollback()

    return service_user, api_key.id


def revoke_api_key(
    db: Session,
    *,
    key_id: int,
    empresa_id: int,
    revoked_by: Usuario,
) -> ApiKey:
    """
    Revoga uma Chave de API e desativa imediatamente sua conta de serviço correspondente.
    Invalida o cache de permissões.
    """
    api_key = db.exec(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.empresa_id == empresa_id,
            ApiKey.is_deleted == False,
        )
    ).first()

    if not api_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chave de API não encontrada")

    now = utcnow()
    api_key.is_active = False
    api_key.revoked_at = now
    api_key.revoked_by_user_id = revoked_by.id
    api_key.updated_by_id = revoked_by.id
    api_key.updated_at = now

    service_user = db.get(Usuario, api_key.service_user_id)
    if service_user:
        service_user.is_active = False
        service_user.updated_at = now
        service_user.updated_by_id = revoked_by.id
        db.add(service_user)

    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    invalidate_permission_cache(user_id=api_key.service_user_id, empresa_id=empresa_id)
    return api_key


def rotate_api_key(
    db: Session,
    *,
    key_id: int,
    empresa_id: int,
    rotated_by: Usuario,
) -> tuple[ApiKey, str]:
    """
    Rotaciona o segredo de uma Chave de API ativa, mantendo o perfil e a conta de serviço.
    A chave anterior deixa de funcionar instantaneamente.
    Retorna a instância atualizada e o novo segredo em texto puro (plain_key) uma única vez.
    """
    api_key = db.exec(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.empresa_id == empresa_id,
            ApiKey.is_deleted == False,
        )
    ).first()

    if not api_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chave de API não encontrada")

    if not api_key.is_active or api_key.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível rotacionar uma chave inativa ou revogada.",
        )

    now = utcnow()
    plain_key, key_prefix, key_hash = _generate_unique_api_key(
        db, environment=api_key.environment, exclude_key_id=api_key.id
    )
    api_key.key_prefix = key_prefix
    api_key.key_hash = key_hash
    api_key.updated_by_id = rotated_by.id
    api_key.updated_at = now

    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return api_key, plain_key


def update_api_key(
    db: Session,
    *,
    key_id: int,
    empresa_id: int,
    updated_by: Usuario,
    name: Optional[str] = None,
    description: Optional[str] = None,
    profile_id: Optional[int] = None,
    expires_at: Optional[datetime] = None,
) -> ApiKey:
    """
    Atualiza metadados ou perfil RBAC de uma Chave de API.
    Aplica anti-escalada caso o perfil esteja sendo alterado.
    """
    api_key = db.exec(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.empresa_id == empresa_id,
            ApiKey.is_deleted == False,
        )
    ).first()

    if not api_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chave de API não encontrada")

    if not api_key.is_active or api_key.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Não é possível atualizar uma chave inativa ou revogada.",
        )

    now = utcnow()

    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome não pode ser vazio")
        api_key.name = clean_name
        service_user = db.get(Usuario, api_key.service_user_id)
        if service_user:
            service_user.nome = f"Integração: {clean_name}"
            db.add(service_user)

    if description is not None:
        api_key.description = description.strip() if description else None

    if expires_at is not None:
        api_key.expires_at = expires_at

    if profile_id is not None and profile_id != api_key.profile_id:
        profile = db.exec(
            select(AccessProfile).where(
                AccessProfile.id == profile_id,
                AccessProfile.is_deleted == False,
                AccessProfile.is_active == True,
                (AccessProfile.empresa_id == empresa_id)
                | ((AccessProfile.empresa_id == None) & (AccessProfile.is_template == True)),  # noqa: E711
            )
        ).first()

        if not profile:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Perfil de acesso informado não encontrado ou inativo.",
            )

        validate_anti_escalation(db, creator=updated_by, empresa_id=empresa_id, target_profile_id=profile_id)
        api_key.profile_id = profile_id

        # Atualiza o UserCompanyProfile da conta de serviço
        ucp = db.exec(
            select(UserCompanyProfile).where(
                UserCompanyProfile.usuario_id == api_key.service_user_id,
                UserCompanyProfile.empresa_id == empresa_id,
                UserCompanyProfile.is_deleted == False,
            )
        ).first()
        if ucp:
            ucp.profile_id = profile_id
            ucp.updated_at = now
            ucp.updated_by_id = updated_by.id
            db.add(ucp)

        invalidate_permission_cache(user_id=api_key.service_user_id, empresa_id=empresa_id)

    api_key.updated_at = now
    api_key.updated_by_id = updated_by.id

    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return api_key
