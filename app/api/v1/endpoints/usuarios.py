# app/api/v1/endpoints/usuarios.py

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Request
from loguru import logger
from sqlmodel import Session, select, or_
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_consultor_user, get_current_active_user, get_empresa_id_from_user, require_permission
from app.core.upload_security import IMAGE_ALLOWED_EXT_TO_MIME, UploadValidationError, safe_local_path_from_static_url, write_validated_upload_file
from app.crud.crud_usuario import create_user
from app.db.session import get_db
from app.enums import ConsultorRole, PdvPermission
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.empresa import Empresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.schemas.usuario import UserCreate, UserRead, UserUpdate
from app.services.access_control_service import get_effective_permission_codes, invalidate_permission_cache

UPLOAD_DIR = Path("static/uploads/usuarios")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()


@router.get(
    "/vendedores",
    response_model=list[UserRead],
)
def list_vendedores(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Retorna todos os usuários ativos da empresa que não são consultores, excluindo o usuário fictício Loja."""
    vendedores = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == empresa_id,
            Usuario.is_active == True,
            Usuario.is_deleted == False,
            Usuario.is_consultor == False,
            Usuario.email != "loja@kyrus_legado.com"
        )
        .order_by(Usuario.nome, Usuario.email)
    ).all()

    return vendedores


@router.post(
    "/",
    response_model=UserRead,
    status_code=201,
    dependencies=[Depends(require_permission("usuarios:create"))],
)
def create(
    *,
    db: Session = Depends(get_db),
    user_in: UserCreate,
    request: Request,
    current_user: Usuario = Depends(get_current_active_user),
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
        
        # Se for um usuário comum (não consultor) e empresa_id não for informado,
        # associa automaticamente à empresa do contexto atual.
        if not payload.is_consultor and payload.empresa_id is None:
            payload.empresa_id = get_empresa_id_from_user(current_user=current_user, session=db, request=request)
    else:
        if payload.is_consultor:
            raise HTTPException(status_code=403, detail="Somente super consultor pode criar consultores.")
        empresa_contexto = get_empresa_id_from_user(current_user=current_user, session=db, request=request)
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

    if current_user.id and user_data.empresa_id:
        user_data.permissions = sorted(
            get_effective_permission_codes(
                db,
                user_id=int(current_user.id),
                empresa_id=int(user_data.empresa_id),
                is_consultor=bool(current_user.is_consultor),
                consultor_role=str(current_user.consultor_role or ""),
            )
        )
    else:
        user_data.permissions = []

    return user_data


@router.post(
    "/me/foto",
    response_model=UserRead,
    dependencies=[Depends(require_permission("usuarios:update"))],
)
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


@router.delete(
    "/me/foto",
    response_model=UserRead,
    dependencies=[Depends(require_permission("usuarios:update"))],
)
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


@router.put(
    "/{usuario_id}",
    response_model=UserRead,
    dependencies=[Depends(require_permission("usuarios:update"))],
)
def update_usuario(
    usuario_id: int,
    user_in: UserUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Permite a um gerente atualizar email e senha (e outros campos) de um usuário da mesma empresa.
    """
    logger.info(f"Recebida requisição para atualizar usuário ID {usuario_id} por {current_user.email}")
    
    # 1. Obter empresa em contexto
    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    
    # 2. Verificar se o usuário logado é gerente
    # Se for consultor ou se tiver o perfil de FULL_ACCESS ou GERENTE
    is_manager = False
    if current_user.is_consultor:
        is_manager = True
    else:
        # Buscar perfil do usuário logado na empresa em contexto
        assignment = db.exec(
            select(UserCompanyProfile)
            .options(selectinload(UserCompanyProfile.profile))
            .where(
                UserCompanyProfile.usuario_id == current_user.id,
                UserCompanyProfile.empresa_id == empresa_id,
                UserCompanyProfile.is_deleted == False,
                UserCompanyProfile.is_active == True,
            )
        ).first()
        if assignment and assignment.profile:
            profile = assignment.profile
            profile_code = (profile.code or "").upper()
            profile_name = (profile.name or "").lower()
            if profile_code in ("FULL_ACCESS", "GERENTE") or "gerente" in profile_name:
                is_manager = True

    if not is_manager:
        raise HTTPException(
            status_code=403,
            detail="Apenas usuários com perfil de gerente podem atualizar e-mail e senha de outros usuários."
        )

    # 3. Buscar usuário alvo
    target_user = db.exec(
        select(Usuario).where(
            Usuario.id == usuario_id,
            Usuario.is_deleted == False
        )
    ).first()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    # 4. Verificar se o usuário alvo pertence à mesma empresa
    allowed_user = False
    if target_user.empresa_id == empresa_id:
        allowed_user = True
    else:
        consultant_access = db.exec(
            select(ConsultorEmpresa).where(
                ConsultorEmpresa.usuario_id == usuario_id,
                ConsultorEmpresa.empresa_id == empresa_id,
                ConsultorEmpresa.ativo == True,
                ConsultorEmpresa.is_deleted == False,
            )
        ).first()
        allowed_user = consultant_access is not None

    if not allowed_user:
        raise HTTPException(
            status_code=403,
            detail="Você não tem permissão para alterar este usuário."
        )

    # 5. Aplicar atualizações
    # Email
    if user_in.email is not None:
        normalized_email = user_in.email.strip().lower()
        if normalized_email != target_user.email:
            # Validar se o email já está em uso por outro usuário ativo
            existing_user = db.exec(
                select(Usuario).where(
                    Usuario.email == normalized_email,
                    Usuario.is_deleted == False,
                    Usuario.id != usuario_id
                )
            ).first()
            if existing_user:
                raise HTTPException(status_code=400, detail="Este e-mail já está em uso por outro usuário.")
            target_user.email = normalized_email

    # Nome
    if user_in.nome is not None:
        target_user.nome = user_in.nome.strip()

    # Password
    if user_in.password is not None and user_in.password.strip():
        from app.core.security import get_password_hash
        target_user.hashed_password = get_password_hash(user_in.password)

    # Active status
    if user_in.is_active is not None:
        target_user.is_active = user_in.is_active

    db.add(target_user)
    db.commit()
    db.refresh(target_user)
    
    # Invalidar cache de permissões do usuário atualizado
    invalidate_permission_cache(user_id=usuario_id, empresa_id=empresa_id)

    logger.success(f"Usuário ID {usuario_id} atualizado com sucesso por {current_user.email}")
    return target_user