# app/main.py

import os # <--- Necessário para criar as pastas automaticamente
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
from app.core.config import settings, LOCAL_IP, FRONTEND_PORT, BACKEND_PORT

# --- CORREÇÃO DO ERRO DE DIRETÓRIO ---
# Verifica se as pastas existem. Se não, cria automaticamente.
# Isso evita o "RuntimeError: Directory 'static' does not exist"
if not os.path.exists("static/uploads"):
    os.makedirs("static/uploads", exist_ok=True)
    print("✅ Pastas 'static/uploads' criadas automaticamente.")

app = FastAPI(title=settings.PROJECT_NAME)

# --- CONFIGURAÇÃO DO CORS COM IP DINÂMICO ---
origins = [
    "http://localhost",
    "http://localhost:8080",
    "http://localhost:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    
    # IPs de rede detectados automaticamente
    f"http://{LOCAL_IP}:{FRONTEND_PORT}",
    f"http://{LOCAL_IP}:5500",
    f"http://{LOCAL_IP}:{BACKEND_PORT}",
    
    "*" 
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ---------------------------------------

# --- SERVIR ARQUIVOS ESTÁTICOS (IMAGENS) ---
# Agora é seguro montar, pois garantimos que a pasta existe acima.
app.mount("/static", StaticFiles(directory="static"), name="static")
# -------------------------------------------------

@app.get("/", tags=["Root"])
def read_root():
    return {"message": f"Bem-vindo à API do {settings.PROJECT_NAME}"}

app.include_router(api_router, prefix="/api/v1")