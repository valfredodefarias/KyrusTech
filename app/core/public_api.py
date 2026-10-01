# app/core/public_api.py
from typing import Any, Mapping, Optional, Sequence, Set

# Tags oficiais que compõem a superfície pública da API para integrações
PUBLIC_API_TAGS: Set[str] = {
    "Lançamentos",
    "Contas Bancárias",
    "Plano de Contas",
    "Entidades",
    "Centros de Custo",
    "Cartões de Crédito",
    "PDV",
    "Compras",
    "Comissões",
    "DRE",
    "Indicadores",
    "Planejamento Orçamentário",
    "Anexos",
}


def is_public_route(
    tags: Optional[Sequence[str]],
    openapi_extra: Optional[Mapping[str, Any]] = None,
) -> bool:
    """
    Verifica se uma rota pertence à superfície pública da API Kyrus:
    1. Não pode estar explicitamente desabilitada via `x-kyrus-public: False`.
    2. Deve possuir ao menos uma tag listada em `PUBLIC_API_TAGS`.
    """
    if openapi_extra and openapi_extra.get("x-kyrus-public") is False:
        return False

    if not tags:
        return False

    return any(tag in PUBLIC_API_TAGS for tag in tags)
