"""
Servico de integracao com OFX (multibancos).
Processa transacoes e retorna lancamentos para conciliacao.
"""
from typing import List, Dict
from datetime import datetime, date
from decimal import Decimal
from io import BytesIO
from loguru import logger
from ofxparse import OfxParser


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

            lancamentos.append({
                "data": data_lanc,
                "data_pagamento": data_lanc.isoformat(),
                "data_vencimento": data_lanc.isoformat(),
                "data_hora": data_hora,
                "descricao": descricao,
                "razao_social": payee,
                "cpf_cnpj": "",
                "referencia": str(getattr(txn, "id", "") or ""),
                "valor": valor_abs,
                "valor_pago": valor_abs,
                "valor_previsto": valor_abs,
                "tipo": tipo,
                "origem": "OFX_EXTRATO",
                "linha_arquivo": linha,
            })
            linha += 1

    logger.success(f"Processados {len(lancamentos)} lancamentos do OFX")
    return lancamentos
