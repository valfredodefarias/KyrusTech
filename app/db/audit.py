from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import event
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session as OrmSession

from app.core.audit_context import get_audit_ip, get_audit_user, get_audit_user_agent
from app.models.audit_log import AuditLog

EXCLUDED_FIELDS = {
    "created_at",
    "updated_at",
    "created_by_id",
    "updated_by_id",
}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _get_table_name(obj: Any) -> str:
    return getattr(obj, "__tablename__", obj.__class__.__name__.lower())


def _get_record_id(obj: Any) -> Optional[int]:
    insp = inspect(obj)
    if insp.identity and len(insp.identity) > 0:
        return int(insp.identity[0])
    record_id = getattr(obj, "id", None)
    return int(record_id) if record_id is not None else None


def _is_audit_log(obj: Any) -> bool:
    return isinstance(obj, AuditLog) or _get_table_name(obj) == "audit_logs"


def _build_create_changes(obj: Any) -> Dict[str, Any]:
    changes: Dict[str, Any] = {}
    for key, value in obj.__dict__.items():
        if key.startswith("_") or key in EXCLUDED_FIELDS:
            continue
        changes[key] = {"old": None, "new": _serialize_value(value)}
    return changes


def _build_update_changes(obj: Any) -> Dict[str, Any]:
    changes: Dict[str, Any] = {}
    insp = inspect(obj)
    for attr in insp.attrs:
        key = attr.key
        if key in EXCLUDED_FIELDS:
            continue
        history = attr.history
        if not history.has_changes():
            continue
        old = history.deleted[0] if history.deleted else None
        new = history.added[0] if history.added else getattr(obj, key, None)
        changes[key] = {
            "old": _serialize_value(old),
            "new": _serialize_value(new),
        }
    return changes


@event.listens_for(OrmSession, "before_flush")
def collect_audit_changes(session: OrmSession, flush_context, instances) -> None:  # type: ignore[no-untyped-def]
    if session.info.get("audit_in_progress"):
        return

    entries: List[Dict[str, Any]] = []

    for obj in list(session.new):
        if _is_audit_log(obj):
            continue
        changes = _build_create_changes(obj)
        entries.append({"obj": obj, "action": "CREATE", "changes": changes})

    for obj in list(session.dirty):
        if _is_audit_log(obj):
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        changes = _build_update_changes(obj)
        if not changes:
            continue
        action = "UPDATE"
        if "is_deleted" in changes and changes["is_deleted"]["new"] is True:
            action = "SOFT_DELETE"
        entries.append({"obj": obj, "action": action, "changes": changes})

    for obj in list(session.deleted):
        if _is_audit_log(obj):
            continue
        entries.append({"obj": obj, "action": "DELETE", "changes": {}})

    if entries:
        session.info["audit_entries"] = entries


@event.listens_for(OrmSession, "after_flush_postexec")
def write_audit_logs(session: OrmSession, flush_context) -> None:  # type: ignore[no-untyped-def]
    entries = session.info.pop("audit_entries", [])
    if not entries:
        return

    session.info["audit_in_progress"] = True
    try:
        for entry in entries:
            obj = entry["obj"]
            record_id = _get_record_id(obj)
            if record_id is None:
                continue
            log = AuditLog(
                table_name=_get_table_name(obj),
                record_id=record_id,
                action=entry["action"],
                changes=entry.get("changes") or None,
                user_id=get_audit_user(),
                ip_address=get_audit_ip(),
                user_agent=get_audit_user_agent(),
            )
            session.add(log)
    finally:
        session.info["audit_in_progress"] = False
