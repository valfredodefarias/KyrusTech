# app/api/v1/endpoints/auditoria.py
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col
from sqlalchemy import or_

from app.db.session import get_db
from app.api.deps import get_current_user
from app.crud.crud_consultor_empresa import tem_acesso
from app.enums import ConsultorRole
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.audit_log import AuditLog
from app.models.usuario import Usuario
from app.schemas.audit_log import AuditLogItem, AuditLogList

router = APIRouter()

BRAZIL_TZ = ZoneInfo("America/Sao_Paulo")


def _is_super_consultor(user: Usuario) -> bool:
    return bool(user.is_consultor and user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value)


def _br_local_to_utc_naive(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BRAZIL_TZ)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _utc_to_brazil(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(BRAZIL_TZ)

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
        filters.append(AuditLog.created_at >= _br_local_to_utc_naive(start))
    if end:
        filters.append(AuditLog.created_at <= _br_local_to_utc_naive(end))
    if q:
        filters.append(
            or_(
                col(AuditLog.table_name).ilike(f"%{q}%"),
                col(AuditLog.action).ilike(f"%{q}%"),
            )
        )

    if not current_user.is_consultor:
        empresa_filter = current_user.empresa_id
        if empresa_filter:
            users_subq = select(Usuario.id).where(Usuario.empresa_id == empresa_filter)
            filters.append(col(AuditLog.user_id).in_(users_subq))
    elif _is_super_consultor(current_user):
        if empresa_id is not None:
            users_subq = select(Usuario.id).where(Usuario.empresa_id == empresa_id)
            filters.append(col(AuditLog.user_id).in_(users_subq))
    else:
        if empresa_id is not None:
            if not tem_acesso(db, int(current_user.id), empresa_id):
                raise HTTPException(status_code=403, detail="Sem acesso à empresa informada")
            users_subq = select(Usuario.id).where(Usuario.empresa_id == empresa_id)
            filters.append(col(AuditLog.user_id).in_(users_subq))
        else:
            empresas_subq = select(ConsultorEmpresa.empresa_id).where(
                ConsultorEmpresa.usuario_id == current_user.id,
                ConsultorEmpresa.ativo == True,
            )
            users_subq = select(Usuario.id).where(Usuario.empresa_id.in_(empresas_subq))
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
                created_at=_utc_to_brazil(log.created_at),
            )
        )

    return AuditLogList(items=items, total=int(total))
