# app/services/security_service.py
from cryptography.fernet import Fernet
from app.core.config import settings

class SecurityService:
    def __init__(self):
        # O ideal é ter uma SECRET_KEY no seu .env de 32 bytes url-safe base64.
        # Se não tiver, vamos gerar uma temporária (mas em produção, use .env!)
        key = settings.SECRET_KEY if hasattr(settings, "SECRET_KEY") else Fernet.generate_key()
        
        # Garante que a chave seja válida (bytes)
        if isinstance(key, str):
            key = key.encode()
            
        self.fernet = Fernet(key)

    def encrypt(self, text: str) -> str:
        """Recebe texto puro (ex: Token Asaas) e retorna hash criptografado."""
        if not text:
            return ""
        return self.fernet.encrypt(text.encode()).decode()

    def decrypt(self, hash_text: str) -> str:
        """Recebe o hash do banco e devolve o texto original para uso interno."""
        if not hash_text:
            return ""
        try:
            return self.fernet.decrypt(hash_text.encode()).decode()
        except Exception:
            # Se a chave mudou ou o texto está corrompido
            return "ERROR_DECRYPT"