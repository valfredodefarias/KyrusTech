import pandas as pd
import io
import json
import os
import re
import threading
import uuid
import zipfile
import unicodedata
from pathlib import Path
from typing import List, Optional, Any, cast, Tuple, Callable, Iterator
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal
from difflib import SequenceMatcher
from openpyxl import load_workbook

from fastapi import APIRouter, Depends, Query, UploadFile, File, status, Form, HTTPException, BackgroundTasks, Response, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select, col
from sqlalchemy.orm import noload, selectinload
from loguru import logger

# --- Imports do Projeto ---
# Padronizando tudo para get_db para evitar erros de importação
from app.db.session import get_db, engine
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.anexo_lancamento import AnexoLancamento

# Dependências de Usuário e Empresa
from app.api.deps import get_current_user, get_empresa_id_from_user 

from app.services.lancamento_service import LancamentoService
from app.crud import crud_plano_contas

# --- Schemas ---
from app.schemas.lancamento import (
    LancamentoCreate, LancamentoRead, LancamentoUpdate, 
    TransferenciaCreate, BulkActionSchema, BulkUpdateSchema
)
from app.schemas.anexo import AnexoRead, AnexoCreate
from app.core.upload_security import (
    ANEXO_ALLOWED_EXT_TO_MIME,
    UploadValidationError,
    register_upload_rejection,
    register_upload_success,
    safe_local_path_from_static_url,
    write_validated_upload_file,
)

router = APIRouter()
MAX_ANEXO_NOME_LEN = 180
MAX_ANEXO_SIZE = 10 * 1024 * 1024
MAX_ANEXOS_PER_REQUEST = 10
UPLOAD_ANEXOS_DIR = Path("static/uploads/lancamentos")
UPLOAD_ANEXOS_DIR.mkdir(parents=True, exist_ok=True)
IMPORT_ANALYZE_SAMPLE_LIMIT = 24
IMPORT_INSERT_BATCH_SIZE = 5000
IMPORT_PREPARE_CHUNK_SIZE = 2000
IMPORT_MAX_WORKERS = max(2, min(4, os.cpu_count() or 2))


@dataclass
class ImportJobState:
    job_id: str
    kind: str
    empresa_id: int
    user_id: int
    filename: str
    status: str = "PENDING"
    progress: int = 0
    message: str = "Aguardando processamento"
    error: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


IMPORT_JOBS: dict[str, ImportJobState] = {}
IMPORT_JOBS_LOCK = threading.Lock()


def _create_import_job(kind: str, empresa_id: int, user_id: int, filename: str) -> ImportJobState:
    job = ImportJobState(
        job_id=str(uuid.uuid4()),
        kind=kind,
        empresa_id=empresa_id,
        user_id=user_id,
        filename=filename,
    )
    with IMPORT_JOBS_LOCK:
        IMPORT_JOBS[job.job_id] = job
    return job


def _update_import_job(job_id: str, *, status: Optional[str] = None, progress: Optional[int] = None, message: Optional[str] = None, error: Optional[str] = None, result: Optional[dict[str, Any]] = None) -> None:
    with IMPORT_JOBS_LOCK:
        job = IMPORT_JOBS.get(job_id)
        if not job:
            return
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = max(0, min(100, int(progress)))
        if message is not None:
            job.message = message
        if error is not None:
            job.error = error
        if result is not None:
            job.result = result
        job.updated_at = datetime.utcnow().isoformat()


def _serialize_import_job(job: ImportJobState) -> dict[str, Any]:
    return asdict(job)


def _load_import_system_rows(session: Session, empresa_id: int) -> dict[str, list[dict[str, Any]]]:
    crud_plano_contas.normalize_company_operational_categories(db=session, empresa_id=empresa_id)
    contas = session.exec(
        select(Conta.id, Conta.nome).where(Conta.empresa_id == empresa_id)
    ).all()
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa_id)).all()
    centros = session.exec(
        select(CentroCusto.id, CentroCusto.nome).where(CentroCusto.empresa_id == empresa_id)
    ).all()
    entidades = session.exec(
        select(Entidade.id, Entidade.nome).where(Entidade.empresa_id == empresa_id)
    ).all()

    return {
        "contas": [{"id": conta_id, "nome": nome} for conta_id, nome in contas if conta_id is not None],
        "categorias": [
            {
                "id": categoria.id,
                "nome": categoria.nome,
                "tipo": categoria.tipo,
                "codigo": categoria.codigo,
                "conta_pai_id": categoria.conta_pai_id,
                "permite_lancamentos": categoria.permite_lancamentos,
                "eh_cabecalho": categoria.eh_cabecalho,
            }
            for categoria in categorias
            if categoria.id is not None
        ],
        "centros": [{"id": centro_id, "nome": nome} for centro_id, nome in centros if centro_id is not None],
        "entidades": [{"id": entidade_id, "nome": nome} for entidade_id, nome in entidades if entidade_id is not None],
    }


def _ensure_import_prerequisites(sistema: dict[str, list[dict[str, Any]]]) -> None:
    sem_contas = len(sistema.get("contas") or []) == 0
    sem_entidades = len(sistema.get("entidades") or []) == 0

    if sem_contas and sem_entidades:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Antes de importar, cadastre pelo menos 1 banco em Contas Bancarias e pelo menos 1 interessado em Interessados.",
        )

    if sem_contas:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Antes de importar, cadastre pelo menos 1 banco em Contas Bancarias.",
        )

    if sem_entidades:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Antes de importar, cadastre pelo menos 1 interessado em Interessados.",
        )


def _build_import_name_map(rows: list[dict[str, Any]], selectable_only: bool = False) -> dict[str, int]:
    return {
        str(row["nome"]).upper().strip(): int(row["id"])
        for row in rows
        if not selectable_only or (row.get("permite_lancamentos", True) and not row.get("eh_cabecalho", False))
        if row.get("id") is not None and str(row.get("nome") or "").strip()
    }


def _normalize_import_headers(header_values: tuple[Any, ...] | list[Any]) -> list[str]:
    headers: list[str] = []
    seen: dict[str, int] = {}
    for index, value in enumerate(header_values):
        header = str(value or f"COLUNA_{index + 1}").upper().strip() or f"COLUNA_{index + 1}"
        if header in seen:
            seen[header] += 1
            header = f"{header}_{seen[header]}"
        else:
            seen[header] = 1
        headers.append(header)
    return headers


def _iter_spreadsheet_rows(file_bytes: bytes) -> tuple[list[str], Iterator[dict[str, str]]]:
    buffer = io.BytesIO(file_bytes)
    if zipfile.is_zipfile(buffer):
        workbook = load_workbook(buffer, read_only=True, data_only=True)
        worksheet = workbook.worksheets[0]
        row_iter = worksheet.iter_rows(values_only=True)
        try:
            header_row = next(row_iter)
        except StopIteration:
            workbook.close()
            return [], iter(())

        headers = _normalize_import_headers(header_row or [])

        def generator() -> Iterator[dict[str, str]]:
            try:
                for row in row_iter:
                    values = list(row or [])
                    padded = values + [""] * max(0, len(headers) - len(values))
                    yield {
                        headers[index]: _format_preview_value(padded[index] if index < len(padded) else "")
                        for index in range(len(headers))
                    }
            finally:
                workbook.close()

        return headers, generator()

    dataframe = pd.read_excel(io.BytesIO(file_bytes), sheet_name=0, dtype=str, keep_default_na=False)
    dataframe.columns = [str(column).upper().strip() for column in dataframe.columns]
    dataframe = dataframe.fillna("")
    headers = [str(column).upper().strip() for column in dataframe.columns]

    def fallback_generator() -> Iterator[dict[str, str]]:
        for row in dataframe.to_dict(orient="records"):
            yield {str(key).upper().strip(): _format_preview_value(value) for key, value in row.items()}

    return headers, fallback_generator()


def _find_column_in_headers(headers: list[str], possiveis_nomes: list[str]) -> str:
    header_map = {str(header).upper().strip(): str(header).upper().strip() for header in headers}
    for nome in possiveis_nomes:
        normalized = str(nome).upper().strip()
        if normalized in header_map:
            return header_map[normalized]
    return ""


def _coerce_row_value(row: dict[str, Any], column: str) -> str:
    if not column:
        return ""
    value = row.get(column, "")
    return _format_preview_value(value)


def _parse_import_decimal(raw_value: Any, cache: dict[str, Decimal]) -> Decimal:
    key = _format_preview_value(raw_value)
    if key in cache:
        return cache[key]
    cleaned = key.replace("R$", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    cleaned = cleaned or "0"
    cache[key] = Decimal(cleaned)
    return cache[key]


def _split_import_date_parts(raw_value: str) -> Optional[tuple[int, int, int]]:
    cleaned = str(raw_value or "").strip()
    if not cleaned:
        return None

    match = re.match(r"^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$", cleaned)
    if not match:
        return None

    left, middle, right = (int(part) for part in match.groups())
    if left >= 1000 or right >= 1000:
        return left, middle, right
    return None


def _infer_import_dayfirst(date_values: list[Any]) -> bool:
    dayfirst_votes = 0
    monthfirst_votes = 0

    for raw_value in date_values:
        key = _format_preview_value(raw_value)
        if not key:
            continue

        parts = _split_import_date_parts(key)
        if not parts:
            continue

        left, middle, right = parts
        if left >= 1000 or right < 1000:
            continue
        if left > 12 and middle <= 12:
            dayfirst_votes += 1
        elif middle > 12 and left <= 12:
            monthfirst_votes += 1

    return dayfirst_votes >= monthfirst_votes


def _parse_import_date(raw_value: Any, cache: dict[str, Optional[date]], dayfirst: bool = True) -> Optional[date]:
    key = _format_preview_value(raw_value)
    cache_key = f"{'DMY' if dayfirst else 'MDY'}::{key}"
    if cache_key in cache:
        return cache[cache_key]
    if not key:
        cache[cache_key] = None
        return None

    if isinstance(raw_value, datetime):
        cache[cache_key] = raw_value.date()
        return cache[cache_key]
    if isinstance(raw_value, date):
        cache[cache_key] = raw_value
        return cache[cache_key]

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            cache[cache_key] = datetime.strptime(key, fmt).date()
            return cache[cache_key]
        except ValueError:
            pass

    parts = _split_import_date_parts(key)
    if parts:
        left, middle, right = parts
        try:
            if left >= 1000:
                cache[cache_key] = date(left, middle, right)
            elif right >= 1000:
                day = left if dayfirst else middle
                month = middle if dayfirst else left
                cache[cache_key] = date(right, month, day)
            else:
                cache[cache_key] = None
            return cache[cache_key]
        except ValueError:
            cache[cache_key] = None
            return None

    parsed = pd.to_datetime(key, dayfirst=dayfirst, errors="coerce")
    cache[cache_key] = parsed.date() if parsed is not None and not pd.isna(parsed) else None
    return cache[cache_key]


def _build_inference_cache_parallel(
    inference_keys: set[tuple[str, str]],
    learning_refs: list[dict[str, Any]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[tuple[str, str], dict[str, Optional[int] | float]]:
    if not inference_keys:
        return {}

    def resolve_inference(cache_key: tuple[str, str]) -> tuple[tuple[str, str], dict[str, Optional[int] | float]]:
        descricao, tipo = cache_key
        return cache_key, _infer_learning_ids(descricao, tipo, learning_refs, learning_ref_index)

    with ThreadPoolExecutor(max_workers=IMPORT_MAX_WORKERS) as executor:
        return dict(executor.map(resolve_inference, sorted(inference_keys)))


def _prepare_import_chunk(
    raw_chunk: list[dict[str, Any]],
    map_categorias: dict[str, Any],
    map_contas: dict[str, Any],
    map_centros: dict[str, Any],
    map_entidades: dict[str, Any],
    nomes_cats_sist: dict[str, int],
    nomes_contas_sist: dict[str, int],
    nomes_centros_sist: dict[str, int],
    nomes_entidades_sist: dict[str, int],
    cache_tipos: dict[int, Any],
    inference_cache: dict[tuple[str, str], dict[str, Optional[int] | float]],
) -> tuple[list[dict[str, Any]], dict[str, str], dict[str, str]]:
    prepared_rows: list[dict[str, Any]] = []
    missing_entities: dict[str, str] = {}
    missing_centers: dict[str, str] = {}

    for raw in raw_chunk:
        descricao = str(raw["descricao"] or "")
        tipo = str(raw["tipo"] or "")
        categoria_nome = str(raw["categoria_nome"] or "")
        entidade_nome = str(raw["entidade_nome"] or "")
        conta_nome = str(raw["conta_nome"] or "")
        centro_nome = str(raw["centro_nome"] or "")
        inferencia = inference_cache.get((descricao.strip(), tipo.strip()), {"plano_contas_id": None, "entidade_id": None}) if descricao else {"plano_contas_id": None, "entidade_id": None}

        plano_contas_id: Optional[int] = None
        cat_key = categoria_nome.upper().strip()
        if cat_key and cat_key in map_categorias:
            plano_contas_id = int(map_categorias[cat_key])
        elif cat_key and cat_key in nomes_cats_sist:
            plano_contas_id = int(nomes_cats_sist[cat_key])
        elif inferencia.get("plano_contas_id") is not None:
            plano_contas_id = int(cast(int, inferencia.get("plano_contas_id")))

        if not tipo and plano_contas_id is not None:
            tipo = "RECEITA" if cache_tipos.get(int(plano_contas_id)) == "R" else "DESPESA"
        if not tipo:
            tipo = "DESPESA"

        entidade_id: Optional[int] = None
        ent_key = entidade_nome.upper().strip()
        if ent_key and ent_key in map_entidades:
            entidade_id = int(map_entidades[ent_key])
        elif ent_key and ent_key in nomes_entidades_sist:
            entidade_id = int(nomes_entidades_sist[ent_key])
        elif inferencia.get("entidade_id") is not None:
            entidade_id = int(cast(int, inferencia.get("entidade_id")))
        elif ent_key:
            missing_entities[ent_key] = entidade_nome

        conta_id: Optional[int] = None
        conta_key = conta_nome.upper().strip()
        if conta_key:
            if conta_key in map_contas:
                conta_id = int(map_contas[conta_key])
            elif conta_key in nomes_contas_sist:
                conta_id = int(nomes_contas_sist[conta_key])

        centro_custo_id: Optional[int] = None
        centro_key = centro_nome.upper().strip()
        if centro_key:
            if centro_key in map_centros:
                centro_custo_id = int(map_centros[centro_key])
            elif centro_key in nomes_centros_sist:
                centro_custo_id = int(nomes_centros_sist[centro_key])
            else:
                missing_centers[centro_key] = centro_nome

        prepared_rows.append(
            {
                **raw,
                "tipo": tipo,
                "plano_contas_id": plano_contas_id,
                "entidade_id": entidade_id,
                "conta_id": conta_id,
                "centro_custo_id": centro_custo_id,
                "entidade_key": ent_key,
                "centro_key": centro_key,
            }
        )

    return prepared_rows, missing_entities, missing_centers


def _flush_lancamento_batch(db: Session, batch: list[Lancamento]) -> None:
    if not batch:
        return
    db.add_all(batch)
    db.flush()
    for lancamento in batch:
        db.expunge(lancamento)


def _infer_learning_ids_cached(
    descricao: str,
    tipo: str,
    refs: list[dict[str, Any]],
    cache: dict[tuple[str, str], dict[str, Optional[int] | float]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Optional[int] | float]:
    cache_key = (descricao.strip(), tipo.strip())
    if cache_key not in cache:
        cache[cache_key] = _infer_learning_ids(descricao, tipo, refs, learning_ref_index)
    return cache[cache_key]


def _normalizar_nome_categoria_importacao(value: Any) -> str:
    normalized = _normalizar_texto_importacao(value)
    if not normalized:
        return ""
    tokens = normalized.split()
    while tokens and tokens[0].isdigit():
        tokens.pop(0)
    return " ".join(tokens)


def _normalizar_token_categoria_importacao(token: str) -> str:
    value = str(token or "").strip().lower()
    if not value:
        return ""
    # Singulariza formas comuns para melhorar match por nome (ex.: cartoes -> cartao).
    if value.endswith("oes") and len(value) > 4:
        value = f"{value[:-3]}ao"
    elif value.endswith("s") and len(value) > 4:
        value = value[:-1]
    return value


def _tokenizar_nome_categoria_importacao(value: Any) -> tuple[str, ...]:
    nome = _normalizar_nome_categoria_importacao(value)
    if not nome:
        return ()
    tokens: list[str] = []
    for token in nome.split():
        if token.isdigit() or len(token) <= 2:
            continue
        normalized_token = _normalizar_token_categoria_importacao(token)
        if normalized_token:
            tokens.append(normalized_token)
    if not tokens:
        return ()
    return tuple(dict.fromkeys(tokens))


def _sugerir_categoria_por_nome(
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
        nome_arquivo = _normalizar_nome_categoria_importacao(categoria_arquivo)
        tokens_arquivo = set(_tokenizar_nome_categoria_importacao(categoria_arquivo))
        if not nome_arquivo or not tokens_arquivo:
            continue

        ranking: list[tuple[int, float]] = []
        for categoria in candidatos:
            nome_sistema = _normalizar_nome_categoria_importacao(categoria.get("nome") or "")
            tokens_sistema = set(_tokenizar_nome_categoria_importacao(categoria.get("nome") or ""))
            if not nome_sistema or not tokens_sistema:
                continue

            token_intersecao = tokens_arquivo & tokens_sistema
            if not token_intersecao:
                continue

            token_precision = len(token_intersecao) / max(len(tokens_arquivo), 1)
            token_recall = len(token_intersecao) / max(len(tokens_sistema), 1)
            token_score = (token_precision * 0.7) + (token_recall * 0.3)

            text_score = _similaridade_texto_importacao(nome_arquivo, nome_sistema)
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


def _build_import_suggestions_from_samples(
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
            suggestion = _infer_learning_ids_cached(descricao, tipo, learning_refs, inference_cache, learning_ref_index)
            plano_sugerido = suggestion.get("plano_contas_id")
            if plano_sugerido is not None:
                categoria_votes[categoria_nome][int(plano_sugerido)] += float(suggestion.get("plano_score") or 0) * occurrences

    for entidade_nome, sample_map in entidade_samples.items():
        ranked_samples = sorted(sample_map.items(), key=lambda item: item[1], reverse=True)[:IMPORT_ANALYZE_SAMPLE_LIMIT]
        for (descricao, tipo), occurrences in ranked_samples:
            suggestion = _infer_learning_ids_cached(descricao, tipo, learning_refs, inference_cache, learning_ref_index)
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
    categorias_por_nome = _sugerir_categoria_por_nome(categoria_samples, categorias_sistema)

    categorias_resolvidas = {**categorias_por_aprendizado, **categorias_por_nome}

    return {
        "categorias": categorias_resolvidas,
        "entidades": consolidate(entidade_votes),
    }


def _ensure_a_categorizar(db: Session, empresa_id: int, tipo_lancamento: str, cache_tipos: dict[int, Any], nomes_cats_sist: dict[str, int]) -> int:
    tipo_plano = "R" if str(tipo_lancamento).upper() == "RECEITA" else "D"
    categoria = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.nome == "A Categorizar",
            PlanoContas.tipo == tipo_plano,
        )
    ).first()
    if not categoria:
        categoria = PlanoContas(
            nome="A Categorizar",
            codigo=None,
            tipo=tipo_plano,
            empresa_id=empresa_id,
            permite_lancamentos=True,
        )
        db.add(categoria)
        db.flush()
    categoria_id = int(categoria.id)
    cache_tipos[categoria_id] = categoria.tipo
    nomes_cats_sist[f"A CATEGORIZAR::{tipo_plano}"] = categoria_id
    return categoria_id


def _analyze_import_contents(session: Session, file_bytes: bytes, empresa_id: int, progress_callback: Optional[Callable[[int, str], None]] = None) -> dict[str, Any]:
    if progress_callback:
        progress_callback(5, "Lendo arquivo XLSX em streaming")
    headers, row_iter = _iter_spreadsheet_rows(file_bytes)

    col_desc = _find_column_in_headers(headers, ["DESCRIÇÃO", "DESCRICAO", "HISTÓRICO", "HISTORICO"])
    col_tipo = _find_column_in_headers(headers, ["TIPO"])
    col_venc = _find_column_in_headers(headers, ["DATA VENCIMENTO", "VENCIMENTO", "DATA"])
    col_valor = _find_column_in_headers(headers, ["VALOR", "VALOR PAGO", "VALOR PREVISTO"])
    col_conta = _find_column_in_headers(headers, ["CONTA", "BANCO"])
    col_cat = _find_column_in_headers(headers, ["CATEGORIA", "PLANO DE CONTAS"])
    col_centro = _find_column_in_headers(headers, ["CENTRO DE CUSTO", "CENTRO", "FILIAL", "CENTRO_CUSTO"])
    col_entidade = _find_column_in_headers(headers, ["ENTIDADE", "CLIENTE", "FORNECEDOR"])

    sistema = _load_import_system_rows(session, empresa_id)
    _ensure_import_prerequisites(sistema)
    nomes_contas = _build_import_name_map(sistema["contas"])
    nomes_cats = _build_import_name_map(sistema["categorias"], selectable_only=True)
    nomes_centros = _build_import_name_map(sistema["centros"])
    nomes_entidades = _build_import_name_map(sistema["entidades"])

    preview_source: list[dict[str, Any]] = []
    conflitos_contas: set[str] = set()
    conflitos_categorias: set[str] = set()
    conflitos_centros: set[str] = set()
    conflitos_entidades: set[str] = set()
    categoria_samples: dict[str, dict[tuple[str, str], int]] = defaultdict(lambda: defaultdict(int))
    entidade_samples: dict[str, dict[tuple[str, str], int]] = defaultdict(lambda: defaultdict(int))
    inference_keys: set[tuple[str, str]] = set()
    total_rows = 0

    for row_idx, row in enumerate(row_iter, start=2):
        total_rows += 1
        if progress_callback and total_rows % 1000 == 0:
            progress_callback(min(40, 8 + min(32, total_rows // 1000)), f"Indexando planilha ({total_rows} linhas lidas)")

        descricao = _coerce_row_value(row, col_desc)
        tipo_raw = _coerce_row_value(row, col_tipo).upper()
        tipo = "RECEITA" if tipo_raw.startswith("R") else ("DESPESA" if tipo_raw.startswith("D") else "")
        categoria_nome = _coerce_row_value(row, col_cat)
        entidade_nome = _coerce_row_value(row, col_entidade)
        conta_nome = _coerce_row_value(row, col_conta)
        centro_nome = _coerce_row_value(row, col_centro)

        if conta_nome and conta_nome.upper().strip() not in nomes_contas:
            conflitos_contas.add(conta_nome)
        if categoria_nome and categoria_nome.upper().strip() not in nomes_cats:
            conflitos_categorias.add(categoria_nome)
            if descricao:
                categoria_samples[categoria_nome][(descricao, tipo)] += 1
                inference_keys.add((descricao.strip(), tipo.strip()))
        if centro_nome and centro_nome.upper().strip() not in nomes_centros:
            conflitos_centros.add(centro_nome)
        if entidade_nome and entidade_nome.upper().strip() not in nomes_entidades:
            conflitos_entidades.add(entidade_nome)
            if descricao:
                entidade_samples[entidade_nome][(descricao, tipo)] += 1
                inference_keys.add((descricao.strip(), tipo.strip()))

        preview_source.append(
            {
                "linha": row_idx,
                "descricao": descricao,
                "tipo": tipo if tipo else _coerce_row_value(row, col_tipo),
                "valor": _coerce_row_value(row, col_valor),
                "data_vencimento": _coerce_row_value(row, col_venc),
                "categoria_arquivo": categoria_nome,
                "entidade_arquivo": entidade_nome,
            }
        )

    inferred_dayfirst = _infer_import_dayfirst([item.get("data_vencimento") for item in preview_source])

    conflitos = {
        "contas": sorted(conflitos_contas),
        "categorias": sorted(conflitos_categorias),
        "centros": sorted(conflitos_centros),
        "entidades": sorted(conflitos_entidades),
    }

    if progress_callback:
        progress_callback(55, "Calculando sugestões por amostragem")
    learning_refs = _load_learning_references(session, empresa_id)
    learning_ref_index = _build_learning_reference_index(learning_refs)
    inference_cache = _build_inference_cache_parallel(inference_keys, learning_refs, learning_ref_index)
    sugestoes = _build_import_suggestions_from_samples(
        categoria_samples,
        entidade_samples,
        sistema["categorias"],
        learning_refs,
        inference_cache,
        learning_ref_index,
    )
    categorias_by_id = {int(item["id"]): item for item in sistema["categorias"] if item.get("id") is not None}
    entidades_by_id = {int(item["id"]): item for item in sistema["entidades"] if item.get("id") is not None}
    preview_rows: list[dict[str, Any]] = []

    if progress_callback:
        progress_callback(75, "Montando prévia das primeiras linhas")
    for row in preview_source:
        descricao = str(row.get("descricao") or "")
        tipo = str(row.get("tipo") or "")
        categoria_nome = str(row.get("categoria_arquivo") or "")
        entidade_nome = str(row.get("entidade_arquivo") or "")

        categoria_mapeada_id = sugestoes["categorias"].get(categoria_nome) if categoria_nome else None
        entidade_mapeada_id = sugestoes["entidades"].get(entidade_nome) if entidade_nome else None

        if descricao and (categoria_mapeada_id is None or entidade_mapeada_id is None):
            inferencia = _infer_learning_ids_cached(descricao, tipo, learning_refs, inference_cache, learning_ref_index)
            if categoria_mapeada_id is None and inferencia.get("plano_contas_id") is not None:
                categoria_mapeada_id = int(cast(int, inferencia.get("plano_contas_id")))
            if entidade_mapeada_id is None and inferencia.get("entidade_id") is not None:
                entidade_mapeada_id = int(cast(int, inferencia.get("entidade_id")))

        preview_rows.append(
            {
                **row,
                "categoria_sugerida_id": categoria_mapeada_id,
                "categoria_sugerida_nome": categorias_by_id.get(int(categoria_mapeada_id), {}).get("nome") if categoria_mapeada_id is not None else None,
                "entidade_sugerida_id": entidade_mapeada_id,
                "entidade_sugerida_nome": entidades_by_id.get(int(entidade_mapeada_id), {}).get("nome") if entidade_mapeada_id is not None else None,
            }
        )

    return {
        "conflitos": conflitos,
        "sistema": sistema,
        "sugestoes": sugestoes,
        "preview": preview_rows,
        "meta": {
            "total_linhas": total_rows,
            "linhas_preview": len(preview_rows),
            "date_format_detected": "DD/MM/YYYY" if inferred_dayfirst else "MM/DD/YYYY",
        },
    }


def _execute_import_contents(
    db: Session,
    file_bytes: bytes,
    empresa_id: int,
    user_id: int,
    mapeamento: dict[str, Any],
    progress_callback: Optional[Callable[[int, str], None]] = None,
) -> dict[str, Any]:
    if progress_callback:
        progress_callback(5, "Lendo arquivo XLSX em streaming")
    headers, row_iter = _iter_spreadsheet_rows(file_bytes)

    map_categorias = {str(k).upper().strip(): v for k, v in mapeamento.get("map_categorias", {}).items() if v is not None}
    map_contas = {str(k).upper().strip(): v for k, v in mapeamento.get("map_contas", {}).items() if v is not None}
    map_centros = {str(k).upper().strip(): v for k, v in mapeamento.get("map_centros", {}).items() if v is not None}
    map_entidades = {str(k).upper().strip(): v for k, v in mapeamento.get("map_entidades", {}).items() if v is not None}

    col_venc = _find_column_in_headers(headers, ["DATA VENCIMENTO", "VENCIMENTO", "DATA"])
    col_pag = _find_column_in_headers(headers, ["DATA PAGAMENTO", "PAGAMENTO"])
    col_desc = _find_column_in_headers(headers, ["DESCRIÇÃO", "DESCRICAO", "HISTÓRICO", "HISTORICO"])
    col_valor = _find_column_in_headers(headers, ["VALOR", "VALOR PAGO", "VALOR PREVISTO"])
    col_cat = _find_column_in_headers(headers, ["CATEGORIA", "PLANO DE CONTAS"])
    col_ent = _find_column_in_headers(headers, ["ENTIDADE", "CLIENTE", "FORNECEDOR"])
    col_conta = _find_column_in_headers(headers, ["CONTA", "BANCO"])
    col_centro = _find_column_in_headers(headers, ["CENTRO DE CUSTO", "CENTRO", "FILIAL", "CENTRO_CUSTO"])
    col_tipo = _find_column_in_headers(headers, ["TIPO"])

    sistema = _load_import_system_rows(db, empresa_id)
    _ensure_import_prerequisites(sistema)
    cache_tipos = {int(item["id"]): item.get("tipo") for item in sistema["categorias"] if item.get("id") is not None}
    nomes_cats_sist = _build_import_name_map(sistema["categorias"], selectable_only=True)
    nomes_contas_sist = _build_import_name_map(sistema["contas"])
    nomes_centros_sist = _build_import_name_map(sistema["centros"])
    nomes_entidades_sist = _build_import_name_map(sistema["entidades"])
    learning_refs = _load_learning_references(db, empresa_id)
    learning_ref_index = _build_learning_reference_index(learning_refs)

    raw_rows: list[dict[str, Any]] = []
    inference_keys: set[tuple[str, str]] = set()
    parse_date_cache: dict[str, Optional[date]] = {}
    parse_decimal_cache: dict[str, Decimal] = {}

    for row_idx, row in enumerate(row_iter, start=2):
        descricao = _coerce_row_value(row, col_desc)
        categoria_nome = _coerce_row_value(row, col_cat)
        entidade_nome = _coerce_row_value(row, col_ent)
        conta_nome = _coerce_row_value(row, col_conta)
        centro_nome = _coerce_row_value(row, col_centro)
        tipo_raw = _coerce_row_value(row, col_tipo).upper()
        tipo = "RECEITA" if tipo_raw.startswith("R") else ("DESPESA" if tipo_raw.startswith("D") else "")
        raw_rows.append(
            {
                "linha": row_idx,
                "descricao": descricao,
                "categoria_nome": categoria_nome,
                "entidade_nome": entidade_nome,
                "conta_nome": conta_nome,
                "centro_nome": centro_nome,
                "tipo": tipo,
                "valor_raw": _coerce_row_value(row, col_valor),
                "data_venc_raw": _coerce_row_value(row, col_venc),
                "data_pag_raw": _coerce_row_value(row, col_pag),
            }
        )
        if descricao:
            categoria_key = categoria_nome.upper().strip()
            entidade_key = entidade_nome.upper().strip()
            categoria_resolvida = not categoria_key or categoria_key in map_categorias or categoria_key in nomes_cats_sist
            entidade_resolvida = not entidade_key or entidade_key in map_entidades or entidade_key in nomes_entidades_sist
            if not categoria_resolvida or not entidade_resolvida:
                inference_keys.add((descricao.strip(), tipo.strip()))

    total_rows = len(raw_rows)
    inferred_dayfirst = _infer_import_dayfirst([
        *(row.get("data_venc_raw") for row in raw_rows),
        *(row.get("data_pag_raw") for row in raw_rows),
    ])
    if progress_callback:
        progress_callback(18, f"Preparando {total_rows} linha(s) para importação")

    if progress_callback:
        progress_callback(24, "Calculando inferências reutilizáveis")
    inference_cache = _build_inference_cache_parallel(inference_keys, learning_refs, learning_ref_index)

    missing_entities: dict[str, str] = {}
    missing_centers: dict[str, str] = {}
    prepared_rows: list[dict[str, Any]] = []
    raw_chunks = [raw_rows[index:index + IMPORT_PREPARE_CHUNK_SIZE] for index in range(0, total_rows, IMPORT_PREPARE_CHUNK_SIZE)]
    with ThreadPoolExecutor(max_workers=IMPORT_MAX_WORKERS) as executor:
        prepared_chunks = list(
            executor.map(
                lambda chunk: _prepare_import_chunk(
                    chunk,
                    map_categorias,
                    map_contas,
                    map_centros,
                    map_entidades,
                    nomes_cats_sist,
                    nomes_contas_sist,
                    nomes_centros_sist,
                    nomes_entidades_sist,
                    cache_tipos,
                    inference_cache,
                ),
                raw_chunks,
            )
        )

    for index, (chunk_rows, chunk_missing_entities, chunk_missing_centers) in enumerate(prepared_chunks, start=1):
        prepared_rows.extend(chunk_rows)
        missing_entities.update(chunk_missing_entities)
        missing_centers.update(chunk_missing_centers)
        if progress_callback:
            progress_callback(24 + int((index / max(len(prepared_chunks), 1)) * 21), f"Resolvendo mapeamentos por lote ({index}/{max(len(prepared_chunks), 1)})")

    uncategorized_rows = [row for row in prepared_rows if row.get("plano_contas_id") is None]
    if uncategorized_rows:
        linhas = ", ".join(str(row.get("linha")) for row in uncategorized_rows[:20])
        sufixo = "" if len(uncategorized_rows) <= 20 else ", ..."
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Existem {len(uncategorized_rows)} lançamento(s) sem categoria definida. "
                f"Revise o mapeamento e categorize todas as linhas antes de confirmar. "
                f"Linhas: {linhas}{sufixo}"
            ),
        )

    if progress_callback:
        progress_callback(45, "Criando entidades e centros ausentes")
    if missing_entities:
        novos = [Entidade(nome=nome, tipo="AMBOS", cpf_cnpj=None, status="ATIVO", empresa_id=empresa_id) for nome in missing_entities.values()]
        db.add_all(novos)
        db.flush()
        for ent_key, entidade in zip(missing_entities.keys(), novos):
            nomes_entidades_sist[ent_key] = int(cast(int, entidade.id))

    if missing_centers:
        novos_centros = [CentroCusto(nome=nome, empresa_id=empresa_id) for nome in missing_centers.values()]
        db.add_all(novos_centros)
        db.flush()
        for centro_key, centro in zip(missing_centers.keys(), novos_centros):
            nomes_centros_sist[centro_key] = int(cast(int, centro.id))

    if progress_callback:
        progress_callback(55, "Inserindo lançamentos em lotes")
    erros: list[str] = []
    importados = 0
    ignorados_duplicidade = 0
    batch: list[Lancamento] = []

    existing_import_rows = db.exec(
        select(Lancamento.data_vencimento, Lancamento.descricao).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "IMPORTACAO",
        )
    ).all()
    imported_signatures: set[tuple[date, str]] = set()
    for existing_date, existing_desc in existing_import_rows:
        if existing_date is None:
            continue
        normalized_desc = _normalizar_texto_importacao(existing_desc)
        if not normalized_desc:
            continue
        imported_signatures.add((existing_date, normalized_desc))

    for index, row in enumerate(prepared_rows, start=1):
        try:
            data_vencimento = _parse_import_date(row["data_venc_raw"], parse_date_cache, dayfirst=inferred_dayfirst)
            if data_vencimento is None:
                continue
            data_pagamento = _parse_import_date(row["data_pag_raw"], parse_date_cache, dayfirst=inferred_dayfirst)
            valor = _parse_import_decimal(row["valor_raw"], parse_decimal_cache)
            plano_contas_id = row["plano_contas_id"]

            descricao_normalizada = _normalizar_texto_importacao(str(row["descricao"] or ""))
            signature = (data_vencimento, descricao_normalizada)
            if descricao_normalizada and signature in imported_signatures:
                ignorados_duplicidade += 1
                continue

            entidade_id = row["entidade_id"]
            if entidade_id is None and row["entidade_key"]:
                entidade_id = nomes_entidades_sist.get(str(row["entidade_key"]))

            centro_custo_id = row["centro_custo_id"]
            if centro_custo_id is None and row["centro_key"]:
                centro_custo_id = nomes_centros_sist.get(str(row["centro_key"]))

            batch.append(
                Lancamento(
                    descricao=str(row["descricao"] or "").strip(),
                    tipo=str(row["tipo"]),
                    origem="IMPORTACAO",
                    valor_previsto=valor,
                    valor_pago=valor if data_pagamento else Decimal("0.00"),
                    data_vencimento=data_vencimento,
                    data_pagamento=data_pagamento,
                    data_competencia=data_vencimento,
                    empresa_id=empresa_id,
                    plano_contas_id=int(plano_contas_id),
                    entidade_id=int(entidade_id) if entidade_id else None,
                    conta_id=int(row["conta_id"]) if row["conta_id"] else None,
                    centro_custo_id=int(centro_custo_id) if centro_custo_id else None,
                    ipp=False,
                )
            )
            if descricao_normalizada:
                imported_signatures.add(signature)
            importados += 1

            if len(batch) >= IMPORT_INSERT_BATCH_SIZE:
                _flush_lancamento_batch(db, batch)
                batch = []

            if progress_callback and index % 1000 == 0:
                progress_callback(55 + int((index / max(total_rows, 1)) * 40), f"Importando lançamentos ({index}/{total_rows})")
        except Exception as exc:
            logger.error(f"Erro na linha {row['linha']}: {exc}")
            erros.append(f"Linha {row['linha']}: {str(exc)}")

    if batch:
        _flush_lancamento_batch(db, batch)

    db.commit()
    return {
        "sucesso": True,
        "importados": importados,
        "ignorados_duplicidade": ignorados_duplicidade,
        "erros": erros,
        "meta": {
            "total_linhas": total_rows,
            "date_format_detected": "DD/MM/YYYY" if inferred_dayfirst else "MM/DD/YYYY",
        },
    }


def _run_import_analysis_job(job_id: str, empresa_id: int, user_id: int, file_bytes: bytes) -> None:
    try:
        _update_import_job(job_id, status="RUNNING", progress=1, message="Preparando análise")
        with Session(engine) as session:
            session.info["audit_user_id"] = user_id
            result = _analyze_import_contents(
                session,
                file_bytes,
                empresa_id,
                progress_callback=lambda progress, message: _update_import_job(job_id, status="RUNNING", progress=progress, message=message),
            )
        _update_import_job(job_id, status="COMPLETED", progress=100, message="Análise concluída", result=result)
    except Exception as exc:
        logger.exception("Erro no job de análise de importação")
        _update_import_job(job_id, status="ERROR", progress=100, message="Falha na análise", error=str(exc))


def _run_import_execute_job(job_id: str, empresa_id: int, user_id: int, file_bytes: bytes, mapeamento: dict[str, Any]) -> None:
    try:
        _update_import_job(job_id, status="RUNNING", progress=1, message="Preparando importação")
        with Session(engine) as session:
            session.info["audit_user_id"] = user_id
            result = _execute_import_contents(
                session,
                file_bytes,
                empresa_id,
                user_id,
                mapeamento,
                progress_callback=lambda progress, message: _update_import_job(job_id, status="RUNNING", progress=progress, message=message),
            )
        _update_import_job(job_id, status="COMPLETED", progress=100, message="Importação concluída", result=result)
    except Exception as exc:
        logger.exception("Erro no job de execução de importação")
        _update_import_job(job_id, status="ERROR", progress=100, message="Falha na importação", error=str(exc))


def _normalizar_texto_importacao(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-zA-Z0-9]+", " ", normalized.lower()).strip()
    return re.sub(r"\s+", " ", normalized)


def _normalizar_descricao_aprendizado(value: Any) -> str:
    stopwords = {
        "de", "da", "do", "das", "dos", "para", "com", "sem", "por", "via", "pix", "ted", "doc",
        "pgto", "pagamento", "recebimento", "receber", "pagar", "nf", "nfe", "boleto", "transferencia",
    }
    tokens = [token for token in _normalizar_texto_importacao(value).split() if len(token) > 2 and token not in stopwords]
    return " ".join(tokens[:10])


def _tokenizar_descricao_aprendizado(value: Any) -> tuple[str, ...]:
    normalized = _normalizar_descricao_aprendizado(value)
    if not normalized:
        return ()
    return tuple(dict.fromkeys(token for token in normalized.split() if token))


def _similaridade_texto_importacao(left: str, right: str) -> float:
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


def _append_learning_reference(
    refs: list[dict[str, Any]],
    descricao: Any,
    tipo: str,
    plano_contas_id: Optional[int] = None,
    entidade_id: Optional[int] = None,
    source: str = "historico",
) -> None:
    descricao_norm = _normalizar_descricao_aprendizado(descricao)
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


def _build_learning_reference_index(refs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    token_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ref in refs:
        for token in cast(tuple[str, ...], ref.get("tokens") or ()): 
            token_index[token].append(ref)
    return token_index


def _select_learning_candidates(
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


def _load_learning_references(session: Session, empresa_id: int) -> list[dict[str, Any]]:
    rows = session.exec(
        select(Lancamento.descricao, Lancamento.tipo, Lancamento.plano_contas_id, Lancamento.entidade_id)
        .where(Lancamento.empresa_id == empresa_id, Lancamento.is_deleted == False)
    ).all()
    refs: list[dict[str, Any]] = []
    for descricao, tipo, plano_contas_id, entidade_id in rows:
        if plano_contas_id is None and entidade_id is None:
            continue
        _append_learning_reference(refs, descricao, str(tipo or ""), plano_contas_id, entidade_id, "historico")
    return refs


def _infer_learning_ids(
    descricao: str,
    tipo: str,
    refs: list[dict[str, Any]],
    learning_ref_index: dict[str, list[dict[str, Any]]],
) -> dict[str, Optional[int] | float]:
    descricao_norm = _normalizar_descricao_aprendizado(descricao)
    if not descricao_norm:
        return {"plano_contas_id": None, "plano_score": 0.0, "entidade_id": None, "entidade_score": 0.0}

    categoria_scores: dict[int, float] = defaultdict(float)
    entidade_scores: dict[int, float] = defaultdict(float)

    candidates = _select_learning_candidates(descricao_norm, tipo, refs, learning_ref_index)
    for ref in candidates:
        score = _similaridade_texto_importacao(descricao_norm, str(ref.get("descricao") or ""))
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


def _build_import_suggestions(
    df: pd.DataFrame,
    col_desc: str,
    col_tipo: str,
    col_cat: str,
    col_entidade: str,
    conflitos: dict[str, list[str]],
    learning_refs: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    categoria_votes: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    entidade_votes: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    learning_ref_index = _build_learning_reference_index(learning_refs)

    conflitos_categoria = {str(item).strip() for item in conflitos.get("categorias", []) if str(item).strip()}
    conflitos_entidade = {str(item).strip() for item in conflitos.get("entidades", []) if str(item).strip()}

    for _, row in df.iterrows():
        descricao = str(row[col_desc]).strip() if col_desc and pd.notna(row[col_desc]) else ""
        if not descricao:
            continue
        tipo_raw = str(row[col_tipo]).upper().strip() if col_tipo and pd.notna(row[col_tipo]) else ""
        tipo = "RECEITA" if tipo_raw.startswith("R") else ("DESPESA" if tipo_raw.startswith("D") else "")
        categoria_nome = str(row[col_cat]).strip() if col_cat and pd.notna(row[col_cat]) else ""
        entidade_nome = str(row[col_entidade]).strip() if col_entidade and pd.notna(row[col_entidade]) else ""
        suggestion = _infer_learning_ids(descricao, tipo, learning_refs, learning_ref_index)

        plano_sugerido = suggestion.get("plano_contas_id")
        if categoria_nome in conflitos_categoria and plano_sugerido is not None:
            categoria_votes[categoria_nome][int(plano_sugerido)] += float(suggestion.get("plano_score") or 0)

        entidade_sugerida = suggestion.get("entidade_id")
        if entidade_nome in conflitos_entidade and entidade_sugerida is not None:
            entidade_votes[entidade_nome][int(entidade_sugerida)] += float(suggestion.get("entidade_score") or 0)

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

    return {
        "categorias": consolidate(categoria_votes),
        "entidades": consolidate(entidade_votes),
    }


def _format_preview_value(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if pd.isna(value):
        return ""
    if isinstance(value, (date, datetime)):
        try:
            return value.strftime("%Y-%m-%d")
        except Exception:
            return str(value)
    return str(value).strip()

# Padronizado para usar get_db
def get_service(session: Session = Depends(get_db)) -> LancamentoService:
    return LancamentoService(session)

def require_empresa_user(current_user: Usuario) -> Tuple[int, int]:
    if current_user.empresa_id is None or current_user.id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário sem empresa ou identificação válida."
        )
    return current_user.empresa_id, current_user.id

# ==========================================
# CRUD BÁSICO
# ==========================================

@router.get("/", response_model=List[LancamentoRead])
def listar_lancamentos(
    skip: int = 0,
    limit: int = 100,
    data_inicio: Optional[date] = Query(None),
    data_fim: Optional[date] = Query(None),
    conta_id: Optional[int] = Query(None),
    include_anexos: bool = Query(True),
    sem_paginacao: bool = Query(False),
    somente_pagos: bool = Query(False),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista lançamentos com paginação."""
    safe_limit = max(1, min(limit, 10000))
    safe_skip = max(skip, 0)

    relation_loader = selectinload(cast(Any, Lancamento.anexos)) if include_anexos else noload(cast(Any, Lancamento.anexos))
    query = select(Lancamento).options(relation_loader).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False
    )
    if data_inicio:
        query = query.where(Lancamento.data_vencimento >= data_inicio)
    if data_fim:
        query = query.where(Lancamento.data_vencimento <= data_fim)
    if conta_id:
        query = query.where(Lancamento.conta_id == conta_id)
    if somente_pagos:
        query = query.where(
            (col(Lancamento.status) == "PAGO")
            | (Lancamento.data_pagamento.is_not(None))
            | (col(Lancamento.valor_pago) != 0)
        )

    query = query.order_by(col(Lancamento.data_vencimento).asc())
    if not sem_paginacao:
        query = query.offset(safe_skip).limit(safe_limit)

    results = db.exec(query).all()
    if not include_anexos:
        for item in results:
            item.anexos = []
    return results

@router.post("/", response_model=LancamentoRead, status_code=status.HTTP_201_CREATED)
def criar_lancamento(lancamento_in: LancamentoCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.create(dados=lancamento_in, empresa_id=empresa_id, user_id=user_id)

@router.get("/{lancamento_id}", response_model=LancamentoRead)
def obter_lancamento(lancamento_id: int, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, _ = require_empresa_user(current_user)
    return service.get_by_id(lancamento_id, empresa_id)

@router.get("/parcelamento/{parcelamento_id}", response_model=List[LancamentoRead])
def listar_por_parcelamento(parcelamento_id: str, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, _ = require_empresa_user(current_user)
    return service.listar_por_parcelamento(parcelamento_id, empresa_id)

@router.put("/{lancamento_id}", response_model=LancamentoRead)
def atualizar_lancamento(lancamento_id: int, lancamento_in: LancamentoUpdate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.update(lancamento_id=lancamento_id, dados_atualizacao=lancamento_in, empresa_id=empresa_id, user_id=user_id)

@router.delete("/{lancamento_id}", status_code=status.HTTP_204_NO_CONTENT)
def deletar_lancamento(
    lancamento_id: int,
    confirmar_exclusao_pagos: bool = Query(False),
    service: LancamentoService = Depends(get_service),
    current_user: Usuario = Depends(get_current_user),
):
    empresa_id, user_id = require_empresa_user(current_user)
    service.delete(lancamento_id, empresa_id, user_id, confirmar_exclusao_pagos=confirmar_exclusao_pagos)

# ==========================================
# AÇÕES EM MASSA (BULK)
# ==========================================

@router.post("/bulk", response_model=List[LancamentoRead], status_code=status.HTTP_201_CREATED)
def criar_multiplos(lista_in: List[LancamentoCreate], service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.criar_em_massa(lista_in, empresa_id, user_id)

@router.post("/bulk-delete")
def deletar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    service.deletar_em_massa(
        payload.ids,
        empresa_id,
        user_id,
        confirmar_exclusao_pagos=bool(payload.confirmar_exclusao_pagos),
    )
    return {"msg": "Lançamentos deletados com sucesso"}

@router.post("/bulk-pay")
def baixar_multiplos(payload: BulkActionSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    if payload.data_pagamento is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Data de pagamento é obrigatória."
        )
    atualizados = service.baixar_em_massa(ids=payload.ids, data_pagamento=payload.data_pagamento, conta_id=payload.conta_id, empresa_id=empresa_id, user_id=user_id)
    return {"msg": f"{atualizados} lançamentos baixados com sucesso"}

@router.post("/bulk-update")
def atualizar_multiplos(payload: BulkUpdateSchema, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.atualizar_em_massa(payload=payload, empresa_id=empresa_id, user_id=user_id)

# ==========================================
# AÇÕES ESPECIAIS E ANEXOS
# ==========================================

@router.post("/transferir")
def transferir_valores(transf_in: TransferenciaCreate, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    return service.transferir(transf_in, empresa_id, user_id)

@router.post("/{lancamento_id}/anexos", response_model=List[AnexoRead])
def upload_anexos(lancamento_id: int, files: List[UploadFile] = File(...), tipo: str = Query("OUTROS"), request: Request = None, service: LancamentoService = Depends(get_service), current_user: Usuario = Depends(get_current_user)):
    anexos_criados = []
    empresa_id, user_id = require_empresa_user(current_user)
    origin = request.client.host if request and request.client else "unknown"

    if not files:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="nenhum_arquivo_enviado",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhum arquivo enviado.")
    if len(files) > MAX_ANEXOS_PER_REQUEST:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="limite_anexos_por_requisicao_excedido",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Máximo de {MAX_ANEXOS_PER_REQUEST} anexos por requisição.",
        )

    tipo_normalizado = re.sub(r"[^A-Z0-9_]+", "_", str(tipo or "OUTROS").upper()).strip("_")
    if not tipo_normalizado:
        tipo_normalizado = "OUTROS"
    if len(tipo_normalizado) > 40:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            reason="tipo_anexo_invalido",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tipo de anexo inválido.")

    # Garante que o lançamento existe e pertence à empresa do usuário antes de salvar arquivos.
    service.get_by_id(lancamento_id, empresa_id)

    for file in files:
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Arquivo inválido: nome do arquivo ausente."
            )
        nome_arquivo = Path(file.filename).name.strip()
        if not nome_arquivo:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo inválido: nome do arquivo ausente.")
        if len(nome_arquivo) > MAX_ANEXO_NOME_LEN:
            register_upload_rejection(
                endpoint="/api/v1/lancamentos/{id}/anexos",
                empresa_id=empresa_id,
                user_id=user_id,
                origin=origin,
                reason="nome_arquivo_excede_limite",
                filename=nome_arquivo,
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome do arquivo excede o limite permitido.")

        destino_dir = UPLOAD_ANEXOS_DIR / str(empresa_id) / str(lancamento_id)
        destino_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(nome_arquivo).suffix.lower()[:12]
        nome_storage = f"{uuid.uuid4().hex}{ext}"
        destino_arquivo = destino_dir / nome_storage

        try:
            _, tamanho_bytes, content_type = write_validated_upload_file(
                upload=file,
                destination=destino_arquivo,
                max_size=MAX_ANEXO_SIZE,
                allowed_ext_to_mime=ANEXO_ALLOWED_EXT_TO_MIME,
                max_filename_len=MAX_ANEXO_NOME_LEN,
            )
        except UploadValidationError as exc:
            if exc.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE:
                register_upload_rejection(
                    endpoint="/api/v1/lancamentos/{id}/anexos",
                    empresa_id=empresa_id,
                    user_id=user_id,
                    origin=origin,
                    reason="arquivo_muito_grande",
                    filename=nome_arquivo,
                )
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Arquivo muito grande. Máximo 10MB por anexo.",
                )
            register_upload_rejection(
                endpoint="/api/v1/lancamentos/{id}/anexos",
                empresa_id=empresa_id,
                user_id=user_id,
                origin=origin,
                reason=str(exc.message),
                filename=nome_arquivo,
            )
            raise HTTPException(status_code=exc.status_code, detail=exc.message)

        register_upload_success(
            endpoint="/api/v1/lancamentos/{id}/anexos",
            empresa_id=empresa_id,
            user_id=user_id,
            origin=origin,
            bytes_written=tamanho_bytes,
        )

        url_relativa = f"/static/uploads/lancamentos/{empresa_id}/{lancamento_id}/{nome_storage}"
        dados = AnexoCreate(
            nome_arquivo=nome_arquivo,
            url=url_relativa,
            tipo=tipo_normalizado,
            tamanho_bytes=tamanho_bytes,
            content_type=content_type,
            lancamento_id=lancamento_id,
            empresa_id=empresa_id,
        )
        anexos_criados.append(service.adicionar_anexo(lancamento_id, dados, empresa_id, user_id))
    return anexos_criados


@router.delete("/{lancamento_id}/anexos/{anexo_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/{lancamento_id}/anexos/{anexo_id}/delete", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def delete_anexo_lancamento(
    lancamento_id: int,
    anexo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    empresa_id, _ = require_empresa_user(current_user)

    # Garante que o lançamento pertence à empresa autenticada.
    lancamento = db.exec(
        select(Lancamento).where(
            Lancamento.id == lancamento_id,
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
        )
    ).first()
    if not lancamento:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")

    anexo = db.exec(
        select(AnexoLancamento).where(
            AnexoLancamento.id == anexo_id,
            AnexoLancamento.lancamento_id == lancamento_id,
            AnexoLancamento.empresa_id == empresa_id,
        )
    ).first()
    if not anexo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anexo não encontrado.")

    url = str(anexo.url or "")
    arquivo_local = safe_local_path_from_static_url(
        url,
        required_prefix="/static/uploads/lancamentos/",
    )

    if url.startswith("/static/uploads/lancamentos/") and arquivo_local is None:
        register_upload_rejection(
            endpoint="/api/v1/lancamentos/{id}/anexos/{anexo_id}",
            empresa_id=empresa_id,
            user_id=getattr(current_user, "id", None),
            origin=request.client.host if request and request.client else "unknown",
            reason="tentativa_path_traversal_ou_url_invalida",
            filename=str(anexo.nome_arquivo or ""),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL de anexo inválida.")

    if arquivo_local:
        arquivo_local.unlink(missing_ok=True)

    db.delete(anexo)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# ==========================================
# IMPORTAÇÃO INTELIGENTE (VERSÃO SÊNIOR)
# ==========================================

def encontrar_coluna(df: pd.DataFrame, possiveis_nomes: list) -> str:
    colunas_upper = {c.upper().strip(): c for c in df.columns}
    for nome in possiveis_nomes:
        if nome in colunas_upper: return colunas_upper[nome]
    return ""

@router.get("/importar/modelo", response_class=StreamingResponse)
def download_modelo_importacao():
    df = pd.DataFrame(columns=["DATA VENCIMENTO", "DATA PAGAMENTO", "DESCRIÇÃO", "VALOR", "CONTA", "CATEGORIA", "CENTRO DE CUSTO", "ENTIDADE"])
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        df.to_excel(writer, index=False, sheet_name='Importacao')
    output.seek(0)
    return StreamingResponse(output, headers={'Content-Disposition': 'attachment; filename="modelo_kyrus.xlsx"'}, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@router.post("/importar/analisar")
def analisar_arquivo_importacao(file: UploadFile = File(...), session: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    empresa_id, _ = require_empresa_user(current_user)
    return _analyze_import_contents(session, file.file.read(), empresa_id)


@router.post("/importar/analisar-async", status_code=status.HTTP_202_ACCEPTED)
async def analisar_arquivo_importacao_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_user),
):
    empresa_id, user_id = require_empresa_user(current_user)
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo deve ser XLSX ou XLS")
    file_bytes = await file.read()
    job = _create_import_job("ANALYZE", empresa_id, user_id, file.filename)
    background_tasks.add_task(_run_import_analysis_job, job.job_id, empresa_id, user_id, file_bytes)
    return {"job_id": job.job_id, "status": job.status}


@router.get("/importar/jobs/{job_id}")
def obter_status_job_importacao(job_id: str, current_user: Usuario = Depends(get_current_user)):
    empresa_id, user_id = require_empresa_user(current_user)
    with IMPORT_JOBS_LOCK:
        job = IMPORT_JOBS.get(job_id)
    if not job or job.empresa_id != empresa_id or job.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job de importação não encontrado")
    return _serialize_import_job(job)


# ==========================================
# IMPORTAÇÃO INTELIGENTE
# ==========================================

class ImportacaoRequest:
    """Requisição para importação via formulário."""
    file: UploadFile
    mapeamento_json: str


@router.post("/importar/executar")
async def importar_executar(
    file: UploadFile = File(...),
    mapeamento_json: str = Form(...),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user)
):
    """
    Endpoint para importação de lançamentos com mapeamento de categorias.
    Recebe arquivo XLSX e JSON com mapeamento de categorias/entidades/contas/centros.
    """
    if not file.filename or not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Arquivo deve ser XLSX ou XLS"
        )
    
    try:
        mapeamento = json.loads(mapeamento_json)
        empresa_id, user_id = require_empresa_user(current_user)
        conteudo = await file.read()
        return _execute_import_contents(db, conteudo, empresa_id, user_id, mapeamento)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao processar importação: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao processar arquivo: {str(e)}"
        )


@router.post("/importar/executar-async", status_code=status.HTTP_202_ACCEPTED)
async def importar_executar_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    mapeamento_json: str = Form(...),
    current_user: Usuario = Depends(get_current_user),
):
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Arquivo deve ser XLSX ou XLS")
    try:
        mapeamento = json.loads(mapeamento_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mapeamento inválido") from exc

    empresa_id, user_id = require_empresa_user(current_user)
    file_bytes = await file.read()
    job = _create_import_job("EXECUTE", empresa_id, user_id, file.filename)
    background_tasks.add_task(_run_import_execute_job, job.job_id, empresa_id, user_id, file_bytes, mapeamento)
    return {"job_id": job.job_id, "status": job.status}