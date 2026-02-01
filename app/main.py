# app/main.py

import os
import re
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from app.api.v1.api import api_router
from app.core.config import settings
from app.core.audit_context import set_audit_request, clear_audit_context

# --- CRIAR DIRETÓRIOS NECESSÁRIOS ---
os.makedirs("static/uploads", exist_ok=True)

# --- INICIALIZAR APLICAÇÃO ---
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="API Backend do Kyrus ERP",
    version="1.0.0"
)

# --- CONFIGURAÇÃO DE CORS ---
# Converte CORS origins para lista se for string "*"
cors_origins = (
    ["*"] if isinstance(settings.BACKEND_CORS_ORIGINS, str) and settings.BACKEND_CORS_ORIGINS == "*"
    else settings.BACKEND_CORS_ORIGINS if isinstance(settings.BACKEND_CORS_ORIGINS, list)
    else []
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
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
    
    # Se for um arquivo com extensão conhecida, tenta servir
    if "." in full_path and not full_path.endswith("/"):
        file_path = frontend_dist / full_path
        if file_path.exists():
            return FileResponse(file_path)
    
    # Caso contrário, redireciona para index.html (SPA)
    index_path = frontend_dist / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    
    return {"error": "Frontend não foi compilado. Execute: cd kyrus-web && npm run build"}
