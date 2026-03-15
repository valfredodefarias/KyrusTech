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


def _build_encoding_candidates(header_text: str) -> list[str]:
    header_upper = header_text.upper()
    encoding_match = re.search(r"^ENCODING:(.+)$", header_upper, re.MULTILINE)
    charset_match = re.search(r"^CHARSET:(.+)$", header_upper, re.MULTILINE)

    candidates: list[str] = []
    encoding_value = encoding_match.group(1).strip() if encoding_match else ""
    charset_value = charset_match.group(1).strip() if charset_match else ""

    if encoding_value in {"UNICODE", "UTF-8"}:
        candidates.extend(["utf-8", "utf-8-sig"])
    elif encoding_value == "USASCII":
        if charset_value == "8859-1":
            candidates.extend(["iso-8859-1", "latin1"])
        elif charset_value.isdigit():
            candidates.append(f"cp{charset_value}")

    candidates.extend(["utf-8", "utf-8-sig", "cp1252", "iso-8859-1", "latin1"])

    unique_candidates: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in unique_candidates:
            unique_candidates.append(candidate)
    return unique_candidates


def _normalize_ofx_bytes(arquivo_bytes: bytes) -> bytes:
    first_tag_index = arquivo_bytes.find(b"<")
    header_slice = arquivo_bytes[:first_tag_index] if first_tag_index > 0 else arquivo_bytes[:10240]
    header_text = header_slice.decode("ascii", errors="replace")
    encoding_candidates = _build_encoding_candidates(header_text)

    decoded_content: Optional[str] = None
    selected_encoding: Optional[str] = None
    last_error: Optional[Exception] = None

    for encoding in encoding_candidates:
        try:
            decoded_content = arquivo_bytes.decode(encoding)
            selected_encoding = encoding
            break
        except UnicodeDecodeError as exc:
            last_error = exc

    if decoded_content is None:
        fallback_encoding = encoding_candidates[0] if encoding_candidates else "latin1"
        decoded_content = arquivo_bytes.decode(fallback_encoding, errors="replace")
        selected_encoding = f"{fallback_encoding} (replace)"
        if last_error:
            logger.warning(f"OFX com bytes invalidos para encoding declarado. Aplicando fallback seguro: {last_error}")

    decoded_content = decoded_content.replace("\x00", "")
    split_index = decoded_content.find("<")
    if split_index >= 0:
        header_part = decoded_content[:split_index]
        body_part = decoded_content[split_index:]
    else:
        header_part = decoded_content
        body_part = ""

    if header_part:
        if re.search(r"^ENCODING:", header_part, re.MULTILINE):
            header_part = re.sub(r"^ENCODING:.*$", "ENCODING:UTF-8", header_part, count=1, flags=re.MULTILINE)
        else:
            header_part = f"ENCODING:UTF-8\n{header_part}"

        if re.search(r"^CHARSET:", header_part, re.MULTILINE):
            header_part = re.sub(r"^CHARSET:.*$", "CHARSET:NONE", header_part, count=1, flags=re.MULTILINE)

    normalized_content = f"{header_part}{body_part}"
    logger.info(f"OFX normalizado para UTF-8 usando encoding de origem: {selected_encoding}")
    return normalized_content.encode("utf-8")


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
    vistos: set[int] = set()

    for grupo in [getattr(ofx, "accounts", None), getattr(ofx, "creditcards", None)]:
        for conta in grupo or []:
            conta_obj_id = id(conta)
            if conta_obj_id in vistos:
                continue
            vistos.add(conta_obj_id)
            contas.append(conta)

    for conta in [getattr(ofx, "account", None), getattr(ofx, "creditcard", None)]:
        if conta is None:
            continue
        conta_obj_id = id(conta)
        if conta_obj_id in vistos:
            continue
        vistos.add(conta_obj_id)
        contas.append(conta)

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


def _build_transaction_dedupe_key(conta_metadata: Dict[str, Optional[str]], txn: object, data_lanc: date, data_hora: str | None, valor: Decimal, descricao: str) -> str:
    raw_identity = [
        _safe_text(getattr(txn, "id", None)),
        _safe_text(getattr(txn, "fitid", None)),
        _safe_text(getattr(txn, "reference", None)),
    ]
    identidade = next((item for item in raw_identity if item), "")

    base_parts = [
        conta_metadata.get("ofx_bank_id") or "",
        conta_metadata.get("ofx_agencia") or "",
        conta_metadata.get("ofx_conta_numero") or "",
        data_lanc.isoformat(),
        data_hora or "",
        str(valor),
        identidade,
        re.sub(r"\s+", " ", descricao.lower()).strip(),
        re.sub(r"\s+", " ", _safe_text(getattr(txn, "payee", None)).lower()).strip(),
        re.sub(r"\s+", " ", _safe_text(getattr(txn, "type", None)).lower()).strip(),
    ]
    return "|".join(base_parts)


def _deve_ignorar_descricao_ofx(descricao: str) -> bool:
    descricao_normalizada = _safe_text(descricao).lower()
    if not descricao_normalizada:
        return False
    return bool(re.search(r"\bsaldo\b", descricao_normalizada))


def processar_ofx(arquivo_bytes: bytes, empresa_id: int) -> List[Dict]:
    """
    Processa arquivo OFX (extrato de transacoes) para qualquer banco.
    Retorna lista de lancamentos encontrados.
    """
    logger.info("Processando OFX...")
    arquivo_normalizado = _normalize_ofx_bytes(arquivo_bytes)
    ofx = OfxParser.parse(BytesIO(arquivo_normalizado))

    lancamentos: List[Dict] = []
    linha = 1
    movimentos_vistos: set[str] = set()

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
            if _deve_ignorar_descricao_ofx(descricao):
                logger.info(f"Movimento OFX ignorado por descricao bloqueada: {descricao}")
                linha += 1
                continue
            dedupe_key = _build_transaction_dedupe_key(account_metadata, txn, data_lanc, data_hora, valor_abs, descricao)
            if dedupe_key in movimentos_vistos:
                logger.warning(f"Movimento OFX duplicado ignorado no parser: {descricao} | {data_lanc.isoformat()} | {valor_abs}")
                linha += 1
                continue
            movimentos_vistos.add(dedupe_key)
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
