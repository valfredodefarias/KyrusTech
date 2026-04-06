"""
Serviço de integração com Asaas.
Sincroniza pagamentos e recebimentos do Asaas para o sistema.
"""
import time
import re
import requests
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation
from loguru import logger

from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.mapeamento_categoria import MapeamentoCategoria
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.crud.crud_integracao_bancaria import get_token_decrypted
from sqlmodel import Session, select
from sqlalchemy import func, or_


# URLs da API Asaas
ASAAS_API_PRODUCAO = "https://api.asaas.com/v3"
ASAAS_API_SANDBOX = "https://sandbox.asaas.com/api/v3"

ASAAS_DEFAULT_PAGE_LIMIT = 100
ASAAS_MAX_PAGES = 50
ASAAS_MAX_RETRIES = 4
ASAAS_REQUEST_PAUSE_SECONDS = 0.12
ASAAS_INCREMENTAL_REPROCESS_DAYS = 7
ASAAS_STATUS_PAGOS = {"RECEIVED", "CONFIRMED", "DONE", "RECEIVED_IN_CASH"}
ASAAS_STATUS_ABERTOS = {"PENDING", "AWAITING_PAYMENT", "OVERDUE"}
ASAAS_OBSERVACAO_ID_REGEXES = [
    re.compile(r"asaas\s*id\s*:\s*([A-Za-z0-9_\-]+)", re.IGNORECASE),
    re.compile(r"\bid\s*:\s*([A-Za-z0-9_\-]+)", re.IGNORECASE),
]
ASAAS_INTERESSADO_DESCRICAO_REGEXES = [
    re.compile(r"(?:cliente|customer|pagador)\s*:\s*([^\n|;,]+)", re.IGNORECASE),
]


def _quantize_brl(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _parse_asaas_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    date_part = raw[:10]
    try:
        return datetime.strptime(date_part, "%Y-%m-%d").date()
    except ValueError:
        return None


def _extract_asaas_transaction_date(item: Dict[str, Any]) -> Optional[date]:
    # Prioriza o campo date (financialTransactions), depois paymentDate/dueDate/dateCreated.
    for field_name in ("date", "paymentDate", "dueDate", "dateCreated"):
        parsed = _parse_asaas_date(item.get(field_name))
        if parsed:
            return parsed
    return None


def _extract_asaas_transaction_value(item: Dict[str, Any]) -> Decimal:
    raw_value = item.get("value", 0)
    try:
        return abs(Decimal(str(raw_value)))
    except (InvalidOperation, TypeError):
        return Decimal("0.00")


def _extract_asaas_transaction_flow(item: Dict[str, Any]) -> str:
    raw_value = item.get("value", 0)
    try:
        value_decimal = Decimal(str(raw_value))
    except (InvalidOperation, TypeError):
        value_decimal = Decimal("0.00")
    return "DESPESA" if value_decimal < 0 else "RECEITA"


def _extract_asaas_status(item: Dict[str, Any]) -> str:
    return str(item.get("status") or item.get("paymentStatus") or "").strip().upper()


def _is_asaas_paid(item: Dict[str, Any]) -> bool:
    status = _extract_asaas_status(item)
    if status in ASAAS_STATUS_PAGOS:
        return True
    return bool(_parse_asaas_date(item.get("paymentDate")))


def _extract_asaas_mapping_candidates(item: Dict[str, Any]) -> List[str]:
    candidates: List[str] = []
    for raw_value in (
        item.get("type"),
        item.get("transactionType"),
        item.get("transactionTypeCode"),
        item.get("billingType"),
        item.get("status"),
        item.get("paymentStatus"),
        "PAYMENT",
    ):
        value = str(raw_value or "").strip().upper()
        if value and value not in candidates:
            candidates.append(value)
    return candidates


def _normalize_description_key(value: Optional[str]) -> str:
    if value is None:
        return ""
    normalized = str(value).strip().upper()
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def _extract_asaas_customer_id(item: Dict[str, Any]) -> Optional[str]:
    raw_customer = item.get("customer")
    if isinstance(raw_customer, dict):
        raw_customer = raw_customer.get("id") or raw_customer.get("customer")
    customer_id = str(raw_customer or "").strip()
    return customer_id or None


def _extract_asaas_interessado_from_description(description: Optional[str]) -> Optional[str]:
    text = str(description or "").strip()
    if not text:
        return None

    for pattern in ASAAS_INTERESSADO_DESCRICAO_REGEXES:
        match = pattern.search(text)
        if not match:
            continue
        candidate = str(match.group(1) or "").strip().rstrip(".,;")
        if candidate:
            return candidate

    return None


def _is_generic_asaas_entity_name(name: Optional[str]) -> bool:
    normalized = _normalize_description_key(name)
    return "ASAAS" in normalized


def _fetch_asaas_customer_name(
    *,
    integracao: IntegracaoBancaria,
    access_token: Optional[str],
    customer_id: Optional[str],
    customer_name_cache: Dict[str, Optional[str]],
) -> Optional[str]:
    if not customer_id:
        return None

    if customer_id in customer_name_cache:
        return customer_name_cache[customer_id]

    if not access_token:
        customer_name_cache[customer_id] = None
        return None

    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": access_token,
        "Content-Type": "application/json",
    }

    try:
        payload = _request_asaas_json(
            url=f"{base_url}/customers/{customer_id}",
            headers=headers,
            params={},
        )
    except Exception as customer_error:
        logger.warning(
            "Nao foi possivel buscar customer {} no Asaas para integracao {}: {}",
            customer_id,
            integracao.id,
            customer_error,
        )
        customer_name_cache[customer_id] = None
        return None

    candidate = str(
        payload.get("name")
        or payload.get("company")
        or payload.get("email")
        or ""
    ).strip()
    resolved = candidate or None
    customer_name_cache[customer_id] = resolved
    return resolved


def _get_or_create_asaas_customer_entity(
    db: Session,
    *,
    empresa_id: int,
    customer_name: Optional[str],
) -> Optional[int]:
    name = str(customer_name or "").strip()
    if not name:
        return None

    normalized_name = _normalize_description_key(name)

    entidade = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
            func.upper(Entidade.nome) == normalized_name,
        )
    ).first()
    if entidade:
        return entidade.id

    nova_entidade = Entidade(
        nome=name,
        tipo="CLIENTE",
        cpf_cnpj=None,
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.flush()
    return nova_entidade.id


def _extract_asaas_ids_from_text(value: Optional[str]) -> List[str]:
    text = str(value or "").strip()
    if not text:
        return []
    ids: List[str] = []
    for pattern in ASAAS_OBSERVACAO_ID_REGEXES:
        for match in pattern.findall(text):
            identifier = str(match).strip()
            if identifier and identifier not in ids:
                ids.append(identifier)
    return ids


def _append_asaas_id_to_observacao(observacao_atual: Optional[str], asaas_id: Optional[str]) -> Optional[str]:
    if not asaas_id:
        return observacao_atual
    observacao = str(observacao_atual or "").strip()
    marker = f"Asaas ID: {asaas_id}"
    if asaas_id in observacao or marker.lower() in observacao.lower():
        return observacao or marker
    if not observacao:
        return marker
    return f"{observacao} | {marker}"


def _lancamento_tem_vinculo_asaas(lancamento: Lancamento) -> bool:
    if str(lancamento.origem or "").strip().upper() == "ASAAS":
        return True
    if str(lancamento.import_hash or "").strip().upper().startswith("ASAAS:"):
        return True
    return bool(_extract_asaas_ids_from_text(lancamento.observacao))


def _extract_asaas_id_from_lancamento(lancamento: Lancamento) -> Optional[str]:
    import_hash = str(lancamento.import_hash or "").strip()
    if import_hash.upper().startswith("ASAAS:"):
        extracted = import_hash.split(":", 1)[1].strip()
        if extracted:
            return extracted

    ids = _extract_asaas_ids_from_text(lancamento.observacao)
    if ids:
        return ids[0]

    return None


def _lancamento_vinculado_a_outro_asaas_id(lancamento: Lancamento, asaas_id: Optional[str]) -> bool:
    if not asaas_id:
        return False
    existing_id = _extract_asaas_id_from_lancamento(lancamento)
    return bool(existing_id and existing_id != asaas_id)


def _extract_lancamento_date(lancamento: Lancamento) -> Optional[date]:
    return lancamento.data_pagamento or lancamento.data_vencimento


def _extract_lancamento_value(lancamento: Lancamento) -> Decimal:
    valor_base = lancamento.valor_pago if (lancamento.data_pagamento and lancamento.valor_pago is not None) else lancamento.valor_previsto
    try:
        return abs(Decimal(str(valor_base or 0)))
    except (InvalidOperation, TypeError):
        return Decimal("0.00")


def _extract_lancamento_flow(lancamento: Lancamento) -> str:
    return "DESPESA" if str(lancamento.tipo or "").upper().startswith("D") else "RECEITA"


def _build_natural_key(data_ref: Optional[date], value_ref: Decimal, flow_ref: str) -> Optional[Tuple[str, str, str]]:
    if not data_ref:
        return None
    if value_ref <= 0:
        return None
    return (data_ref.isoformat(), _quantize_brl(abs(value_ref)), str(flow_ref or "").upper())


def _choose_best_existing_match(candidates: List[Lancamento], asaas_id: Optional[str] = None) -> Optional[Lancamento]:
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    def _rank(candidate: Lancamento) -> Tuple[int, int]:
        candidate_asaas_id = _extract_asaas_id_from_lancamento(candidate)
        if asaas_id and candidate_asaas_id and candidate_asaas_id == asaas_id:
            bucket = 0
        elif not _lancamento_tem_vinculo_asaas(candidate):
            bucket = 1
        elif candidate_asaas_id is None:
            # Legado com origem ASAAS sem ID: permite aproveitamento para manter cardinalidade.
            bucket = 2
        else:
            bucket = 3
        return (bucket, int(candidate.id or 0))

    ranked = sorted(
        candidates,
        key=_rank,
    )
    return ranked[0]


def _index_existing_lancamentos_for_sync(
    db: Session,
    integracao: IntegracaoBancaria,
    pagamentos: List[Dict[str, Any]],
) -> Tuple[Dict[str, List[Lancamento]], Dict[str, List[Lancamento]], Dict[Tuple[str, str, str], List[Lancamento]]]:
    payment_dates = [
        parsed
        for parsed in (_extract_asaas_transaction_date(item) for item in pagamentos)
        if parsed is not None
    ]

    by_import_hash: Dict[str, List[Lancamento]] = {}
    by_asaas_id: Dict[str, List[Lancamento]] = {}
    by_natural_key: Dict[Tuple[str, str, str], List[Lancamento]] = {}

    if not payment_dates:
        return by_import_hash, by_asaas_id, by_natural_key

    janela_inicio = min(payment_dates) - timedelta(days=3)
    janela_fim = max(payment_dates) + timedelta(days=3)

    filtros = [
        Lancamento.empresa_id == integracao.empresa_id,
        Lancamento.is_deleted == False,
        or_(
            Lancamento.data_pagamento >= janela_inicio,
            Lancamento.data_vencimento >= janela_inicio,
        ),
        or_(
            Lancamento.data_pagamento <= janela_fim,
            Lancamento.data_vencimento <= janela_fim,
        ),
    ]

    # Busca candidatos em toda a empresa (nao somente na conta vinculada)
    # para evitar duplicar historico que ja existe em outra conta/rotina de importacao.

    existentes = db.exec(
        select(Lancamento)
        .where(*filtros)
        .order_by(Lancamento.id.desc())
        .limit(20000)
    ).all()

    for lancamento in existentes:
        import_hash = str(lancamento.import_hash or "").strip()
        if import_hash:
            by_import_hash.setdefault(import_hash, []).append(lancamento)

        for asaas_id in _extract_asaas_ids_from_text(lancamento.observacao):
            by_asaas_id.setdefault(asaas_id, []).append(lancamento)

        natural_key = _build_natural_key(
            _extract_lancamento_date(lancamento),
            _extract_lancamento_value(lancamento),
            _extract_lancamento_flow(lancamento),
        )
        if natural_key:
            by_natural_key.setdefault(natural_key, []).append(lancamento)

    return by_import_hash, by_asaas_id, by_natural_key


def _safe_sleep(seconds: float) -> None:
    if seconds <= 0:
        return
    time.sleep(seconds)


def _request_asaas_json(
    *,
    url: str,
    headers: Dict[str, str],
    params: Dict[str, Any],
    timeout: int = 30,
) -> Dict[str, Any]:
    """
    Faz request GET para Asaas com retry para 429 usando RateLimit-Reset.
    """
    attempt = 0
    while True:
        attempt += 1
        response = requests.get(url, headers=headers, params=params, timeout=timeout)
        if response.status_code != 429:
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                return {"data": []}
            return payload

        if attempt > ASAAS_MAX_RETRIES:
            raise ValueError("Limite da API Asaas excedido. Tente novamente em alguns segundos.")

        wait_seconds = 2.0
        reset_header = response.headers.get("RateLimit-Reset")
        if reset_header:
            try:
                wait_seconds = max(1.0, float(reset_header))
            except ValueError:
                wait_seconds = 2.0

        logger.warning(
            "Asaas retornou 429 (tentativa {}/{}). Aguardando {}s antes de repetir.",
            attempt,
            ASAAS_MAX_RETRIES,
            wait_seconds,
        )
        _safe_sleep(wait_seconds)


def _fetch_paginated_asaas_data(
    *,
    url: str,
    headers: Dict[str, str],
    params: Dict[str, Any],
    page_limit: int,
    max_pages: int = ASAAS_MAX_PAGES,
) -> List[Dict[str, Any]]:
    """
    Busca dados paginados do Asaas usando limit/offset de forma sequencial.
    """
    effective_limit = max(1, min(page_limit, ASAAS_DEFAULT_PAGE_LIMIT))
    offset = int(params.get("offset", 0) or 0)
    page = 0
    all_items: List[Dict[str, Any]] = []

    while page < max_pages:
        request_params = {**params, "limit": effective_limit, "offset": offset}
        payload = _request_asaas_json(url=url, headers=headers, params=request_params)
        items = payload.get("data", [])
        if not isinstance(items, list):
            items = []

        all_items.extend(items)
        has_more = bool(payload.get("hasMore"))

        if not has_more or not items:
            break

        offset += len(items)
        page += 1
        _safe_sleep(ASAAS_REQUEST_PAUSE_SECONDS)

    return all_items


def _detectar_data_inicio_sincronizacao(
    db: Session,
    integracao: IntegracaoBancaria,
    data_fim: Optional[date],
) -> Tuple[Optional[date], Optional[date]]:
    """
    Determina data inicial do sync a partir do histórico local e do Asaas.

    Retorna:
      - data_inicio sugerida
      - data da última conciliação identificada
    """
    if not integracao.conta_id:
        return None, None

    # Caso já tenha importações do Asaas, continua do dia seguinte ao último importado.
    ultimo_importado = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == integracao.empresa_id,
            Lancamento.conta_id == integracao.conta_id,
            Lancamento.is_deleted == False,
            or_(
                Lancamento.origem == "ASAAS",
                Lancamento.import_hash.like("ASAAS:%"),
                Lancamento.observacao.ilike("%Asaas ID:%"),
            ),
        )
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).desc(), Lancamento.id.desc())
        .limit(1)
    ).first()

    if ultimo_importado:
        ultima_data = ultimo_importado.data_pagamento or ultimo_importado.data_vencimento
        if ultima_data:
            data_inicio_reprocessamento = ultima_data - timedelta(days=ASAAS_INCREMENTAL_REPROCESS_DAYS)
            logger.info(
                "Sync incremental Asaas: reprocessando janela de {} dia(s) a partir de {} (ultima data importada: {})",
                ASAAS_INCREMENTAL_REPROCESS_DAYS,
                data_inicio_reprocessamento,
                ultima_data,
            )
            return data_inicio_reprocessamento, ultima_data

    # Primeira carga: tenta conciliar com lançamentos já existentes na conta.
    janela_fim = data_fim or date.today()
    janela_inicio = janela_fim - timedelta(days=540)

    lancamentos_locais = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == integracao.empresa_id,
            Lancamento.conta_id == integracao.conta_id,
            Lancamento.is_deleted == False,
            or_(
                Lancamento.status == "PAGO",
                Lancamento.data_pagamento.is_not(None),
            ),
            or_(
                Lancamento.data_pagamento >= janela_inicio,
                Lancamento.data_vencimento >= janela_inicio,
            ),
        )
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).desc(), Lancamento.id.desc())
        .limit(5000)
    ).all()

    if not lancamentos_locais:
        return None, None

    local_by_date_value: Dict[date, set[str]] = {}
    local_by_date_value_flow: Dict[date, set[Tuple[str, str]]] = {}

    for lancamento in lancamentos_locais:
        data_local = lancamento.data_pagamento or lancamento.data_vencimento
        if not data_local:
            continue

        valor_base = lancamento.valor_pago if lancamento.data_pagamento else lancamento.valor_previsto
        try:
            valor_abs = abs(Decimal(str(valor_base or 0)))
        except (InvalidOperation, TypeError):
            continue

        if valor_abs <= 0:
            continue

        valor_key = _quantize_brl(valor_abs)
        flow_local = "DESPESA" if str(lancamento.tipo or "").upper().startswith("D") else "RECEITA"

        local_by_date_value.setdefault(data_local, set()).add(valor_key)
        local_by_date_value_flow.setdefault(data_local, set()).add((valor_key, flow_local))

    try:
        remotas = buscar_movimentacoes_financeiras_asaas(
            db=db,
            integracao=integracao,
            data_inicio=janela_inicio,
            data_fim=janela_fim,
            limit=ASAAS_DEFAULT_PAGE_LIMIT,
        )
    except Exception as exc:
        logger.warning(
            "Nao foi possivel conciliar data inicial com Asaas na primeira carga da integração {}: {}",
            integracao.id,
            exc,
        )
        return None, None

    remotas_ordenadas = sorted(
        remotas,
        key=lambda item: _extract_asaas_transaction_date(item) or date.min,
        reverse=True,
    )

    for movimentacao in remotas_ordenadas:
        data_mov = _extract_asaas_transaction_date(movimentacao)
        if not data_mov:
            continue

        valor_mov = _extract_asaas_transaction_value(movimentacao)
        if valor_mov <= 0:
            continue

        valor_key = _quantize_brl(valor_mov)
        flow_mov = _extract_asaas_transaction_flow(movimentacao)

        if data_mov in local_by_date_value_flow and (valor_key, flow_mov) in local_by_date_value_flow[data_mov]:
            return data_mov + timedelta(days=1), data_mov

        if data_mov in local_by_date_value and valor_key in local_by_date_value[data_mov]:
            return data_mov + timedelta(days=1), data_mov

    return None, None


def get_asaas_base_url(ambiente: str) -> str:
    """Retorna a URL base da API Asaas conforme o ambiente."""
    return ASAAS_API_SANDBOX if ambiente.upper() == "SANDBOX" else ASAAS_API_PRODUCAO


def buscar_movimentacoes_financeiras_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca movimentações financeiras RECEBIDAS do Asaas (incluindo tipos específicos).
    Retorna lista de movimentações com campo 'type' para mapeamento.
    Filtra apenas movimentações com status RECEIVED (pagos).
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params: Dict[str, Any] = {}
        
        if data_inicio:
            params["dateCreated[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["dateCreated[le]"] = data_fim.isoformat()
        
        # Busca movimentações financeiras (endpoint que retorna tipos)
        url = f"{base_url}/financialTransactions"
        logger.info(f"Buscando movimentações financeiras RECEBIDAS do Asaas: {url}")
        
        movimentacoes = _fetch_paginated_asaas_data(
            url=url,
            headers=headers,
            params=params,
            page_limit=limit,
        )
        
        # Filtra apenas movimentações RECEBIDAS (pagos)
        movimentacoes_recebidas: List[Dict[str, Any]] = []
        for item in movimentacoes:
            status = str(item.get("status") or item.get("paymentStatus") or "").upper()
            if status in {"", "RECEIVED", "CONFIRMED", "DONE"}:
                movimentacoes_recebidas.append(item)
        
        logger.success(f"Encontradas {len(movimentacoes_recebidas)} movimentações RECEBIDAS no Asaas")
        return movimentacoes_recebidas
        
    except requests.exceptions.RequestException as e:
        logger.warning(f"Erro ao buscar movimentações financeiras do Asaas (tentando payments): {e}")
        # Fallback para payments se o endpoint de financialTransactions não existir
        return buscar_pagamentos_asaas(db, integracao, data_inicio, data_fim, limit)
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar movimentações financeiras do Asaas: {e}")
        raise


def buscar_pagamentos_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca apenas pagamentos RECEBIDOS (pagos) do Asaas.
    
    Args:
        db: Sessão do banco
        integracao: Integração bancária configurada
        data_inicio: Data inicial para buscar (opcional)
        data_fim: Data final para buscar (opcional)
        limit: Limite de registros por página
        
    Returns:
        Lista de pagamentos RECEBIDOS do Asaas
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params: Dict[str, Any] = {
            "status": "RECEIVED"  # APENAS PAGAMENTOS RECEBIDOS (PAGOS)
        }
        
        if data_inicio:
            params["paymentDate[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["paymentDate[le]"] = data_fim.isoformat()
        
        url = f"{base_url}/payments"
        logger.info(f"Buscando pagamentos RECEBIDOS do Asaas: {url}")
        
        pagamentos = _fetch_paginated_asaas_data(
            url=url,
            headers=headers,
            params=params,
            page_limit=limit,
        )
        
        # Filtra apenas os que realmente estão RECEIVED (segurança extra)
        pagamentos_recebidos = [p for p in pagamentos if p.get("status") == "RECEIVED"]
        
        logger.success(f"Encontrados {len(pagamentos_recebidos)} pagamentos RECEBIDOS no Asaas")
        return pagamentos_recebidos
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar pagamentos do Asaas: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Resposta do Asaas: {e.response.text}")
        raise ValueError(f"Erro ao conectar com Asaas: {str(e)}")
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar pagamentos do Asaas: {e}")
        raise


def buscar_recebimentos_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100
) -> List[Dict]:
    """
    Busca recebimentos (cobranças pagas) do Asaas.
    Similar a buscar_pagamentos_asaas mas focado em recebimentos.
    """
    try:
        token = get_token_decrypted(db, integracao=integracao)
        base_url = get_asaas_base_url(integracao.ambiente)
        
        headers = {
            "access_token": token,
            "Content-Type": "application/json"
        }
        
        params: Dict[str, Any] = {
            "status": "RECEIVED"  # Apenas recebimentos confirmados
        }
        
        if data_inicio:
            params["paymentDate[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["paymentDate[le]"] = data_fim.isoformat()
        
        url = f"{base_url}/payments"
        logger.info(f"Buscando recebimentos do Asaas: {url}")
        
        recebimentos = _fetch_paginated_asaas_data(
            url=url,
            headers=headers,
            params=params,
            page_limit=limit,
        )
        
        logger.success(f"Encontrados {len(recebimentos)} recebimentos no Asaas")
        return recebimentos
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar recebimentos do Asaas: {e}")
        raise ValueError(f"Erro ao conectar com Asaas: {str(e)}")
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar recebimentos do Asaas: {e}")
        raise


def buscar_cobrancas_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """
    Busca cobranças (payments) no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    params: Dict[str, Any] = {}
    if status:
        params["status"] = status

    url = f"{base_url}/payments"
    logger.info(f"Buscando cobranças do Asaas: {url}")

    return _fetch_paginated_asaas_data(
        url=url,
        headers=headers,
        params=params,
        page_limit=limit,
    )


def buscar_assinaturas_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    status: Optional[str] = None,
    limit: int = 50
) -> List[Dict]:
    """
    Busca assinaturas no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    params: Dict[str, Any] = {}
    if status:
        params["status"] = status

    url = f"{base_url}/subscriptions"
    logger.info(f"Buscando assinaturas do Asaas: {url}")

    return _fetch_paginated_asaas_data(
        url=url,
        headers=headers,
        params=params,
        page_limit=limit,
    )


def buscar_saldo_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
) -> Dict[str, Optional[Decimal]]:
    """
    Busca saldo financeiro atual no Asaas.
    Tenta endpoints conhecidos para manter compatibilidade.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    endpoints = [
        f"{base_url}/finance/balance",
        f"{base_url}/financialTransactions/balance",
    ]

    payload: Optional[Dict[str, Any]] = None
    last_error: Optional[Exception] = None

    for endpoint in endpoints:
        try:
            payload = _request_asaas_json(url=endpoint, headers=headers, params={})
            if isinstance(payload, dict) and payload:
                break
        except Exception as exc:
            last_error = exc
            continue

    if not payload:
        if last_error:
            raise ValueError(f"Nao foi possivel consultar saldo no Asaas: {last_error}")
        raise ValueError("Nao foi possivel consultar saldo no Asaas")

    def _to_decimal(raw_value: Any) -> Optional[Decimal]:
        if raw_value is None:
            return None
        try:
            return Decimal(str(raw_value))
        except (InvalidOperation, TypeError, ValueError):
            return None

    saldo = _to_decimal(payload.get("balance"))
    saldo_bloqueado = _to_decimal(payload.get("blockedBalance"))
    saldo_disponivel = _to_decimal(payload.get("availableBalance"))

    if saldo is None and saldo_disponivel is not None:
        saldo = saldo_disponivel

    return {
        "saldo": saldo,
        "saldo_bloqueado": saldo_bloqueado,
        "saldo_disponivel": saldo_disponivel,
    }


def converter_pagamento_asaas_para_lancamento(
    db: Session,
    pagamento_asaas: Dict,
    integracao: IntegracaoBancaria,
    empresa_id: int,
    access_token: Optional[str] = None,
    customer_name_cache: Optional[Dict[str, Optional[str]]] = None,
) -> Dict:
    """
    Converte um pagamento do Asaas para o formato de lancamento do sistema.
    """
    tipo_movimentacao = (
        pagamento_asaas.get("type") or
        pagamento_asaas.get("transactionType") or
        pagamento_asaas.get("transactionTypeCode")
    )

    valor_bruto = Decimal(str(pagamento_asaas.get("value", 0)))
    tipo = "DESPESA" if valor_bruto < 0 else "RECEITA"
    plano_contas_id = None

    for candidate in _extract_asaas_mapping_candidates(pagamento_asaas):
        mapeamento_tipo = db.exec(
            select(MapeamentoCategoria).where(
                MapeamentoCategoria.integracao_id == integracao.id,
                func.upper(MapeamentoCategoria.categoria_externa) == candidate,
            )
        ).first()
        if mapeamento_tipo:
            plano_contas_id = mapeamento_tipo.plano_contas_id
            logger.info("Categoria mapeada por tipo/status {} -> {}", candidate, plano_contas_id)
            break

    if not plano_contas_id:
        categoria_externa = str(pagamento_asaas.get("description") or pagamento_asaas.get("externalReference") or "").strip().lower()
        if categoria_externa:
            mapeamento = db.exec(
                select(MapeamentoCategoria).where(
                    MapeamentoCategoria.integracao_id == integracao.id,
                    MapeamentoCategoria.categoria_externa.ilike(f"%{categoria_externa}%")
                )
            ).first()

            if mapeamento:
                plano_contas_id = mapeamento.plano_contas_id
                logger.info("Categoria mapeada por descricao {} -> {}", categoria_externa, plano_contas_id)

    if not plano_contas_id:
        if integracao.categoria_padrao_id:
            plano_contas_id = integracao.categoria_padrao_id
            logger.info("Usando categoria padrao da integracao: {}", plano_contas_id)
        elif integracao.usar_categoria_a_categorizar:
            categoria_a_categorizar = db.exec(
                select(PlanoContas).where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.nome.ilike("%categorizar%"),
                    PlanoContas.tipo == ("D" if tipo == "DESPESA" else "R")
                )
            ).first()

            if categoria_a_categorizar:
                plano_contas_id = categoria_a_categorizar.id
            else:
                categoria_a_categorizar = PlanoContas(
                    nome="A Categorizar",
                    tipo="D" if tipo == "DESPESA" else "R",
                    empresa_id=empresa_id,
                    permite_lancamentos=True
                )
                db.add(categoria_a_categorizar)
                db.commit()
                db.refresh(categoria_a_categorizar)
                plano_contas_id = categoria_a_categorizar.id
                logger.info("Categoria A Categorizar criada: {}", plano_contas_id)
        else:
            categoria_fallback = db.exec(
                select(PlanoContas).where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.tipo == ("D" if tipo == "DESPESA" else "R"),
                    PlanoContas.permite_lancamentos == True
                )
            ).first()

            if categoria_fallback:
                plano_contas_id = categoria_fallback.id
                logger.warning("Usando categoria fallback: {} ({})", categoria_fallback.nome, plano_contas_id)
            else:
                categoria_a_categorizar = PlanoContas(
                    nome="A Categorizar",
                    tipo="D" if tipo == "DESPESA" else "R",
                    empresa_id=empresa_id,
                    permite_lancamentos=True
                )
                db.add(categoria_a_categorizar)
                db.commit()
                db.refresh(categoria_a_categorizar)
                plano_contas_id = categoria_a_categorizar.id
                logger.warning("Criada categoria A Categorizar como ultimo recurso: {}", plano_contas_id)

    if not plano_contas_id:
        categoria_emergencia = db.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.permite_lancamentos == True
            ).limit(1)
        ).first()

        if categoria_emergencia:
            plano_contas_id = categoria_emergencia.id
            logger.warning("Usando categoria de emergencia: {} ({})", categoria_emergencia.nome, plano_contas_id)
        else:
            raise ValueError(
                "Nao foi possivel determinar categoria para lancamento do Asaas. "
                f"Tipo: {tipo}, Empresa: {empresa_id}."
            )

    data_vencimento = _parse_asaas_date(pagamento_asaas.get("dueDate"))
    data_pagamento = _parse_asaas_date(pagamento_asaas.get("paymentDate"))
    data_movimentacao = _extract_asaas_transaction_date(pagamento_asaas) or data_pagamento or data_vencimento or date.today()
    if data_vencimento is None:
        data_vencimento = data_movimentacao

    valor_absoluto = abs(valor_bruto)
    pago = _is_asaas_paid(pagamento_asaas)
    valor_pago = valor_absoluto if pago else Decimal("0.00")
    valor_previsto = valor_absoluto

    status_asaas = _extract_asaas_status(pagamento_asaas)
    status_final = "PAGO"
    if not pago:
        status_final = "EM ABERTO"
        if status_asaas == "OVERDUE":
            status_final = "ATRASADO"

    customer_cache = customer_name_cache if customer_name_cache is not None else {}
    customer_id = _extract_asaas_customer_id(pagamento_asaas)
    customer_name = _fetch_asaas_customer_name(
        integracao=integracao,
        access_token=access_token,
        customer_id=customer_id,
        customer_name_cache=customer_cache,
    )

    if not customer_name:
        customer_name = _extract_asaas_interessado_from_description(pagamento_asaas.get("description"))

    entidade_id = _get_or_create_asaas_customer_entity(
        db,
        empresa_id=empresa_id,
        customer_name=customer_name,
    )
    if not entidade_id:
        entidade_id = criar_entidade_banco_asaas(db, empresa_id)

    conta_id = integracao.conta_id
    centro_custo_id = integracao.centro_custo_id

    observacao_parts = [
        f"Asaas ID: {pagamento_asaas.get('id')}",
        f"Tipo: {tipo_movimentacao}",
    ]
    if customer_id:
        observacao_parts.append(f"Customer ID: {customer_id}")
    if customer_name:
        observacao_parts.append(f"Customer: {customer_name}")

    lancamento_data = {
        "descricao": pagamento_asaas.get("description", "Lancamento do Asaas"),
        "tipo": tipo,
        "status": status_final,
        "origem": "ASAAS",
        "valor_previsto": valor_previsto,
        "valor_pago": valor_pago,
        "data_vencimento": data_vencimento,
        "data_pagamento": data_pagamento if pago else None,
        "data_competencia": data_pagamento or data_vencimento or date.today(),
        "observacao": " | ".join(observacao_parts),
        "empresa_id": empresa_id,
        "plano_contas_id": plano_contas_id,
        "conta_id": conta_id,
        "centro_custo_id": centro_custo_id,
        "entidade_id": entidade_id,
        "ipp": False
    }

    return lancamento_data


def criar_entidade_banco_asaas(db: Session, empresa_id: int) -> Optional[int]:
    """
    Cria ou busca entidade do banco Asaas.
    Retorna o ID da entidade.
    """
    nome_banco = "Asaas"

    entidade = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.nome.ilike(f"%{nome_banco}%")
        )
    ).first()

    if entidade:
        return entidade.id

    nova_entidade = Entidade(
        nome=nome_banco,
        tipo="FORNECEDOR",
        cpf_cnpj=None,
        status="ATIVO",
        empresa_id=empresa_id
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)

    logger.info("Entidade do banco criada: {} (ID: {})", nova_entidade.nome, nova_entidade.id)
    return nova_entidade.id


def _pick_unmatched_candidate(candidates: List[Lancamento], used_ids: set[int]) -> Optional[Lancamento]:
    if not candidates:
        return None
    for candidate in candidates:
        candidate_id = int(candidate.id or 0)
        if candidate_id <= 0 or candidate_id not in used_ids:
            return candidate
    return candidates[0]


def sincronizar_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None
) -> Dict:
    """
    Sincroniza pagamentos e recebimentos do Asaas.
    Cria ou atualiza lancamentos no sistema.
    """
    logger.info("Iniciando sincronizacao Asaas para integracao ID: {}", integracao.id)

    try:
        data_inicio_utilizada = data_inicio
        data_ultima_conciliacao = None

        if data_inicio_utilizada is None:
            data_inicio_utilizada, data_ultima_conciliacao = _detectar_data_inicio_sincronizacao(
                db=db,
                integracao=integracao,
                data_fim=data_fim,
            )

        if data_inicio_utilizada and data_fim and data_inicio_utilizada > data_fim:
            from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao

            atualizar_ultima_sincronizacao(db, integracao=integracao, sucesso=True)
            return {
                "sucesso": True,
                "lancamentos_criados": 0,
                "lancamentos_atualizados": 0,
                "total_processado": 0,
                "erros": [],
                "data_inicio_utilizada": data_inicio_utilizada.isoformat(),
                "data_fim_utilizada": data_fim.isoformat(),
                "data_ultima_conciliacao": data_ultima_conciliacao.isoformat() if data_ultima_conciliacao else None,
                "observacao": "Nenhum novo lancamento para importar no periodo informado.",
            }

        pagamentos_pago: List[Dict[str, Any]] = []
        try:
            pagamentos_pago = buscar_movimentacoes_financeiras_asaas(
                db=db,
                integracao=integracao,
                data_inicio=data_inicio_utilizada,
                data_fim=data_fim,
                limit=ASAAS_DEFAULT_PAGE_LIMIT,
            )
        except Exception as movimentacao_error:
            logger.warning(
                "Falha ao buscar financialTransactions do Asaas para integracao {}. Usando fallback /payments. Erro: {}",
                integracao.id,
                movimentacao_error,
            )
            pagamentos_pago = buscar_pagamentos_asaas(
                db=db,
                integracao=integracao,
                data_inicio=data_inicio_utilizada,
                data_fim=data_fim,
                limit=ASAAS_DEFAULT_PAGE_LIMIT,
            )

        contas_abertas = buscar_cobrancas_asaas(
            db=db,
            integracao=integracao,
            status="PENDING",
            limit=ASAAS_DEFAULT_PAGE_LIMIT,
        )
        contas_atrasadas = buscar_cobrancas_asaas(
            db=db,
            integracao=integracao,
            status="OVERDUE",
            limit=ASAAS_DEFAULT_PAGE_LIMIT,
        )

        pagamentos_indexados: Dict[str, Dict[str, Any]] = {}
        for item in [*pagamentos_pago, *contas_abertas, *contas_atrasadas]:
            asaas_id = str(item.get("id") or "").strip()
            if not asaas_id:
                continue
            pagamentos_indexados[asaas_id] = item
        pagamentos = list(pagamentos_indexados.values())

        existing_by_import_hash, existing_by_asaas_id, existing_by_natural_key = _index_existing_lancamentos_for_sync(
            db=db,
            integracao=integracao,
            pagamentos=pagamentos,
        )
        token_para_customer: Optional[str] = None
        try:
            token_para_customer = get_token_decrypted(db, integracao=integracao)
        except Exception as token_error:
            logger.warning(
                "Nao foi possivel preparar token para buscar customers do Asaas na integracao {}: {}",
                integracao.id,
                token_error,
            )

        customer_name_cache: Dict[str, Optional[str]] = {}
        generic_asaas_entity_ids = {
            int(entidade_id)
            for entidade_id in db.exec(
                select(Entidade.id).where(
                    Entidade.empresa_id == integracao.empresa_id,
                    Entidade.is_deleted == False,
                    func.upper(Entidade.nome).like("%ASAAS%"),
                )
            ).all()
        }
        used_existing_ids: set[int] = set()

        lancamentos_criados = 0
        lancamentos_atualizados = 0
        erros: List[str] = []

        for pagamento in pagamentos:
            try:
                asaas_id_raw = pagamento.get("id")
                asaas_id = str(asaas_id_raw).strip() if asaas_id_raw else None
                tipo_mov = pagamento.get("type") or pagamento.get("transactionType") or pagamento.get("transactionTypeCode")
                logger.debug(
                    "Processando pagamento Asaas ID: {}, Tipo: {}, Status: {}",
                    asaas_id,
                    tipo_mov,
                    pagamento.get("status"),
                )

                lancamento_data = converter_pagamento_asaas_para_lancamento(
                    db=db,
                    pagamento_asaas=pagamento,
                    integracao=integracao,
                    empresa_id=integracao.empresa_id,
                    access_token=token_para_customer,
                    customer_name_cache=customer_name_cache,
                )

                import_hash = f"ASAAS:{asaas_id}" if asaas_id else None
                if import_hash:
                    lancamento_data["import_hash"] = import_hash

                data_ref = _extract_asaas_transaction_date(pagamento) or lancamento_data.get("data_pagamento") or lancamento_data.get("data_vencimento")
                valor_ref = _extract_asaas_transaction_value(pagamento)
                flow_ref = _extract_asaas_transaction_flow(pagamento)
                natural_key = _build_natural_key(data_ref, valor_ref, flow_ref)

                lancamento_existente: Optional[Lancamento] = None

                if import_hash:
                    lancamento_existente = _pick_unmatched_candidate(existing_by_import_hash.get(import_hash, []), used_existing_ids)

                if not lancamento_existente and asaas_id:
                    lancamento_existente = _pick_unmatched_candidate(existing_by_asaas_id.get(asaas_id, []), used_existing_ids)

                if not lancamento_existente and natural_key:
                    candidates = [
                        item
                        for item in existing_by_natural_key.get(natural_key, [])
                        if int(item.id or 0) <= 0 or int(item.id or 0) not in used_existing_ids
                    ]
                    lancamento_existente = _choose_best_existing_match(candidates, asaas_id=asaas_id)

                if lancamento_existente and lancamento_existente.id:
                    used_existing_ids.add(int(lancamento_existente.id))

                if lancamento_existente:
                    is_existing_asaas = _lancamento_tem_vinculo_asaas(lancamento_existente)

                    if is_existing_asaas:
                        if lancamento_data.get("plano_contas_id"):
                            lancamento_existente.plano_contas_id = lancamento_data.get("plano_contas_id")

                        lancamento_existente.valor_previsto = lancamento_data.get("valor_previsto", lancamento_existente.valor_previsto)
                        novo_valor_pago = lancamento_data.get("valor_pago")
                        if novo_valor_pago is not None:
                            lancamento_existente.valor_pago = novo_valor_pago
                        if lancamento_data.get("status") == "PAGO":
                            lancamento_existente.data_pagamento = lancamento_data.get("data_pagamento") or lancamento_existente.data_pagamento
                        else:
                            lancamento_existente.data_pagamento = None
                        lancamento_existente.data_vencimento = lancamento_data.get("data_vencimento") or lancamento_existente.data_vencimento
                        lancamento_existente.status = lancamento_data.get("status", lancamento_existente.status)
                        lancamento_existente.origem = "ASAAS"
                        lancamento_existente.data_competencia = (
                            lancamento_data.get("data_competencia")
                            or lancamento_existente.data_pagamento
                            or lancamento_existente.data_vencimento
                            or lancamento_existente.data_competencia
                        )

                    else:
                        if not lancamento_existente.data_pagamento and lancamento_data.get("data_pagamento"):
                            lancamento_existente.data_pagamento = lancamento_data.get("data_pagamento")
                        if not lancamento_existente.data_vencimento and lancamento_data.get("data_vencimento"):
                            lancamento_existente.data_vencimento = lancamento_data.get("data_vencimento")
                        if str(lancamento_existente.status or "").upper() != "PAGO" and lancamento_data.get("status"):
                            lancamento_existente.status = lancamento_data.get("status")

                    if integracao.conta_id and not lancamento_existente.conta_id:
                        lancamento_existente.conta_id = integracao.conta_id

                    if integracao.centro_custo_id and not lancamento_existente.centro_custo_id:
                        lancamento_existente.centro_custo_id = integracao.centro_custo_id

                    novo_entidade_id = lancamento_data.get("entidade_id")
                    if novo_entidade_id:
                        try:
                            novo_entidade_id_int = int(novo_entidade_id)
                        except (TypeError, ValueError):
                            novo_entidade_id_int = None

                        if not lancamento_existente.entidade_id:
                            if novo_entidade_id_int:
                                lancamento_existente.entidade_id = novo_entidade_id_int
                        else:
                            entidade_atual_id = int(lancamento_existente.entidade_id)
                            if (
                                novo_entidade_id_int
                                and entidade_atual_id in generic_asaas_entity_ids
                                and entidade_atual_id != novo_entidade_id_int
                            ):
                                lancamento_existente.entidade_id = novo_entidade_id_int

                    if is_existing_asaas and import_hash:
                        lancamento_existente.import_hash = import_hash
                        existing_by_import_hash.setdefault(import_hash, []).append(lancamento_existente)

                    if is_existing_asaas:
                        lancamento_existente.observacao = _append_asaas_id_to_observacao(lancamento_existente.observacao, asaas_id)
                        if asaas_id:
                            existing_by_asaas_id.setdefault(asaas_id, []).append(lancamento_existente)

                    if not lancamento_existente.plano_contas_id:
                        raise ValueError(f"Lancamento {lancamento_existente.id} nao pode ter plano_contas_id vazio")

                    db.add(lancamento_existente)
                    lancamentos_atualizados += 1
                    continue

                if not lancamento_data.get("conta_id") and integracao.conta_id:
                    lancamento_data["conta_id"] = integracao.conta_id

                if not lancamento_data.get("plano_contas_id"):
                    raise ValueError(
                        f"Nao e possivel criar lancamento sem plano_contas_id. Dados: {lancamento_data.get('descricao')}"
                    )

                lancamento_data["origem"] = "ASAAS"
                lancamento_data["observacao"] = _append_asaas_id_to_observacao(lancamento_data.get("observacao"), asaas_id)

                lancamento = Lancamento(**lancamento_data)
                db.add(lancamento)
                lancamentos_criados += 1

                if import_hash:
                    existing_by_import_hash.setdefault(import_hash, []).append(lancamento)
                if asaas_id:
                    existing_by_asaas_id.setdefault(asaas_id, []).append(lancamento)
                if natural_key:
                    existing_by_natural_key.setdefault(natural_key, []).append(lancamento)

            except Exception as item_error:
                logger.error("Erro ao processar pagamento Asaas {}: {}", pagamento.get("id"), item_error)
                erros.append(str(item_error))
                continue

        try:
            db.commit()
        except Exception as commit_error:
            logger.error("Erro ao fazer commit das mudancas: {}", commit_error)
            db.rollback()
            raise

        from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao

        atualizar_ultima_sincronizacao(db, integracao=integracao, sucesso=True)

        resultado = {
            "sucesso": True,
            "lancamentos_criados": lancamentos_criados,
            "lancamentos_atualizados": lancamentos_atualizados,
            "total_processado": len(pagamentos),
            "erros": erros,
            "data_inicio_utilizada": data_inicio_utilizada.isoformat() if data_inicio_utilizada else None,
            "data_fim_utilizada": data_fim.isoformat() if data_fim else None,
            "data_ultima_conciliacao": data_ultima_conciliacao.isoformat() if data_ultima_conciliacao else None,
        }

        logger.success(
            "Sincronizacao Asaas concluida para integracao {}: {} criados, {} atualizados.",
            integracao.id,
            lancamentos_criados,
            lancamentos_atualizados,
        )

        return resultado

    except Exception as e:
        logger.error("Erro na sincronizacao Asaas: {}", e)
        try:
            db.rollback()
        except Exception:
            pass

        try:
            from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao
            from app.models.integracao_bancaria import IntegracaoBancaria
            integracao_refreshed = db.get(IntegracaoBancaria, integracao.id)
            if integracao_refreshed:
                atualizar_ultima_sincronizacao(db, integracao=integracao_refreshed, sucesso=False)
        except Exception as update_error:
            logger.error("Erro ao atualizar ultima sincronizacao: {}", update_error)
            try:
                db.rollback()
            except Exception:
                pass

        raise



