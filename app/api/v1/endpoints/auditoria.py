# app/api/v1/endpoints/auditoria.py
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col
from sqlalchemy import or_, and_

from app.db.session import get_db
from app.api.deps import get_current_user, get_empresa_id_from_user
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
    user_id: Optional[str] = None,
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
        if user_id.isdigit():
            filters.append(AuditLog.user_id == int(user_id))
        else:
            filters.append(col(Usuario.email).ilike(f"%{user_id}%"))
    if start:
        filters.append(AuditLog.created_at >= _br_local_to_utc_naive(start))
    if end:
        filters.append(AuditLog.created_at <= _br_local_to_utc_naive(end))
    if q:
        filters.append(
            or_(
                col(AuditLog.table_name).ilike(f"%{q}%"),
                col(AuditLog.action).ilike(f"%{q}%"),
                col(Usuario.email).ilike(f"%{q}%"),
            )
        )

    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")

    users_subq = select(Usuario.id).where(Usuario.empresa_id == context_empresa_id)
    filters.append(
        or_(
            AuditLog.empresa_id == context_empresa_id,
            and_(
                AuditLog.empresa_id == None,
                col(AuditLog.user_id).in_(users_subq)
            )
        )
    )

    base_query = select(AuditLog, Usuario.email).join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
    if filters:
        base_query = base_query.where(*filters)

    total_query = select(func.count()).select_from(AuditLog).join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
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
                undone=log.undone,
            )
        )

    return AuditLogList(items=items, total=int(total))


def get_model_by_table_name(table_name: str):
    import app.models
    from sqlmodel import SQLModel
    
    def get_all_subclasses(cls):
        subclasses = set(cls.__subclasses__())
        for subclass in list(subclasses):
            subclasses.update(get_all_subclasses(subclass))
        return subclasses

    for cls in get_all_subclasses(SQLModel):
        if getattr(cls, "__tablename__", None) == table_name:
            return cls
    return None


def _verificar_acesso_log(db: Session, current_user: Usuario, log: AuditLog) -> None:
    if _is_super_consultor(current_user):
        return

    log_empresa_id = None
    if log.user_id:
        log_user = db.get(Usuario, log.user_id)
        if log_user:
            log_empresa_id = log_user.empresa_id

    if log_empresa_id is None:
        model_cls = get_model_by_table_name(log.table_name)
        if model_cls:
            record = db.get(model_cls, log.record_id)
            if record and hasattr(record, "empresa_id"):
                log_empresa_id = getattr(record, "empresa_id")

    if log_empresa_id is None:
        raise HTTPException(status_code=403, detail="Não foi possível validar o acesso a este log")

    if not current_user.is_consultor:
        if current_user.empresa_id != log_empresa_id:
            raise HTTPException(status_code=403, detail="Acesso negado a este log de auditoria")
    else:
        if not tem_acesso(db, int(current_user.id), log_empresa_id):
            raise HTTPException(status_code=403, detail="Acesso negado a esta empresa")


@router.post("/{log_id}/undo")
def desfazer_auditoria(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log de auditoria não encontrado")

    _verificar_acesso_log(db, current_user, log)
    
    if log.undone:
        raise HTTPException(status_code=400, detail="Esta ação já foi desfeita")
    
    model_cls = get_model_by_table_name(log.table_name)
    if not model_cls:
        raise HTTPException(status_code=400, detail=f"Tabela '{log.table_name}' não suportada para desfazer")
        
    record = db.get(model_cls, log.record_id)
    
    if log.action == "CREATE":
        if record:
            if hasattr(record, "is_deleted"):
                record.is_deleted = True
                record.deleted_at = datetime.utcnow()
                record.deleted_by_id = current_user.id
                db.add(record)
            else:
                db.delete(record)
    elif log.action in ("UPDATE", "SOFT_DELETE"):
        if not record:
            raise HTTPException(status_code=404, detail="Registro original não encontrado")
        
        if not log.changes:
            raise HTTPException(status_code=400, detail="Sem alterações registradas no log para reverter")
            
        for key, change in log.changes.items():
            setattr(record, key, change.get("old"))
        
        db.add(record)
    elif log.action == "RESTORE":
        if record:
            if hasattr(record, "is_deleted"):
                record.is_deleted = True
                record.deleted_at = datetime.utcnow()
                record.deleted_by_id = current_user.id
                db.add(record)
            else:
                db.delete(record)
    else:
        raise HTTPException(status_code=400, detail=f"Ação '{log.action}' não suporta desfazer")

    log.undone = True
    db.add(log)
    db.commit()
    
    return {"message": "Ação desfeita com sucesso"}


@router.post("/{log_id}/redo")
def refazer_auditoria(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    log = db.get(AuditLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Log de auditoria não encontrado")

    _verificar_acesso_log(db, current_user, log)
    
    if not log.undone:
        raise HTTPException(status_code=400, detail="Esta ação não está desfeita")
    
    model_cls = get_model_by_table_name(log.table_name)
    if not model_cls:
        raise HTTPException(status_code=400, detail=f"Tabela '{log.table_name}' não suportada para refazer")
        
    record = db.get(model_cls, log.record_id)
    
    if log.action == "CREATE":
        if record:
            if hasattr(record, "is_deleted"):
                record.is_deleted = False
                record.deleted_at = None
                record.deleted_by_id = None
                db.add(record)
        else:
            if not log.changes:
                raise HTTPException(status_code=400, detail="Sem alterações registradas no log para recriar")
            
            fields = {}
            for key, change in log.changes.items():
                val = change.get("new")
                if val is not None:
                    fields[key] = val
            fields["id"] = log.record_id
            
            record = model_cls(**fields)
            db.add(record)
            
    elif log.action in ("UPDATE", "SOFT_DELETE"):
        if not record:
            raise HTTPException(status_code=404, detail="Registro original não encontrado")
        
        if not log.changes:
            raise HTTPException(status_code=400, detail="Sem alterações registradas no log para refazer")
            
        for key, change in log.changes.items():
            setattr(record, key, change.get("new"))
        
        db.add(record)
    elif log.action == "RESTORE":
        if record:
            if hasattr(record, "is_deleted"):
                record.is_deleted = False
                record.deleted_at = None
                record.deleted_by_id = None
                db.add(record)
    else:
        raise HTTPException(status_code=400, detail=f"Ação '{log.action}' não suporta refazer")

    log.undone = False
    db.add(log)
    db.commit()
    
    return {"message": "Ação refeita com sucesso"}
