import pandas as pd
import io
import json
import os
import re
import uuid
import zipfile
import unicodedata
from pathlib import Path
from typing import List, Optional, Any, cast, Tuple, Callable, Iterator
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal
from difflib import SequenceMatcher
from openpyxl import load_workbook

from fastapi import APIRouter, Depends, Query, UploadFile, File, status, Form, HTTPException, BackgroundTasks, Response, Request
from fastapi.responses import StreamingResponse, JSONResponse
from sqlmodel import Session, select, col
from sqlalchemy.orm import noload, selectinload
from sqlalchemy import or_
from loguru import logger

# --- Imports do Projeto ---
# Padronizando tudo para get_db para evitar erros de importação
from app.db.session import get_db, engine
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.anexo_lancamento import AnexoLancamento
from app.models.import_job import ImportJob
from app.core.network import get_client_ip

# Dependências de Usuário e Empresa
from app.api.deps import get_current_user, get_empresa_id_from_user, require_permission

from app.services.lancamento_service import LancamentoService
from app.services.fatura_cartao_service import get_faturas_virtuais_abertas
from app.websockets.manager import broadcast_sync
from app.crud import crud_plano_contas

# --- Schemas ---
from app.schemas.lancamento import (
    LancamentoCreate, LancamentoRead, LancamentoUpdate, 
    TransferenciaCreate, BulkActionSchema, BulkUpdateSchema
)
from app.schemas.anexo import AnexoRead, AnexoCreate
from app.core.upload_security import (
    ANEXO_ALLOWED_EXT_TO_MIME,
    UploadValidationError,
    register_upload_rejection,
    register_upload_success,
    safe_local_path_from_static_url,
    write_validated_upload_file,
)

router = APIRouter()
MAX_ANEXO_NOME_LEN = 180
MAX_ANEXO_SIZE = 10 * 1024 * 1024
MAX_ANEXOS_PER_REQUEST = 10
UPLOAD_ANEXOS_DIR = Path("static/uploads/lancamentos")
UPLOAD_ANEXOS_DIR.mkdir(parents=True, exist_ok=True)

from app.services.importacao_service import (
    create_import_job as _create_import_job,
    serialize_import_job as _serialize_import_job,
    run_import_analysis_job as _run_import_analysis_job,
    analyze_import_contents as _analyze_import_contents,
    run_import_execute_job as _run_import_execute_job,
    execute_import_contents as _execute_import_contents,
)

# Padronizado para usar get_db
def get_service(session: Session = Depends(get_db)) -> LancamentoService:
    return LancamentoService(session)

def require_empresa_user(current_user: Usuario, empresa_id: Optional[int] = None) -> Tuple[int, int]:
    eid = empresa_id if empresa_id is not None else current_user.empresa_id
    if eid is None or current_user.id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário sem empresa ou identificação válida."
        )
    return eid, current_user.id


# ==========================================
# CRUD BÁSICO
@router.get("/boletim-resumo")
def obter_boletim_resumo(
    ano: Optional[int] = Query(None, ge=2000, le=2100),
    mes: Optional[int] = Query(None, ge=1, le=12),
    centro_custo_id: Optional[int] = Query(None),
    conta_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    from app.services.boletim_service import get_boletim_resumo
    return get_boletim_resumo(
        db=db,
        empresa_id=empresa_id,
        ano=ano,
        mes=mes,
        centro_custo_id=centro_custo_id,
        conta_id=conta_id,
    )


@router.get("/", response_model=List[LancamentoRead])
def listar_lancamentos(
    skip: int = 0,
    limit: int = 100,
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None),
    conta_id: Optional[int] = Query(None),
    cartao_id: Optional[int] = Query(None),
    include_anexos: bool = Query(True),
    sem_paginacao: bool = Query(False),
    somente_pagos: bool = Query(False),
    tipo: Optional[str] = Query(None),
    origem: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    conciliado: Optional[bool] = Query(None),
    ocultar_vendas_cartao_pendentes: bool = Query(False),
    incluir_demonstracoes: bool = Query(False),
    incluir_importacao_legada: bool = Query(False),
    minimized: bool = Query(False),
    data_modo: Optional[str] = Query(None),
    ids: Optional[str] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    plano_contas_ids: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista lançamentos com paginação."""
    logger.info(f"[listar_lancamentos] Chamado para empresa_id={empresa_id} minimized={minimized} sem_paginacao={sem_paginacao} data_modo={data_modo} ids={ids}")
    safe_limit = max(1, min(limit, 10000))
    safe_skip = max(skip, 0)

    effective_data_modo = (data_modo or "").strip().lower()
    if not effective_data_modo:
        if somente_pagos:
            effective_data_modo = "pagamento"
        else:
            effective_data_modo = "vencimento"

    cache_key = None
    if minimized:
        from app.core.cache import IS_TESTING
        if not IS_TESTING:
            import hashlib
            import time
            key_parts = [
                str(skip), str(limit),
                str(data_inicio), str(data_fim),
                str(conta_id), str(cartao_id),
                str(include_anexos), str(sem_paginacao),
                str(somente_pagos), str(tipo),
                str(origem), str(status),
                str(conciliado), str(ocultar_vendas_cartao_pendentes),
                str(incluir_demonstracoes), str(incluir_importacao_legada),
                str(effective_data_modo),
                str(ids),
                str(plano_contas_ids),
                str(centro_custo_id),
            ]
            cache_key = hashlib.md5(":".join(key_parts).encode("utf-8")).hexdigest()
            from app.core.cache import get_transaction_cache
            cached_json = get_transaction_cache(empresa_id, cache_key)
            if cached_json is not None:
                return Response(content=cached_json, media_type="application/json")

    if minimized:
        from sqlalchemy import func, cast as sa_cast, Float
        
        is_sqlite = False
        try:
            is_sqlite = db.bind.dialect.name == "sqlite"
        except Exception:
            pass

        if is_sqlite:
            date_venc = func.strftime('%Y-%m-%d', Lancamento.data_vencimento).label("data_vencimento")
            date_pag = func.strftime('%Y-%m-%d', Lancamento.data_pagamento).label("data_pagamento")
            date_comp = func.strftime('%Y-%m-%d', Lancamento.data_competencia).label("data_competencia")
        else:
            date_venc = func.to_char(Lancamento.data_vencimento, 'YYYY-MM-DD').label("data_vencimento")
            date_pag = func.to_char(Lancamento.data_pagamento, 'YYYY-MM-DD').label("data_pagamento")
            date_comp = func.to_char(Lancamento.data_competencia, 'YYYY-MM-DD').label("data_competencia")

        query = select(
            Lancamento.id,
            Lancamento.descricao,
            Lancamento.tipo,
            Lancamento.status,
            Lancamento.origem,
            Lancamento.observacao,
            Lancamento.id_parcelamento,
            date_venc,
            date_pag,
            date_comp,
            Lancamento.competencia,
            sa_cast(Lancamento.valor_previsto, Float).label("valor_previsto"),
            sa_cast(Lancamento.valor_pago, Float).label("valor_pago"),
            Lancamento.plano_contas_id,
            Lancamento.conta_id,
            Lancamento.entidade_id,
            Lancamento.centro_custo_id,
            Lancamento.cartao_id,
            Lancamento.ipp,
            Lancamento.previsto,
            Lancamento.conciliado,
            Lancamento.numero_parcela,
            Lancamento.tipo_origem,
            Lancamento.origem_uuid,
            Lancamento.lote_cartao_id,
            Lancamento.referencia_externa,
            Lancamento.codigo_barras,
        ).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
    else:
        load_options = [
            selectinload(cast(Any, Lancamento.entidade)),
            selectinload(cast(Any, Lancamento.baixas))
        ]
        load_options.append(selectinload(cast(Any, Lancamento.anexos)) if include_anexos else noload(cast(Any, Lancamento.anexos)))
        query = select(Lancamento).options(*load_options).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )

    # Se ids for passado, filtramos por eles e ignoramos os filtros de data/outros
    has_ids_filter = False
    if ids:
        id_list = [int(x.strip()) for x in ids.split(",") if x.strip().isdigit()]
        if id_list:
            query = query.where(Lancamento.id.in_(id_list))
            has_ids_filter = True

    if not has_ids_filter:
        if effective_data_modo == "pagamento":
            date_col = Lancamento.data_pagamento
            query = query.where(date_col.is_not(None))
        else:
            date_col = Lancamento.data_vencimento

        if data_inicio and data_fim:
            query = query.where((date_col >= data_inicio) & (date_col <= data_fim))
        else:
            if data_inicio:
                query = query.where(date_col >= data_inicio)
            if data_fim:
                query = query.where(date_col <= data_fim)
        if conta_id:
            query = query.where(Lancamento.conta_id == conta_id)
        if cartao_id:
            query = query.where(Lancamento.cartao_id == cartao_id)
        if tipo:
            query = query.where(Lancamento.tipo == tipo)
        if origem:
            if "," in origem:
                origens = [o.strip() for o in origem.split(",")]
                query = query.where(Lancamento.origem.in_(origens))
            else:
                query = query.where(Lancamento.origem == origem)
        if centro_custo_id:
            query = query.where(Lancamento.centro_custo_id == centro_custo_id)
        if plano_contas_ids:
            p_ids = [int(x.strip()) for x in plano_contas_ids.split(",") if x.strip().isdigit()]
            if p_ids:
                query = query.where(Lancamento.plano_contas_id.in_(p_ids))
        if status:
            if status.upper() in ("NAO_PAGO", "EM_ABERTO"):
                query = query.where(col(Lancamento.status).in_(["EM ABERTO", "ABERTO", "PENDENTE"]))
            elif status.upper() == "ATRASADO":
                from datetime import datetime
                from zoneinfo import ZoneInfo
                today_sp = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
                query = query.where(
                    col(Lancamento.status).in_(["EM ABERTO", "PENDENTE"]),
                    Lancamento.data_pagamento.is_(None),
                    or_(Lancamento.valor_pago == None, Lancamento.valor_pago == 0),
                    Lancamento.data_vencimento < today_sp,
                )
            else:
                query = query.where(Lancamento.status == status)
        if conciliado is not None:
            if not conciliado:
                query = query.where(or_(Lancamento.conciliado == False, Lancamento.conciliado.is_(None)))
            else:
                query = query.where(Lancamento.conciliado == True)
        if ocultar_vendas_cartao_pendentes:
            query = query.where(~((Lancamento.origem == "PDV") & (Lancamento.status == "EM ABERTO")))
        if somente_pagos:
            query = query.where(
                (col(Lancamento.status) == "PAGO")
                | (Lancamento.data_pagamento.is_not(None))
                | (col(Lancamento.valor_pago) != 0)
            )

    query = query.order_by(col(Lancamento.data_vencimento).asc())
    if not sem_paginacao:
        query = query.offset(safe_skip).limit(safe_limit)

    results = db.exec(query).all()
    logger.info(f"[listar_lancamentos] Query executada. Linhas retornadas: {len(results)}")
    if minimized:
        minimized_data = []
        for row in results:
            item = {
                "id": row.id,
                "descricao": row.descricao,
                "tipo": row.tipo,
                "status": row.status,
                "origem": row.origem,
                "observacao": row.observacao,
                "id_parcelamento": row.id_parcelamento,
                "data_vencimento": row.data_vencimento,
                "data_pagamento": row.data_pagamento,
                "data_competencia": row.data_competencia,
                "competencia": row.competencia,
                "valor_previsto": row.valor_previsto or 0.0,
                "valor_pago": row.valor_pago or 0.0,
                "plano_contas_id": row.plano_contas_id,
                "conta_id": row.conta_id,
                "entidade_id": row.entidade_id,
                "centro_custo_id": row.centro_custo_id,
                "cartao_id": row.cartao_id,
                "ipp": row.ipp,
                "previsto": row.previsto,
                "conciliado": row.conciliado,
                "numero_parcela": row.numero_parcela,
                "tipo_origem": row.tipo_origem,
                "origem_uuid": row.origem_uuid,
                "lote_cartao_id": row.lote_cartao_id,
                "referencia_externa": row.referencia_externa,
            }
            minimized_data.append(item)
            
        # Injeção de Faturas Virtuais (se buscar pendentes/abertos)
        if not somente_pagos and status in (None, 'NAO_PAGO', 'EM_ABERTO') and not ocultar_vendas_cartao_pendentes:
            competencia = (data_inicio.strftime("%Y-%m") if data_inicio else None) if effective_data_modo == 'competencia' else None
            faturas = get_faturas_virtuais_abertas(db, empresa_id, competencia=competencia, data_inicio=data_inicio, data_fim=data_fim)
            if faturas:
                import hashlib
            for f in faturas:
                hash_str = f"{f.cartao_id}_{f.competencia_fatura}".encode("utf-8")
                unique_id = -(int(hashlib.md5(hash_str).hexdigest()[:7], 16))
                # Mock lancamento virtual para a listagem minimizada
                minimized_data.append({
                    "id": unique_id, # ID negativo único para cada fatura
                    "descricao": f"Fatura {f.nome_cartao} - {f.competencia_fatura}",
                    "tipo": "DESPESA",
                    "status": "EM ABERTO",
                    "origem": "FATURA_VIRTUAL",
                    "observacao": f"{f.quantidade_compras} despesas agrupadas",
                    "id_parcelamento": None,
                    "data_vencimento": f.data_vencimento_fatura.strftime("%Y-%m-%d"),
                    "data_pagamento": None,
                    "data_competencia": f.data_vencimento_fatura.strftime("%Y-%m-%d"),
                    "competencia": f.competencia_fatura,
                    "valor_previsto": float(f.valor_total),
                    "valor_pago": 0.0,
                    "plano_contas_id": None,
                    "conta_id": None,
                    "entidade_id": None,
                    "centro_custo_id": None,
                    "cartao_id": f.cartao_id,
                    "ipp": None,
                    "previsto": True,
                    "conciliado": False,
                    "numero_parcela": None,
                })
        
        import json
        json_content = json.dumps(minimized_data, separators=(",", ":"))
        from app.core.cache import IS_TESTING
        if not IS_TESTING and cache_key:
            from app.core.cache import set_transaction_cache
            set_transaction_cache(empresa_id, cache_key, json_content)
        return Response(content=json_content, media_type="application/json")

    heal_count = 0
    for item in results:
        if not include_anexos:
            item.anexos = []
        else:
            item.anexos = [a for a in (item.anexos or []) if not getattr(a, "is_deleted", False)]
        if getattr(item, 'observacao', None) and str(item.observacao).strip().startswith('{'):
            from app.services.lancamento_autoheal import auto_heal_lancamento
            if auto_heal_lancamento(item, db):
                heal_count += 1
    if heal_count > 0:
        try:
            db.commit()
        except Exception:
            db.rollback()
            
    # Injeção para listagem não minimizada (objetos reais)
    if not somente_pagos and status in (None, 'NAO_PAGO', 'EM_ABERTO') and not ocultar_vendas_cartao_pendentes:
        competencia = (data_inicio.strftime("%Y-%m") if data_inicio else None) if effective_data_modo == 'competencia' else None
        faturas = get_faturas_virtuais_abertas(db, empresa_id, competencia=competencia, data_inicio=data_inicio, data_fim=data_fim)
        for f in faturas:
            import hashlib
            hash_str = f"{f.cartao_id}_{f.competencia_fatura}".encode("utf-8")
            # Usa os 7 primeiros caracteres do md5 em base 16 (máx ~ 268 milhões) garantindo ser negativo
            unique_id = -(int(hashlib.md5(hash_str).hexdigest()[:7], 16))
            virt_lanc = Lancamento(
                id=unique_id,
                empresa_id=empresa_id,
                descricao=f"Fatura {f.nome_cartao} - {f.competencia_fatura}",
                tipo="DESPESA",
                status="EM ABERTO",
                origem="FATURA_VIRTUAL",
                observacao=f"{f.quantidade_compras} despesas agrupadas",
                data_vencimento=f.data_vencimento_fatura,
                data_competencia=f.data_vencimento_fatura,
                competencia=f.competencia_fatura,
                valor_previsto=f.valor_total,
                cartao_id=f.cartao_id
            )
            # monkey-patch fields que não existem na tabela mas são esperados pelo pydantic
            setattr(virt_lanc, 'anexos', [])
            setattr(virt_lanc, 'baixas', [])
            results.append(virt_lanc)
            
    return results

@router.post(
    "/",
    response_model=LancamentoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("lancamentos:create"))],
)
def criar_lancamento(
    lancamento_in: LancamentoCreate,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    created = service.create(dados=lancamento_in, empresa_id=empresa_id, user_id=user_id)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id)
    broadcast_sync(empresa_id, 'LANCAMENTO_CREATED', {'id': created.id})
    return created

@router.get("/{lancamento_id}", response_model=LancamentoRead)
def obter_lancamento(
    lancamento_id: int,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, _ = require_empresa_user(current_user, empresa_id)
    db = service.session
    lancamento = service.get_by_id(lancamento_id, empresa_id)
    if not lancamento:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")

    # Auto-heal transparente de registros legados sob demanda
    from app.services.lancamento_autoheal import auto_heal_lancamento
    if auto_heal_lancamento(lancamento, db):
        try:
            db.commit()
            db.refresh(lancamento)
        except Exception:
            db.rollback()
    
    from app.models.baixa import Baixa
    from sqlmodel import select
    baixas = db.exec(
        select(Baixa).where(
            Baixa.lancamento_id == lancamento_id,
            Baixa.empresa_id == empresa_id
        )
    ).all()
    
    # Converte para LancamentoRead antes de atribuir campos que não existem no model de tabela
    lancamento_read = LancamentoRead.model_validate(lancamento)
    lancamento_read.baixas = baixas
    return lancamento_read

@router.get("/parcelamento/{parcelamento_id}", response_model=List[LancamentoRead])
def listar_por_parcelamento(
    parcelamento_id: str,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, _ = require_empresa_user(current_user, empresa_id)
    return service.listar_por_parcelamento(parcelamento_id, empresa_id)

@router.put(
    "/{lancamento_id}",
    response_model=LancamentoRead,
    dependencies=[Depends(require_permission("lancamentos:update"))],
)
def atualizar_lancamento(
    lancamento_id: int,
    lancamento_in: LancamentoUpdate,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    updated = service.update(lancamento_id=lancamento_id, dados_atualizacao=lancamento_in, empresa_id=empresa_id, user_id=user_id)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id)
    broadcast_sync(empresa_id, 'LANCAMENTO_UPDATED', {'id': updated.id})
    return updated

@router.delete(
    "/{lancamento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("lancamentos:delete"))],
)
def deletar_lancamento(
    lancamento_id: int,
    confirmar_exclusao_pagos: bool = Query(False),
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    deleted_ids = service.delete(lancamento_id, empresa_id, user_id, confirmar_exclusao_pagos=confirmar_exclusao_pagos)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id)
    if deleted_ids:
        for did in deleted_ids:
            broadcast_sync(empresa_id, 'LANCAMENTO_DELETED', {'id': did})
    else:
        broadcast_sync(empresa_id, 'LANCAMENTO_DELETED', {'id': lancamento_id})

# ==========================================
# AÇÕES EM MASSA (BULK)
# ==========================================

@router.post(
    "/bulk",
    response_model=List[LancamentoRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("lancamentos:create"))],
)
def criar_multiplos(
    lista_in: List[LancamentoCreate],
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    return service.criar_em_massa(lista_in, empresa_id, user_id)

@router.post(
    "/bulk-delete",
    dependencies=[Depends(require_permission("lancamentos:bulk_delete"))],
)
def deletar_multiplos(
    payload: BulkActionSchema,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    deleted_ids = service.deletar_em_massa(
        payload.ids,
        empresa_id,
        user_id,
        confirmar_exclusao_pagos=bool(payload.confirmar_exclusao_pagos),
    )
    if deleted_ids:
        for did in deleted_ids:
            broadcast_sync(empresa_id, 'LANCAMENTO_DELETED', {'id': did})
    return {"msg": "Lançamentos deletados com sucesso"}

@router.post(
    "/bulk-pay",
    dependencies=[Depends(require_permission("lancamentos:bulk_pay"))],
)
def baixar_multiplos(
    payload: BulkActionSchema,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    if payload.data_pagamento is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Data de pagamento é obrigatória."
        )
    atualizados = service.baixar_em_massa(ids=payload.ids, data_pagamento=payload.data_pagamento, conta_id=payload.conta_id, empresa_id=empresa_id, user_id=user_id)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id, force=True)
    broadcast_sync(empresa_id, 'LANCAMENTOS_BULK_PAID', {'count': atualizados})
    return {"msg": f"{atualizados} lançamentos baixados com sucesso"}

@router.post(
    "/bulk-update",
    dependencies=[Depends(require_permission("lancamentos:update"))],
)
def atualizar_multiplos(
    payload: BulkUpdateSchema,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    res = service.atualizar_em_massa(payload=payload, empresa_id=empresa_id, user_id=user_id)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id, force=True)
    broadcast_sync(empresa_id, 'LANCAMENTOS_BULK_UPDATED', {})
    return res

# ==========================================
# AÇÕES ESPECIAIS E ANEXOS
# ==========================================

@router.post(
    "/transferir",
    dependencies=[Depends(require_permission("lancamentos:transfer"))],
)
def transferir_valores(
    transf_in: TransferenciaCreate,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    res = service.transferir(transf_in, empresa_id, user_id)
    from app.core.cache import clear_transaction_cache
    clear_transaction_cache(empresa_id, force=True)
    broadcast_sync(empresa_id, 'TRANSFERENCIA_CREATED', res)
    return res

@router.post(
    "/{lancamento_id}/anexos",
    response_model=List[AnexoRead],
    dependencies=[Depends(require_permission("lancamentos:update"))],
)
def upload_anexos(
    lancamento_id: int,
    files: List[UploadFile] = File(...),
    tipo: str = Query("OUTROS"),
    request: Request = None,
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    anexos_criados = []
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    from app.core.network import get_client_ip
    origin = get_client_ip(request)

    if not files:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="nenhum_arquivo_enviado",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhum arquivo enviado.")
    if len(files) > MAX_ANEXOS_PER_REQUEST:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="limite_anexos_por_requisicao_excedido",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Máximo de {MAX_ANEXOS_PER_REQUEST} anexos por requisição.",
        )

    tipo_normalizado = re.sub(r"[^A-Z0-9_]+", "_", str(tipo or "OUTROS").upper()).strip("_")
    if not tipo_normalizado:
        tipo_normalizado = "OUTROS"
    if len(tipo_normalizado) > 40:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="tipo_anexo_invalido",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de anexo inválido.")

    # Garante que o lançamento existe e pertence à empresa do usuário antes de salvar arquivos.
    service.get_by_id(lancamento_id, empresa_id)

    for file in files:
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo inválido: nome do arquivo ausente."
            )
        nome_arquivo = Path(file.filename).name.strip()
        if not nome_arquivo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo inválido: nome do arquivo ausente.")
        if len(nome_arquivo) > MAX_ANEXO_NOME_LEN:
            register_upload_rejection(
                endpoint="/api/v1/lancamentos/{id}/anexos",
                empresa_id=empresa_id,
                user_id=user_id,
                origin=origin,
                reason="nome_arquivo_excede_limite",
                filename=nome_arquivo,
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome do arquivo excede o limite permitido.")

        destino_dir = UPLOAD_ANEXOS_DIR / str(empresa_id) / str(lancamento_id)
        destino_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(nome_arquivo).suffix.lower()[:12]
        nome_storage = f"{uuid.uuid4().hex}{ext}"
        destino_arquivo = destino_dir / nome_storage

        try:
            _, tamanho_bytes, content_type = write_validated_upload_file(
                upload=file,
                destination=destino_arquivo,
                max_size=MAX_ANEXO_SIZE,
                allowed_ext_to_mime=ANEXO_ALLOWED_EXT_TO_MIME,
                max_filename_len=MAX_ANEXO_NOME_LEN,
            )
        except UploadValidationError as exc:
            if exc.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE:
                register_upload_rejection(
                    endpoint="/api/v1/lancamentos/{id}/anexos",
                    empresa_id=empresa_id,
                    user_id=user_id,
                    origin=origin,
                    reason="arquivo_muito_grande",
                    filename=nome_arquivo,
                )
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Arquivo muito grande. Máximo 10MB por anexo.",
                )
            register_upload_rejection(
                endpoint="/api/v1/lancamentos/{id}/anexos",
                empresa_id=empresa_id,
                user_id=user_id,
                origin=origin,
                reason=str(exc.message),
                filename=nome_arquivo,
            )
            raise HTTPException(status_code=exc.status_code, detail=exc.message)

        register_upload_success(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            bytes_written=tamanho_bytes,
        )

        url_relativa = f"/static/uploads/lancamentos/{empresa_id}/{lancamento_id}/{nome_storage}"
        dados = AnexoCreate(
            nome_arquivo=nome_arquivo,
            url=url_relativa,
            tipo=tipo_normalizado,
            tamanho_bytes=tamanho_bytes,
            content_type=content_type,
            lancamento_id=lancamento_id,
            empresa_id=empresa_id,
        )
        anexos_criados.append(service.adicionar_anexo(lancamento_id, dados, empresa_id, user_id))
    return anexos_criados


@router.delete(
    "/{lancamento_id}/anexos/{anexo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("lancamentos:delete"))],
)
@router.post(
    "/{lancamento_id}/anexos/{anexo_id}/delete",
    status_code=status.HTTP_204_NO_CONTENT,
    include_in_schema=False,
    dependencies=[Depends(require_permission("lancamentos:delete"))],
)
def delete_anexo_lancamento(
    lancamento_id: int,
    anexo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, _ = require_empresa_user(current_user, empresa_id)

    # Garante que o lançamento pertence à empresa autenticada.
    lancamento = db.exec(
        select(Lancamento).where(
            Lancamento.id == lancamento_id,
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
        )
    ).first()
    if not lancamento:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")

    anexo = db.exec(
        select(AnexoLancamento).where(
            AnexoLancamento.id == anexo_id,
            AnexoLancamento.lancamento_id == lancamento_id,
            AnexoLancamento.empresa_id == empresa_id,
            AnexoLancamento.is_deleted == False,
        )
    ).first()
    if not anexo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo não encontrado.")

    url = str(anexo.url or "")
    arquivo_local = safe_local_path_from_static_url(
        url,
        required_prefix="/static/uploads/lancamentos/",
    )

    if url.startswith("/static/uploads/lancamentos/") and arquivo_local is None:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos/{anexo_id}",
            empresa_id=empresa_id,
            user_id=getattr(current_user, "id", None),
            origin=get_client_ip(request),
            reason="tentativa_path_traversal_ou_url_invalida",
            filename=str(anexo.nome_arquivo or ""),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL de anexo inválida.")

    if arquivo_local:
        arquivo_local.unlink(missing_ok=True)

    anexo.is_deleted = True
    anexo.deleted_at = datetime.utcnow()
    anexo.deleted_by_id = getattr(current_user, "id", None)
    db.add(anexo)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# ==========================================
# IMPORTAÇÃO INTELIGENTE (VERSÃO SÊNIOR)
# ==========================================

def encontrar_coluna(df: pd.DataFrame, possiveis_nomes: list) -> str:
    colunas_upper = {c.upper().strip(): c for c in df.columns}
    for nome in possiveis_nomes:
        if nome in colunas_upper: return colunas_upper[nome]
    return ""

@router.get("/importar/modelo", response_class=StreamingResponse)
def download_modelo_importacao():
    df = pd.DataFrame(columns=["DATA VENCIMENTO", "DATA PAGAMENTO", "DESCRIÇÃO", "VALOR", "CONTA", "CATEGORIA", "CENTRO DE CUSTO", "ENTIDADE"])
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Importacao')
    output.seek(0)
    return StreamingResponse(output, headers={'Content-Disposition': 'attachment; filename="modelo_kyrus.xlsx"'}, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@router.post(
    "/importar/analisar",
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def analisar_arquivo_importacao(
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, _ = require_empresa_user(current_user, empresa_id)
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo deve ser XLSX ou XLS")
    max_size = 10 * 1024 * 1024
    content = file.file.read(max_size + 1)
    if len(content) > max_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Arquivo excede o limite de 10 MB")
    return _analyze_import_contents(session, content, empresa_id)


@router.post(
    "/importar/analisar-async",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def analisar_arquivo_importacao_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo deve ser XLSX ou XLS")
    max_size = 10 * 1024 * 1024
    file_bytes = file.file.read(max_size + 1)
    if len(file_bytes) > max_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Arquivo excede o limite de 10 MB")
    job = _create_import_job(db, "ANALYZE", empresa_id, user_id, file.filename)
    background_tasks.add_task(_run_import_analysis_job, job.job_id, empresa_id, user_id, file_bytes)
    return {"job_id": job.job_id, "status": job.status}


@router.get(
    "/importar/jobs/{job_id}",
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def obter_status_job_importacao(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    job = db.get(ImportJob, job_id)
    if not job or job.empresa_id != empresa_id or job.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job de importação não encontrado")
    return _serialize_import_job(job)

# ==========================================
# IMPORTAÇÃO INTELIGENTE
# ==========================================

class ImportacaoRequest:
    """Requisição para importação via formulário."""
    file: UploadFile
    mapeamento_json: str


@router.post(
    "/importar/executar",
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def importar_executar(
    file: UploadFile = File(...),
    mapeamento_json: str = Form(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """
    Endpoint para importação de lançamentos com mapeamento de categorias.
    Recebe arquivo XLSX e JSON com mapeamento de categorias/entidades/contas/centros.
    """
    if not file.filename or not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser XLSX ou XLS"
        )
    
    try:
        mapeamento = json.loads(mapeamento_json)
        empresa_id, user_id = require_empresa_user(current_user, empresa_id)
        max_size = 10 * 1024 * 1024
        conteudo = file.file.read(max_size + 1)
        if len(conteudo) > max_size:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Arquivo excede o limite de 10 MB")
        return _execute_import_contents(db, conteudo, empresa_id, user_id, mapeamento)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar importação: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


@router.post(
    "/importar/executar-async",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def importar_executar_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mapeamento_json: str = Form(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo deve ser XLSX ou XLS")
    try:
        mapeamento = json.loads(mapeamento_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mapeamento inválido") from exc

    empresa_id, user_id = require_empresa_user(current_user, empresa_id)
    max_size = 10 * 1024 * 1024
    file_bytes = file.file.read(max_size + 1)
    if len(file_bytes) > max_size:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Arquivo excede o limite de 10 MB")
    job = _create_import_job(db, "EXECUTE", empresa_id, user_id, file.filename)
    background_tasks.add_task(_run_import_execute_job, job.job_id, empresa_id, user_id, file_bytes, mapeamento)
    return {"job_id": job.job_id, "status": job.status}