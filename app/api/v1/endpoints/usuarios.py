# app/api/v1/endpoints/usuarios.py

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from loguru import logger
from sqlmodel import Session

from app.api.v1.deps import get_consultor_user, get_current_active_user, get_empresa_id_from_user
from app.core.upload_security import IMAGE_ALLOWED_EXT_TO_MIME, UploadValidationError, safe_local_path_from_static_url, write_validated_upload_file
from app.crud.crud_usuario import create_user
from app.db.session import get_db
from app.enums import ConsultorRole
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.schemas.usuario import UserCreate, UserRead

UPLOAD_DIR = Path("static/uploads/usuarios")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()


@router.post("/", response_model=UserRead, status_code=201)
def create(
    *,
    db: Session = Depends(get_db),
    user_in: UserCreate,
    current_user: Usuario = Depends(get_consultor_user),
):
    """Cria um novo usuário vinculado a uma empresa."""
    logger.info(f"Recebida requisição para criar usuário: {user_in.email} para empresa ID: {user_in.empresa_id}")

    payload = user_in.model_copy(deep=True)

    if current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
        if payload.consultor_role not in {
            ConsultorRole.USUARIO_NORMAL.value,
            ConsultorRole.CONSULTOR.value,
            ConsultorRole.SUPER_CONSULTOR.value,
        }:
            raise HTTPException(status_code=400, detail="consultor_role inválido.")
        if not payload.is_consultor:
            payload.consultor_role = ConsultorRole.USUARIO_NORMAL.value
        payload.is_superuser = False
    else:
        if payload.is_consultor:
            raise HTTPException(status_code=403, detail="Somente super consultor pode criar consultores.")
        empresa_contexto = get_empresa_id_from_user(current_user=current_user, session=db)
        if payload.empresa_id not in (None, empresa_contexto):
            raise HTTPException(status_code=403, detail="Você não pode criar usuários fora da empresa em contexto.")

        payload.empresa_id = empresa_contexto
        payload.is_consultor = False
        payload.is_superuser = False
        payload.consultor_role = ConsultorRole.USUARIO_NORMAL.value

    if payload.empresa_id is not None:
        empresa = db.get(Empresa, payload.empresa_id)
        if not empresa or empresa.is_deleted:
            raise HTTPException(status_code=404, detail="A empresa informada não existe mais ou foi removida.")

    try:
        user = create_user(db=db, user_in=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    logger.success(f"Usuário '{user.email}' criado com sucesso com ID: {user.id}")
    return user


@router.get("/me", response_model=UserRead)
def read_user_me(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna os dados do usuário logado (usado pelo frontend para saber quem está acessando)."""
    user_data = UserRead.model_validate(current_user)

    if current_user.is_consultor:
        try:
            user_data.empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
        except HTTPException:
            user_data.empresa_id = current_user.empresa_id

    return user_data


@router.post("/me/foto", response_model=UserRead)
def upload_foto_me(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    file: UploadFile = File(...),
):
    """Atualiza foto do usuário logado."""
    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = set(IMAGE_ALLOWED_EXT_TO_MIME.keys())
    if not ext or ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Formato de imagem não suportado. Use png, jpg, jpeg, webp ou gif.",
        )

    filename = f"usuario_{current_user.id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename

    max_size = 2 * 1024 * 1024
    try:
        write_validated_upload_file(
            upload=file,
            destination=filepath,
            max_size=max_size,
            allowed_ext_to_mime=IMAGE_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        if exc.status_code == 413:
            raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    old_local = safe_local_path_from_static_url(
        str(current_user.foto_url or ""),
        required_prefix="/static/uploads/usuarios/",
    )
    if old_local:
        old_local.unlink(missing_ok=True)

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
    old_local = safe_local_path_from_static_url(
        str(current_user.foto_url or ""),
        required_prefix="/static/uploads/usuarios/",
    )
    if old_local:
        old_local.unlink(missing_ok=True)

    current_user.foto_url = None
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user