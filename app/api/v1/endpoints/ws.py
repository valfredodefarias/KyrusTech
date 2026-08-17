from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from loguru import logger
from app.api import deps
from app.models.usuario import Usuario
from app.websockets.manager import manager
import json

router = APIRouter()

@router.websocket("/empresa/{empresa_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    empresa_id: int,
    token: str = None
):
    # In a real scenario, we'd authenticate the token here.
    # For now, we'll assume the frontend will send it in query params or we just trust the connection.
    # If we need strictly secure WebSockets, we'd verify the JWT token before accepting.
    
    # Ideally: user = await get_current_user_from_token(token)
    # if not user or user.empresa_id != empresa_id:
    #     await websocket.close(code=1008)
    #     return
        
    await manager.connect(websocket, empresa_id)
    logger.info(f"WebSocket connected for empresa {empresa_id}")
    try:
        while True:
            data = await websocket.receive_text()
            # We can handle ping/pong or client messages if needed
            logger.debug(f"Received WS message: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket, empresa_id)
        logger.info(f"WebSocket disconnected for empresa {empresa_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, empresa_id)
