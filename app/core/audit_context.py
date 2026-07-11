from contextvars import ContextVar
from typing import Optional

_user_id: ContextVar[Optional[int]] = ContextVar("audit_user_id", default=None)
_ip_address: ContextVar[Optional[str]] = ContextVar("audit_ip_address", default=None)
_user_agent: ContextVar[Optional[str]] = ContextVar("audit_user_agent", default=None)
_batch_id: ContextVar[Optional[str]] = ContextVar("audit_batch_id", default=None)
_is_automatic: ContextVar[bool] = ContextVar("audit_is_automatic", default=False)


def set_audit_user(user_id: Optional[int]) -> None:
    _user_id.set(user_id)


def get_audit_user() -> Optional[int]:
    return _user_id.get()


def set_audit_request(ip_address: Optional[str], user_agent: Optional[str]) -> None:
    _ip_address.set(ip_address)
    _user_agent.set(user_agent)


def get_audit_ip() -> Optional[str]:
    return _ip_address.get()


def get_audit_user_agent() -> Optional[str]:
    return _user_agent.get()


def set_audit_batch_id(batch_id: Optional[str]) -> None:
    _batch_id.set(batch_id)


def get_audit_batch_id() -> Optional[str]:
    return _batch_id.get()


def set_audit_automatic(is_automatic: bool) -> None:
    _is_automatic.set(is_automatic)


def get_audit_automatic() -> bool:
    return _is_automatic.get()


def clear_audit_context() -> None:
    _user_id.set(None)
    _ip_address.set(None)
    _user_agent.set(None)
    _batch_id.set(None)
    _is_automatic.set(False)

