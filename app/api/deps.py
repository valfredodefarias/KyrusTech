# app/api/deps.py
from typing import Generator, Any
from fastapi import Cookie, Depends, HTTPException, Request, status, Header
from jose import jwt, JWTError
from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session, select, or_
from datetime import datetime
from app.models.idempotency_log import IdempotencyLog

from app.core.config import settings
from app.db.session import get_session
from app.enums import ConsultorRole
from app.core.audit_context import set_audit_user, set_audit_empresa, set_audit_api_key
from app.core.api_keys import is_api_key
from app.core.network import get_client_ip
from app.core.public_api import is_public_route
from app.services import api_key_service
from app.models.empresa import Empresa
from app.services.access_control_service import (
    get_effective_permission_codes,
    has_any_permission,
    has_permission,
)

# Importação de fallback para o Usuario
try:
    from app.models.usuario import Usuario
except ImportError:
    from app.schemas.usuario import UsuarioBase as Usuario

def get_current_user(
    request: Request = None,
    session: Session = Depends(get_session),
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
) -> Usuario:
    if request is None:
        from app.core.audit_context import get_current_http_request
        request = get_current_http_request()

    # 1. Determinação de autenticação: Chave de API EXCLUSIVAMENTE por header (X-Api-Key ou Authorization: Bearer)
    api_key_candidate: str | None = None
    if x_api_key and is_api_key(x_api_key):
        api_key_candidate = x_api_key.strip()
    elif authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer" and is_api_key(parts[1]):
            api_key_candidate = parts[1].strip()
        elif is_api_key(authorization):
            api_key_candidate = authorization.strip()

    if api_key_candidate:
        # Autenticação estrutural via Chave de API usando IP confiável via get_client_ip
        client_ip = get_client_ip(request) if request else None

        service_user, api_key_id = api_key_service.authenticate(session, api_key_candidate, client_ip=client_ip)

        # Guard de superfície pública: bloqueia endpoints internos/perigosos para chaves de API
        if request and "route" in request.scope:
            route = request.scope["route"]
            tags = getattr(route, "tags", [])
            openapi_extra = getattr(route, "openapi_extra", None)
            if not is_public_route(tags, openapi_extra):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Este endpoint não está disponível para chaves de API",
                )

        set_audit_user(service_user.id)
        set_audit_empresa(service_user.empresa_id)
        set_audit_api_key(api_key_id)
        session.info["audit_user_id"] = service_user.id
        session.info["audit_empresa_id"] = service_user.empresa_id
        session.info["audit_api_key_id"] = api_key_id
        return service_user

    # 2. Fluxo JWT padrão (usuários humanos)
    token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
    if not token:
        token = access_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Não autenticado",
        )

    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        token_sub = payload.get("sub")
        sid = payload.get("sid")
        if not token_sub:
            raise HTTPException(status_code=403, detail="Token inválido")
    except (JWTError, ValidationError):
        raise HTTPException(status_code=403, detail="Credenciais inválidas")

    # Busca usuário por Email ou ID
    user = session.exec(select(Usuario).where(Usuario.email == token_sub)).first()
    if not user and str(token_sub).isdigit():
         user = session.get(Usuario, int(token_sub))
    
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if getattr(user, "is_deleted", False):
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Usuário inativo")
    if getattr(user, "is_service_account", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Contas de serviço não podem ser autenticadas via JWT",
        )

    # Validar sessão
    if sid:
        from app.models.user_session import UserSession
        sess = session.exec(
            select(UserSession).where(
                UserSession.session_id == sid,
                UserSession.user_id == user.id
            )
        ).first()
        if not sess or not sess.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sessão ativa em outro dispositivo"
            )
        
        # Atualizar última atividade com throttling de 5 minutos (300s)
        now = datetime.utcnow()
        if not sess.last_activity_at or (now - sess.last_activity_at).total_seconds() > 300:
            sess.last_activity_at = now
            session.add(sess)
            session.commit()

    set_audit_user(user.id)
    session.info["audit_user_id"] = user.id
    if getattr(user, "empresa_id", None):
        set_audit_empresa(user.empresa_id)
        session.info["audit_empresa_id"] = user.empresa_id
    return user

# Funções auxiliares
def get_current_active_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    return current_user

def get_human_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Garante que a rota só possa ser executada por usuários humanos, rejeitando contas de serviço."""
    if getattr(current_user, "is_service_account", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operação restrita a usuários humanos. Chaves de API não têm permissão para esta funcionalidade.",
        )
    return current_user

def get_empresa_id_from_user(
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    session: Session = Depends(get_session)
) -> int:
    """
    Retorna empresa_id do usuário.
    Para contas de serviço (Chaves de API): SEMPRE retorna current_user.empresa_id.
    Se for enviado X-Company-ID divergente da empresa da chave -> 403.
    Para consultores: suporta X-Company-ID para multi-abas.
    """
    if request is None:
        from app.core.audit_context import get_current_http_request
        request = get_current_http_request()

    def _sync_audit(eid: int) -> int:
        set_audit_empresa(eid)
        if session and hasattr(session, "info"):
            session.info["audit_empresa_id"] = eid
        return eid

    # Contas de serviço pertencem estritamente a uma única empresa
    if getattr(current_user, "is_service_account", False):
        if request:
            header_company_id = request.headers.get("x-company-id")
            if header_company_id and header_company_id.isdigit():
                if int(header_company_id) != current_user.empresa_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Chaves de API não podem acessar dados de outra empresa via X-Company-ID.",
                    )
        return _sync_audit(current_user.empresa_id)

    # 1. Verifica se foi enviado cabeçalho X-Company-ID
    if request:
        header_company_id = request.headers.get("x-company-id")
        if header_company_id and header_company_id.isdigit():
            empresa_id = int(header_company_id)
            
            # Valida se o usuário tem autorização para esta empresa
            if current_user.is_consultor:
                if current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
                    return _sync_audit(empresa_id)
                
                from app.crud.crud_consultor_empresa import tem_acesso
                if tem_acesso(session, current_user.id, empresa_id):
                    return _sync_audit(empresa_id)
            else:
                if current_user.empresa_id == empresa_id:
                    return _sync_audit(empresa_id)
                
                from app.models.user_company_profile import UserCompanyProfile
                has_profile = session.exec(
                    select(UserCompanyProfile)
                    .where(
                        UserCompanyProfile.usuario_id == current_user.id,
                        UserCompanyProfile.empresa_id == empresa_id,
                        UserCompanyProfile.is_active == True,
                        UserCompanyProfile.is_deleted == False
                    )
                ).first()
                if has_profile:
                    return _sync_audit(empresa_id)

    # 2. Fallback para o comportamento padrão do banco
    if current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
        # Super consultor/admin pode operar qualquer empresa
        if current_user.empresa_id:
            return _sync_audit(current_user.empresa_id)
        # Se não houver empresa setada, usa a primeira empresa existente como fallback
        first_empresa_id = session.exec(select(Empresa.id).order_by(Empresa.id)).first()
        if first_empresa_id:
            return _sync_audit(int(first_empresa_id))
        raise HTTPException(status_code=404, detail="Nenhuma empresa cadastrada")

    if current_user.is_consultor:
        # Validar que o consultor tem acesso a essa empresa
        from app.crud.crud_consultor_empresa import tem_acesso
        if not tem_acesso(session, current_user.id, current_user.empresa_id):
            # Se não tem acesso, tenta usar a primeira empresa disponível
            from app.models.consultor_empresa import ConsultorEmpresa
            first_acesso = session.exec(
                select(ConsultorEmpresa.empresa_id)
                .where(
                    ConsultorEmpresa.usuario_id == current_user.id,
                    ConsultorEmpresa.ativo == True
                )
            ).first()
            
            if first_acesso:
                # Atualiza empresa_id do usuário para a primeira com acesso
                current_user.empresa_id = int(first_acesso)
                session.add(current_user)
                session.commit()
                return _sync_audit(int(first_acesso))
            else:
                raise HTTPException(
                    status_code=403,
                    detail="Consultor não tem acesso a nenhuma empresa"
                )
    
    return _sync_audit(current_user.empresa_id)

def get_consultor_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    if not current_user.is_consultor:
        raise HTTPException(status_code=403, detail="Acesso restrito a consultores")
    return current_user


def get_super_consultor_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    """Retorna o usuário se for super consultor."""
    from app.enums import ConsultorRole
    if not current_user.is_consultor or current_user.consultor_role != ConsultorRole.SUPER_CONSULTOR.value:
        raise HTTPException(
            status_code=403,
            detail="Acesso restrito a super consultores"
        )
    return current_user


def get_current_user_permission_codes(
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> set[str]:
    empresa_id = get_empresa_id_from_user(request=request, current_user=current_user, session=session)
    if not current_user.id or not empresa_id:
        return set()

    return get_effective_permission_codes(
        session,
        user_id=int(current_user.id),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
        is_service_account=bool(getattr(current_user, "is_service_account", False)),
    )


def require_permission(permission_code: str):
    def _dependency(
        request: Request,
        current_user: Usuario = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> Usuario:
        empresa_id = get_empresa_id_from_user(request=request, current_user=current_user, session=session)
        if not current_user.id or not empresa_id:
            raise HTTPException(status_code=403, detail="Contexto de permissao invalido")

        allowed = has_permission(
            session,
            user_id=int(current_user.id),
            empresa_id=int(empresa_id),
            is_consultor=bool(current_user.is_consultor),
            consultor_role=str(current_user.consultor_role or ""),
            permission_code=permission_code,
            is_service_account=bool(getattr(current_user, "is_service_account", False)),
        )
        if allowed:
            return current_user

        logger.warning(
            f"[AUTHZ] negado endpoint={request.url.path} user_id={current_user.id} "
            f"empresa_id={empresa_id} permissao={permission_code}"
        )
        raise HTTPException(status_code=403, detail=f"Permissao necessaria: {permission_code}")

    return _dependency


def require_any_permission(permission_codes: list[str] | tuple[str, ...]):
    permission_codes = [code for code in permission_codes if code]

    def _dependency(
        request: Request,
        current_user: Usuario = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> Usuario:
        empresa_id = get_empresa_id_from_user(request=request, current_user=current_user, session=session)
        if not current_user.id or not empresa_id:
            raise HTTPException(status_code=403, detail="Contexto de permissao invalido")

        allowed = has_any_permission(
            session,
            user_id=int(current_user.id),
            empresa_id=int(empresa_id),
            is_consultor=bool(current_user.is_consultor),
            consultor_role=str(current_user.consultor_role or ""),
            permission_codes=permission_codes,
            is_service_account=bool(getattr(current_user, "is_service_account", False)),
        )
        if allowed:
            return current_user

        logger.warning(
            f"[AUTHZ] negado endpoint={request.url.path} user_id={current_user.id} "
            f"empresa_id={empresa_id} permissoes={','.join(permission_codes)}"
        )
        raise HTTPException(status_code=403, detail="Permissao insuficiente para este recurso")

    return _dependency


class IdempotencyCompletedException(Exception):
    def __init__(self, response_body: Any):
        self.response_body = response_body


async def check_idempotency(
    request: Request,
    session: Session = Depends(get_session),
    empresa_id: int = Depends(get_empresa_id_from_user),
) -> str | None:
    raw_key = (
        request.headers.get("idempotency-key")
        or request.headers.get("x-idempotency-key")
    )
    if not raw_key:
        yield None
        return

    x_idempotency_key = raw_key.strip()
    if not x_idempotency_key:
        yield None
        return

    # Buscar chave existente no banco com escopo por empresa
    log = session.exec(
        select(IdempotencyLog).where(
            IdempotencyLog.idempotency_key == x_idempotency_key,
            or_(IdempotencyLog.empresa_id == empresa_id, IdempotencyLog.empresa_id == None),
        )
    ).first()
    if log:
        if log.status == "processing":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Aguarde o processamento"
            )
        elif log.status == "completed":
            raise IdempotencyCompletedException(log.response_body)
        
        # Se for failed, tentar novamente: atualiza para processing
        log.status = "processing"
        log.updated_at = datetime.utcnow()
        session.add(log)
        session.commit()
    else:
        # Criar novo registro de idempotência com status processing para a empresa atual
        log = IdempotencyLog(
            empresa_id=empresa_id,
            idempotency_key=x_idempotency_key,
            status="processing",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        session.add(log)
        session.commit()

    try:
        yield x_idempotency_key
    except Exception as e:
        # Se ocorrer uma exceção não tratada na rota, marca como failed para tentar novamente mais tarde
        session.rollback()
        log.status = "failed"
        log.updated_at = datetime.utcnow()
        session.add(log)
        session.commit()
        raise e