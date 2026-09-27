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
    importacao_ofx,
    importacao_nfe,
    auditoria,
    dre,
    bank_presets,
    orcamentos,
    pdv,
    rbac,
    compras,
    comissoes,
    comissao_config,
    ws,
    indicadores,
    anuncios_login,
    ml_lancamentos,
)

api_router = APIRouter()

# --- Módulos Principais ---
api_router.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
api_router.include_router(empresas.router, prefix="/empresas", tags=["Empresas"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["Usuários"])

# --- Módulos Financeiros ---
api_router.include_router(contas.router, prefix="/contas", tags=["Contas Bancárias"])
api_router.include_router(bank_presets.router, prefix="/bank-presets", tags=["Bancos Padrão"])
api_router.include_router(plano_contas.router, prefix="/plano-contas", tags=["Plano de Contas"])
api_router.include_router(entidades.router, prefix="/entidades", tags=["Entidades"])
api_router.include_router(cartoes.router, prefix="/cartoes", tags=["Cartões de Crédito"])
api_router.include_router(lancamentos.router, prefix="/lancamentos", tags=["Lançamentos"])
api_router.include_router(centro_custo.router, prefix="/centro-custo", tags=["Centros de Custo"])
api_router.include_router(auditoria.router, prefix="/auditoria", tags=["Auditoria"], include_in_schema=False)
api_router.include_router(orcamentos.router, prefix="/orcamentos", tags=["Planejamento Orçamentário"])

# --- Módulos Administrativos ---
api_router.include_router(consultor.router, prefix="/consultor", tags=["Consultor Interno"], include_in_schema=False)

# --- Integrações ---
api_router.include_router(integracao_bancaria.router, prefix="/integracoes-bancarias", tags=["Integrações"])

# --- UPLOAD DE ARQUIVOS ---
api_router.include_router(anexos.router, prefix="/anexos", tags=["Anexos"])

# --- IMPORTAÇÃO DE ARQUIVOS BANCÁRIOS ---
api_router.include_router(importacao_ofx.router, prefix="/importacao", tags=["Importação OFX"])
api_router.include_router(importacao_nfe.router, prefix="/importacao", tags=["Importação NF-e"])

# --- RBAC ---
api_router.include_router(rbac.router, prefix="/rbac", tags=["RBAC"], include_in_schema=False)

# --- PDV ---
api_router.include_router(pdv.router, prefix="/pdv", tags=["PDV"])

# --- COMPRAS ---
api_router.include_router(compras.router, prefix="/compras", tags=["Compras"])

# --- COMISSÕES ---
api_router.include_router(comissoes.router, prefix="/comissoes", tags=["Comissões"])
api_router.include_router(comissao_config.router, prefix="/comissoes/config", tags=["Configurações de Comissões"])

# --- DRE ---
api_router.include_router(dre.router, prefix="/dre", tags=["DRE"])

# --- INDICADORES ---
api_router.include_router(indicadores.router, prefix="/indicadores", tags=["Indicadores"])

# --- WEBSOCKETS ---
api_router.include_router(ws.router, prefix="/ws", tags=["WebSockets"])

# --- ANÚNCIOS & NOTÍCIAS DE LOGIN ---
api_router.include_router(anuncios_login.router, prefix="/anuncios", tags=["Anúncios & Notícias"])

# --- MACHINE LEARNING PREDITIVO ---
api_router.include_router(ml_lancamentos.router, prefix="/ml", tags=["Machine Learning"])