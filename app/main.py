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
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Response
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
from app.core.audit_context import set_audit_request, set_current_http_request, clear_audit_context
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
            logger.error("Alembic migrations failed during application startup")
            return

        logger.success("Database migrations are up to date")
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



@asynccontextmanager
async def lifespan(app: FastAPI):
    global SCHEDULER_TASK
    
    # GC Tuning
    import gc
    gc.set_threshold(1000, 10, 10)
    logger.info("Garbage Collector tuned: threshold set to (1000, 10, 10)")

    # SQLAlchemy Pool Pre-warming
    if os.getenv("TESTING") != "1":
        try:
            logger.info("Pre-warming SQLAlchemy connection pool...")
            conns = [engine.connect() for _ in range(settings.DATABASE_POOL_SIZE)]
            for conn in conns:
                conn.close()
            logger.success(f"Connection pool pre-warmed with {settings.DATABASE_POOL_SIZE} connections.")
        except Exception as exc:
            logger.warning(f"Could not pre-warm connection pool: {exc}")

    from app.core.cache import register_cache_listeners
    register_cache_listeners()
    _run_startup_migrations()
    if os.getenv("TESTING") != "1" and os.getenv("DISABLE_SCHEDULER") != "1":
        _ensure_rbac_defaults()
        SCHEDULER_STOP_EVENT.clear()
        SCHEDULER_TASK = asyncio.create_task(run_integracao_scheduler(SCHEDULER_STOP_EVENT))
    
    from app.websockets.manager import manager
    await manager.connect_redis()
    
    yield
    
    await manager.disconnect_redis()
    SCHEDULER_STOP_EVENT.set()
    if SCHEDULER_TASK is not None:
        try:
            await SCHEDULER_TASK
        except Exception as exc:
            logger.warning(f"Falha ao finalizar scheduler de integração: {exc}")
        finally:
            SCHEDULER_TASK = None

is_production = settings.ENVIRONMENT.lower() == "production"

# --- INICIALIZAR APLICAÇÃO ---
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API Backend do Kyrus ERP",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None if is_production else "/openapi.json",
    lifespan=lifespan
)

from app.api.deps import IdempotencyCompletedException

@app.exception_handler(IdempotencyCompletedException)
async def idempotency_completed_handler(request: Request, exc: IdempotencyCompletedException):
    return JSONResponse(content=exc.response_body, status_code=200)

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
    max_age=86400,
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

    max_requests_ip, window_seconds_ip = rule
    client_id_ip = _client_identifier(request)
    bucket_name = "upload" if any(marker in request.url.path for marker in RATE_LIMIT_UPLOAD_PATH_MARKERS) else "api"
    key_ip = f"{client_id_ip}|{bucket_name}"

    # Identifica se a requisição é autenticada por Chave de API
    api_key_header = request.headers.get("x-api-key")
    auth_header = request.headers.get("authorization")
    raw_key = None
    if api_key_header and api_key_header.strip().startswith("kyr_"):
        raw_key = api_key_header.strip()
    elif auth_header:
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].startswith("kyr_"):
            raw_key = parts[1].strip()

    now = time.time()
    with _RATE_LIMIT_LOCK:
        total_ip = _register_rate_limit_event(key=key_ip, now=now, window_seconds=window_seconds_ip)
        total_key = None
        max_requests_key = None
        window_seconds_key = None
        if raw_key:
            key_prefix = raw_key[:13]
            max_requests_key = getattr(settings, "RATE_LIMIT_API_KEY_MAX_REQUESTS", 120)
            window_seconds_key = RATE_LIMIT_WINDOW_SECONDS
            key_api = f"apikey:{key_prefix}"
            total_key = _register_rate_limit_event(key=key_api, now=now, window_seconds=window_seconds_key)

    def _attach_cors(resp: JSONResponse):
        origin = request.headers.get("origin")
        if origin:
            normalized_origin = origin.strip().rstrip("/")
            if normalized_origin in cors_origins or "*" in cors_origins:
                resp.headers["Access-Control-Allow-Origin"] = origin
                resp.headers["Access-Control-Allow-Credentials"] = "true"
                resp.headers["Access-Control-Allow-Methods"] = "*"
                resp.headers["Access-Control-Allow-Headers"] = "*"

    # Bloqueio 1: Limite por IP
    if total_ip > max_requests_ip:
        logger.warning(
            "[RATE_LIMIT] bloqueado por IP path=%s client=%s total=%s window_s=%s max=%s",
            request.url.path,
            client_id_ip,
            total_ip,
            window_seconds_ip,
            max_requests_ip,
        )
        response = JSONResponse(
            status_code=429,
            content={"detail": "Muitas requisições. Tente novamente em instantes."},
        )
        response.headers["X-RateLimit-Limit"] = str(max_requests_ip)
        response.headers["X-RateLimit-Window"] = str(window_seconds_ip)
        response.headers["X-RateLimit-Remaining"] = "0"
        _attach_cors(response)
        return response

    # Bloqueio 2: Limite por Chave de API (se fornecida)
    if raw_key and total_key is not None and max_requests_key is not None and total_key > max_requests_key:
        logger.warning(
            "[RATE_LIMIT] bloqueado por API Key path=%s key_prefix=%s total=%s window_s=%s max=%s",
            request.url.path,
            raw_key[:13],
            total_key,
            window_seconds_key,
            max_requests_key,
        )
        response = JSONResponse(
            status_code=429,
            content={"detail": "Muitas requisições para esta chave de API. Tente novamente em instantes."},
        )
        response.headers["X-RateLimit-Limit"] = str(max_requests_key)
        response.headers["X-RateLimit-Window"] = str(window_seconds_key)
        response.headers["X-RateLimit-Remaining"] = "0"
        _attach_cors(response)
        return response

    response = await call_next(request)
    if raw_key and max_requests_key is not None and total_key is not None:
        rem_ip = max(0, max_requests_ip - total_ip)
        rem_key = max(0, max_requests_key - total_key)
        response.headers.setdefault("X-RateLimit-Limit", str(max_requests_key))
        response.headers.setdefault("X-RateLimit-Window", str(window_seconds_key))
        response.headers.setdefault("X-RateLimit-Remaining", str(min(rem_ip, rem_key)))
    else:
        response.headers.setdefault("X-RateLimit-Limit", str(max_requests_ip))
        response.headers.setdefault("X-RateLimit-Window", str(window_seconds_ip))
        response.headers.setdefault("X-RateLimit-Remaining", str(max(0, max_requests_ip - total_ip)))
    return response


@app.middleware("http")
async def cache_headers_middleware(request: Request, call_next):
    response = await call_next(request)

    path = request.url.path
    content_type = response.headers.get("content-type", "")

    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    if content_type.startswith("text/html"):
        response.headers["Cache-Control"] = "no-cache"
        return response

    origin = request.headers.get("origin")
    if request.method == "OPTIONS" and path.startswith("/static/"):
        response = Response(status_code=200)
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Vary"] = "Origin"
        return response

    ext = os.path.splitext(path)[1].lower()
    if path.startswith("/static/") or path.startswith("/assets/") or ext in _CACHEABLE_EXTENSIONS:
        if _HASHED_ASSET_PATTERN.search(path):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=86400"
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        else:
            response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Vary"] = "Origin"

    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    # Cabeçalhos modernos de proteção recomendados pela OWASP
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    return response


@app.middleware("http")
async def audit_context_middleware(request: Request, call_next):
    from app.core.network import get_client_ip
    client_host = get_client_ip(request)
    user_agent = request.headers.get("user-agent")
    set_audit_request(client_host, user_agent)
    set_current_http_request(request)
    try:
        response = await call_next(request)
    finally:
        clear_audit_context()
    return response


@app.middleware("http")
async def log_requests_immediately(request: Request, call_next):
    # Em produção, desativa escrita síncrona em arquivo de texto para poupar I/O e espaço em disco
    is_dev = settings.ENVIRONMENT.lower() in ("development", "testing", "dev")
    enable_file_log = is_dev or os.getenv("ENABLE_FILE_REQUEST_LOG") == "1"

    if not enable_file_log:
        return await call_next(request)

    log_line = f"==> REQUEST START: {request.method} {request.url.path}\n"
    log_file_path = ROOT_DIR / "app" / "request_log.txt"
    try:
        # Rotaciona se o arquivo exceder 5MB em desenvolvimento
        if log_file_path.exists() and log_file_path.stat().st_size > 5 * 1024 * 1024:
            rotated = ROOT_DIR / "app" / "request_log.old.txt"
            rotated.unlink(missing_ok=True)
            log_file_path.rename(rotated)

        with open(log_file_path, "a") as f:
            f.write(log_line)
    except Exception:
        pass

    try:
        response = await call_next(request)
        end_line = f"<== REQUEST END: {request.method} {request.url.path} - {response.status_code}\n"
        try:
            with open(log_file_path, "a") as f:
                f.write(end_line)
        except Exception:
            pass
        return response
    except Exception as e:
        err_line = f"==! REQUEST EXCEPTION: {request.method} {request.url.path} - {e}\n"
        try:
            with open(log_file_path, "a") as f:
                f.write(err_line)
        except Exception:
            pass
        raise e

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
