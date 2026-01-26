# app/api/deps.py
from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import get_session

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
        
    return user

# Funções auxiliares
def get_current_active_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    return current_user

def get_empresa_id_from_user(current_user: Usuario = Depends(get_current_user)) -> int:
    return current_user.empresa_id

def get_consultor_user(current_user: Usuario = Depends(get_current_user)) -> Usuario:
    if not current_user.is_consultor:
        raise HTTPException(status_code=403, detail="Acesso restrito a consultores")
    return current_user