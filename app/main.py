# app/main.py

import os
import re
import sys
from pathlib import Path
from subprocess import run
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from loguru import logger
from sqlalchemy import text
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.audit_context import set_audit_request, clear_audit_context
from app.db.session import engine

# --- CRIAR DIRETÓRIOS NECESSÁRIOS ---
os.makedirs("static/uploads", exist_ok=True)
ROOT_DIR = Path(__file__).resolve().parent.parent
MIGRATION_LOCK_ID = 24030901


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
    finally:
        if connection is not None:
            try:
                cursor = connection.cursor()
                cursor.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,))
            except Exception as exc:
                logger.warning(f"Could not release migration advisory lock: {exc}")
            connection.close()


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
        "UPDATE entidades SET tipo_pessoa = CASE WHEN upper(coalesce(cpf_cnpj, '')) ~ '^[0-9]{12,}$' THEN 'PJ' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_FISICA', 'PF') THEN 'PF' WHEN upper(coalesce(tipo, '')) IN ('PESSOA_JURIDICA', 'PJ') THEN 'PJ' ELSE coalesce(tipo_pessoa, 'PJ') END WHERE tipo_pessoa IS NULL OR trim(tipo_pessoa) = ''",
        "UPDATE entidades SET tipo = CASE WHEN upper(coalesce(tipo, '')) IN ('CLIENTE', 'FORNECEDOR', 'AMBOS') THEN upper(tipo) ELSE 'AMBOS' END WHERE tipo IS NULL OR upper(coalesce(tipo, '')) NOT IN ('CLIENTE', 'FORNECEDOR', 'AMBOS')",
        "CREATE INDEX IF NOT EXISTS ix_entidades_tipo_pessoa ON entidades (tipo_pessoa)",
        "ALTER TABLE cartoes ADD COLUMN IF NOT EXISTS bandeira VARCHAR",
        "CREATE INDEX IF NOT EXISTS ix_cartoes_bandeira ON cartoes (bandeira)",
    ]

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))

# --- INICIALIZAR APLICAÇÃO ---
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API Backend do Kyrus ERP",
    version="1.0.0"
)


@app.on_event("startup")
def startup_event() -> None:
    _run_startup_migrations()

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
    client_host = request.client.host if request.client else None
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
@app.get("/", tags=["Root"])
async def read_root():
    """Endpoint raiz da API"""
    return {
        "message": f"Bem-vindo à API do {settings.PROJECT_NAME}",
        "environment": settings.ENVIRONMENT,
        "docs": "/docs",
        "openapi": "/openapi.json"
    }

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check para verificar se a API está online"""
    return {"status": "ok", "message": "API is running"}

# --- INCLUIR ROTAS ---
app.include_router(api_router, prefix="/api/v1")

# --- SERVIR FRONTEND (SPA) ---
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    """
    Serve os arquivos do frontend (kyrus-web).
    Isso permite que o Vue Router funcione corretamente.
    """
    frontend_dist = Path("../kyrus-web/dist")
    legacy_frontend = Path("../frontend")
    
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
