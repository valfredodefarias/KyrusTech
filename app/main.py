# app/main.py

import os
import re
import sys
import asyncio
import time
from collections import defaultdict, deque
from datetime import datetime
from threading import Event, Lock
from pathlib import Path
from subprocess import run
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.openapi.docs import get_swagger_ui_html
from loguru import logger
from sqlalchemy import text
from sqlmodel import Session
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.audit_context import set_audit_request, clear_audit_context
from app.db.session import engine
from app.services.access_seed_service import ensure_rbac_seed
from app.services.integracao_scheduler import run_integracao_scheduler

# --- CRIAR DIRETÓRIOS NECESSÁRIOS ---
os.makedirs("static/uploads", exist_ok=True)
ROOT_DIR = Path(__file__).resolve().parent.parent
MIGRATION_LOCK_ID = 24030901
SCHEDULER_STOP_EVENT = Event()
SCHEDULER_TASK: asyncio.Task | None = None
BUSINESS_TZ = ZoneInfo("America/Sao_Paulo")
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_API_MAX_REQUESTS = 180
RATE_LIMIT_UPLOAD_MAX_REQUESTS = 12
RATE_LIMIT_UPLOAD_PATH_MARKERS = (
    "/upload",
    "/anexos",
    "/foto",
    "/importacao",
)
_RATE_LIMIT_LOCK = Lock()
_RATE_LIMIT_EVENTS: dict[str, deque[float]] = defaultdict(deque)


def _should_auto_run_migrations() -> bool:
    value = os.getenv("AUTO_RUN_MIGRATIONS", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _run_startup_migrations() -> None:
    if not _should_auto_run_migrations():
        logger.info("Auto migration disabled by AUTO_RUN_MIGRATIONS")
        return

    connection = None
    try:
        logger.info("Checking database migrations before serving requests")
        connection = engine.raw_connection()
        cursor = connection.cursor()
        cursor.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_ID,))

        result = run(
            [sys.executable, "scripts/run_migrations.py"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=False,
        )

        if result.stdout.strip():
            logger.info(result.stdout.strip())
        if result.stderr.strip():
            logger.warning(result.stderr.strip())

        if result.returncode != 0:
            logger.error("Alembic migrations failed during application startup; applying legacy compatibility patch")
            _apply_legacy_schema_compatibility()
            logger.warning("Application started with compatibility schema patch because Alembic history is broken")
            return

        logger.success("Database migrations are up to date")
        _apply_legacy_schema_compatibility()
    finally:
        if connection is not None:
            try:
                cursor = connection.cursor()
                cursor.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,))
            except Exception as exc:
                logger.warning(f"Could not release migration advisory lock: {exc}")
            connection.close()


def _ensure_rbac_defaults() -> None:
    try:
        with Session(engine) as session:
            stats = ensure_rbac_seed(session)
            logger.info(
                "RBAC seed ensured: permissions={}, templates={}, company_profiles={}, user_assignments={}",
                stats.get("permissions_created", 0),
                stats.get("templates_created", 0),
                stats.get("company_profiles_created", 0),
                stats.get("user_assignments_created", 0),
            )
    except Exception as exc:
        logger.warning(f"RBAC seed could not be ensured at startup: {exc}")


def _apply_legacy_schema_compatibility() -> None:
    statements = [
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS tipo_pessoa VARCHAR DEFAULT 'PJ'",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS nome_fantasia VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS email VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS telefone VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS celular VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS contato_nome VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS cep VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS logradouro VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS numero VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS complemento VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS bairro VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS cidade VARCHAR",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS uf VARCHAR(2)",
        "ALTER TABLE entidades ADD COLUMN IF NOT EXISTS observacoes TEXT",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_pessoa VARCHAR DEFAULT 'PJ'",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS agencia VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_numero VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_digito VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS logo_url VARCHAR",
        "ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_como_disponibilidade BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nome VARCHAR",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_url VARCHAR",
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS consultor_role VARCHAR NOT NULL DEFAULT 'USUARIO_NORMAL'",
        "ALTER TABLE usuarios ALTER COLUMN empresa_id DROP NOT NULL",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS previsto BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS competencia VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS import_hash VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS movimento_uid VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS referencia_externa VARCHAR",
        "ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS ofx_bank_id VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_movimento_uid ON lancamentos (movimento_uid)",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_referencia_externa ON lancamentos (referencia_externa)",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_ofx_bank_id ON lancamentos (ofx_bank_id)",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS intervalo_sincronizacao_minutos INTEGER NOT NULL DEFAULT 60",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS data_inicio_sincronizacao DATE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS ultima_sincronizacao TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS proxima_sincronizacao TIMESTAMP WITHOUT TIME ZONE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS categoria_padrao_id INTEGER",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS usar_categoria_a_categorizar BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE integracoes_bancarias ADD COLUMN IF NOT EXISTS centro_custo_id INTEGER",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS eh_operacional BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE plano_contas ADD COLUMN IF NOT EXISTS dre_grupo VARCHAR NOT NULL DEFAULT 'DESPESAS_OPERACIONAIS'",
        "UPDATE entidades SET tipo_pessoa = CASE WHEN upper(coalesce(cpf_cnpj, '')) ~ '^[0-9]{12,}$' THEN 'PJ' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_FISICA', 'PF') THEN 'PF' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_JURIDICA', 'PJ') THEN 'PJ' ELSE coalesce(tipo_pessoa, 'PJ') END WHERE tipo_pessoa IS NULL OR trim(tipo_pessoa) = ''",
        "UPDATE entidades SET tipo = CASE WHEN upper(coalesce(tipo, '')) IN ('CLIENTE', 'FORNECEDOR', 'AMBOS') THEN upper(tipo) ELSE 'AMBOS' END WHERE tipo IS NULL OR upper(coalesce(tipo, '')) NOT IN ('CLIENTE', 'FORNECEDOR', 'AMBOS')",
        "CREATE INDEX IF NOT EXISTS ix_entidades_tipo_pessoa ON entidades (tipo_pessoa)",
        "ALTER TABLE cartoes ADD COLUMN IF NOT EXISTS bandeira VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_cartoes_bandeira ON cartoes (bandeira)",
        "ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo VARCHAR NOT NULL DEFAULT 'PRODUTO'",
        "CREATE INDEX IF NOT EXISTS ix_produtos_tipo ON produtos (tipo)",
        "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS pdv_config VARCHAR",
        "ALTER TABLE regras_cartao ADD COLUMN IF NOT EXISTS tipo_prazo VARCHAR DEFAULT 'DIAS_CORRIDOS'",
        "ALTER TABLE regras_cartao ADD COLUMN IF NOT EXISTS dia_fixo INTEGER",
        "ALTER TABLE regras_cartao ADD COLUMN IF NOT EXISTS fds_proximo_dia_util BOOLEAN DEFAULT TRUE",
        "ALTER TABLE regras_cartao ADD COLUMN IF NOT EXISTS modo_parcelamento VARCHAR DEFAULT 'PRO_RATA'",
        "ALTER TABLE regras_cartao ADD COLUMN IF NOT EXISTS taxa_antecipacao NUMERIC(5,2) DEFAULT 0.00",
        "CREATE INDEX IF NOT EXISTS ix_lancamentos_data_pagamento ON lancamentos (data_pagamento)",
        "CREATE INDEX IF NOT EXISTS idx_lancamentos_fast_bal ON lancamentos (empresa_id, conta_id) WHERE is_deleted = false AND (observacao IS NULL OR (observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' AND observacao NOT ILIKE '%\"legacy_id_venda\"%'))",
        "CREATE INDEX IF NOT EXISTS idx_lancamentos_no_legacy ON lancamentos (empresa_id) WHERE is_deleted = false AND (observacao IS NULL OR (observacao NOT ILIKE '%\"legacy_id_venda\"%'))",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

    # Criar tabelas se não existirem (caso Alembic falhe)
    from app.models.regra_cartao import RegraCartao
    from app.models.lote_cartao import LoteCartao
    from app.models.lote_cartao_item import LoteCartaoItem
    from app.models.idempotency_log import IdempotencyLog
    RegraCartao.__table__.create(bind=engine, checkfirst=True)
    LoteCartao.__table__.create(bind=engine, checkfirst=True)
    LoteCartaoItem.__table__.create(bind=engine, checkfirst=True)
    IdempotencyLog.__table__.create(bind=engine, checkfirst=True)


is_production = settings.ENVIRONMENT.lower() == "production"

# --- INICIALIZAR APLICAÇÃO ---
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API Backend do Kyrus ERP",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None if is_production else "/openapi.json"
)

from app.api.deps import IdempotencyCompletedException

@app.exception_handler(IdempotencyCompletedException)
async def idempotency_completed_handler(request: Request, exc: IdempotencyCompletedException):
    return JSONResponse(content=exc.response_body, status_code=200)



@app.on_event("startup")
def startup_event() -> None:
    global SCHEDULER_TASK
    _run_startup_migrations()
    if os.getenv("TESTING") != "1":
        _ensure_rbac_defaults()
        SCHEDULER_STOP_EVENT.clear()
        SCHEDULER_TASK = asyncio.create_task(run_integracao_scheduler(SCHEDULER_STOP_EVENT))


@app.on_event("shutdown")
async def shutdown_event() -> None:
    global SCHEDULER_TASK
    SCHEDULER_STOP_EVENT.set()
    if SCHEDULER_TASK is not None:
        try:
            await SCHEDULER_TASK
        except Exception as exc:
            logger.warning(f"Falha ao finalizar scheduler de integração: {exc}")
        finally:
            SCHEDULER_TASK = None

# --- CONFIGURAÇÃO DE CORS ---
# Converte CORS origins para lista se for string "*"
cors_origins = (
    ["*"] if isinstance(settings.BACKEND_CORS_ORIGINS, str) and settings.BACKEND_CORS_ORIGINS == "*"
    else settings.BACKEND_CORS_ORIGINS if isinstance(settings.BACKEND_CORS_ORIGINS, list)
    else []
)

if "*" in cors_origins and settings.ENVIRONMENT.lower() != "production":
    cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

if "*" not in cors_origins:
    cors_origins = [str(origin).strip().rstrip("/") for origin in cors_origins if str(origin).strip()]

if settings.BACKEND_PUBLIC_URL and settings.BACKEND_PUBLIC_URL not in cors_origins:
    cors_origins.append(settings.BACKEND_PUBLIC_URL.rstrip("/"))

allow_credentials = "*" not in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- COMPRESSÃO DE RESPOSTAS (JSON/HTML/JS/CSS) ---
app.add_middleware(GZipMiddleware, minimum_size=1000)

# --- CACHE PARA ARQUIVOS ESTÁTICOS E SPA ---
_HASHED_ASSET_PATTERN = re.compile(r"\.[a-f0-9]{8,}\.")
_CACHEABLE_EXTENSIONS = {
    ".js", ".css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot"
}


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if response.headers.get("content-type", "").startswith("text/html"):
        path = request.url.path
        if path in ("/docs", "/swagger", "/redoc"):
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self' https://cdn.jsdelivr.net; "
                "base-uri 'self'; "
                "frame-ancestors 'self'; "
                "object-src 'none'; "
                "img-src 'self' data: blob: https://fastapi.tiangolo.com; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
                "connect-src 'self' ws: wss: http: https:; "
                "font-src 'self' data: https://fonts.gstatic.com; "
                "worker-src 'self' blob:"
            )
        else:
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'; "
                "img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; connect-src 'self' ws: wss: http: https:; font-src 'self' data:; worker-src 'self' blob:"
            )
    return response


def _client_identifier(request: Request) -> str:
    from app.core.network import get_client_ip
    return get_client_ip(request)


def _rate_limit_for_path(path: str) -> tuple[int, int] | None:
    if not path.startswith("/api/"):
        return None

    if any(marker in path for marker in RATE_LIMIT_UPLOAD_PATH_MARKERS):
        return RATE_LIMIT_UPLOAD_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS

    return RATE_LIMIT_API_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS


def _register_rate_limit_event(*, key: str, now: float, window_seconds: int) -> int:
    bucket = _RATE_LIMIT_EVENTS[key]
    bucket.append(now)
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    return len(bucket)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or os.getenv("TESTING") == "1":
        return await call_next(request)

    rule = _rate_limit_for_path(request.url.path)
    if rule is None:
        return await call_next(request)

    max_requests, window_seconds = rule
    client_id = _client_identifier(request)
    bucket_name = "upload" if any(marker in request.url.path for marker in RATE_LIMIT_UPLOAD_PATH_MARKERS) else "api"
    key = f"{client_id}|{bucket_name}"

    now = time.time()
    with _RATE_LIMIT_LOCK:
        total = _register_rate_limit_event(key=key, now=now, window_seconds=window_seconds)

    if total > max_requests:
        logger.warning(
            "[RATE_LIMIT] bloqueado path=%s client=%s total=%s window_s=%s max=%s",
            request.url.path,
            client_id,
            total,
            window_seconds,
            max_requests,
        )
        return JSONResponse(
            status_code=429,
            content={"detail": "Muitas requisições. Tente novamente em instantes."},
        )

    response = await call_next(request)
    response.headers.setdefault("X-RateLimit-Limit", str(max_requests))
    response.headers.setdefault("X-RateLimit-Window", str(window_seconds))
    response.headers.setdefault("X-RateLimit-Remaining", str(max(0, max_requests - total)))
    return response


@app.middleware("http")
async def cache_headers_middleware(request: Request, call_next):
    response = await call_next(request)

    path = request.url.path
    content_type = response.headers.get("content-type", "")

    if path.startswith("/api/"):
        return response

    if content_type.startswith("text/html"):
        response.headers["Cache-Control"] = "no-cache"
        return response

    ext = os.path.splitext(path)[1].lower()
    if path.startswith("/static/") or path.startswith("/assets/") or ext in _CACHEABLE_EXTENSIONS:
        if _HASHED_ASSET_PATTERN.search(path):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=86400"

    return response


@app.middleware("http")
async def audit_context_middleware(request: Request, call_next):
    from app.core.network import get_client_ip
    client_host = get_client_ip(request)
    user_agent = request.headers.get("user-agent")
    set_audit_request(client_host, user_agent)
    try:
        response = await call_next(request)
    finally:
        clear_audit_context()
    return response

# --- SERVIR ARQUIVOS ESTÁTICOS ---
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- ENDPOINTS PRINCIPAIS ---
@app.get("/docs", include_in_schema=False)
async def custom_redoc_html():
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(status_code=404, detail="Not Found")
    html_content = """
    <!DOCTYPE html>
    <html>
      <head>
        <title>Kyrus ERP - Documentação de API</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" type="image/png" href="https://fastapi.tiangolo.com/img/favicon.png">
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: 'Plus Jakarta Sans', sans-serif;
          }
        </style>
      </head>
      <body>
        <div id="redoc-container"></div>
        <script src="https://cdn.jsdelivr.net/npm/redoc@latest/bundles/redoc.standalone.js"> </script>
        <script>
          Redoc.init('/openapi.json', {
            theme: {
              colors: {
                primary: {
                  main: '#0284c7'
                },
                success: {
                  main: '#10b981'
                },
                warning: {
                  main: '#f59e0b'
                },
                error: {
                  main: '#ef4444'
                },
                text: {
                  primary: '#0f172a',
                  secondary: '#64748b'
                },
                responses: {
                  success: {
                    color: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.06)'
                  }
                }
              },
              typography: {
                fontSize: '14px',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                headings: {
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: '700'
                },
                code: {
                  fontFamily: "'Fira Code', monospace",
                  fontSize: '13px',
                  backgroundColor: '#f1f5f9',
                  color: '#0f172a'
                }
              },
              sidebar: {
                backgroundColor: '#0f172a',
                textColor: '#94a3b8',
                activeTextColor: '#ffffff',
                width: '260px'
              },
              rightPanel: {
                backgroundColor: '#1e293b',
                textColor: '#e2e8f0',
                width: '40%'
              }
            },
            scrollYOffset: 0,
            hideDownloadButton: false,
            expandResponses: "200,201",
            nativeScrollbars: true,
            pathInMiddlePanel: true
          }, document.getElementById('redoc-container'));
        </script>
      </body>
    </html>
    """
    return HTMLResponse(content=html_content, status_code=200)

@app.get("/swagger", include_in_schema=False)
async def custom_swagger_ui():
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(status_code=404, detail="Not Found")
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - Interactive API",
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        swagger_js_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
    )

@app.get("/", tags=["Root"])
async def read_root():
    """Endpoint raiz da API"""
    is_prod = settings.ENVIRONMENT.lower() == "production"
    return {
        "message": f"Bem-vindo à API do {settings.PROJECT_NAME}",
        "environment": settings.ENVIRONMENT,
        "docs": None if is_prod else "/docs",
        "swagger": None if is_prod else "/swagger",
        "openapi": None if is_prod else "/openapi.json"
    }

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check para verificar se a API está online"""
    now = datetime.now(BUSINESS_TZ)
    return {
        "status": "ok",
        "message": "API is running",
        "server_datetime": now.isoformat(),
        "server_date": now.date().isoformat(),
        "server_timezone": "America/Sao_Paulo",
    }

# --- INCLUIR ROTAS ---
app.include_router(api_router, prefix=settings.API_V1_STR)

# --- SERVIR FRONTEND (SPA) ---
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    """
    Serve os arquivos do frontend (kyrus-web).
    Isso permite que o React Router funcione corretamente.
    """
    frontend_dist = ROOT_DIR / "kyrus-web" / "dist"
    legacy_frontend = ROOT_DIR / "frontend"
    
    # Se for um arquivo com extensão conhecida, tenta servir
    if "." in full_path and not full_path.endswith("/"):
        file_path = frontend_dist / full_path
        if file_path.exists():
            return FileResponse(file_path)
        legacy_path = legacy_frontend / full_path
        if legacy_path.exists():
            return FileResponse(legacy_path)
    
    # Caso contrário, redireciona para index.html (SPA)
    index_path = frontend_dist / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    
    return {"error": "Frontend não foi compilado. Execute: cd kyrus-web && npm run build"}
