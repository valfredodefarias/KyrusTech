# app/api/v1/endpoints/auditoria.py
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional, Tuple, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func, col, cast, Integer
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

TABLE_TRANSLATIONS = {
    "usuarios": "Usuários",
    "contas": "Contas Bancárias",
    "lancamentos": "Lançamentos",
    "integracoes_bancarias": "Integrações Bancárias",
    "empresas": "Empresas",
    "anexos_lancamento": "Anexos de Lançamento",
}

ACTION_TRANSLATIONS = {
    "CREATE": "Criação",
    "UPDATE": "Alteração",
    "DELETE": "Exclusão",
    "SOFT_DELETE": "Arquivamento",
    "RESTORE": "Restauração",
}

FIELD_TRANSLATIONS = {
    "empresa_id": "Empresa",
    "email": "E-mail",
    "nome": "Nome",
    "is_active": "Status Ativo",
    "perfil": "Perfil",
    "saldo_inicial": "Saldo Inicial",
    "saldo_atual": "Saldo Atual",
    "tipo": "Tipo de Conta",
    "descricao": "Descrição",
    "data": "Data",
    "valor": "Valor",
    "categoria": "Categoria",
    "conciliado": "Conciliado",
    "conta_id": "Conta Bancária",
    "observacao": "Observação",
    "favorecido": "Favorecido",
    "documento": "Documento",
    "ignorado": "Ignorado",
    "parent_id": "Lançamento Pai",
    "ofx_transaction_id": "ID Transação OFX",
    "importado": "Importado",
}

def _build_friendly_log_data(log: AuditLog) -> Tuple[str, str, List[str], bool]:
    table = log.table_name or ""
    action = log.action or ""
    changes = log.changes or {}
    
    is_system_access = table == "usuarios" and action == "UPDATE" and isinstance(changes, dict) and "empresa_id" in changes
    
    if is_system_access:
        return "Acesso", "-", ["Acessou o sistema"], False
        
    friendly_table = TABLE_TRANSLATIONS.get(table, table)
    friendly_action = ACTION_TRANSLATIONS.get(action, action)
    friendly_details = []
    
    is_undoable = action in ("CREATE", "UPDATE", "SOFT_DELETE", "RESTORE")
    
    if isinstance(changes, dict):
        for key, change in changes.items():
            field_name = FIELD_TRANSLATIONS.get(key, key)
            if isinstance(change, dict) and ("old" in change or "new" in change):
                old_val = change.get("old")
                new_val = change.get("new")
                old_str = str(old_val) if old_val is not None else "Vazio"
                new_str = str(new_val) if new_val is not None else "Vazio"
                friendly_details.append(f"{field_name}: de {old_str} para {new_str}")
            else:
                val_str = str(change) if change is not None else "Vazio"
                friendly_details.append(f"{field_name}: {val_str}")
                
    return friendly_table, friendly_action, friendly_details, is_undoable

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
    incluir_automaticos: bool = Query(False),
):
    filters = []

    if not incluir_automaticos:
        filters.append(AuditLog.is_automatic == False)

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
        
        friendly_table, friendly_action, friendly_details, is_undoable = _build_friendly_log_data(log)
        
        items.append(
            AuditLogItem(
                id=log.id,
                friendly_table_name=friendly_table,
                friendly_action=friendly_action,
                friendly_details=friendly_details,
                user_email=email,
                undone=log.undone,
                is_undoable=is_undoable,
                batch_id=log.batch_id,
                created_at=_utc_to_brazil(log.created_at),
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


# --- ENDPOINTS DE ALERTA DE ANOMALIA / FRAUDES ---
from app.models.alerta_anomalia import AlertaAnomalia
from pydantic import BaseModel

class AlertaResponse(BaseModel):
    id: int
    tipo_objeto: str
    objeto_id: int
    tipo_anomalia: str
    gravidade: str
    descricao: str
    status: str
    dados_extras: Optional[Any] = None
    resolvido_em: Optional[datetime] = None
    resolvido_por_id: Optional[int] = None
    motivo_resolucao: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class AlertaListResponse(BaseModel):
    items: List[AlertaResponse]
    total: int

class ResolverAlertaRequest(BaseModel):
    observacoes: str

@router.get("/alertas", response_model=AlertaListResponse)
def listar_alertas_anomalia(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    gravidade: Optional[str] = None,
):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")
        
    query = select(AlertaAnomalia).where(AlertaAnomalia.empresa_id == context_empresa_id)
    if status:
        query = query.where(AlertaAnomalia.status == status)
    if gravidade:
        query = query.where(AlertaAnomalia.gravidade == gravidade)
        
    total_query = select(func.count()).select_from(query.subquery())
    total = db.exec(total_query).one()
    
    items = db.exec(query.order_by(AlertaAnomalia.created_at.desc()).offset(skip).limit(limit)).all()
    
    return AlertaListResponse(items=items, total=total)

@router.post("/alertas/{alerta_id}/resolver")
def resolver_alerta_anomalia(
    alerta_id: int,
    request: ResolverAlertaRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")
        
    alerta = db.get(AlertaAnomalia, alerta_id)
    if not alerta or alerta.empresa_id != context_empresa_id:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
        
    alerta.status = "RESOLVIDO"
    alerta.resolvido_em = datetime.utcnow()
    alerta.resolvido_por_id = current_user.id
    alerta.motivo_resolucao = request.observacoes
    db.add(alerta)
    db.commit()
    return {"message": "Alerta resolvido com sucesso"}

@router.post("/alertas/{alerta_id}/ignorar")
def ignorar_alerta_anomalia(
    alerta_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")
        
    alerta = db.get(AlertaAnomalia, alerta_id)
    if not alerta or alerta.empresa_id != context_empresa_id:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
        
    alerta.status = "IGNORADO"
    alerta.resolvido_em = datetime.utcnow()
    alerta.resolvido_por_id = current_user.id
    db.add(alerta)
    db.commit()
    return {"message": "Alerta ignorado com sucesso"}


# --- ENDPOINTS DE LOTES DE IMPORTAÇÃO (BATCHES) ---

class BatchItem(BaseModel):
    batch_id: str
    created_at: datetime
    total_itens: int
    undone: bool
    user_email: Optional[str] = None

class BatchListResponse(BaseModel):
    items: List[BatchItem]

@router.get("/batches", response_model=BatchListResponse)
def listar_lotes_importacao(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")

    query = (
        select(
            AuditLog.batch_id,
            func.min(AuditLog.created_at).label("created_at"),
            func.count(AuditLog.id).label("total_itens"),
            func.min(cast(AuditLog.undone, Integer)).label("min_undone")
        )
        .where(AuditLog.empresa_id == context_empresa_id, AuditLog.batch_id != None)
        .group_by(AuditLog.batch_id)
        .order_by(func.min(AuditLog.created_at).desc())
    )
    
    rows = db.exec(query).all()
    
    items = []
    for r in rows:
        batch_id = r[0]
        created_at = r[1]
        total_itens = r[2]
        undone = bool(r[3] == 1) if r[3] is not None else False
        
        # Obter e-mail do usuário do primeiro log
        user_email = None
        first_log = db.exec(
            select(AuditLog, Usuario.email)
            .join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
            .where(AuditLog.batch_id == batch_id)
            .limit(1)
        ).first()
        if first_log:
            user_email = first_log[1]
            
        items.append(
            BatchItem(
                batch_id=batch_id,
                created_at=_utc_to_brazil(created_at),
                total_itens=total_itens,
                undone=undone,
                user_email=user_email
            )
        )
        
    return BatchListResponse(items=items)


class DesfazerLoteRequest(BaseModel):
    batch_id: str

def _executar_desfazer_lote(batch_id: str, db: Session, current_user: Usuario):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")

    logs = db.exec(
        select(AuditLog)
        .where(AuditLog.empresa_id == context_empresa_id, AuditLog.batch_id == batch_id)
        .order_by(AuditLog.id.desc())
    ).all()

    if not logs:
        raise HTTPException(status_code=404, detail="Lote de importação não encontrado")

    if all(log.undone for log in logs):
        raise HTTPException(status_code=400, detail="Este lote já foi inteiramente desfeito")

    desfeitos = 0
    for log in logs:
        if log.undone:
            continue
            
        model_cls = get_model_by_table_name(log.table_name)
        if not model_cls:
            continue
            
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
            if record and log.changes:
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
                    
        log.undone = True
        db.add(log)
        desfeitos += 1

    db.commit()
    return {"sucesso": True, "mensagem": f"Desfeitas {desfeitos} alterações do lote com sucesso."}


@router.post("/batch/undo")
def desfazer_lote_importacao_body(
    request: DesfazerLoteRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    return _executar_desfazer_lote(request.batch_id, db, current_user)


@router.post("/batch/{batch_id:path}/undo")
def desfazer_lote_importacao_path(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    return _executar_desfazer_lote(batch_id, db, current_user)


class BatchPreviewRequest(BaseModel):
    batch_id: str


def _executar_preview_lote(batch_id: str, db: Session, current_user: Usuario):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")

    logs = db.exec(
        select(AuditLog, Usuario.email)
        .join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
        .where(AuditLog.empresa_id == context_empresa_id, AuditLog.batch_id == batch_id)
        .order_by(AuditLog.id.desc())
    ).all()

    items = []
    for row in logs:
        log = row[0]
        email = row[1]
        friendly_table, friendly_action, friendly_details, is_undoable = _build_friendly_log_data(log)
        items.append({
            "id": log.id,
            "friendly_table_name": friendly_table,
            "friendly_action": friendly_action,
            "friendly_details": friendly_details,
            "user_email": email,
            "undone": log.undone,
            "is_undoable": is_undoable,
            "created_at": _utc_to_brazil(log.created_at).isoformat(),
        })

    return {"items": items}


@router.post("/batch/preview")
def preview_lote_importacao_body(
    request: BatchPreviewRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    return _executar_preview_lote(request.batch_id, db, current_user)


@router.get("/batch/{batch_id:path}/preview")
def preview_lote_importacao_path(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    return _executar_preview_lote(batch_id, db, current_user)


# --- NOVOS ENDPOINTS DE AUDITORIA E COMPLIANCE ---

class QuickResolveIn(BaseModel):
    action: str  # "excluir_movimento_duplicado" | "restaurar_lancamento"
    password_confirm: Optional[str] = None


class BulkResolveIn(BaseModel):
    ids: List[int]
    observacoes: str


class RegraSilenciamentoCreate(BaseModel):
    tipo_anomalia: str
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    valor_limite: Optional[float] = None


def check_read_only_auditor(user: Usuario, empresa_id: int, db: Session) -> bool:
    from app.models.user_company_profile import UserCompanyProfile
    from app.models.access_profile import AccessProfile
    assignment = db.exec(
        select(UserCompanyProfile)
        .where(
            UserCompanyProfile.usuario_id == user.id,
            UserCompanyProfile.empresa_id == empresa_id,
            UserCompanyProfile.is_active == True
        )
    ).first()
    if assignment:
        profile = db.get(AccessProfile, assignment.profile_id)
        if profile and profile.code == "TEMPLATE_AUDITOR":
            return True
    return False


def check_supervisor_or_admin(user: Usuario, empresa_id: int, db: Session) -> bool:
    if user.is_consultor and user.consultor_role == "SUPER_CONSULTOR":
        return True
    from app.models.user_company_profile import UserCompanyProfile
    from app.models.access_profile import AccessProfile
    assignment = db.exec(
        select(UserCompanyProfile)
        .where(
            UserCompanyProfile.usuario_id == user.id,
            UserCompanyProfile.empresa_id == empresa_id,
            UserCompanyProfile.is_active == True
        )
    ).first()
    if assignment:
        profile = db.get(AccessProfile, assignment.profile_id)
        if profile and profile.code in ("ADMIN", "SUPERVISOR"):
            return True
    return False


@router.get("/verificar-integridade")
def verificar_integridade(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.db.audit import calcular_hash_para_log
    
    logs = db.exec(select(AuditLog).order_by(AuditLog.id.asc())).all()
    if not logs:
        return {"integro": True, "mensagem": "Nenhum log para verificar"}
        
    quebras = []
    prev_hash = "0" * 64
    
    for log in logs:
        if log.signature_hash is None:
            continue
            
        if log.previous_hash != prev_hash:
            quebras.append({
                "log_id": log.id,
                "motivo": "previous_hash divergente do signature_hash anterior",
                "esperado": prev_hash,
                "encontrado": log.previous_hash
            })
            
        recalculado = calcular_hash_para_log(log, prev_hash)
        if log.signature_hash != recalculado:
            quebras.append({
                "log_id": log.id,
                "motivo": "signature_hash do registro inválido (adulteração direta)",
                "esperado": log.signature_hash,
                "encontrado": recalculado
            })
            
        prev_hash = log.signature_hash
        
    if quebras:
        return {
            "integro": False,
            "mensagem": f"Corrente criptográfica corrompida. Detectadas {len(quebras)} inconsistências.",
            "quebras": quebras
        }
        
    return {"integro": True, "mensagem": "Cadeia de logs íntegra e sem adulterações"}


@router.post("/alertas/{id}/quick-resolve")
def quick_resolve_alerta(
    id: int,
    payload: QuickResolveIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.alerta_anomalia import AlertaAnomalia
    from app.models.movimento import Movimento
    from app.models.baixa import Baixa
    from app.models.lancamento import Lancamento

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    if check_read_only_auditor(current_user, empresa_id, db):
        raise HTTPException(status_code=403, detail="Acesso negado: Perfil Auditor possui permissões puramente de leitura")

    alerta = db.exec(
        select(AlertaAnomalia).where(AlertaAnomalia.id == id, AlertaAnomalia.empresa_id == empresa_id)
    ).first()
    if not alerta:
        raise HTTPException(status_code=404, detail="Alerta não encontrado")
        
    if alerta.gravidade in ("CRITICA", "ALTA"):
        if not check_supervisor_or_admin(current_user, empresa_id, db):
            raise HTTPException(status_code=403, detail="Apenas administradores e supervisores podem resolver alertas de segurança críticos/altos.")
            
        if not payload.password_confirm:
            raise HTTPException(status_code=400, detail="Senha de confirmação necessária para ações críticas de segurança.")
        from app.crud.crud_usuario import authenticate_user
        if not authenticate_user(db, email=current_user.email, password=payload.password_confirm):
            raise HTTPException(status_code=400, detail="Senha incorreta. Ação negada.")

    if payload.action == "excluir_movimento_duplicado":
        if alerta.tipo_anomalia != "DUPLICIDADE_OFX":
            raise HTTPException(status_code=400, detail="Ação incompatível com o tipo de anomalia")
            
        movimento = db.get(Movimento, alerta.objeto_id)
        if not movimento:
            raise HTTPException(status_code=404, detail="Movimento não encontrado")
            
        baixas = db.exec(
            select(Baixa).where(Baixa.movimento_id == movimento.id, Baixa.is_deleted == False)
        ).all()
        for b in baixas:
            b.is_deleted = True
            b.deleted_at = datetime.utcnow()
            b.deleted_by_id = current_user.id
            db.add(b)
            
            lanc = db.get(Lancamento, b.lancamento_id)
            if lanc:
                outras = db.exec(
                    select(Baixa).where(
                        Baixa.lancamento_id == lanc.id,
                        Baixa.id != b.id,
                        Baixa.is_deleted == False
                    )
                ).all()
                total_pago = sum(item.valor_pago for item in outras)
                lanc.valor_pago = total_pago
                if total_pago == 0:
                    lanc.status = "EM ABERTO"
                db.add(lanc)
                
        movimento.is_deleted = True
        movimento.deleted_at = datetime.utcnow()
        movimento.deleted_by_id = current_user.id
        db.add(movimento)
        
        alerta.status = "RESOLVIDO"
        alerta.motivo_resolucao = "Movimento duplicado excluído automaticamente pelo operador."
        alerta.resolvido_em = datetime.utcnow()
        alerta.resolvido_por_id = current_user.id
        db.add(alerta)
        
        db.commit()
        return {"sucesso": True, "mensagem": "Movimento duplicado excluído e baixa(s) desconciliada(s) com sucesso."}

    elif payload.action == "restaurar_lancamento":
        if alerta.tipo_anomalia != "EXCLUSAO_SUSPEITA":
            raise HTTPException(status_code=400, detail="Ação incompatível com o tipo de anomalia")
            
        from app.services.lancamento_service import LancamentoService
        service = LancamentoService(db)
        service.restore(lancamento_id=alerta.objeto_id, empresa_id=empresa_id, user_id=current_user.id)
        
        alerta.status = "RESOLVIDO"
        alerta.motivo_resolucao = "Lançamento restaurado automaticamente pelo operador."
        alerta.resolvido_em = datetime.utcnow()
        alerta.resolvido_por_id = current_user.id
        db.add(alerta)
        
        db.commit()
        return {"sucesso": True, "mensagem": "Lançamento e seus ajustes associados restaurados com sucesso."}

    raise HTTPException(status_code=400, detail="Ação desconhecida ou inválida")


@router.post("/alertas/resolver-em-lote")
def resolver_alertas_em_lote(
    payload: BulkResolveIn,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.alerta_anomalia import AlertaAnomalia

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    if check_read_only_auditor(current_user, empresa_id, db):
        raise HTTPException(status_code=403, detail="Acesso negado: Perfil Auditor possui permissões puramente de leitura")

    alertas = db.exec(
        select(AlertaAnomalia).where(
            AlertaAnomalia.id.in_(payload.ids),
            AlertaAnomalia.empresa_id == empresa_id,
            AlertaAnomalia.status == "PENDENTE"
        )
    ).all()

    tem_critico = any(a.gravidade in ("CRITICA", "ALTA") for a in alertas)
    if tem_critico:
        if not check_supervisor_or_admin(current_user, empresa_id, db):
            raise HTTPException(status_code=403, detail="Apenas administradores e supervisores podem resolver alertas críticos em lote.")

    resolvidos = 0
    for a in alertas:
        a.status = "RESOLVIDO"
        a.motivo_resolucao = payload.observacoes
        a.resolvido_em = datetime.utcnow()
        a.resolvido_por_id = current_user.id
        db.add(a)
        resolvidos += 1
        
    db.commit()
    return {"sucesso": True, "mensagem": f"Resolvidos {resolvidos} alertas com sucesso."}


@router.get("/batch/{batch_id}/preview")
def preview_desfazer_lote(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    logs = db.exec(
        select(AuditLog)
        .where(AuditLog.empresa_id == empresa_id, AuditLog.batch_id == batch_id)
        .order_by(AuditLog.id.desc())
    ).all()

    if not logs:
        raise HTTPException(status_code=404, detail="Lote de importação não encontrado")

    preview_items = []
    for log in logs:
        model_cls = get_model_by_table_name(log.table_name)
        nome_exibicao = log.table_name
        detalhe = f"ID: {log.record_id}"
        
        if model_cls:
            record = db.get(model_cls, log.record_id)
            if record:
                if hasattr(record, "descricao"):
                    detalhe = f"{record.descricao} (ID: {log.record_id})"
                elif hasattr(record, "nome"):
                    detalhe = f"{record.nome} (ID: {log.record_id})"
                elif hasattr(record, "valor_pago"):
                    detalhe = f"Baixa de R$ {record.valor_pago:.2f} (ID: {log.record_id})"
                    
        acao_reversa = "Restaurar" if log.action in ("SOFT_DELETE", "UPDATE") else "Excluir logicamente"
        preview_items.append({
            "log_id": log.id,
            "tabela": log.table_name,
            "tabela_exibicao": TABLE_TRANSLATIONS.get(log.table_name, log.table_name),
            "record_id": log.record_id,
            "detalhe": detalhe,
            "acao_original": log.action,
            "acao_reversa": acao_reversa,
            "undone": log.undone
        })
        
    return {"batch_id": batch_id, "items": preview_items}


@router.get("/lancamento/{lancamento_id}/timeline")
def obter_timeline_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    baixas_ids = db.exec(
        select(Baixa.id).where(Baixa.lancamento_id == lancamento_id)
    ).all()
    
    query = (
        select(AuditLog, Usuario.nome, Usuario.email)
        .join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
        .where(
            AuditLog.empresa_id == empresa_id,
            or_(
                and_(AuditLog.table_name == "lancamentos", AuditLog.record_id == lancamento_id),
                and_(AuditLog.table_name == "baixas", col(AuditLog.record_id).in_(list(baixas_ids) if baixas_ids else [-1]))
            )
        )
        .order_by(AuditLog.created_at.asc())
    )
    
    rows = db.exec(query).all()
    
    timeline = []
    for log, u_nome, u_email in rows:
        usuario_str = u_nome or u_email or "Sistema"
        changes_list = []
        if log.changes:
            for field, change in log.changes.items():
                changes_list.append({
                    "campo": field,
                    "de": change.get("old"),
                    "para": change.get("new")
                })
        
        timeline.append({
            "id": log.id,
            "data": _utc_to_brazil(log.created_at).isoformat(),
            "tabela": log.table_name,
            "tabela_exibicao": TABLE_TRANSLATIONS.get(log.table_name, log.table_name),
            "acao": log.action,
            "usuario": usuario_str,
            "is_automatic": log.is_automatic,
            "changes": changes_list
        })
        
    return {"lancamento_id": lancamento_id, "timeline": timeline}


from fastapi.responses import StreamingResponse
import io
import csv

@router.get("/alertas/exportar")
def exportar_alertas(
    status: Optional[str] = None,
    gravidade: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.alerta_anomalia import AlertaAnomalia

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    query = select(AlertaAnomalia).where(AlertaAnomalia.empresa_id == empresa_id)
    if status:
        query = query.where(AlertaAnomalia.status == status)
    if gravidade:
        query = query.where(AlertaAnomalia.gravidade == gravidade)
        
    alertas = db.exec(query.order_by(AlertaAnomalia.created_at.desc())).all()
    
    output = io.StringIO()
    output.write('\ufeff')
    writer = csv.writer(output, delimiter=';')
    writer.writerow([
        "ID", "Data Criacao", "Tipo Objeto", "ID Objeto", 
        "Tipo Anomalia", "Gravidade", "Descricao", 
        "Status", "Motivo Resolucao", "Resolvido Em"
    ])
    
    for a in alertas:
        writer.writerow([
            a.id,
            a.created_at.strftime("%d/%m/%Y %H:%M:%S") if a.created_at else "",
            a.tipo_objeto,
            a.objeto_id,
            a.tipo_anomalia,
            a.gravidade,
            a.descricao,
            a.status,
            a.motivo_resolucao or "",
            a.resolvido_em.strftime("%d/%m/%Y %H:%M:%S") if a.resolvido_em else ""
        ])
        
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.read().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=relatorio_auditoria_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv"}
    )


@router.post("/silenciamento")
def criar_regra_silenciamento(
    payload: RegraSilenciamentoCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.regra_silenciamento_auditor import RegraSilenciamentoAuditor

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    if check_read_only_auditor(current_user, empresa_id, db):
        raise HTTPException(status_code=403, detail="Acesso negado: Perfil Auditor possui permissões puramente de leitura")

    regra = RegraSilenciamentoAuditor(
        tipo_anomalia=payload.tipo_anomalia,
        plano_contas_id=payload.plano_contas_id,
        entidade_id=payload.entidade_id,
        valor_limite=payload.valor_limite,
        empresa_id=empresa_id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id
    )
    db.add(regra)
    db.commit()
    db.refresh(regra)
    
    from app.services.auditor_anomalia_service import AuditorAnomaliaService
    AuditorAnomaliaService(db).analisar_regra_silenciamento(regra)
    
    return regra


@router.get("/silenciamento")
def listar_regras_silenciamento(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.regra_silenciamento_auditor import RegraSilenciamentoAuditor

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    regras = db.exec(
        select(RegraSilenciamentoAuditor).where(
            RegraSilenciamentoAuditor.empresa_id == empresa_id,
            RegraSilenciamentoAuditor.is_deleted == False
        )
    ).all()
    return regras


@router.delete("/silenciamento/{id}")
def deletar_regra_silenciamento(
    id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.regra_silenciamento_auditor import RegraSilenciamentoAuditor

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")
        
    if check_read_only_auditor(current_user, empresa_id, db):
        raise HTTPException(status_code=403, detail="Acesso negado: Perfil Auditor possui permissões puramente de leitura")

    regra = db.exec(
        select(RegraSilenciamentoAuditor).where(
            RegraSilenciamentoAuditor.id == id,
            RegraSilenciamentoAuditor.empresa_id == empresa_id,
            RegraSilenciamentoAuditor.is_deleted == False
        )
    ).first()
    if not regra:
        raise HTTPException(status_code=404, detail="Regra de silenciamento não encontrada")
        
    regra.is_deleted = True
    regra.deleted_at = datetime.utcnow()
    regra.deleted_by_id = current_user.id
    db.add(regra)
    db.commit()
    return {"sucesso": True, "mensagem": "Regra deletada com sucesso"}


