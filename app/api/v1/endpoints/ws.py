from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, status
from loguru import logger
from jose import jwt, JWTError
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import settings
from app.db.session import get_db
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.user_session import UserSession
from app.enums import ConsultorRole
from app.crud.crud_consultor_empresa import tem_acesso
from app.websockets.manager import manager

router = APIRouter()


def _authenticate_ws_user(websocket: WebSocket, token: str | None, session: Session) -> Usuario | None:
    raw_token = token
    if not raw_token:
        raw_token = websocket.query_params.get("token")
    if not raw_token:
        raw_token = websocket.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)
    if not raw_token:
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()

    if not raw_token:
        return None

    try:
        payload = jwt.decode(
            raw_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM, "HS256"]
        )
        token_sub = payload.get("sub")
        sid = payload.get("sid")
        if not token_sub:
            return None
    except Exception as e:
        logger.warning(f"[WS] Erro ao decodificar token JWT: {e}")
        return None

    user = session.exec(select(Usuario).where(Usuario.email == token_sub)).first()
    if not user and str(token_sub).isdigit():
        user = session.get(Usuario, int(token_sub))

    if not user or getattr(user, "is_deleted", False) or not user.is_active:
        return None

    if sid:
        sess = session.exec(
            select(UserSession).where(
                UserSession.session_id == sid,
                UserSession.user_id == user.id
            )
        ).first()
        if not sess or not sess.is_active:
            return None

    return user


def _check_ws_empresa_access(session: Session, user: Usuario, empresa_id: int) -> bool:
    empresa = session.get(Empresa, empresa_id)
    if not empresa or getattr(empresa, "is_deleted", False) or not empresa.is_active:
        return False

    if user.is_consultor:
        if user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value:
            return True
        return bool(tem_acesso(session, user.id, empresa_id))

    if user.empresa_id == empresa_id:
        return True

    profile = session.exec(
        select(UserCompanyProfile).where(
            UserCompanyProfile.usuario_id == user.id,
            UserCompanyProfile.empresa_id == empresa_id,
            UserCompanyProfile.is_active == True,
            UserCompanyProfile.is_deleted == False
        )
    ).first()
    return profile is not None


@router.websocket("/empresa/{empresa_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    empresa_id: int,
    token: str = None,
    db: Session = Depends(get_db),
):
    user = _authenticate_ws_user(websocket, token, db)
    if not user or not _check_ws_empresa_access(db, user, empresa_id):
        logger.warning(
            f"[WS] Conexão rejeitada para empresa {empresa_id}. "
            f"Usuário autenticado: {user.email if user else 'Não autenticado'}"
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket, empresa_id)
    logger.info(f"WebSocket connected for empresa {empresa_id} (user: {user.email})")
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Received WS message: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket, empresa_id)
        logger.info(f"WebSocket disconnected for empresa {empresa_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, empresa_id)

