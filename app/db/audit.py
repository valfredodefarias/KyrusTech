from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import event
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, select

from app.core.audit_context import (
    get_audit_ip,
    get_audit_user,
    get_audit_user_agent,
    get_audit_batch_id,
    get_audit_automatic,
)
from app.models.audit_log import AuditLog

# Executor de thread única para garantir que as assinaturas sejam processadas sequencialmente em background
_hash_executor = ThreadPoolExecutor(max_workers=1)

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
        try:
            return int(insp.identity[0])
        except (TypeError, ValueError):
            return None
    record_id = getattr(obj, "id", None)
    if record_id is None:
        return None
    try:
        return int(record_id)
    except (TypeError, ValueError):
        return None


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

    audit_user_id = session.info.get("audit_user_id", get_audit_user())
    audit_ip_address = session.info.get("audit_ip_address", get_audit_ip())
    audit_user_agent = session.info.get("audit_user_agent", get_audit_user_agent())
    audit_batch_id = session.info.get("audit_batch_id") or get_audit_batch_id()
    audit_is_automatic = session.info.get("audit_is_automatic", get_audit_automatic())

    session.info["audit_in_progress"] = True
    try:
        for entry in entries:
            obj = entry["obj"]
            record_id = _get_record_id(obj)
            if record_id is None:
                continue
            
            empresa_id = None
            table_name = _get_table_name(obj)
            if table_name == "empresas":
                empresa_id = record_id
            else:
                empresa_id = getattr(obj, "empresa_id", None)
                if empresa_id is not None:
                    try:
                        empresa_id = int(empresa_id)
                    except (TypeError, ValueError):
                        empresa_id = None

            log = AuditLog(
                table_name=table_name,
                record_id=record_id,
                action=entry["action"],
                changes=entry.get("changes") or None,
                user_id=audit_user_id,
                empresa_id=empresa_id,
                ip_address=audit_ip_address,
                user_agent=audit_user_agent,
                batch_id=audit_batch_id,
                is_automatic=audit_is_automatic,
            )
            session.add(log)
    finally:
        session.info["audit_in_progress"] = False


def calcular_hash_para_log(log: AuditLog, prev_hash: str) -> str:
    changes_str = json.dumps(log.changes, sort_keys=True) if log.changes else ""
    log_content = f"{log.table_name}:{log.record_id}:{log.action}:{changes_str}:{log.user_id}:{prev_hash}"
    return hashlib.sha256(log_content.encode("utf-8")).hexdigest()


import threading
_signing_lock = threading.Lock()

def process_pending_audit_hashes() -> None:
    """
    Função em background que assina sequencialmente os logs que estão sem assinatura.
    Evita vazamento de memória processando em lotes e utilizando lock de thread.
    """
    if not _signing_lock.acquire(blocking=False):
        return
    try:
        from app.db.session import engine
        import time
        
        while True:
            try:
                with Session(engine) as session:
                    pending = session.exec(
                        select(AuditLog)
                        .where(AuditLog.signature_hash == None)
                        .order_by(AuditLog.id.asc())
                        .limit(500)
                    ).all()
                    
                    if not pending:
                        break
                        
                    last_hash = None
                    for log in pending:
                        if last_hash is not None:
                            prev_hash = last_hash
                        else:
                            prev_log = session.exec(
                                select(AuditLog)
                                .where(AuditLog.id < log.id, AuditLog.signature_hash != None)
                                .order_by(AuditLog.id.desc())
                                .limit(1)
                            ).first()
                            prev_hash = prev_log.signature_hash if prev_log else "0" * 64
                        
                        log.previous_hash = prev_hash
                        log.signature_hash = calcular_hash_para_log(log, prev_hash)
                        session.add(log)
                        last_hash = log.signature_hash
                        
                    session.commit()
                # Libera CPU brevemente entre lotes
                time.sleep(0.01)
            except Exception as e:
                from loguru import logger
                logger.error(f"[Audit] Erro ao assinar lote de logs de auditoria: {e}")
                break
    finally:
        _signing_lock.release()


@event.listens_for(OrmSession, "after_commit")
def trigger_hash_processing(session: OrmSession) -> None:
    """
    Aciona o processamento assíncrono das assinaturas após o commit da transação.
    """
    _hash_executor.submit(process_pending_audit_hashes)
