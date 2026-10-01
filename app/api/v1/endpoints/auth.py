from datetime import datetime, timedelta, timezone
from typing import List, Any
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session
from app.db.session import get_db
from app.crud import crud_usuario
from app.core import security
from app.core.config import settings
from app.core.login_throttle import clear_login_failures, is_login_rate_limited, register_login_failure
from app.schemas.token import Token
from app.api.deps import get_current_active_user, get_human_user
from app.models.usuario import Usuario

router = APIRouter()


from jose import jwt

def _issue_access_token(response: Response, db: Session, *, subject: str, request: Request = None) -> Token:
    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expires_delta
    
    import uuid
    from sqlmodel import select
    from app.models.user_session import UserSession
    
    session_id = uuid.uuid4().hex
    
    # Inativar sessões ativas anteriores
    user = db.exec(select(Usuario).where(Usuario.email == subject)).first()
    if user:
        if getattr(user, "is_service_account", False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Contas de serviço não podem emitir sessão de usuário interativo.",
            )
        active_sessions = db.exec(
            select(UserSession).where(
                UserSession.user_id == user.id,
                UserSession.is_active == True
            )
        ).all()
        for active_sess in active_sessions:
            active_sess.is_active = False
            db.add(active_sess)
            
        from app.core.network import get_client_ip
        ip = get_client_ip(request) if request else "127.0.0.1"
        user_agent = request.headers.get("user-agent", "Unknown") if request else "Unknown"
            
        new_session = UserSession(
            user_id=user.id,
            session_id=session_id,
            ip_address=ip,
            user_agent=user_agent,
            is_active=True
        )
        db.add(new_session)
        db.commit()

    access_token = security.create_access_token(subject=subject, expires_delta=expires_delta, session_id=session_id)
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
    return Token(
        expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        expires_at=expires_at,
    )

@router.post("/login", response_model=Token)
def login(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    if is_login_rate_limited(request=request, email=form_data.username):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Muitas tentativas. Tente novamente em alguns minutos.")

    user = crud_usuario.authenticate_user(db, email=form_data.username, password=form_data.password)
    if not user:
        register_login_failure(request=request, email=form_data.username)
        
        # Disparar auditor para LOGIN_BRUTE_FORCE
        from app.services.auditor_anomalia_service import AuditorAnomaliaService
        from app.core.login_throttle import _client_identifier, _bucket_size
        import time
        
        client_id = _client_identifier(request)
        now = time.time()
        attempts = _bucket_size(f"account:{form_data.username.lower().strip()}|{client_id}", now=now)
        if attempts >= 5:
            # Buscar a empresa do usuário tentado (se existir) para multitenancy
            from app.models.usuario import Usuario
            from sqlmodel import select
            tentado = db.exec(select(Usuario).where(Usuario.email == form_data.username)).first()
            empresa_id = tentado.empresa_id if tentado else 1 # fallback para empresa 1
            
            AuditorAnomaliaService(db).gerar_alerta_brute_force(
                email=form_data.username,
                ip_address=client_id,
                empresa_id=empresa_id
            )
            
        raise HTTPException(status_code=400, detail="Login falhou")

    clear_login_failures(request=request, email=form_data.username)
    return _issue_access_token(response, db, subject=user.email, request=request)


@router.post("/demo-login", response_model=Token)
def demo_login(
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    import uuid
    from app.crud.crud_empresa import create_empresa
    from app.schemas.empresa import EmpresaCreate
    from app.crud.crud_usuario import create_user
    from app.schemas.usuario import UserCreate
    from app.services.seed_demo_data import seed_demo_data
    from app.models.user_company_profile import UserCompanyProfile
    from app.models.access_profile import AccessProfile
    from sqlmodel import select

    guest_id = uuid.uuid4().hex[:6]
    
    # 1. Criar Empresa de demonstração temporária
    empresa_in = EmpresaCreate(
        nome_fantasia=f"Demonstração - Convidado #{guest_id}",
        razao_social=f"DEMO_TEMP_{guest_id}",
        cnpj=None,
        cor_primaria="#2563eb" # Azul moderno
    )
    empresa = create_empresa(db, empresa_in=empresa_in)
    
    # 2. Criar Usuário Convidado com senha aleatória
    user_in = UserCreate(
        nome="Convidado",
        email=f"convidado_{guest_id}@kyrustech.com",
        password=uuid.uuid4().hex,
        is_active=True,
        is_consultor=False,
        empresa_id=empresa.id
    )
    user = create_user(db, user_in=user_in)
    
    # 3. Vincular Perfil Administrativo (FULL_ACCESS) para o usuário convidado
    profile = db.exec(
        select(AccessProfile).where(
            AccessProfile.empresa_id == empresa.id,
            AccessProfile.code == "FULL_ACCESS",
            AccessProfile.is_deleted == False
        )
    ).first()
    
    if profile:
        db.add(
            UserCompanyProfile(
                usuario_id=user.id,
                empresa_id=empresa.id,
                profile_id=profile.id,
                is_active=True
            )
        )
        db.commit()
    
    # 4. Popular com dados fictícios de demonstração
    seed_demo_data(db, empresa.id)
    
    # 5. Emitir o token de sessão
    return _issue_access_token(response, db, subject=user.email, request=request)



@router.get("/session", response_model=Token)
def session_info(
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
    current_user: Usuario = Depends(get_human_user),
):
    if not access_token:
        raise HTTPException(status_code=401, detail="Não autenticado")

    try:
        expires_at = security.decode_access_token_expiration(access_token)
    except Exception as exc:
        raise HTTPException(status_code=403, detail="Credenciais inválidas") from exc

    return Token(
        expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        expires_at=expires_at,
    )


@router.post("/refresh", response_model=Token)
def refresh_session(
    response: Response,
    db: Session = Depends(get_db),
    request: Request = None,
    current_user: Usuario = Depends(get_human_user),
):
    return _issue_access_token(response, db, subject=current_user.email, request=request)


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
):
    if access_token:
        try:
            payload = jwt.decode(
                access_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
            )
            sid = payload.get("sid")
            if sid:
                from app.models.user_session import UserSession
                from sqlmodel import select
                sess = db.exec(select(UserSession).where(UserSession.session_id == sid)).first()
                if sess:
                    sess.is_active = False
                    db.add(sess)
                    db.commit()
        except Exception:
            pass

    response.delete_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        httponly=True,
        secure=settings.ENVIRONMENT.lower() == "production",
        samesite="lax",
        path="/",
    )
    return {"status": "success"}


@router.get("/sessions", response_model=List[Any])
def list_my_sessions(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_human_user),
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
):
    from sqlmodel import select
    from app.models.user_session import UserSession
    sessions = db.exec(
        select(UserSession)
        .where(UserSession.user_id == current_user.id)
        .order_by(UserSession.created_at.desc())
        .limit(10)
    ).all()
    
    current_sid = None
    if access_token:
        try:
            payload = jwt.decode(
                access_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
            )
            current_sid = payload.get("sid")
        except Exception:
            pass
            
    return [
        {
            "id": s.id,
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "is_active": s.is_active,
            "is_current": s.session_id == current_sid,
            "created_at": s.created_at,
            "last_activity_at": s.last_activity_at
        }
        for s in sessions
    ]

@router.post("/sessions/revoke-others")
def revoke_other_sessions(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
):
    from sqlmodel import select
    from app.models.user_session import UserSession
    
    current_sid = None
    if access_token:
        try:
            payload = jwt.decode(
                access_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
            )
            current_sid = payload.get("sid")
        except Exception:
            pass

    active_sessions = db.exec(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.is_active == True,
            UserSession.session_id != current_sid
        )
    ).all()
    
    for s in active_sessions:
        s.is_active = False
        db.add(s)
    db.commit()
    return {"status": "success", "revoked_count": len(active_sessions)}


# --- RECUPERAÇÃO DE SENHA VIA E-MAIL (RESEND) ---

from app.schemas.recuperacao_senha import (
    ForgotPasswordRequest,
    VerifyResetCodeRequest,
    ResetPasswordRequest,
    PasswordResetMessageResponse,
)
from app.services.recuperacao_senha_service import (
    solicitar_codigo_recuperacao,
    validar_codigo_recuperacao,
    redefinir_senha,
)
from app.core.network import get_client_ip


@router.post(
    "/recuperar-senha/solicitar",
    response_model=PasswordResetMessageResponse,
    summary="Solicita o envio de código de verificação para o e-mail cadastrado",
)
def solicitar_recuperacao(
    request: Request,
    payload: ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    ip = get_client_ip(request)
    return solicitar_codigo_recuperacao(db=db, email=payload.email, ip_address=ip)


@router.post(
    "/recuperar-senha/validar-codigo",
    response_model=PasswordResetMessageResponse,
    summary="Valida se o código de 6 dígitos informado é válido e está dentro da expiração",
)
def validar_codigo(
    payload: VerifyResetCodeRequest,
    db: Session = Depends(get_db),
):
    validar_codigo_recuperacao(db=db, email=payload.email, code=payload.code)
    return PasswordResetMessageResponse(ok=True, message="Código validado com sucesso!")


@router.post(
    "/recuperar-senha/redefinir",
    response_model=PasswordResetMessageResponse,
    summary="Valida o código e redefine a senha do usuário com segurança",
)
def redefinir_senha_usuario(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    return redefinir_senha(
        db=db,
        email=payload.email,
        code=payload.code,
        new_password=payload.new_password,
    )