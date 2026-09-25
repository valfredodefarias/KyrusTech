# app/api/deps.py
from typing import Generator, Any
from fastapi import Cookie, Depends, HTTPException, Request, status, Header
from jose import jwt, JWTError
from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session, select
from datetime import datetime
from app.models.idempotency_log import IdempotencyLog

from app.core.config import settings
from app.db.session import get_session
from app.enums import ConsultorRole
from app.core.audit_context import set_audit_user, set_audit_empresa
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
    session: Session = Depends(get_session),
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME)
) -> Usuario:
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Não autenticado",
        )

    try:
        payload = jwt.decode(
            access_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
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
        from datetime import datetime
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

def get_empresa_id_from_user(
    request: Request = None,
    current_user: Usuario = Depends(get_current_user),
    session: Session = Depends(get_session)
) -> int:
    """
    Retorna empresa_id do usuário.
    Tenta obter o X-Company-ID enviado pelo cabeçalho da requisição para suportar multi-abas de consultores.
    Se não for fornecido ou for inválido, cai de volta para o empresa_id salvo no banco.
    """
    # 1. Verifica se foi enviado cabeçalho X-Company-ID
    if request:
        header_company_id = request.headers.get("x-company-id")
        if header_company_id and header_company_id.isdigit():
            empresa_id = int(header_company_id)
            
            # Valida se o usuário tem autorização para esta empresa
            if current_user.is_consultor:
                if current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
                    return empresa_id
                
                from app.crud.crud_consultor_empresa import tem_acesso
                if tem_acesso(session, current_user.id, empresa_id):
                    return empresa_id
            else:
                if current_user.empresa_id == empresa_id:
                    return empresa_id
                
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
                    return empresa_id

    # 2. Fallback para o comportamento padrão do banco
    if current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
        # Super consultor/admin pode operar qualquer empresa
        if current_user.empresa_id:
            return current_user.empresa_id
        # Se não houver empresa setada, usa a primeira empresa existente como fallback
        first_empresa_id = session.exec(select(Empresa.id).order_by(Empresa.id)).first()
        if first_empresa_id:
            return int(first_empresa_id)
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
                return int(first_acesso)
            else:
                raise HTTPException(
                    status_code=403,
                    detail="Consultor não tem acesso a nenhuma empresa"
                )
    
    return current_user.empresa_id

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
    current_user: Usuario = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> set[str]:
    empresa_id = get_empresa_id_from_user(current_user=current_user, session=session)
    if not current_user.id or not empresa_id:
        return set()

    return get_effective_permission_codes(
        session,
        user_id=int(current_user.id),
        empresa_id=int(empresa_id),
        is_consultor=bool(current_user.is_consultor),
        consultor_role=str(current_user.consultor_role or ""),
    )


def require_permission(permission_code: str):
    def _dependency(
        request: Request,
        current_user: Usuario = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> Usuario:
        empresa_id = get_empresa_id_from_user(current_user=current_user, session=session)
        if not current_user.id or not empresa_id:
            raise HTTPException(status_code=403, detail="Contexto de permissao invalido")

        allowed = has_permission(
            session,
            user_id=int(current_user.id),
            empresa_id=int(empresa_id),
            is_consultor=bool(current_user.is_consultor),
            consultor_role=str(current_user.consultor_role or ""),
            permission_code=permission_code,
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
        empresa_id = get_empresa_id_from_user(current_user=current_user, session=session)
        if not current_user.id or not empresa_id:
            raise HTTPException(status_code=403, detail="Contexto de permissao invalido")

        allowed = has_any_permission(
            session,
            user_id=int(current_user.id),
            empresa_id=int(empresa_id),
            is_consultor=bool(current_user.is_consultor),
            consultor_role=str(current_user.consultor_role or ""),
            permission_codes=permission_codes,
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
    session: Session = Depends(get_session),
    x_idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
) -> str | None:
    if not x_idempotency_key:
        yield None
        return

    # Buscar chave existente no banco
    log = session.exec(select(IdempotencyLog).where(IdempotencyLog.idempotency_key == x_idempotency_key)).first()
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
        # Criar novo registro de idempotência com status processing
        log = IdempotencyLog(
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