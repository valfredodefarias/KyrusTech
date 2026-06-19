# app/core/security.py
# VERSÃO ATUALIZADA COM O TIPO CORRETO

from datetime import datetime, timedelta, timezone
from typing import Any, Union, Optional # <-- Correção aqui

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

# Contexto do Hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Código para JWT
ALGORITHM = "HS256"

def create_access_token(
    subject: Union[str, Any], expires_delta: Optional[timedelta] = None, session_id: Optional[str] = None
) -> str:
    """
    Cria um token de acesso JWT.
    """
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        # Usa o tempo de expiração padrão do arquivo .env
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    
    to_encode = {"exp": expire, "sub": str(subject)}
    if session_id:
        to_encode["sid"] = session_id
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token_expiration(access_token: str) -> datetime:
    """Retorna a data de expiração embutida no JWT de acesso."""
    payload = jwt.decode(access_token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    expires_at = payload.get("exp")
    if expires_at is None:
        raise ValueError("Token sem expiração")
    if isinstance(expires_at, datetime):
        return expires_at.astimezone(timezone.utc)
    return datetime.fromtimestamp(float(expires_at), tz=timezone.utc)

# Funções de Senha
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica se uma senha em texto puro corresponde a um hash."""
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    """Gera o hash de uma senha em texto puro."""
    return pwd_context.hash(password)