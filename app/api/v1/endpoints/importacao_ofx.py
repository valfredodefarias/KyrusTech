"""
Endpoints para importacao de arquivos OFX (multibancos).
"""
# pyright: reportGeneralTypeIssues=false
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
from app.models.movimento import Movimento
from app.models.baixa import Baixa


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
    movimento_id: Optional[int] = None



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
    # Special-case: many banks emit PIX QR descriptions like
    # "PIX QR CODE RECEBIDO ... 27/05 NOME COMPLETO 000.000.000-00" where
    # the payee name appears *after* a date and is followed by CPF/CNPJ.
    # Detect this pattern and extract the name, removing CPF/CNPJ noise.
    descricao_bruta_full = str(lancamento_ofx.get("descricao") or "")
    if re.search(r"^\s*PIX\s+QR\s+CODE\s+RECEBIDO", descricao_bruta_full, flags=re.I):
        m = re.search(r"(\d{1,2}[\-/]\d{1,2}(?:[\-/]\d{2,4})?)", descricao_bruta_full)
        if m:
            after = descricao_bruta_full[m.end():].strip()
            # remove common CPF/CNPJ formats and long digit sequences
            after = re.sub(r"\d{3}\.\d{3}\.\d{3}-\d{2}", " ", after)
            after = re.sub(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", " ", after)
            after = re.sub(r"\b\d{11,14}\b", " ", after)
            # remove stray punctuation, keep letters and spaces
            after = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ \-]", " ", after)
            after = " ".join(after.split())
            candidato_pix = _normalizar_interessado_final(after)
            if candidato_pix:
                return candidato_pix

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

    if interessado_norm == entidade_norm:
        return True

    interessado_words = interessado_norm.split()
    entidade_words = entidade_norm.split()

    if len(entidade_norm) < 3:
        if entidade_norm in interessado_words:
            return True
    else:
        if entidade_norm in interessado_norm:
            return True

    if len(interessado_norm) < 3:
        if interessado_norm in entidade_words:
            return True
    else:
        if interessado_norm in entidade_norm:
            return True

    interessado_tokens = [t for t in interessado_norm.split() if t not in TOKENS_JURIDICOS_FRACOS]
    entidade_tokens = [t for t in entidade_norm.split() if t not in TOKENS_JURIDICOS_FRACOS]
    if not interessado_tokens or not entidade_tokens:
        return False

    base_interessado = " ".join(interessado_tokens)
    base_entidade = " ".join(entidade_tokens)
    if base_interessado == base_entidade:
        return True

    base_interessado_words = base_interessado.split()
    base_entidade_words = base_entidade.split()

    if len(base_entidade) < 3:
        if base_entidade in base_interessado_words:
            return True
    else:
        if base_entidade in base_interessado:
            return True

    if len(base_interessado) < 3:
        if base_interessado in base_entidade_words:
            return True
    else:
        if base_interessado in base_entidade:
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
    ofx_bank_id: Optional[str] = None,
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
    banco_normalizado = _normalizar_texto(ofx_bank_id or lancamento_ofx.get("ofx_bank_id"))

    def _buscar_por_conta() -> List[Lancamento]:
        return db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == lancamento_ofx.get("tipo"),
                or_(
                    Lancamento.conta_id == conta_id,
                    Lancamento.conta_id.is_(None),  # type: ignore[attr-defined]
                ),
                or_(
                    Lancamento.data_pagamento.between(data_inicio, data_fim),  # type: ignore[attr-defined]
                    Lancamento.data_vencimento.between(data_inicio, data_fim),  # type: ignore[attr-defined]
                ),
                or_(
                    Lancamento.valor_previsto.between(valor_min, valor_max),  # type: ignore[attr-defined]
                    Lancamento.valor_pago.between(valor_min, valor_max),  # type: ignore[attr-defined]
                ),
            )
            .order_by(Lancamento.data_pagamento.desc(), Lancamento.id.desc())  # type: ignore[attr-defined]
            .limit(300)
        ).all()  # type: ignore

    if banco_normalizado:
        candidatos = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == lancamento_ofx.get("tipo"),
                Lancamento.ofx_bank_id == banco_normalizado,
                or_(
                    Lancamento.conta_id == conta_id,
                    Lancamento.conta_id.is_(None),  # type: ignore[attr-defined]
                ),
                or_(
                    Lancamento.data_pagamento.between(data_inicio, data_fim),  # type: ignore[attr-defined]
                    Lancamento.data_vencimento.between(data_inicio, data_fim),  # type: ignore[attr-defined]
                ),
                or_(
                    Lancamento.valor_previsto.between(valor_min, valor_max),  # type: ignore[attr-defined]
                    Lancamento.valor_pago.between(valor_min, valor_max),  # type: ignore[attr-defined]
                ),
            )
            .order_by(Lancamento.data_pagamento.desc(), Lancamento.id.desc())  # type: ignore[attr-defined]
            .limit(300)
        ).all()  # type: ignore
        if not candidatos:
            candidatos = _buscar_por_conta()
    else:
        candidatos = _buscar_por_conta()

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
        lancamento_baixado = candidato.conciliado or str(candidato.status or "").upper() == "PAGO"

        # Caso especial para iFood e Cartões:
        # Se o lançamento existente for do iFood ou Cartão, e o movimento OFX também for,
        # e o valor for idêntico dentro de uma janela de 3 dias, consideramos duplicata
        # mesmo que a descrição seja diferente (ex: "Repasse iFood" vs "CREDITO IFOOD").
        is_existente_ifood = (bool(candidato.origem and candidato.origem.upper() == "IFOOD") or "ifood" in candidato.descricao.lower())
        is_ofx_ifood = "ifood" in lancamento_ofx.get("descricao", "").lower()
        
        is_existente_cartao = (bool(candidato.origem and candidato.origem.upper() in ("CARTAO", "LOTE_CARTAO")) or any(t in candidato.descricao.lower() for t in ("cielo", "redecard", "stone", "pagseguro")))
        is_ofx_cartao = any(t in lancamento_ofx.get("descricao", "").lower() for t in ("cielo", "redecard", "stone", "pagseguro", "adquirente"))

        if valor_exato and diferenca_dias <= 3:
            if (is_existente_ifood and is_ofx_ifood) or (is_existente_cartao and is_ofx_cartao):
                return candidato, f"Lançamento de repasse/cartão de mesmo valor identificado nos últimos {diferenca_dias} dias"

        # Mesmo dia+valor pode ocorrer em movimentos distintos;
        # exige evidencias adicionais para evitar falso positivo de "ja importado".
        if mesmo_dia_pagamento and valor_exato:
            if lancamento_baixado or entidade_bate or tokens_em_comum >= 4 or (similaridade >= 0.82 and tokens_em_comum >= 2):
                motivo = "Mesmo valor e mesma data de pagamento de um lancamento ja baixado"
                if similaridade >= 0.82 and tokens_em_comum >= 2:
                    motivo += " com descricao muito parecida"
                elif entidade_bate:
                    motivo += " com favorecido/interessado compativel"
                elif tokens_em_comum >= 4:
                    motivo += " com termos relevantes em comum na descricao"
                elif lancamento_baixado:
                    motivo += " e lancamento ja conciliado"
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
                Lancamento.valor_pago.between(valor_min, valor_max),  # type: ignore[attr-defined]
                Lancamento.valor_previsto.between(valor_min, valor_max),  # type: ignore[attr-defined]
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
            or_(
                Lancamento.observacao.is_(None),
                ~Lancamento.observacao.ilike('%"legacy_id_venda"%')
            )
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

    denom = abs(valor) if abs(valor) > 0 else Decimal("1")
    relative_diff = valor_diferenca / denom
    pct_diff = min(Decimal("1.0"), relative_diff / MATCH_TOLERANCIA_PERCENTUAL)
    value_score = int(Decimal("22") * (Decimal("1.0") - pct_diff))
    score += value_score

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
    previstos_indisponiveis_ids: Optional[set[int]] = None,
) -> tuple[Optional[tuple[Lancamento, int, str]], List[tuple[Lancamento, int, str]]]:
    previsto = buscar_lancamento_previsto_mesmo_dia_valor(
        db,
        lancamento_ofx,
        empresa_id,
        centro_custo_id=centro_custo_id,
        tolerancia_percentual=MATCH_TOLERANCIA_PERCENTUAL,
        previstos_indisponiveis_ids=previstos_indisponiveis_ids,
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
            previstos_indisponiveis_ids=previstos_indisponiveis_ids,
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

    if not melhor_previsto:
        melhor_previsto = _buscar_previsto_data_proxima_valor_exato(
            db,
            lancamento_ofx,
            empresa_id,
            centro_custo_id=centro_custo_id,
            previstos_indisponiveis_ids=previstos_indisponiveis_ids,
        )
        if not melhor_previsto and centro_custo_id:
            melhor_previsto = _buscar_previsto_data_proxima_valor_exato(
                db,
                lancamento_ofx,
                empresa_id,
                centro_custo_id=None,
                previstos_indisponiveis_ids=previstos_indisponiveis_ids,
            )

    return melhor_previsto, ranked_atrasados


def _buscar_previsto_data_proxima_valor_exato(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int],
    previstos_indisponiveis_ids: Optional[set[int]] = None,
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
        Lancamento.status.in_(STATUS_ABERTOS),  # type: ignore[attr-defined]
        Lancamento.data_vencimento.between(data_inicio, data_fim),  # type: ignore[attr-defined]
        Lancamento.valor_previsto.between(valor_min, valor_max),  # type: ignore[attr-defined]
        or_(
            Lancamento.observacao.is_(None),
            ~Lancamento.observacao.ilike('%"legacy_id_venda"%')
        )
    )

    if conta_id > 0:
        query = query.where(or_(Lancamento.conta_id == conta_id, Lancamento.conta_id.is_(None)))  # type: ignore[attr-defined]

    if centro_custo_id:
        query = query.where(Lancamento.centro_custo_id == centro_custo_id)
    if previstos_indisponiveis_ids:
        ids_validos = [int(item) for item in previstos_indisponiveis_ids if int(item or 0) > 0]
        if ids_validos:
            query = query.where(~Lancamento.id.in_(ids_validos))

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
    gap_detectado: bool = False
    gap_data_ultimo: Optional[str] = None
    gap_data_inicio_arquivo: Optional[str] = None
    gap_dias: int = 0
    saldo_ofx: Optional[float] = None
    saldo_ofx_data: Optional[str] = None


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
    limite: int = Query(200, ge=1, le=2000),
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
        Lancamento.status.in_(STATUS_ABERTOS),  # type: ignore[attr-defined]
        Lancamento.data_pagamento.is_(None),  # type: ignore[attr-defined]
        or_(Lancamento.conciliado == False, Lancamento.conciliado.is_(None)),  # type: ignore[attr-defined]
        or_(
            Lancamento.observacao.is_(None),
            ~Lancamento.observacao.ilike('%"legacy_id_venda"%')
        )
    ]
    if conta_id:
        filtros.append(or_(Lancamento.conta_id == conta_id, Lancamento.conta_id.is_(None)))  # type: ignore[attr-defined]
    if centro_custo_id:
        filtros.append(Lancamento.centro_custo_id == centro_custo_id)
    if not incluir_futuros:
        filtros.append(Lancamento.data_vencimento <= data_ref)

    candidatos = list(db.exec(
        select(Lancamento)
        .where(*filtros)
        .order_by(Lancamento.data_vencimento.asc())  # type: ignore[attr-defined]
        .limit(limite)
    ).all())

    entidade_ids = {int(item.entidade_id) for item in candidatos if item.entidade_id}
    centro_ids = {int(item.centro_custo_id) for item in candidatos if item.centro_custo_id}

    entidades_por_id: Dict[int, Entidade] = {}
    centros_por_id: Dict[int, CentroCusto] = {}
    if entidade_ids:
        entidades_por_id = {
            int(ent.id): ent
            for ent in db.exec(select(Entidade).where(Entidade.id.in_(entidade_ids))).all()  # type: ignore
            if ent.id is not None
        }
    if centro_ids:
        centros_por_id = {
            int(cc.id): cc
            for cc in db.exec(select(CentroCusto).where(CentroCusto.id.in_(centro_ids))).all()  # type: ignore
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
            id=int(item.id or 0),
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
    forcar_importacao: bool = Query(False),
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
        
        # Validar conta/agência do OFX contra a selecionada
        if not modo_cartao and conta and lancamentos_raw:
            primeiro = lancamentos_raw[0]
            ofx_branch = primeiro.get("ofx_agencia")
            ofx_acct = primeiro.get("ofx_conta_numero")
            
            def clean_num(s):
                return re.sub(r"\D+", "", str(s or ""))

            target_agencia = clean_num(conta.agencia)
            target_conta = clean_num(conta.conta_numero)
            
            ofx_branch_clean = clean_num(ofx_branch)
            ofx_acct_clean = clean_num(ofx_acct)

            mismatch_agencia = target_agencia and ofx_branch_clean and target_agencia != ofx_branch_clean
            mismatch_conta = target_conta and ofx_acct_clean and target_conta != ofx_acct_clean

            if (mismatch_agencia or mismatch_conta) and not forcar_importacao:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "CONTA_DIVERGENTE",
                        "message": f"O arquivo OFX pertence à agência {ofx_branch or '(N/A)'} e conta {ofx_acct or '(N/A)'}, mas a conta selecionada é {conta.nome} (Ag: {conta.agencia or 'N/A'}, Cc: {conta.conta_numero or 'N/A'}). Deseja continuar mesmo assim?",
                        "ofx_agencia": ofx_branch,
                        "ofx_conta": ofx_acct,
                        "conta_selecionada_nome": conta.nome,
                        "conta_selecionada_agencia": conta.agencia,
                        "conta_selecionada_numero": conta.conta_numero
                    }
                )

        
        # Calcular gap de datas
        gap_detectado = False
        gap_data_ultimo = None
        gap_data_inicio_arquivo = None
        gap_dias = 0

        if not modo_cartao and conta_db_id > 0 and lancamentos_raw:
            ultimo_mov = db.exec(
                select(Movimento)
                .where(Movimento.is_deleted == False, Movimento.conta_id == conta_db_id, Movimento.empresa_id == empresa_id)
                .order_by(Movimento.data.desc(), Movimento.id.desc())
            ).first()
            if ultimo_mov:
                datas_arquivo = [l["data"] for l in lancamentos_raw if l.get("data")]
                if datas_arquivo:
                    data_min_arquivo = min(datas_arquivo)
                    if isinstance(data_min_arquivo, datetime):
                        data_min_arquivo = data_min_arquivo.date()
                    elif isinstance(data_min_arquivo, str):
                        from app.services.importacao_bancaria_service import parsear_data
                        data_min_arquivo = parsear_data(data_min_arquivo)
                    
                    if data_min_arquivo and data_min_arquivo > ultimo_mov.data + timedelta(days=2):
                        gap_detectado = True
                        gap_data_ultimo = ultimo_mov.data.isoformat()
                        gap_data_inicio_arquivo = data_min_arquivo.isoformat()
                        gap_dias = (data_min_arquivo - ultimo_mov.data).days - 1

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

                        if len(nome_norm) >= 8 and len(nome_ref) >= 8 and (nome_norm in nome_ref or nome_ref in nome_norm):
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
            hash_item = gerar_import_hash(
                lanc_raw,
                conta_id=conta_db_id,
                cartao_id=(int(cartao.id) if cartao and cartao.id is not None else None),
            )
            lanc_raw["import_hash"] = hash_item

        # Otimização N+1: Buscar todos os movimentos existentes em lote
        hashes = [l["import_hash"] for l in lancamentos_raw if l.get("import_hash")]
        existing_movs = {}
        if hashes:
            movs_db = db.exec(
                select(Movimento).where(
                    Movimento.empresa_id == empresa_id,
                    Movimento.import_hash.in_(hashes)
                )
            ).all()
            existing_movs = {m.import_hash: m for m in movs_db}

        # Segunda passada para persistência
        from app.services.auditor_anomalia_service import AuditorAnomaliaService
        auditor = AuditorAnomaliaService(db)
        for lanc_raw in lancamentos_raw:
            hash_item = lanc_raw["import_hash"]
            existing_mov = existing_movs.get(hash_item)
            
            if not existing_mov:
                from app.services.importacao_bancaria_service import parsear_data
                data_mov = parsear_data(lanc_raw["data_pagamento"]) if lanc_raw.get("data_pagamento") else parsear_data(lanc_raw.get("data") or "")
                existing_mov = Movimento(
                    descricao=lanc_raw["descricao"],
                    valor=Decimal(str(lanc_raw["valor"])),
                    tipo=lanc_raw["tipo"],
                    data=data_mov or date.today(),
                    import_hash=hash_item,
                    status="ABERTO",
                    origem="OFX" if not modo_cartao else "CARTAO",
                    empresa_id=empresa_id,
                    conta_id=conta_db_id,
                )
                db.add(existing_mov)
                db.flush()
                # Atualiza o cache local para caso haja hashes duplicados dentro do próprio arquivo
                existing_movs[hash_item] = existing_mov
                auditor.analisar_movimento(existing_mov)
            else:
                if getattr(existing_mov, "is_deleted", False):
                    existing_mov.is_deleted = False
                    existing_mov.status = "ABERTO"
                    db.add(existing_mov)
                    db.flush()
            
            lanc_raw["movimento_id"] = existing_mov.id

        db.commit()



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
        previstos_reservados: set[int] = set()
        historico_por_tipo = _agrupar_historico_por_tipo(historico_empresa)
        cache_relacionamentos: Dict[str, tuple[Optional[tuple[Lancamento, int, str]], List[tuple[Lancamento, int, str]]]] = {}

        # Phase 1: Determine duplicates and info saldos first
        info_ou_duplicatas = set()
        hashes_vistos_pre = set()
        ocorrencias_por_chave_conferencia_pre = {}
        existentes_por_chave_conferencia_pre = {}

        for i, lanc_raw in enumerate(lancamentos_raw):
            if _eh_movimento_saldo_informativo(lanc_raw):
                info_ou_duplicatas.add(i)
                continue

            permitir_importacao_por_quantidade = False
            chave_conferencia = _montar_chave_conferencia_quantidade(lanc_raw, conta_db_id)
            if chave_conferencia:
                ocorrencia_atual = ocorrencias_por_chave_conferencia_pre.get(chave_conferencia, 0) + 1
                ocorrencias_por_chave_conferencia_pre[chave_conferencia] = ocorrencia_atual

                existentes = existentes_por_chave_conferencia_pre.get(chave_conferencia)
                if existentes is None:
                    existentes = _contar_existentes_por_chave_conferencia(db, empresa_id, chave_conferencia)
                    existentes_por_chave_conferencia_pre[chave_conferencia] = existentes

                if ocorrencia_atual > existentes:
                    permitir_importacao_por_quantidade = True

            if not permitir_importacao_por_quantidade:
                if duplicatas_in_file_por_hash.get(str(lanc_raw.get("import_hash") or ""), 0) > 1:
                    pass
                elif lanc_raw["import_hash"] in hashes_vistos_pre:
                    info_ou_duplicatas.add(i)
                    continue

                import_hash_atual = str(lanc_raw.get("import_hash") or "")
                duplicata = duplicatas_por_hash.get(import_hash_atual)
                if not duplicata:
                    duplicata = verificar_duplicata_ofx_por_fallback(
                        db,
                        lanc_raw,
                        empresa_id,
                        conta_id=conta_db_id,
                        ofx_bank_id=lanc_raw.get("ofx_bank_id"),
                    )
                if not duplicata and not modo_cartao:
                    duplicata, _ = _buscar_duplicata_historica(
                        db,
                        lanc_raw,
                        empresa_id,
                        conta_db_id,
                        lanc_raw.get("ofx_bank_id"),
                    )
                if duplicata:
                    info_ou_duplicatas.add(i)
                    continue

            hashes_vistos_pre.add(lanc_raw["import_hash"])

        # Phase 2: Fetch all candidate matches for non-duplicates and run greedy matching
        candidates_by_row = {}
        for i, lanc_raw in enumerate(lancamentos_raw):
            if i in info_ou_duplicatas:
                continue

            melhor_previsto, melhores_atrasados = _buscar_melhores_relacionamentos(
                db,
                lanc_raw,
                empresa_id,
                centro_custo_id_resolvido,
                atrasados_indisponiveis_ids=None,
                previstos_indisponiveis_ids=None,
            )
            candidates_by_row[i] = (melhor_previsto, melhores_atrasados)

        # Greedy match resolution
        # Collect all candidate previsto matches: list of (ofx_index, previsto_lancamento, score, motivo)
        all_previsto_matches = []
        for i, (melhor_previsto, _) in candidates_by_row.items():
            if melhor_previsto:
                lanc_previsto, score, motivo = melhor_previsto
                all_previsto_matches.append((i, lanc_previsto, score, motivo))

        # Sort previsto matches by score descending
        all_previsto_matches.sort(key=lambda x: x[2], reverse=True)

        assigned_previsto_ids = set()
        row_assigned_previsto = {}  # ofx_index -> (lanc_previsto, score, motivo)
        for i, lanc_previsto, score, motivo in all_previsto_matches:
            prev_id = int(lanc_previsto.id or 0)
            if i not in row_assigned_previsto and prev_id not in assigned_previsto_ids:
                row_assigned_previsto[i] = (lanc_previsto, score, motivo)
                assigned_previsto_ids.add(prev_id)

        # Collect all candidate atrasado matches: list of (ofx_index, atrasado_lancamento, score, motivo)
        all_atrasado_matches = []
        for i, (_, melhores_atrasados) in candidates_by_row.items():
            for lanc_atrasado, score, motivo in melhores_atrasados:
                all_atrasado_matches.append((i, lanc_atrasado, score, motivo))

        # Sort atrasado matches by score descending
        all_atrasado_matches.sort(key=lambda x: x[2], reverse=True)

        assigned_atrasado_ids = set()
        row_assigned_atrasados = {}  # ofx_index -> list of (lanc_atrasado, score, motivo)
        for i, lanc_atrasado, score, motivo in all_atrasado_matches:
            atr_id = int(lanc_atrasado.id or 0)
            if atr_id not in assigned_atrasado_ids:
                row_assigned_atrasados.setdefault(i, [])
                if len(row_assigned_atrasados[i]) < 15:
                    row_assigned_atrasados[i].append((lanc_atrasado, score, motivo))
                    assigned_atrasado_ids.add(atr_id)

        # Phase 3: Final assembly loop
        for i, lanc_raw in enumerate(lancamentos_raw):

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
                fitid_atual = str(lanc_raw.get("fitid") or "")
                desc_raw_search = str(lanc_raw.get("descricao_original_ofx") or lanc_raw.get("descricao") or "").strip()
                data_search = lanc_raw.get("data")
                valor_search = Decimal(str(lanc_raw.get("valor") or "0"))
                tipo_search = str(lanc_raw.get("tipo") or "")

                mov = None
                # 1. Busca Movimento por FITID (se fitid existir)
                if fitid_atual:
                    mov = db.exec(
                        select(Movimento).where(
                            Movimento.is_deleted == False,
                            Movimento.empresa_id == empresa_id,
                            Movimento.conta_id == conta_db_id,
                            Movimento.fitid == fitid_atual
                        )
                    ).first()

                # 2. Busca Movimento por import_hash
                if not mov and import_hash_atual:
                    mov = db.exec(
                        select(Movimento).where(
                            Movimento.is_deleted == False,
                            Movimento.empresa_id == empresa_id,
                            Movimento.import_hash == import_hash_atual
                        )
                    ).first()

                # 3. Busca Movimento por combinação de conta, data, valor e descrição (suporte a histórico antigo)
                if not mov and desc_raw_search and data_search:
                    mov = db.exec(
                        select(Movimento).where(
                            Movimento.is_deleted == False,
                            Movimento.empresa_id == empresa_id,
                            Movimento.conta_id == conta_db_id,
                            Movimento.data == data_search,
                            Movimento.valor == valor_search,
                            Movimento.tipo == tipo_search,
                            or_(
                                Movimento.descricao == desc_raw_search,
                                Movimento.descricao_original == desc_raw_search
                            )
                        )
                    ).first()

                duplicata = None
                if mov:
                    baixa_rel = db.exec(
                        select(Baixa).where(
                            Baixa.movimento_id == mov.id,
                            Baixa.is_deleted == False
                        )
                    ).first()
                    if baixa_rel:
                        duplicata = db.get(Lancamento, baixa_rel.lancamento_id)

                    duplicatas += 1
                    lanc_raw["sugestao_acao"] = "DESCARTAR"
                    lanc_raw["motivo_conciliacao"] = f"Movimento bancário já cadastrado em {mov.data.strftime('%d/%m/%Y')} (Status: {mov.status})."
                    lanc_raw["duplicata_resumo"] = DuplicataResumo(
                        descricao=mov.descricao,
                        data_pagamento=mov.data.isoformat(),
                        valor_pago=float(mov.valor),
                        origem=mov.origem,
                        motivo=f"Movimentação bancária já existente no extrato (ID #{mov.id})",
                    )
                    lancamentos_processados.append(lanc_raw)
                    continue

                if not duplicata:
                    duplicata = duplicatas_por_hash.get(import_hash_atual)

                if not duplicata:
                    duplicata = verificar_duplicata_ofx_por_fallback(
                        db,
                        lanc_raw,
                        empresa_id,
                        conta_id=conta_db_id,
                        ofx_bank_id=lanc_raw.get("ofx_bank_id"),
                    )
                duplicata_historica_motivo = None
                if not duplicata and not modo_cartao:
                    duplicata, duplicata_historica_motivo = _buscar_duplicata_historica(
                        db,
                        lanc_raw,
                        empresa_id,
                        conta_db_id,
                        lanc_raw.get("ofx_bank_id"),
                    )
                if duplicata:
                    duplicatas += 1
                    lanc_raw["duplicata_id"] = duplicata.id
                    lanc_raw["sugestao_acao"] = "DESCARTAR"
                    lanc_raw["motivo_conciliacao"] = duplicata_historica_motivo or "Movimento ja importado anteriormente para este banco."
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

            melhor_previsto = row_assigned_previsto.get(i)
            melhores_atrasados = candidates_by_row.get(i, (None, []))[1]

            if melhor_previsto:
                previstos += 1
                lanc_previsto, score_previsto, motivo_previsto = melhor_previsto
                previsto_id = int(lanc_previsto.id or 0)
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
                if previsto_id:
                    previstos_sugeridos.setdefault(previsto_id, 0)
                    previstos_sugeridos[previsto_id] += 1

            if melhores_atrasados:
                atrasados += 1
                best_atrasado = melhores_atrasados[0][0]
                lanc_raw["lancamentos_atrasados_ids"] = [best_atrasado.id] if best_atrasado.id is not None else []
                lanc_raw["lancamentos_atrasados_resumo"] = [
                    _build_resumo(lancamento, score, motivo, entidades_por_id, centros_custo_por_id)
                    for lancamento, score, motivo in melhores_atrasados
                ]
                for lancamento_atrasado, _, _ in melhores_atrasados:
                    atraso_id = int(lancamento_atrasado.id or 0)
                    if atraso_id:
                        atrasados_sugeridos.setdefault(atraso_id, 0)
                        atrasados_sugeridos[atraso_id] += 1
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

        ofx_saldo_val = None
        ofx_saldo_dt = None
        if lancamentos_raw:
            ofx_saldo_val = lancamentos_raw[0].get("ofx_saldo_arquivo")
            ofx_saldo_dt = lancamentos_raw[0].get("ofx_saldo_data")

        return ProcessarArquivoResponse(
            lancamentos=lancamentos_serializados,
            total_processado=len(lancamentos_raw),
            duplicatas_encontradas=duplicatas,
            lancamentos_previstos_encontrados=previstos,
            lancamentos_atrasados_encontrados=atrasados,
            gap_detectado=gap_detectado,
            gap_data_ultimo=gap_data_ultimo,
            gap_data_inicio_arquivo=gap_data_inicio_arquivo,
            gap_dias=gap_dias,
            saldo_ofx=ofx_saldo_val,
            saldo_ofx_data=ofx_saldo_dt,
        )

        

    except HTTPException:
        raise
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

    computed_date = date(base_year, month, dia)
    while computed_date.weekday() >= 5:
        computed_date += timedelta(days=1)
    return computed_date


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
    movimento_pago = or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))  # type: ignore[attr-defined]

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


def atualizar_lancamento_apos_baixas(db: Session, lancamento_id: int):
    lancamento = db.get(Lancamento, lancamento_id)
    if not lancamento:
        return
    
    baixas = db.exec(
        select(Baixa).where(
            Baixa.lancamento_id == lancamento_id,
            Baixa.is_deleted == False
        )
    ).all()
    
    if not baixas:
        lancamento.valor_pago = Decimal("0.00")
        lancamento.valor_juros = Decimal("0.00")
        lancamento.valor_multa = Decimal("0.00")
        lancamento.valor_desconto = Decimal("0.00")
        lancamento.data_pagamento = None
        lancamento.conciliado = False
        lancamento.status = "EM ABERTO"
    else:
        principal = sum(b.valor_pago for b in baixas if b.tipo_baixa == "PRINCIPAL")
        juros = sum(b.valor_pago for b in baixas if b.tipo_baixa == "JUROS")
        multa = sum(b.valor_pago for b in baixas if b.tipo_baixa == "MULTA")
        desconto = sum(b.valor_pago for b in baixas if b.tipo_baixa == "DESCONTO")
        
        net_paid = principal + juros + multa - desconto
        
        lancamento.valor_pago = net_paid
        lancamento.valor_juros = juros
        lancamento.valor_multa = multa
        lancamento.valor_desconto = desconto
        
        ultimas_datas = [b.data_baixa for b in baixas if b.data_baixa is not None]
        if ultimas_datas:
            lancamento.data_pagamento = max(ultimas_datas)

        total_coberto = principal + desconto
        saldo_restante = lancamento.valor_previsto - total_coberto
        if saldo_restante <= Decimal("0.01"):
            lancamento.status = "PAGO"
            lancamento.conciliado = True
        else:
            lancamento.status = "PARCIAL"
            lancamento.conciliado = True

    db.add(lancamento)
    db.flush()


class AlocacaoItem(BaseModel):
    lancamento_id: Optional[int] = None
    lancamento_temp_id: Optional[str] = None
    valor_alocado: Decimal
    tipo_baixa: str = "PRINCIPAL"  # PRINCIPAL, JUROS, MULTA, DESCONTO


class ConciliacaoMovimento(BaseModel):
    movimento_id: int
    alocacoes: List[AlocacaoItem]


class ConfirmarLancamentosRequest(BaseModel):
    lancamentos: Optional[List[Dict[str, Any]]] = None
    atualizar_lancamentos: Optional[List[Dict[str, Any]]] = None
    conciliacoes: Optional[List[ConciliacaoMovimento]] = None
    conta_id: Optional[int] = None
    cartao_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    modo_importacao: Optional[str] = None
    ignorar_divergencia: bool = False
    saldo_ofx: Optional[Decimal] = None
    saldo_ofx_data: Optional[date] = None
    filename: Optional[str] = None



@router.post(
    "/confirmar-lancamentos",
    dependencies=[Depends(require_permission("lancamentos:import"))],
)
def confirmar_lancamentos(
    request: ConfirmarLancamentosRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    import uuid
    from app.core.audit_context import set_audit_batch_id
    
    filename_str = request.filename or "extrato.ofx"
    clean_filename = filename_str.replace(":", "_").replace("/", "_")
    now_str = datetime.utcnow().strftime("%d/%m/%Y %H:%M")
    batch_id = f"OFX:{clean_filename}:{now_str}:{uuid.uuid4().hex[:6]}"
    
    set_audit_batch_id(batch_id)

    lancamentos_criados = 0

    lancamentos_atualizados = 0
    erros: List[str] = []
    
    conta_resolvida = None
    cartao_resolvido = None
    centro_custo_resolvido = None
    modo_cartao = str(request.modo_importacao or "").strip().upper() == "CARTAO" or bool(request.cartao_id)
    
    logger.info(
        "[OFX] Confirmacao iniciada empresa_id={} modo={} conta_id={} cartao_id={}",
        empresa_id,
        "CARTAO" if modo_cartao else "CONTA",
        request.conta_id,
        request.cartao_id,
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
    divergencia_saldo_ofx_antes: Optional[Dict[str, Any]] = None
    divergencia_saldo_ofx: Optional[Dict[str, Any]] = None

    # Se não for cartão e tivermos informações do saldo do extrato na requisição, calcular divergência antes
    if not modo_cartao:
        if request.saldo_ofx is not None:
            saldo_ofx_referencia = request.saldo_ofx
            data_ofx_referencia = request.saldo_ofx_data
        
        if saldo_ofx_referencia is not None and data_ofx_referencia is not None and conta_resolvida_id is not None:
            divergencia_saldo_ofx_antes = _calcular_divergencia_saldo_ofx(
                db,
                empresa_id,
                conta_resolvida_id,
                saldo_ofx_referencia,
                data_ofx_referencia,
            )

    if not modo_cartao and request.conciliacoes is not None:
        # --- NOVO FLUXO: CONCILIAÇÃO BASEADA EM SETTLEMENT/BAIXA ---
        temp_id_to_id = {}
        
        # 1. Processar atualizações de lançamentos existentes
        if request.atualizar_lancamentos:
            for upd in request.atualizar_lancamentos:
                lanc_id = upd.get("id")
                if lanc_id:
                    lanc_existente = db.get(Lancamento, lanc_id)
                    if lanc_existente and not lanc_existente.is_deleted and int(lanc_existente.empresa_id) == int(empresa_id):
                        if "valor_previsto" in upd:
                            lanc_existente.valor_previsto = Decimal(str(upd["valor_previsto"]))
                        db.add(lanc_existente)
            db.flush()

        # 2. Criar novos lançamentos solicitados na conciliação
        if request.lancamentos:
            from app.services.importacao_bancaria_service import parsear_data
            for lanc_data in request.lancamentos:
                try:
                    # Resolvendo ou criando entidade (interessado) se necessário
                    entidade_id = lanc_data.get("entidade_id")
                    if not entidade_id:
                        nome_entidade_bruto = lanc_data.get("interessado_digitado") or lanc_data.get("interessado_sugerido") or lanc_data.get("razao_social")
                        if nome_entidade_bruto:
                            nome_entidade = str(nome_entidade_bruto).strip()
                            # Limpa CPF/CNPJ se embutido
                            cpf_cnpj_match = re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})|(\b\d{11,14}\b)", nome_entidade)
                            cpf_cnpj_val = None
                            if cpf_cnpj_match:
                                cpf_cnpj_val = re.sub(r"\D", "", cpf_cnpj_match.group(0))
                                nome_entidade = re.sub(r"(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})|(\b\d{11,14}\b)", "", nome_entidade).strip()
                            nome_entidade = re.sub(r"\s+", " ", nome_entidade).strip()
                            if nome_entidade:
                                entidade_existente = db.exec(
                                    select(Entidade).where(
                                        Entidade.empresa_id == empresa_id,
                                        func.lower(Entidade.nome) == func.lower(nome_entidade)
                                    )
                                ).first()
                                if entidade_existente:
                                    entidade_id = entidade_existente.id
                                else:
                                    nova_entidade = Entidade(
                                        nome=nome_entidade,
                                        tipo="AMBOS",
                                        tipo_pessoa="PJ" if (cpf_cnpj_val and len(cpf_cnpj_val) == 14) else "PF",
                                        cpf_cnpj=cpf_cnpj_val,
                                        status="ATIVO",
                                        empresa_id=empresa_id
                                    )
                                    db.add(nova_entidade)
                                    db.flush()
                                    entidade_id = nova_entidade.id

                    import_hash = lanc_data.get("import_hash") or None
                    temp_id = lanc_data.get("temp_id")

                    lanc_existente = None
                    if import_hash:
                        lanc_existente = _buscar_lancamento_por_import_hash(db, empresa_id, import_hash)

                    if lanc_existente:
                        logger.info(f"[OFX] Lancamento com import_hash '{import_hash}' ja existe. Reusando ID {lanc_existente.id}.")
                        if temp_id:
                            temp_id_to_id[str(temp_id)] = lanc_existente.id
                        continue

                    data_compra_base = parsear_data(lanc_data.get("data") or "") or date.today()
                    data_vencimento = parsear_data(lanc_data["data_vencimento"]) if lanc_data.get("data_vencimento") else data_compra_base

                    cat_id_raw = lanc_data.get("plano_contas_id")
                    if not cat_id_raw or int(cat_id_raw) <= 0:
                        erros.append(f"O lançamento '{lanc_data.get('descricao')}' precisa de uma Categoria/Plano de Contas selecionado.")
                        continue
                    plano_contas_id_val = int(cat_id_raw)

                    val_efetivo = Decimal(str(lanc_data.get("valor_pago") or lanc_data.get("valor_previsto") or lanc_data["valor"]))
                    novo_lancamento = Lancamento(
                        descricao=str(lanc_data["descricao"]),
                        tipo=str(lanc_data["tipo"]),
                        status="PAGO",
                        origem=str(lanc_data.get("origem") or "OFX"),
                        valor_previsto=val_efetivo,
                        valor_pago=val_efetivo,
                        data_vencimento=data_vencimento,
                        data_pagamento=data_vencimento,
                        data_competencia=data_compra_base,
                        empresa_id=empresa_id,
                        plano_contas_id=plano_contas_id_val,
                        entidade_id=int(entidade_id) if entidade_id else None,
                        conta_id=conta_resolvida_id or request.conta_id,
                        centro_custo_id=centro_custo_resolvido,
                        import_hash=import_hash,
                        conciliado=True,
                    )
                    db.add(novo_lancamento)
                    db.flush()

                    if temp_id:
                        temp_id_to_id[str(temp_id)] = novo_lancamento.id

                    lancamentos_criados += 1
                except Exception as exc:
                    logger.error(f"Erro ao confirmar lancamento no fluxo novo: {exc}")
                    db.rollback()
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Erro ao criar lançamento '{lanc_data.get('descricao')}': {exc}"
                    )
        for conc in request.conciliacoes:
            try:
                movimento = db.exec(
                    select(Movimento)
                    .where(Movimento.id == conc.movimento_id, Movimento.empresa_id == empresa_id)
                    .with_for_update()
                ).first()

                if not movimento:
                    erros.append(f"Movimento bancário ID {conc.movimento_id} não encontrado.")
                    continue

                if movimento.status == "CONCILIADO":
                    erros.append(f"Movimento '{movimento.descricao}' já conciliado.")
                    continue

                if not conc.alocacoes:
                    movimento.status = "CONCILIADO"
                    db.add(movimento)
                    lancamentos_atualizados += 1
                    continue

                soma_alocacoes = Decimal("0.00")
                for aloc in conc.alocacoes:
                    val = aloc.valor_alocado
                    if aloc.tipo_baixa in ("PRINCIPAL", "JUROS", "MULTA"):
                        soma_alocacoes += val
                    elif aloc.tipo_baixa == "DESCONTO":
                        soma_alocacoes -= val
                    else:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Tipo de baixa inválido: {aloc.tipo_baixa}"
                        )

                if abs(soma_alocacoes - abs(movimento.valor)) > Decimal("0.01"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "message": f"Divergência matemática detectada: a soma das alocações (R$ {soma_alocacoes}) difere do valor do movimento bancário (R$ {abs(movimento.valor)}).",
                            "movimento_id": movimento.id,
                        }
                    )

                for aloc in conc.alocacoes:
                    aloc_lanc_id = aloc.lancamento_id
                    if not aloc_lanc_id and aloc.lancamento_temp_id:
                        aloc_lanc_id = temp_id_to_id.get(str(aloc.lancamento_temp_id))

                    if not aloc_lanc_id:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Allocation missing launch ID and temp ID lookup failed."
                        )

                    lancamento = db.get(Lancamento, aloc_lanc_id)
                    if not lancamento or lancamento.is_deleted or int(lancamento.empresa_id) != int(empresa_id):
                        raise HTTPException(
                            status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Lançamento ID {aloc_lanc_id} não encontrado."
                        )

                    nova_baixa = Baixa(
                        lancamento_id=aloc_lanc_id,
                        movimento_id=movimento.id,
                        valor_pago=aloc.valor_alocado,
                        data_baixa=movimento.data,
                        tipo_baixa=aloc.tipo_baixa,
                        empresa_id=empresa_id,
                    )
                    db.add(nova_baixa)
                    db.flush()

                    if conta_resolvida:
                        lancamento.conta_id = conta_resolvida.id
                    if centro_custo_resolvido:
                        lancamento.centro_custo_id = centro_custo_resolvido
                    lancamento.import_hash = movimento.import_hash
                    lancamento.movimento_uid = movimento.import_hash
                    
                    atualizar_lancamento_apos_baixas(db, lancamento.id)
                    lancamento.status = "PAGO"
                    lancamento.data_pagamento = movimento.data
                    lancamento.conciliado = True
                    db.add(lancamento)

                movimento.status = "CONCILIADO"
                db.add(movimento)
                lancamentos_atualizados += 1

            except HTTPException as exc:
                db.rollback()
                raise exc
            except Exception as exc:
                logger.error(f"Erro ao conciliar movimento: {exc}")
                erros.append(str(exc))
                
    else:
        # --- FLUXO LEGADO/CARTÃO ---
        if not request.lancamentos:
            return {
                "sucesso": True,
                "lancamentos_criados": 0,
                "lancamentos_atualizados": 0,
                "erros": erros,
            }

        import uuid
        previsto_counts = {}
        for lanc_data in request.lancamentos:
            sugestao_acao_raw = str(lanc_data.get("sugestao_acao") or "").strip().upper()
            possui_previsto = bool(lanc_data.get("lancamento_previsto_id"))
            if not sugestao_acao_raw:
                acao_temp = "BAIXAR_PREVISTO" if possui_previsto else "CRIAR_NOVO"
            else:
                acao_temp = sugestao_acao_raw

            if acao_temp == "BAIXAR_PREVISTO" and lanc_data.get("lancamento_previsto_id"):
                p_id = int(lanc_data["lancamento_previsto_id"])
                previsto_counts[p_id] = previsto_counts.get(p_id, 0) + 1

        previsto_parcelamentos = {
            p_id: f"split-previsto-{uuid.uuid4()}"
            for p_id, count in previsto_counts.items() if count > 1
        }
        previstos_seen = set()

        previstos_compensados_no_lote = set()
        atrasados_compensados_no_lote = set()
        import_hashes_processados = set()

        for lanc_data in request.lancamentos:
            try:
                sugestao_acao_raw = str(lanc_data.get("sugestao_acao") or "").strip().upper()
                sugestao_confirmada = bool(lanc_data.get("sugestao_confirmada")) if "sugestao_confirmada" in lanc_data else True
                possui_previsto = bool(lanc_data.get("lancamento_previsto_id"))
                possui_atrasados = bool(lanc_data.get("lancamentos_atrasados_relacionados"))

                if not sugestao_acao_raw:
                    acao = "BAIXAR_PREVISTO" if possui_previsto else "RELACIONAR_ATRASADOS" if possui_atrasados else "CRIAR_NOVO"
                else:
                    acao = sugestao_acao_raw

                if acao in {"IGNORAR_DUPLICATA", "DESCARTAR"}:
                    continue
                if acao in {"BAIXAR_PREVISTO", "RELACIONAR_ATRASADOS"} and not sugestao_confirmada:
                    continue

                import_hash = str(lanc_data.get("import_hash") or "").strip()
                if import_hash and import_hash in import_hashes_processados:
                    continue
                if _buscar_lancamento_por_import_hash(db, empresa_id, import_hash or None):
                    continue
                if import_hash:
                    import_hashes_processados.add(import_hash)

                # Resolvendo ou criando entidade (interessado) se necessario
                entidade_id = lanc_data.get("entidade_id")
                if not entidade_id:
                    nome_entidade_bruto = lanc_data.get("interessado_digitado") or lanc_data.get("interessado_sugerido") or lanc_data.get("razao_social")
                    if nome_entidade_bruto:
                        nome_entidade = str(nome_entidade_bruto).strip()
                        # Limpa CPF/CNPJ se embutido
                        cpf_cnpj_match = re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})|(\b\d{11,14}\b)", nome_entidade)
                        cpf_cnpj_val = None
                        if cpf_cnpj_match:
                            cpf_cnpj_val = re.sub(r"\D", "", cpf_cnpj_match.group(0))
                            nome_entidade = re.sub(r"(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})|(\b\d{11,14}\b)", "", nome_entidade).strip()
                        nome_entidade = re.sub(r"\s+", " ", nome_entidade).strip()
                        if nome_entidade:
                            entidade_existente = db.exec(
                                select(Entidade).where(
                                    Entidade.empresa_id == empresa_id,
                                    func.lower(Entidade.nome) == func.lower(nome_entidade)
                                )
                            ).first()
                            if entidade_existente:
                                entidade_id = entidade_existente.id
                            else:
                                nova_entidade = Entidade(
                                    nome=nome_entidade,
                                    tipo="AMBOS",
                                    tipo_pessoa="PJ" if (cpf_cnpj_val and len(cpf_cnpj_val) == 14) else "PF",
                                    cpf_cnpj=cpf_cnpj_val,
                                    status="ATIVO",
                                    empresa_id=empresa_id
                                )
                                db.add(nova_entidade)
                                db.flush()
                                entidade_id = nova_entidade.id
                lanc_data["entidade_id"] = entidade_id

                from app.services.importacao_bancaria_service import parsear_data

                if acao == "BAIXAR_PREVISTO" and lanc_data.get("lancamento_previsto_id"):
                    previsto_id = int(lanc_data["lancamento_previsto_id"])
                    lanc_existente = db.get(Lancamento, previsto_id)
                    if lanc_existente and not lanc_existente.is_deleted and int(lanc_existente.empresa_id) == int(empresa_id):
                        data_pagamento = parsear_data(lanc_data["data_pagamento"]) if lanc_data.get("data_pagamento") else parsear_data(lanc_data.get("data") or "")
                        valor_confirmacao = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))

                        # Caso o previsto seja rateado/splitado no mesmo lote
                        if previsto_id in previsto_parcelamentos:
                            parcel_id = previsto_parcelamentos[previsto_id]
                            if previsto_id not in previstos_seen:
                                previstos_seen.add(previsto_id)
                                lanc_existente.data_pagamento = data_pagamento
                                lanc_existente.status = "PAGO"
                                lanc_existente.conciliado = True
                                lanc_existente.valor_previsto = valor_confirmacao
                                lanc_existente.valor_pago = valor_confirmacao
                                lanc_existente.id_parcelamento = parcel_id
                                if lanc_data.get("plano_contas_id"):
                                    lanc_existente.plano_contas_id = int(lanc_data["plano_contas_id"])
                                if lanc_data.get("entidade_id"):
                                    lanc_existente.entidade_id = int(lanc_data["entidade_id"])
                                if conta_resolvida:
                                    lanc_existente.conta_id = conta_resolvida.id
                                if import_hash:
                                    lanc_existente.import_hash = import_hash
                                    lanc_existente.movimento_uid = import_hash
                                db.add(lanc_existente)
                                lancamentos_atualizados += 1
                            else:
                                novo_split = Lancamento(
                                    descricao=lanc_existente.descricao,
                                    tipo=lanc_existente.tipo,
                                    status="PAGO",
                                    origem=lanc_existente.origem or "OFX",
                                    valor_previsto=valor_confirmacao,
                                    valor_pago=valor_confirmacao,
                                    data_vencimento=lanc_existente.data_vencimento,
                                    data_pagamento=data_pagamento,
                                    data_competencia=lanc_existente.data_competencia,
                                    empresa_id=empresa_id,
                                    plano_contas_id=int(lanc_data.get("plano_contas_id") or lanc_existente.plano_contas_id or 1),
                                    entidade_id=int(lanc_data.get("entidade_id") or lanc_existente.entidade_id or 0) or None,
                                    conta_id=conta_resolvida.id if conta_resolvida else lanc_existente.conta_id,
                                    centro_custo_id=lanc_existente.centro_custo_id,
                                    import_hash=import_hash or None,
                                    movimento_uid=import_hash or None,
                                    conciliado=True,
                                    id_parcelamento=parcel_id,
                                )
                                db.add(novo_split)
                                lancamentos_criados += 1
                            continue
                        else:
                            lanc_existente.data_pagamento = data_pagamento
                            lanc_existente.status = "PAGO"
                            lanc_existente.conciliado = True
                            lanc_existente.valor_pago = valor_confirmacao
                            if lanc_data.get("plano_contas_id"):
                                lanc_existente.plano_contas_id = int(lanc_data["plano_contas_id"])
                            if lanc_data.get("entidade_id"):
                                lanc_existente.entidade_id = int(lanc_data["entidade_id"])
                            if conta_resolvida:
                                lanc_existente.conta_id = conta_resolvida.id
                            if import_hash:
                                lanc_existente.import_hash = import_hash
                                lanc_existente.movimento_uid = import_hash
                            db.add(lanc_existente)
                            lancamentos_atualizados += 1
                            continue


                plano_contas_id = lanc_data.get("plano_contas_id")
                data_pagamento = parsear_data(lanc_data["data_pagamento"]) if lanc_data.get("data_pagamento") else parsear_data(lanc_data.get("data") or "")
                data_compra_base = parsear_data(lanc_data.get("data") or "") or date.today()
                data_vencimento = parsear_data(lanc_data["data_vencimento"]) if lanc_data.get("data_vencimento") else data_compra_base
                data_pagamento = data_pagamento or data_vencimento

                status_novo = "PAGO"
                origem_nova = str(lanc_data.get("origem") or "WEB")
                valor_pago_novo = Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"]))
                conta_nova_id = (conta_resolvida.id if conta_resolvida else request.conta_id)
                cartao_novo_id = None

                if modo_cartao and cartao_resolvido:
                    status_novo = "EM ABERTO"
                    origem_nova = "OFX_FATURA_CARTAO"
                    data_vencimento = _compute_cartao_vencimento(data_compra_base, cartao_resolvido)
                    data_pagamento = None
                    valor_pago_novo = Decimal("0.00")
                    conta_nova_id = int(cartao_resolvido.conta_id) if cartao_resolvido.conta_id else None
                    cartao_novo_id = int(cartao_resolvido.id)

                if not plano_contas_id or int(plano_contas_id) <= 0:
                    erros.append(f"O lançamento '{lanc_data.get('descricao')}' precisa de uma Categoria/Plano de Contas selecionado.")
                    continue

                novo_lancamento = Lancamento(
                    descricao=str(lanc_data["descricao"]),
                    tipo=str(lanc_data["tipo"]),
                    status=status_novo,
                    origem=origem_nova,
                    valor_previsto=Decimal(str(lanc_data.get("valor_previsto") or lanc_data["valor"])),
                    valor_pago=valor_pago_novo,
                    data_vencimento=data_vencimento,
                    data_pagamento=data_pagamento,
                    data_competencia=data_compra_base,
                    empresa_id=empresa_id,
                    plano_contas_id=int(plano_contas_id),
                    entidade_id=int(entidade_id) if entidade_id else None,
                    conta_id=conta_nova_id,
                    cartao_id=cartao_novo_id,
                    centro_custo_id=centro_custo_resolvido,
                    import_hash=import_hash or None,
                    conciliado=not modo_cartao,
                )
                db.add(novo_lancamento)
                lancamentos_criados += 1
            except Exception as exc:
                logger.error(f"Erro ao confirmar lancamento no fluxo legado: {exc}")
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
            if not request.ignorar_divergencia and abs_divergencia_depois > abs_divergencia_antes + Decimal("0.01"):
                mensagem_erro = "Aviso: a divergência de saldo aumentou após a conciliação."
                try:
                    deletados = db.exec(
                        select(Lancamento).where(
                            Lancamento.conta_id == conta_resolvida_id,
                            Lancamento.is_deleted == True,
                            Lancamento.empresa_id == empresa_id
                        ).order_by(Lancamento.deleted_at.desc()).limit(3)
                    ).all()
                    if deletados:
                        linhas_deletadas = [
                            f"'{d.descricao}' (ID #{d.id}, R$ {d.valor_previsto or d.valor_pago})"
                            for d in deletados
                        ]
                        mensagem_erro += f" Lançamento(s) excluído(s) recentemente nesta conta: {', '.join(linhas_deletadas)}."
                except Exception as ex_diag:
                    logger.error("[OFX] Erro ao buscar diagnóstico de saldos: {}", ex_diag)
                
                logger.warning(
                    "[OFX] {} conta_id={} empresa_id={} antes={} depois={}",
                    mensagem_erro,
                    conta_resolvida_id,
                    empresa_id,
                    divergencia_saldo_ofx_antes,
                    divergencia_saldo_ofx,
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[OFX] Falha ao calcular divergencia de saldo com referencia do extrato: {}", exc)

    db.commit()

    logger.info(
        "[OFX] Confirmacao finalizada empresa_id={} criados={} atualizados={} erros={}",
        empresa_id,
        lancamentos_criados,
        lancamentos_atualizados,
        len(erros),
    )


    from app.core.audit_context import set_audit_batch_id
    set_audit_batch_id(None)
    return {
        "sucesso": True,
        "lancamentos_criados": lancamentos_criados,
        "lancamentos_atualizados": lancamentos_atualizados,
        "erros": erros,
        "divergencia_saldo_ofx_antes": divergencia_saldo_ofx_antes,
        "divergencia_saldo_ofx": divergencia_saldo_ofx,
    }



@router.post(
    "/ofx/desconciliar/{lancamento_id}",
    dependencies=[Depends(require_permission("lancamentos:update"))],
)
def desconciliar_lancamento(
    lancamento_id: int,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    lancamento = db.get(Lancamento, lancamento_id)
    if not lancamento or lancamento.is_deleted or int(lancamento.empresa_id) != int(empresa_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lançamento não encontrado."
        )

    # Buscar todas as baixas ativas para este lançamento
    baixas = db.exec(
        select(Baixa).where(
            Baixa.lancamento_id == lancamento_id,
            Baixa.is_deleted == False,
            Baixa.empresa_id == empresa_id
        )
    ).all()

    if not baixas:
        if lancamento.conciliado or lancamento.status == "PAGO" or lancamento.data_pagamento is not None:
            lancamento.conciliado = False
            lancamento.data_pagamento = None
            lancamento.valor_pago = Decimal("0.00")
            lancamento.valor_juros = Decimal("0.00")
            lancamento.valor_multa = Decimal("0.00")
            lancamento.valor_desconto = Decimal("0.00")
            lancamento.status = "EM ABERTO"
            db.add(lancamento)

            # Reabrir movimento bancario se houver vinculo por import_hash ou movimento_uid
            hash_target = lancamento.import_hash or lancamento.movimento_uid
            if hash_target:
                movs = db.exec(
                    select(Movimento).where(
                        Movimento.empresa_id == empresa_id,
                        or_(Movimento.import_hash == hash_target, Movimento.movimento_uid == hash_target)
                    )
                ).all()
                for mov in movs:
                    if mov.status != "ABERTO":
                        mov.status = "ABERTO"
                        db.add(mov)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Este lançamento não possui conciliações ativas."
            )
    else:
        for baixa in baixas:
            baixa.is_deleted = True
            db.add(baixa)
            
            # Se houver Movimento vinculado, tratar desconciliação
            if baixa.movimento_id:
                mov = db.get(Movimento, baixa.movimento_id)
                if mov and int(mov.empresa_id) == int(empresa_id):
                    if mov.origem == "MANUAL":
                        db.delete(mov)
                    else:
                        mov.status = "ABERTO"
                        db.add(mov)
            elif lancamento.import_hash or lancamento.movimento_uid:
                hash_target = lancamento.import_hash or lancamento.movimento_uid
                movs = db.exec(
                    select(Movimento).where(
                        Movimento.empresa_id == empresa_id,
                        or_(Movimento.import_hash == hash_target, Movimento.movimento_uid == hash_target)
                    )
                ).all()
                for mov in movs:
                    if mov.status != "ABERTO":
                        mov.status = "ABERTO"
                        db.add(mov)

        db.flush()
        atualizar_lancamento_apos_baixas(db, lancamento_id)
    db.commit()
    return {"sucesso": True, "mensagem": "Lançamento desconciliado com sucesso."}


class SimularSaldoItem(BaseModel):
    tipo: str
    valor: Decimal

class SimularSaldoRequest(BaseModel):
    conta_id: int
    itens: List[SimularSaldoItem]

@router.post("/ofx/simular-saldo")
def simular_saldo_pos_importacao(
    request: SimularSaldoRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    conta = db.get(Conta, request.conta_id)
    if not conta or int(conta.empresa_id) != int(empresa_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conta bancária não encontrada."
        )

    saldo_atual = _calcular_saldo_atual_conta(db, empresa_id, request.conta_id)
    impacto_receitas = sum(item.valor for item in request.itens if item.tipo.upper() == "RECEITA")
    impacto_despesas = sum(item.valor for item in request.itens if item.tipo.upper() == "DESPESA")
    saldo_projetado = saldo_atual + impacto_receitas - impacto_despesas

    return {
        "conta_id": request.conta_id,
        "saldo_atual": float(saldo_atual),
        "impacto_receitas": float(impacto_receitas),
        "impacto_despesas": float(impacto_despesas),
        "saldo_projetado": float(saldo_projetado),
    }

