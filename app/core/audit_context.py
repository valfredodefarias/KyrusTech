from contextvars import ContextVar
from typing import Optional

_user_id: ContextVar[Optional[int]] = ContextVar("audit_user_id", default=None)
_ip_address: ContextVar[Optional[str]] = ContextVar("audit_ip_address", default=None)
_user_agent: ContextVar[Optional[str]] = ContextVar("audit_user_agent", default=None)


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


def clear_audit_context() -> None:
    _user_id.set(None)
    _ip_address.set(None)
    _user_agent.set(None)
