# app/api/deps.py
from typing import Generator
from fastapi import Cookie, Depends, HTTPException, Request, status
from jose import jwt, JWTError
from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import get_session
from app.enums import ConsultorRole
from app.core.audit_context import set_audit_user
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
    set_audit_user(user.id)
    session.info["audit_user_id"] = user.id
    return user

# Funções auxiliares
def get_current_active_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    return current_user

def get_empresa_id_from_user(
    current_user: Usuario = Depends(get_current_user),
    session: Session = Depends(get_session)
) -> int:
    """
    Retorna empresa_id do usuário.
    Para consultores, valida se ele tem acesso à empresa_id atual.
    """
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