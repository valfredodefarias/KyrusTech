import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# --- Lógica para encontrar o .env automaticamente ---
# Pega o caminho deste arquivo (config.py) e volta 3 pastas para chegar na raiz
# config.py -> core -> app -> raiz (onde está o .env)
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = os.path.join(BASE_DIR, ".env")

class Settings(BaseSettings):
    # --- Configurações Gerais ---
    PROJECT_NAME: str = "Kyrus ERP"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

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
        env_file=ENV_PATH, # <--- Usa o caminho absoluto calculado
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

settings = Settings() # type: ignore