"""
Utilitarios compartilhados de importacao bancaria.

Mantem apenas regras reutilizadas pelo fluxo OFX e pelo assistente,
sem carregar o legado especifico de XLSX do Itau.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from loguru import logger
from sqlmodel import Session, or_, select

from app.models.entidade import Entidade
from app.models.lancamento import Lancamento


def parsear_data_hora(data_str: object) -> Tuple[Optional[date], Optional[datetime]]:
    if not data_str:
        return None, None

    if isinstance(data_str, datetime):
        return data_str.date(), data_str

    if isinstance(data_str, date):
        return data_str, None

    formatos_hora = [
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]
    valor = str(data_str).strip()
    for fmt in formatos_hora:
        try:
            data_hora = datetime.strptime(valor, fmt)
            return data_hora.date(), data_hora
        except Exception:
            continue

    formatos_data = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%d/%m/%y",
    ]
    for fmt in formatos_data:
        try:
            return datetime.strptime(valor, fmt).date(), None
        except Exception:
            continue

    return None, None


def parsear_data(data_str: object) -> Optional[date]:
    data, _ = parsear_data_hora(data_str)
    return data


def _normalizar_texto(texto: Optional[str]) -> str:
    if not texto:
        return ""
    base = unicodedata.normalize("NFKD", str(texto).strip().lower())
    sem_acento = "".join(char for char in base if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", sem_acento)


def _normalizar_cabecalho(texto: Optional[str]) -> str:
    if not texto:
        return ""
    valor = unicodedata.normalize("NFKD", str(texto))
    valor = "".join([char for char in valor if not unicodedata.combining(char)])
    valor = re.sub(r"\s+", " ", valor)
    return valor.strip().lower()


def _limpar_cpf_cnpj(cpf_cnpj: Optional[str]) -> str:
    return re.sub(r"[^0-9]", "", cpf_cnpj or "")


def _normalizar_nome_entidade(texto: Optional[str]) -> str:
    if not texto:
        return ""

    nome = re.sub(r"\s+", " ", str(texto).strip())
    if not nome:
        return ""

    nome = re.sub(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", " ", nome, flags=re.IGNORECASE)
    nome = re.sub(r"\b\d{5,}\b", " ", nome)
    nome = re.sub(r"\s+", " ", nome).strip()
    nome = re.sub(
        r"^(?:pix|transferencia|transferência|ted|doc|pagamento|recebimento|boleto)\s+(?:pago|paga|rede|qr(?:\s+code)?|chave|recebido|recebida|receido|receida|enviado|enviada|pix)?\s*",
        "",
        nome,
        flags=re.IGNORECASE,
    ).strip(" -")

    tokens_brutos = re.split(r"\s+", nome)
    tokens_genericos = {
        "PIX",
        "QR",
        "QRCODE",
        "CODE",
        "CHAVE",
        "RECEBIDO",
        "RECEBIDA",
        "RECEIDO",
        "RECEIDA",
        "ENVIADO",
        "ENVIADA",
        "TRANSFERENCIA",
        "TRANSFERÊNCIA",
        "PAGAMENTO",
        "RECEBIMENTO",
        "BOLETO",
        "PAGO",
        "PAGA",
        "TED",
        "DOC",
        "REDE",
    }

    tokens: List[str] = []
    for token in tokens_brutos:
        limpo = re.sub(r"[^A-Za-zÀ-ÿ0-9]", "", token)
        if not limpo:
            continue

        if re.search(r"\d", limpo):
            somente_letras = re.sub(r"\d", "", limpo)
            if len(somente_letras) < 2:
                continue
            limpo = somente_letras

        if limpo.upper() in tokens_genericos:
            continue

        if limpo.upper() == "CO" and re.search(r"\bcomercio\b", nome, flags=re.IGNORECASE):
            continue

        if tokens and _normalizar_cabecalho(tokens[-1]) == _normalizar_cabecalho(limpo):
            continue

        tokens.append(limpo)

    if len(tokens) >= 2 and _normalizar_cabecalho(tokens[0]) == _normalizar_cabecalho(tokens[-1]):
        tokens.pop()

    if len(tokens) >= 4 and _normalizar_cabecalho(tokens[0]) == _normalizar_cabecalho(tokens[2]):
        similaridade = SequenceMatcher(
            None,
            _normalizar_cabecalho(tokens[1]),
            _normalizar_cabecalho(tokens[3]),
        ).ratio()
        if similaridade >= 0.7:
            del tokens[2:4]

    resultado = " ".join(token.title() for token in tokens).strip()
    if len(resultado) >= 3:
        return resultado

    return nome[:120]


def _status_aberto_clause() -> tuple[str, ...]:
    return ("PENDENTE", "EM ABERTO")


def gerar_import_hash(lancamento: Dict, conta_id: Optional[int] = None, cartao_id: Optional[int] = None) -> str:
    movimento_uid = _normalizar_texto(lancamento.get("movimento_uid"))
    referencia_externa = _normalizar_texto(lancamento.get("referencia_externa"))

    payload = {
        "origem": lancamento.get("origem"),
        "tipo": lancamento.get("tipo"),
        "data": str(lancamento.get("data") or ""),
        "data_hora": lancamento.get("data_hora"),
        "valor": str(lancamento.get("valor") or ""),
        "descricao": _normalizar_texto(lancamento.get("descricao")),
        "razao_social": _normalizar_texto(lancamento.get("razao_social")),
        "cpf_cnpj": _limpar_cpf_cnpj(lancamento.get("cpf_cnpj")),
        "referencia_externa": referencia_externa,
        "movimento_uid": movimento_uid if movimento_uid and not movimento_uid.startswith("fallback:") else None,
        "conta_id": conta_id or lancamento.get("conta_id"),
        "cartao_id": cartao_id or lancamento.get("cartao_id"),
    }
    payload_str = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload_str.encode("utf-8")).hexdigest()


def verificar_duplicata(
    db: Session,
    lancamento: Dict,
    empresa_id: int,
    conta_id: Optional[int] = None,
) -> Optional[Lancamento]:
    import_hash = lancamento.get("import_hash") or gerar_import_hash(lancamento, conta_id=conta_id)
    if not import_hash:
        return None

    return db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.import_hash == import_hash,
        )
    ).first()


def verificar_duplicata_ofx_por_fallback(
    db: Session,
    lancamento: Dict,
    empresa_id: int,
    conta_id: Optional[int] = None,
) -> Optional[Lancamento]:
    if str(lancamento.get("origem") or "").upper() != "OFX_EXTRATO":
        return None

    conta_resolvida = conta_id or lancamento.get("conta_id")
    if not conta_resolvida:
        return None

    descricao = _normalizar_texto(lancamento.get("descricao"))
    if not descricao:
        return None

    data_base = lancamento.get("data")
    if isinstance(data_base, datetime):
        data_base = data_base.date()
    elif isinstance(data_base, str):
        data_base, _ = parsear_data_hora(data_base)

    if not data_base:
        return None

    try:
        valor = Decimal(str(lancamento.get("valor") or "0"))
    except Exception:
        return None

    candidatos = db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.conta_id == conta_resolvida,
            Lancamento.origem == "OFX_EXTRATO",
            Lancamento.tipo == lancamento.get("tipo"),
            or_(
                Lancamento.data_pagamento == data_base,
                Lancamento.data_vencimento == data_base,
            ),
        )
    ).all()

    for candidato in candidatos:
        descricao_candidata = _normalizar_texto(candidato.descricao)
        valor_candidato = candidato.valor_pago if candidato.valor_pago not in (None, Decimal("0.00")) else candidato.valor_previsto
        valor_candidato_dec = Decimal(str(valor_candidato or "0"))
        valor_igual = abs(valor_candidato_dec - valor) <= Decimal("0.01")
        similaridade = SequenceMatcher(None, descricao_candidata, descricao).ratio() if descricao_candidata and descricao else 0.0
        if (descricao_candidata == descricao and valor_igual) or (similaridade >= 0.92 and valor_igual):
            return candidato

    return None


def buscar_lancamento_previsto_mesmo_dia_valor(
    db: Session,
    lancamento: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int] = None,
    tolerancia_valor: Optional[Decimal] = None,
    tolerancia_percentual: Optional[Decimal] = None,
) -> Optional[Lancamento]:
    data_lancamento = lancamento["data"]
    valor = Decimal(str(lancamento["valor"]))
    margem = abs(valor) * tolerancia_percentual if tolerancia_percentual is not None else (tolerancia_valor or Decimal("1.00"))
    valor_min = valor - margem
    valor_max = valor + margem

    lancamento_table = getattr(Lancamento, "__table__")
    query = select(Lancamento).where(
        lancamento_table.c.empresa_id == empresa_id,
        lancamento_table.c.is_deleted == False,
        lancamento_table.c.tipo == lancamento.get("tipo"),
        lancamento_table.c.data_vencimento == data_lancamento,
        lancamento_table.c.valor_previsto >= valor_min,
        lancamento_table.c.valor_previsto <= valor_max,
        lancamento_table.c.status.in_(_status_aberto_clause()),
    )
    if centro_custo_id:
        query = query.where(lancamento_table.c.centro_custo_id == centro_custo_id)

    return db.exec(query).first()


def buscar_lancamento_atrasado_mesmo_valor(
    db: Session,
    lancamento: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int] = None,
    dias_tolerancia: int = 30,
    tolerancia_valor: Optional[Decimal] = None,
    tolerancia_percentual: Optional[Decimal] = None,
) -> List[Lancamento]:
    data_lancamento = lancamento["data"]
    valor = Decimal(str(lancamento["valor"]))
    margem = abs(valor) * tolerancia_percentual if tolerancia_percentual is not None else (tolerancia_valor or Decimal("1.00"))
    valor_min = valor - margem
    valor_max = valor + margem
    data_limite = data_lancamento - timedelta(days=dias_tolerancia)

    lancamento_table = getattr(Lancamento, "__table__")
    query = select(Lancamento).where(
        lancamento_table.c.empresa_id == empresa_id,
        lancamento_table.c.is_deleted == False,
        lancamento_table.c.tipo == lancamento.get("tipo"),
        lancamento_table.c.data_vencimento < data_lancamento,
        lancamento_table.c.data_vencimento >= data_limite,
        lancamento_table.c.valor_previsto >= valor_min,
        lancamento_table.c.valor_previsto <= valor_max,
        lancamento_table.c.status.in_(_status_aberto_clause()),
    )
    if centro_custo_id:
        query = query.where(lancamento_table.c.centro_custo_id == centro_custo_id)

    query = query.order_by(lancamento_table.c.data_vencimento.desc())
    return list(db.exec(query).all())


def criar_entidade_se_nao_existir(
    db: Session,
    razao_social: str,
    cpf_cnpj: str,
    empresa_id: int,
) -> Optional[int]:
    if not razao_social and not cpf_cnpj:
        return None

    razao_social = _normalizar_nome_entidade(razao_social)
    cpf_cnpj_limpo = re.sub(r"[^0-9]", "", cpf_cnpj) if cpf_cnpj else ""

    entidade_table = getattr(Entidade, "__table__")
    if cpf_cnpj_limpo:
        entidade = db.exec(
            select(Entidade).where(
                entidade_table.c.empresa_id == empresa_id,
                entidade_table.c.cpf_cnpj == cpf_cnpj_limpo,
            )
        ).first()
        if entidade:
            return entidade.id

    if razao_social:
        entidade = db.exec(
            select(Entidade).where(
                entidade_table.c.empresa_id == empresa_id,
                entidade_table.c.nome.ilike(f"%{razao_social[:50]}%"),
            )
        ).first()
        if entidade:
            return entidade.id

    if not (razao_social or cpf_cnpj_limpo):
        return None

    tipo_pessoa = "PJ" if len(cpf_cnpj_limpo) > 11 else "PF"
    nova_entidade = Entidade(
        nome=razao_social or cpf_cnpj_limpo,
        tipo="AMBOS",
        tipo_pessoa=tipo_pessoa,
        cpf_cnpj=cpf_cnpj_limpo if cpf_cnpj_limpo else None,
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    logger.info(f"Entidade criada: {nova_entidade.nome} (ID: {nova_entidade.id})")
    return nova_entidade.id