# app/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router
from app.core.config import settings
from app.db import base_class

app = FastAPI(title=settings.PROJECT_NAME)

# --- CONFIGURAÇÃO DO CORS CORRIGIDA ---
origins = [
    "http://localhost",
    "http://localhost:8080",
    "http://localhost:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5501",
    
    # SEUS IPs DE REDE (Adicionei a vírgula que faltava aqui embaixo)
    "http://192.168.0.39:5501",
    "http://192.168.0.39:5500",
    
    "*" # Libera geral (mas precisa dos IPs acima explicítos para Login funcionar)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ---------------------------------------

@app.get("/", tags=["Root"])
def read_root():
    return {"message": f"Bem-vindo à API do {settings.PROJECT_NAME}"}

app.include_router(api_router, prefix="/api/v1")