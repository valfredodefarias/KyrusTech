# app/api/v1/api.py
from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth, 
    empresas, 
    usuarios, 
    contas, 
    plano_contas, 
    entidades, 
    cartoes, 
    lancamentos, 
    centro_custo, 
    consultor,
    integracao_bancaria,
    anexos,
    importacao_itau,  # <--- IMPORTAÇÃO DO ENDPOINT DE IMPORTAÇÃO
    importacao_ofx,
    auditoria,
    todos
)

api_router = APIRouter()

# --- Módulos Principais ---
api_router.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
api_router.include_router(empresas.router, prefix="/empresas", tags=["Empresas"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["Usuários"])

# --- Módulos Financeiros ---
api_router.include_router(contas.router, prefix="/contas", tags=["Contas Bancárias"])
api_router.include_router(plano_contas.router, prefix="/plano-contas", tags=["Plano de Contas"])
api_router.include_router(entidades.router, prefix="/entidades", tags=["Entidades"])
api_router.include_router(cartoes.router, prefix="/cartoes", tags=["Cartões de Crédito"])
api_router.include_router(lancamentos.router, prefix="/lancamentos", tags=["Lançamentos"])
api_router.include_router(centro_custo.router, prefix="/centro-custo", tags=["Centros de Custo"])
api_router.include_router(auditoria.router, prefix="/auditoria", tags=["Auditoria"])
api_router.include_router(todos.router, prefix="/todos", tags=["Tarefas"])

# --- Módulos Administrativos ---
api_router.include_router(consultor.router, prefix="/consultor", tags=["Consultor Interno"])

# --- Integrações ---
api_router.include_router(integracao_bancaria.router, prefix="/integracoes-bancarias", tags=["Integrações"])

# --- UPLOAD DE ARQUIVOS ---
api_router.include_router(anexos.router, prefix="/anexos", tags=["Anexos"])

# --- IMPORTAÇÃO DE ARQUIVOS BANCÁRIOS ---
api_router.include_router(importacao_itau.router, prefix="/importacao", tags=["Importação Itaú"])
api_router.include_router(importacao_ofx.router, prefix="/importacao", tags=["Importação OFX"])