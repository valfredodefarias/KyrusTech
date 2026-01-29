# app/api/v1/endpoints/auditoria.py
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func, col
from sqlalchemy import or_

from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.audit_log import AuditLog
from app.models.usuario import Usuario
from app.schemas.audit_log import AuditLogItem, AuditLogList

router = APIRouter()

@router.get("/", response_model=AuditLogList)
def listar_auditoria(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    skip: int = 0,
    limit: int = Query(50, ge=1, le=200),
    table_name: Optional[str] = None,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    empresa_id: Optional[int] = None,
    q: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
):
    filters = []

    if table_name:
        filters.append(col(AuditLog.table_name).ilike(f"%{table_name}%"))
    if action:
        filters.append(col(AuditLog.action).ilike(f"%{action}%"))
    if user_id:
        filters.append(AuditLog.user_id == user_id)
    if start:
        filters.append(AuditLog.created_at >= start)
    if end:
        filters.append(AuditLog.created_at <= end)
    if q:
        filters.append(
            or_(
                col(AuditLog.table_name).ilike(f"%{q}%"),
                col(AuditLog.action).ilike(f"%{q}%"),
            )
        )

    empresa_filter = empresa_id
    if not current_user.is_consultor:
        empresa_filter = current_user.empresa_id

    if empresa_filter:
        users_subq = select(Usuario.id).where(Usuario.empresa_id == empresa_filter)
        filters.append(col(AuditLog.user_id).in_(users_subq))

    base_query = select(AuditLog, Usuario.email).join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
    if filters:
        base_query = base_query.where(*filters)

    total_query = select(func.count()).select_from(AuditLog)
    if filters:
        total_query = total_query.where(*filters)
    total = db.exec(total_query).one()

    rows = db.exec(
        base_query.order_by(col(AuditLog.created_at).desc()).offset(skip).limit(limit)
    ).all()

    items: List[AuditLogItem] = []
    for row in rows:
        log = row[0]
        if log.id is None:
            continue
        email = row[1]
        items.append(
            AuditLogItem(
                id=log.id,
                table_name=log.table_name,
                record_id=log.record_id,
                action=log.action,
                changes=log.changes,
                user_id=log.user_id,
                user_email=email,
                ip_address=log.ip_address,
                user_agent=log.user_agent,
                created_at=log.created_at,
            )
        )

    return AuditLogList(items=items, total=int(total))
