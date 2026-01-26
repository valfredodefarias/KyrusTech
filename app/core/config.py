# app/core/config.py
import os
import json
from typing import List, Union
from pydantic import AnyHttpUrl, PostgresDsn, computed_field, field_validator
from pydantic_core import MultiHostUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- GERAL ---
    PROJECT_NAME: str = "KyrusTech"
    ENVIRONMENT: str = "development" # "development", "production", "testing"
    API_V1_STR: str = "/api/v1"  # Prefixo das rotas da API
    
    # --- SEGURANÇA ---
    SECRET_KEY: str = "change-me-in-production-env" # Default para dev, obrigatório em produção
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"
    
    # CORS: Lista de URLs que podem acessar o backend (Front, Mobile, etc)
    # No .env use: BACKEND_CORS_ORIGINS=http://localhost:5501,http://meuapp.com
    BACKEND_CORS_ORIGINS: Union[List[str], str] = "*"

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str):
            if v == "*":
                return ["*"]
            if v.startswith("["):
                try:
                    # Permite lista JSON no .env
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, list):
            return v
        raise ValueError(v)

    # --- BANCO DE DADOS (POSTGRES) ---
    POSTGRES_SERVER: str = "103.63.28.155"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "casaos"
    POSTGRES_PASSWORD: str = "casaos"
    POSTGRES_DB: str = "casaos"

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return MultiHostUrl.build(
            scheme="postgresql+psycopg2",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        ).unicode_string()

    # --- AWS S3 (Opcional) ---
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None
    AWS_S3_BUCKET_NAME: str | None = None
    AWS_S3_REGION: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf-8", 
        case_sensitive=True, 
        extra="ignore"
    )

settings = Settings()