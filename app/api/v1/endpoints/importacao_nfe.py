from __future__ import annotations

import base64
from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
import hashlib
import json
from math import ceil
from pathlib import Path
import re
import unicodedata
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import String, asc, case, cast, desc, func
from sqlmodel import Session, select

from app.api.v1.deps import get_current_user, get_empresa_id_from_user, require_permission
from app.core.upload_security import ANEXO_ALLOWED_EXT_TO_MIME, UploadValidationError, write_validated_upload_file
from app.db.session import get_db
from app.models.anexo_lancamento import AnexoLancamento
from app.models.centro_custo import CentroCusto
from app.models.conta import Conta
from app.models.empresa import Empresa
from app.models.entidade import Entidade
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.usuario import Usuario
from app.services.importacao_nfe_service import NFeDocumento, parse_nfe_xml

router = APIRouter()
NFE_FILE_SIZE_LIMIT = 5 * 1024 * 1024
NFE_PDF_FILE_SIZE_LIMIT = 10 * 1024 * 1024


class NfeParcelaAnalise(BaseModel):
    indice: int
    numero_parcela: str
    data_vencimento: str
    valor: float
    descricao: str
    cfop: Optional[str] = None
    ncm: Optional[str] = None
    plano_contas_sugerido_id: Optional[int] = None
    plano_contas_sugerido_nome: Optional[str] = None
    entidade_sugerida_id: Optional[int] = None
    entidade_sugerida_nome: Optional[str] = None
    requer_entidade_manual: bool = False
    requer_categoria_manual: bool = False


class NfeItemAnalise(BaseModel):
    descricao: str
    quantidade: float
    valor_unitario: float
    valor_total: float
    cfop: Optional[str] = None
    ncm: Optional[str] = None


class NfeAnaliseResponse(BaseModel):
    chave_nfe: str
    numero_nfe: str
    serie: str
    tipo_lancamento: str
    data_emissao: str
    valor_total: float
    emitente_nome: str
    emitente_documento: str
    destinatario_nome: str
    destinatario_documento: str
    entidade_referencia_nome: str
    entidade_referencia_documento: str
    valor_produtos: float
    valor_frete: float
    valor_seguro: float
    valor_desconto: float
    valor_outros: float
    entidade_sugerida_id: Optional[int] = None
    entidade_sugerida_nome: Optional[str] = None
    plano_contas_sugerido_id: Optional[int] = None
    plano_contas_sugerido_nome: Optional[str] = None
    itens: list[NfeItemAnalise]
    parcelas: list[NfeParcelaAnalise]
    alertas: list[str]
    pode_confirmar: bool


class NfeParcelaConfirmar(BaseModel):
    indice: int = Field(ge=1)
    numero_parcela: str
    data_vencimento: date
    valor: Decimal = Field(gt=0)
    descricao: Optional[str] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None


class NfeItemPersistencia(BaseModel):
    descricao: str
    quantidade: float = Field(gt=0)
    valor_unitario: float = Field(ge=0)
    valor_total: float = Field(ge=0)
    cfop: Optional[str] = None
    ncm: Optional[str] = None


class NfeConfirmarRequest(BaseModel):
    chave_nfe: str
    numero_nfe: str
    tipo_lancamento: str
    situacao: Optional[str] = "AGUARDANDO_ENTREGA"
    destino_compra: Optional[str] = None
    valor_frete: Optional[Decimal] = None
    cfop: Optional[str] = None
    data_emissao: date
    emitente_nome: Optional[str] = None
    emitente_documento: Optional[str] = None
    emitente_nome_fantasia: Optional[str] = None
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    entidade_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    observacao: Optional[str] = None
    itens: list[NfeItemPersistencia] = Field(default_factory=list)
    parcelas: list[NfeParcelaConfirmar]


class NfeConfirmarResponse(BaseModel):
    id_parcelamento: str
    chave_nfe: str
    numero_nfe: str
    tipo_lancamento: str
    total_parcelas: int
    lancamentos_criados: int
    lancamento_ids: list[int]


class NfeAnexoPdfResponse(BaseModel):
    id_parcelamento: str
    nome_arquivo: str
    url: str
    anexos_criados: int
    lancamento_ids: list[int]


class NfeListItem(BaseModel):
    id_parcelamento: str
    numero_nfe: str
    chave_nfe: Optional[str] = None
    descricao: str
    centro_custo_nome: Optional[str] = None
    total_parcelas: int
    valor_total: float
    data_emissao: Optional[str] = None
    data_vencimento: Optional[str] = None
    status: str


class NfeListResponse(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int
    items: list[NfeListItem]


class NfeParcelaDetalhe(BaseModel):
    id: int
    indice: int
    numero_parcela: str
    data_vencimento: str
    valor: float
    descricao: str
    status: str
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None


class NfeDetalheResponse(BaseModel):
    id_parcelamento: str
    numero_nfe: str
    chave_nfe: Optional[str] = None
    cfop: Optional[str] = None
    tipo_lancamento: str
    data_emissao: str
    destino_compra: Optional[str] = None
    valor_frete: Optional[float] = None
    emitente_nome: str
    emitente_documento: str
    anexo_pdf_nome: Optional[str] = None
    anexo_pdf_url: Optional[str] = None
    anexo_frete_nome: Optional[str] = None
    anexo_frete_url: Optional[str] = None
    entidade_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    centro_custo_nome: Optional[str] = None
    total_parcelas: int
    valor_total: float
    status: str
    itens: list[NfeItemAnalise] = Field(default_factory=list)
    parcelas: list[NfeParcelaDetalhe]


class NfeParcelaAtualizar(BaseModel):
    id: int = Field(gt=0)
    valor: Decimal = Field(gt=0)
    data_vencimento: Optional[date] = None
    descricao: Optional[str] = None


class NfeAtualizarRequest(BaseModel):
    numero_nfe: str
    chave_nfe: Optional[str] = None
    situacao: Optional[str] = "AGUARDANDO_ENTREGA"
    destino_compra: Optional[str] = None
    valor_frete: Optional[Decimal] = None
    cfop: Optional[str] = None
    data_emissao: date
    emitente_nome: Optional[str] = None
    emitente_documento: Optional[str] = None
    emitente_nome_fantasia: Optional[str] = None
    entidade_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    observacao: Optional[str] = None
    itens: list[NfeItemPersistencia] = Field(default_factory=list)
    parcelas: list[NfeParcelaAtualizar] = Field(default_factory=list)


class NfeAtualizarResponse(BaseModel):
    id_parcelamento: str
    total_parcelas: int
    lancamentos_atualizados: int
    valor_total: float


def _normalize_text(value: str) -> str:
    base = unicodedata.normalize("NFKD", str(value or ""))
    no_accent = "".join(char for char in base if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", no_accent).strip().lower()


def _normalizar_nome_entidade(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _only_digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _normalizar_situacao_nfe(value: Optional[str]) -> str:
    bruto = str(value or "").strip()
    if not bruto:
        return "AGUARDANDO_ENTREGA"

    normalizado = _normalize_text(bruto).replace("-", " ").replace("_", " ")
    if normalizado in {"entregue", "pago", "paga", "concluido", "concluida"}:
        return "ENTREGUE"
    if normalizado in {"cancelada", "cancelado"}:
        return "CANCELADA"
    if normalizado in {"aguardando entrega", "em aberto", "aberto", "aberta", "pendente"}:
        return "AGUARDANDO_ENTREGA"

    return "AGUARDANDO_ENTREGA"


def _extrair_situacao_nfe(text: str) -> str:
    match = re.search(
        r"Situac[aã]o\s*[:=]?\s*(AGUARDANDO[_ ]ENTREGA|ENTREGUE|CANCELADA)",
        str(text or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return "AGUARDANDO_ENTREGA"
    return _normalizar_situacao_nfe(match.group(1))


def _normalizar_cfop(value: Optional[str]) -> Optional[str]:
    digits = _only_digits(str(value or ""))
    if not digits:
        return None
    return digits[:4]


def _extract_cfop(text: str) -> Optional[str]:
    match = re.search(r"CFOP\s*[:=]?\s*([0-9]{1,4})", str(text or ""), flags=re.IGNORECASE)
    if not match:
        return None
    return _normalizar_cfop(match.group(1))


def _extract_emitente_documento(text: str) -> Optional[str]:
    match = re.search(
        r"(?:EmitenteDoc|CNPJ\/?CPF|Documento)\s*[:=]?\s*([0-9]{11,14})",
        str(text or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return _only_digits(match.group(1))


def _extract_cnpj_from_nfe_key(chave_nfe: Optional[str]) -> Optional[str]:
    chave = _only_digits(chave_nfe or "")
    if len(chave) != 44:
        return None
    return chave[6:20]


def _normalizar_itens_nfe(itens: list[NfeItemPersistencia]) -> list[dict[str, object]]:
    itens_normalizados: list[dict[str, object]] = []
    for item in itens:
        descricao = str(item.descricao or "").strip() or "Item"
        quantidade = float(item.quantidade or 0)
        valor_unitario = float(item.valor_unitario or 0)
        valor_total = float(item.valor_total or 0)

        if quantidade <= 0:
            quantidade = 1.0
        if valor_total <= 0 and valor_unitario > 0:
            valor_total = valor_unitario * quantidade
        if valor_unitario <= 0 and valor_total > 0:
            valor_unitario = valor_total / quantidade

        itens_normalizados.append(
            {
                "descricao": descricao,
                "quantidade": round(quantidade, 6),
                "valor_unitario": round(valor_unitario, 6),
                "valor_total": round(valor_total, 6),
                "cfop": _normalizar_cfop(item.cfop),
                "ncm": str(item.ncm or "").strip() or None,
            }
        )
    return itens_normalizados


def _encode_itens_meta(itens_meta: list[dict[str, object]]) -> Optional[str]:
    if not itens_meta:
        return None
    payload = json.dumps(itens_meta, ensure_ascii=False, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")


def _decode_itens_meta(token: str) -> list[dict[str, object]]:
    bruto = str(token or "").strip()
    if not bruto:
        return []

    try:
        decoded = base64.urlsafe_b64decode(bruto.encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    itens: list[dict[str, object]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            quantidade = float(item.get("quantidade") or 0)
            valor_unitario = float(item.get("valor_unitario") or 0)
            valor_total = float(item.get("valor_total") or 0)
        except (TypeError, ValueError):
            continue

        if quantidade <= 0:
            quantidade = 1.0
        if valor_total <= 0 and valor_unitario > 0:
            valor_total = valor_unitario * quantidade
        if valor_unitario <= 0 and valor_total > 0:
            valor_unitario = valor_total / quantidade

        itens.append(
            {
                "descricao": str(item.get("descricao") or "Item").strip() or "Item",
                "quantidade": round(quantidade, 6),
                "valor_unitario": round(valor_unitario, 6),
                "valor_total": round(valor_total, 6),
                "cfop": _normalizar_cfop(str(item.get("cfop") or "")),
                "ncm": str(item.get("ncm") or "").strip() or None,
            }
        )
    return itens


def _extract_itens_meta(text: str) -> list[dict[str, object]]:
    match = re.search(
        r"ItensMeta\s*[:=]?\s*([A-Za-z0-9_-]+={0,2})",
        str(text or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return []
    return _decode_itens_meta(match.group(1))


def _itens_meta_to_response(itens_meta: list[dict[str, object]]) -> list[NfeItemAnalise]:
    itens_resp: list[NfeItemAnalise] = []
    for item in itens_meta:
        try:
            itens_resp.append(
                NfeItemAnalise(
                    descricao=str(item.get("descricao") or "Item").strip() or "Item",
                    quantidade=float(item.get("quantidade") or 0),
                    valor_unitario=float(item.get("valor_unitario") or 0),
                    valor_total=float(item.get("valor_total") or 0),
                    cfop=str(item.get("cfop") or "").strip() or None,
                    ncm=str(item.get("ncm") or "").strip() or None,
                )
            )
        except Exception:
            continue
    return itens_resp


def _strip_situacao_from_observacao(value: Optional[str]) -> str:
    texto = str(value or "").strip()
    if not texto:
        return ""

    texto = re.sub(
        r"\s*\|\s*Situac[aã]o\s*[:=]?\s*(AGUARDANDO[_ ]ENTREGA|ENTREGUE|CANCELADA)",
        "",
        texto,
        flags=re.IGNORECASE,
    )
    texto = re.sub(r"\s*\|\s*CFOP\s*[:=]?\s*[0-9]{1,4}", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"\s*\|\s*EmitenteDoc\s*[:=]?\s*[0-9]{11,14}", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"\s*\|\s*ItensMeta\s*[:=]?\s*[A-Za-z0-9_-]+={0,2}", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"\s*\|\s*DestinoCompra\s*[:=]?\s*(ENCOMENDA|ESTOQUE)", "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"\s*\|\s*FreteValor\s*[:=]?\s*[0-9]+(?:[\.,][0-9]+)?", "", texto, flags=re.IGNORECASE)
    return texto.strip()


def _compor_observacao_com_situacao(
    observacao_base: Optional[str],
    situacao_nfe: str,
    *,
    cfop: Optional[str] = None,
    emitente_documento: Optional[str] = None,
    destino_compra: Optional[str] = None,
    valor_frete: Optional[Decimal | float | int] = None,
    itens_meta: Optional[list[dict[str, object]]] = None,
) -> str:
    base = _strip_situacao_from_observacao(observacao_base)
    partes: list[str] = []
    if base:
        partes.append(base)

    emitente_doc = _only_digits(emitente_documento or "")
    if emitente_doc:
        partes.append(f"EmitenteDoc {emitente_doc}")

    cfop_normalizado = _normalizar_cfop(cfop)
    if cfop_normalizado:
        partes.append(f"CFOP {cfop_normalizado}")

    destino_normalizado = str(destino_compra or "").strip().upper()
    if destino_normalizado in {"ENCOMENDA", "ESTOQUE"}:
        partes.append(f"DestinoCompra {destino_normalizado}")

    if valor_frete is not None:
        try:
            frete_decimal = Decimal(str(valor_frete))
        except Exception:
            frete_decimal = Decimal("0")
        if frete_decimal > 0:
            partes.append(f"FreteValor {frete_decimal}")

    token_itens = _encode_itens_meta(itens_meta or [])
    if token_itens:
        partes.append(f"ItensMeta {token_itens}")

    partes.append(f"Situacao {situacao_nfe}")
    return " | ".join(partes)


def _extract_nfe_number(text: str) -> str:
    match = re.search(r"NF-?e\s*[:#]?\s*\(?\s*(\d+)\)?", str(text or ""), flags=re.IGNORECASE)
    return match.group(1) if match else "-"


def _extract_nfe_key(text: str) -> Optional[str]:
    match = re.search(r"Chave\s*([0-9]{44})", str(text or ""), flags=re.IGNORECASE)
    return match.group(1) if match else None


def _extract_destino_compra(text: str) -> Optional[str]:
    match = re.search(r"DestinoCompra\s*[:=]?\s*(ENCOMENDA|ESTOQUE)", str(text or ""), flags=re.IGNORECASE)
    return match.group(1).upper() if match else None


def _extract_valor_frete(text: str) -> Optional[Decimal]:
    match = re.search(r"FreteValor\s*[:=]?\s*([0-9]+(?:[\.,][0-9]+)?)", str(text or ""), flags=re.IGNORECASE)
    if not match:
        return None
    raw_value = match.group(1)
    normalized = raw_value.replace('.', '').replace(',', '.') if ',' in raw_value and '.' in raw_value else raw_value.replace(',', '.')
    try:
        return Decimal(normalized)
    except Exception:
        return None


def _tipo_letra(tipo_lancamento: str) -> str:
    return "R" if str(tipo_lancamento).strip().upper() == "RECEITA" else "D"


def _descricao_parcela(numero_nfe: str, indice: int, total: int) -> str:
    return f"NFE: ({numero_nfe})"


def _resumo_itens(itens: list, limite: int = 3) -> str:
    if not itens:
        return "Sem itens detalhados no XML"

    nomes = [str(item.descricao or "Item").strip() for item in itens[:limite]]
    resumo = ", ".join(nome for nome in nomes if nome)
    restante = len(itens) - len(nomes)
    if restante > 0:
        resumo = f"{resumo} e mais {restante} item(ns)" if resumo else f"{restante} item(ns) adicionais"
    return resumo or "Itens informados no XML"


def _parcelamento_id(chave_nfe: str) -> str:
    return f"NFE-{_only_digits(chave_nfe)}"


def _import_hash(empresa_id: int, chave_nfe: str, indice: int) -> str:
    payload = f"NFE|{empresa_id}|{_only_digits(chave_nfe)}|{indice}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolver_conta(
    db: Session,
    *,
    empresa_id: int,
    conta_id: Optional[int],
) -> Optional[Conta]:
    if not conta_id:
        return None

    conta = db.exec(
        select(Conta).where(
            Conta.id == conta_id,
            Conta.empresa_id == empresa_id,
            Conta.is_deleted == False,
        )
    ).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta nao encontrada para esta empresa")
    return conta


def _resolver_centro_custo(
    db: Session,
    *,
    empresa_id: int,
    centro_custo_id: Optional[int],
    conta: Optional[Conta],
) -> Optional[int]:
    centro_resolvido = centro_custo_id or (int(conta.centro_custo_id) if conta and conta.centro_custo_id else None)
    if not centro_resolvido:
        return None

    centro = db.exec(
        select(CentroCusto.id).where(
            CentroCusto.id == centro_resolvido,
            CentroCusto.empresa_id == empresa_id,
            CentroCusto.is_deleted == False,
        )
    ).first()
    if not centro:
        raise HTTPException(status_code=404, detail="Centro de custo nao encontrado para esta empresa")
    return int(centro)


def _buscar_entidade_sugerida(
    db: Session,
    *,
    empresa_id: int,
    nome_referencia: str,
    documento_referencia: str,
) -> Optional[Entidade]:
    documento_limpo = _only_digits(documento_referencia)

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    if documento_limpo:
        for entidade in candidatos:
            if _only_digits(str(entidade.cpf_cnpj or "")) == documento_limpo:
                return entidade

    nome_ref = _normalize_text(nome_referencia)
    if not nome_ref:
        return None

    melhor: Optional[Entidade] = None
    melhor_score = 0.0
    for entidade in candidatos:
        nome_entidade = _normalize_text(str(entidade.nome or ""))
        if not nome_entidade:
            continue
        score = SequenceMatcher(None, nome_ref, nome_entidade).ratio()
        if nome_ref in nome_entidade or nome_entidade in nome_ref:
            score += 0.15
        if score > melhor_score:
            melhor = entidade
            melhor_score = score

    if melhor and melhor_score >= 0.82:
        return melhor
    return None


def _buscar_categoria_sugerida(
    db: Session,
    *,
    empresa_id: int,
    tipo_lancamento: str,
    natureza_operacao: str,
    cfops: list[str],
    ncms: list[str],
) -> Optional[PlanoContas]:
    tipo = _tipo_letra(tipo_lancamento)
    categorias = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.eh_cabecalho == False,
            PlanoContas.oculta == False,
        )
    ).all()

    categorias = [
        categoria
        for categoria in categorias
        if str(categoria.tipo or "").strip().upper().startswith(tipo)
    ]

    if not categorias:
        return None

    if tipo == "D":
        empresa = db.exec(
            select(Empresa).where(
                Empresa.id == empresa_id,
                Empresa.is_deleted == False,
            )
        ).first()

        categoria_configurada_id = int(getattr(empresa, "categoria_nfe_fornecedores_id", 0) or 0)
        if categoria_configurada_id:
            categoria_configurada = next(
                (
                    categoria
                    for categoria in categorias
                    if int(categoria.id or 0) == categoria_configurada_id
                ),
                None,
            )
            if categoria_configurada:
                return categoria_configurada

        melhor_fornecedores: Optional[PlanoContas] = None
        melhor_fornecedores_score = -1
        for categoria in categorias:
            nome = _normalize_text(categoria.nome)
            codigo = _normalize_text(str(categoria.codigo or ""))
            score = 0

            if nome == "fornecedores":
                score += 20
            if "fornecedores" in nome:
                score += 14
            if "fornecedor" in nome:
                score += 12
            if "fornec" in nome:
                score += 10
            if "contas a pagar" in nome or "a pagar" in nome or "pagar" in nome:
                score += 6
            if "fornec" in codigo:
                score += 3

            if score > melhor_fornecedores_score:
                melhor_fornecedores = categoria
                melhor_fornecedores_score = score

        if melhor_fornecedores and melhor_fornecedores_score > 0:
            return melhor_fornecedores

    contexto = " ".join([
        _normalize_text(natureza_operacao),
        " ".join(cfops),
        " ".join(ncms),
    ]).strip()

    if tipo == "R":
        keywords = ["fatur", "venda", "receita", "nota", "nf"]
        if any(str(cfop).startswith(("5", "6", "7")) for cfop in cfops):
            keywords.extend(["venda", "fatur"])
    else:
        keywords = ["compra", "custo", "fornec", "fornecedor", "insumo", "despesa", "mercador", "estoque", "aquis", "revenda"]
        if any(str(cfop).startswith(("1", "2", "3")) for cfop in cfops):
            keywords.extend(["compra", "fornec"])

    melhor: Optional[PlanoContas] = None
    melhor_score = -1

    for categoria in categorias:
        nome = _normalize_text(categoria.nome)
        codigo = _normalize_text(str(categoria.codigo or ""))
        score = 0

        for keyword in keywords:
            if keyword in nome:
                score += 3
            if keyword in codigo:
                score += 2
            if keyword in contexto:
                score += 1

        if "categorizar" in nome:
            score -= 3

        if score > melhor_score:
            melhor = categoria
            melhor_score = score

    if melhor:
        return melhor
    return None


def _tipo_pessoa_por_documento(documento: str) -> str:
    return "PJ" if len(_only_digits(documento)) > 11 else "PF"


def _atualizar_documento_entidade_se_vazio(
    db: Session,
    *,
    empresa_id: int,
    entidade: Entidade,
    documento: str,
    origem: str,
) -> Entidade:
    documento_limpo = _only_digits(documento)
    if len(documento_limpo) not in (11, 14):
        return entidade

    documento_atual = _only_digits(str(entidade.cpf_cnpj or ""))
    if documento_atual:
        return entidade

    entidade.cpf_cnpj = documento_limpo
    entidade.tipo_pessoa = _tipo_pessoa_por_documento(documento_limpo)
    db.add(entidade)
    db.commit()
    db.refresh(entidade)

    logger.info(
        "[NFE] Documento da entidade atualizado automaticamente empresa_id={} entidade_id={} origem={} documento={}",
        empresa_id,
        entidade.id,
        origem,
        documento_limpo,
    )
    return entidade


def _buscar_ou_criar_entidade_nfe(
    db: Session,
    *,
    empresa_id: int,
    documento: NFeDocumento,
) -> Entidade:
    referencia_nome = _normalizar_nome_entidade(documento.entidade_referencia_nome)
    referencia_documento = _only_digits(documento.entidade_referencia_documento)
    emitente_documento = _only_digits(documento.emitente_documento)

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    for entidade in candidatos:
        if referencia_documento and _only_digits(str(entidade.cpf_cnpj or "")) == referencia_documento:
            return entidade

    melhor: Optional[Entidade] = None
    melhor_score = 0.0
    if referencia_nome:
        for entidade in candidatos:
            nome_entidade = _normalize_text(str(entidade.nome or ""))
            if not nome_entidade:
                continue
            score = SequenceMatcher(None, _normalize_text(referencia_nome), nome_entidade).ratio()
            if _normalize_text(referencia_nome) in nome_entidade or nome_entidade in _normalize_text(referencia_nome):
                score += 0.15
            if score > melhor_score:
                melhor = entidade
                melhor_score = score

    if melhor and melhor_score >= 0.82:
        return _atualizar_documento_entidade_se_vazio(
            db,
            empresa_id=empresa_id,
            entidade=melhor,
            documento=emitente_documento or referencia_documento,
            origem="analise_nfe_nome",
        )

    tipo_lancamento = str(documento.tipo_lancamento or "").strip().upper()
    tipo_entidade = "FORNECEDOR" if tipo_lancamento == "DESPESA" else "CLIENTE"
    nome_base = referencia_nome or documento.emitente_nome or documento.destinatario_nome or referencia_documento or "Entidade NF-e"
    nome_fantasia = documento.emitente_nome_fantasia if tipo_lancamento == "DESPESA" else None

    nova_entidade = Entidade(
        nome=nome_base,
        tipo=tipo_entidade,
        tipo_pessoa=_tipo_pessoa_por_documento(referencia_documento or emitente_documento),
        nome_fantasia=nome_fantasia or None,
        cpf_cnpj=referencia_documento or emitente_documento or None,
        telefone=documento.emitente_telefone or None if tipo_lancamento == "DESPESA" else None,
        cep=documento.emitente_cep or None if tipo_lancamento == "DESPESA" else None,
        logradouro=documento.emitente_logradouro or None if tipo_lancamento == "DESPESA" else None,
        numero=documento.emitente_numero or None if tipo_lancamento == "DESPESA" else None,
        complemento=documento.emitente_complemento or None if tipo_lancamento == "DESPESA" else None,
        bairro=documento.emitente_bairro or None if tipo_lancamento == "DESPESA" else None,
        cidade=documento.emitente_cidade or None if tipo_lancamento == "DESPESA" else None,
        uf=documento.emitente_uf or None if tipo_lancamento == "DESPESA" else None,
        observacoes=f"Criada automaticamente pela importacao da NF-e {documento.numero_nfe} ({documento.chave_nfe})",
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    logger.info(
        "[NFE] Entidade criada automaticamente empresa_id={} entidade_id={} nome={} documento={}",
        empresa_id,
        nova_entidade.id,
        nova_entidade.nome,
        nova_entidade.cpf_cnpj,
    )
    return nova_entidade


def _assert_categoria_valida(
    db: Session,
    *,
    empresa_id: int,
    categoria_id: int,
    tipo_lancamento: str,
) -> PlanoContas:
    categoria = db.exec(
        select(PlanoContas).where(
            PlanoContas.id == categoria_id,
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
        )
    ).first()
    if not categoria:
        raise HTTPException(status_code=400, detail=f"Categoria {categoria_id} nao encontrada para esta empresa")

    if categoria.eh_cabecalho or not categoria.permite_lancamentos:
        raise HTTPException(status_code=400, detail=f"Categoria {categoria_id} nao permite lancamentos")

    tipo_esperado = _tipo_letra(tipo_lancamento)
    categoria_tipo = str(categoria.tipo or "").strip().upper()
    if not categoria_tipo.startswith(tipo_esperado):
        raise HTTPException(
            status_code=400,
            detail=f"Categoria {categoria_id} incompativel com o tipo {tipo_lancamento}",
        )

    return categoria


def _assert_entidade_valida(db: Session, *, empresa_id: int, entidade_id: int) -> Entidade:
    entidade = db.exec(
        select(Entidade).where(
            Entidade.id == entidade_id,
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).first()
    if not entidade:
        raise HTTPException(status_code=400, detail=f"Entidade {entidade_id} nao encontrada para esta empresa")
    return entidade


def _resolver_entidade_confirmacao_nfe(
    db: Session,
    *,
    empresa_id: int,
    request: NfeConfirmarRequest,
) -> Entidade:
    if request.entidade_id:
        entidade_selecionada = _assert_entidade_valida(db, empresa_id=empresa_id, entidade_id=int(request.entidade_id))
        return _atualizar_documento_entidade_se_vazio(
            db,
            empresa_id=empresa_id,
            entidade=entidade_selecionada,
            documento=str(request.emitente_documento or ""),
            origem="confirmacao_nfe_entidade_selecionada",
        )

    emitente_nome = _normalizar_nome_entidade(request.emitente_nome or request.emitente_nome_fantasia or "")
    emitente_documento = _only_digits(request.emitente_documento or "")

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    if emitente_documento:
        for entidade in candidatos:
            if _only_digits(str(entidade.cpf_cnpj or "")) == emitente_documento:
                return entidade

    if emitente_nome:
        melhor: Optional[Entidade] = None
        melhor_score = 0.0
        for entidade in candidatos:
            nome_entidade = _normalize_text(str(entidade.nome or ""))
            if not nome_entidade:
                continue
            score = SequenceMatcher(None, _normalize_text(emitente_nome), nome_entidade).ratio()
            if _normalize_text(emitente_nome) in nome_entidade or nome_entidade in _normalize_text(emitente_nome):
                score += 0.15
            if score > melhor_score:
                melhor = entidade
                melhor_score = score

        if melhor and melhor_score >= 0.82:
            return _atualizar_documento_entidade_se_vazio(
                db,
                empresa_id=empresa_id,
                entidade=melhor,
                documento=emitente_documento,
                origem="confirmacao_nfe_nome",
            )

    nova_entidade = Entidade(
        nome=emitente_nome or request.emitente_nome_fantasia or "Fornecedor NF-e",
        tipo="FORNECEDOR",
        tipo_pessoa=_tipo_pessoa_por_documento(emitente_documento or request.emitente_documento or ""),
        nome_fantasia=request.emitente_nome_fantasia or None,
        cpf_cnpj=emitente_documento or None,
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    logger.info(
        "[NFE] Entidade criada automaticamente na confirmacao empresa_id={} entidade_id={} nome={} documento={}",
        empresa_id,
        nova_entidade.id,
        nova_entidade.nome,
        nova_entidade.cpf_cnpj,
    )
    return nova_entidade


@router.get(
    "/nfe/list",
    response_model=NfeListResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def listar_nfes_importadas(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filtro: str = Query("TODOS", alias="status", pattern="^(TODOS|AGUARDANDO_ENTREGA|ENTREGUE|CANCELADA)$"),
    order_by: str = Query("data", pattern="^(data|valor|descricao|status)$"),
    order_dir: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    termo_busca = str(search or "").strip()
    group_key = func.coalesce(Lancamento.id_parcelamento, func.concat("NFE-ID-", cast(Lancamento.id, String)))
    total_parcelas_expr = func.count(Lancamento.id)
    total_pagas_expr = func.sum(case((Lancamento.status == "PAGO", 1), else_=0))
    total_atrasadas_expr = func.sum(
        case(
            ((Lancamento.status != "PAGO") & (Lancamento.data_vencimento < date.today()), 1),
            else_=0,
        )
    )

    grouped_stmt = (
        select(
            group_key.label("id_parcelamento"),
            func.max(Lancamento.id).label("id_referencia"),
            func.coalesce(func.sum(Lancamento.valor_previsto), 0).label("valor_total"),
            total_parcelas_expr.label("total_parcelas"),
            total_pagas_expr.label("total_pagas"),
            total_atrasadas_expr.label("total_atrasadas"),
            func.max(Lancamento.data_competencia).label("data_emissao"),
            func.min(Lancamento.data_vencimento).label("data_vencimento_min"),
            func.max(Lancamento.data_vencimento).label("data_vencimento_max"),
            func.max(Lancamento.descricao).label("descricao_ref"),
            func.max(Lancamento.observacao).label("observacao_ref"),
            func.max(Lancamento.centro_custo_id).label("centro_custo_id"),
        )
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "NFE_XML",
        )
    )

    if termo_busca:
        like_term = f"%{termo_busca}%"
        grouped_stmt = grouped_stmt.where(
            Lancamento.descricao.ilike(like_term)
            | Lancamento.observacao.ilike(like_term)
            | Lancamento.id_parcelamento.ilike(like_term)
        )

    if status_filtro == "ENTREGUE":
        grouped_stmt = grouped_stmt.where(Lancamento.observacao.ilike("%Situacao ENTREGUE%"))
    elif status_filtro == "CANCELADA":
        grouped_stmt = grouped_stmt.where(Lancamento.observacao.ilike("%Situacao CANCELADA%"))
    elif status_filtro == "AGUARDANDO_ENTREGA":
        grouped_stmt = grouped_stmt.where(
            (Lancamento.observacao.is_(None))
            | Lancamento.observacao.ilike("%Situacao AGUARDANDO_ENTREGA%")
            | (
                (~Lancamento.observacao.ilike("%Situacao ENTREGUE%"))
                & (~Lancamento.observacao.ilike("%Situacao CANCELADA%"))
            )
        )

    grouped_stmt = grouped_stmt.group_by(group_key)

    grouped_subquery = grouped_stmt.subquery()
    total_items = int(db.exec(select(func.count()).select_from(grouped_subquery)).first() or 0)
    total_pages = max(1, ceil(total_items / page_size)) if total_items else 1
    current_page = min(page, total_pages)
    offset = (current_page - 1) * page_size

    status_sort_rank = case(
        (grouped_subquery.c.observacao_ref.ilike("%Situacao ENTREGUE%"), 0),
        (grouped_subquery.c.observacao_ref.ilike("%Situacao CANCELADA%"), 2),
        else_=1,
    )
    sort_map = {
        "data": grouped_subquery.c.data_emissao,
        "valor": grouped_subquery.c.valor_total,
        "descricao": grouped_subquery.c.descricao_ref,
        "status": status_sort_rank,
    }
    sort_col = sort_map.get(order_by, grouped_subquery.c.data_emissao)
    sort_fn = asc if order_dir == "asc" else desc

    paged_rows = db.exec(
        select(
            grouped_subquery.c.id_parcelamento,
            grouped_subquery.c.id_referencia,
            grouped_subquery.c.valor_total,
            grouped_subquery.c.total_parcelas,
            grouped_subquery.c.total_pagas,
            grouped_subquery.c.total_atrasadas,
            grouped_subquery.c.data_emissao,
            grouped_subquery.c.data_vencimento_max,
            grouped_subquery.c.descricao_ref,
            grouped_subquery.c.observacao_ref,
            grouped_subquery.c.centro_custo_id,
        )
        .order_by(sort_fn(sort_col), desc(grouped_subquery.c.id_referencia))
        .offset(offset)
        .limit(page_size)
    ).all()

    centro_custo_ids = {
        int(centro_custo_id)
        for (
            _id_parcelamento,
            _id_referencia,
            _valor_total,
            _total_parcelas,
            _total_pagas,
            _total_atrasadas,
            _data_emissao,
            _data_vencimento,
            _descricao_ref,
            _observacao_ref,
            centro_custo_id,
        ) in paged_rows
        if centro_custo_id is not None
    }

    centro_custo_map: dict[int, str] = {}
    if centro_custo_ids:
        centro_custo_rows = db.exec(
            select(CentroCusto.id, CentroCusto.nome).where(
                CentroCusto.id.in_(centro_custo_ids),
                CentroCusto.empresa_id == empresa_id,
                CentroCusto.is_deleted == False,
            )
        ).all()
        centro_custo_map = {int(centro_custo_id): str(nome or "") for centro_custo_id, nome in centro_custo_rows}

    items: list[NfeListItem] = []
    for (
        id_parcelamento_raw,
        _id_referencia,
        valor_total_raw,
        total_parcelas_raw,
        total_pagas_raw,
        total_atrasadas_raw,
        data_emissao,
        data_vencimento,
        descricao_ref_raw,
        observacao_ref_raw,
        centro_custo_id,
    ) in paged_rows:
        id_parcelamento = str(id_parcelamento_raw or "")
        descricao_ref = str(descricao_ref_raw or "").strip()
        observacao_ref = str(observacao_ref_raw or "").strip()
        texto_referencia = f"{observacao_ref} {descricao_ref}".strip()

        numero_nfe = _extract_nfe_number(texto_referencia)
        chave_nfe = _extract_nfe_key(texto_referencia)
        if not chave_nfe and id_parcelamento.startswith("NFE-"):
            possivel_chave = _only_digits(id_parcelamento)
            if len(possivel_chave) == 44:
                chave_nfe = possivel_chave

        total_parcelas = int(total_parcelas_raw or 0)
        status_resumo = _extrair_situacao_nfe(texto_referencia)
        total_pagas = int(total_pagas_raw or 0)
        if status_resumo == "AGUARDANDO_ENTREGA" and total_parcelas > 0 and total_pagas >= total_parcelas:
            status_resumo = "ENTREGUE"

        items.append(
            NfeListItem(
                id_parcelamento=id_parcelamento,
                numero_nfe=numero_nfe,
                chave_nfe=chave_nfe,
                descricao=f"NF-e {numero_nfe}" if numero_nfe != "-" else (descricao_ref or "NF-e importada"),
                centro_custo_nome=centro_custo_map.get(int(centro_custo_id)) if centro_custo_id is not None else None,
                total_parcelas=total_parcelas,
                valor_total=float(valor_total_raw or 0),
                data_emissao=data_emissao.isoformat() if data_emissao else None,
                data_vencimento=data_vencimento.isoformat() if data_vencimento else None,
                status=status_resumo,
            )
        )

    return NfeListResponse(
        page=current_page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
        items=items,
    )


@router.get(
    "/nfe/{id_parcelamento}/detalhe",
    response_model=NfeDetalheResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def obter_detalhe_nfe_importada(
    id_parcelamento: str,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    group_id = str(id_parcelamento or "").strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="Identificador da NF-e invalido")

    lancamentos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "NFE_XML",
            Lancamento.id_parcelamento == group_id,
        )
        .order_by(Lancamento.numero_parcela.asc(), Lancamento.id.asc())
    ).all()

    if not lancamentos:
        raise HTTPException(status_code=404, detail="NF-e importada nao encontrada")

    texto_referencia = " ".join(
        f"{str(l.observacao or '').strip()} {str(l.descricao or '').strip()}".strip() for l in lancamentos
    ).strip()
    numero_nfe = _extract_nfe_number(texto_referencia)
    chave_nfe = _extract_nfe_key(texto_referencia)
    cfop_nfe = _extract_cfop(texto_referencia)
    emitente_documento_meta = _extract_emitente_documento(texto_referencia)
    if not chave_nfe and group_id.startswith("NFE-"):
        possivel_chave = _only_digits(group_id)
        if len(possivel_chave) == 44:
            chave_nfe = possivel_chave

    emitente_documento_chave = _extract_cnpj_from_nfe_key(chave_nfe)

    primeiro = lancamentos[0]
    entidade: Optional[Entidade] = None
    if primeiro.entidade_id is not None:
        entidade = db.exec(
            select(Entidade).where(
                Entidade.id == primeiro.entidade_id,
                Entidade.empresa_id == empresa_id,
                Entidade.is_deleted == False,
            )
        ).first()

    centro_custo_nome: Optional[str] = None
    if primeiro.centro_custo_id is not None:
        centro_custo_nome = db.exec(
            select(CentroCusto.nome).where(
                CentroCusto.id == primeiro.centro_custo_id,
                CentroCusto.empresa_id == empresa_id,
                CentroCusto.is_deleted == False,
            )
        ).first()

    emitente_documento = _only_digits(str((entidade.cpf_cnpj if entidade else "") or ""))
    if not emitente_documento:
        emitente_documento = emitente_documento_meta or emitente_documento_chave or ""

    anexo_pdf_nome: Optional[str] = None
    anexo_pdf_url: Optional[str] = None
    anexo_frete_nome: Optional[str] = None
    anexo_frete_url: Optional[str] = None
    lancamento_ids = [int(lancamento.id) for lancamento in lancamentos if lancamento.id is not None]
    if lancamento_ids:
        anexo_pdf_row = db.exec(
            select(AnexoLancamento.nome_arquivo, AnexoLancamento.url)
            .where(
                AnexoLancamento.empresa_id == empresa_id,
                AnexoLancamento.is_deleted == False,
                AnexoLancamento.tipo == "NOTA_FISCAL",
                AnexoLancamento.lancamento_id.in_(lancamento_ids),
            )
            .order_by(desc(AnexoLancamento.created_at), desc(AnexoLancamento.id))
        ).first()
        if anexo_pdf_row:
            anexo_pdf_nome = str(anexo_pdf_row[0] or "").strip() or None
            anexo_pdf_url = str(anexo_pdf_row[1] or "").strip() or None

        anexo_frete_row = db.exec(
            select(AnexoLancamento.nome_arquivo, AnexoLancamento.url)
            .where(
                AnexoLancamento.empresa_id == empresa_id,
                AnexoLancamento.is_deleted == False,
                AnexoLancamento.tipo == "FRETE",
                AnexoLancamento.lancamento_id.in_(lancamento_ids),
            )
            .order_by(desc(AnexoLancamento.created_at), desc(AnexoLancamento.id))
        ).first()
        if anexo_frete_row:
            anexo_frete_nome = str(anexo_frete_row[0] or "").strip() or None
            anexo_frete_url = str(anexo_frete_row[1] or "").strip() or None

    total_parcelas = len(lancamentos)
    status_resumo = _extrair_situacao_nfe(texto_referencia)
    total_pagas = sum(1 for lancamento in lancamentos if str(lancamento.status or "").strip().upper() == "PAGO")
    if status_resumo == "AGUARDANDO_ENTREGA" and total_parcelas > 0 and total_pagas >= total_parcelas:
        status_resumo = "ENTREGUE"

    itens_meta = _extract_itens_meta(texto_referencia)

    parcelas: list[NfeParcelaDetalhe] = []
    total_valor = Decimal("0")
    for idx, lancamento in enumerate(lancamentos, start=1):
        valor = Decimal(lancamento.valor_previsto or 0)
        total_valor += valor
        indice = int(lancamento.numero_parcela or idx)
        parcelas.append(
            NfeParcelaDetalhe(
                id=int(lancamento.id or 0),
                indice=indice,
                numero_parcela=str(lancamento.numero_parcela or indice),
                data_vencimento=lancamento.data_vencimento.isoformat() if lancamento.data_vencimento else "",
                valor=float(valor),
                descricao=str(lancamento.descricao or ""),
                status=str(lancamento.status or ""),
                plano_contas_id=int(lancamento.plano_contas_id) if lancamento.plano_contas_id is not None else None,
                entidade_id=int(lancamento.entidade_id) if lancamento.entidade_id is not None else None,
            )
        )

    itens_detalhe = _itens_meta_to_response(itens_meta)
    if not itens_detalhe and total_valor > 0:
        descricao_item = f"NF-e {numero_nfe}" if numero_nfe != "-" else "Item NF-e"
        itens_detalhe = [
            NfeItemAnalise(
                descricao=descricao_item,
                quantidade=1.0,
                valor_unitario=float(total_valor),
                valor_total=float(total_valor),
                cfop=cfop_nfe,
                ncm=None,
            )
        ]

    data_emissao = (primeiro.data_competencia or primeiro.data_vencimento or date.today()).isoformat()
    observacao_texto = str(primeiro.observacao or "")

    return NfeDetalheResponse(
        id_parcelamento=group_id,
        numero_nfe=numero_nfe,
        chave_nfe=chave_nfe,
        cfop=cfop_nfe,
        tipo_lancamento=str(primeiro.tipo or "DESPESA").strip().upper() or "DESPESA",
        data_emissao=data_emissao,
        destino_compra=_extract_destino_compra(observacao_texto),
        valor_frete=float(_extract_valor_frete(observacao_texto) or Decimal("0")),
        emitente_nome=str((entidade.nome if entidade else "") or ""),
        emitente_documento=emitente_documento,
        anexo_pdf_nome=anexo_pdf_nome,
        anexo_pdf_url=anexo_pdf_url,
        anexo_frete_nome=anexo_frete_nome,
        anexo_frete_url=anexo_frete_url,
        entidade_id=int(primeiro.entidade_id) if primeiro.entidade_id is not None else None,
        plano_contas_id=int(primeiro.plano_contas_id) if primeiro.plano_contas_id is not None else None,
        centro_custo_id=int(primeiro.centro_custo_id) if primeiro.centro_custo_id is not None else None,
        centro_custo_nome=centro_custo_nome,
        total_parcelas=total_parcelas,
        valor_total=float(total_valor),
        status=status_resumo,
        itens=itens_detalhe,
        parcelas=parcelas,
    )


@router.put(
    "/nfe/{id_parcelamento}",
    response_model=NfeAtualizarResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def atualizar_nfe_importada(
    id_parcelamento: str,
    request: NfeAtualizarRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    group_id = str(id_parcelamento or "").strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="Identificador da NF-e invalido")

    lancamentos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "NFE_XML",
            Lancamento.id_parcelamento == group_id,
        )
        .order_by(Lancamento.numero_parcela.asc(), Lancamento.id.asc())
    ).all()

    if not lancamentos:
        raise HTTPException(status_code=404, detail="NF-e importada nao encontrada")

    numero_nfe = str(request.numero_nfe or "").strip()
    if not numero_nfe:
        raise HTTPException(status_code=400, detail="Informe o numero da NF-e")

    tipo_lancamento = str(lancamentos[0].tipo or "").strip().upper() or "DESPESA"
    if tipo_lancamento != "DESPESA":
        raise HTTPException(
            status_code=400,
            detail=f"Apenas NF-e de DESPESA pode ser editada neste fluxo. Tipo atual: {tipo_lancamento}",
        )

    texto_referencia = " ".join(
        f"{str(l.observacao or '').strip()} {str(l.descricao or '').strip()}".strip() for l in lancamentos
    ).strip()
    chave_nfe = _only_digits(request.chave_nfe or _extract_nfe_key(texto_referencia) or "")
    cfop_nfe = _normalizar_cfop(request.cfop or _extract_cfop(texto_referencia))
    if not chave_nfe and group_id.startswith("NFE-"):
        possivel_chave = _only_digits(group_id)
        if len(possivel_chave) == 44:
            chave_nfe = possivel_chave

    observacao_padrao = f"NF-e {numero_nfe}"
    if chave_nfe:
        observacao_padrao = f"{observacao_padrao} | Chave {chave_nfe}"
    situacao_nfe = _normalizar_situacao_nfe(request.situacao)

    plano_contas_id_raw = request.plano_contas_id if request.plano_contas_id is not None else lancamentos[0].plano_contas_id
    if plano_contas_id_raw is None:
        raise HTTPException(status_code=400, detail="Categoria financeira nao definida para a NF-e")
    plano_contas_id = int(plano_contas_id_raw)
    _assert_categoria_valida(
        db,
        empresa_id=empresa_id,
        categoria_id=plano_contas_id,
        tipo_lancamento=tipo_lancamento,
    )

    entidade_id_raw = request.entidade_id if request.entidade_id is not None else lancamentos[0].entidade_id
    if entidade_id_raw is None:
        raise HTTPException(status_code=400, detail="Fornecedor da NF-e nao definido")
    entidade_id = int(entidade_id_raw)
    entidade = _assert_entidade_valida(db, empresa_id=empresa_id, entidade_id=entidade_id)

    emitente_documento_nfe = (
        _only_digits(request.emitente_documento or "")
        or _extract_emitente_documento(texto_referencia)
        or _only_digits(str(entidade.cpf_cnpj or ""))
        or _extract_cnpj_from_nfe_key(chave_nfe)
        or ""
    )
    itens_meta = _normalizar_itens_nfe(request.itens)
    if not itens_meta:
        itens_meta = _extract_itens_meta(texto_referencia)

    observacao_base = _compor_observacao_com_situacao(
        request.observacao or observacao_padrao,
        situacao_nfe,
        cfop=cfop_nfe,
        emitente_documento=emitente_documento_nfe,
        itens_meta=itens_meta,
    )

    centro_custo_id_raw = (
        request.centro_custo_id if request.centro_custo_id is not None else lancamentos[0].centro_custo_id
    )
    centro_custo_id = _resolver_centro_custo(
        db,
        empresa_id=empresa_id,
        centro_custo_id=int(centro_custo_id_raw) if centro_custo_id_raw is not None else None,
        conta=None,
    )

    parcelas_por_id = {int(parcela.id): parcela for parcela in request.parcelas}
    ids_lancamentos = {int(lancamento.id) for lancamento in lancamentos if lancamento.id is not None}
    ids_invalidos = sorted(parcela_id for parcela_id in parcelas_por_id if parcela_id not in ids_lancamentos)
    if ids_invalidos:
        raise HTTPException(status_code=400, detail=f"Parcelas invalidas para edicao: {ids_invalidos}")

    competencia = request.data_emissao.strftime("%m/%Y")
    atualizados = 0
    total_valor = Decimal("0")

    try:
        for idx, lancamento in enumerate(lancamentos, start=1):
            parcela_request = parcelas_por_id.get(int(lancamento.id or 0))
            if parcela_request:
                lancamento.valor_previsto = parcela_request.valor
                if parcela_request.data_vencimento is not None:
                    lancamento.data_vencimento = parcela_request.data_vencimento

            lancamento.descricao = _descricao_parcela(numero_nfe, int(lancamento.numero_parcela or idx), len(lancamentos))

            lancamento.data_competencia = request.data_emissao
            lancamento.competencia = competencia
            lancamento.observacao = observacao_base
            lancamento.plano_contas_id = plano_contas_id
            lancamento.entidade_id = entidade_id
            lancamento.centro_custo_id = centro_custo_id

            total_valor += Decimal(lancamento.valor_previsto or 0)
            db.add(lancamento)
            atualizados += 1

        db.commit()
    except Exception:
        db.rollback()
        raise

    return NfeAtualizarResponse(
        id_parcelamento=group_id,
        total_parcelas=len(lancamentos),
        lancamentos_atualizados=atualizados,
        valor_total=float(total_valor),
    )


@router.post(
    "/nfe/{id_parcelamento}/anexo-pdf",
    response_model=NfeAnexoPdfResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def anexar_pdf_nfe_importada(
    id_parcelamento: str,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_user),
):
    group_id = str(id_parcelamento or "").strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="Identificador da NF-e invalido")

    if not arquivo.filename:
        raise HTTPException(status_code=400, detail="Informe o arquivo PDF da NF-e")

    nome_arquivo = Path(arquivo.filename).name.strip()
    if not nome_arquivo or not nome_arquivo.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Envie um arquivo PDF valido")

    lancamento_id_rows = db.exec(
        select(Lancamento.id)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "NFE_XML",
            Lancamento.id_parcelamento == group_id,
        )
        .order_by(Lancamento.id.asc())
    ).all()

    lancamento_ids = [int(lancamento_id) for lancamento_id in lancamento_id_rows if lancamento_id is not None]
    if not lancamento_ids:
        raise HTTPException(status_code=404, detail="NF-e importada nao encontrada")

    group_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", group_id).strip("_") or "nfe"
    destino_dir = Path("static/uploads/lancamentos") / str(empresa_id) / "nfe" / group_safe
    nome_storage = f"{uuid.uuid4().hex}.pdf"
    destino_arquivo = destino_dir / nome_storage

    try:
        _, tamanho_bytes, content_type = write_validated_upload_file(
            upload=arquivo,
            destination=destino_arquivo,
            max_size=NFE_PDF_FILE_SIZE_LIMIT,
            allowed_ext_to_mime=ANEXO_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        if exc.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Arquivo PDF muito grande. Maximo de 10 MB.",
            )
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    url_relativa = f"/static/uploads/lancamentos/{empresa_id}/nfe/{group_safe}/{nome_storage}"
    user_id = int(getattr(current_user, "id", 0) or 0) or None

    anexos_criados = 0
    anexados_em: list[int] = []
    for lancamento_id in lancamento_ids:
        anexo = AnexoLancamento(
            nome_arquivo=nome_arquivo,
            url=url_relativa,
            tipo="NOTA_FISCAL",
            tamanho_bytes=tamanho_bytes,
            content_type=content_type,
            lancamento_id=lancamento_id,
            empresa_id=empresa_id,
            created_by_id=user_id,
        )
        db.add(anexo)
        anexos_criados += 1
        anexados_em.append(lancamento_id)

    db.commit()

    logger.info(
        "[NFE] PDF anexado empresa_id={} id_parcelamento={} anexos_criados={} arquivo={}",
        empresa_id,
        group_id,
        anexos_criados,
        nome_arquivo,
    )

    return NfeAnexoPdfResponse(
        id_parcelamento=group_id,
        nome_arquivo=nome_arquivo,
        url=url_relativa,
        anexos_criados=anexos_criados,
        lancamento_ids=anexados_em,
    )


@router.post(
    "/nfe/{id_parcelamento}/anexo-frete",
    response_model=NfeAnexoPdfResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def anexar_frete_nfe_importada(
    id_parcelamento: str,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_user),
):
    group_id = str(id_parcelamento or "").strip()
    if not group_id:
        raise HTTPException(status_code=400, detail="Identificador da NF-e invalido")

    if not arquivo.filename:
        raise HTTPException(status_code=400, detail="Informe o arquivo de frete da NF-e")

    nome_arquivo = Path(arquivo.filename).name.strip()
    if not nome_arquivo:
        raise HTTPException(status_code=400, detail="Informe o arquivo de frete da NF-e")

    lancamento_id_rows = db.exec(
        select(Lancamento.id)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "NFE_XML",
            Lancamento.id_parcelamento == group_id,
        )
        .order_by(Lancamento.id.asc())
    ).all()

    lancamento_ids = [int(lancamento_id) for lancamento_id in lancamento_id_rows if lancamento_id is not None]
    if not lancamento_ids:
        raise HTTPException(status_code=404, detail="NF-e importada nao encontrada")

    group_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", group_id).strip("_") or "nfe"
    destino_dir = Path("static/uploads/lancamentos") / str(empresa_id) / "nfe" / group_safe
    nome_storage = f"{uuid.uuid4().hex}{Path(nome_arquivo).suffix or '.pdf'}"
    destino_arquivo = destino_dir / nome_storage

    try:
        _, tamanho_bytes, content_type = write_validated_upload_file(
            upload=arquivo,
            destination=destino_arquivo,
            max_size=NFE_PDF_FILE_SIZE_LIMIT,
            allowed_ext_to_mime=ANEXO_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        if exc.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Arquivo de frete muito grande. Maximo de 10 MB.",
            )
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    url_relativa = f"/static/uploads/lancamentos/{empresa_id}/nfe/{group_safe}/{nome_storage}"
    user_id = int(getattr(current_user, "id", 0) or 0) or None

    anexos_criados = 0
    anexados_em: list[int] = []
    for lancamento_id in lancamento_ids:
        anexo = AnexoLancamento(
            nome_arquivo=nome_arquivo,
            url=url_relativa,
            tipo="FRETE",
            tamanho_bytes=tamanho_bytes,
            content_type=content_type,
            lancamento_id=lancamento_id,
            empresa_id=empresa_id,
            created_by_id=user_id,
        )
        db.add(anexo)
        anexos_criados += 1
        anexados_em.append(lancamento_id)

    db.commit()

    logger.info(
        "[NFE] Frete anexado empresa_id={} id_parcelamento={} anexos_criados={} arquivo={}",
        empresa_id,
        group_id,
        anexos_criados,
        nome_arquivo,
    )

    return NfeAnexoPdfResponse(
        id_parcelamento=group_id,
        nome_arquivo=nome_arquivo,
        url=url_relativa,
        anexos_criados=anexos_criados,
        lancamento_ids=anexados_em,
    )


@router.post(
    "/nfe/analisar",
    response_model=NfeAnaliseResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def analisar_nfe_xml(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not arquivo.filename or not arquivo.filename.lower().endswith(".xml"):
        raise HTTPException(status_code=400, detail="Selecione um arquivo XML de NF-e")

    if arquivo.size and arquivo.size > NFE_FILE_SIZE_LIMIT:
        raise HTTPException(status_code=400, detail="Arquivo XML excede o limite de 5 MB")

    logger.info(
        "[NFE] Inicio analise XML empresa_id={} conta_id={} arquivo={}",
        empresa_id,
        conta_id,
        arquivo.filename,
    )

    try:
        _resolver_conta(db, empresa_id=empresa_id, conta_id=conta_id)

        empresa = db.exec(
            select(Empresa).where(
                Empresa.id == empresa_id,
                Empresa.is_deleted == False,
            )
        ).first()

        conteudo = arquivo.file.read()
        if len(conteudo) > NFE_FILE_SIZE_LIMIT:
            raise HTTPException(status_code=400, detail="Arquivo XML excede o limite de 5 MB")

        documento: NFeDocumento = parse_nfe_xml(conteudo, empresa_cnpj=str(empresa.cnpj or "") if empresa else "")

        entidade_sugerida = _buscar_entidade_sugerida(
            db,
            empresa_id=empresa_id,
            nome_referencia=documento.entidade_referencia_nome,
            documento_referencia=documento.entidade_referencia_documento,
        )
        if not entidade_sugerida:
            entidade_sugerida = _buscar_ou_criar_entidade_nfe(
                db,
                empresa_id=empresa_id,
                documento=documento,
            )
        categoria_sugerida = _buscar_categoria_sugerida(
            db,
            empresa_id=empresa_id,
            tipo_lancamento=documento.tipo_lancamento,
            natureza_operacao=documento.natureza_operacao,
            cfops=documento.cfops,
            ncms=documento.ncms,
        )

        total_parcelas = len(documento.parcelas)
        parcelas_payload: list[NfeParcelaAnalise] = []
        for parcela in documento.parcelas:
            parcelas_payload.append(
                NfeParcelaAnalise(
                    indice=parcela.index,
                    numero_parcela=parcela.numero_label,
                    data_vencimento=parcela.data_vencimento.isoformat(),
                    valor=float(parcela.valor),
                    descricao=_descricao_parcela(documento.numero_nfe, parcela.index, total_parcelas),
                    cfop=documento.cfops[0] if documento.cfops else None,
                    ncm=documento.ncms[0] if documento.ncms else None,
                    plano_contas_sugerido_id=int(categoria_sugerida.id) if categoria_sugerida and categoria_sugerida.id else None,
                    plano_contas_sugerido_nome=categoria_sugerida.nome if categoria_sugerida else None,
                    entidade_sugerida_id=int(entidade_sugerida.id) if entidade_sugerida and entidade_sugerida.id else None,
                    entidade_sugerida_nome=entidade_sugerida.nome if entidade_sugerida else None,
                    requer_entidade_manual=False,
                    requer_categoria_manual=categoria_sugerida is None,
                )
            )

        alertas: list[str] = []
        if not categoria_sugerida:
            alertas.append(
                "Nao foi possivel sugerir uma categoria compativel. Verifique o plano de contas antes de confirmar."
            )

        logger.info(
            "[NFE] Analise concluida empresa_id={} chave_nfe={} parcelas={} alerta_count={}",
            empresa_id,
            documento.chave_nfe,
            total_parcelas,
            len(alertas),
        )

        return NfeAnaliseResponse(
            chave_nfe=documento.chave_nfe,
            numero_nfe=documento.numero_nfe,
            serie=documento.serie,
            tipo_lancamento=documento.tipo_lancamento,
            data_emissao=documento.data_emissao.isoformat(),
            valor_total=float(documento.valor_total),
            emitente_nome=documento.emitente_nome,
            emitente_documento=documento.emitente_documento,
            destinatario_nome=documento.destinatario_nome,
            destinatario_documento=documento.destinatario_documento,
            entidade_referencia_nome=documento.entidade_referencia_nome,
            entidade_referencia_documento=documento.entidade_referencia_documento,
            valor_produtos=float(documento.valor_produtos),
            valor_frete=float(documento.valor_frete),
            valor_seguro=float(documento.valor_seguro),
            valor_desconto=float(documento.valor_desconto),
            valor_outros=float(documento.valor_outros),
            entidade_sugerida_id=int(entidade_sugerida.id) if entidade_sugerida and entidade_sugerida.id else None,
            entidade_sugerida_nome=entidade_sugerida.nome if entidade_sugerida else None,
            plano_contas_sugerido_id=int(categoria_sugerida.id) if categoria_sugerida and categoria_sugerida.id else None,
            plano_contas_sugerido_nome=categoria_sugerida.nome if categoria_sugerida else None,
            itens=[
                NfeItemAnalise(
                    descricao=str(item.descricao or "").strip() or "Item",
                    quantidade=float(item.quantidade),
                    valor_unitario=float(item.valor_unitario),
                    valor_total=float(item.valor_total),
                    cfop=item.cfop or None,
                    ncm=item.ncm or None,
                )
                for item in documento.itens
            ],
            parcelas=parcelas_payload,
            alertas=alertas,
            pode_confirmar=bool(documento.parcelas),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning(
            "[NFE] Erro de validacao no XML empresa_id={} arquivo={} detalhe={}",
            empresa_id,
            arquivo.filename,
            str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "[NFE] Falha inesperada na analise empresa_id={} arquivo={} erro={}",
            empresa_id,
            arquivo.filename,
            str(exc),
        )
        raise HTTPException(status_code=500, detail="Erro interno ao analisar XML de NF-e") from exc


@router.post(
    "/nfe/confirmar",
    response_model=NfeConfirmarResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def confirmar_importacao_nfe(
    request: NfeConfirmarRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not request.parcelas:
        raise HTTPException(status_code=400, detail="Envie ao menos uma parcela para importacao")

    tipo_lancamento = str(request.tipo_lancamento or "").strip().upper()
    if tipo_lancamento != "DESPESA":
        raise HTTPException(status_code=400, detail="Importacao de NF-e aceita apenas DESPESA")
        raise HTTPException(status_code=400, detail="Tipo de lancamento invalido para importacao NF-e")

    chave_nfe = _only_digits(request.chave_nfe)
    if not chave_nfe:
        raise HTTPException(status_code=400, detail="Chave da NF-e invalida")

    numero_nfe = str(request.numero_nfe or "").strip()
    if not numero_nfe:
        raise HTTPException(status_code=400, detail="Numero da NF-e obrigatorio")

    parcela_group_id = _parcelamento_id(chave_nfe)
    situacao_nfe = _normalizar_situacao_nfe(request.situacao)

    logger.info(
        "[NFE] Inicio confirmacao empresa_id={} chave_nfe={} parcelas={} conta_id={} centro_custo_id={}",
        empresa_id,
        chave_nfe,
        len(request.parcelas),
        request.conta_id,
        request.centro_custo_id,
    )

    existente = db.exec(
        select(Lancamento.id).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.id_parcelamento == parcela_group_id,
            Lancamento.origem == "NFE_XML",
            Lancamento.is_deleted == False,
        )
    ).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta NF-e ja foi importada para esta empresa",
        )

    conta = _resolver_conta(db, empresa_id=empresa_id, conta_id=request.conta_id)
    centro_custo_id = _resolver_centro_custo(
        db,
        empresa_id=empresa_id,
        centro_custo_id=request.centro_custo_id,
        conta=conta,
    )
    entidade_padrao = _resolver_entidade_confirmacao_nfe(db, empresa_id=empresa_id, request=request)
    cfop_nfe = _normalizar_cfop(request.cfop)
    emitente_documento_nfe = (
        _only_digits(request.emitente_documento or "")
        or _only_digits(str(entidade_padrao.cpf_cnpj or ""))
        or _extract_cnpj_from_nfe_key(chave_nfe)
        or ""
    )
    itens_meta = _normalizar_itens_nfe(request.itens)

    hashes_lote = [_import_hash(empresa_id, chave_nfe, parcela.indice) for parcela in request.parcelas]
    if len(set(hashes_lote)) != len(hashes_lote):
        raise HTTPException(status_code=400, detail="Parcelas duplicadas no payload de confirmacao")

    lancamento_table = getattr(Lancamento, "__table__")
    existing_hash = db.exec(
        select(Lancamento.import_hash).where(
            lancamento_table.c.empresa_id == empresa_id,
            lancamento_table.c.is_deleted == False,
            lancamento_table.c.import_hash.in_(hashes_lote),
        )
    ).first()
    if existing_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ja existe lancamento importado para uma ou mais parcelas desta NF-e",
        )

    lancamentos: list[Lancamento] = []
    total_parcelas = len(request.parcelas)

    try:
        for parcela in request.parcelas:
            categoria_id = int(parcela.plano_contas_id or request.plano_contas_id or 0)
            if not categoria_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Parcela {parcela.indice} sem categoria. Defina uma categoria padrao antes de confirmar.",
                )
            _assert_categoria_valida(
                db,
                empresa_id=empresa_id,
                categoria_id=categoria_id,
                tipo_lancamento=tipo_lancamento,
            )

            entidade_id = int(parcela.entidade_id or request.entidade_id or entidade_padrao.id or 0)
            if not entidade_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Parcela {parcela.indice} sem entidade. Nao foi possivel resolver o emitente da NF-e.",
                )
            _assert_entidade_valida(db, empresa_id=empresa_id, entidade_id=entidade_id)

            descricao = _descricao_parcela(
                numero_nfe,
                parcela.indice,
                total_parcelas,
            )

            data_competencia = request.data_emissao or parcela.data_vencimento
            competencia = data_competencia.strftime("%m/%Y")
            import_hash = _import_hash(empresa_id, chave_nfe, parcela.indice)

            observacao_base = _compor_observacao_com_situacao(
                request.observacao or f"NF-e {numero_nfe} | Chave {chave_nfe}",
                situacao_nfe,
                cfop=cfop_nfe,
                emitente_documento=emitente_documento_nfe,
                destino_compra=request.destino_compra,
                valor_frete=request.valor_frete,
                itens_meta=itens_meta,
            )
            lancamento = Lancamento(
                descricao=descricao,
                tipo=tipo_lancamento,
                origem="NFE_XML",
                ipp=False,
                previsto=True,
                valor_previsto=parcela.valor,
                valor_pago=Decimal("0.00"),
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=parcela.data_vencimento,
                data_pagamento=None,
                data_competencia=data_competencia,
                competencia=competencia,
                numero_parcela=parcela.indice,
                id_parcelamento=parcela_group_id,
                observacao=observacao_base,
                conciliado=False,
                import_hash=import_hash,
                transferencia_grupo_id=None,
                empresa_id=empresa_id,
                plano_contas_id=categoria_id,
                conta_id=int(conta.id) if conta and conta.id else None,
                entidade_id=entidade_id,
                cartao_id=None,
                centro_custo_id=centro_custo_id,
            )
            db.add(lancamento)
            lancamentos.append(lancamento)

        db.commit()

        lancamento_ids: list[int] = []
        for lancamento in lancamentos:
            db.refresh(lancamento)
            if lancamento.id is not None:
                lancamento_ids.append(int(lancamento.id))

        logger.info(
            "[NFE] Confirmacao concluida empresa_id={} chave_nfe={} lancamentos_criados={}",
            empresa_id,
            chave_nfe,
            len(lancamento_ids),
        )

        return NfeConfirmarResponse(
            id_parcelamento=parcela_group_id,
            chave_nfe=chave_nfe,
            numero_nfe=numero_nfe,
            tipo_lancamento=tipo_lancamento,
            total_parcelas=total_parcelas,
            lancamentos_criados=len(lancamento_ids),
            lancamento_ids=lancamento_ids,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "[NFE] Falha inesperada na confirmacao empresa_id={} chave_nfe={} erro={}",
            empresa_id,
            chave_nfe,
            str(exc),
        )
        raise HTTPException(status_code=500, detail="Erro interno ao confirmar importacao NF-e") from exc
