# app/api/v1/endpoints/usuarios.py

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pathlib import Path
from uuid import uuid4
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
from app.crud.crud_usuario import create_user
from app.schemas.usuario import UserCreate, UserRead
from app.api.v1.deps import get_current_active_user
from app.models.usuario import Usuario

UPLOAD_DIR = Path("static/uploads/usuarios")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

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


@router.post("/me/foto", response_model=UserRead)
def upload_foto_me(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    file: UploadFile = File(...),
):
    """Atualiza foto do usuário logado."""
    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = {".png", ".jpg", ".jpeg", ".webp"}
    if not ext or ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Formato de imagem não suportado. Use png, jpg, jpeg ou webp.",
        )

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Arquivo inválido para imagem.")

    filename = f"usuario_{current_user.id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename

    max_size = 2 * 1024 * 1024  # 2MB
    bytes_written = 0
    with filepath.open("wb") as buffer:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            bytes_written += len(chunk)
            if bytes_written > max_size:
                buffer.close()
                filepath.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
            buffer.write(chunk)

    # Remove foto anterior se for local
    old_url = current_user.foto_url
    if old_url and "/static/uploads/usuarios/" in old_url:
        try:
            old_path = Path(old_url.split("/static/")[-1])
            old_file = Path("static") / old_path
            old_file.unlink(missing_ok=True)
        except Exception:
            pass

    relative_path = f"/static/uploads/usuarios/{filename}"
    current_user.foto_url = relative_path
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.delete("/me/foto", response_model=UserRead)
def delete_foto_me(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Remove foto do usuário logado."""
    old_url = current_user.foto_url
    if old_url and "/static/uploads/usuarios/" in old_url:
        try:
            old_path = Path(old_url.split("/static/")[-1])
            old_file = Path("static") / old_path
            old_file.unlink(missing_ok=True)
        except Exception:
            pass

    current_user.foto_url = None
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user