import os
import sys
import time
from typing import Optional
from sqlalchemy import event
from loguru import logger

from app.core.config import settings

# In-memory fallback: Maps company_id -> { query_key: (timestamp, json_payload) }
_MINIMIZED_CACHE: dict[int, dict[str, tuple[float, str]]] = {}

IS_TESTING = "pytest" in sys.modules or os.getenv("TESTING") == "True"

# Cache TTL reduzido para 15 segundos como proteção extra
CACHE_TTL = 15.0
MAX_ACTIVE_COMPANIES = 10

_sync_redis_client = None
_redis_available = None


def get_redis_client():
    """
    Retorna cliente Redis síncrono com pool de conexões reutilizável.
    Retorna None se REDIS_URL não estiver configurado ou inalcançável.
    """
    global _sync_redis_client, _redis_available
    if IS_TESTING:
        return None

    if not settings.REDIS_URL:
        return None

    if _redis_available is False:
        return None

    if _sync_redis_client is not None:
        return _sync_redis_client

    try:
        import redis as sync_redis
        _sync_redis_client = sync_redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
            health_check_interval=30,
        )
        _sync_redis_client.ping()
        _redis_available = True
        logger.info("[Cache] Conexão com Redis estabelecida com sucesso para cache distribuído.")
        return _sync_redis_client
    except Exception as e:
        logger.warning(f"[Cache] Redis indisponível ({e}). Utilizando fallback em memória local.")
        _redis_available = False
        _sync_redis_client = None
        return None


def get_empresa_cache_version(empresa_id: int) -> str:
    """
    Retorna a versão atual do cache da empresa no Redis.
    Garante que qualquer alteração de dados invalide instantaneamente todos os workers.
    """
    r = get_redis_client()
    if r:
        try:
            ver = r.get(f"kyrus:cache:version:{empresa_id}")
            if not ver:
                r.set(f"kyrus:cache:version:{empresa_id}", "1", ex=86400 * 7)
                return "1"
            return str(ver)
        except Exception as e:
            logger.error(f"[Cache] Erro ao obter versão de cache no Redis: {e}")
    return "1"


def get_transaction_cache(empresa_id: int, cache_key: str) -> Optional[str]:
    """
    Recupera payload JSON cacheado do Redis (ou memória local fallback) se válido.
    """
    r = get_redis_client()
    if r:
        try:
            version = get_empresa_cache_version(empresa_id)
            storage_key = f"kyrus:cache:tx:{empresa_id}:v{version}:{cache_key}"
            cached_json = r.get(storage_key)
            if cached_json:
                return cached_json
        except Exception as e:
            logger.warning(f"[Cache] Falha na leitura do Redis: {e}. Consultando memória local.")

    # Fallback em memória local
    if empresa_id not in _MINIMIZED_CACHE:
        return None
        
    entry = _MINIMIZED_CACHE[empresa_id].get(cache_key)
    if not entry:
        return None
        
    timestamp, json_payload = entry
    if time.time() - timestamp < CACHE_TTL:
        return json_payload
        
    # Remove entrada expirada
    try:
        del _MINIMIZED_CACHE[empresa_id][cache_key]
    except KeyError:
        pass
    return None


def set_transaction_cache(empresa_id: int, cache_key: str, json_content: str):
    """
    Salva payload JSON no Redis com TTL e versão da empresa (e memória local de fallback).
    """
    now = time.time()
    r = get_redis_client()
    if r:
        try:
            version = get_empresa_cache_version(empresa_id)
            storage_key = f"kyrus:cache:tx:{empresa_id}:v{version}:{cache_key}"
            r.setex(storage_key, int(CACHE_TTL), json_content)
        except Exception as e:
            logger.warning(f"[Cache] Falha ao salvar no Redis: {e}. Gravando na memória local.")

    # Fallback em memória local
    if empresa_id not in _MINIMIZED_CACHE:
        if len(_MINIMIZED_CACHE) >= MAX_ACTIVE_COMPANIES:
            oldest_company = None
            oldest_ts = now
            for emp_id, entries in _MINIMIZED_CACHE.items():
                for _, (ts, _) in entries.items():
                    if ts < oldest_ts:
                        oldest_ts = ts
                        oldest_company = emp_id
            if oldest_company is not None:
                _MINIMIZED_CACHE.pop(oldest_company, None)
        _MINIMIZED_CACHE[empresa_id] = {}

    _MINIMIZED_CACHE[empresa_id][cache_key] = (now, json_content)

    # Limpeza periódica de entradas expiradas na memória local
    for emp_id in list(_MINIMIZED_CACHE.keys()):
        _MINIMIZED_CACHE[emp_id] = {
            k: (ts, val)
            for k, (ts, val) in _MINIMIZED_CACHE[emp_id].items()
            if now - ts < CACHE_TTL
        }
        if not _MINIMIZED_CACHE[emp_id]:
            _MINIMIZED_CACHE.pop(emp_id, None)


def clear_transaction_cache(empresa_id: int, force: bool = True):
    """
    Invalida imediatamente o cache de transações de uma empresa para TODOS OS WORKERS.
    Incrementa atômica e instantaneamente a versão no Redis e limpa a memória local.
    """
    r = get_redis_client()
    if r:
        try:
            r.incr(f"kyrus:cache:version:{empresa_id}")
        except Exception as e:
            logger.error(f"[Cache] Erro ao incrementar versão de cache no Redis: {e}")

    # Limpa dict in-memory local
    if empresa_id in _MINIMIZED_CACHE:
        _MINIMIZED_CACHE[empresa_id].clear()


def register_cache_listeners():
    """
    Registra listeners do SQLAlchemy no modelo Lancamento para invalidar
    automaticamente o cache em qualquer insert, update ou delete.
    """
    from app.models.lancamento import Lancamento

    @event.listens_for(Lancamento, 'after_insert', propagate=True)
    @event.listens_for(Lancamento, 'after_update', propagate=True)
    @event.listens_for(Lancamento, 'after_delete', propagate=True)
    def receive_lancamento_mutation(mapper, connection, target):
        empresa_id = getattr(target, 'empresa_id', None)
        if empresa_id:
            clear_transaction_cache(empresa_id, force=True)
