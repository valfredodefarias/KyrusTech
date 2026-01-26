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
