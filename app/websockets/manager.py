import asyncio
import json
import logging
from typing import Dict, Any, List
from fastapi import WebSocket
import redis.asyncio as redis
from app.core.config import settings

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Local connections for this specific server worker
        # Key: empresa_id, Value: List of WebSockets
        self.active_connections: Dict[int, List[WebSocket]] = {}
        self.redis: redis.Redis = None
        self.pubsub = None

    async def connect_redis(self):
        """Connects to Redis if REDIS_URL is provided."""
        # Note: We need to make sure REDIS_URL exists in settings
        redis_url = getattr(settings, 'REDIS_URL', None)
        if not redis_url:
            logger.warning("REDIS_URL is not set. WebSockets will only work on a single worker.")
            return

        try:
            self.redis = redis.from_url(redis_url, decode_responses=True)
            self.pubsub = self.redis.pubsub()
            await self.pubsub.subscribe("kyrus_events")
            logger.info("Connected to Redis Pub/Sub for WebSockets.")
            
            # Start background task to listen to redis
            asyncio.create_task(self._listen_to_redis())
        except Exception as e:
            logger.error(f"Failed to connect to Redis for WebSockets: {e}")

    async def disconnect_redis(self):
        if self.pubsub:
            await self.pubsub.unsubscribe("kyrus_events")
            await self.pubsub.close()
        if self.redis:
            await self.redis.aclose()

    async def connect(self, websocket: WebSocket, empresa_id: int):
        await websocket.accept()
        if empresa_id not in self.active_connections:
            self.active_connections[empresa_id] = []
        self.active_connections[empresa_id].append(websocket)

    def disconnect(self, websocket: WebSocket, empresa_id: int):
        if empresa_id in self.active_connections:
            if websocket in self.active_connections[empresa_id]:
                self.active_connections[empresa_id].remove(websocket)
            if not self.active_connections[empresa_id]:
                del self.active_connections[empresa_id]

    async def broadcast_to_empresa(self, empresa_id: int, message: dict):
        """Broadcasts a message to all users of an empresa via Redis."""
        payload = {
            "empresa_id": empresa_id,
            "data": message
        }
        
        # Publish to redis. 
        # All workers (including this one) will receive it and send to local websockets.
        if self.redis:
            await self.redis.publish("kyrus_events", json.dumps(payload))
        else:
            # Fallback to local only if redis is not available
            await self._send_to_local_connections(empresa_id, message)

    async def _send_to_local_connections(self, empresa_id: int, message: dict):
        """Sends a message to connected websockets on THIS worker."""
        if empresa_id in self.active_connections:
            for connection in self.active_connections[empresa_id]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message to websocket: {e}")

    async def _listen_to_redis(self):
        """Listens to the Redis channel and forwards messages to local WebSockets."""
        if not self.pubsub:
            return
            
        try:
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    payload = json.loads(message["data"])
                    empresa_id = payload.get("empresa_id")
                    data = payload.get("data")
                    
                    if empresa_id and data:
                        await self._send_to_local_connections(empresa_id, data)
        except Exception as e:
            logger.error(f"Error listening to Redis Pub/Sub: {e}")
            # Try to reconnect after a delay
            await asyncio.sleep(5)
            await self.connect_redis()


manager = ConnectionManager()

def broadcast_sync(empresa_id: int, event_type: str, data: dict):
    """Utility to broadcast events from synchronous routes without event loop headaches."""
    if not settings.REDIS_URL:
        return
    try:
        # Import the synchronous redis client
        import redis as sync_redis
        r = sync_redis.from_url(settings.REDIS_URL)
        payload = {
            "empresa_id": empresa_id,
            "data": {
                "type": event_type,
                "payload": data
            }
        }
        r.publish("kyrus_events", json.dumps(payload))
        r.close()
    except Exception as e:
        logger.error(f"Failed to broadcast sync event: {e}")

