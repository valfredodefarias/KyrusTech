# app/api/v1/endpoints/public.py
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Request
from fastapi.openapi.utils import get_openapi

from app.core.public_api import is_public_route, PUBLIC_API_TAGS

router = APIRouter()

_cached_public_openapi: Optional[Dict[str, Any]] = None


def clear_public_openapi_cache() -> None:
    global _cached_public_openapi
    _cached_public_openapi = None


TAG_METADATA: List[Dict[str, str]] = [
    {"name": "Lançamentos", "description": "Gestão de receitas, despesas, transferências e baixas financeiras."},
    {"name": "Contas Bancárias", "description": "Contas correntes, investimentos e saldos das empresas."},
    {"name": "Plano de Contas", "description": "Estrutura contábil e orçamentária categorizada."},
    {"name": "Entidades", "description": "Clientes, fornecedores e parceiros de negócio."},
    {"name": "Centros de Custo", "description": "Alocação e acompanhamento de centros de custo departamentais."},
    {"name": "Cartões de Crédito", "description": "Faturas, cartões corporativos e lançamentos em lote."},
    {"name": "PDV", "description": "Vendas, caixas, fechamento de turnos e integração de faturamento."},
    {"name": "Compras", "description": "Ordens de compra e controle de suprimentos."},
    {"name": "Comissões", "description": "Apuração e acompanhamento de comissões por vendedor."},
    {"name": "DRE", "description": "Demonstrativo de Resultado do Exercício e relatórios gerenciais."},
    {"name": "Indicadores", "description": "Métricas chave de desempenho e indicadores financeiros."},
    {"name": "Planejamento Orçamentário", "description": "Orçamentos e metas mensais por categoria."},
    {"name": "Anexos", "description": "Upload e associação de comprovantes e documentos."},
]


@router.get("/openapi.json", include_in_schema=False)
def get_public_openapi_spec(request: Request) -> Dict[str, Any]:
    """
    Retorna a especificação OpenAPI 3.0 pública da Kyrus API,
    contendo apenas as rotas e esquemas destinados a integrações de desenvolvedores.
    Disponível publicamente (inclusive em produção) para alimentar o Portal do Desenvolvedor.
    """
    global _cached_public_openapi
    if _cached_public_openapi is not None:
        return _cached_public_openapi

    public_routes = []
    for route in request.app.routes:
        tags = getattr(route, "tags", None)
        openapi_extra = getattr(route, "openapi_extra", None)
        if tags and is_public_route(tags, openapi_extra):
            public_routes.append(route)

    schema = get_openapi(
        title="Kyrus API - Desenvolvedores",
        version="1.0.0",
        openapi_version="3.0.2",
        description=(
            "Documentação oficial da API pública do Kyrus ERP para automações e integrações "
            "(n8n, webhooks, plataformas parceiras). Autenticação via header `X-Api-Key` ou `Authorization: Bearer <key>`."
        ),
        routes=public_routes,
        tags=TAG_METADATA,
    )

    schema["components"] = schema.get("components", {})
    schema["components"]["securitySchemes"] = {
        "ApiKeyAuth": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Api-Key",
            "description": "Chave de API gerada no painel Kyrus em Configurações > Chaves de API. Envie no header 'X-Api-Key: kyr_live_...' ou 'Authorization: Bearer kyr_live_...'.",
        },
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "API Key",
            "description": "Formato alternativo via header HTTP padrão 'Authorization: Bearer kyr_live_...'.",
        },
    }
    schema["security"] = [{"ApiKeyAuth": []}, {"BearerAuth": []}]
    schema["servers"] = [
        {
            "url": "https://api.kyrustech.com.br",
            "description": "Servidor de Produção Oficial",
        },
        {
            "url": "http://localhost:8000",
            "description": "Servidor Local de Desenvolvimento",
        },
    ]

    _cached_public_openapi = schema
    return _cached_public_openapi
