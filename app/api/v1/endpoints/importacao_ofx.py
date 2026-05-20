"""
Endpoints para importacao de arquivos OFX (multibancos).
"""
import re
import unicodedata
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlmodel import Session, or_, select, func, case
from loguru import logger
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user, require_permission
from app.services.integracao_ofx import processar_ofx
from app.services.importacao_bancaria_service import (
    verificar_duplicata_ofx_por_fallback,
    buscar_lancamento_previsto_mesmo_dia_valor,
    buscar_lancamento_atrasado_mesmo_valor,
    gerar_import_hash,
    _normalizar_nome_entidade,
)
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas

router = APIRouter()
OFX_FILE_SIZE_LIMIT = 10 * 1024 * 1024
MATCH_TOLERANCIA_PERCENTUAL = Decimal("0.05")
MATCH_DIAS_ATRASO = 30
STATUS_ABERTOS = ("PENDENTE", "EM ABERTO", "ATRASADO", "VENCIDO")
HISTORICO_SUGESTAO_LIMITE = 1500

TOKEN_MAP_INTERESSADO = {
    "MAST": "Master",
    "MASTER": "Master",
    "MC": "Master",
    "CRED": "Credito",
    "CD": "Credito",
    "CREDITO": "Credito",
    "DEB": "Debito",
    "DB": "Debito",
    "DEBITO": "Debito",
    "VISA": "Visa",
    "ELO": "Elo",
    "AMEX": "Amex",
    "PIX": "Pix",
    "TED": "Ted",
    "DOC": "Doc",
    "REDE": "Rede",
    "STONE": "Stone",
    "CIELO": "Cielo",
    "GETNET": "Getnet",
    "PAGSEGURO": "PagSeguro",
    "MERCADOPAGO": "Mercado Pago",
    "MERCADO": "Mercado",
    "PAGO": "Pago",
    "DESCRICAO": "",
    "DESC": "",
    "QUANT": "Quantic",
    "QUANTIQ": "Quantic",
    "DIST": "Distribuidora",
}

TOKENS_GENERICOS_INTERESSADO = {
    "OFX",
    "COMPRA",
    "BOLETO",
    "PAGO",
    "PAGA",
    "PAGAMENTO",
    "PAGTO",
    "PIX",
    "QR",
    "QRS",
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
    "TRANSACAO",
    "TRANS",
    "AUT",
    "NSU",
    "PARC",
    "PARCELA",
    "ESTAB",
    "ESTABELECIMENTO",
    "LOJA",
    "BANCO",
    "AG",
    "CC",
    "REDE",
    "DESCRICAO",
    "DESC",
}

PADROES_CATEGORIA_PRIORITARIA: List[tuple[str, tuple[str, ...]]] = [
    ("BOLETO", ("boleto",)),
    ("PAGAMENTO BOLETO", ("pagamento", "boleto")),
    ("PIX QR", ("pix", "qr")),
    ("PIX CHAVE", ("pix", "chave")),
    ("TED", ("ted",)),
    ("DOC", ("doc",)),
    ("BOLETO", ("boleto",)),
    ("TARIFA", ("tarifa",)),
    ("TAXA", ("taxa",)),
    ("MAQUININHA", ("maquininha",)),
    ("CARTAO CREDITO", ("mast", "cd")),
    ("CARTAO CREDITO", ("master", "cd")),
    ("CARTAO CREDITO", ("visa", "cd")),
    ("CARTAO CREDITO", ("elo", "cd")),
    ("CARTAO DEBITO", ("mast", "db")),
    ("CARTAO DEBITO", ("master", "db")),
    ("CARTAO DEBITO", ("visa", "db")),
    ("CARTAO DEBITO", ("elo", "db")),
    ("CARTAO CREDITO", ("cartao", "credito")),
    ("CARTAO DEBITO", ("cartao", "debito")),
]

BANDEIRAS_CARTAO = {
    "MAST": "Master",
    "MASTER": "Master",
    "MC": "Master",
    "VISA": "Visa",
    "ELO": "Elo",
    "AMEX": "Amex",
}

TOKENS_RUIDO_INTERESSADO = {
    "PEDIDO",
    "CLIENTE",
    "BANCO",
    "OFX",
    "AGENCIA",
    "CONTA",
    "AUT",
    "NSU",
    "COD",
    "CODIGO",
    "TRANSACAO",
    "TRANSACAO",
    "DOCUMENTO",
    "LANCAMENTO",
}

TOKENS_INDICAM_EMPRESA = {
    "LTDA",
    "EIRELI",
    "S/A",
    "SA",
    "DISTRIBUIDORA",
    "COMERCIO",
    "INDUSTRIA",
    "SERVICOS",
    "LOGISTICA",
    "TRANSPORTES",
}

TOKENS_JURIDICOS_FRACOS = {
    "LTDA",
    "EIRELI",
    "S",
    "A",
    "SA",
    "ME",
    "MEI",
    "EPP",
}


class RelacionamentoResumo(BaseModel):
    id: Optional[int] = None
    descricao: str
    interessado: Optional[str] = None
    data_vencimento: str
    valor_previsto: float
    centro_custo_id: Optional[int] = None
    centro_custo_nome: Optional[str] = None
    score: int
    motivo: str


class DuplicataResumo(BaseModel):
    descricao: str
    data_pagamento: Optional[str] = None
    valor_pago: Optional[float] = None
    origem: Optional[str] = None
    motivo: Optional[str] = None


class LancamentoImportado(BaseModel):
    data: str
    data_hora: Optional[str] = None
    descricao: str
    razao_social: str
    cpf_cnpj: str
    referencia: Optional[str] = None
    valor: float
    tipo: str
    origem: str
    linha_arquivo: int
    import_hash: Optional[str] = None
    referencia_externa: Optional[str] = None
    movimento_uid: Optional[str] = None
    saldo_informativo: bool = False
    ofx_bank_id: Optional[str] = None
    ofx_agencia: Optional[str] = None
    ofx_conta_numero: Optional[str] = None
    ofx_saldo_arquivo: Optional[float] = None
    ofx_saldo_data: Optional[str] = None
    lancamento_previsto_id: Optional[int] = None
    lancamentos_atrasados_ids: List[int] = Field(default_factory=list)
    duplicata_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    era_previsto: bool = False
    sugestao_acao: str = "CRIAR_NOVO"
    score_conciliacao: int = 0
    motivo_conciliacao: Optional[str] = None
    motivo_classificacao: Optional[str] = None
    interessado_sugerido: Optional[str] = None
    lancamento_previsto_resumo: Optional[RelacionamentoResumo] = None
    lancamentos_atrasados_resumo: List[RelacionamentoResumo] = Field(default_factory=list)
    duplicata_resumo: Optional[DuplicataResumo] = None


def _serializar_lancamento(lanc_raw: Dict) -> Dict:
    payload = dict(lanc_raw)
    data_val = payload.get("data")
    if isinstance(data_val, date):
        payload["data"] = data_val.isoformat()
    data_hora_val = payload.get("data_hora")
    if isinstance(data_hora_val, datetime):
        payload["data_hora"] = data_hora_val.isoformat()
    return payload


def _eh_movimento_saldo_informativo(lanc_raw: Dict[str, Any]) -> bool:
    if bool(lanc_raw.get("saldo_informativo")):
        return True
    descricao = _normalizar_texto(str(lanc_raw.get("descricao") or ""))
    return "saldo" in descricao.split()


def _normalizar_texto(texto: Optional[str]) -> str:
    if not texto:
        return ""
    base = unicodedata.normalize("NFKD", str(texto))
    sem_acento = "".join(char for char in base if not unicodedata.combining(char))
    limpo = re.sub(r"[^a-zA-Z0-9]+", " ", sem_acento.lower())
    return " ".join(limpo.split())


def _tokenizar_texto(texto: Optional[str]) -> List[str]:
    return [token for token in re.split(r"[^A-Za-z0-9]+", str(texto or "").upper()) if token]


def _title_case_inteligente(tokens: List[str]) -> str:
    palavras: List[str] = []
    for token in tokens:
        mapped = TOKEN_MAP_INTERESSADO.get(token, token.title())
        if mapped:
            palavras.append(mapped)

    # Remove repeticoes adjacentes e repeticoes globais mantendo ordem.
    sem_duplicatas: List[str] = []
    vistos: set[str] = set()
    ultimo = ""
    for palavra in palavras:
        chave = _normalizar_texto(palavra)
        if not chave:
            continue
        if chave == _normalizar_texto(ultimo):
            continue
        if chave in vistos:
            continue
        sem_duplicatas.append(palavra)
        vistos.add(chave)
        ultimo = palavra

    return " ".join(sem_duplicatas).strip()


def _normalizar_interessado_final(texto: Optional[str]) -> str:
    if not texto:
        return ""

    # Corrige casos colados como "QRSAna" ou "PixAna" antes da tokenizacao.
    bruto = re.sub(
        r"(?i)\b(qrs|qr|pix|pagamento|recebimento|boleto|pago|paga)(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç])",
        r"\1 ",
        str(texto),
    )

    normalizado = _normalizar_nome_entidade(bruto)
    tokens = [
        token for token in _tokenizar_texto(normalizado)
        if token not in TOKENS_GENERICOS_INTERESSADO and not token.isdigit()
    ]

    if not tokens:
        return normalizado

    interessado = _title_case_inteligente(tokens)
    if _interessado_tem_confianca(interessado):
        return interessado
    if _interessado_tem_confianca(normalizado):
        return normalizado
    return ""


def _extrair_nome_empresa(tokens: List[str]) -> str:
    if not tokens:
        return ""

    tokens_limpos = [token for token in tokens if token and token not in TOKENS_GENERICOS_INTERESSADO and not token.isdigit()]
    if not tokens_limpos:
        return ""

    sufixos = {"LTDA", "EIRELI", "SA", "S/A"}
    idx_sufixo = next((i for i, token in enumerate(tokens_limpos) if token in sufixos), None)
    if idx_sufixo is None:
        return ""

    inicio = max(0, idx_sufixo - 4)
    trecho = tokens_limpos[inicio:idx_sufixo + 1]
    if len(trecho) < 2:
        return ""

    nome = _normalizar_interessado_final(_title_case_inteligente(trecho))
    return nome if _interessado_tem_confianca(nome) else ""


def _extrair_interessado_cartao(descricao: str) -> str:
    tokens = _tokenizar_texto(descricao)
    if not tokens:
        return ""

    bandeira = next((BANDEIRAS_CARTAO[token] for token in tokens if token in BANDEIRAS_CARTAO), "")
    if not bandeira:
        return ""

    if any(token in {"CD", "CRED", "CREDITO"} or token.startswith(("CD", "CRED")) for token in tokens):
        return f"{bandeira} Credito"
    if any(token in {"DB", "DEB", "DEBITO"} or token.startswith(("DB", "DEB")) for token in tokens):
        return f"{bandeira} Debito"
    return bandeira


def _categoria_tem_tokens(categoria_tokens: List[str], grupos: List[List[str]]) -> bool:
    return all(any(token in categoria_tokens for token in grupo) for grupo in grupos)


def _classificar_movimento_cartao(descricao: str) -> str:
    tokens = set(_tokenizar_texto(descricao))
    possui_bandeira = any(token in BANDEIRAS_CARTAO for token in tokens)
    possui_adquirente = "REDE" in tokens
    if not (possui_bandeira or possui_adquirente):
        return ""
    if any(token in {"CD", "CRED", "CREDITO"} or token.startswith(("CD", "CRED")) for token in tokens):
        return "CREDITO"
    if any(token in {"DB", "DEB", "DEBITO"} or token.startswith(("DB", "DEB")) for token in tokens):
        return "DEBITO"
    return ""


def _classificar_movimento_descricao(lancamento_ofx: Dict) -> str:
    descricao = _normalizar_texto(lancamento_ofx.get("descricao"))
    tokens = set(descricao.split())

    if "pix" in tokens:
        if "qr" in tokens or "qrcode" in tokens or "code" in tokens:
            return "PIX_QR"
        return "PIX_CHAVE"

    tipo_cartao = _classificar_movimento_cartao(str(lancamento_ofx.get("descricao") or ""))
    if tipo_cartao == "CREDITO":
        return "CARTAO_CREDITO"
    if tipo_cartao == "DEBITO":
        return "CARTAO_DEBITO"

    if "boleto" in tokens:
        return "BOLETO"
    if "ted" in tokens:
        return "TED"
    if "doc" in tokens:
        return "DOC"
    return ""


def _extrair_interessado_sugerido(lancamento_ofx: Dict) -> str:
    def _extrair_da_descricao(descricao_bruta: str) -> str:
        tokens_descricao = _tokenizar_texto(descricao_bruta)
        empresa_extraida = _extrair_nome_empresa(tokens_descricao)
        if empresa_extraida:
            return empresa_extraida

        interessado_cartao = _extrair_interessado_cartao(descricao_bruta)
        if interessado_cartao:
            return interessado_cartao

        tokens = []
        for token in tokens_descricao:
            if token in TOKENS_GENERICOS_INTERESSADO:
                continue
            if token.isdigit():
                continue
            tokens.append(token)

        if not tokens:
            return ""

        if len(tokens) > 12:
            tokens = tokens[:12]

        interessado_local = _title_case_inteligente(tokens)
        interessado_local = _normalizar_interessado_final(interessado_local)
        if len(_normalizar_texto(interessado_local)) < 3:
            return ""
        return interessado_local

    descricao = str(lancamento_ofx.get("descricao") or "")
    interessado_descricao = _extrair_da_descricao(descricao)

    candidato = str(lancamento_ofx.get("razao_social") or "").strip()
    if len(_normalizar_texto(candidato)) >= 3:
        interessado_cartao = _extrair_interessado_cartao(candidato)
        interessado_candidato = ""
        if interessado_cartao:
            interessado_candidato = interessado_cartao
        else:
            normalizado = _normalizar_interessado_final(candidato)
            interessado_candidato = normalizado or _title_case_inteligente(_tokenizar_texto(candidato)) or candidato

        # Se o candidato vier desalinhado da descricao e a descricao trouxer forte sinal de PJ,
        # prioriza o nome extraido da propria descricao para evitar falsos positivos de payee.
        descricao_tokens = set(_tokenizar_texto(descricao))
        descricao_tem_sinal_pj = bool(descricao_tokens & TOKENS_INDICAM_EMPRESA)
        candidato_norm = _normalizar_texto(interessado_candidato)
        descricao_norm = _normalizar_texto(descricao)
        interessado_descricao_norm = _normalizar_texto(interessado_descricao)
        candidato_esta_na_descricao = bool(candidato_norm and candidato_norm in descricao_norm)
        similaridade = (
            SequenceMatcher(None, candidato_norm, interessado_descricao_norm).ratio()
            if candidato_norm and interessado_descricao_norm
            else 0.0
        )
        if (
            descricao_tem_sinal_pj
            and interessado_descricao
            and _interessado_tem_confianca(interessado_descricao)
            and not candidato_esta_na_descricao
            and similaridade < 0.45
        ):
            return interessado_descricao

        if _interessado_tem_confianca(interessado_candidato):
            return interessado_candidato
        if _interessado_tem_confianca(interessado_descricao):
            return interessado_descricao
        return ""

    return interessado_descricao


def _interessado_combina_com_entidade(interessado: Optional[str], nome_entidade: Optional[str]) -> bool:
    interessado_norm = _normalizar_texto(interessado)
    entidade_norm = _normalizar_texto(nome_entidade)
    if not interessado_norm or not entidade_norm:
        return False

    if interessado_norm in entidade_norm or entidade_norm in interessado_norm:
        return True

    interessado_tokens = [t for t in interessado_norm.split() if t not in TOKENS_JURIDICOS_FRACOS]
    entidade_tokens = [t for t in entidade_norm.split() if t not in TOKENS_JURIDICOS_FRACOS]
    if not interessado_tokens or not entidade_tokens:
        return False

    base_interessado = " ".join(interessado_tokens)
    base_entidade = " ".join(entidade_tokens)
    if base_interessado in base_entidade or base_entidade in base_interessado:
        return True

    similaridade = SequenceMatcher(None, base_interessado, base_entidade).ratio()
    return similaridade >= 0.72


def _interessado_tem_confianca(nome: Optional[str]) -> bool:
    texto = str(nome or "").strip()
    if not texto:
        return False

    normalizado = _normalizar_texto(texto)
    if len(normalizado) < 3:
        return False

    tokens = _tokenizar_texto(texto)
    if not tokens:
        return False

    alpha_tokens = [
        token
        for token in tokens
        if re.search(r"[A-Z]", token)
        and token not in TOKENS_RUIDO_INTERESSADO
        and token not in TOKENS_GENERICOS_INTERESSADO
    ]
    if len(alpha_tokens) >= 2:
        return True

    if len(alpha_tokens) == 1 and len(alpha_tokens[0]) >= 5 and not re.search(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b", texto):
        return True

    return False


def _texto_contem_todos(texto_normalizado: str, termos: tuple[str, ...]) -> bool:
    return all(termo in texto_normalizado for termo in termos)


def _normalizar_texto_boleto_relevante(texto: Optional[str]) -> str:
    base = _normalizar_texto(texto)
    if not base:
        return ""
    tokens_genericos = {
        "boleto",
        "pago",
        "paga",
        "pagamento",
        "pagamentos",
        "pagto",
        "recebimento",
        "pro",
        "para",
        "pg",
        "titulo",
        "titulos",
        "cobranca",
        "cobrancas",
    }
    tokens = [token for token in base.split() if token not in tokens_genericos and not token.isdigit()]
    return " ".join(tokens)


def _score_categoria_por_descricao(lancamento_ofx: Dict, categoria: PlanoContas) -> int:
    descricao = _normalizar_texto(lancamento_ofx.get("descricao"))
    categoria_nome = _normalizar_texto(categoria.nome)
    if not descricao or not categoria_nome:
        return 0

    categoria_tokens = [token for token in categoria_nome.split() if token]
    descricao_tokens = set(descricao.split())
    intersecao = sum(1 for token in categoria_tokens if token in descricao_tokens)
    score = intersecao * 8

    if categoria_nome in descricao:
        score += 20

    for _, termos in PADROES_CATEGORIA_PRIORITARIA:
        if _texto_contem_todos(descricao, termos) and _texto_contem_todos(categoria_nome, termos):
            score += 24

    classe = _classificar_movimento_descricao(lancamento_ofx)
    if classe == "PIX_QR":
        if "pix" in categoria_tokens and any(token in categoria_tokens for token in ["qr", "qrcode", "code"]):
            score += 80
        elif "pix" in categoria_tokens:
            score += 22
        if any(token in categoria_tokens for token in ["dinheiro", "especie", "caixa"]):
            score -= 18

    if classe == "PIX_CHAVE":
        if "pix" in categoria_tokens and any(token in categoria_tokens for token in ["chave", "transferencia", "transferencia", "recebimento"]):
            score += 78
        elif "pix" in categoria_tokens:
            score += 26
        if any(token in categoria_tokens for token in ["dinheiro", "especie", "caixa"]):
            score -= 18

    if classe == "CARTAO_CREDITO" and _categoria_tem_tokens(categoria_tokens, [["cartao", "cartoes", "adquirencia", "adquirencias", "recebiveis", "recebivel"], ["credito", "cred"]]):
        score += 90
    if classe == "CARTAO_DEBITO" and _categoria_tem_tokens(categoria_tokens, [["cartao", "cartoes", "adquirencia", "adquirencias", "recebiveis", "recebivel"], ["debito", "deb"]]):
        score += 90

    possui_boleto = "boleto" in descricao_tokens
    if possui_boleto and "boleto" in categoria_tokens:
        score += 32
    if possui_boleto and any(token in categoria_tokens for token in ["pagamento", "pagamentos", "titulo", "titulos", "cobranca", "cobrancas"]):
        score += 18
    if any(token in descricao_tokens for token in ["pago", "paga", "pagamento"]) and any(token in categoria_tokens for token in ["pagamento", "pagamentos"]):
        score += 12

    if "pix" in descricao and "pix" in categoria_tokens:
        score += 6

    return score


def _aplicar_sugestao_categoria_por_descricao(lancamento_ofx: Dict, categorias: List[PlanoContas]) -> None:
    tipo_item = str(lancamento_ofx.get("tipo") or "").upper()
    categorias_base = [
        categoria for categoria in categorias
        if ("RECEITA" if str(categoria.tipo or "").upper().startswith("R") else "DESPESA") == tipo_item
    ]
    if not categorias_base:
        return

    melhor_categoria = None
    melhor_score = 0
    for categoria in categorias_base:
        score = _score_categoria_por_descricao(lancamento_ofx, categoria)
        if score > melhor_score:
            melhor_score = score
            melhor_categoria = categoria

    if not melhor_categoria or melhor_score < 24:
        return

    categoria_atual = lancamento_ofx.get("plano_contas_id")
    motivo_atual = str(lancamento_ofx.get("motivo_classificacao") or "")
    historico_boleto_forte = motivo_atual.lower().startswith("sugestao por historico de boleto")
    classe = _classificar_movimento_descricao(lancamento_ofx)
    categoria_atual_score = 0
    if categoria_atual:
        categoria_obj = next((categoria for categoria in categorias_base if int(categoria.id or 0) == int(categoria_atual)), None)
        if categoria_obj:
            categoria_atual_score = _score_categoria_por_descricao(lancamento_ofx, categoria_obj)

    override_por_sinal = classe in {"PIX_QR", "PIX_CHAVE", "CARTAO_CREDITO", "CARTAO_DEBITO"} and melhor_score >= max(42, categoria_atual_score + 18)
    pode_substituir = (
        not categoria_atual
        or (motivo_atual.startswith("Sugestao por historico") and not historico_boleto_forte)
        or override_por_sinal
    )
    if not pode_substituir:
        return

    lancamento_ofx["plano_contas_id"] = int(melhor_categoria.id or 0)
    lancamento_ofx["motivo_classificacao"] = f"Sugestao por descricao OFX aderente a '{melhor_categoria.nome}'."


def _valor_lancamento_existente(lancamento: Lancamento) -> Decimal:
    if lancamento.valor_pago not in (None, Decimal("0.00")):
        return Decimal(str(lancamento.valor_pago))
    return Decimal(str(lancamento.valor_previsto or "0"))


def _calcular_margem_match(valor: Decimal) -> Decimal:
    base = abs(valor)
    margem_percentual = base * MATCH_TOLERANCIA_PERCENTUAL
    return max(margem_percentual, Decimal("0.01"))


def _valor_dentro_tolerancia(valor_a: Decimal, valor_b: Decimal) -> bool:
    return abs(valor_a - valor_b) <= _calcular_margem_match(valor_b)


def _calcular_similaridade_texto(origem: Dict, lancamento: Lancamento) -> float:
    descricao_ofx = _normalizar_texto(origem.get("descricao"))
    descricao_sistema = _normalizar_texto(lancamento.descricao)
    entidade_ofx = _normalizar_texto(origem.get("razao_social"))
    referencia_ofx = _normalizar_texto(origem.get("referencia"))
    base = " ".join(part for part in [descricao_ofx, entidade_ofx, referencia_ofx] if part).strip()
    alvo = " ".join(part for part in [descricao_sistema, _normalizar_texto(lancamento.observacao)] if part).strip()
    if not base or not alvo:
        return 0.0
    return SequenceMatcher(None, base, alvo).ratio()


def _buscar_duplicata_historica(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    conta_id: int,
) -> tuple[Optional[Lancamento], Optional[str]]:
    data_base = lancamento_ofx.get("data")
    if not isinstance(data_base, date):
        return None, None

    try:
        valor = Decimal(str(lancamento_ofx.get("valor") or "0"))
    except Exception:
        return None, None

    margem = _calcular_margem_match(valor)
    valor_min = valor - margem
    valor_max = valor + margem
    data_inicio = data_base - timedelta(days=3)
    data_fim = data_base + timedelta(days=3)

    candidatos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == lancamento_ofx.get("tipo"),
            or_(
                Lancamento.conta_id == conta_id,
                Lancamento.conta_id.is_(None),
            ),
            or_(
                Lancamento.data_pagamento.between(data_inicio, data_fim),
                Lancamento.data_vencimento.between(data_inicio, data_fim),
            ),
            or_(
                Lancamento.valor_previsto.between(valor_min, valor_max),
            ),
        )
        .order_by(Lancamento.data_pagamento.desc(), Lancamento.id.desc())
        .limit(300)
    ).all()

    interessado_norm = _normalizar_texto(lancamento_ofx.get("razao_social") or lancamento_ofx.get("interessado_sugerido"))
    for candidato in candidatos:
        if candidato.data_pagamento is None and str(candidato.status or "").upper() in STATUS_ABERTOS:
            continue

        data_candidata = candidato.data_pagamento or candidato.data_vencimento
        if not data_candidata:
            continue

        diferenca_dias = abs((data_candidata - data_base).days)
        if diferenca_dias > 2:
            continue

        valor_candidato = _valor_lancamento_existente(candidato)
        valor_exato = abs(valor_candidato - valor) <= Decimal("0.01")
        valor_compativel = _valor_dentro_tolerancia(valor_candidato, valor)
        if not valor_compativel:
            continue

        similaridade = _calcular_similaridade_texto(lancamento_ofx, candidato)
        descricao_ofx_tokens = set(_normalizar_texto(lancamento_ofx.get("descricao")).split())
        descricao_candidato_tokens = set(_normalizar_texto(candidato.descricao).split())
        tokens_em_comum = len(descricao_ofx_tokens & descricao_candidato_tokens)
        contexto_candidato = _normalizar_texto(f"{candidato.descricao} {candidato.observacao or ''}")
        entidade_bate = bool(interessado_norm and interessado_norm in contexto_candidato)
        mesmo_dia = data_candidata == data_base
        mesmo_dia_pagamento = candidato.data_pagamento == data_base
        dia_muito_proximo = diferenca_dias <= 1

        # Mesmo dia+valor pode ocorrer em movimentos distintos;
        # exige evidencias adicionais para evitar falso positivo de "ja importado".
        if mesmo_dia_pagamento and valor_exato:
            if entidade_bate or tokens_em_comum >= 4 or (similaridade >= 0.82 and tokens_em_comum >= 2):
                motivo = "Mesmo valor e mesma data de pagamento de um lancamento ja baixado"
                if similaridade >= 0.82 and tokens_em_comum >= 2:
                    motivo += " com descricao muito parecida"
                elif entidade_bate:
                    motivo += " com favorecido/interessado compativel"
                elif tokens_em_comum >= 4:
                    motivo += " com termos relevantes em comum na descricao"
                if candidato.conta_id is None:
                    motivo += " (lancamento sem conta vinculada)"
                return candidato, motivo
            continue

        # Match historico conservador: evita falso positivo em movimento distinto
        # no mesmo intervalo, exigindo evidencias mais fortes.
        evidencias_fortes = (
            (dia_muito_proximo and valor_exato and similaridade >= 0.82)
            or (dia_muito_proximo and valor_exato and entidade_bate and similaridade >= 0.55)
            or (mesmo_dia and valor_exato and entidade_bate)
            or (mesmo_dia and valor_exato and tokens_em_comum >= 5)
        )
        if evidencias_fortes:
            motivo = "Mesmo valor e data muito proxima de um lancamento ja registrado"
            if similaridade >= 0.8:
                motivo += " com descricao muito parecida"
            elif entidade_bate:
                motivo += " com favorecido/interessado compativel"
            elif tokens_em_comum >= 5:
                motivo += " com termos relevantes em comum na descricao"
            return candidato, motivo

    return None, None


def _coerce_date(valor: Any) -> Optional[date]:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        texto = str(valor).strip()
        if not texto:
            return None
        try:
            if "T" in texto:
                return datetime.fromisoformat(texto.replace("Z", "+00:00")).date()
            return date.fromisoformat(texto)
        except Exception:
            return None
    return None


def _montar_chave_conferencia_quantidade(
    lancamento_ofx: Dict[str, Any],
    conta_id: int,
) -> Optional[tuple[int, str, str, str]]:
    if conta_id <= 0:
        return None

    data_base = _coerce_date(lancamento_ofx.get("data"))
    if not data_base:
        return None

    tipo = str(lancamento_ofx.get("tipo") or "").upper().strip()
    if not tipo:
        return None

    try:
        valor = Decimal(str(lancamento_ofx.get("valor") or "0")).quantize(Decimal("0.01"))
    except Exception:
        return None

    return (
        int(conta_id),
        tipo,
        data_base.isoformat(),
        format(valor, "f"),
    )


def _contar_existentes_por_chave_conferencia(
    db: Session,
    empresa_id: int,
    chave: tuple[int, str, str, str],
) -> int:
    conta_id, tipo, data_iso, valor_str = chave

    try:
        data_base = date.fromisoformat(data_iso)
        valor = Decimal(valor_str)
    except Exception:
        return 0

    valor_min = valor - Decimal("0.01")
    valor_max = valor + Decimal("0.01")

    candidatos = db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == tipo,
            or_(
                Lancamento.data_pagamento == data_base,
                Lancamento.data_vencimento == data_base,
            ),
            or_(
                Lancamento.valor_pago.between(valor_min, valor_max),
                Lancamento.valor_previsto.between(valor_min, valor_max),
            ),
        )
    ).all()

    total = 0
    for candidato in candidatos:
        if not _valor_dentro_tolerancia(_valor_lancamento_existente(candidato), valor):
            continue
        total += 1

    return total


def _carregar_duplicatas_por_hash(
    db: Session,
    empresa_id: int,
    import_hashes: List[str],
) -> Dict[str, Lancamento]:
    hashes_validos = [hash_item for hash_item in {str(item) for item in import_hashes if item}]
    if not hashes_validos:
        return {}

    duplicatas: Dict[str, Lancamento] = {}
    tamanho_lote = 500
    lancamento_table = getattr(Lancamento, "__table__")
    for inicio in range(0, len(hashes_validos), tamanho_lote):
        lote = hashes_validos[inicio:inicio + tamanho_lote]
        encontrados = db.exec(
            select(Lancamento).where(
                lancamento_table.c.empresa_id == empresa_id,
                lancamento_table.c.is_deleted == False,
                lancamento_table.c.import_hash.in_(lote),
            )
        ).all()

        for lancamento in encontrados:
            chave = str(lancamento.import_hash or "")
            if chave and chave not in duplicatas:
                duplicatas[chave] = lancamento

    return duplicatas


def _agrupar_historico_por_tipo(historico: List[Lancamento]) -> Dict[str, List[Lancamento]]:
    agrupado: Dict[str, List[Lancamento]] = {}
    for item in historico:
        if not item.plano_contas_id:
            continue
        tipo = str(item.tipo or "")
        if not tipo:
            continue
        agrupado.setdefault(tipo, []).append(item)
    return agrupado


def _carregar_contexto_classificacao(
    db: Session,
    empresa_id: int,
) -> tuple[List[PlanoContas], Dict[int, Entidade], Dict[int, CentroCusto], List[Lancamento]]:
    categorias = list(db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.oculta == False,
        )
    ).all())
    entidades = list(db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
            Entidade.status == "ATIVO",
        )
    ).all())
    centros_custo = list(db.exec(
        select(CentroCusto).where(
            CentroCusto.empresa_id == empresa_id,
            CentroCusto.is_deleted == False,
        )
    ).all())
    historico = list(db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
        )
        .limit(HISTORICO_SUGESTAO_LIMITE)
    ).all())
    return (
        categorias,
        {int(entidade.id): entidade for entidade in entidades if entidade.id is not None},
        {int(centro.id): centro for centro in centros_custo if centro.id is not None},
        historico,
    )


def _score_historico(lancamento_ofx: Dict, historico: Lancamento, entidades_por_id: Dict[int, Entidade], conta_id: int) -> float:
    texto_origem = " ".join(
        part for part in [
            _normalizar_texto(lancamento_ofx.get("descricao")),
            _normalizar_texto(lancamento_ofx.get("razao_social")),
            _normalizar_texto(lancamento_ofx.get("interessado_sugerido")),
        ]
        if part
    ).strip()
    entidade_historica = entidades_por_id.get(int(historico.entidade_id or 0))
    texto_historico = " ".join(
        part for part in [
            _normalizar_texto(historico.descricao),
            _normalizar_texto(entidade_historica.nome if entidade_historica else ""),
            _normalizar_texto(historico.observacao),
        ]
        if part
    ).strip()
    similaridade = SequenceMatcher(None, texto_origem, texto_historico).ratio() if texto_origem and texto_historico else 0.0
    score = similaridade * 70
    if historico.tipo == lancamento_ofx.get("tipo"):
        score += 10
    if historico.conta_id == conta_id:
        score += 8

    descricao_ofx = _normalizar_texto(str(lancamento_ofx.get("descricao") or ""))
    boleto_ofx = "boleto" in descricao_ofx
    interessado_ofx = _normalizar_texto(lancamento_ofx.get("razao_social") or lancamento_ofx.get("interessado_sugerido"))
    entidade_historica_nome = _normalizar_texto(entidade_historica.nome if entidade_historica else "")
    descricao_origem_relevante = _normalizar_texto_boleto_relevante(lancamento_ofx.get("descricao"))
    descricao_historico_relevante = _normalizar_texto_boleto_relevante(
        f"{historico.descricao or ''} {historico.observacao or ''} {entidade_historica.nome if entidade_historica else ''}"
    )

    if boleto_ofx:
        if interessado_ofx and entidade_historica_nome:
            if interessado_ofx in entidade_historica_nome or entidade_historica_nome in interessado_ofx:
                score += 42
            else:
                score += SequenceMatcher(None, interessado_ofx, entidade_historica_nome).ratio() * 38

        if descricao_origem_relevante and descricao_historico_relevante:
            similaridade_boleto = SequenceMatcher(None, descricao_origem_relevante, descricao_historico_relevante).ratio()
            score += similaridade_boleto * 34

            tokens_origem = set(descricao_origem_relevante.split())
            tokens_historico = set(descricao_historico_relevante.split())
            if tokens_origem and tokens_historico:
                intersecao = len(tokens_origem & tokens_historico)
                score += intersecao * 5

    try:
        valor_origem = Decimal(str(lancamento_ofx.get("valor") or "0"))
        valor_historico = _valor_lancamento_existente(historico)
        if _valor_dentro_tolerancia(valor_historico, valor_origem):
            score += 12
    except Exception:
        pass
    return score


def _aplicar_sugestao_historica(
    lancamento_ofx: Dict,
    historico: List[Lancamento],
    entidades_por_id: Dict[int, Entidade],
    conta_id: int,
) -> List[Lancamento]:
    tipo_ofx = str(lancamento_ofx.get("tipo") or "")
    candidatos = [
        item for item in historico
        if item.plano_contas_id and (not tipo_ofx or str(item.tipo or "") == tipo_ofx)
    ]
    ranked = sorted(
        candidatos,
        key=lambda item: _score_historico(lancamento_ofx, item, entidades_por_id, conta_id),
        reverse=True,
    )[:3]

    if not ranked:
        return []

    melhor = ranked[0]
    melhor_score = _score_historico(lancamento_ofx, melhor, entidades_por_id, conta_id)
    descricao_ofx = _normalizar_texto(str(lancamento_ofx.get("descricao") or ""))
    limiar_score = 48 if "boleto" in descricao_ofx else 55
    if melhor_score < limiar_score:
        return []

    if not lancamento_ofx.get("plano_contas_id") and melhor.plano_contas_id:
        lancamento_ofx["plano_contas_id"] = melhor.plano_contas_id
    interessado_base = str(lancamento_ofx.get("razao_social") or lancamento_ofx.get("interessado_sugerido") or "").strip()
    entidade_melhor = entidades_por_id.get(int(melhor.entidade_id or 0)) if melhor.entidade_id else None
    if (
        not lancamento_ofx.get("entidade_id")
        and melhor.entidade_id
        and _interessado_tem_confianca(interessado_base)
        and _interessado_combina_com_entidade(interessado_base, entidade_melhor.nome if entidade_melhor else "")
    ):
        lancamento_ofx["entidade_id"] = melhor.entidade_id
    if not lancamento_ofx.get("motivo_classificacao"):
        if "boleto" in descricao_ofx:
            lancamento_ofx["motivo_classificacao"] = f"Sugestao por historico de boleto parecido com '{melhor.descricao}'."
        else:
            lancamento_ofx["motivo_classificacao"] = f"Sugestao por historico parecido com '{melhor.descricao}'."
    return ranked


def _score_historico_deterministico(
    lancamento_ofx: Dict,
    historico: Lancamento,
    entidades_por_id: Dict[int, Entidade],
) -> float:
    if historico.tipo != lancamento_ofx.get("tipo") or not historico.plano_contas_id:
        return 0.0

    interessado_ofx = _normalizar_texto(lancamento_ofx.get("razao_social") or lancamento_ofx.get("interessado_sugerido"))
    descricao_ofx = _normalizar_texto(lancamento_ofx.get("descricao"))
    descricao_relevante_ofx = _normalizar_texto_boleto_relevante(lancamento_ofx.get("descricao")) or descricao_ofx

    entidade_historica = entidades_por_id.get(int(historico.entidade_id or 0))
    interessado_historico = _normalizar_texto(entidade_historica.nome if entidade_historica else "")
    descricao_historica = _normalizar_texto(historico.descricao)
    descricao_relevante_historica = _normalizar_texto_boleto_relevante(
        f"{historico.descricao or ''} {historico.observacao or ''} {entidade_historica.nome if entidade_historica else ''}"
    ) or descricao_historica

    score = 0.0
    if interessado_ofx and interessado_historico:
        if interessado_ofx in interessado_historico or interessado_historico in interessado_ofx:
            score += 58
        else:
            score += SequenceMatcher(None, interessado_ofx, interessado_historico).ratio() * 42

    if descricao_relevante_ofx and descricao_relevante_historica:
        score += SequenceMatcher(None, descricao_relevante_ofx, descricao_relevante_historica).ratio() * 36
        tokens_ofx = set(descricao_relevante_ofx.split())
        tokens_hist = set(descricao_relevante_historica.split())
        if tokens_ofx and tokens_hist:
            score += len(tokens_ofx & tokens_hist) * 4

    if descricao_ofx and descricao_historica:
        score += SequenceMatcher(None, descricao_ofx, descricao_historica).ratio() * 18

    try:
        valor_origem = Decimal(str(lancamento_ofx.get("valor") or "0"))
        valor_historico = _valor_lancamento_existente(historico)
        if _valor_dentro_tolerancia(valor_historico, valor_origem):
            score += 12
    except Exception:
        pass

    return score


def _buscar_melhor_historico_deterministico(
    lancamento_ofx: Dict,
    historico: List[Lancamento],
    entidades_por_id: Dict[int, Entidade],
) -> Optional[Lancamento]:
    melhor: Optional[Lancamento] = None
    melhor_score = 0.0
    for item in historico:
        score = _score_historico_deterministico(lancamento_ofx, item, entidades_por_id)
        if score > melhor_score:
            melhor_score = score
            melhor = item

    if not melhor:
        return None

    limiar = 42 if "boleto" in _normalizar_texto(lancamento_ofx.get("descricao")) else 52
    return melhor if melhor_score >= limiar else None


def _aplicar_sugestoes_deterministicas(
    lancamentos: List[Dict[str, Any]],
    categorias: List[PlanoContas],
    historico_empresa: List[Lancamento],
    entidades_por_id: Dict[int, Entidade],
) -> None:
    historico_por_tipo = _agrupar_historico_por_tipo(historico_empresa)

    for item in lancamentos:
        if item.get("duplicata_id"):
            continue
        if item.get("sugestao_acao") != "CRIAR_NOVO":
            continue

        interessado = str(item.get("razao_social") or item.get("interessado_sugerido") or "").strip()
        if not interessado:
            interessado = _extrair_interessado_sugerido(item)
        if interessado:
            interessado_cartao = _extrair_interessado_cartao(interessado) or _extrair_interessado_cartao(str(item.get("descricao") or ""))
            interessado_limpo = interessado_cartao or _normalizar_nome_entidade(interessado) or interessado
            if _interessado_tem_confianca(interessado_limpo):
                item["interessado_sugerido"] = interessado_limpo

        tipo_item = str(item.get("tipo") or "")
        melhor_historico = _buscar_melhor_historico_deterministico(
            item,
            historico_por_tipo.get(tipo_item, []),
            entidades_por_id,
        )
        if melhor_historico:
            if not item.get("plano_contas_id") and melhor_historico.plano_contas_id:
                item["plano_contas_id"] = int(melhor_historico.plano_contas_id)
            interessado_base = str(item.get("razao_social") or item.get("interessado_sugerido") or "").strip()
            entidade_melhor = entidades_por_id.get(int(melhor_historico.entidade_id or 0)) if melhor_historico.entidade_id else None
            if (
                not item.get("entidade_id")
                and melhor_historico.entidade_id
                and _interessado_tem_confianca(interessado_base)
                and _interessado_combina_com_entidade(interessado_base, entidade_melhor.nome if entidade_melhor else "")
            ):
                item["entidade_id"] = int(melhor_historico.entidade_id)
            if not item.get("motivo_classificacao"):
                item["motivo_classificacao"] = f"Sugestao deterministica por descricao/interessado parecidos com '{melhor_historico.descricao}'."

        _aplicar_sugestao_categoria_por_descricao(item, categorias)


def _build_match_reason(data_diferenca: int, valor_diferenca: Decimal, similaridade: float, kind: str) -> str:
    partes = []
    if kind == "previsto":
        partes.append("vence no mesmo dia")
    else:
        dias = abs(data_diferenca)
        partes.append(f"atrasado ha {dias} dia{'s' if dias != 1 else ''}")
    partes.append(f"diferenca de valor de R$ {float(valor_diferenca):.2f}")
    if similaridade >= 0.72:
        partes.append("descricao muito parecida")
    elif similaridade >= 0.48:
        partes.append("descricao com alguma semelhanca")
    return ", ".join(partes)


def _score_candidate(origem: Dict, lancamento: Lancamento, kind: str) -> tuple[int, str]:
    valor = Decimal(str(origem["valor"]))
    valor_previsto = Decimal(str(lancamento.valor_previsto))
    valor_diferenca = abs(valor_previsto - valor)
    data_diferenca = (origem["data"] - lancamento.data_vencimento).days
    similaridade = _calcular_similaridade_texto(origem, lancamento)

    score = 64 if kind == "previsto" else 28
    score += max(0, 22 - int(valor_diferenca * 18))
    # Para previsto, data e valor devem ter peso maior que descricao do banco.
    score += min(8 if kind == "previsto" else 18, int(similaridade * (8 if kind == "previsto" else 18)))
    if kind == "previsto":
        score += 12
    else:
        score += max(0, 12 - abs(data_diferenca))

    return score, _build_match_reason(data_diferenca, valor_diferenca, similaridade, kind)


def _build_resumo(
    lancamento: Lancamento,
    score: int,
    motivo: str,
    entidades_por_id: Optional[Dict[int, Entidade]] = None,
    centros_custo_por_id: Optional[Dict[int, CentroCusto]] = None,
) -> RelacionamentoResumo:
    interessado: Optional[str] = None
    if entidades_por_id and lancamento.entidade_id:
        entidade = entidades_por_id.get(int(lancamento.entidade_id or 0))
        if entidade and entidade.nome:
            interessado = entidade.nome

    centro_custo_nome: Optional[str] = None
    if centros_custo_por_id and lancamento.centro_custo_id:
        centro = centros_custo_por_id.get(int(lancamento.centro_custo_id or 0))
        if centro and centro.nome:
            centro_custo_nome = centro.nome

    return RelacionamentoResumo(
        id=int(lancamento.id) if lancamento.id is not None else None,
        descricao=lancamento.descricao,
        interessado=interessado,
        data_vencimento=lancamento.data_vencimento.isoformat(),
        valor_previsto=float(lancamento.valor_previsto),
        centro_custo_id=int(lancamento.centro_custo_id) if lancamento.centro_custo_id is not None else None,
        centro_custo_nome=centro_custo_nome,
        score=score,
        motivo=motivo,
    )


def _buscar_melhores_relacionamentos(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int],
    atrasados_indisponiveis_ids: Optional[set[int]] = None,
) -> tuple[Optional[tuple[Lancamento, int, str]], List[tuple[Lancamento, int, str]]]:
    previsto = buscar_lancamento_previsto_mesmo_dia_valor(
        db,
        lancamento_ofx,
        empresa_id,
        centro_custo_id=centro_custo_id,
        tolerancia_percentual=MATCH_TOLERANCIA_PERCENTUAL,
    )

    melhor_previsto = None
    if previsto:
        score, motivo = _score_candidate(lancamento_ofx, previsto, "previsto")
        melhor_previsto = (previsto, score, motivo)

    if not melhor_previsto and centro_custo_id:
        previsto_sem_cc = buscar_lancamento_previsto_mesmo_dia_valor(
            db,
            lancamento_ofx,
            empresa_id,
            centro_custo_id=None,
            tolerancia_percentual=MATCH_TOLERANCIA_PERCENTUAL,
        )
        if previsto_sem_cc:
            score, motivo = _score_candidate(lancamento_ofx, previsto_sem_cc, "previsto")
            melhor_previsto = (previsto_sem_cc, score, f"{motivo}, correspondencia encontrada fora do centro de custo selecionado")

    atrasados = buscar_lancamento_atrasado_mesmo_valor(
        db,
        lancamento_ofx,
        empresa_id,
        centro_custo_id=centro_custo_id,
        dias_tolerancia=MATCH_DIAS_ATRASO,
        tolerancia_percentual=MATCH_TOLERANCIA_PERCENTUAL,
    )
    atrasados_indisponiveis_ids = atrasados_indisponiveis_ids or set()

    ranked_atrasados = [
        (candidato, *_score_candidate(lancamento_ofx, candidato, "atrasado"))
        for candidato in atrasados
        if int(candidato.id or 0) not in atrasados_indisponiveis_ids
    ]

    if not ranked_atrasados and centro_custo_id:
        atrasados_sem_cc = buscar_lancamento_atrasado_mesmo_valor(
            db,
            lancamento_ofx,
            empresa_id,
            centro_custo_id=None,
            dias_tolerancia=MATCH_DIAS_ATRASO,
            tolerancia_percentual=MATCH_TOLERANCIA_PERCENTUAL,
        )
        ranked_atrasados = [
            (candidato, *_score_candidate(lancamento_ofx, candidato, "atrasado"))
            for candidato in atrasados_sem_cc
            if int(candidato.id or 0) not in atrasados_indisponiveis_ids
        ]
        ranked_atrasados = [
            (lancamento, score, f"{motivo}, correspondencia encontrada fora do centro de custo selecionado")
            for lancamento, score, motivo in ranked_atrasados
        ]

    ranked_atrasados.sort(key=lambda item: item[1], reverse=True)

    if not melhor_previsto and not ranked_atrasados:
        melhor_previsto = _buscar_previsto_data_proxima_valor_exato(
            db,
            lancamento_ofx,
            empresa_id,
            centro_custo_id=centro_custo_id,
        )
        if not melhor_previsto and centro_custo_id:
            melhor_previsto = _buscar_previsto_data_proxima_valor_exato(
                db,
                lancamento_ofx,
                empresa_id,
                centro_custo_id=None,
            )

    return melhor_previsto, ranked_atrasados


def _buscar_previsto_data_proxima_valor_exato(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int],
) -> Optional[tuple[Lancamento, int, str]]:
    data_base = lancamento_ofx.get("data")
    if not isinstance(data_base, date):
        return None

    try:
        valor = Decimal(str(lancamento_ofx.get("valor") or "0"))
    except Exception:
        return None

    valor_min = valor - Decimal("0.01")
    valor_max = valor + Decimal("0.01")
    data_inicio = data_base - timedelta(days=7)
    data_fim = data_base + timedelta(days=7)
    conta_id = int(lancamento_ofx.get("conta_id") or 0)

    query = select(Lancamento).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.tipo == lancamento_ofx.get("tipo"),
        Lancamento.status.in_(STATUS_ABERTOS),
        Lancamento.data_vencimento.between(data_inicio, data_fim),
        Lancamento.valor_previsto.between(valor_min, valor_max),
    )

    if conta_id > 0:
        query = query.where(or_(Lancamento.conta_id == conta_id, Lancamento.conta_id.is_(None)))

    if centro_custo_id:
        query = query.where(Lancamento.centro_custo_id == centro_custo_id)

    candidatos = db.exec(query.limit(200)).all()
    if not candidatos:
        return None

    melhor: Optional[Lancamento] = None
    melhor_score = -1
    melhor_motivo = ""
    for candidato in candidatos:
        diferenca_dias = abs((candidato.data_vencimento - data_base).days)
        if diferenca_dias > 7:
            continue

        score = 88 - min(40, diferenca_dias * 6)
        if conta_id > 0 and candidato.conta_id == conta_id:
            score += 6

        similaridade = _calcular_similaridade_texto(lancamento_ofx, candidato)
        score += min(6, int(similaridade * 6))

        motivo = (
            "Mesmo valor (centavos) e data de vencimento proxima; "
            "descricao/interessado divergentes nao bloquearam a conciliacao"
        )
        if centro_custo_id is None:
            motivo += ", correspondencia encontrada fora do centro de custo selecionado"

        if score > melhor_score:
            melhor = candidato
            melhor_score = score
            melhor_motivo = motivo

    if not melhor:
        return None

    return melhor, melhor_score, melhor_motivo


class ProcessarArquivoResponse(BaseModel):
    lancamentos: List[LancamentoImportado]
    total_processado: int
    duplicatas_encontradas: int
    lancamentos_previstos_encontrados: int
    lancamentos_atrasados_encontrados: int


class LancamentoDisponivelResumo(BaseModel):
    id: int
    descricao: str
    interessado: Optional[str] = None
    data_vencimento: str
    valor_previsto: float
    centro_custo_id: Optional[int] = None
    centro_custo_nome: Optional[str] = None
    status: Optional[str] = None
    tipo: Optional[str] = None


@router.get(
    "/ofx/lancamentos-disponiveis",
    response_model=List[LancamentoDisponivelResumo],
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def listar_lancamentos_disponiveis(
    tipo: str = Query(...),
    conta_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    data_base: Optional[date] = Query(None),
    incluir_futuros: bool = Query(False),
    limite: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    tipo_normalizado = str(tipo or "").strip().upper()
    if not tipo_normalizado:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo obrigatorio")

    data_ref = data_base or date.today()
    filtros = [
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.tipo == tipo_normalizado,
        Lancamento.status.in_(STATUS_ABERTOS),
        Lancamento.data_pagamento.is_(None),
        or_(Lancamento.conciliado == False, Lancamento.conciliado.is_(None)),
    ]
    if conta_id:
        filtros.append(or_(Lancamento.conta_id == conta_id, Lancamento.conta_id.is_(None)))
    if centro_custo_id:
        filtros.append(Lancamento.centro_custo_id == centro_custo_id)
    if not incluir_futuros:
        filtros.append(Lancamento.data_vencimento <= data_ref)

    candidatos = list(db.exec(
        select(Lancamento)
        .where(*filtros)
        .order_by(Lancamento.data_vencimento.asc())
        .limit(limite)
    ).all())

    entidade_ids = {int(item.entidade_id) for item in candidatos if item.entidade_id}
    centro_ids = {int(item.centro_custo_id) for item in candidatos if item.centro_custo_id}

    entidades_por_id: Dict[int, Entidade] = {}
    centros_por_id: Dict[int, CentroCusto] = {}
    if entidade_ids:
        entidades_por_id = {
            int(ent.id): ent
            for ent in db.exec(select(Entidade).where(Entidade.id.in_(entidade_ids))).all()
            if ent.id is not None
        }
    if centro_ids:
        centros_por_id = {
            int(cc.id): cc
            for cc in db.exec(select(CentroCusto).where(CentroCusto.id.in_(centro_ids))).all()
            if cc.id is not None
        }

    response: List[LancamentoDisponivelResumo] = []
    for item in candidatos:
        interessado = None
        if item.entidade_id:
            entidade = entidades_por_id.get(int(item.entidade_id))
            if entidade and entidade.nome:
                interessado = entidade.nome
        centro_nome = None
        if item.centro_custo_id:
            centro = centros_por_id.get(int(item.centro_custo_id))
            if centro and centro.nome:
                centro_nome = centro.nome

        data_vencimento = item.data_vencimento.isoformat() if item.data_vencimento else ""
        response.append(LancamentoDisponivelResumo(
            id=int(item.id),
            descricao=item.descricao,
            interessado=interessado,
            data_vencimento=data_vencimento,
            valor_previsto=float(item.valor_previsto or 0),
            centro_custo_id=int(item.centro_custo_id) if item.centro_custo_id is not None else None,
            centro_custo_nome=centro_nome,
            status=item.status,
            tipo=item.tipo,
        ))

    return response


@router.post(
    "/ofx/upload",
    response_model=ProcessarArquivoResponse,
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def upload_ofx(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    cartao_id: Optional[int] = Query(None),
    centro_custo_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not arquivo.filename or not arquivo.filename.lower().endswith((".ofx", ".qfx")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser OFX ou QFX"
        )

    if arquivo.size and arquivo.size > OFX_FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo OFX excede o limite de 10 MB.",
        )

    try:
        modo_cartao = bool(cartao_id)
        logger.info(
            "[OFX] Upload recebido empresa_id={} modo={} conta_id={} cartao_id={} arquivo={}",
            empresa_id,
            "CARTAO" if modo_cartao else "CONTA",
            conta_id,
            cartao_id,
            arquivo.filename,
        )
        conta = None
        cartao = None
        centro_custo_id_resolvido = None
        conta_db_id = 0

        if modo_cartao:
            cartao, centro_custo_id_resolvido = _resolver_cartao_e_centro(db, empresa_id, cartao_id, centro_custo_id)
            conta_db_id = int(cartao.conta_id or 0)
        else:
            conta, centro_custo_id_resolvido = _resolver_conta_e_centro(db, empresa_id, conta_id, centro_custo_id)
            conta_db_id = int(conta.id or 0)
        conteudo = arquivo.file.read()
        if len(conteudo) > OFX_FILE_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo OFX excede o limite de 10 MB.",
            )
        lancamentos_raw = processar_ofx(conteudo, empresa_id)
        categorias_empresa, entidades_por_id, centros_custo_por_id, historico_empresa = _carregar_contexto_classificacao(db, empresa_id)

        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0
        hashes_vistos: set[str] = set()
        previstos_sugeridos: Dict[int, int] = {}
        atrasados_sugeridos: Dict[int, int] = {}
        entidade_cache: Dict[str, Optional[int]] = {}

        entidades_por_documento: Dict[str, int] = {}
        entidades_por_nome_exato: Dict[str, int] = {}
        entidades_para_busca: Dict[int, tuple[str, set[str]]] = {}
        entidades_por_token: Dict[str, List[int]] = {}
        for entidade_id, entidade in entidades_por_id.items():
            doc = re.sub(r"[^0-9]", "", str(entidade.cpf_cnpj or ""))
            if doc and doc not in entidades_por_documento:
                entidades_por_documento[doc] = int(entidade_id)

            nome_norm = _normalizar_texto(_normalizar_nome_entidade(entidade.nome))
            if not nome_norm:
                continue
            if nome_norm not in entidades_por_nome_exato:
                entidades_por_nome_exato[nome_norm] = int(entidade_id)

            tokens_nome = {token for token in nome_norm.split() if len(token) >= 3}
            entidade_id_int = int(entidade_id)
            entidades_para_busca[entidade_id_int] = (nome_norm, tokens_nome)
            for token in tokens_nome:
                entidades_por_token.setdefault(token, []).append(entidade_id_int)

        def _resolve_entidade_id_local(lanc_raw_item: Dict[str, Any]) -> Optional[int]:
            nome_base = str(lanc_raw_item.get("razao_social") or lanc_raw_item.get("interessado_sugerido") or "").strip()
            cpf = str(lanc_raw_item.get("cpf_cnpj") or "").strip()
            if not _interessado_tem_confianca(nome_base) and not re.sub(r"[^0-9]", "", cpf):
                return None

            cache_key = f"{_normalizar_texto(nome_base)}|{re.sub(r'[^0-9]', '', cpf)}"
            if cache_key in entidade_cache:
                return entidade_cache[cache_key]

            doc = re.sub(r"[^0-9]", "", cpf)
            entidade_id_local = entidades_por_documento.get(doc) if doc else None

            if entidade_id_local is None and nome_base:
                nome_norm = _normalizar_texto(_normalizar_nome_entidade(nome_base))
                if nome_norm:
                    entidade_id_local = entidades_por_nome_exato.get(nome_norm)

                if entidade_id_local is None and nome_norm:
                    tokens_origem = {token for token in nome_norm.split() if len(token) >= 3}
                    candidatos_ids: Optional[set[int]] = None
                    if tokens_origem:
                        ids_indexados: set[int] = set()
                        for token in tokens_origem:
                            ids_indexados.update(entidades_por_token.get(token, []))
                        if ids_indexados:
                            candidatos_ids = ids_indexados

                    melhor_id: Optional[int] = None
                    melhor_score = 0.0
                    if candidatos_ids:
                        iterador = (
                            (candidato_id, entidades_para_busca[candidato_id])
                            for candidato_id in candidatos_ids
                            if candidato_id in entidades_para_busca
                        )
                    else:
                        iterador = entidades_para_busca.items()

                    for candidato_id, (nome_ref, tokens_ref) in iterador:
                        if tokens_origem and tokens_ref and not (tokens_origem & tokens_ref):
                            continue

                        if len(nome_norm) >= 8 and (nome_norm in nome_ref or nome_ref in nome_norm):
                            melhor_id = candidato_id
                            melhor_score = 1.0
                            break

                        score = SequenceMatcher(None, nome_norm, nome_ref).ratio()
                        if score >= 0.86 and score > melhor_score:
                            melhor_id = candidato_id
                            melhor_score = score

                    entidade_id_local = melhor_id

            entidade_cache[cache_key] = entidade_id_local
            return entidade_id_local

        for lanc_raw in lancamentos_raw:
            lanc_raw["conta_id"] = conta_db_id
            lanc_raw["cartao_id"] = int(cartao.id) if cartao and cartao.id is not None else None
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            interessado_extraido = _extrair_interessado_sugerido(lanc_raw)
            if _interessado_tem_confianca(interessado_extraido):
                lanc_raw["interessado_sugerido"] = interessado_extraido
            referencia_movimento = str(lanc_raw.get("referencia") or "").strip()
            contexto_uid = f"cartao:{int(cartao.id)}" if cartao and cartao.id is not None else f"conta:{conta_db_id}"
            lanc_raw["movimento_uid"] = referencia_movimento or f"fallback:{contexto_uid}:{lanc_raw['linha_arquivo']}"
            lanc_raw["referencia_externa"] = f"{contexto_uid}:{lanc_raw['movimento_uid']}"
            lanc_raw["referencia"] = lanc_raw["referencia_externa"]
            lanc_raw["import_hash"] = gerar_import_hash(
                lanc_raw,
                conta_id=conta_db_id,
                cartao_id=(int(cartao.id) if cartao and cartao.id is not None else None),
            )

        duplicatas_por_hash = _carregar_duplicatas_por_hash(
            db,
            empresa_id,
            [str(item.get("import_hash") or "") for item in lancamentos_raw],
        )

        duplicatas_in_file_por_hash: Dict[str, int] = {}
        for item in lancamentos_raw:
            hash_item = str(item.get("import_hash") or "")
            if not hash_item:
                continue
            duplicatas_in_file_por_hash[hash_item] = duplicatas_in_file_por_hash.get(hash_item, 0) + 1

        ocorrencias_por_chave_conferencia: Dict[tuple[int, str, str, str], int] = {}
        existentes_por_chave_conferencia: Dict[tuple[int, str, str, str], int] = {}

        atrasados_reservados: set[int] = set()
        historico_por_tipo = _agrupar_historico_por_tipo(historico_empresa)
        cache_relacionamentos: Dict[str, tuple[Optional[tuple[Lancamento, int, str]], List[tuple[Lancamento, int, str]]]] = {}

        for lanc_raw in lancamentos_raw:

            if _eh_movimento_saldo_informativo(lanc_raw):
                lanc_raw["saldo_informativo"] = True
                lanc_raw["sugestao_acao"] = "DESCARTAR"
                lanc_raw["motivo_conciliacao"] = "Movimento de saldo informativo do extrato. Exibido para referência e bloqueado para importação no financeiro."
                lancamentos_processados.append(lanc_raw)
                continue

            permitir_importacao_por_quantidade = False
            chave_conferencia = _montar_chave_conferencia_quantidade(lanc_raw, conta_db_id)
            if chave_conferencia:
                ocorrencia_atual = ocorrencias_por_chave_conferencia.get(chave_conferencia, 0) + 1
                ocorrencias_por_chave_conferencia[chave_conferencia] = ocorrencia_atual

                existentes = existentes_por_chave_conferencia.get(chave_conferencia)
                if existentes is None:
                    existentes = _contar_existentes_por_chave_conferencia(db, empresa_id, chave_conferencia)
                    existentes_por_chave_conferencia[chave_conferencia] = existentes

                if ocorrencia_atual > existentes:
                    permitir_importacao_por_quantidade = True

            if not permitir_importacao_por_quantidade:
                if duplicatas_in_file_por_hash.get(str(lanc_raw.get("import_hash") or ""), 0) > 1:
                    # Permite importacao de movimentos duplicados reais do OFX (ex.: debitos recorrentes iguais)
                    # sem descartar no preview apenas por hash repetido no mesmo arquivo.
                    pass
                elif lanc_raw["import_hash"] in hashes_vistos:
                    duplicatas += 1
                    lanc_raw["sugestao_acao"] = "DESCARTAR"
                    lanc_raw["motivo_conciliacao"] = "Movimento repetido dentro do mesmo arquivo OFX."
                    lanc_raw["duplicata_resumo"] = DuplicataResumo(
                        descricao=lanc_raw["descricao"],
                        data_pagamento=lanc_raw.get("data_pagamento"),
                        valor_pago=float(lanc_raw["valor"]),
                        origem="OFX_EXTRATO",
                        motivo="Movimento repetido no arquivo",
                    )
                    lancamentos_processados.append(lanc_raw)
                    continue

                import_hash_atual = str(lanc_raw.get("import_hash") or "")
                duplicata = duplicatas_por_hash.get(import_hash_atual)
                if not duplicata:
                    duplicata = verificar_duplicata_ofx_por_fallback(db, lanc_raw, empresa_id, conta_id=conta_db_id)
                duplicata_historica_motivo = None
                if not duplicata and not modo_cartao:
                    duplicata, duplicata_historica_motivo = _buscar_duplicata_historica(db, lanc_raw, empresa_id, conta_db_id)
                if duplicata:
                    duplicatas += 1
                    lanc_raw["duplicata_id"] = duplicata.id
                    lanc_raw["sugestao_acao"] = "DESCARTAR"
                    lanc_raw["motivo_conciliacao"] = duplicata_historica_motivo or "Movimento ja importado anteriormente para esta conta."
                    data_duplicata = duplicata.data_pagamento or duplicata.data_vencimento
                    valor_duplicata = _valor_lancamento_existente(duplicata)
                    lanc_raw["duplicata_resumo"] = DuplicataResumo(
                        descricao=duplicata.descricao,
                        data_pagamento=data_duplicata.isoformat() if data_duplicata else None,
                        valor_pago=float(valor_duplicata),
                        origem=duplicata.origem,
                        motivo=duplicata_historica_motivo or "Mesmo banco selecionado e mesmo identificador de movimentacao",
                    )
                    lancamentos_processados.append(lanc_raw)
                    continue

            hashes_vistos.add(lanc_raw["import_hash"])

            chave_relacionamento = "|".join([
                str(lanc_raw.get("tipo") or ""),
                str(lanc_raw.get("data") or ""),
                str(lanc_raw.get("valor") or ""),
                str(centro_custo_id_resolvido or 0),
                _normalizar_texto(lanc_raw.get("descricao")),
                _normalizar_texto(lanc_raw.get("razao_social")),
                _normalizar_texto(lanc_raw.get("referencia")),
            ])
            if chave_relacionamento in cache_relacionamentos:
                melhor_previsto, melhores_atrasados = cache_relacionamentos[chave_relacionamento]
            else:
                melhor_previsto, melhores_atrasados = _buscar_melhores_relacionamentos(
                    db,
                    lanc_raw,
                    empresa_id,
                    centro_custo_id_resolvido,
                    atrasados_indisponiveis_ids=atrasados_reservados,
                )
                cache_relacionamentos[chave_relacionamento] = (melhor_previsto, melhores_atrasados)

            if melhor_previsto:
                lanc_previsto_candidato = melhor_previsto[0]
                previsto_candidato_id = int(lanc_previsto_candidato.id or 0)
                if previsto_candidato_id:
                    previstos_sugeridos.setdefault(previsto_candidato_id, 0)
                    previstos_sugeridos[previsto_candidato_id] += 1

            if melhor_previsto:
                previstos += 1
                lanc_previsto, score_previsto, motivo_previsto = melhor_previsto
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True
                lanc_raw["sugestao_acao"] = "BAIXAR_PREVISTO"
                lanc_raw["score_conciliacao"] = score_previsto
                lanc_raw["motivo_conciliacao"] = motivo_previsto
                lanc_raw["lancamento_previsto_resumo"] = _build_resumo(
                    lanc_previsto,
                    score_previsto,
                    motivo_previsto,
                    entidades_por_id,
                    centros_custo_por_id,
                )

            if melhores_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l, _, _ in melhores_atrasados]
                lanc_raw["lancamentos_atrasados_resumo"] = [
                    _build_resumo(lancamento, score, motivo, entidades_por_id, centros_custo_por_id)
                    for lancamento, score, motivo in melhores_atrasados
                ]
                for lancamento_atrasado, _, _ in melhores_atrasados:
                    atraso_id = int(lancamento_atrasado.id or 0)
                    if atraso_id:
                        atrasados_sugeridos.setdefault(atraso_id, 0)
                        atrasados_sugeridos[atraso_id] += 1
                        atrasados_reservados.add(atraso_id)
                if not melhor_previsto:
                    lanc_raw["sugestao_acao"] = "RELACIONAR_ATRASADOS"
                    lanc_raw["score_conciliacao"] = melhores_atrasados[0][1]
                    lanc_raw["motivo_conciliacao"] = melhores_atrasados[0][2]

            if not melhor_previsto and not melhores_atrasados:
                lanc_raw["sugestao_acao"] = "CRIAR_NOVO"
                lanc_raw["motivo_conciliacao"] = "Nenhum previsto ou atraso compativel foi encontrado com o mesmo tipo e tolerancia de 5% no valor."

            _aplicar_sugestao_historica(
                lanc_raw,
                historico_por_tipo.get(str(lanc_raw.get("tipo") or ""), []),
                entidades_por_id,
                conta_db_id,
            )
            _aplicar_sugestao_categoria_por_descricao(lanc_raw, categorias_empresa)
            entidade_id = _resolve_entidade_id_local(lanc_raw)
            lanc_raw["entidade_id"] = lanc_raw.get("entidade_id") or entidade_id

            lancamentos_processados.append(lanc_raw)

        _aplicar_sugestoes_deterministicas(lancamentos_processados, categorias_empresa, historico_empresa, entidades_por_id)

        lancamentos_serializados = []
        for lancamento in lancamentos_processados:
            if not lancamento.get("entidade_id") and (lancamento.get("razao_social") or lancamento.get("interessado_sugerido")):
                entidade_id = _resolve_entidade_id_local(lancamento)
                lancamento["entidade_id"] = entidade_id
            lancamentos_serializados.append(LancamentoImportado(**_serializar_lancamento(lancamento)))

        return ProcessarArquivoResponse(
            lancamentos=lancamentos_serializados,
            total_processado=len(lancamentos_raw),
            duplicatas_encontradas=duplicatas,
            lancamentos_previstos_encontrados=previstos,
            lancamentos_atrasados_encontrados=atrasados,
        )

        

    except Exception as e:
        logger.error(f"Erro ao processar OFX: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


def _resolver_conta_e_centro(
    db: Session,
    empresa_id: int,
    conta_id: Optional[int],
    centro_custo_id: Optional[int],
) -> tuple[Conta, int]:
    if not conta_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecione uma conta para importar."
        )

    conta = db.exec(
        select(Conta).where(
            Conta.id == conta_id,
            Conta.empresa_id == empresa_id,
        )
    ).first()

    if not conta:
        raise HTTPException(status_code=404, detail="Conta nao encontrada")

    centro_custo_resolvido = centro_custo_id or conta.centro_custo_id
    if not centro_custo_resolvido:
        centros = db.exec(
            select(CentroCusto.id).where(CentroCusto.empresa_id == empresa_id)
        ).all()
        if len(centros) == 1:
            centro_custo_resolvido = centros[0]
            conta.centro_custo_id = centro_custo_resolvido
            db.add(conta)
            db.commit()
            db.refresh(conta)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conta precisa estar vinculada a um centro de custo."
            )

    if centro_custo_resolvido is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nao foi possivel resolver o centro de custo da conta selecionada.",
        )

    return conta, centro_custo_resolvido


def _resolver_cartao_e_centro(
    db: Session,
    empresa_id: int,
    cartao_id: Optional[int],
    centro_custo_id: Optional[int],
) -> tuple[Cartao, int]:
    if not cartao_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecione um cartao para importar."
        )

    cartao = db.exec(
        select(Cartao).where(
            Cartao.id == cartao_id,
            Cartao.empresa_id == empresa_id,
        )
    ).first()

    if not cartao:
        raise HTTPException(status_code=404, detail="Cartao nao encontrado")

    centro_custo_resolvido = centro_custo_id or cartao.centro_custo_id
    if not centro_custo_resolvido:
        centros = db.exec(
            select(CentroCusto.id).where(CentroCusto.empresa_id == empresa_id)
        ).all()
        if len(centros) == 1:
            centro_custo_resolvido = centros[0]
            cartao.centro_custo_id = centro_custo_resolvido
            db.add(cartao)
            db.commit()
            db.refresh(cartao)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cartao precisa estar vinculado a um centro de custo."
            )

    if centro_custo_resolvido is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nao foi possivel resolver o centro de custo do cartao selecionado.",
        )

    return cartao, centro_custo_resolvido


def _compute_cartao_vencimento(data_compra: date, cartao: Cartao) -> date:
    fechamento = int(cartao.dia_fechamento or 1)
    vencimento = int(cartao.dia_vencimento or 10)
    statement_offset = 1 if data_compra.day > fechamento else 0
    due_offset = statement_offset + (1 if vencimento <= fechamento else 0)

    base_month = (data_compra.month - 1) + due_offset
    base_year = data_compra.year + (base_month // 12)
    month = (base_month % 12) + 1

    if month == 12:
        next_month = date(base_year + 1, 1, 1)
    else:
        next_month = date(base_year, month + 1, 1)
    ultimo_dia = (next_month - timedelta(days=1)).day
    dia = min(vencimento, ultimo_dia)

    return date(base_year, month, dia)


def _buscar_lancamento_por_import_hash(db: Session, empresa_id: int, import_hash: Optional[str]) -> Optional[Lancamento]:
    if not import_hash:
        return None
    return db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.import_hash == import_hash,
        )
    ).first()


def _obter_referencia_saldo_ofx(lancamentos: List[Dict[str, Any]]) -> tuple[Optional[Decimal], Optional[date]]:
    for item in lancamentos:
        saldo_raw = item.get("ofx_saldo_arquivo")
        data_raw = item.get("ofx_saldo_data")
        if saldo_raw in (None, "") or not data_raw:
            continue
        try:
            saldo_ref = Decimal(str(saldo_raw))
            data_ref = datetime.fromisoformat(str(data_raw)).date()
            return saldo_ref, data_ref
        except Exception:
            continue
    return None, None


def _calcular_saldo_atual_conta(
    db: Session,
    empresa_id: int,
    conta_id: int,
    data_referencia: Optional[date] = None,
) -> Decimal:
    tipo_receita = func.upper(Lancamento.tipo).like("R%")
    tipo_despesa = func.upper(Lancamento.tipo).like("D%")
    movimento_pago = or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))

    conta = db.exec(
        select(Conta).where(
            Conta.empresa_id == empresa_id,
            Conta.id == conta_id,
        )
    ).first()
    if not conta:
        return Decimal("0.00")

    filtros_saldo = [
        Lancamento.empresa_id == empresa_id,
        Lancamento.conta_id == conta_id,
        Lancamento.is_deleted == False,
        movimento_pago,
    ]
    if data_referencia is not None:
        filtros_saldo.append(
            func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento) <= data_referencia
        )

    soma = db.exec(
        select(
            func.sum(case((tipo_receita, Lancamento.valor_pago), else_=0)).label("receitas"),
            func.sum(case((tipo_despesa, Lancamento.valor_pago), else_=0)).label("despesas"),
        )
        .where(*filtros_saldo)
    ).first()

    receitas = Decimal(str((soma[0] if soma else 0) or 0))
    despesas = Decimal(str((soma[1] if soma else 0) or 0))
    saldo_inicial = Decimal(str(conta.saldo_inicial or 0))
    return saldo_inicial + receitas - despesas


def _calcular_divergencia_saldo_ofx(
    db: Session,
    empresa_id: int,
    conta_id: int,
    saldo_ofx: Decimal,
    data_referencia: Optional[date],
) -> Optional[Dict[str, Any]]:
    saldo_calculado = _calcular_saldo_atual_conta(
        db,
        empresa_id,
        conta_id,
        data_referencia=data_referencia,
    )
    diferenca = saldo_ofx - saldo_calculado
    if abs(diferenca) < Decimal("0.01"):
        return None

    return {
        "conta_id": conta_id,
        "saldo_ofx": float(saldo_ofx),
        "saldo_sistema": float(saldo_calculado),
        "diferenca": float(diferenca),
        "data_referencia": data_referencia.isoformat() if data_referencia else None,
    }


class ConfirmarLancamentosRequest(BaseModel):
    lancamentos: List[Dict[str, Any]]
    conta_id: Optional[int] = None
    cartao_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    modo_importacao: Optional[str] = None


@router.post(
    "/confirmar-lancamentos",
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def confirmar_lancamentos(
    request: ConfirmarLancamentosRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    lancamentos_criados = 0
    lancamentos_atualizados = 0
    erros: List[str] = []
    import_hashes_processados: set[str] = set()
    previstos_compensados_no_lote: set[int] = set()
    atrasados_compensados_no_lote: set[int] = set()
    ignorados_descartar = 0
    ignorados_sugestao_pendente = 0
    ignorados_duplicata_payload = 0
    ignorados_idempotencia_lote = 0
    ignorados_idempotencia_historico = 0
    max_amostras_ignorados = 6
    amostras_ignorados: Dict[str, List[Dict[str, Any]]] = {
        "descartar": [],
        "sugestao_pendente": [],
        "duplicata_payload": [],
        "idempotencia_lote": [],
        "idempotencia_historico": [],
    }
    divergencia_saldo_ofx_antes: Optional[Dict[str, Any]] = None
    divergencia_saldo_ofx: Optional[Dict[str, Any]] = None

    def _registrar_amostra_ignorada(chave: str, item: Dict[str, Any]) -> None:
        bucket = amostras_ignorados.get(chave)
        if bucket is None or len(bucket) >= max_amostras_ignorados:
            return
        bucket.append({
            "id": item.get("id"),
            "linha_arquivo": item.get("linha_arquivo"),
            "descricao": str(item.get("descricao") or "")[:140],
            "valor": item.get("valor"),
            "data": item.get("data"),
            "tipo": item.get("tipo"),
            "import_hash": str(item.get("import_hash") or "")[:16],
            "sugestao_acao": item.get("sugestao_acao"),
        })

    conta_resolvida = None
    cartao_resolvido = None
    centro_custo_resolvido = None
    modo_cartao = str(request.modo_importacao or "").strip().upper() == "CARTAO" or bool(request.cartao_id)
    logger.info(
        "[OFX] Confirmacao iniciada empresa_id={} modo={} conta_id={} cartao_id={} itens={}",
        empresa_id,
        "CARTAO" if modo_cartao else "CONTA",
        request.conta_id,
        request.cartao_id,
        len(request.lancamentos or []),
    )

    if modo_cartao:
        cartao_resolvido, centro_custo_resolvido = _resolver_cartao_e_centro(
            db,
            empresa_id,
            request.cartao_id,
            request.centro_custo_id,
        )
    elif request.conta_id:
        conta_resolvida, centro_custo_resolvido = _resolver_conta_e_centro(
            db,
            empresa_id,
            request.conta_id,
            request.centro_custo_id,
        )
    conta_resolvida_id: Optional[int] = None
    if conta_resolvida and conta_resolvida.id is not None:
        conta_resolvida_id = conta_resolvida.id

    saldo_ofx_referencia: Optional[Decimal] = None
    data_ofx_referencia: Optional[date] = None
    if not modo_cartao:
        saldo_ofx_referencia, data_ofx_referencia = _obter_referencia_saldo_ofx(request.lancamentos or [])
        if conta_resolvida_id is not None and saldo_ofx_referencia is not None:
            divergencia_saldo_ofx_antes = _calcular_divergencia_saldo_ofx(
                db,
                empresa_id,
                conta_resolvida_id,
                saldo_ofx_referencia,
                data_ofx_referencia,
            )

    def _lancamento_aberto_para_conciliar(lancamento: Lancamento) -> bool:
        status_normalizado = str(lancamento.status or "").upper()
        return status_normalizado in STATUS_ABERTOS and lancamento.data_pagamento is None

    conflitos_previstos: Dict[int, set[int]] = {}
    conflitos_atrasados: Dict[int, set[int]] = {}
    for lanc_data in request.lancamentos or []:
        sugestao_acao_raw = str(lanc_data.get("sugestao_acao") or "").strip().upper()
        sugestao_confirmada = bool(lanc_data.get("sugestao_confirmada")) if "sugestao_confirmada" in lanc_data else True
        possui_previsto = bool(lanc_data.get("lancamento_previsto_id"))
        possui_atrasados = bool(lanc_data.get("lancamentos_atrasados_relacionados"))

        if not sugestao_acao_raw:
            if possui_previsto:
                acao = "BAIXAR_PREVISTO"
            elif possui_atrasados:
                acao = "RELACIONAR_ATRASADOS"
            else:
                acao = "CRIAR_NOVO"
        else:
            acao = sugestao_acao_raw

        if acao in {"IGNORAR_DUPLICATA", "DESCARTAR"}:
            continue
        if acao in {"BAIXAR_PREVISTO", "RELACIONAR_ATRASADOS"} and not sugestao_confirmada:
            continue

        linha_arquivo = int(lanc_data.get("linha_arquivo") or 0)

        if not modo_cartao and acao == "BAIXAR_PREVISTO" and lanc_data.get("lancamento_previsto_id"):
            try:
                previsto_id = int(lanc_data.get("lancamento_previsto_id"))
            except Exception:
                previsto_id = 0
            if previsto_id > 0:
                conflitos_previstos.setdefault(previsto_id, set()).add(linha_arquivo)

        if not modo_cartao and acao == "RELACIONAR_ATRASADOS":
            atrasados_ids = lanc_data.get("lancamentos_atrasados_relacionados") or []
            if not isinstance(atrasados_ids, list):
                continue
            vistos_local: set[int] = set()
            for atraso_id_raw in atrasados_ids:
                try:
                    atraso_id = int(atraso_id_raw)
                except Exception:
                    continue
                if atraso_id <= 0 or atraso_id in vistos_local:
                    continue
                vistos_local.add(atraso_id)
                conflitos_atrasados.setdefault(atraso_id, set()).add(linha_arquivo)

    previstos_repetidos = {item_id: linhas for item_id, linhas in conflitos_previstos.items() if len(linhas) > 1}
    atrasados_repetidos = {item_id: linhas for item_id, linhas in conflitos_atrasados.items() if len(linhas) > 1}
    if previstos_repetidos or atrasados_repetidos:
        conflitos_resumo: List[str] = []
        for previsto_id, linhas in sorted(previstos_repetidos.items())[:5]:
            linhas_validas = sorted([linha for linha in linhas if linha > 0])
            conflitos_resumo.append(f"Previsto {previsto_id} repetido nas linhas {linhas_validas or ['?']}")
        for atraso_id, linhas in sorted(atrasados_repetidos.items())[:5]:
            linhas_validas = sorted([linha for linha in linhas if linha > 0])
            conflitos_resumo.append(f"Atrasado {atraso_id} repetido nas linhas {linhas_validas or ['?']}")

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Conflito de conciliação: a mesma sugestão foi selecionada em mais de um lançamento. Remova as duplicidades e tente novamente.",
                "conflitos": conflitos_resumo,
            },
        )

    for lanc_data in request.lancamentos:
        try:
            sugestao_acao_raw = str(lanc_data.get("sugestao_acao") or "").strip().upper()
            sugestao_confirmada = (
                bool(lanc_data.get("sugestao_confirmada"))
                if "sugestao_confirmada" in lanc_data
                else True
            )
            possui_previsto = bool(lanc_data.get("lancamento_previsto_id"))
            possui_atrasados = bool(lanc_data.get("lancamentos_atrasados_relacionados"))

            # Compatibilidade: quando a ação não vier no payload, preserva o comportamento sugerido no upload.
            if not sugestao_acao_raw:
                if possui_previsto:
                    acao = "BAIXAR_PREVISTO"
                elif possui_atrasados:
                    acao = "RELACIONAR_ATRASADOS"
                else:
                    acao = "CRIAR_NOVO"
            else:
                acao = sugestao_acao_raw

            if acao in {"IGNORAR_DUPLICATA", "DESCARTAR"}:
                ignorados_descartar += 1
                _registrar_amostra_ignorada("descartar", lanc_data)
                continue

            # Sugestoes automaticas so devem ser executadas apos confirmacao explicita no frontend.
            if acao in {"BAIXAR_PREVISTO", "RELACIONAR_ATRASADOS"} and not sugestao_confirmada:
                ignorados_sugestao_pendente += 1
                _registrar_amostra_ignorada("sugestao_pendente", lanc_data)
                continue

            # Duplicata identificada no upload nunca deve virar novo lançamento.
            if lanc_data.get("duplicata_id") or lanc_data.get("duplicata_resumo"):
                ignorados_duplicata_payload += 1
                _registrar_amostra_ignorada("duplicata_payload", lanc_data)
                continue

            import_hash = str(lanc_data.get("import_hash") or "").strip()
            if import_hash and import_hash in import_hashes_processados:
                ignorados_idempotencia_lote += 1
                _registrar_amostra_ignorada("idempotencia_lote", lanc_data)
                logger.warning(
                    "Importacao OFX ignorada por idempotencia no mesmo lote: "
                    f"hash={import_hash} descricao={lanc_data.get('descricao')}"
                )
                continue

            if _buscar_lancamento_por_import_hash(db, empresa_id, import_hash or None):
                ignorados_idempotencia_historico += 1
                _registrar_amostra_ignorada("idempotencia_historico", lanc_data)
                logger.warning(
                    "Importacao OFX ignorada por idempotencia: movimento ja confirmado anteriormente. "
                    f"hash={import_hash} descricao={lanc_data.get('descricao')}"
                )
                continue

            if import_hash:
                import_hashes_processados.add(import_hash)

            from app.services.importacao_bancaria_service import parsear_data

            if acao == "BAIXAR_PREVISTO" and lanc_data.get("lancamento_previsto_id") and not modo_cartao:
                previsto_id = int(lanc_data["lancamento_previsto_id"])
                if previsto_id in previstos_compensados_no_lote:
                    erros.append(
                        f"Previsto id={previsto_id} apareceu em mais de um movimento no mesmo lote. O movimento foi convertido para criacao nova: {lanc_data.get('descricao')}"
                    )
                    logger.warning(
                        "[OFX] Previsto reutilizado no mesmo lote empresa_id={} previsto_id={} descricao={}",
                        empresa_id,
                        previsto_id,
                        str(lanc_data.get("descricao") or "")[:140],
                    )
                    acao = "CRIAR_NOVO"
                else:
                    lanc_existente = db.get(Lancamento, previsto_id)
                    if (
                        lanc_existente
                        and not lanc_existente.is_deleted
                        and int(lanc_existente.empresa_id) == int(empresa_id)
                        and _lancamento_aberto_para_conciliar(lanc_existente)
                    ):
                        data_pagamento = parsear_data(lanc_data["data_pagamento"]) if lanc_data.get("data_pagamento") else parsear_data(lanc_data.get("data") or "")
                        data_vencimento = parsear_data(lanc_data["data_vencimento"]) if lanc_data.get("data_vencimento") else None

                        if data_vencimento:
                            lanc_existente.data_vencimento = data_vencimento

                        lanc_existente.data_pagamento = data_pagamento
                        lanc_existente.status = "PAGO"
                        lanc_existente.conciliado = True
                        lanc_existente.valor_pago = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
                        if lanc_data.get("plano_contas_id"):
                            lanc_existente.plano_contas_id = int(lanc_data["plano_contas_id"])
                        if lanc_data.get("entidade_id"):
                            lanc_existente.entidade_id = int(lanc_data["entidade_id"])
                        if conta_resolvida:
                            lanc_existente.conta_id = conta_resolvida.id
                        if centro_custo_resolvido:
                            lanc_existente.centro_custo_id = centro_custo_resolvido
                        if import_hash and not lanc_existente.import_hash:
                            lanc_existente.import_hash = import_hash
                        movimento_uid = str(lanc_data.get("movimento_uid") or "").strip()
                        referencia_externa = str(lanc_data.get("referencia_externa") or "").strip()
                        if movimento_uid and not lanc_existente.movimento_uid:
                            lanc_existente.movimento_uid = movimento_uid
                        if referencia_externa and not lanc_existente.referencia_externa:
                            lanc_existente.referencia_externa = referencia_externa
                        db.add(lanc_existente)
                        previstos_compensados_no_lote.add(previsto_id)
                        lancamentos_atualizados += 1
                        continue

                    erros.append(
                        f"Previsto id={previsto_id} nao encontrado/aberto para compensacao; movimento sera criado como novo: {lanc_data.get('descricao')}"
                    )
                    logger.warning(
                        "[OFX] Previsto indisponivel para conciliacao empresa_id={} previsto_id={} descricao={}",
                        empresa_id,
                        previsto_id,
                        str(lanc_data.get("descricao") or "")[:140],
                    )
                    acao = "CRIAR_NOVO"

            if acao == "RELACIONAR_ATRASADOS" and lanc_data.get("lancamentos_atrasados_relacionados") and not modo_cartao:
                atualizados_atrasados = 0
                atrasados_ids_unicos: List[int] = []
                for atrasado_id_raw in lanc_data["lancamentos_atrasados_relacionados"]:
                    try:
                        atrasado_id = int(atrasado_id_raw)
                    except Exception:
                        continue
                    if atrasado_id <= 0 or atrasado_id in atrasados_ids_unicos:
                        continue
                    atrasados_ids_unicos.append(atrasado_id)

                for atrasado_id in atrasados_ids_unicos:
                    if atrasado_id in atrasados_compensados_no_lote:
                        continue

                    lanc_atrasado = db.get(Lancamento, atrasado_id)
                    if not lanc_atrasado or lanc_atrasado.is_deleted or int(lanc_atrasado.empresa_id) != int(empresa_id):
                        continue
                    if not _lancamento_aberto_para_conciliar(lanc_atrasado):
                        continue

                    data_pagamento = parsear_data(lanc_data["data_pagamento"]) if lanc_data.get("data_pagamento") else parsear_data(lanc_data.get("data") or "")
                    lanc_atrasado.data_pagamento = data_pagamento
                    lanc_atrasado.status = "PAGO"
                    lanc_atrasado.conciliado = True
                    lanc_atrasado.valor_pago = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
                    if lanc_data.get("plano_contas_id"):
                        lanc_atrasado.plano_contas_id = int(lanc_data["plano_contas_id"])
                    if lanc_data.get("entidade_id"):
                        lanc_atrasado.entidade_id = int(lanc_data["entidade_id"])
                    if conta_resolvida:
                        lanc_atrasado.conta_id = conta_resolvida.id
                    if centro_custo_resolvido:
                        lanc_atrasado.centro_custo_id = centro_custo_resolvido
                    if import_hash and not lanc_atrasado.import_hash:
                        lanc_atrasado.import_hash = import_hash
                    movimento_uid = str(lanc_data.get("movimento_uid") or "").strip()
                    referencia_externa = str(lanc_data.get("referencia_externa") or "").strip()
                    if movimento_uid and not lanc_atrasado.movimento_uid:
                        lanc_atrasado.movimento_uid = movimento_uid
                    if referencia_externa and not lanc_atrasado.referencia_externa:
                        lanc_atrasado.referencia_externa = referencia_externa
                    db.add(lanc_atrasado)
                    atrasados_compensados_no_lote.add(atrasado_id)
                    lancamentos_atualizados += 1
                    atualizados_atrasados += 1

                if atualizados_atrasados == 0:
                    erros.append(
                        f"Nenhum atraso selecionado foi localizado para conciliacao: {lanc_data.get('descricao')}"
                    )
                    logger.warning(
                        "[OFX] Nenhum atraso atualizado na conciliacao empresa_id={} descricao={} ids={}",
                        empresa_id,
                        str(lanc_data.get("descricao") or "")[:140],
                        atrasados_ids_unicos,
                    )
                    continue

                # Ao selecionar RELACIONAR_ATRASADOS, o comportamento esperado
                # e somente quitar os selecionados, sem criar novo lancamento.
                continue

            plano_contas_id = lanc_data.get("plano_contas_id")
            if not plano_contas_id:
                plano_contas_table = getattr(PlanoContas, "__table__")
                categoria = db.exec(
                    select(PlanoContas).where(
                        plano_contas_table.c.empresa_id == empresa_id,
                        plano_contas_table.c.nome.ilike("%categorizar%")
                    )
                ).first()
                if categoria:
                    plano_contas_id = categoria.id
                else:
                    tipo_categoria = "R" if lanc_data.get("tipo") == "RECEITA" else "D"
                    categoria_nova = PlanoContas(
                        nome="A Categorizar",
                        codigo=None,
                        tipo=tipo_categoria,
                        empresa_id=empresa_id,
                        permite_lancamentos=True,
                    )
                    db.add(categoria_nova)
                    db.commit()
                    db.refresh(categoria_nova)
                    plano_contas_id = categoria_nova.id

            if not plano_contas_id:
                erros.append(f"Lancamento {lanc_data.get('descricao')} sem categoria")
                continue

            data_pagamento = parsear_data(lanc_data["data_pagamento"]) if lanc_data.get("data_pagamento") else parsear_data(lanc_data.get("data") or "")
            data_compra_base = parsear_data(lanc_data.get("data") or "") or parsear_data(lanc_data.get("data_vencimento") or "") or date.today()
            data_vencimento = parsear_data(lanc_data["data_vencimento"]) if lanc_data.get("data_vencimento") else (data_pagamento or data_compra_base)
            data_vencimento = data_vencimento or data_pagamento or data_compra_base or date.today()
            data_pagamento = data_pagamento or data_vencimento or date.today()

            if acao == "CRIAR_NOVO" and not modo_cartao and conta_resolvida_id is not None:
                lancamento_probe = {
                    "data": data_pagamento,
                    "valor": lanc_data.get("valor_pago") or lanc_data.get("valor"),
                    "tipo": lanc_data.get("tipo"),
                    "descricao": lanc_data.get("descricao"),
                    "razao_social": lanc_data.get("razao_social"),
                    "interessado_sugerido": lanc_data.get("interessado_sugerido"),
                    "referencia": lanc_data.get("referencia"),
                }
                duplicata_confirmacao, motivo_confirmacao = _buscar_duplicata_historica(
                    db,
                    lancamento_probe,
                    empresa_id,
                    conta_resolvida_id,
                )
                if duplicata_confirmacao:
                    ignorados_duplicata_payload += 1
                    lanc_data["sugestao_acao"] = "DESCARTAR"
                    lanc_data["motivo_conciliacao"] = f"Duplicata detectada na confirmacao: {motivo_confirmacao or 'movimento ja registrado na conta'}"
                    _registrar_amostra_ignorada("duplicata_payload", lanc_data)
                    logger.warning(
                        "[OFX] Criacao evitada por duplicata detectada na confirmacao conta_id={} empresa_id={} candidato_id={} descricao={}",
                        conta_resolvida_id,
                        empresa_id,
                        duplicata_confirmacao.id,
                        str(lanc_data.get("descricao") or "")[:140],
                    )
                    continue

            status_novo = "PAGO"
            origem_nova = str(lanc_data["origem"])
            data_competencia_nova = data_pagamento or data_vencimento or date.today()
            valor_pago_novo = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
            conta_nova_id = (conta_resolvida.id if conta_resolvida else lanc_data.get("conta_id") or request.conta_id)
            cartao_novo_id = None

            if modo_cartao and cartao_resolvido:
                status_novo = "EM ABERTO"
                origem_nova = "OFX_FATURA_CARTAO"
                data_competencia_nova = data_compra_base
                data_vencimento = _compute_cartao_vencimento(data_compra_base, cartao_resolvido)
                data_pagamento = None
                valor_pago_novo = Decimal("0.00")
                conta_nova_id = int(cartao_resolvido.conta_id) if cartao_resolvido.conta_id else None
                cartao_novo_id = int(cartao_resolvido.id) if cartao_resolvido.id is not None else None

            novo_lancamento = Lancamento(
                descricao=str(lanc_data["descricao"]),
                tipo=str(lanc_data["tipo"]),
                status=status_novo,
                origem=origem_nova,
                valor_previsto=Decimal(str(lanc_data.get("valor_previsto") or lanc_data["valor"])),
                valor_pago=valor_pago_novo,
                data_vencimento=data_vencimento,
                data_pagamento=data_pagamento,
                data_competencia=data_competencia_nova,
                empresa_id=empresa_id,
                plano_contas_id=int(plano_contas_id),
                entidade_id=int(lanc_data["entidade_id"]) if lanc_data.get("entidade_id") else None,
                conta_id=conta_nova_id,
                cartao_id=cartao_novo_id,
                centro_custo_id=(centro_custo_resolvido or lanc_data.get("centro_custo_id") or request.centro_custo_id),
                import_hash=import_hash or None,
                movimento_uid=str(lanc_data.get("movimento_uid") or "").strip() or None,
                referencia_externa=str(lanc_data.get("referencia_externa") or "").strip() or None,
                conciliado=not modo_cartao,
                ipp=False,
            )
            db.add(novo_lancamento)
            lancamentos_criados += 1
        except Exception as exc:
            logger.error(f"Erro ao confirmar lancamento OFX: {exc}")
            erros.append(str(exc))

    try:
        if not modo_cartao and conta_resolvida_id is not None and saldo_ofx_referencia is not None:
            db.flush()
            divergencia_saldo_ofx = _calcular_divergencia_saldo_ofx(
                db,
                empresa_id,
                conta_resolvida_id,
                saldo_ofx_referencia,
                data_ofx_referencia,
            )
            abs_divergencia_antes = abs(Decimal(str((divergencia_saldo_ofx_antes or {}).get("diferenca") or "0")))
            abs_divergencia_depois = abs(Decimal(str((divergencia_saldo_ofx or {}).get("diferenca") or "0")))
            if abs_divergencia_depois > abs_divergencia_antes + Decimal("0.01"):
                logger.warning(
                    "[OFX] Divergencia de saldo piorou apos confirmacao conta_id={} empresa_id={} abs_antes={} abs_depois={} antes={} depois={}",
                    conta_resolvida_id,
                    empresa_id,
                    abs_divergencia_antes,
                    abs_divergencia_depois,
                    divergencia_saldo_ofx_antes,
                    divergencia_saldo_ofx,
                )
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": "Importacao OFX cancelada: a divergencia de saldo aumentou apos a conciliacao. O sistema bloqueou para evitar inclusoes indevidas.",
                        "divergencia_saldo_ofx_antes": divergencia_saldo_ofx_antes,
                        "divergencia_saldo_ofx_depois": divergencia_saldo_ofx,
                    },
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[OFX] Falha ao calcular divergencia de saldo com referencia do extrato: {}", exc)

    db.commit()

    logger.info(
        "[OFX] Confirmacao finalizada empresa_id={} criados={} atualizados={} erros={} ignorados_descartar={} ignorados_sugestao_pendente={} ignorados_duplicata_payload={} ignorados_idempotencia_lote={} ignorados_idempotencia_historico={} divergencia_saldo_ofx={}",
        empresa_id,
        lancamentos_criados,
        lancamentos_atualizados,
        len(erros),
        ignorados_descartar,
        ignorados_sugestao_pendente,
        ignorados_duplicata_payload,
        ignorados_idempotencia_lote,
        ignorados_idempotencia_historico,
        bool(divergencia_saldo_ofx),
    )
    logger.info(
        "[OFX] Confirmacao amostras_ignorados empresa_id={} descartar={} sugestao_pendente={} duplicata_payload={} idempotencia_lote={} idempotencia_historico={}",
        empresa_id,
        amostras_ignorados["descartar"],
        amostras_ignorados["sugestao_pendente"],
        amostras_ignorados["duplicata_payload"],
        amostras_ignorados["idempotencia_lote"],
        amostras_ignorados["idempotencia_historico"],
    )

    return {
        "sucesso": True,
        "lancamentos_criados": lancamentos_criados,
        "lancamentos_atualizados": lancamentos_atualizados,
        "erros": erros,
        "divergencia_saldo_ofx_antes": divergencia_saldo_ofx_antes,
        "divergencia_saldo_ofx": divergencia_saldo_ofx,
    }
