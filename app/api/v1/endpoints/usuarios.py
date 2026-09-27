# app/api/v1/endpoints/usuarios.py

from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Request, Response, Query
from loguru import logger
from sqlmodel import Session, select, or_
from sqlalchemy.orm import selectinload

from app.api.v1.deps import get_consultor_user, get_current_active_user, get_empresa_id_from_user, require_permission, require_any_permission
from app.core import security
from app.core.config import settings
from app.core.network import get_client_ip
from app.core.upload_security import IMAGE_ALLOWED_EXT_TO_MIME, UploadValidationError, safe_local_path_from_static_url, write_validated_upload_file
from app.crud.crud_usuario import create_user
from app.db.session import get_db
from app.enums import ConsultorRole, PdvPermission
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.empresa import Empresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.user_session import UserSession
from app.models.usuario import Usuario
from app.schemas.usuario import UserCreate, UserRead, UserUpdate, UserInviteRequest, UserInviteCompleteRequest, UserMeUpdate, EmailVerificationCodeRequest
from app.services.access_control_service import get_effective_permission_codes, invalidate_permission_cache
from app.services import convite_usuario_service
from app.services.confirmacao_email_service import solicitar_codigo_confirmacao, validar_codigo_confirmacao

UPLOAD_DIR = Path("static/uploads/usuarios")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter()


@router.get(
    "/vendedores",
    response_model=list[UserRead],
    dependencies=[Depends(require_any_permission(["page:usuarios:view", "page:pdv:view", "page:lancamentos:view", "page:comissoes:view", "page:configuracoes:view"]))],
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
            Usuario.nome != "LOJA"
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
        if payload.is_consultor and payload.consultor_role == ConsultorRole.USUARIO_NORMAL.value:
            payload.consultor_role = ConsultorRole.CONSULTOR.value
        elif not payload.is_consultor:
            payload.consultor_role = ConsultorRole.USUARIO_NORMAL.value

        if payload.consultor_role not in {
            ConsultorRole.USUARIO_NORMAL.value,
            ConsultorRole.CONSULTOR.value,
            ConsultorRole.SUPER_CONSULTOR.value,
        }:
            raise HTTPException(status_code=400, detail="consultor_role inválido.")
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
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna os dados do usuário logado (usado pelo frontend para saber quem está acessando)."""
    user_data = UserRead.model_validate(current_user)

    if current_user.is_consultor:
        try:
            user_data.empresa_id = get_empresa_id_from_user(current_user=current_user, session=db, request=request)
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


@router.put("/me", response_model=UserRead)
def update_user_me(
    payload: UserMeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Permite ao usuário logado atualizar seus próprios dados (nome, telefone e e-mail)."""
    email_changed = False

    if payload.email is not None:
        normalized_email = payload.email.strip().lower()
        if not normalized_email:
            raise HTTPException(status_code=400, detail="E-mail não pode ser vazio.")
        if normalized_email != current_user.email.strip().lower():
            # Verifica se já está em uso por outro usuário ativo
            existing = db.exec(
                select(Usuario).where(
                    Usuario.email == normalized_email,
                    Usuario.is_deleted == False,
                    Usuario.id != current_user.id,
                )
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="Este e-mail já está sendo utilizado por outra conta.")
            current_user.email = normalized_email
            current_user.email_confirmado = False
            email_changed = True

    if payload.nome is not None:
        current_user.nome = payload.nome.strip() or None

    if payload.telefone is not None:
        current_user.telefone = payload.telefone.strip() or None

    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    if email_changed:
        client_ip = get_client_ip(request)
        try:
            solicitar_codigo_confirmacao(db=db, usuario=current_user, ip_address=client_ip)
        except Exception as e:
            logger.warning(f"Falha ao enviar código após alteração de e-mail: {e}")

    return read_user_me(request=request, db=db, current_user=current_user)


@router.post("/me/enviar-confirmacao-email")
def enviar_confirmacao_email(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Envia código de 6 dígitos para o e-mail do usuário para confirmação."""
    client_ip = get_client_ip(request)
    return solicitar_codigo_confirmacao(db=db, usuario=current_user, ip_address=client_ip)


@router.post("/me/validar-confirmacao-email", response_model=UserRead)
def validar_confirmacao_email(
    payload: EmailVerificationCodeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Valida o código de 6 dígitos e marca o e-mail como confirmado."""
    validar_codigo_confirmacao(db=db, usuario=current_user, codigo=payload.codigo)
    return read_user_me(request=request, db=db, current_user=current_user)


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
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Permite a um gerente atualizar email e senha (e outros campos) de um usuário da mesma empresa.
    """
    logger.info(f"Recebida requisição para atualizar usuário ID {usuario_id} por {current_user.email}")
    
    # 1. Obter empresa em contexto (já validada e injetada pela dependência)
    
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

    # 4. Verificar se o usuário alvo pertence à mesma empresa ou se o operador é super consultor
    is_super = current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value
    allowed_user = is_super
    if not allowed_user:
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

    # Super Consultor pode gerenciar empresa_id, is_consultor e consultor_role
    if is_super:
        if user_in.empresa_id is not None:
            if user_in.empresa_id == 0:
                target_user.empresa_id = None
            else:
                empresa_alvo = db.get(Empresa, user_in.empresa_id)
                if not empresa_alvo or empresa_alvo.is_deleted:
                    raise HTTPException(status_code=404, detail="Empresa vinculada não existe ou foi removida.")
                target_user.empresa_id = user_in.empresa_id
        if user_in.is_consultor is not None:
            target_user.is_consultor = user_in.is_consultor
        if user_in.consultor_role is not None:
            if user_in.consultor_role in {
                ConsultorRole.USUARIO_NORMAL.value,
                ConsultorRole.CONSULTOR.value,
                ConsultorRole.SUPER_CONSULTOR.value,
            }:
                target_user.consultor_role = user_in.consultor_role

    db.add(target_user)
    db.commit()
    db.refresh(target_user)
    
    # Invalidar cache de permissões do usuário atualizado
    invalidate_permission_cache(user_id=usuario_id, empresa_id=target_user.empresa_id or empresa_id)

    logger.success(f"Usuário ID {usuario_id} atualizado com sucesso por {current_user.email}")
    return target_user


@router.get("/me/empresas", response_model=list[dict])
def obter_minhas_empresas(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Retorna a lista de empresas às quais o usuário atual tem acesso.
    Para consultores normais, usa ConsultorEmpresa.
    Para super consultores ou super usuários, retorna todas as empresas ativas.
    Para usuários comuns (operadores), usa as vinculações em UserCompanyProfile.
    """
    from app.models.empresa import Empresa
    from app.models.user_company_profile import UserCompanyProfile
    from app.models.consultor_empresa import ConsultorEmpresa
    from app.enums import ConsultorRole
    
    # 1. Super-usuários ou Super-consultores: acesso total
    if getattr(current_user, "is_superuser", False) or (current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value):
        empresas = db.exec(select(Empresa).where(Empresa.is_deleted == False, Empresa.is_active == True)).all()
        return [{"id": e.id, "nome_fantasia": e.nome_fantasia, "logo_url": e.logo_url} for e in empresas]
        
    # 2. Consultores padrão
    if current_user.is_consultor:
        acessos = db.exec(
            select(ConsultorEmpresa)
            .where(ConsultorEmpresa.usuario_id == current_user.id, ConsultorEmpresa.ativo == True)
        ).all()
        emp_ids = [ac.empresa_id for ac in acessos]
        if not emp_ids:
            return []
        empresas = db.exec(select(Empresa).where(Empresa.id.in_(emp_ids), Empresa.is_deleted == False, Empresa.is_active == True)).all()
        return [{"id": e.id, "nome_fantasia": e.nome_fantasia, "logo_url": e.logo_url} for e in empresas]
        
    # 3. Usuários comuns/operadores
    profiles = db.exec(
        select(UserCompanyProfile)
        .where(
            UserCompanyProfile.usuario_id == current_user.id,
            UserCompanyProfile.is_active == True,
            UserCompanyProfile.is_deleted == False
        )
    ).all()
    emp_ids = [p.empresa_id for p in profiles]
    # Também inclui a empresa principal do cadastro do usuário
    if current_user.empresa_id:
        emp_ids.append(current_user.empresa_id)
        
    unique_ids = list(set(emp_ids))
    if not unique_ids:
        return []
        
    empresas = db.exec(select(Empresa).where(Empresa.id.in_(unique_ids), Empresa.is_deleted == False, Empresa.is_active == True)).all()
    return [{"id": e.id, "nome_fantasia": e.nome_fantasia, "logo_url": e.logo_url} for e in empresas]


@router.post("/me/trocar-empresa", response_model=dict)
def trocar_empresa_usuario(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Permite a qualquer usuário trocar sua empresa ativa (se tiver permissão de acesso).
    Atualiza o campo empresa_id na tabela usuarios.
    """
    from app.models.empresa import Empresa
    from app.models.user_company_profile import UserCompanyProfile
    from app.models.consultor_empresa import ConsultorEmpresa
    from app.enums import ConsultorRole
    
    empresa_id = payload.get("empresa_id")
    if not empresa_id:
        raise HTTPException(status_code=400, detail="empresa_id é obrigatório")
        
    # Validar se o usuário tem acesso
    tem_acesso = False
    
    # 1. Super-usuários ou Super-consultores: acesso total
    if getattr(current_user, "is_superuser", False) or (current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value):
        tem_acesso = True
        
    # 2. Consultores padrão
    elif current_user.is_consultor:
        acesso = db.exec(
            select(ConsultorEmpresa)
            .where(
                ConsultorEmpresa.usuario_id == current_user.id,
                ConsultorEmpresa.empresa_id == empresa_id,
                ConsultorEmpresa.ativo == True
            )
        ).first()
        if acesso:
            tem_acesso = True
            
    # 3. Usuários comuns/operadores
    else:
        if current_user.empresa_id == empresa_id:
            tem_acesso = True
        else:
            profile = db.exec(
                select(UserCompanyProfile)
                .where(
                    UserCompanyProfile.usuario_id == current_user.id,
                    UserCompanyProfile.empresa_id == empresa_id,
                    UserCompanyProfile.is_active == True,
                    UserCompanyProfile.is_deleted == False
                )
            ).first()
            if profile:
                tem_acesso = True
                
    if not tem_acesso:
        raise HTTPException(status_code=403, detail="Você não tem acesso a esta empresa")
        
    empresa = db.get(Empresa, empresa_id)
    if not empresa or empresa.is_deleted or not empresa.is_active:
        raise HTTPException(status_code=404, detail="Empresa não disponível")
        
    # Atualiza a empresa_id do usuário na tabela usuarios (mudança de sessão/contexto ativo, sem gerar log de alteração cadastral com dados de outra empresa)
    current_user.empresa_id = empresa_id
    db.add(current_user)
    db.info["audit_in_progress"] = True
    try:
        db.commit()
    finally:
        db.info["audit_in_progress"] = False
    db.refresh(current_user)
    
    return {
        "success": True,
        "message": f"Empresa alterada para {empresa.nome_fantasia}",
        "empresa_id": empresa_id
    }


# ==========================================
# FLUXO DE CONVITE E ONBOARDING POR E-MAIL
# ==========================================

@router.get("/verificar-email", response_model=dict)
def verificar_email_disponibilidade(
    email: str = Query(..., min_length=3),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Verifica se um e-mail já está cadastrado no KyrusERP.
    Utilizado dinamicamente pelo frontend para exibir avisos amigáveis ao gestor.
    """
    return convite_usuario_service.verificar_email_usuario(db=db, email=email)


@router.post(
    "/convidar",
    response_model=dict,
    status_code=201,
    dependencies=[Depends(require_permission("usuarios:create"))],
)
def convidar_novo_usuario(
    payload: UserInviteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Convida um novo usuário enviando e-mail corporativo com link para definição de senha,
    ou vincula novas empresas se o usuário já possuir conta no KyrusERP.
    """
    # Detecta base_url do frontend (localhost ou domínio de produção)
    origin = request.headers.get("origin") or request.headers.get("referer")
    if origin:
        # Se vier com caminho, pega apenas scheme://host[:port]
        from urllib.parse import urlparse
        parsed = urlparse(origin)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
    else:
        base_url = "https://kyrustech.com.br"

    # Se o criador não for Super Consultor / Superuser, valida se ele tem acesso às empresas solicitadas
    is_super = getattr(current_user, "is_superuser", False) or (
        current_user.is_consultor and current_user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value
    )
    if not is_super:
        # Pega as empresas permitidas do usuário atual
        current_emp_ids = set()
        if current_user.empresa_id:
            current_emp_ids.add(current_user.empresa_id)
        current_profiles = db.exec(
            select(UserCompanyProfile)
            .where(UserCompanyProfile.usuario_id == current_user.id, UserCompanyProfile.is_active == True)
        ).all()
        for p in current_profiles:
            current_emp_ids.add(p.empresa_id)

        for emp_id in payload.empresa_ids:
            if emp_id not in current_emp_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Você não tem permissão para conceder acesso à empresa ID {emp_id}."
                )

    return convite_usuario_service.convidar_ou_vincular_usuario(
        db=db,
        email=payload.email,
        nome=payload.nome,
        empresa_ids=payload.empresa_ids,
        profile_id=payload.profile_id,
        base_url=base_url,
        is_consultor=payload.is_consultor,
        consultor_role=payload.consultor_role,
    )


@router.get("/convite/validar", response_model=dict)
def validar_convite(
    token: str = Query(..., min_length=10),
    db: Session = Depends(get_db),
):
    """
    Rota pública: valida token de convite na tela de ativação de conta.
    """
    return convite_usuario_service.validar_token_convite(db=db, token=token)


@router.post("/convite/upload-foto", response_model=dict)
def upload_foto_convite(
    token: str = Query(..., min_length=10),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Rota pública: permite ao usuário convidado enviar foto de perfil antes de concluir o cadastro.
    """
    # Valida se o token é legítimo
    convite_data = convite_usuario_service.validar_token_convite(db=db, token=token)
    user_id = convite_data["usuario"]["id"]

    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = set(IMAGE_ALLOWED_EXT_TO_MIME.keys())
    if not ext or ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Formato de imagem não suportado. Use png, jpg, jpeg, webp ou gif.",
        )

    filename = f"usuario_{user_id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename

    try:
        write_validated_upload_file(
            upload=file,
            destination=filepath,
            max_size=2 * 1024 * 1024,
            allowed_ext_to_mime=IMAGE_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    foto_url = f"/static/uploads/usuarios/{filename}"
    return {"foto_url": foto_url}


@router.post("/convite/completar", response_model=dict)
def completar_cadastro(
    payload: UserInviteCompleteRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Rota pública: define a senha do usuário, salva a foto e realiza login automático.
    Retorna token JWT e define cookie de sessão.
    """
    user = convite_usuario_service.completar_cadastro_convite(
        db=db,
        token=payload.token,
        nova_senha=payload.password,
        foto_url=payload.foto_url,
    )

    # Cria sessão do usuário e access_token
    session_id = uuid4().hex
    ip = get_client_ip(request) if request else "127.0.0.1"
    user_agent = request.headers.get("user-agent", "Unknown") if request else "Unknown"

    new_session = UserSession(
        user_id=user.id,
        session_id=session_id,
        ip_address=ip,
        user_agent=user_agent,
        is_active=True,
    )
    db.add(new_session)
    db.commit()

    from datetime import timezone
    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expires_delta
    access_token = security.create_access_token(
        subject=str(user.id),
        expires_delta=expires_delta,
        session_id=session_id,
    )

    # Seta cookie httpOnly
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    response.set_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=settings.ENVIRONMENT.lower() == "production",
        samesite="lax",
        max_age=max_age,
        expires=expires_at,
        path="/",
    )

    user_read = UserRead.model_validate(user)
    if user.id and user.empresa_id:
        user_read.permissions = sorted(
            get_effective_permission_codes(
                db,
                user_id=int(user.id),
                empresa_id=int(user.empresa_id),
                is_consultor=bool(user.is_consultor),
                consultor_role=str(user.consultor_role or ""),
            )
        )
    else:
        user_read.permissions = []

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_read.model_dump(),
        "message": "Cadastro concluído com sucesso! Bem-vindo ao KyrusERP.",
    }