# app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware # <--- AQUI ESTÁ A MÁGICA
from app.api.v1.api import api_router
from app.core.config import settings
from app.db import base_class # Garante o carregamento dos modelos

app = FastAPI(title=settings.PROJECT_NAME)

# --- CONFIGURAÇÃO DO CORS (Permite o Frontend acessar o Backend) ---
origins = [
    "http://localhost",
    "http://localhost:8080",
    "http://127.0.0.1:5500", # Live Server padrão
    "http://localhost:5500",
    "*" # Libera geral para facilitar o desenvolvimento
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"], # Permite GET, POST, PUT, DELETE, etc.
    allow_headers=["*"], # Permite enviar Tokens e JSON
)
# ------------------------------------------------------------------

@app.get("/", tags=["Root"])
def read_root():
    return {"message": f"Bem-vindo à API do {settings.PROJECT_NAME}"}

app.include_router(api_router, prefix="/api/v1")