"""
Endpoints para importacao de arquivos OFX (multibancos).
"""
import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from decimal import Decimal
from typing import Any, Dict, List, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlmodel import Session, or_, select
from loguru import logger
from pydantic import BaseModel, Field

from app.db.session import get_db
from app.api.v1.deps import get_empresa_id_from_user
from app.core.config import settings
from app.services.integracao_ofx import processar_ofx
from app.services.integracao_itau import (
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
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas

router = APIRouter()
OFX_FILE_SIZE_LIMIT = 10 * 1024 * 1024
MATCH_TOLERANCIA_PERCENTUAL = Decimal("0.05")
MATCH_DIAS_ATRASO = 30
STATUS_ABERTOS = ("PENDENTE", "EM ABERTO")
HISTORICO_SUGESTAO_LIMITE = 1500
GEMINI_BATCH_LIMIT = 20
GEMINI_CATEGORIA_LIMITE = 8

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
}

TOKENS_GENERICOS_INTERESSADO = {
    "OFX",
    "COMPRA",
    "PAGAMENTO",
    "PAGTO",
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
        palavras.append(TOKEN_MAP_INTERESSADO.get(token, token.title()))
    return " ".join(palavras).strip()


def _extrair_interessado_sugerido(lancamento_ofx: Dict) -> str:
    candidato = str(lancamento_ofx.get("razao_social") or "").strip()
    if len(_normalizar_texto(candidato)) >= 3:
        normalizado = _normalizar_nome_entidade(candidato)
        return normalizado or _title_case_inteligente(_tokenizar_texto(candidato)) or candidato

    descricao = str(lancamento_ofx.get("descricao") or "")
    tokens = []
    for token in _tokenizar_texto(descricao):
        if token in TOKENS_GENERICOS_INTERESSADO:
            continue
        if token.isdigit():
            continue
        tokens.append(token)

    if not tokens:
        return ""

    if len(tokens) > 5:
        tokens = tokens[:5]

    interessado = _title_case_inteligente(tokens)
    interessado = _normalizar_nome_entidade(interessado)
    if len(_normalizar_texto(interessado)) < 3:
        return ""
    return interessado


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
            PlanoContas.permite_lancamentos == True,
            PlanoContas.oculta == False,
        )
    ).all())
    entidades = list(db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.status == "ATIVO",
        )
    ).all())
    historico = list(db.exec(
        select(Lancamento)
        .where(Lancamento.empresa_id == empresa_id)
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
    if melhor_score < 55:
        return []

    if not lancamento_ofx.get("plano_contas_id") and melhor.plano_contas_id:
        lancamento_ofx["plano_contas_id"] = melhor.plano_contas_id
    if not lancamento_ofx.get("entidade_id") and melhor.entidade_id:
        lancamento_ofx["entidade_id"] = melhor.entidade_id
    if not lancamento_ofx.get("motivo_classificacao"):
        lancamento_ofx["motivo_classificacao"] = f"Sugestao por historico parecido com '{melhor.descricao}'."
    return ranked


def _json_from_llm(raw_text: str) -> Optional[Dict[str, Any]]:
    texto = str(raw_text or "").strip()
    if not texto:
        return None
    if texto.startswith("```"):
        texto = re.sub(r"^```(?:json)?", "", texto).strip()
        texto = re.sub(r"```$", "", texto).strip()
    inicio = texto.find("{")
    fim = texto.rfind("}")
    if inicio >= 0 and fim > inicio:
        texto = texto[inicio:fim + 1]
    try:
        parsed = json.loads(texto)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _chamar_gemini_classificacao(items: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    if not settings.GEMINI_API_KEY or not items:
        return {}

    prompt = (
        "Voce classifica movimentos OFX. Responda JSON puro no formato "
        '{"items":[{"linha_arquivo":1,"plano_contas_id":123,"interessado_sugerido":"Nome"}]}'
        " sem markdown. Escolha apenas IDs de plano_contas presentes nas categorias candidatas de cada item. "
        "Preencha categoria e interessado antes da tela de validacao sempre que houver confianca suficiente. "
        "Considere que o operador so deve revisar o que voce sugeriu. "
        "Retorne apenas o nome limpo do interessado, sem prefixos como sugerido, explicacoes ou observacoes. "
        "Melhore o nome do interessado quando a descricao vier abreviada como cartao/maquininha, por exemplo MAST CD -> Master Credito, DB -> Debito. "
        "Se a descricao indicar PIX, chave, QR Code, maquininha, cartao, transferencia, TED, DOC, boleto, taxa ou tarifa, use isso para decidir a categoria candidata mais aderente. "
        "Nunca escolha categoria de despesa para item do tipo RECEITA nem categoria de receita para item do tipo DESPESA. "
        "Use o historico parecido para reaproveitar a categoria mais provavel.\n\n"
        f"Itens:\n{json.dumps(items, ensure_ascii=False)}"
    )

    try:
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent",
            params={"key": settings.GEMINI_API_KEY},
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2000},
            },
            timeout=settings.AI_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates:
            return {}
        parts = candidates[0].get("content", {}).get("parts") or []
        text = "\n".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
        payload = _json_from_llm(text) or {}
        result: Dict[int, Dict[str, Any]] = {}
        for item in payload.get("items", []):
            if isinstance(item, dict) and item.get("linha_arquivo"):
                result[int(item["linha_arquivo"])] = item
        return result
    except Exception as exc:
        logger.warning(f"Gemini indisponivel para classificacao OFX: {exc}")
        return {}


def _aplicar_sugestoes_gemini(
    lancamentos: List[Dict[str, Any]],
    categorias: List[PlanoContas],
    historico_por_linha: Dict[int, List[Lancamento]],
    entidades_por_id: Dict[int, Entidade],
) -> None:
    categorias_por_tipo: Dict[str, List[PlanoContas]] = {"RECEITA": [], "DESPESA": []}
    for categoria in categorias:
        tipo = "RECEITA" if str(categoria.tipo or "").upper().startswith("R") else "DESPESA"
        categorias_por_tipo[tipo].append(categoria)

    pendentes: List[Dict[str, Any]] = []
    for item in lancamentos:
        if item.get("duplicata_id"):
            continue
        if item.get("sugestao_acao") != "CRIAR_NOVO":
            continue
        if item.get("plano_contas_id") and item.get("entidade_id"):
            continue
        historico_rel = historico_por_linha.get(int(item["linha_arquivo"]), [])
        categorias_base = categorias_por_tipo.get(str(item.get("tipo") or "").upper(), [])
        candidatos = []
        vistos: set[int] = set()
        for hist in historico_rel:
            if hist.plano_contas_id and int(hist.plano_contas_id) not in vistos:
                vistos.add(int(hist.plano_contas_id))
                categoria = next((cat for cat in categorias_base if int(cat.id or 0) == int(hist.plano_contas_id)), None)
                if categoria:
                    candidatos.append({
                        "id": int(categoria.id or 0),
                        "nome": categoria.nome,
                        "codigo": categoria.codigo,
                    })
        texto_item = _normalizar_texto(item.get("descricao"))
        for categoria in categorias_base:
            if len(candidatos) >= GEMINI_CATEGORIA_LIMITE:
                break
            if int(categoria.id or 0) in vistos:
                continue
            if _normalizar_texto(categoria.nome) and any(token in texto_item for token in _normalizar_texto(categoria.nome).split()):
                vistos.add(int(categoria.id or 0))
                candidatos.append({
                    "id": int(categoria.id or 0),
                    "nome": categoria.nome,
                    "codigo": categoria.codigo,
                })
        if not candidatos:
            for categoria in categorias_base[:GEMINI_CATEGORIA_LIMITE]:
                candidatos.append({
                    "id": int(categoria.id or 0),
                    "nome": categoria.nome,
                    "codigo": categoria.codigo,
                })

        exemplos = []
        for hist in historico_rel[:3]:
            entidade = entidades_por_id.get(int(hist.entidade_id or 0))
            exemplos.append({
                "descricao": hist.descricao,
                "plano_contas_id": hist.plano_contas_id,
                "entidade": entidade.nome if entidade else None,
            })

        pendentes.append({
            "linha_arquivo": int(item["linha_arquivo"]),
            "tipo": item.get("tipo"),
            "descricao_ofx": item.get("descricao"),
            "interessado_atual": item.get("razao_social") or item.get("interessado_sugerido") or "",
            "categorias_candidatas": candidatos,
            "historico_parecido": exemplos,
        })

    if not pendentes:
        return

    resposta: Dict[int, Dict[str, Any]] = {}
    for inicio in range(0, len(pendentes), GEMINI_BATCH_LIMIT):
        lote = pendentes[inicio:inicio + GEMINI_BATCH_LIMIT]
        resposta.update(_chamar_gemini_classificacao(lote))

    for item in lancamentos:
        sugestao = resposta.get(int(item["linha_arquivo"]))
        if not sugestao:
            continue
        if item.get("sugestao_acao") != "CRIAR_NOVO":
            continue
        plano_contas_id = sugestao.get("plano_contas_id")
        if plano_contas_id and not item.get("plano_contas_id"):
            item["plano_contas_id"] = int(plano_contas_id)
        interessado = str(sugestao.get("interessado_sugerido") or "").strip()
        if interessado:
            interessado_limpo = _normalizar_nome_entidade(interessado) or interessado
            item["interessado_sugerido"] = interessado_limpo
            item["razao_social"] = interessado_limpo
        if (plano_contas_id or interessado) and not item.get("motivo_classificacao"):
            item["motivo_classificacao"] = "Sugestao automatica Gemini aplicada antes da tela de validacao."


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
        historico_relacionado_por_linha: Dict[int, List[Lancamento]] = {}

        for lanc_raw in lancamentos_raw:
            lanc_raw["conta_id"] = conta_db_id
            lanc_raw["centro_custo_id"] = centro_custo_id_resolvido
            lanc_raw["interessado_sugerido"] = _extrair_interessado_sugerido(lanc_raw)
            if lanc_raw.get("interessado_sugerido"):
                lanc_raw["razao_social"] = lanc_raw["interessado_sugerido"]
            referencia_movimento = str(lanc_raw.get("referencia") or "").strip()
            lanc_raw["movimento_uid"] = referencia_movimento or f"fallback:{conta_db_id}:{lanc_raw['linha_arquivo']}"
            lanc_raw["referencia_externa"] = f"{conta_db_id}:{lanc_raw['movimento_uid']}"
            lanc_raw["referencia"] = lanc_raw["referencia_externa"]
            lanc_raw["import_hash"] = gerar_import_hash(lanc_raw, conta_id=conta_db_id)

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
            if not duplicata:
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

            historico_relacionado = _aplicar_sugestao_historica(
                lanc_raw,
                historico_empresa,
                entidades_por_id,
                conta_db_id,
            )
            historico_relacionado_por_linha[int(lanc_raw["linha_arquivo"])] = historico_relacionado

            entidade_id = criar_entidade_se_nao_existir(
                db,
                lanc_raw.get("razao_social", "") or lanc_raw.get("interessado_sugerido", ""),
                lanc_raw.get("cpf_cnpj", ""),
                empresa_id,
            )
            lanc_raw["entidade_id"] = lanc_raw.get("entidade_id") or entidade_id

            lancamentos_processados.append(lanc_raw)

        _aplicar_sugestoes_gemini(lancamentos_processados, categorias_empresa, historico_relacionado_por_linha, entidades_por_id)

        lancamentos_serializados = []
        for lancamento in lancamentos_processados:
            if not lancamento.get("entidade_id") and (lancamento.get("razao_social") or lancamento.get("interessado_sugerido")):
                entidade_id = criar_entidade_se_nao_existir(
                    db,
                    lancamento.get("razao_social", "") or lancamento.get("interessado_sugerido", ""),
                    lancamento.get("cpf_cnpj", ""),
                    empresa_id,
                )
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


def _buscar_lancamento_por_import_hash(db: Session, empresa_id: int, import_hash: Optional[str]) -> Optional[Lancamento]:
    if not import_hash:
        return None
    return db.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.import_hash == import_hash,
        )
    ).first()


class ConfirmarLancamentosRequest(BaseModel):
    lancamentos: List[Dict[str, Any]]
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None


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
    centro_custo_resolvido = None
    if request.conta_id:
        conta_resolvida, centro_custo_resolvido = _resolver_conta_e_centro(
            db,
            empresa_id,
            request.conta_id,
            request.centro_custo_id,
        )

    for lanc_data in request.lancamentos:
        try:
            if lanc_data.get("sugestao_acao") in {"IGNORAR_DUPLICATA", "DESCARTAR"}:
                continue

            if lanc_data.get("duplicata_id"):
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

            from app.services.integracao_itau import parsear_data

            if lanc_data.get("lancamento_previsto_id"):
                lanc_existente = db.get(Lancamento, int(lanc_data["lancamento_previsto_id"]))
                if lanc_existente:
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

            if lanc_data.get("lancamentos_atrasados_relacionados"):
                for atrasado_id in lanc_data["lancamentos_atrasados_relacionados"]:
                    lanc_atrasado = db.get(Lancamento, int(atrasado_id))
                    if not lanc_atrasado:
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
            data_vencimento = parsear_data(lanc_data["data_vencimento"]) if lanc_data.get("data_vencimento") else (data_pagamento or parsear_data(lanc_data.get("data") or ""))
            data_vencimento = data_vencimento or data_pagamento or date.today()
            data_pagamento = data_pagamento or data_vencimento or date.today()

            novo_lancamento = Lancamento(
                descricao=str(lanc_data["descricao"]),
                tipo=str(lanc_data["tipo"]),
                status="PAGO",
                origem=str(lanc_data["origem"]),
                valor_previsto=Decimal(str(lanc_data.get("valor_previsto") or lanc_data["valor"])),
                valor_pago=Decimal(str(lanc_data.get("valor_pago") or lanc_data["valor"])),
                data_vencimento=data_vencimento,
                data_pagamento=data_pagamento,
                data_competencia=data_pagamento or data_vencimento or date.today(),
                empresa_id=empresa_id,
                plano_contas_id=int(plano_contas_id),
                entidade_id=int(lanc_data["entidade_id"]) if lanc_data.get("entidade_id") else None,
                conta_id=(conta_resolvida.id if conta_resolvida else lanc_data.get("conta_id") or request.conta_id),
                centro_custo_id=(centro_custo_resolvido or lanc_data.get("centro_custo_id") or request.centro_custo_id),
                import_hash=import_hash or None,
                conciliado=True,
                ipp=False,
            )
            db.add(novo_lancamento)
            lancamentos_criados += 1
        except Exception as exc:
            logger.error(f"Erro ao confirmar lancamento OFX: {exc}")
            erros.append(str(exc))

    db.commit()

    return {
        "sucesso": True,
        "lancamentos_criados": lancamentos_criados,
        "lancamentos_atualizados": lancamentos_atualizados,
        "erros": erros,
    }
