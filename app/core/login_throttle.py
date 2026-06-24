from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request

LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_ATTEMPTS_PER_IP = 20
LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5

_LOGIN_LOCK = Lock()
_LOGIN_EVENTS: dict[str, deque[float]] = defaultdict(deque)


def _client_identifier(request: Request) -> str:
    from app.core.network import get_client_ip
    return get_client_ip(request)


def _normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def _trim_bucket(bucket: deque[float], *, now: float) -> None:
    cutoff = now - LOGIN_WINDOW_SECONDS
    while bucket and bucket[0] < cutoff:
        bucket.popleft()


def _bucket_size(key: str, *, now: float) -> int:
    bucket = _LOGIN_EVENTS[key]
    _trim_bucket(bucket, now=now)
    return len(bucket)


def is_login_rate_limited(*, request: Request, email: str) -> bool:
    client_id = _client_identifier(request)
    normalized_email = _normalize_email(email)
    now = time.time()
    with _LOGIN_LOCK:
        if _bucket_size(f"ip:{client_id}", now=now) >= LOGIN_MAX_ATTEMPTS_PER_IP:
            return True
        if normalized_email and _bucket_size(f"account:{normalized_email}|{client_id}", now=now) >= LOGIN_MAX_ATTEMPTS_PER_ACCOUNT:
            return True
    return False


def register_login_failure(*, request: Request, email: str) -> None:
    client_id = _client_identifier(request)
    normalized_email = _normalize_email(email)
    now = time.time()
    with _LOGIN_LOCK:
        ip_bucket = _LOGIN_EVENTS[f"ip:{client_id}"]
        ip_bucket.append(now)
        _trim_bucket(ip_bucket, now=now)

        if normalized_email:
            account_bucket = _LOGIN_EVENTS[f"account:{normalized_email}|{client_id}"]
            account_bucket.append(now)
            _trim_bucket(account_bucket, now=now)


def clear_login_failures(*, request: Request, email: str) -> None:
    client_id = _client_identifier(request)
    normalized_email = _normalize_email(email)
    with _LOGIN_LOCK:
        _LOGIN_EVENTS.pop(f"account:{normalized_email}|{client_id}", None)
