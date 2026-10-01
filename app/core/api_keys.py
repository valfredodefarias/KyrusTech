# app/core/api_keys.py
import hashlib
import hmac
import secrets
from typing import Optional

from app.core.config import settings

PREFIX_LENGTH = 13  # kyr_live_XXXX (13 caracteres)


def get_default_environment() -> str:
    """Retorna 'live' para produção e 'test' para os demais ambientes."""
    env = (settings.ENVIRONMENT or "").strip().lower()
    return "live" if env == "production" else "test"


def hash_api_key(plain_key: str) -> str:
    """
    Gera o hash HMAC-SHA256 da chave de API em hexadecimal utilizando o pepper do sistema.
    Nunca armazena nem loga a chave original em texto puro.
    """
    pepper = settings.API_KEY_PEPPER.encode("utf-8")
    return hmac.new(pepper, plain_key.strip().encode("utf-8"), hashlib.sha256).hexdigest()


def compare_api_key_hash(plain_key: str, expected_hash: str) -> bool:
    """Compara em tempo constante o hash da chave fornecida contra o hash esperado."""
    calculated = hash_api_key(plain_key)
    return hmac.compare_digest(calculated, expected_hash)


def extract_key_prefix(plain_key: str) -> str:
    """Extrai os primeiros 13 caracteres para busca rápida no banco."""
    return plain_key.strip()[:PREFIX_LENGTH]


def mask_api_key(key_prefix: str) -> str:
    """Retorna o prefixo mascarado para exibição segura nas listagens."""
    clean_prefix = key_prefix.strip()
    return f"{clean_prefix}••••••••"


def is_api_key(token: Optional[str]) -> bool:
    """Verifica se uma string possui o formato de prefixo de chave da Kyrus."""
    if not token:
        return False
    clean = token.strip()
    return clean.startswith("kyr_live_") or clean.startswith("kyr_test_") or clean.startswith("kyr_")


def generate_api_key(environment: Optional[str] = None) -> tuple[str, str, str]:
    """
    Gera uma nova chave de API completa no padrão kyr_{env}_{segredo}.
    Retorna a tupla (plain_key, key_prefix, key_hash).
    A chave em texto plano deve ser entregue ao cliente APENAS UMA VEZ.
    """
    env = environment if environment in {"live", "test"} else get_default_environment()
    secret = secrets.token_urlsafe(32)
    plain_key = f"kyr_{env}_{secret}"
    key_prefix = extract_key_prefix(plain_key)
    key_hash = hash_api_key(plain_key)
    return plain_key, key_prefix, key_hash
