"""
Sistema de criptografia para tokens e credenciais sensíveis.
Usa Fernet (symmetric encryption) para criptografar dados sensíveis.
"""
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.backends import default_backend
import base64
import os
from app.core.config import settings
from loguru import logger

# Gera uma chave de criptografia baseada na SECRET_KEY
def _get_encryption_key() -> bytes:
    """
    Gera uma chave de criptografia derivada da SECRET_KEY.
    Isso garante que a mesma SECRET_KEY sempre gere a mesma chave de criptografia.
    """
    # Usa a SECRET_KEY como salt
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=settings.SECRET_KEY.encode()[:16].ljust(16, b'0'),  # Usa primeiros 16 bytes da SECRET_KEY
        iterations=100000,
        backend=default_backend()
    )
    key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode()))
    return key

# Instância do Fernet para criptografia/descriptografia
_fernet = Fernet(_get_encryption_key())


def encrypt_token(token: str) -> str:
    """
    Criptografa um token ou credencial sensível.
    
    Args:
        token: Token em texto puro
        
    Returns:
        Token criptografado (string base64)
    """
    try:
        encrypted = _fernet.encrypt(token.encode())
        return encrypted.decode()
    except Exception as e:
        logger.error(f"Erro ao criptografar token: {e}")
        raise ValueError("Falha ao criptografar token")


def decrypt_token(encrypted_token: str) -> str:
    """
    Descriptografa um token ou credencial.
    
    Args:
        encrypted_token: Token criptografado (string base64)
        
    Returns:
        Token em texto puro
    """
    try:
        decrypted = _fernet.decrypt(encrypted_token.encode())
        return decrypted.decode()
    except Exception as e:
        logger.error(f"Erro ao descriptografar token: {e}")
        raise ValueError("Falha ao descriptografar token. Token pode estar corrompido ou chave inválida.")


def encrypt_dict(data: dict) -> str:
    """
    Criptografa um dicionário completo (útil para múltiplas credenciais).
    
    Args:
        data: Dicionário com dados sensíveis
        
    Returns:
        String criptografada
    """
    import json
    json_str = json.dumps(data)
    return encrypt_token(json_str)


def decrypt_dict(encrypted_data: str) -> dict:
    """
    Descriptografa um dicionário.
    
    Args:
        encrypted_data: String criptografada
        
    Returns:
        Dicionário descriptografado
    """
    import json
    decrypted_str = decrypt_token(encrypted_data)
    return json.loads(decrypted_str)



