# app/enums.py
"""
Enums compartilhados da aplicação.
"""
from enum import Enum


class ConsultorRole(str, Enum):
    """Papéis de consultores no sistema."""
    SUPER_CONSULTOR = "SUPER_CONSULTOR"  # Pode gerenciar outros consultores
    CONSULTOR = "CONSULTOR"  # Acessa empresas designadas
    USUARIO_NORMAL = "USUARIO_NORMAL"  # Usuário comum sem acesso de consultor
    
    def __str__(self) -> str:
        return self.value


class PdvPermission(str, Enum):
    """Permissões do módulo de PDV/Vendas."""

    PDV_VER_TODAS_VENDAS = "PDV_VER_TODAS_VENDAS"
    PDV_SER_VENDEDOR = "PDV_SER_VENDEDOR"
    PDV_REALIZAR_SANGRIA = "PDV_REALIZAR_SANGRIA"
    PDV_CANCELAR_VENDA = "PDV_CANCELAR_VENDA"
    PDV_CONCEDER_DESCONTO = "PDV_CONCEDER_DESCONTO"

    def __str__(self) -> str:
        return self.value
