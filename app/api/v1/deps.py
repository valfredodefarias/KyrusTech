# app/api/v1/deps.py

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import ValidationError # Adicionado para tratar erros de validação
from sqlmodel import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.usuario import Usuario
from app.crud.crud_usuario import get_by_email

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_current_user(
    db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)
) -> Usuario:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=["HS256"]
        )
        email = payload.get("sub")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token inválido: credenciais não encontradas."
            )
    except (JWTError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Não foi possível validar as credenciais",
        )
    
    user = get_by_email(db, email=email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return user

# --- ESTA É A FUNÇÃO QUE FALTAVA ---
def get_current_active_user(
    current_user: Usuario = Depends(get_current_user),
) -> Usuario:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Usuário inativo")
    return current_user
# -----------------------------------

def get_empresa_id_from_user(
    # Melhoria de segurança: Depende do usuário ATIVO, não apenas logado
    current_user: Usuario = Depends(get_current_active_user),
) -> int:
    return current_user.empresa_id