# app/api/v1/api.py

from fastapi import APIRouter
# Importamos todos os endpoints
from .endpoints import auth, empresas, usuarios, contas, plano_contas, entidades, cartoes, lancamentos, centro_custo

api_router = APIRouter()

# Registramos cada um com seu prefixo e tag
api_router.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
api_router.include_router(empresas.router, prefix="/empresas", tags=["Empresas"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["Usuários"])
api_router.include_router(contas.router, prefix="/contas", tags=["Contas Bancárias"])
api_router.include_router(plano_contas.router, prefix="/plano-contas", tags=["Plano de Contas"])

# Novos módulos financeiros
api_router.include_router(entidades.router, prefix="/entidades", tags=["Entidades"])
api_router.include_router(cartoes.router, prefix="/cartoes", tags=["Cartões de Crédito"])
api_router.include_router(lancamentos.router, prefix="/lancamentos", tags=["Lançamentos"])
api_router.include_router(centro_custo.router, prefix="/centro_custo", tags=["Centros de Custo"])