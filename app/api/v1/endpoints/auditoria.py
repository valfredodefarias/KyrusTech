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
    "baixas": "Baixas / Pagamentos",
    "movimentos": "Movimentações Financeiras",
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
    "valor_pago": "Valor Baixado / Pago",
    "data_baixa": "Data da Baixa",
    "tipo_baixa": "Tipo de Baixa",
    "lancamento_id": "Lançamento Vinculado",
    "movimento_id": "Movimentação Bancária",
    "hashed_password": "Senha de Acesso",
    "senha": "Senha de Acesso",
    "password": "Senha de Acesso",
    "token": "Token de Autenticação",
    "token_hash": "Hash de Token",
    "token_criptografado": "Token de Integração",
    "api_key": "Chave de API",
    "secret": "Segredo / Chave Secreta",
}

SENSITIVE_FIELD_NAMES = {
    "hashed_password",
    "password",
    "senha",
    "token",
    "token_hash",
    "token_criptografado",
    "refresh_token",
    "access_token",
    "secret",
    "client_secret",
    "api_key",
    "cvv",
    "code",
    "codigo_recuperacao",
}

SENSITIVE_SUBSTRINGS = (
    "password",
    "senha",
    "secret",
    "token_hash",
    "token_criptografado",
    "cvv",
)

REDACTED_LABEL = "[PROTEGIDO_LGPD]"


def _is_sensitive_key(key: str) -> bool:
    key_lower = str(key).lower()
    if key_lower in SENSITIVE_FIELD_NAMES:
        return True
    return any(sub in key_lower for sub in SENSITIVE_SUBSTRINGS)


def _sanitize_changes_for_client(changes: Any) -> Any:
    if not isinstance(changes, dict):
        return changes
    sanitized = {}
    for key, val in changes.items():
        if _is_sensitive_key(key):
            if isinstance(val, dict):
                sanitized[key] = {
                    "old": REDACTED_LABEL if val.get("old") is not None else None,
                    "new": REDACTED_LABEL if val.get("new") is not None else None,
                }
            else:
                sanitized[key] = REDACTED_LABEL
        else:
            sanitized[key] = val
    return sanitized


def _sanitize_dict_for_client(data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    sanitized = {}
    for key, val in data.items():
        if _is_sensitive_key(key):
            sanitized[key] = REDACTED_LABEL
        else:
            sanitized[key] = val
    return sanitized


def _build_friendly_log_data(log: AuditLog) -> Tuple[str, str, List[str], bool]:
    table = log.table_name or ""
    action = log.action or ""
    changes = log.changes or {}
    
    is_system_access = (
        table == "usuarios" and (
            (action == "UPDATE" and isinstance(changes, dict) and any(k in changes for k in ("empresa_id", "last_login", "ultimo_acesso")))
            or action in ("LOGIN", "ACCESS")
        )
    ) or table.lower() in ("acesso", "logins", "login")
    
    if is_system_access:
        return "Acesso", "-", ["Acessou o sistema"], False
        
    friendly_table = TABLE_TRANSLATIONS.get(table, table)
    friendly_action = ACTION_TRANSLATIONS.get(action, action)
    friendly_details = []
    
    is_undoable = action in ("CREATE", "UPDATE", "SOFT_DELETE", "RESTORE")
    
    # Eventos de Negócio Consolidados para Lançamentos
    if table == "lancamentos" and isinstance(changes, dict):
        if "status" in changes:
            status_change = changes["status"]
            old_s = status_change.get("old") if isinstance(status_change, dict) else None
            new_s = status_change.get("new") if isinstance(status_change, dict) else None
            if new_s in ("PAGO", "CONCILIADO") or (old_s == "EM ABERTO" and new_s in ("PAGO", "CONCILIADO")):
                friendly_action = "Baixa / Pagamento"
            elif old_s in ("PAGO", "CONCILIADO") and new_s in ("EM ABERTO", "PENDENTE"):
                friendly_action = "Estorno de Baixa"
        elif "is_deleted" in changes:
            del_change = changes["is_deleted"]
            if isinstance(del_change, dict) and del_change.get("new") is True:
                friendly_action = "Exclusão"
            elif isinstance(del_change, dict) and del_change.get("new") is False:
                friendly_action = "Restauração"
        elif action == "UPDATE":
            friendly_action = "Alteração Cadastral"
        elif action == "CREATE":
            friendly_action = "Cadastro de Lançamento"

    # Eventos para Baixas
    elif table == "baixas" and isinstance(changes, dict):
        friendly_table = "Baixas / Pagamentos"
        if action == "CREATE":
            friendly_action = "Liquidação / Baixa"
        elif action in ("DELETE", "SOFT_DELETE"):
            friendly_action = "Estorno de Baixa"
        elif action == "UPDATE":
            friendly_action = "Ajuste de Baixa"

    # Eventos para Movimentos
    elif table == "movimentos" and isinstance(changes, dict):
        friendly_table = "Extrato Bancário"
        if action == "CREATE":
            friendly_action = "Movimentação Bancária"
        elif action in ("DELETE", "SOFT_DELETE"):
            friendly_action = "Exclusão de Extrato"
        elif action == "UPDATE":
            friendly_action = "Alteração de Extrato"
    
    if isinstance(changes, dict):
        for key, change in changes.items():
            field_name = FIELD_TRANSLATIONS.get(key, key)
            if isinstance(change, dict) and ("old" in change or "new" in change):
                old_val = change.get("old")
                new_val = change.get("new")
                if old_val == "[PROTEGIDO_LGPD]" or new_val == "[PROTEGIDO_LGPD]":
                    friendly_details.append(f"{field_name}: alterado (protegido pela LGPD)")
                else:
                    old_str = str(old_val) if old_val is not None else "Vazio"
                    new_str = str(new_val) if new_val is not None else "Vazio"
                    friendly_details.append(f"{field_name}: de {old_str} para {new_str}")
            else:
                val_str = str(change) if change is not None else "Vazio"
                if val_str == "[PROTEGIDO_LGPD]":
                    friendly_details.append(f"{field_name}: protegido pela LGPD")
                else:
                    friendly_details.append(f"{field_name}: {val_str}")
                
    return friendly_table, friendly_action, friendly_details, is_undoable

@router.get("/", response_model=AuditLogList)
def listar_auditoria(
    *,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    skip: int = 0,
    limit: int = Query(200, ge=1, le=500),
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
        filters.append(AuditLog.user_id != None)
        filters.append(AuditLog.table_name != "alertas_anomalia")
        if not table_name:
            filters.append(col(AuditLog.table_name).notin_(["movimentos"]))

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

    has_user_filter = bool(q or (user_id and not user_id.isdigit()))
    if has_user_filter:
        total_query = select(func.count(AuditLog.id)).select_from(AuditLog).join(Usuario, col(AuditLog.user_id) == col(Usuario.id), isouter=True)
    else:
        total_query = select(func.count(AuditLog.id)).select_from(AuditLog)
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
        
        # Se for evento de acesso ao sistema (login, troca de empresa, etc.)
        # NÃO vazar os dados brutos de troca de empresa_id ou record_id do usuário no JSON da rede
        is_access = (
            friendly_table.strip().lower() == "acesso"
            or friendly_action == "-"
            or (log.table_name == "usuarios" and any("acessou o sistema" in d.lower() for d in friendly_details))
        )
        
        if is_access:
            out_table_name = "acesso"
            out_record_id = None
            out_changes = None
        else:
            out_table_name = log.table_name
            out_record_id = log.record_id
            out_changes = _sanitize_changes_for_client(log.changes)
            
        items.append(
            AuditLogItem(
                id=log.id,
                table_name=out_table_name,
                record_id=out_record_id,
                changes=out_changes,
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

    log_empresa_id = getattr(log, "empresa_id", None)
    if log_empresa_id is None and log.user_id:
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
        empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
        if empresa_id != log_empresa_id and current_user.empresa_id != log_empresa_id:
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
    objeto_id: Optional[int] = None,
    tipo_objeto: Optional[str] = None,
):
    context_empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not context_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado: usuário ou contexto sem empresa vinculada")
        
    query = select(AlertaAnomalia).where(AlertaAnomalia.empresa_id == context_empresa_id)
    if status:
        query = query.where(AlertaAnomalia.status == status)
    if gravidade:
        query = query.where(AlertaAnomalia.gravidade == gravidade)
    if objeto_id is not None:
        query = query.where(AlertaAnomalia.objeto_id == objeto_id)
    if tipo_objeto:
        query = query.where(AlertaAnomalia.tipo_objeto == tipo_objeto)
        
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
            func.min(cast(AuditLog.undone, Integer)).label("min_undone"),
            func.min(AuditLog.user_id).label("user_id")
        )
        .where(AuditLog.empresa_id == context_empresa_id, AuditLog.batch_id != None)
        .group_by(AuditLog.batch_id)
        .order_by(func.min(AuditLog.created_at).desc())
    )
    
    rows = db.exec(query).all()
    
    # Resolver e-mails de usuários em lote (O(1) queries em vez de N queries)
    user_ids = {r[4] for r in rows if r[4] is not None}
    users_map = {}
    if user_ids:
        user_rows = db.exec(
            select(Usuario.id, Usuario.email).where(col(Usuario.id).in_(list(user_ids)))
        ).all()
        users_map = {uid: email for uid, email in user_rows}

    items = []
    for r in rows:
        batch_id = r[0]
        created_at = r[1]
        total_itens = r[2]
        undone = bool(r[3] == 1) if r[3] is not None else False
        user_id = r[4]
        user_email = users_map.get(user_id)
        
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
        if record and getattr(record, "empresa_id", context_empresa_id) == context_empresa_id:
            if log.action == "CREATE":
                if hasattr(record, "is_deleted"):
                    record.is_deleted = True
                    record.deleted_at = datetime.utcnow()
                    record.deleted_by_id = current_user.id
                    db.add(record)
                else:
                    db.delete(record)
            elif log.action in ("UPDATE", "SOFT_DELETE"):
                if log.changes:
                    for key, change in log.changes.items():
                        setattr(record, key, change.get("old"))
                    db.add(record)
            elif log.action == "RESTORE":
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
    limit: int = Query(200, ge=10, le=500),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.db.audit import calcular_hash_para_log, process_pending_audit_hashes
    
    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)
    if not empresa_id:
        raise HTTPException(status_code=403, detail="Empresa não vinculada")

    # Garante que logs recentes pendentes sejam assinados antes da checagem
    try:
        process_pending_audit_hashes()
    except Exception:
        pass

    logs = db.exec(
        select(AuditLog)
        .where(AuditLog.empresa_id == empresa_id, AuditLog.signature_hash != None)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    ).all()
    
    if not logs:
        return {"integro": True, "mensagem": "Nenhum log assinado registrado para esta empresa"}
        
    quebras = []
    
    for log in logs:
        if log.signature_hash is None:
            continue
            
        # 1. Verifica integridade do próprio registro (adulteração direta de campos/dados)
        recalculado = calcular_hash_para_log(log, log.previous_hash or ("0" * 64))
        if log.signature_hash != recalculado:
            quebras.append({
                "log_id": log.id,
                "motivo": "signature_hash do registro inválido (adulteração direta)",
                "esperado": log.signature_hash,
                "encontrado": recalculado
            })

        # 2. Verifica a continuidade da cadeia criptográfica com o registro imediatamente anterior na base
        prev_signed_hash = db.exec(
            select(AuditLog.signature_hash)
            .where(AuditLog.id < log.id, AuditLog.signature_hash != None)
            .order_by(AuditLog.id.desc())
            .limit(1)
        ).first()

        expected_prev = prev_signed_hash or ("0" * 64)
        if log.previous_hash and log.previous_hash != expected_prev:
            quebras.append({
                "log_id": log.id,
                "motivo": "previous_hash divergente do elo criptográfico anterior",
                "esperado": expected_prev,
                "encontrado": log.previous_hash
            })
            
        if len(quebras) >= 10:
            break
        
    if quebras:
        return {
            "integro": False,
            "mensagem": f"Corrente criptográfica com inconsistências detectadas ({len(quebras)} inconsistências encontradas).",
            "quebras": quebras
        }
        
    return {"integro": True, "mensagem": f"Cadeia de logs da empresa íntegra e sem adulterações ({len(logs)} registros validados com sucesso em tempo real)."}


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
        select(Baixa.id).where(
            Baixa.lancamento_id == lancamento_id,
            Baixa.empresa_id == empresa_id
        )
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


@router.get("/lancamento/{lancamento_id}/snapshot")
def obter_snapshot_lancamento(
    lancamento_id: int,
    log_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.lancamento import Lancamento
    from app.models.conta import Conta
    from app.models.plano_contas import PlanoContas
    from app.models.entidade import Entidade
    from app.models.centro_custo import CentroCusto

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)

    lancamento = db.get(Lancamento, lancamento_id)
    if lancamento and not _is_super_consultor(current_user):
        if current_user.is_consultor:
            if not tem_acesso(db, int(current_user.id), lancamento.empresa_id):
                raise HTTPException(status_code=403, detail="Acesso negado a este lançamento")
        elif lancamento.empresa_id != empresa_id:
            raise HTTPException(status_code=403, detail="Acesso negado a este lançamento")

    base_data = {}
    if lancamento:
        base_data = {
            "id": lancamento.id,
            "descricao": lancamento.descricao,
            "tipo": lancamento.tipo,
            "status": lancamento.status,
            "valor_previsto": float(lancamento.valor_previsto) if lancamento.valor_previsto is not None else 0.0,
            "valor_pago": float(lancamento.valor_pago) if lancamento.valor_pago is not None else 0.0,
            "data_vencimento": str(lancamento.data_vencimento) if lancamento.data_vencimento else None,
            "data_pagamento": str(lancamento.data_pagamento) if lancamento.data_pagamento else None,
            "data_competencia": str(lancamento.data_competencia) if lancamento.data_competencia else None,
            "competencia": lancamento.competencia,
            "plano_contas_id": lancamento.plano_contas_id,
            "conta_id": lancamento.conta_id,
            "entidade_id": lancamento.entidade_id,
            "centro_custo_id": lancamento.centro_custo_id,
            "observacao": lancamento.observacao,
            "origem": lancamento.origem,
            "conciliado": lancamento.conciliado,
            "is_deleted": lancamento.is_deleted,
        }
    else:
        audit_query = select(AuditLog).where(
            AuditLog.table_name == "lancamentos",
            AuditLog.record_id == lancamento_id
        )
        if not _is_super_consultor(current_user):
            if current_user.is_consultor:
                from app.crud.crud_consultor_empresa import get_empresas_ids_consultor
                permitidas = get_empresas_ids_consultor(db, int(current_user.id))
                audit_query = audit_query.where(col(AuditLog.empresa_id).in_(permitidas))
            else:
                audit_query = audit_query.where(AuditLog.empresa_id == empresa_id)
        audit_records = db.exec(audit_query.order_by(AuditLog.id.desc())).all()
        if not audit_records:
            raise HTTPException(status_code=404, detail="Lançamento não encontrado")
        for alog in audit_records:
            if alog.changes and isinstance(alog.changes, dict):
                for k, v in alog.changes.items():
                    if k not in base_data and isinstance(v, dict):
                        val = v.get("old") if alog.action in ("DELETE", "SOFT_DELETE") else v.get("new")
                        if val is not None:
                            base_data[k] = val

    log = db.get(AuditLog, log_id) if log_id else None
    if log and not _is_super_consultor(current_user):
        _verificar_acesso_log(db, current_user, log)
    action = log.action if log else ("UPDATE" if lancamento else "UNKNOWN")
    changes = log.changes if (log and isinstance(log.changes, dict)) else {}
    changed_fields = list(changes.keys())

    values_before = dict(base_data)
    values_after = dict(base_data)

    if action == "CREATE":
        for k, v in changes.items():
            if isinstance(v, dict) and "new" in v:
                values_after[k] = v["new"]
        values_before = {}
    elif action in ("DELETE", "SOFT_DELETE"):
        for k, v in changes.items():
            if isinstance(v, dict) and "old" in v:
                values_before[k] = v["old"]
        values_after["is_deleted"] = True
    elif action == "UPDATE":
        for k, v in changes.items():
            if isinstance(v, dict):
                if "old" in v:
                    values_before[k] = v["old"]
                if "new" in v:
                    values_after[k] = v["new"]

    def get_related_names(data):
        rel = {}
        if data.get("conta_id"):
            c = db.get(Conta, data["conta_id"])
            if c: rel["conta_nome"] = c.nome
        if data.get("plano_contas_id"):
            pc = db.get(PlanoContas, data["plano_contas_id"])
            if pc: rel["categoria_nome"] = f"{pc.codigo} - {pc.nome}" if pc.codigo else pc.nome
        if data.get("entidade_id"):
            ent = db.get(Entidade, data["entidade_id"])
            if ent: rel["entidade_nome"] = getattr(ent, "nome", None) or getattr(ent, "nome_razao_social", None) or getattr(ent, "razao_social", None)
        if data.get("centro_custo_id"):
            cc = db.get(CentroCusto, data["centro_custo_id"])
            if cc: rel["centro_custo_nome"] = cc.nome
        return rel

    names_before = get_related_names(values_before)
    names_after = get_related_names(values_after)

    return {
        "lancamento_id": lancamento_id,
        "log_id": log_id,
        "action": action,
        "changes": _sanitize_changes_for_client(changes),
        "changed_fields": changed_fields,
        "values_before": {**_sanitize_dict_for_client(values_before), **names_before},
        "values_after": {**_sanitize_dict_for_client(values_after), **names_after},
        "is_deleted": bool(values_after.get("is_deleted", False) or action in ("DELETE", "SOFT_DELETE"))
    }


@router.get("/baixa/{baixa_id}/snapshot")
def obter_snapshot_baixa(
    baixa_id: int,
    log_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    from app.models.baixa import Baixa
    from app.models.lancamento import Lancamento
    from app.models.conta import Conta
    from app.models.movimento import Movimento

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)

    baixa = db.get(Baixa, baixa_id)
    if baixa and not _is_super_consultor(current_user):
        if current_user.is_consultor:
            if not tem_acesso(db, int(current_user.id), baixa.empresa_id):
                raise HTTPException(status_code=403, detail="Acesso negado a esta baixa")
        elif baixa.empresa_id != empresa_id:
            raise HTTPException(status_code=403, detail="Acesso negado a esta baixa")

    base_data = {}
    lancamento_info = {}
    if baixa:
        base_data = {
            "id": baixa.id,
            "lancamento_id": baixa.lancamento_id,
            "movimento_id": baixa.movimento_id,
            "valor_pago": float(baixa.valor_pago) if baixa.valor_pago is not None else 0.0,
            "data_baixa": str(baixa.data_baixa) if baixa.data_baixa else None,
            "tipo_baixa": baixa.tipo_baixa or "PRINCIPAL",
            "is_deleted": getattr(baixa, "is_deleted", False),
        }
        if baixa.lancamento:
            lancamento_info = {
                "lancamento_descricao": baixa.lancamento.descricao,
                "lancamento_tipo": baixa.lancamento.tipo,
                "lancamento_valor_previsto": float(baixa.lancamento.valor_previsto) if baixa.lancamento.valor_previsto else 0.0,
            }
            if baixa.lancamento.conta:
                base_data["conta_nome"] = baixa.lancamento.conta.nome
        if baixa.movimento and baixa.movimento.conta:
            base_data["conta_nome"] = baixa.movimento.conta.nome
    else:
        audit_query = select(AuditLog).where(
            AuditLog.table_name == "baixas",
            AuditLog.record_id == baixa_id
        )
        if not _is_super_consultor(current_user):
            if current_user.is_consultor:
                from app.crud.crud_consultor_empresa import get_empresas_ids_consultor
                permitidas = get_empresas_ids_consultor(db, int(current_user.id))
                audit_query = audit_query.where(col(AuditLog.empresa_id).in_(permitidas))
            else:
                audit_query = audit_query.where(AuditLog.empresa_id == empresa_id)
        audit_records = db.exec(audit_query.order_by(AuditLog.id.desc())).all()
        if not audit_records:
            raise HTTPException(status_code=404, detail="Baixa não encontrada")
        for alog in audit_records:
            if alog.changes and isinstance(alog.changes, dict):
                for k, v in alog.changes.items():
                    if k not in base_data and isinstance(v, dict):
                        val = v.get("old") if alog.action in ("DELETE", "SOFT_DELETE") else v.get("new")
                        if val is not None:
                            base_data[k] = val

    log = db.get(AuditLog, log_id) if log_id else None
    if log and not _is_super_consultor(current_user):
        _verificar_acesso_log(db, current_user, log)
    action = log.action if log else ("UPDATE" if baixa else "UNKNOWN")
    changes = log.changes if (log and isinstance(log.changes, dict)) else {}
    changed_fields = list(changes.keys())

    values_before = dict(base_data)
    values_after = dict(base_data)

    if action == "CREATE":
        for k, v in changes.items():
            if isinstance(v, dict) and "new" in v:
                values_after[k] = v["new"]
            elif not isinstance(v, dict):
                values_after[k] = v
        values_before = {}
    elif action in ("DELETE", "SOFT_DELETE"):
        for k, v in changes.items():
            if isinstance(v, dict) and "old" in v:
                values_before[k] = v["old"]
            elif not isinstance(v, dict):
                values_before[k] = v
        values_after["is_deleted"] = True
    elif action == "UPDATE":
        for k, v in changes.items():
            if isinstance(v, dict):
                if "old" in v:
                    values_before[k] = v["old"]
                if "new" in v:
                    values_after[k] = v["new"]

    if action in ("DELETE", "SOFT_DELETE"):
        if not changes:
            changes = {k: {"old": v, "new": None} for k, v in base_data.items() if v is not None}
            changed_fields = list(changes.keys())

    target_lid = values_after.get("lancamento_id") or values_before.get("lancamento_id")
    if target_lid and not lancamento_info:
        l = db.get(Lancamento, target_lid)
        if l:
            cat_name = f"{l.plano_contas.codigo} - {l.plano_contas.nome}" if (l.plano_contas and l.plano_contas.codigo) else (l.plano_contas.nome if l.plano_contas else None)
            ent_name = l.entidade.nome if (l.entidade and getattr(l.entidade, "nome", None)) else None
            cc_name = l.centro_custo.nome if l.centro_custo else None
            c_name = l.conta.nome if l.conta else None

            lancamento_info = {
                "id": l.id,
                "descricao": l.descricao,
                "lancamento_descricao": l.descricao,
                "tipo": l.tipo,
                "lancamento_tipo": l.tipo,
                "valor_previsto": float(l.valor_previsto) if l.valor_previsto else 0.0,
                "lancamento_valor_previsto": float(l.valor_previsto) if l.valor_previsto else 0.0,
                "valor_pago": float(l.valor_pago) if l.valor_pago else 0.0,
                "lancamento_valor_pago": float(l.valor_pago) if l.valor_pago else 0.0,
                "status": l.status,
                "lancamento_status": l.status,
                "data_vencimento": str(l.data_vencimento) if l.data_vencimento else None,
                "data_pagamento": str(l.data_pagamento) if l.data_pagamento else None,
                "data_competencia": str(l.data_competencia) if l.data_competencia else None,
                "competencia": l.competencia,
                "plano_contas_id": l.plano_contas_id,
                "categoria_nome": cat_name,
                "conta_id": l.conta_id,
                "conta_nome": c_name,
                "entidade_id": l.entidade_id,
                "entidade_nome": ent_name,
                "centro_custo_id": l.centro_custo_id,
                "centro_custo_nome": cc_name,
                "observacao": l.observacao,
                "previsto": l.previsto,
            }
            if not values_after.get("conta_nome") and c_name:
                values_after["conta_nome"] = c_name
                values_before["conta_nome"] = c_name

    target_mid = values_after.get("movimento_id") or values_before.get("movimento_id")
    if target_mid and not values_after.get("conta_nome"):
        from app.models.movimento import Movimento
        m = db.get(Movimento, target_mid)
        if m and m.conta:
            values_after["conta_nome"] = m.conta.nome
            values_before["conta_nome"] = m.conta.nome

    return {
        "baixa_id": baixa_id,
        "log_id": log_id,
        "action": action,
        "changes": _sanitize_changes_for_client(changes),
        "changed_fields": changed_fields,
        "lancamento": lancamento_info,
        "values_before": {**_sanitize_dict_for_client(values_before), **lancamento_info},
        "values_after": {**_sanitize_dict_for_client(values_after), **lancamento_info},
        "is_deleted": bool(values_after.get("is_deleted", False) or action in ("DELETE", "SOFT_DELETE"))
    }


@router.get("/movimento/{movimento_id}/snapshot")
def obter_snapshot_movimento(
    movimento_id: int,
    log_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    import re
    from app.models.movimento import Movimento
    from app.models.baixa import Baixa
    from app.models.lancamento import Lancamento
    from app.models.conta import Conta

    empresa_id = get_empresa_id_from_user(current_user=current_user, session=db)

    movimento = db.get(Movimento, movimento_id)
    if movimento and not _is_super_consultor(current_user):
        if current_user.is_consultor:
            if not tem_acesso(db, int(current_user.id), movimento.empresa_id):
                raise HTTPException(status_code=403, detail="Acesso negado a este movimento")
        elif movimento.empresa_id != empresa_id:
            raise HTTPException(status_code=403, detail="Acesso negado a este movimento")

    base_data = {}
    if movimento:
        base_data = {
            "id": movimento.id,
            "descricao": movimento.descricao,
            "valor": float(movimento.valor) if movimento.valor is not None else 0.0,
            "tipo": movimento.tipo,
            "data": str(movimento.data) if movimento.data else None,
            "status": movimento.status,
            "origem": movimento.origem,
            "conta_id": movimento.conta_id,
            "import_hash": movimento.import_hash,
            "fitid": movimento.fitid,
            "descricao_original": movimento.descricao_original,
            "payee_bruto": movimento.payee_bruto,
            "documento_extrato": movimento.documento_extrato,
            "ocorrencia_index": movimento.ocorrencia_index,
            "ofx_bank_id": movimento.ofx_bank_id,
            "ofx_agencia": movimento.ofx_agencia,
            "ofx_conta_numero": movimento.ofx_conta_numero,
            "pix_e2e_id": movimento.pix_e2e_id,
            "empresa_id": movimento.empresa_id,
            "is_deleted": getattr(movimento, "is_deleted", False),
        }
    else:
        # Reconstruir estado completo a partir dos logs de auditoria
        audit_query = select(AuditLog).where(
            AuditLog.table_name == "movimentos",
            AuditLog.record_id == movimento_id
        )
        if not _is_super_consultor(current_user):
            if current_user.is_consultor:
                from app.crud.crud_consultor_empresa import get_empresas_ids_consultor
                permitidas = get_empresas_ids_consultor(db, int(current_user.id))
                audit_query = audit_query.where(col(AuditLog.empresa_id).in_(permitidas))
            else:
                audit_query = audit_query.where(AuditLog.empresa_id == empresa_id)
        audit_records = db.exec(audit_query.order_by(AuditLog.id.asc())).all()
        if not audit_records:
            raise HTTPException(status_code=404, detail="Movimento não encontrado")
        for alog in audit_records:
            if alog.changes and isinstance(alog.changes, dict):
                for k, v in alog.changes.items():
                    val = v.get("new") if isinstance(v, dict) else v
                    if val is not None:
                        base_data[k] = val

    log = db.get(AuditLog, log_id) if log_id else None
    if log and not _is_super_consultor(current_user):
        _verificar_acesso_log(db, current_user, log)
    action = log.action if log else ("UPDATE" if movimento else "DELETE")
    changes = dict(log.changes) if (log and isinstance(log.changes, dict)) else {}

    values_before = dict(base_data)
    values_after = dict(base_data)

    if action in ("DELETE", "SOFT_DELETE"):
        if not changes:
            changes = {k: {"old": v, "new": None} for k, v in base_data.items() if v is not None}
        else:
            for k, v in changes.items():
                if isinstance(v, dict) and "old" in v:
                    values_before[k] = v["old"]
        values_after = {}
    elif action == "CREATE":
        if changes:
            for k, v in changes.items():
                if isinstance(v, dict) and "new" in v:
                    values_after[k] = v["new"]
        values_before = {}
    elif action == "UPDATE":
        if changes:
            for k, v in changes.items():
                if isinstance(v, dict):
                    if "old" in v:
                        values_before[k] = v["old"]
                    if "new" in v:
                        values_after[k] = v["new"]

    # Descobrir Lançamento vinculado
    target_lid = None
    baixa = db.exec(select(Baixa).where(Baixa.movimento_id == movimento_id)).first()
    if baixa and baixa.lancamento_id:
        target_lid = baixa.lancamento_id
    else:
        # Buscar em logs de baixas
        baixa_logs = db.exec(
            select(AuditLog)
            .where(AuditLog.table_name == "baixas")
            .order_by(AuditLog.id.desc())
        ).all()
        for blog in baixa_logs:
            ch = blog.changes or {}
            m_val = ch.get("movimento_id")
            m_id = m_val.get("new") or m_val.get("old") if isinstance(m_val, dict) else m_val
            if str(m_id) == str(movimento_id):
                l_val = ch.get("lancamento_id")
                target_lid = l_val.get("new") or l_val.get("old") if isinstance(l_val, dict) else l_val
                break

    if not target_lid:
        h = base_data.get("import_hash") or (movimento.import_hash if movimento else None)
        if h:
            match = re.search(r"manual:(\d+):", str(h))
            if match:
                target_lid = int(match.group(1))

    lancamento_info = None
    if target_lid:
        lanc = db.get(Lancamento, int(target_lid))
        if lanc:
            cat_name = f"{lanc.plano_contas.codigo} - {lanc.plano_contas.nome}" if (lanc.plano_contas and lanc.plano_contas.codigo) else (lanc.plano_contas.nome if lanc.plano_contas else None)
            ent_name = lanc.entidade.nome if (lanc.entidade and getattr(lanc.entidade, "nome", None)) else None
            cc_name = lanc.centro_custo.nome if lanc.centro_custo else None
            c_name = lanc.conta.nome if lanc.conta else None

            lancamento_info = {
                "id": lanc.id,
                "descricao": lanc.descricao,
                "tipo": lanc.tipo,
                "valor_previsto": float(lanc.valor_previsto) if lanc.valor_previsto is not None else 0.0,
                "valor_pago": float(lanc.valor_pago) if lanc.valor_pago is not None else 0.0,
                "status": lanc.status,
                "data_vencimento": str(lanc.data_vencimento) if lanc.data_vencimento else None,
                "data_pagamento": str(lanc.data_pagamento) if lanc.data_pagamento else None,
                "data_competencia": str(lanc.data_competencia) if lanc.data_competencia else None,
                "competencia": lanc.competencia,
                "plano_contas_id": lanc.plano_contas_id,
                "categoria_nome": cat_name,
                "conta_id": lanc.conta_id,
                "conta_nome": c_name,
                "entidade_id": lanc.entidade_id,
                "entidade_nome": ent_name,
                "centro_custo_id": lanc.centro_custo_id,
                "centro_custo_nome": cc_name,
                "observacao": lanc.observacao,
                "previsto": lanc.previsto,
            }
        else:
            # Lançamento foi excluído, recuperar dados nos logs de auditoria
            l_logs = db.exec(
                select(AuditLog)
                .where(AuditLog.table_name == "lancamentos", AuditLog.record_id == int(target_lid))
                .order_by(AuditLog.id.desc())
            ).all()
            for l_log in l_logs:
                if l_log.changes and isinstance(l_log.changes, dict):
                    desc = l_log.changes.get("descricao")
                    desc_val = desc.get("old") or desc.get("new") if isinstance(desc, dict) else desc
                    tipo = l_log.changes.get("tipo")
                    tipo_val = tipo.get("old") or tipo.get("new") if isinstance(tipo, dict) else tipo
                    val_p = l_log.changes.get("valor_previsto")
                    val_p_val = val_p.get("old") or val_p.get("new") if isinstance(val_p, dict) else val_p
                    lancamento_info = {
                        "id": int(target_lid),
                        "descricao": desc_val or "Lançamento Excluído",
                        "tipo": tipo_val or "DESPESA",
                        "valor_previsto": float(val_p_val) if val_p_val else 0.0,
                        "status": "EXCLUÍDO",
                    }
                    break

    # Resolver nome da conta
    conta_id_val = values_after.get("conta_id") or values_before.get("conta_id")
    if conta_id_val:
        c = db.get(Conta, int(conta_id_val))
        if c:
            values_after["conta_nome"] = c.nome
            values_before["conta_nome"] = c.nome

    return {
        "movimento_id": movimento_id,
        "log_id": log_id,
        "action": action,
        "changes": _sanitize_changes_for_client(changes),
        "changed_fields": list(changes.keys()),
        "values_before": _sanitize_dict_for_client(values_before),
        "values_after": _sanitize_dict_for_client(values_after),
        "lancamento": lancamento_info,
        "is_deleted": bool(action in ("DELETE", "SOFT_DELETE") or base_data.get("is_deleted", False))
    }


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

    if payload.plano_contas_id:
        from app.models.plano_contas import PlanoContas
        pc = db.get(PlanoContas, payload.plano_contas_id)
        if not pc or pc.empresa_id != empresa_id or pc.is_deleted:
            raise HTTPException(status_code=400, detail="Plano de contas inválido ou não pertence a esta empresa")

    if payload.entidade_id:
        from app.models.entidade import Entidade
        ent = db.get(Entidade, payload.entidade_id)
        if not ent or ent.empresa_id != empresa_id or ent.is_deleted:
            raise HTTPException(status_code=400, detail="Interessado/Entidade inválido ou não pertence a esta empresa")

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


