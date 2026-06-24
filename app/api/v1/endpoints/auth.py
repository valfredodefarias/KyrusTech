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
from app.api.deps import get_current_active_user
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
        raise HTTPException(status_code=400, detail="Login falhou")

    clear_login_failures(request=request, email=form_data.username)
    return _issue_access_token(response, db, subject=user.email, request=request)


@router.get("/session", response_model=Token)
def session_info(
    access_token: str | None = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
    current_user: Usuario = Depends(get_current_active_user),
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
    current_user: Usuario = Depends(get_current_active_user),
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
    current_user: Usuario = Depends(get_current_active_user),
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