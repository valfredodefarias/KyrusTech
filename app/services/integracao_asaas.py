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
from sqlmodel import Session, select, col
from sqlalchemy import func, or_, and_


# URLs da API Asaas
ASAAS_API_PRODUCAO = "https://api.asaas.com/v3"
ASAAS_API_SANDBOX = "https://sandbox.asaas.com/api/v3"

ASAAS_DEFAULT_PAGE_LIMIT = 100
ASAAS_MAX_PAGES = 50
ASAAS_MAX_RETRIES = 4
ASAAS_REQUEST_PAUSE_SECONDS = 0.12
ASAAS_INCREMENTAL_REPROCESS_DAYS = 1
ASAAS_STATUS_PAGOS = {"RECEIVED", "CONFIRMED", "DONE", "RECEIVED_IN_CASH"}
ASAAS_STATUS_ABERTOS = {"PENDING", "AWAITING_PAYMENT", "OVERDUE"}
ASAAS_OBSERVACAO_ID_REGEXES = [
    re.compile(r"asaas\s*id\s*:\s*([A-Za-z0-9_\-]+)", re.IGNORECASE),
    re.compile(r"\bid\s*:\s*([A-Za-z0-9_\-]+)", re.IGNORECASE),
]
ASAAS_INTERESSADO_DESCRICAO_REGEXES = [
    re.compile(r"(?:Cobrança recebida|Taxa de boleto|Taxa do Pix|Desconto na tarifa)\s*-\s*fatura\s+nr\.\s*\d+\s+(.+)", re.IGNORECASE),
    re.compile(r"(?:Transação|Transferência)\s+via\s+Pix\s+com\s+chave\s+para\s+(.+)", re.IGNORECASE),
    re.compile(r"(?:Transação|Transferência)\s+(?:via\s+Pix\s+)?para\s+(.+)", re.IGNORECASE),
    re.compile(r"Taxa de emissão da nota fiscal de serviço nr\.\s*\d+\s*-\s*(.+)", re.IGNORECASE),
    re.compile(r"(?:cliente|customer|pagador|favorecido)\s*:\s*([^\n|;,]+)", re.IGNORECASE),
]


def _quantize_brl(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _parse_asaas_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    raw = value.strip()
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


def _filter_asaas_items_by_interval(
    items: List[Dict[str, Any]],
    data_inicio: Optional[date],
    data_fim: Optional[date],
) -> List[Dict[str, Any]]:
    if not data_inicio and not data_fim:
        return items

    filtrados: List[Dict[str, Any]] = []
    for item in items:
        data_item = _extract_asaas_transaction_date(item)
        if not data_item:
            continue
        if data_inicio and data_item < data_inicio:
            continue
        if data_fim and data_item > data_fim:
            continue
        filtrados.append(item)

    return filtrados


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


def _is_asaas_financial_transaction_item(item: Dict[str, Any]) -> bool:
    return _parse_asaas_date(item.get("date")) is not None


def _is_asaas_paid(item: Dict[str, Any]) -> bool:
    status = _extract_asaas_status(item)
    if status in ASAAS_STATUS_PAGOS:
        return True

    payment_date = _parse_asaas_date(item.get("paymentDate"))
    if payment_date:
        return True

    # financialTransactions representam movimentacoes efetivadas; quando sem
    # paymentDate explicito, usa a data da transacao como data de liquidacao.
    if _is_asaas_financial_transaction_item(item):
        return status not in ASAAS_STATUS_ABERTOS

    return False


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


def _extract_primary_asaas_type(item: Dict[str, Any]) -> Optional[str]:
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
        if value:
            return value
    return None


def _normalize_description_key(value: Optional[str]) -> str:
    if value is None:
        return ""
    normalized = value.strip().upper()
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def _extract_asaas_customer_id(item: Dict[str, Any]) -> Optional[str]:
    raw_customer = item.get("customer")
    if isinstance(raw_customer, dict):
        raw_customer = raw_customer.get("id") or raw_customer.get("customer")
    customer_id = str(raw_customer or "").strip()
    return customer_id or None


def _extract_asaas_interessado_from_description(description: Optional[str]) -> Optional[str]:
    if not description:
        return None
    text = description.strip()
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


_asaas_customer_persistent_cache: Dict[str, tuple[Dict[str, Any], float]] = {}
_asaas_payment_persistent_cache: Dict[str, tuple[Dict[str, Any], float]] = {}


def _fetch_asaas_customer_data(
    *,
    integracao: IntegracaoBancaria,
    access_token: Optional[str],
    customer_id: Optional[str],
    customer_cache: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    if not customer_id:
        return {}

    if customer_id in customer_cache:
        return customer_cache[customer_id]

    now = time.time()
    if customer_id in _asaas_customer_persistent_cache:
        val, timestamp = _asaas_customer_persistent_cache[customer_id]
        if now - timestamp < 43200:  # 12 horas
            customer_cache[customer_id] = val
            return val

    if not access_token:
        customer_cache[customer_id] = {}
        return {}

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
        customer_cache[customer_id] = {}
        return {}

    candidate_name = str(payload.get("name") or payload.get("company") or "").strip()
    candidate_cpf = str(payload.get("cpfCnpj") or "").strip()
    candidate_email = str(payload.get("email") or "").strip()

    info = {
        "name": candidate_name or None,
        "cpfCnpj": candidate_cpf or None,
        "email": candidate_email or None,
    }
    customer_cache[customer_id] = info
    _asaas_customer_persistent_cache[customer_id] = (info, now)
    return info


def _fetch_asaas_customer_name(
    integracao: IntegracaoBancaria,
    access_token: Optional[str],
    customer_id: Optional[str],
    customer_name_cache: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    if not customer_id:
        return None
    cache: Dict[str, Dict[str, Any]] = {}
    data = _fetch_asaas_customer_data(
        integracao=integracao,
        access_token=access_token,
        customer_id=customer_id,
        customer_cache=cache,
    )
    name = data.get("name")
    if customer_name_cache is not None and name:
        customer_name_cache[customer_id] = name
    return name


def _fetch_asaas_payment_data(
    *,
    integracao: IntegracaoBancaria,
    access_token: Optional[str],
    payment_id: Optional[str],
    payment_cache: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    if not payment_id:
        return {}

    if payment_id in payment_cache:
        return payment_cache[payment_id]

    now = time.time()
    if payment_id in _asaas_payment_persistent_cache:
        val, timestamp = _asaas_payment_persistent_cache[payment_id]
        if now - timestamp < 43200:  # 12 horas
            payment_cache[payment_id] = val
            return val

    if not access_token:
        payment_cache[payment_id] = {}
        return {}

    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": access_token,
        "Content-Type": "application/json",
    }

    try:
        payload = _request_asaas_json(
            url=f"{base_url}/payments/{payment_id}",
            headers=headers,
            params={},
        )
    except Exception as payment_error:
        logger.warning(
            "Nao foi possivel buscar payment {} no Asaas para integracao {}: {}",
            payment_id,
            integracao.id,
            payment_error,
        )
        payment_cache[payment_id] = {}
        return {}

    payment_info = {
        "customer": str(payload.get("customer") or "").strip() or None,
        "description": str(payload.get("description") or "").strip() or None,
        "billingType": str(payload.get("billingType") or "").strip() or None,
    }
    payment_cache[payment_id] = payment_info
    _asaas_payment_persistent_cache[payment_id] = (payment_info, now)
    return payment_info


def _get_or_create_asaas_entity(
    db: Session,
    *,
    empresa_id: int,
    name: Optional[str],
    cpf_cnpj: Optional[str] = None,
    tipo: str = "CLIENTE",
) -> Optional[int]:
    clean_name = (name or "").strip()
    if not clean_name:
        return None

    normalized_name = _normalize_description_key(clean_name)
    clean_cpf_cnpj = re.sub(r"\D", "", cpf_cnpj or "") if cpf_cnpj else None

    entidade = None
    if clean_cpf_cnpj:
        entidade = db.exec(
            select(Entidade).where(
                Entidade.empresa_id == empresa_id,
                Entidade.is_deleted == False,
                Entidade.cpf_cnpj == clean_cpf_cnpj,
            )
        ).first()

    if not entidade:
        entidade = db.exec(
            select(Entidade).where(
                Entidade.empresa_id == empresa_id,
                Entidade.is_deleted == False,
                func.upper(Entidade.nome) == normalized_name,
            )
        ).first()

    if entidade:
        if clean_cpf_cnpj and not entidade.cpf_cnpj:
            entidade.cpf_cnpj = clean_cpf_cnpj
            db.add(entidade)
            db.flush()
        return entidade.id

    nova_entidade = Entidade(
        nome=clean_name,
        tipo=tipo,
        cpf_cnpj=clean_cpf_cnpj,
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.flush()
    return nova_entidade.id


def _extract_asaas_ids_from_text(value: Optional[str]) -> List[str]:
    if not value:
        return []
    text = value.strip()
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
    observacao = (observacao_atual or "").strip()
    marker = f"Asaas ID: {asaas_id}"
    if asaas_id in observacao or marker.lower() in observacao.lower():
        return observacao or marker
    if not observacao:
        return marker
    return f"{observacao} | {marker}"


def _lancamento_tem_vinculo_asaas(lancamento: Lancamento) -> bool:
    if (lancamento.origem or "").strip().upper() == "ASAAS":
        return True
    if (lancamento.import_hash or "").strip().upper().startswith("ASAAS:"):
        return True
    return bool(_extract_asaas_ids_from_text(lancamento.observacao))


def _extract_asaas_id_from_lancamento(lancamento: Lancamento) -> Optional[str]:
    import_hash = (lancamento.import_hash or "").strip()
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
    return "DESPESA" if (lancamento.tipo or "").upper().startswith("D") else "RECEITA"


def _build_natural_key(data_ref: Optional[date], value_ref: Decimal, flow_ref: str) -> Optional[Tuple[str, str, str]]:
    if not data_ref:
        return None
    if value_ref <= 0:
        return None
    return (data_ref.isoformat(), _quantize_brl(abs(value_ref)), flow_ref.upper())


def _choose_best_existing_match(candidates: List[Lancamento], asaas_id: Optional[str] = None) -> Optional[Lancamento]:
    if not candidates:
        return None
    filtered = [
        c for c in candidates
        if not _lancamento_vinculado_a_outro_asaas_id(c, asaas_id)
    ]
    if not filtered:
        return None
    if len(filtered) == 1:
        return filtered[0]

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
        return (bucket, candidate.id or 0)

    ranked = sorted(
        filtered,
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
            col(Lancamento.data_pagamento) >= janela_inicio,
            col(Lancamento.data_vencimento) >= janela_inicio,
        ),
        or_(
            col(Lancamento.data_pagamento) <= janela_fim,
            col(Lancamento.data_vencimento) <= janela_fim,
        ),
    ]

    # Busca candidatos em toda a empresa (nao somente na conta vinculada)
    # para evitar duplicar historico que ja existe em outra conta/rotina de importacao.

    existentes = db.exec(
        select(Lancamento)
        .where(*filtros)
        .order_by(col(Lancamento.id).desc())
        .limit(20000)
    ).all()

    for lancamento in existentes:
        import_hash = (lancamento.import_hash or "").strip()
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


def _post_asaas_json(
    *,
    url: str,
    headers: Dict[str, str],
    json_data: Dict[str, Any],
    timeout: int = 30,
) -> Dict[str, Any]:
    """
    Executa request POST para a API Asaas com parsing detalhado de mensagens de erro.
    """
    try:
        response = requests.post(url, headers=headers, json=json_data, timeout=timeout)
        if response.status_code >= 400:
            try:
                error_payload = response.json()
                errors = error_payload.get("errors", [])
                if errors and isinstance(errors, list):
                    msg = "; ".join([str(e.get("description") or e) for e in errors])
                else:
                    msg = error_payload.get("message") or response.text
            except Exception:
                msg = response.text
            raise ValueError(f"Asaas API ({response.status_code}): {msg}")
        return response.json()
    except requests.exceptions.RequestException as e:
        raise ValueError(f"Falha de conexão com Asaas: {str(e)}")


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

        if len(all_items) >= page_limit:
            all_items = all_items[:page_limit]
            break

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

    data_fim_referencia = data_fim or date.today()

    # Caso já tenha importações do Asaas, continua do dia seguinte ao último importado.
    ultimo_importado = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == integracao.empresa_id,
            Lancamento.conta_id == integracao.conta_id,
            Lancamento.is_deleted == False,
            or_(
                col(Lancamento.status) == "PAGO",
                col(Lancamento.data_pagamento).is_not(None),
            ),
            or_(
                col(Lancamento.data_pagamento) <= data_fim_referencia,
                col(Lancamento.data_vencimento) <= data_fim_referencia,
            ),
            or_(
                col(Lancamento.origem) == "ASAAS",
                col(Lancamento.import_hash).like("ASAAS:%"),
                col(Lancamento.observacao).ilike("%Asaas ID:%"),
            ),
        )
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).desc(), col(Lancamento.id).desc())
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
    janela_fim = data_fim_referencia
    janela_inicio = janela_fim - timedelta(days=540)

    lancamentos_locais = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == integracao.empresa_id,
            Lancamento.conta_id == integracao.conta_id,
            Lancamento.is_deleted == False,
            or_(
                col(Lancamento.status) == "PAGO",
                col(Lancamento.data_pagamento).is_not(None),
            ),
            or_(
                col(Lancamento.data_pagamento) >= janela_inicio,
                col(Lancamento.data_vencimento) >= janela_inicio,
            ),
            or_(
                col(Lancamento.data_pagamento) <= janela_fim,
                col(Lancamento.data_vencimento) <= janela_fim,
            ),
        )
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).desc(), col(Lancamento.id).desc())
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
        flow_local = "DESPESA" if (lancamento.tipo or "").upper().startswith("D") else "RECEITA"

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
    limit: int = 100,
    max_pages: int = ASAAS_MAX_PAGES,
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
            params["date[ge]"] = data_inicio.isoformat()
        if data_fim:
            params["date[le]"] = data_fim.isoformat()
        
        # Busca movimentações financeiras (endpoint que retorna tipos)
        url = f"{base_url}/financialTransactions"
        logger.info(f"Buscando movimentações financeiras RECEBIDAS do Asaas: {url}")
        
        movimentacoes = _fetch_paginated_asaas_data(
            url=url,
            headers=headers,
            params=params,
            page_limit=limit,
            max_pages=max_pages,
        )
        
        # Filtra apenas movimentações RECEBIDAS (pagos)
        movimentacoes_recebidas: List[Dict[str, Any]] = []
        for item in movimentacoes:
            status = str(item.get("status") or item.get("paymentStatus") or "").upper()
            if status in {"", "RECEIVED", "CONFIRMED", "DONE"}:
                movimentacoes_recebidas.append(item)

        movimentacoes_no_intervalo = _filter_asaas_items_by_interval(
            movimentacoes_recebidas,
            data_inicio=data_inicio,
            data_fim=data_fim,
        )

        if (data_inicio or data_fim) and len(movimentacoes_no_intervalo) != len(movimentacoes_recebidas):
            logger.info(
                "Filtro local de intervalo Asaas aplicado em financialTransactions: recebidas={}, no_intervalo={}, inicio={}, fim={}",
                len(movimentacoes_recebidas),
                len(movimentacoes_no_intervalo),
                data_inicio,
                data_fim,
            )
        
        logger.success(f"Encontradas {len(movimentacoes_no_intervalo)} movimentações RECEBIDAS no Asaas")
        return movimentacoes_no_intervalo
        
    except requests.exceptions.RequestException as e:
        logger.warning(f"Erro ao buscar movimentações financeiras do Asaas (tentando payments): {e}")
        # Fallback para payments se o endpoint de financialTransactions não existir
        return buscar_pagamentos_asaas(db, integracao, data_inicio, data_fim, limit, max_pages=max_pages)
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar movimentações financeiras do Asaas: {e}")
        raise


def buscar_pagamentos_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    limit: int = 100,
    max_pages: int = ASAAS_MAX_PAGES,
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
            max_pages=max_pages,
        )
        
        # Filtra apenas os que realmente estão RECEIVED (segurança extra)
        pagamentos_recebidos = [p for p in pagamentos if p.get("status") == "RECEIVED"]

        pagamentos_no_intervalo = _filter_asaas_items_by_interval(
            pagamentos_recebidos,
            data_inicio=data_inicio,
            data_fim=data_fim,
        )

        if (data_inicio or data_fim) and len(pagamentos_no_intervalo) != len(pagamentos_recebidos):
            logger.info(
                "Filtro local de intervalo Asaas aplicado em payments: recebidos={}, no_intervalo={}, inicio={}, fim={}",
                len(pagamentos_recebidos),
                len(pagamentos_no_intervalo),
                data_inicio,
                data_fim,
            )
        
        logger.success(f"Encontrados {len(pagamentos_no_intervalo)} pagamentos RECEBIDOS no Asaas")
        return pagamentos_no_intervalo
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar pagamentos do Asaas: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Resposta do Asaas: {e.response.text}")
        raise ValueError(f"Erro ao conectar com Asaas: {str(e)}")
    except Exception as e:
        logger.error(f"Erro inesperado ao buscar pagamentos do Asaas: {e}")
        raise


def listar_tipos_recentes_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    limit: int = 100,
) -> List[str]:
    """
    Retorna os códigos de tipo identificados nas últimas movimentações do Asaas.
    """
    limite = max(1, min(limit or 100, ASAAS_DEFAULT_PAGE_LIMIT))

    movimentacoes = buscar_movimentacoes_financeiras_asaas(
        db=db,
        integracao=integracao,
        data_inicio=None,
        data_fim=None,
        limit=limite,
        max_pages=1,
    )

    movimentacoes_ordenadas = sorted(
        movimentacoes,
        key=lambda item: _extract_asaas_transaction_date(item) or date.min,
        reverse=True,
    )[:limite]

    codigos: List[str] = []
    for item in movimentacoes_ordenadas:
        codigo = _extract_primary_asaas_type(item)
        if not codigo:
            continue
        if codigo not in codigos:
            codigos.append(codigo)

    return codigos


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
    customer_name_cache: Optional[Dict[str, Any]] = None,
    payment_cache: Optional[Dict[str, Any]] = None,
) -> Dict:
    """
    Converte um pagamento do Asaas para o formato de lancamento do sistema.
    """
    tipo_movimentacao = (
        pagamento_asaas.get("type") or
        pagamento_asaas.get("transactionType") or
        pagamento_asaas.get("transactionTypeCode")
    )
    if not tipo_movimentacao:
        tipo_movimentacao = _extract_primary_asaas_type(pagamento_asaas)

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
            logger.debug("Categoria mapeada por tipo/status {} -> {}", candidate, plano_contas_id)
            break

    if not plano_contas_id:
        categoria_externa = str(pagamento_asaas.get("description") or pagamento_asaas.get("externalReference") or "").strip().lower()
        if categoria_externa:
            mapeamento = db.exec(
                select(MapeamentoCategoria).where(
                    MapeamentoCategoria.integracao_id == integracao.id,
                    col(MapeamentoCategoria.categoria_externa).ilike(f"%{categoria_externa}%")
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
            categoria_a_categorizar = _ensure_categoria_a_categorizar_asaas(
                db=db,
                empresa_id=empresa_id,
                tipo_lancamento=tipo,
            )
            plano_contas_id = categoria_a_categorizar.id
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
                categoria_a_categorizar = _ensure_categoria_a_categorizar_asaas(
                    db=db,
                    empresa_id=empresa_id,
                    tipo_lancamento=tipo,
                )
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
    if pago and not data_pagamento:
        data_pagamento = data_movimentacao
    valor_pago = valor_absoluto if pago else Decimal("0.00")
    valor_previsto = valor_absoluto

    status_asaas = _extract_asaas_status(pagamento_asaas)
    status_final = "PAGO"
    if not pago:
        status_final = "EM ABERTO"
        if status_asaas == "OVERDUE":
            status_final = "ATRASADO"

    cust_cache = customer_name_cache if customer_name_cache is not None else {}
    pay_cache = payment_cache if payment_cache is not None else {}

    payment_id = pagamento_asaas.get("paymentId")
    payment_info: Dict[str, Any] = {}
    if payment_id:
        payment_info = _fetch_asaas_payment_data(
            integracao=integracao,
            access_token=access_token,
            payment_id=payment_id,
            payment_cache=pay_cache,
        )

    customer_id = _extract_asaas_customer_id(pagamento_asaas) or payment_info.get("customer")
    customer_info: Dict[str, Any] = {}
    if customer_id:
        customer_info = _fetch_asaas_customer_data(
            integracao=integracao,
            access_token=access_token,
            customer_id=customer_id,
            customer_cache=cust_cache,
        )

    customer_name = customer_info.get("name")
    customer_cpf_cnpj = customer_info.get("cpfCnpj")

    if not customer_name:
        customer_name = _extract_asaas_interessado_from_description(pagamento_asaas.get("description"))

    tipo_mov_upper = str(tipo_movimentacao or "").upper()
    is_fee = tipo_mov_upper in {"PAYMENT_FEE", "INVOICE_FEE", "TRANSFER_FEE", "BILL_FEE"}

    entidade_id = None
    if is_fee:
        entidade_id = criar_entidade_banco_asaas(db, empresa_id)
    elif tipo == "RECEITA":
        if customer_name:
            entidade_id = _get_or_create_asaas_entity(
                db,
                empresa_id=empresa_id,
                name=customer_name,
                cpf_cnpj=customer_cpf_cnpj,
                tipo="CLIENTE",
            )
        else:
            entidade_id = criar_entidade_banco_asaas(db, empresa_id)
    else:
        if customer_name:
            entidade_id = _get_or_create_asaas_entity(
                db,
                empresa_id=empresa_id,
                name=customer_name,
                cpf_cnpj=customer_cpf_cnpj,
                tipo="FORNECEDOR",
            )
        else:
            entidade_id = criar_entidade_banco_asaas(db, empresa_id)

    conta_id = integracao.conta_id
    centro_custo_id = integracao.centro_custo_id

    # Observacao: mantem limpo sem lixo tecnico de Asaas ID.
    observacao_real = payment_info.get("description") or pagamento_asaas.get("observations")
    if observacao_real and observacao_real.strip().lower() == str(pagamento_asaas.get("description") or "").strip().lower():
        observacao_real = None

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
        "observacao": observacao_real,
        "empresa_id": empresa_id,
        "plano_contas_id": plano_contas_id,
        "conta_id": conta_id,
        "centro_custo_id": centro_custo_id,
        "entidade_id": entidade_id,
        "ipp": False
    }

    return lancamento_data


def _ensure_categoria_a_categorizar_asaas(
    db: Session,
    *,
    empresa_id: int,
    tipo_lancamento: str,
) -> PlanoContas:
    tipo_normalizado = "D" if tipo_lancamento.upper() == "DESPESA" else "R"
    nome_categoria = "A Categorizar Despesa" if tipo_normalizado == "D" else "A Categorizar Receita"

    categoria = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.tipo == tipo_normalizado,
            func.upper(PlanoContas.nome) == nome_categoria.upper(),
        )
    ).first()

    if not categoria:
        categoria = PlanoContas(
            nome=nome_categoria,
            tipo=tipo_normalizado,
            empresa_id=empresa_id,
            permite_lancamentos=True,
            eh_operacional=False,
            considerar_nos_resultados=False,
            dre_grupo="NAO_OPERACIONAL",
            oculta=False,
        )
        db.add(categoria)
        db.flush()
        logger.info("Categoria Asaas criada para pendencias: {} ({})", nome_categoria, categoria.id)
        return categoria

    categoria.permite_lancamentos = True
    categoria.eh_operacional = False
    categoria.considerar_nos_resultados = False
    categoria.dre_grupo = "NAO_OPERACIONAL"
    categoria.oculta = False
    db.add(categoria)
    db.flush()
    return categoria


def criar_entidade_banco_asaas(db: Session, empresa_id: int) -> Optional[int]:
    """
    Cria ou busca entidade do banco Asaas.
    Retorna o ID da entidade.
    """
    nome_banco = "Asaas"

    entidade = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            col(Entidade.nome).ilike(f"%{nome_banco}%")
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
        candidate_id = candidate.id or 0
        if candidate_id <= 0 or candidate_id not in used_ids:
            return candidate
    return candidates[0]


def _obter_ultima_data_lancamento_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    data_inicio_minima: Optional[date] = None,
    data_fim_maxima: Optional[date] = None,
) -> Optional[date]:
    data_fim_referencia = data_fim_maxima or date.today()
    filtros = [
        Lancamento.empresa_id == integracao.empresa_id,
        Lancamento.is_deleted == False,
        or_(
            col(Lancamento.status) == "PAGO",
            col(Lancamento.data_pagamento).is_not(None),
        ),
        or_(
            col(Lancamento.data_pagamento) <= data_fim_referencia,
            col(Lancamento.data_vencimento) <= data_fim_referencia,
        ),
        or_(
            col(Lancamento.origem) == "ASAAS",
            col(Lancamento.import_hash).like("ASAAS:%"),
            col(Lancamento.observacao).ilike("%Asaas ID:%"),
        ),
    ]

    if integracao.conta_id:
        filtros.append(Lancamento.conta_id == integracao.conta_id)

    if data_inicio_minima:
        filtros.append(
            or_(
                col(Lancamento.data_pagamento) >= data_inicio_minima,
                col(Lancamento.data_vencimento) >= data_inicio_minima,
            )
        )

    ultimo_lancamento = db.exec(
        select(Lancamento)
        .where(*filtros)
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).desc(), col(Lancamento.id).desc())
        .limit(1)
    ).first()

    if not ultimo_lancamento:
        return None

    return ultimo_lancamento.data_pagamento or ultimo_lancamento.data_vencimento


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
        data_fim_utilizada = data_fim or date.today()
        data_inicio_configurada = integracao.data_inicio_sincronizacao
        data_inicio_utilizada = data_inicio
        data_ultima_conciliacao = None

        if data_inicio_configurada and (data_inicio_utilizada is None or data_inicio_utilizada < data_inicio_configurada):
            data_inicio_utilizada = data_inicio_configurada

        if data_inicio_utilizada is None:
            data_inicio_detectada, data_ultima_detectada = _detectar_data_inicio_sincronizacao(
                db=db,
                integracao=integracao,
                data_fim=data_fim_utilizada,
            )
            if data_inicio_detectada:
                data_inicio_utilizada = data_inicio_detectada
            data_ultima_conciliacao = data_ultima_detectada

        if data_inicio_configurada and data_inicio_utilizada and data_inicio_utilizada < data_inicio_configurada:
            data_inicio_utilizada = data_inicio_configurada

        if data_inicio is None:
            ultima_data_lancamentos = _obter_ultima_data_lancamento_asaas(
                db=db,
                integracao=integracao,
                data_inicio_minima=data_inicio_configurada or data_inicio_utilizada,
                data_fim_maxima=data_fim_utilizada,
            )
            if ultima_data_lancamentos:
                data_ultima_conciliacao = ultima_data_lancamentos
                candidato_inicio = ultima_data_lancamentos - timedelta(days=1)
                piso_inicio = data_inicio_configurada or data_inicio_utilizada
                if piso_inicio and candidato_inicio < piso_inicio:
                    candidato_inicio = piso_inicio
                if candidato_inicio > data_fim_utilizada:
                    candidato_inicio = data_fim_utilizada
                if data_inicio_utilizada is None or candidato_inicio > data_inicio_utilizada:
                    data_inicio_utilizada = candidato_inicio

        if data_inicio_utilizada and data_inicio_utilizada > data_fim_utilizada:
            from app.crud.crud_integracao_bancaria import atualizar_ultima_sincronizacao

            atualizar_ultima_sincronizacao(db, integracao=integracao, sucesso=True)
            return {
                "sucesso": True,
                "lancamentos_criados": 0,
                "lancamentos_atualizados": 0,
                "total_processado": 0,
                "erros": [],
                "data_inicio_utilizada": data_inicio_utilizada.isoformat(),
                "data_fim_utilizada": data_fim_utilizada.isoformat(),
                "data_ultima_conciliacao": data_ultima_conciliacao.isoformat() if data_ultima_conciliacao else None,
                "observacao": "Nenhum novo lancamento para importar no periodo informado.",
            }

        pagamentos_pago: List[Dict[str, Any]] = []
        try:
            pagamentos_pago = buscar_movimentacoes_financeiras_asaas(
                db=db,
                integracao=integracao,
                data_inicio=data_inicio_utilizada,
                data_fim=data_fim_utilizada,
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
                data_fim=data_fim_utilizada,
                limit=ASAAS_DEFAULT_PAGE_LIMIT,
            )

        pagamentos_indexados: Dict[str, Dict[str, Any]] = {}
        for item in pagamentos_pago:
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

        customer_name_cache: Dict[str, Dict[str, Any]] = {}
        payment_cache: Dict[str, Dict[str, Any]] = {}
        generic_asaas_entity_ids = {
            entidade_id
            for entidade_id in db.exec(
                select(Entidade.id).where(
                    Entidade.empresa_id == integracao.empresa_id,
                    Entidade.is_deleted == False,
                    col(Entidade.nome).ilike("%ASAAS%"),
                )
            ).all()
            if entidade_id is not None
        }
        used_existing_ids: set[int] = set()

        lancamentos_criados = 0
        lancamentos_atualizados = 0
        erros: List[str] = []

        for index_pagamento, pagamento in enumerate(pagamentos, start=1):
            try:
                asaas_id_raw = pagamento.get("id")
                asaas_id = str(asaas_id_raw).strip() if asaas_id_raw else None
                tipo_mov = pagamento.get("type") or pagamento.get("transactionType") or pagamento.get("transactionTypeCode")
                if index_pagamento <= 5:
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
                    payment_cache=payment_cache,
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
                        if not _lancamento_tem_vinculo_asaas(item)
                        and ((item.id or 0) <= 0 or (item.id or 0) not in used_existing_ids)
                    ]
                    lancamento_existente = _choose_best_existing_match(candidates, asaas_id=asaas_id)

                if lancamento_existente:

                    if lancamento_existente.id:
                        used_existing_ids.add(lancamento_existente.id)

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

                    if integracao.conta_id:
                        lancamento_existente.conta_id = integracao.conta_id

                    if integracao.centro_custo_id:
                        lancamento_existente.centro_custo_id = integracao.centro_custo_id

                    novo_entidade_id = lancamento_data.get("entidade_id")
                    if novo_entidade_id:
                        lancamento_existente.entidade_id = int(novo_entidade_id)

                    if import_hash:
                        lancamento_existente.import_hash = import_hash
                        existing_by_import_hash.setdefault(import_hash, []).append(lancamento_existente)

                    # Limpa observacao de lixo tecnico
                    if lancamento_data.get("observacao"):
                        lancamento_existente.observacao = lancamento_data.get("observacao")
                    elif lancamento_existente.observacao and "Asaas ID:" in lancamento_existente.observacao:
                        lancamento_existente.observacao = None

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
            "data_fim_utilizada": data_fim_utilizada.isoformat() if data_fim_utilizada else None,
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


# =====================================================================
# SERVIÇOS DEDICADOS AO APP ASAAS (DASHBOARD, COBRANÇAS, CLIENTES, PREVISÕES, GASTOS)
# =====================================================================

def criar_cobranca_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    cliente_nome: str,
    valor: Decimal,
    data_vencimento: date,
    cliente_cpf_cnpj: Optional[str] = None,
    cliente_email: Optional[str] = None,
    cliente_telefone: Optional[str] = None,
    descricao: Optional[str] = None,
    forma_pagamento: str = "UNDEFINED",
    criar_link: bool = False,
    max_parcelas: Optional[int] = 1,
) -> Dict[str, Any]:
    """
    Cria uma nova cobrança ou link de pagamento no Asaas.
    Se cliente não existir no Asaas, cadastra automaticamente.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    # Se for link de pagamento aberto
    if criar_link:
        payload_link = {
            "name": descricao or f"Cobrança - {cliente_nome}",
            "description": descricao or f"Pagamento gerado para {cliente_nome}",
            "billingType": forma_pagamento if forma_pagamento in {"BOLETO", "CREDIT_CARD", "PIX"} else "UNDEFINED",
            "chargeType": "DETACHED",
            "value": float(valor),
            "dueDateLimitDays": 30,
            "maxInstallmentCount": max(1, int(max_parcelas or 1)),
        }
        res_link = _post_asaas_json(
            url=f"{base_url}/paymentLinks",
            headers=headers,
            json_data=payload_link
        )
        return {
            "id": res_link.get("id"),
            "tipo": "LINK",
            "paymentLinkUrl": res_link.get("url"),
            "value": float(valor),
            "status": "ACTIVE",
            "descricao": descricao,
            "billingType": forma_pagamento,
        }

    # Busca ou cria cliente no Asaas
    customer_id = None
    clean_cpf = re.sub(r"\D", "", cliente_cpf_cnpj or "") if cliente_cpf_cnpj else None

    if clean_cpf:
        try:
            busca_cust = _request_asaas_json(
                url=f"{base_url}/customers",
                headers=headers,
                params={"cpfCnpj": clean_cpf}
            )
            data_cust = busca_cust.get("data", [])
            if data_cust and isinstance(data_cust, list):
                customer_id = data_cust[0].get("id")
        except Exception as e:
            logger.warning("Falha ao buscar cliente Asaas por CPF {}: {}", clean_cpf, e)

    if not customer_id:
        # Cadastra cliente no Asaas
        payload_cust: Dict[str, Any] = {
            "name": cliente_nome.strip(),
        }
        if clean_cpf:
            payload_cust["cpfCnpj"] = clean_cpf
        if cliente_email:
            payload_cust["email"] = cliente_email.strip()
        if cliente_telefone:
            payload_cust["mobilePhone"] = re.sub(r"\D", "", cliente_telefone)

        res_cust = _post_asaas_json(
            url=f"{base_url}/customers",
            headers=headers,
            json_data=payload_cust
        )
        customer_id = res_cust.get("id")

    if not customer_id:
        raise ValueError("Não foi possível identificar ou criar o cliente no Asaas")

    # Cria pagamento
    forma_normalizada = forma_pagamento.upper() if forma_pagamento else "UNDEFINED"
    if forma_normalizada not in {"BOLETO", "CREDIT_CARD", "PIX", "UNDEFINED"}:
        forma_normalizada = "UNDEFINED"

    payload_cobranca: Dict[str, Any] = {
        "customer": customer_id,
        "billingType": forma_normalizada,
        "value": float(valor),
        "dueDate": data_vencimento.isoformat(),
        "description": descricao or f"Cobrança {cliente_nome}",
    }

    res_cobranca = _post_asaas_json(
        url=f"{base_url}/payments",
        headers=headers,
        json_data=payload_cobranca
    )

    cobranca_id = res_cobranca.get("id")
    pix_qr = None
    pix_payload = None

    if res_cobranca.get("billingType") == "PIX" or forma_normalizada == "PIX":
        try:
            res_pix = _request_asaas_json(
                url=f"{base_url}/payments/{cobranca_id}/pixQrCode",
                headers=headers,
                params={}
            )
            pix_qr = res_pix.get("encodedImage")
            pix_payload = res_pix.get("payload")
        except Exception as e:
            logger.warning("Não foi possível gerar QR Code Pix Asaas: {}", e)

    return {
        "id": cobranca_id,
        "tipo": "COBRANCA",
        "customer": customer_id,
        "customerName": cliente_nome,
        "value": float(res_cobranca.get("value") or valor),
        "netValue": float(res_cobranca.get("netValue") or valor),
        "dueDate": res_cobranca.get("dueDate"),
        "status": res_cobranca.get("status", "PENDING"),
        "billingType": res_cobranca.get("billingType", forma_normalizada),
        "invoiceUrl": res_cobranca.get("invoiceUrl"),
        "bankSlipUrl": res_cobranca.get("bankSlipUrl"),
        "pixQrCode": pix_qr,
        "pixCopyPaste": pix_payload,
        "descricao": descricao,
    }


def confirmar_recebimento_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    payment_id: str,
    data_pagamento: Optional[date] = None,
    valor: Optional[Decimal] = None,
) -> Dict[str, Any]:
    """
    Confirma recebimento em dinheiro / manual de uma cobrança no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    payload: Dict[str, Any] = {
        "paymentDate": (data_pagamento or date.today()).isoformat(),
    }
    if valor:
        payload["value"] = float(valor)

    url = f"{base_url}/payments/{payment_id}/receiveInCash"
    return _post_asaas_json(url=url, headers=headers, json_data=payload)


def estornar_cobranca_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    payment_id: str,
    motivo: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Realiza o estorno de uma cobrança recebida no Asaas.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    payload = {"description": motivo or "Estorno solicitado pelo ERP"}
    url = f"{base_url}/payments/{payment_id}/refund"
    return _post_asaas_json(url=url, headers=headers, json_data=payload)


def obter_dashboard_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
) -> Dict[str, Any]:
    """
    Consolida métricas de alto nível do Asaas:
    - Saldo disponível, bloqueado e total
    - Total recebido, a receber (previsão) e vencido
    - Previsões de recebimento agrupadas por data
    - Mix de meios de pagamento (PIX, Boleto, Cartão)
    - Gastos e tarifas separados por categoria
    """
    # 1. Saldo da conta
    saldo_info = {"saldo": 0.0, "saldo_disponivel": 0.0, "saldo_bloqueado": 0.0}
    try:
        saldo_raw = buscar_saldo_asaas(db=db, integracao=integracao)
        saldo_info["saldo"] = float(saldo_raw.get("saldo") or 0)
        saldo_info["saldo_disponivel"] = float(saldo_raw.get("saldo_disponivel") or 0)
        saldo_info["saldo_bloqueado"] = float(saldo_raw.get("saldo_bloqueado") or 0)
    except Exception as e:
        logger.warning("Falha ao obter saldo Asaas para dashboard: {}", e)

    # 2. Busca pagamentos / cobranças recentes no Asaas
    cobrancas: List[Dict[str, Any]] = []
    try:
        cobrancas = buscar_cobrancas_asaas(db=db, integracao=integracao, limit=100)
    except Exception as e:
        logger.warning("Falha ao buscar pagamentos Asaas para dashboard: {}", e)

    token = None
    try:
        token = get_token_decrypted(db, integracao=integracao)
    except Exception:
        pass

    customer_cache: Dict[str, Dict[str, Any]] = {}

    # 3. Métricas de recebimento e faturamento
    total_faturado = Decimal("0.00")
    total_recebido = Decimal("0.00")
    total_a_receber = Decimal("0.00")
    total_vencido = Decimal("0.00")
    total_taxas = Decimal("0.00")

    qtd_recebidas = 0
    qtd_pendentes = 0
    qtd_vencidas = 0

    distribuicao_meios: Dict[str, Dict[str, Any]] = {
        "PIX": {"valor": 0.0, "qtd": 0, "pct": 0.0},
        "BOLETO": {"valor": 0.0, "qtd": 0, "pct": 0.0},
        "CREDIT_CARD": {"valor": 0.0, "qtd": 0, "pct": 0.0},
        "OUTROS": {"valor": 0.0, "qtd": 0, "pct": 0.0},
    }

    previsoes_map: Dict[str, Dict[str, Any]] = {}

    MESES_PT = {
        "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
        "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
        "09": "Set", "10": "Out", "11": "Nov", "12": "Dez"
    }
    evolucao_map: Dict[str, Dict[str, Any]] = {}

    for c in cobrancas:
        status = str(c.get("status") or "").upper()
        billing_type = str(c.get("billingType") or "").upper()
        if billing_type not in distribuicao_meios:
            billing_type = "OUTROS"

        try:
            val = Decimal(str(c.get("value") or 0))
        except Exception:
            val = Decimal("0.00")

        try:
            net_val = Decimal(str(c.get("netValue") or val))
        except Exception:
            net_val = val

        taxa_item = max(Decimal("0.00"), val - net_val)

        # Resolução rápida do nome e CPF/CNPJ do cliente com cache
        cust_id = c.get("customer")
        cust_info: Dict[str, Any] = {}
        if cust_id:
            cust_info = _fetch_asaas_customer_data(
                integracao=integracao,
                access_token=token,
                customer_id=str(cust_id),
                customer_cache=customer_cache,
            )
        cust_name = cust_info.get("name") or str(c.get("description") or "Cliente Asaas")
        cust_cpf = cust_info.get("cpfCnpj")

        # Agrupamento da Evolução Mensal (Recebidos / Pagos, Em Atraso e Aguardando)
        data_ref = str(c.get("paymentDate") or c.get("dueDate") or c.get("dateCreated") or "")[:10]
        if len(data_ref) >= 7:
            ano_mes = data_ref[:7]
            if ano_mes not in evolucao_map:
                partes = ano_mes.split("-")
                ano_s = partes[0]
                mes_s = partes[1] if len(partes) > 1 else "01"
                evolucao_map[ano_mes] = {
                    "mes": ano_mes,
                    "mes_label": f"{MESES_PT.get(mes_s, mes_s)}/{ano_s[2:]}",
                    "pago": 0.0,
                    "atrasado": 0.0,
                    "aguardando": 0.0,
                    "total": 0.0,
                    "qtd_pago": 0,
                    "qtd_atrasado": 0,
                    "qtd_aguardando": 0,
                }

            if status in ASAAS_STATUS_PAGOS:
                evolucao_map[ano_mes]["pago"] += float(net_val)
                evolucao_map[ano_mes]["total"] += float(net_val)
                evolucao_map[ano_mes]["qtd_pago"] += 1
            elif status == "OVERDUE":
                evolucao_map[ano_mes]["atrasado"] += float(val)
                evolucao_map[ano_mes]["total"] += float(val)
                evolucao_map[ano_mes]["qtd_atrasado"] += 1
            elif status in {"PENDING", "AWAITING_PAYMENT"}:
                evolucao_map[ano_mes]["aguardando"] += float(val)
                evolucao_map[ano_mes]["total"] += float(val)
                evolucao_map[ano_mes]["qtd_aguardando"] += 1

        if status in ASAAS_STATUS_PAGOS:
            total_faturado += val
            total_recebido += net_val
            total_taxas += taxa_item
            qtd_recebidas += 1
            distribuicao_meios[billing_type]["valor"] += float(val)
            distribuicao_meios[billing_type]["qtd"] += 1
        elif status in {"PENDING", "AWAITING_PAYMENT"}:
            total_a_receber += val
            qtd_pendentes += 1
            # Previsão futura discriminada com cliente e descrição
            due_date = str(c.get("dueDate") or c.get("paymentDate") or "")[:10]
            if due_date:
                if due_date not in previsoes_map:
                    previsoes_map[due_date] = {
                        "data": due_date,
                        "valor_bruto": 0.0,
                        "taxa_estimada": 0.0,
                        "valor_liquido": 0.0,
                        "qtd": 0,
                        "itens": [],
                    }
                taxa_est = float(taxa_item or (val * Decimal("0.0199")))
                liq_est = float(net_val or (val * Decimal("0.9801")))
                previsoes_map[due_date]["valor_bruto"] += float(val)
                previsoes_map[due_date]["taxa_estimada"] += taxa_est
                previsoes_map[due_date]["valor_liquido"] += liq_est
                previsoes_map[due_date]["qtd"] += 1
                previsoes_map[due_date]["itens"].append({
                    "id": str(c.get("id") or ""),
                    "cliente": cust_name,
                    "cliente_cpf_cnpj": cust_cpf,
                    "descricao": str(c.get("description") or f"Cobrança {billing_type}"),
                    "valor_bruto": round(float(val), 2),
                    "taxa_estimada": round(taxa_est, 2),
                    "valor_liquido": round(liq_est, 2),
                    "meio": billing_type,
                    "status": status,
                    "invoice_url": c.get("invoiceUrl") or c.get("bankSlipUrl"),
                    "due_date": due_date,
                })
        elif status == "OVERDUE":
            total_vencido += val
            qtd_vencidas += 1

    # Normaliza percentuais de meios de pagamento
    faturado_float = float(total_faturado)
    if faturado_float > 0:
        for k in distribuicao_meios:
            distribuicao_meios[k]["pct"] = round((distribuicao_meios[k]["valor"] / faturado_float) * 100, 1)

    # 4. Gastos por categoria a partir dos lançamentos e transações
    gastos_categorias: Dict[str, Dict[str, Any]] = {
        "PIX_FEE": {"categoria": "Tarifas de Liquidação Pix", "valor": 0.0, "qtd": 0},
        "BOLETO_FEE": {"categoria": "Tarifas de Emissão / Boleto", "valor": 0.0, "qtd": 0},
        "CREDIT_CARD_FEE": {"categoria": "Tarifas Cartão e Antecipações", "valor": 0.0, "qtd": 0},
        "MESSAGING_FEE": {"categoria": "Tarifas de Notificação / Mensageria", "valor": 0.0, "qtd": 0},
        "REFUND": {"categoria": "Estornos e Cancelamentos", "valor": 0.0, "qtd": 0},
        "OUTRAS_TARIFAS": {"categoria": "Outras Tarifas Operacionais", "valor": 0.0, "qtd": 0},
    }

    # Busca lançamentos de despesa do Asaas na base local para categorização apurada
    lancamentos_despesa = db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == integracao.empresa_id,
            col(Lancamento.origem) == "ASAAS",
            col(Lancamento.tipo) == "DESPESA",
            Lancamento.is_deleted == False,
        )
    ).all()

    total_gastos_locais = Decimal("0.00")
    for lanc in lancamentos_despesa:
        val_desp = Decimal(str(lanc.valor_pago or lanc.valor_previsto or 0))
        total_gastos_locais += val_desp
        desc = (lanc.descricao or "").upper()
        obs = (lanc.observacao or "").upper()
        texto = f"{desc} {obs}"

        if "PIX" in texto:
            key = "PIX_FEE"
        elif "BOLETO" in texto or "BANK_SLIP" in texto:
            key = "BOLETO_FEE"
        elif "CARTAO" in texto or "CARD" in texto or "CREDIT" in texto:
            key = "CREDIT_CARD_FEE"
        elif "NOTIFICA" in texto or "SMS" in texto or "WHATS" in texto:
            key = "MESSAGING_FEE"
        elif "REFUND" in texto or "ESTORNO" in texto or "CANCEL" in texto:
            key = "REFUND"
        else:
            key = "OUTRAS_TARIFAS"

        gastos_categorias[key]["valor"] += float(val_desp)
        gastos_categorias[key]["qtd"] += 1

    # Se não houver despesas locais mas houver taxas apuradas em cobranças
    if total_gastos_locais == 0 and total_taxas > 0:
        gastos_categorias["OUTRAS_TARIFAS"]["valor"] = float(total_taxas)
        gastos_categorias["OUTRAS_TARIFAS"]["qtd"] = qtd_recebidas

    total_gastos_total = float(total_gastos_locais) if total_gastos_locais > 0 else float(total_taxas)

    gastos_lista: List[Dict[str, Any]] = []
    for cod, g in gastos_categorias.items():
        if g["valor"] > 0:
            pct = round((g["valor"] / total_gastos_total * 100), 1) if total_gastos_total > 0 else 0.0
            gastos_lista.append({
                "codigo": cod,
                "categoria": g["categoria"],
                "valor": round(g["valor"], 2),
                "qtd": g["qtd"],
                "percentual": pct,
            })
    gastos_lista.sort(key=lambda x: x["valor"], reverse=True)

    # Ordena previsões cronologicamente
    previsoes_ordenadas = sorted(previsoes_map.values(), key=lambda x: x["data"])[:15]
    for p in previsoes_ordenadas:
        p["valor_bruto"] = round(p["valor_bruto"], 2)
        p["taxa_estimada"] = round(p["taxa_estimada"], 2)
        p["valor_liquido"] = round(p["valor_liquido"], 2)

    # Ordena evolução mensal cronologicamente (últimos 8 meses)
    evolucao_ordenada = sorted(evolucao_map.values(), key=lambda x: x["mes"])[-8:]
    for e in evolucao_ordenada:
        e["pago"] = round(e["pago"], 2)
        e["atrasado"] = round(e["atrasado"], 2)
        e["aguardando"] = round(e["aguardando"], 2)
        e["total"] = round(e["total"], 2)

    # 5. Extrato Recente e Lançamentos Vinculados
    filtros_extrato = [
        Lancamento.empresa_id == integracao.empresa_id,
        Lancamento.is_deleted == False,
    ]
    if integracao.conta_id:
        filtros_extrato.append(
            or_(
                col(Lancamento.origem) == "ASAAS",
                col(Lancamento.conta_id) == integracao.conta_id,
            )
        )
    else:
        filtros_extrato.append(col(Lancamento.origem) == "ASAAS")

    stmt_extrato = (
        select(Lancamento)
        .where(*filtros_extrato)
        .order_by(col(Lancamento.data_pagamento).desc().nullslast(), col(Lancamento.data_vencimento).desc(), col(Lancamento.id).desc())
        .limit(25)
    )
    lancamentos_extrato = db.exec(stmt_extrato).all()

    extrato_recente: List[Dict[str, Any]] = []
    for l in lancamentos_extrato:
        val = float(l.valor_pago or l.valor_previsto or 0)
        dt = l.data_pagamento or l.data_vencimento
        plano_nome = l.plano_contas.nome if l.plano_contas else "Geral / Não Categorizado"
        ent_nome = l.entidade.nome if l.entidade else None

        extrato_recente.append({
            "id": l.id,
            "descricao": l.descricao,
            "tipo": l.tipo,
            "status": l.status,
            "valor": round(val, 2),
            "data": dt.isoformat() if dt else None,
            "categoria_id": l.plano_contas_id,
            "categoria_nome": plano_nome,
            "entidade_nome": ent_nome,
            "observacao": l.observacao,
            "conciliado": bool(l.conciliado),
            "origem": l.origem,
        })

    taxa_media_efetiva = (
        round((total_gastos_total / faturado_float) * 100, 2)
        if faturado_float > 0 else 0.0
    )

    return {
        "saldo": saldo_info,
        "kpis": {
            "total_faturado": round(float(total_faturado), 2),
            "total_recebido": round(float(total_recebido), 2),
            "total_a_receber": round(float(total_a_receber), 2),
            "total_vencido": round(float(total_vencido), 2),
            "total_gastos": round(total_gastos_total, 2),
            "taxa_media_efetiva": taxa_media_efetiva,
            "qtd_recebidas": qtd_recebidas,
            "qtd_pendentes": qtd_pendentes,
            "qtd_vencidas": qtd_vencidas,
            "qtd_total": len(cobrancas),
        },
        "distribuicao_meios": distribuicao_meios,
        "previsoes_timeline": previsoes_ordenadas,
        "gastos_por_categoria": gastos_lista,
        "evolucao_mensal": evolucao_ordenada,
        "extrato_recente": extrato_recente,
    }


def obter_lancamentos_contexto_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    contexto: Optional[str] = None,
    mes: Optional[str] = None,
    categoria_codigo: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    Retorna lista de lançamentos ERP vinculados ao contexto selecionado no Asaas
    (RECEBIDO, ATRASADO, PREVISAO, TARIFAS, SALDO, EXTRATO, TODOS).
    """
    condicoes = [
        Lancamento.empresa_id == integracao.empresa_id,
        Lancamento.is_deleted == False,
    ]
    if integracao.conta_id:
        condicoes.append(
            or_(
                col(Lancamento.origem) == "ASAAS",
                col(Lancamento.conta_id) == integracao.conta_id,
            )
        )
    else:
        condicoes.append(col(Lancamento.origem) == "ASAAS")

    ctx = (contexto or "TODOS").upper().strip()
    hoje = date.today()

    if ctx == "RECEBIDO":
        condicoes.append(col(Lancamento.tipo) == "RECEITA")
        condicoes.append(
            or_(
                col(Lancamento.status).in_(["PAGO", "LIQUIDADO", "RECEBIDO", "CONFIRMADO"]),
                col(Lancamento.valor_pago) > 0,
            )
        )
    elif ctx == "ATRASADO":
        condicoes.append(col(Lancamento.tipo) == "RECEITA")
        condicoes.append(
            or_(
                col(Lancamento.status).in_(["ATRASADO", "VENCIDO", "OVERDUE"]),
                and_(
                    col(Lancamento.status).in_(["EM ABERTO", "PENDENTE"]),
                    col(Lancamento.data_vencimento) < hoje,
                ),
            )
        )
    elif ctx == "PREVISAO":
        condicoes.append(col(Lancamento.tipo) == "RECEITA")
        condicoes.append(
            or_(
                and_(
                    col(Lancamento.status).in_(["EM ABERTO", "PENDENTE", "PREVISTO"]),
                    col(Lancamento.data_vencimento) >= hoje,
                ),
                col(Lancamento.previsto) == True,
            )
        )
    elif ctx == "TARIFAS":
        condicoes.append(col(Lancamento.tipo) == "DESPESA")
        if categoria_codigo:
            cat_up = categoria_codigo.upper()
            if "PIX" in cat_up:
                condicoes.append(func.upper(Lancamento.descricao).like("%PIX%"))
            elif "BOLETO" in cat_up:
                condicoes.append(func.upper(Lancamento.descricao).like("%BOLETO%"))
            elif "CARD" in cat_up or "CARTAO" in cat_up:
                condicoes.append(or_(
                    func.upper(Lancamento.descricao).like("%CARTAO%"),
                    func.upper(Lancamento.descricao).like("%CARD%"),
                ))

    if mes and len(mes) == 7:
        ano_str, mes_str = mes.split("-")
        try:
            ano_i = int(ano_str)
            mes_i = int(mes_str)
            inicio_mes = date(ano_i, mes_i, 1)
            if mes_i == 12:
                fim_mes = date(ano_i + 1, 1, 1) - timedelta(days=1)
            else:
                fim_mes = date(ano_i, mes_i + 1, 1) - timedelta(days=1)

            condicoes.append(
                or_(
                    and_(col(Lancamento.data_pagamento) != None, col(Lancamento.data_pagamento) >= inicio_mes, col(Lancamento.data_pagamento) <= fim_mes),
                    and_(col(Lancamento.data_vencimento) >= inicio_mes, col(Lancamento.data_vencimento) <= fim_mes),
                    and_(col(Lancamento.data_competencia) >= inicio_mes, col(Lancamento.data_competencia) <= fim_mes),
                )
            )
        except Exception:
            pass

    stmt = (
        select(Lancamento)
        .where(*condicoes)
        .order_by(col(Lancamento.data_pagamento).desc().nullslast(), col(Lancamento.data_vencimento).desc(), col(Lancamento.id).desc())
        .limit(min(limit, 200))
    )
    resultado = db.exec(stmt).all()

    lancamentos_formatados: List[Dict[str, Any]] = []
    for l in resultado:
        val = float(l.valor_pago or l.valor_previsto or 0)
        dt = l.data_pagamento or l.data_vencimento
        lancamentos_formatados.append({
            "id": l.id,
            "descricao": l.descricao,
            "tipo": l.tipo,
            "status": l.status,
            "valor": round(val, 2),
            "valor_previsto": float(l.valor_previsto or 0),
            "valor_pago": float(l.valor_pago or 0),
            "data": dt.isoformat() if dt else None,
            "data_vencimento": l.data_vencimento.isoformat() if l.data_vencimento else None,
            "data_pagamento": l.data_pagamento.isoformat() if l.data_pagamento else None,
            "categoria_id": l.plano_contas_id,
            "categoria_nome": l.plano_contas.nome if l.plano_contas else "Geral",
            "entidade_id": l.entidade_id,
            "entidade_nome": l.entidade.nome if l.entidade else None,
            "observacao": l.observacao,
            "conciliado": bool(l.conciliado),
            "origem": l.origem,
        })
    return lancamentos_formatados



def buscar_cobrancas_gerencial_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    status: Optional[str] = None,
    billing_type: Optional[str] = None,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
    search: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    Retorna lista enriquecida de cobranças do Asaas com filtros gerenciais e somatórios.
    """
    cobrancas_raw = buscar_cobrancas_asaas(
        db=db,
        integracao=integracao,
        status=status,
        limit=min(limit, 100)
    )

    token = None
    try:
        token = get_token_decrypted(db, integracao=integracao)
    except Exception:
        pass

    customer_cache: Dict[str, Dict[str, Any]] = {}
    enriched: List[Dict[str, Any]] = []

    total_bruto = Decimal("0.00")
    total_liquido = Decimal("0.00")
    total_taxas = Decimal("0.00")

    search_term = (search or "").strip().lower()

    for item in cobrancas_raw:
        item_status = str(item.get("status") or "").upper()
        item_billing = str(item.get("billingType") or "").upper()

        if status:
            s_up = status.upper().strip()
            if s_up == "RECEIVED":
                if item_status not in {"RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"}:
                    continue
            elif s_up == "OVERDUE":
                if item_status != "OVERDUE":
                    continue
            elif s_up == "PENDING":
                if item_status != "PENDING":
                    continue
            elif item_status != s_up:
                continue

        if billing_type and item_billing != billing_type.upper():
            continue

        item_due = _parse_asaas_date(item.get("dueDate"))
        if data_inicio and item_due and item_due < data_inicio:
            continue
        if data_fim and item_due and item_due > data_fim:
            continue

        cust_id = item.get("customer")
        cust_info: Dict[str, Any] = {}
        if cust_id:
            cust_info = _fetch_asaas_customer_data(
                integracao=integracao,
                access_token=token,
                customer_id=str(cust_id),
                customer_cache=customer_cache
            )

        cust_name = cust_info.get("name") or str(item.get("description") or "Cliente Asaas")
        cust_cpf = cust_info.get("cpfCnpj")
        cust_email = cust_info.get("email")

        if search_term:
            combined = f"{cust_name} {cust_cpf or ''} {item.get('id') or ''} {item.get('description') or ''}".lower()
            if search_term not in combined:
                continue

        try:
            val = Decimal(str(item.get("value") or 0))
        except Exception:
            val = Decimal("0.00")

        try:
            net_val = Decimal(str(item.get("netValue") or val))
        except Exception:
            net_val = val

        taxa = max(Decimal("0.00"), val - net_val)

        total_bruto += val
        total_liquido += net_val
        total_taxas += taxa

        enriched.append({
            "id": item.get("id"),
            "customer": cust_id,
            "customerName": cust_name,
            "customerCpfCnpj": cust_cpf,
            "customerEmail": cust_email,
            "value": float(val),
            "netValue": float(net_val),
            "fee": float(taxa),
            "dueDate": item.get("dueDate"),
            "paymentDate": item.get("paymentDate"),
            "status": item_status,
            "billingType": item_billing,
            "description": item.get("description"),
            "invoiceUrl": item.get("invoiceUrl"),
            "bankSlipUrl": item.get("bankSlipUrl"),
            "externalReference": item.get("externalReference"),
        })

    return {
        "items": enriched,
        "total_registros": len(enriched),
        "total_bruto": round(float(total_bruto), 2),
        "total_liquido": round(float(total_liquido), 2),
        "total_taxas": round(float(total_taxas), 2),
    }


def buscar_clientes_gerencial_asaas(
    db: Session,
    integracao: IntegracaoBancaria,
    search: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Retorna a carteira de clientes cobrados pelo Asaas com histórico consolidado.
    """
    token = get_token_decrypted(db, integracao=integracao)
    base_url = get_asaas_base_url(integracao.ambiente)
    headers = {
        "access_token": token,
        "Content-Type": "application/json"
    }

    params: Dict[str, Any] = {"limit": min(limit, 100)}
    if search:
        params["name"] = search

    try:
        res = _request_asaas_json(
            url=f"{base_url}/customers",
            headers=headers,
            params=params
        )
        customers = res.get("data", [])
    except Exception as e:
        logger.warning("Falha ao buscar clientes Asaas via API: {}", e)
        customers = []

    # Se a API Asaas não retornar clientes ou estiver sem permissão, busca das entidades locais
    if not customers:
        entidades_locais = db.exec(
            select(Entidade).where(
                Entidade.empresa_id == integracao.empresa_id,
                Entidade.is_deleted == False,
            ).limit(limit)
        ).all()
        return [
            {
                "id": str(e.id),
                "name": e.nome,
                "cpfCnpj": e.cpf_cnpj,
                "email": e.email,
                "phone": e.telefone,
                "cidade": getattr(e, "cidade", None),
                "uf": getattr(e, "uf", None),
                "total_faturado": 0.0,
                "total_pendente": 0.0,
                "qtd_cobrancas": 0,
            }
            for e in entidades_locais
        ]

    clientes_formatados: List[Dict[str, Any]] = []
    for cust in customers:
        clientes_formatados.append({
            "id": cust.get("id"),
            "name": cust.get("name") or cust.get("company") or "Sem Nome",
            "cpfCnpj": cust.get("cpfCnpj"),
            "email": cust.get("email"),
            "phone": cust.get("mobilePhone") or cust.get("phone"),
            "cidade": cust.get("city"),
            "uf": cust.get("state"),
            "total_faturado": 0.0,
            "total_pendente": 0.0,
            "qtd_cobrancas": 0,
        })

    return clientes_formatados
