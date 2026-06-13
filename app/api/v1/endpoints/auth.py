from datetime import datetime, timedelta, timezone
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


def _issue_access_token(response: Response, *, subject: str) -> Token:
    expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    expires_at = datetime.now(timezone.utc) + expires_delta
    access_token = security.create_access_token(subject=subject, expires_delta=expires_delta)
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
    return _issue_access_token(response, subject=user.email)


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
    current_user: Usuario = Depends(get_current_active_user),
):
    return _issue_access_token(response, subject=current_user.email)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        httponly=True,
        secure=settings.ENVIRONMENT.lower() == "production",
        samesite="lax",
        path="/",
    )
    return {"status": "success"}