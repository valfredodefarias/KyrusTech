# app/api/v1/endpoints/usuarios.py

from fastapi import APIRouter, Depends
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
from app.crud.crud_usuario import create_user
from app.schemas.usuario import UserCreate, UserRead
from app.api.v1.deps import get_current_active_user

router = APIRouter()

@router.post("/", response_model=UserRead, status_code=201)
def create(
    *,
    db: Session = Depends(get_db), 
    user_in: UserCreate
):
    """Cria um novo usuário vinculado a uma empresa."""
    logger.info(f"Recebida requisição para criar usuário: {user_in.email} para empresa ID: {user_in.empresa_id}")
    
    # Futuramente: Adicionar verificação se email já existe
    
    user = create_user(db=db, user_in=user_in)
    
    logger.success(f"Usuário '{user.email}' criado com sucesso com ID: {user.id}")
    return user

@router.get("/me", response_model=UserRead)
def read_user_me(
    current_user: UserRead = Depends(get_current_active_user),
):
    """Retorna os dados do usuário logado (usado pelo frontend para saber quem está acessando)."""
    return current_user