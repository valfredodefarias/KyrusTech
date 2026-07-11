import os
import sys
import time
from typing import Optional
from sqlalchemy import event

# Maps: company_id -> { query_key: (timestamp, json_payload) }
_MINIMIZED_CACHE: dict[int, dict[str, tuple[float, str]]] = {}

IS_TESTING = "pytest" in sys.modules or os.getenv("TESTING") == "True"

# Grace period in seconds to protect cache entries from instant invalidation (preventing stampedes)
CACHE_GRACE_PERIOD = 15.0
# Maximum number of active companies in cache to keep memory usage low
MAX_ACTIVE_COMPANIES = 5

def get_transaction_cache(empresa_id: int, cache_key: str) -> Optional[str]:
    """
    Retrieves a cached JSON payload if it exists and has not expired (TTL of 10 minutes).
    """
    if empresa_id not in _MINIMIZED_CACHE:
        return None
        
    entry = _MINIMIZED_CACHE[empresa_id].get(cache_key)
    if not entry:
        return None
        
    timestamp, json_payload = entry
    if time.time() - timestamp < 600.0:
        return json_payload
        
    # Evict expired entry
    try:
        del _MINIMIZED_CACHE[empresa_id][cache_key]
    except KeyError:
        pass
    return None

def set_transaction_cache(empresa_id: int, cache_key: str, json_content: str):
    """
    Saves a JSON payload in the minimized transaction cache for a company,
    and runs garbage collection to prune expired entries and enforce company limits.
    """
    now = time.time()
    
    # 1. Enforce max company limit by evicting the oldest company caches if needed
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

    # 2. Set the cached value
    _MINIMIZED_CACHE[empresa_id][cache_key] = (now, json_content)

    # 3. Clean up expired entries (older than 10 minutes / 600s) across all companies
    for emp_id in list(_MINIMIZED_CACHE.keys()):
        _MINIMIZED_CACHE[emp_id] = {
            k: (ts, val)
            for k, (ts, val) in _MINIMIZED_CACHE[emp_id].items()
            if now - ts < 600.0
        }
        if not _MINIMIZED_CACHE[emp_id]:
            _MINIMIZED_CACHE.pop(emp_id, None)

def clear_transaction_cache(empresa_id: int, force: bool = False):
    """
    Clears cached transaction lists for a given company, respecting the grace period unless forced.
    """
    if empresa_id not in _MINIMIZED_CACHE:
        return

    if force:
        _MINIMIZED_CACHE[empresa_id].clear()
        return

    now = time.time()
    _MINIMIZED_CACHE[empresa_id] = {
        key: (ts, val)
        for key, (ts, val) in _MINIMIZED_CACHE[empresa_id].items()
        if now - ts < CACHE_GRACE_PERIOD
    }

def register_cache_listeners():
    """
    Registers SQLAlchemy event listeners on the Lancamento model to automatically
    invalidate the transaction cache on insert, update, or delete commits.
    """
    from app.models.lancamento import Lancamento

    @event.listens_for(Lancamento, 'after_insert', propagate=True)
    @event.listens_for(Lancamento, 'after_update', propagate=True)
    @event.listens_for(Lancamento, 'after_delete', propagate=True)
    def receive_lancamento_mutation(mapper, connection, target):
        empresa_id = getattr(target, 'empresa_id', None)
        if empresa_id:
            clear_transaction_cache(empresa_id)
