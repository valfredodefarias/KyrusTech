# app/services/aprendizado_service.py
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from typing import Any, Optional, cast
import os
import re
import unicodedata
from sqlmodel import Session, select
from app.models.lancamento import Lancamento

IMPORT_ANALYZE_SAMPLE_LIMIT = 24
IMPORT_MAX_WORKERS = max(2, min(4, os.cpu_count() or 2))


def normalizar_texto_importacao(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-zA-Z0-9]+", " ", normalized.lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def normalizar_descricao_aprendizado(value: Any) -> str:
    stopwords = {
        "de", "da", "do", "das", "dos", "para", "com", "sem", "por", "via", "pix", "ted", "doc",
        "pgto", "pagamento", "recebimento", "receber", "pagar", "nf", "nfe", "boleto", "transferencia",
    }
    tokens = [token for token in normalizar_texto_importacao(value).split() if len(token) > 2 and token not in stopwords]
    return " ".join(tokens[:10])


def tokenizar_descricao_aprendizado(value: Any) -> tuple[str, ...]:
    normalized = normalizar_descricao_aprendizado(value)
    if not normalized:
        return ()
    return tuple(dict.fromkeys(token for token in normalized.split() if token))


def similaridade_texto_importacao(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    ratio = SequenceMatcher(None, left, right).ratio()
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    union = left_tokens | right_tokens
    overlap = (len(left_tokens & right_tokens) / len(union)) if union else 0.0
    contains_bonus = 0.12 if left in right or right in left else 0.0
    return min(1.0, (ratio * 0.65) + (overlap * 0.35) + contains_bonus)


def append_learning_reference(
    refs: list[dict[str, Any]],
    descricao: Any,
    tipo: str,
    plano_contas_id: Optional[int] = None,
    entidade_id: Optional[int] = None,
    source: str = "historico",
) -> None:
    descricao_norm = normalizar_descricao_aprendizado(descricao)
    if not descricao_norm:
        return
    tokens = tuple(dict.fromkeys(token for token in descricao_norm.split() if token))
    refs.append(
        {
            "descricao": descricao_norm,
            "tokens": tokens,
            "tipo": tipo or "",
            "plano_contas_id": int(plano_contas_id) if plano_contas_id else None,
            "entidade_id": int(entidade_id) if entidade_id else None,
            "source": source,
        }
    )


def build_learning_reference_index(refs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    token_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ref in refs:
        for token in cast(tuple[str, ...], ref.get("tokens") or ()):
            token_index[token].append(ref)
    return token_index


def select_learning_candidates(
    descricao_norm: str,
    tipo: str,
    refs: list[dict[str, Any]],
    token_index: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    tokens = tuple(dict.fromkeys(token for token in descricao_norm.split() if token))
    if not tokens:
        return []

    candidates: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for token in tokens:
        for ref in token_index.get(token, []):
            ref_id = id(ref)
            if ref_id in seen_ids:
                continue
            ref_tipo = str(ref.get("tipo") or "")
            if tipo and ref_tipo and ref_tipo != tipo:
                continue
            seen_ids.add(ref_id)
            candidates.append(ref)

    if candidates:
        return candidates

    if not tipo:
        return []

    return [ref for ref in refs if str(ref.get("tipo") or "") in {"", tipo}]


def load_learning_references(session: Session, empresa_id: int) -> list[dict[str, Any]]:
    rows = session.exec(
        select(Lancamento.descricao, Lancamento.tipo, Lancamento.plano_contas_id, Lancamento.entidade_id)
        .where(Lancamento.empresa_id == empresa_id, Lancamento.is_deleted == False)
    ).all()
    refs: list[dict[str, Any]] = []
    for descricao, tipo, plano_contas_id, entidade_id in rows:
        if plano_contas_id is None and entidade_id is None:
            continue
        append_learning_reference(refs, descricao, str(tipo or ""), plano_contas_id, entidade_id, "historico")
    return refs


def infer_learning_ids(
    descricao: str,
    tipo: str,
    refs: list[dict[str, Any]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Optional[int] | float]:
    descricao_norm = normalizar_descricao_aprendizado(descricao)
    if not descricao_norm:
        return {"plano_contas_id": None, "plano_score": 0.0, "entidade_id": None, "entidade_score": 0.0}

    categoria_scores: dict[int, float] = defaultdict(float)
    entidade_scores: dict[int, float] = defaultdict(float)

    candidates = select_learning_candidates(descricao_norm, tipo, refs, learning_ref_index)
    for ref in candidates:
        score = similaridade_texto_importacao(descricao_norm, str(ref.get("descricao") or ""))
        if score < 0.56:
            continue

        source_bonus = 0.15 if ref.get("source") == "lote" else 0.0
        ref_tipo = str(ref.get("tipo") or "")

        plano_contas_id = ref.get("plano_contas_id")
        if plano_contas_id and (not tipo or not ref_tipo or ref_tipo == tipo):
            categoria_scores[int(plano_contas_id)] += score + source_bonus

        entidade_id = ref.get("entidade_id")
        if entidade_id:
            entidade_scores[int(entidade_id)] += score + source_bonus

    def pick_best(scores: dict[int, float]) -> tuple[Optional[int], float]:
        if not scores:
            return None, 0.0
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best_id, best_score = ranked[0]
        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
        if best_score < 0.72:
            return None, best_score
        if second_score and best_score < second_score * 1.08:
            return None, best_score
        return int(best_id), float(best_score)

    plano_contas_id, plano_score = pick_best(categoria_scores)
    entidade_id, entidade_score = pick_best(entidade_scores)
    return {
        "plano_contas_id": plano_contas_id,
        "plano_score": plano_score,
        "entidade_id": entidade_id,
        "entidade_score": entidade_score,
    }


def infer_learning_ids_cached(
    descricao: str,
    tipo: str,
    refs: list[dict[str, Any]],
    cache: dict[tuple[str, str], dict[str, Optional[int] | float]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Optional[int] | float]:
    cache_key = (descricao.strip(), tipo.strip())
    if cache_key not in cache:
        cache[cache_key] = infer_learning_ids(descricao, tipo, refs, learning_ref_index)
    return cache[cache_key]


def build_inference_cache_parallel(
    inference_keys: set[tuple[str, str]],
    learning_refs: list[dict[str, Any]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[tuple[str, str], dict[str, Optional[int] | float]]:
    if not inference_keys:
        return {}

    def resolve_inference(cache_key: tuple[str, str]) -> tuple[tuple[str, str], dict[str, Optional[int] | float]]:
        descricao, tipo = cache_key
        return cache_key, infer_learning_ids(descricao, tipo, learning_refs, learning_ref_index)

    with ThreadPoolExecutor(max_workers=IMPORT_MAX_WORKERS) as executor:
        return dict(executor.map(resolve_inference, sorted(inference_keys)))


def normalizar_nome_categoria_importacao(value: Any) -> str:
    normalized = normalizar_texto_importacao(value)
    if not normalized:
        return ""
    tokens = normalized.split()
    while tokens and tokens[0].isdigit():
        tokens.pop(0)
    return " ".join(tokens)


def normalizar_token_categoria_importacao(token: str) -> str:
    value = str(token or "").strip().lower()
    if not value:
        return ""
    if value.endswith("oes") and len(value) > 4:
        value = f"{value[:-3]}ao"
    elif value.endswith("s") and len(value) > 4:
        value = value[:-1]
    return value


def tokenizar_nome_categoria_importacao(value: Any) -> tuple[str, ...]:
    nome = normalizar_nome_categoria_importacao(value)
    if not nome:
        return ()
    tokens: list[str] = []
    for token in nome.split():
        if token.isdigit() or len(token) <= 2:
            continue
        normalized_token = normalizar_token_categoria_importacao(token)
        if normalized_token:
            tokens.append(normalized_token)
    if not tokens:
        return ()
    return tuple(dict.fromkeys(tokens))


def sugerir_categoria_por_nome(
    categoria_samples: dict[str, dict[tuple[str, str], int]],
    categorias_sistema: list[dict[str, Any]],
) -> dict[str, int]:
    candidatos = [
        row
        for row in categorias_sistema
        if row.get("id") is not None
        and str(row.get("nome") or "").strip()
        and row.get("permite_lancamentos", True)
        and not row.get("eh_cabecalho", False)
    ]

    sugestoes: dict[str, int] = {}
    for categoria_arquivo in categoria_samples.keys():
        nome_arquivo = normalizar_nome_categoria_importacao(categoria_arquivo)
        tokens_arquivo = set(tokenizar_nome_categoria_importacao(categoria_arquivo))
        if not nome_arquivo or not tokens_arquivo:
            continue

        ranking: list[tuple[int, float]] = []
        for categoria in candidatos:
            nome_sistema = normalizar_nome_categoria_importacao(categoria.get("nome") or "")
            tokens_sistema = set(tokenizar_nome_categoria_importacao(categoria.get("nome") or ""))
            if not nome_sistema or not tokens_sistema:
                continue

            token_intersecao = tokens_arquivo & tokens_sistema
            if not token_intersecao:
                continue

            token_precision = len(token_intersecao) / max(len(tokens_arquivo), 1)
            token_recall = len(token_intersecao) / max(len(tokens_sistema), 1)
            token_score = (token_precision * 0.7) + (token_recall * 0.3)

            text_score = similaridade_texto_importacao(nome_arquivo, nome_sistema)
            score = (token_score * 0.72) + (text_score * 0.28)
            if tokens_arquivo == tokens_sistema:
                score += 0.08
            elif token_precision == 1.0:
                score += 0.05

            if score <= 0:
                continue
            ranking.append((int(categoria["id"]), score))

        ranking.sort(key=lambda item: item[1], reverse=True)
        if not ranking:
            continue

        best_id, best_score = ranking[0]
        second_score = ranking[1][1] if len(ranking) > 1 else 0.0
        if best_score < 0.58:
            continue
        if second_score and best_score < second_score * 1.10:
            continue

        sugestoes[categoria_arquivo] = best_id

    return sugestoes


def build_import_suggestions_from_samples(
    categoria_samples: dict[str, dict[tuple[str, str], int]],
    entidade_samples: dict[str, dict[tuple[str, str], int]],
    categorias_sistema: list[dict[str, Any]],
    learning_refs: list[dict[str, Any]],
    inference_cache: dict[tuple[str, str], dict[str, Optional[int] | float]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, int]]:
    categoria_votes: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    entidade_votes: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))

    for categoria_nome, sample_map in categoria_samples.items():
        ranked_samples = sorted(sample_map.items(), key=lambda item: item[1], reverse=True)[:IMPORT_ANALYZE_SAMPLE_LIMIT]
        for (descricao, tipo), occurrences in ranked_samples:
            suggestion = infer_learning_ids_cached(descricao, tipo, learning_refs, inference_cache, learning_ref_index)
            plano_sugerido = suggestion.get("plano_contas_id")
            if plano_sugerido is not None:
                categoria_votes[categoria_nome][int(plano_sugerido)] += float(suggestion.get("plano_score") or 0) * occurrences

    for entidade_nome, sample_map in entidade_samples.items():
        ranked_samples = sorted(sample_map.items(), key=lambda item: item[1], reverse=True)[:IMPORT_ANALYZE_SAMPLE_LIMIT]
        for (descricao, tipo), occurrences in ranked_samples:
            suggestion = infer_learning_ids_cached(descricao, tipo, learning_refs, inference_cache, learning_ref_index)
            entidade_sugerida = suggestion.get("entidade_id")
            if entidade_sugerida is not None:
                entidade_votes[entidade_nome][int(entidade_sugerida)] += float(suggestion.get("entidade_score") or 0) * occurrences

    def consolidate(votes: dict[str, dict[int, float]]) -> dict[str, int]:
        resolved: dict[str, int] = {}
        for external_name, score_map in votes.items():
            ranked = sorted(score_map.items(), key=lambda item: item[1], reverse=True)
            if not ranked:
                continue
            best_id, best_score = ranked[0]
            second_score = ranked[1][1] if len(ranked) > 1 else 0.0
            if best_score < 0.72:
                continue
            if second_score and best_score < second_score * 1.08:
                continue
            resolved[external_name] = int(best_id)
        return resolved

    categorias_por_aprendizado = consolidate(categoria_votes)
    categorias_por_nome = sugerir_categoria_por_nome(categoria_samples, categorias_sistema)
    categorias_resolvidas = {**categorias_por_aprendizado, **categorias_por_nome}

    return {
        "categorias": categorias_resolvidas,
        "entidades": consolidate(entidade_votes),
    }
