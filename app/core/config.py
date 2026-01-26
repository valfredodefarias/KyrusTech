import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.network import get_local_ip

# --- Lógica para encontrar o .env automaticamente ---
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = os.path.join(BASE_DIR, ".env")

# --- Detecção automática de IP ---
_LOCAL_IP = get_local_ip()

class Settings(BaseSettings):
    # --- Configurações Gerais ---
    PROJECT_NAME: str = "Kyrus ERP"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    
    # --- NOVAS VARIAVEIS (Que faltavam e causavam o erro) ---
    API_V1_STR: str = "/api/v1"
    ALGORITHM: str = "HS256"
    # --------------------------------------------------------

    # --- Banco de Dados ---
    POSTGRES_SERVER: str
    POSTGRES_PORT: int
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    DATABASE_URL: str

    # --- AWS S3 ---
    AWS_ACCESS_KEY_ID: str
    AWS_SECRET_ACCESS_KEY: str
    AWS_S3_BUCKET_NAME: str
    AWS_S3_REGION: str

    # --- Configuração de Carregamento ---
    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

settings = Settings() # type: ignore

# --- Configurações de Rede (IP detectado automaticamente) ---
LOCAL_IP: str = _LOCAL_IP
BACKEND_PORT: int = 8000
FRONTEND_PORT: int = 5501

# URLs completas para uso em CORS e outras configurações
BACKEND_URL: str = f"http://{LOCAL_IP}:{BACKEND_PORT}"
FRONTEND_URL: str = f"http://{LOCAL_IP}:{FRONTEND_PORT}"
API_BASE_URL: str = f"{BACKEND_URL}{settings.API_V1_STR}"