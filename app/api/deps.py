# app/api/deps.py
from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import get_session
from app.enums import ConsultorRole
from app.core.audit_context import set_audit_user
from app.models.empresa import Empresa

# Importação de fallback para o Usuario
try:
    from app.models.usuario import Usuario
except ImportError:
    from app.schemas.usuario import UsuarioBase as Usuario

# Define o endpoint de login
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

def get_current_user(
    session: Session = Depends(get_session), 
    token: str = Depends(oauth2_scheme)
) -> Usuario:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
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
                select(ConsultorEmpresa)
                .where(
                    ConsultorEmpresa.usuario_id == current_user.id,
                    ConsultorEmpresa.ativo == True
                )
            ).first()
            
            if first_acesso:
                # Atualiza empresa_id do usuário para a primeira com acesso
                current_user.empresa_id = first_acesso.empresa_id
                session.add(current_user)
                session.commit()
                return first_acesso.empresa_id
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