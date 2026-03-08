"""
Servico de integracao com OFX (multibancos).
Processa transacoes e retorna lancamentos para conciliacao.
"""
from typing import List, Dict, Optional
from datetime import datetime, date
from decimal import Decimal
from io import BytesIO
from loguru import logger
from ofxparse import OfxParser
import re


def _to_date(value) -> tuple[date | None, str | None]:
    if not value:
        return None, None
    if isinstance(value, datetime):
        return value.date(), value.isoformat()
    if isinstance(value, date):
        return value, None
    try:
        parsed = datetime.fromisoformat(str(value))
        return parsed.date(), parsed.isoformat()
    except Exception:
        return None, None


def _iterar_contas(ofx) -> list:
    contas = []
    if getattr(ofx, "accounts", None):
        contas.extend(ofx.accounts)
    if getattr(ofx, "account", None):
        contas.append(ofx.account)
    if getattr(ofx, "creditcards", None):
        contas.extend(ofx.creditcards)
    if getattr(ofx, "creditcard", None):
        contas.append(ofx.creditcard)
    return contas


def _safe_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _digits_only(value: object) -> str:
    return re.sub(r"\D+", "", _safe_text(value))


def _extract_account_metadata(conta: object) -> Dict[str, Optional[str]]:
    bank_id = (
        _digits_only(getattr(conta, "routing_number", None))
        or _digits_only(getattr(conta, "bank_id", None))
        or None
    )
    agencia = (
        _digits_only(getattr(conta, "branch_id", None))
        or _digits_only(getattr(conta, "branch_number", None))
        or None
    )
    conta_numero = (
        _digits_only(getattr(conta, "account_id", None))
        or _digits_only(getattr(conta, "number", None))
        or None
    )
    account_type = _safe_text(getattr(conta, "account_type", None)) or None
    return {
        "ofx_bank_id": bank_id,
        "ofx_agencia": agencia,
        "ofx_conta_numero": conta_numero,
        "ofx_account_type": account_type,
    }


def _resolve_transaction_reference(txn: object, linha: int, data_lanc: date, valor_abs: Decimal, descricao: str) -> str:
    raw_candidates = [
        getattr(txn, "id", None),
        getattr(txn, "fitid", None),
        getattr(txn, "reference", None),
    ]
    for candidate in raw_candidates:
        normalized = _safe_text(candidate)
        if normalized:
            return normalized

    descricao_base = re.sub(r"\s+", " ", descricao.lower()).strip()[:80]
    return f"fallback-{data_lanc.isoformat()}-{valor_abs}-{linha}-{descricao_base}"


def processar_ofx(arquivo_bytes: bytes, empresa_id: int) -> List[Dict]:
    """
    Processa arquivo OFX (extrato de transacoes) para qualquer banco.
    Retorna lista de lancamentos encontrados.
    """
    logger.info("Processando OFX...")
    ofx = OfxParser.parse(BytesIO(arquivo_bytes))

    lancamentos: List[Dict] = []
    linha = 1

    for conta in _iterar_contas(ofx):
        account_metadata = _extract_account_metadata(conta)
        statement = getattr(conta, "statement", None)
        if not statement:
            continue
        for txn in statement.transactions:
            data_lanc, data_hora = _to_date(getattr(txn, "date", None))
            if not data_lanc:
                linha += 1
                continue

            valor_raw = getattr(txn, "amount", None)
            try:
                valor = Decimal(str(valor_raw))
            except Exception:
                linha += 1
                continue

            if valor == 0:
                linha += 1
                continue

            tipo = "RECEITA" if valor > 0 else "DESPESA"
            valor_abs = abs(valor)

            memo = (getattr(txn, "memo", "") or "").strip()
            payee = (getattr(txn, "payee", "") or "").strip()
            tipo_txn = (getattr(txn, "type", "") or "").strip()
            descricao = memo or payee or tipo_txn or "Transacao OFX"
            referencia_txn = _resolve_transaction_reference(txn, linha, data_lanc, valor_abs, descricao)

            lancamentos.append({
                "data": data_lanc,
                "data_pagamento": data_lanc.isoformat(),
                "data_vencimento": data_lanc.isoformat(),
                "data_hora": data_hora,
                "descricao": descricao,
                "razao_social": payee,
                "cpf_cnpj": "",
                "referencia": referencia_txn,
                "valor": valor_abs,
                "valor_pago": valor_abs,
                "valor_previsto": valor_abs,
                "tipo": tipo,
                "origem": "OFX_EXTRATO",
                "linha_arquivo": linha,
                **account_metadata,
            })
            linha += 1

    logger.success(f"Processados {len(lancamentos)} lancamentos do OFX")
    return lancamentos
