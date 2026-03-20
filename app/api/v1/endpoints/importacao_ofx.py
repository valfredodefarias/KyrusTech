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
from sqlmodel import Session, or_, select
from loguru import logger
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.services.integracao_ofx import processar_ofx
from app.services.importacao_bancaria_service import (
    verificar_duplicata,
    verificar_duplicata_ofx_por_fallback,
    buscar_lancamento_previsto_mesmo_dia_valor,
    buscar_lancamento_atrasado_mesmo_valor,
    criar_entidade_se_nao_existir,
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
STATUS_ABERTOS = ("PENDENTE", "EM ABERTO")
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
    descricao: str
    data_vencimento: str
    valor_previsto: float
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
    return interessado or normalizado


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

        return interessado_candidato

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

    alpha_tokens = [token for token in tokens if re.search(r"[A-Z]", token)]
    if len(alpha_tokens) < 2:
        return False

    ruido = sum(1 for token in alpha_tokens if token in TOKENS_RUIDO_INTERESSADO or token in TOKENS_GENERICOS_INTERESSADO)
    if ruido >= max(2, len(alpha_tokens) // 2):
        return False

    return True


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

    candidatos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == lancamento_ofx.get("tipo"),
        )
        .limit(500)
    ).all()

    interessado_norm = _normalizar_texto(lancamento_ofx.get("razao_social") or lancamento_ofx.get("interessado_sugerido"))
    for candidato in candidatos:
        if candidato.data_pagamento is None and str(candidato.status or "").upper() in STATUS_ABERTOS:
            continue

        data_candidata = candidato.data_pagamento or candidato.data_vencimento
        if not data_candidata or abs((data_candidata - data_base).days) > 2:
            continue

        valor_candidato = _valor_lancamento_existente(candidato)
        valor_exato = abs(valor_candidato - valor) <= Decimal("0.01")
        valor_compativel = _valor_dentro_tolerancia(valor_candidato, valor)
        if not valor_compativel:
            continue

        similaridade = _calcular_similaridade_texto(lancamento_ofx, candidato)
        contexto_candidato = _normalizar_texto(f"{candidato.descricao} {candidato.observacao or ''}")
        entidade_bate = bool(interessado_norm and interessado_norm in contexto_candidato)
        mesmo_dia = data_candidata == data_base
        if (mesmo_dia and valor_exato) or similaridade >= 0.68 or entidade_bate:
            motivo = "Mesmo valor, mesma conta e data muito proxima de um lancamento ja registrado"
            if similaridade >= 0.8:
                motivo += " com descricao muito parecida"
            return candidato, motivo

    return None, None


def _carregar_contexto_classificacao(
    db: Session,
    empresa_id: int,
) -> tuple[List[PlanoContas], Dict[int, Entidade], List[Lancamento]]:
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
    historico = list(db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
        )
        .limit(HISTORICO_SUGESTAO_LIMITE)
    ).all())
    return categorias, {int(entidade.id): entidade for entidade in entidades if entidade.id is not None}, historico


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
    candidatos = [item for item in historico if item.tipo == lancamento_ofx.get("tipo") and item.plano_contas_id]
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

        melhor_historico = _buscar_melhor_historico_deterministico(item, historico_empresa, entidades_por_id)
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
        partes.append("descricao com boa semelhanca")
    return ", ".join(partes)


def _score_candidate(origem: Dict, lancamento: Lancamento, kind: str) -> tuple[int, str]:
    valor = Decimal(str(origem["valor"]))
    valor_previsto = Decimal(str(lancamento.valor_previsto))
    valor_diferenca = abs(valor_previsto - valor)
    data_diferenca = (origem["data"] - lancamento.data_vencimento).days
    similaridade = _calcular_similaridade_texto(origem, lancamento)

    score = 55 if kind == "previsto" else 28
    score += max(0, 22 - int(valor_diferenca * 18))
    score += min(18, int(similaridade * 18))
    if kind == "previsto":
        score += 8
    else:
        score += max(0, 12 - abs(data_diferenca))

    return score, _build_match_reason(data_diferenca, valor_diferenca, similaridade, kind)


def _build_resumo(lancamento: Lancamento, score: int, motivo: str) -> RelacionamentoResumo:
    return RelacionamentoResumo(
        descricao=lancamento.descricao,
        data_vencimento=lancamento.data_vencimento.isoformat(),
        valor_previsto=float(lancamento.valor_previsto),
        score=score,
        motivo=motivo,
    )


def _buscar_melhores_relacionamentos(
    db: Session,
    lancamento_ofx: Dict,
    empresa_id: int,
    centro_custo_id: Optional[int],
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
    ranked_atrasados = [
        (candidato, *_score_candidate(lancamento_ofx, candidato, "atrasado"))
        for candidato in atrasados
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
        ]
        ranked_atrasados = [
            (lancamento, score, f"{motivo}, correspondencia encontrada fora do centro de custo selecionado")
            for lancamento, score, motivo in ranked_atrasados
        ]

    ranked_atrasados.sort(key=lambda item: item[1], reverse=True)
    return melhor_previsto, ranked_atrasados[:3]


class ProcessarArquivoResponse(BaseModel):
    lancamentos: List[LancamentoImportado]
    total_processado: int
    duplicatas_encontradas: int
    lancamentos_previstos_encontrados: int
    lancamentos_atrasados_encontrados: int


@router.post("/ofx/upload", response_model=ProcessarArquivoResponse)
async def upload_ofx(
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
        conteudo = await arquivo.read()
        if len(conteudo) > OFX_FILE_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo OFX excede o limite de 10 MB.",
            )
        lancamentos_raw = processar_ofx(conteudo, empresa_id)
        categorias_empresa, entidades_por_id, historico_empresa = _carregar_contexto_classificacao(db, empresa_id)

        lancamentos_processados = []
        duplicatas = 0
        previstos = 0
        atrasados = 0
        hashes_vistos: set[str] = set()
        entidade_cache: Dict[str, Optional[int]] = {}

        def _resolve_entidade_id_local(lanc_raw_item: Dict[str, Any]) -> Optional[int]:
            nome_base = str(lanc_raw_item.get("razao_social") or lanc_raw_item.get("interessado_sugerido") or "").strip()
            cpf = str(lanc_raw_item.get("cpf_cnpj") or "").strip()
            if not _interessado_tem_confianca(nome_base) and not re.sub(r"[^0-9]", "", cpf):
                return None

            cache_key = f"{_normalizar_texto(nome_base)}|{re.sub(r'[^0-9]', '', cpf)}"
            if cache_key in entidade_cache:
                return entidade_cache[cache_key]

            entidade_id_local = criar_entidade_se_nao_existir(
                db,
                nome_base,
                cpf,
                empresa_id,
            )
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

            if _eh_movimento_saldo_informativo(lanc_raw):
                lanc_raw["saldo_informativo"] = True
                lanc_raw["sugestao_acao"] = "DESCARTAR"
                lanc_raw["motivo_conciliacao"] = "Movimento de saldo informativo do extrato. Exibido para referência e bloqueado para importação no financeiro."
                lancamentos_processados.append(lanc_raw)
                continue

            if lanc_raw["import_hash"] in hashes_vistos:
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
            hashes_vistos.add(lanc_raw["import_hash"])

            duplicata = verificar_duplicata(db, lanc_raw, empresa_id, conta_id=conta_db_id)
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
                lanc_raw["duplicata_resumo"] = DuplicataResumo(
                    descricao=duplicata.descricao,
                    data_pagamento=duplicata.data_pagamento.isoformat() if duplicata.data_pagamento else None,
                    valor_pago=float(duplicata.valor_pago) if duplicata.valor_pago is not None else None,
                    origem=duplicata.origem,
                    motivo=duplicata_historica_motivo or "Mesmo banco selecionado e mesmo identificador de movimentacao",
                )
                lancamentos_processados.append(lanc_raw)
                continue

            melhor_previsto, melhores_atrasados = _buscar_melhores_relacionamentos(
                db,
                lanc_raw,
                empresa_id,
                centro_custo_id_resolvido,
            )
            if melhor_previsto:
                previstos += 1
                lanc_previsto, score_previsto, motivo_previsto = melhor_previsto
                lanc_raw["lancamento_previsto_id"] = lanc_previsto.id
                lanc_raw["era_previsto"] = True
                lanc_raw["sugestao_acao"] = "BAIXAR_PREVISTO"
                lanc_raw["score_conciliacao"] = score_previsto
                lanc_raw["motivo_conciliacao"] = motivo_previsto
                lanc_raw["lancamento_previsto_resumo"] = _build_resumo(lanc_previsto, score_previsto, motivo_previsto)

            if melhores_atrasados:
                atrasados += 1
                lanc_raw["lancamentos_atrasados_ids"] = [l.id for l, _, _ in melhores_atrasados]
                lanc_raw["lancamentos_atrasados_resumo"] = [
                    _build_resumo(lancamento, score, motivo)
                    for lancamento, score, motivo in melhores_atrasados
                ]
                if not melhor_previsto:
                    lanc_raw["sugestao_acao"] = "RELACIONAR_ATRASADOS"
                    lanc_raw["score_conciliacao"] = melhores_atrasados[0][1]
                    lanc_raw["motivo_conciliacao"] = melhores_atrasados[0][2]

            if not melhor_previsto and not melhores_atrasados:
                lanc_raw["sugestao_acao"] = "CRIAR_NOVO"
                lanc_raw["motivo_conciliacao"] = "Nenhum previsto ou atraso compativel foi encontrado com o mesmo tipo e tolerancia de 5% no valor."

            _aplicar_sugestao_historica(
                lanc_raw,
                historico_empresa,
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


class ConfirmarLancamentosRequest(BaseModel):
    lancamentos: List[Dict[str, Any]]
    conta_id: Optional[int] = None
    cartao_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    modo_importacao: Optional[str] = None


@router.post("/confirmar-lancamentos")
async def confirmar_lancamentos(
    request: ConfirmarLancamentosRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    lancamentos_criados = 0
    lancamentos_atualizados = 0
    erros: List[str] = []
    import_hashes_processados: set[str] = set()

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
                continue

            # Sugestoes automaticas so devem ser executadas apos confirmacao explicita no frontend.
            if acao in {"BAIXAR_PREVISTO", "RELACIONAR_ATRASADOS"} and not sugestao_confirmada:
                continue

            # Duplicata identificada no upload nunca deve virar novo lançamento.
            if lanc_data.get("duplicata_id") or lanc_data.get("duplicata_resumo"):
                continue

            import_hash = str(lanc_data.get("import_hash") or "").strip()
            if import_hash and import_hash in import_hashes_processados:
                logger.warning(
                    "Importacao OFX ignorada por idempotencia no mesmo lote: "
                    f"hash={import_hash} descricao={lanc_data.get('descricao')}"
                )
                continue

            if _buscar_lancamento_por_import_hash(db, empresa_id, import_hash or None):
                logger.warning(
                    "Importacao OFX ignorada por idempotencia: movimento ja confirmado anteriormente. "
                    f"hash={import_hash} descricao={lanc_data.get('descricao')}"
                )
                continue

            if import_hash:
                import_hashes_processados.add(import_hash)

            from app.services.importacao_bancaria_service import parsear_data

            if acao == "BAIXAR_PREVISTO" and lanc_data.get("lancamento_previsto_id") and not modo_cartao:
                lanc_existente = db.get(Lancamento, int(lanc_data["lancamento_previsto_id"]))
                if lanc_existente and not lanc_existente.is_deleted and int(lanc_existente.empresa_id) == int(empresa_id):
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
                    db.add(lanc_existente)
                    lancamentos_atualizados += 1
                    continue
                erros.append(
                    f"Previsto id={lanc_data.get('lancamento_previsto_id')} nao encontrado/ativo para compensacao: {lanc_data.get('descricao')}"
                )
                continue

            if acao == "RELACIONAR_ATRASADOS" and lanc_data.get("lancamentos_atrasados_relacionados") and not modo_cartao:
                atualizados_atrasados = 0
                for atrasado_id in lanc_data["lancamentos_atrasados_relacionados"]:
                    lanc_atrasado = db.get(Lancamento, int(atrasado_id))
                    if not lanc_atrasado or lanc_atrasado.is_deleted or int(lanc_atrasado.empresa_id) != int(empresa_id):
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
                    db.add(lanc_atrasado)
                    lancamentos_atualizados += 1
                    atualizados_atrasados += 1

                if atualizados_atrasados == 0:
                    erros.append(
                        f"Nenhum atraso selecionado foi localizado para conciliacao: {lanc_data.get('descricao')}"
                    )

                if lanc_data.get("relacionar_apenas_atrasados"):
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
                conciliado=not modo_cartao,
                ipp=False,
            )
            db.add(novo_lancamento)
            lancamentos_criados += 1
        except Exception as exc:
            logger.error(f"Erro ao confirmar lancamento OFX: {exc}")
            erros.append(str(exc))

    db.commit()

    logger.info(
        "[OFX] Confirmacao finalizada empresa_id={} criados={} atualizados={} erros={}",
        empresa_id,
        lancamentos_criados,
        lancamentos_atualizados,
        len(erros),
    )

    return {
        "sucesso": True,
        "lancamentos_criados": lancamentos_criados,
        "lancamentos_atualizados": lancamentos_atualizados,
        "erros": erros,
    }
