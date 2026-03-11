# app/core/config.py
import os
import json
from typing import List, Union
from pydantic import AnyHttpUrl, PostgresDsn, computed_field, field_validator, model_validator
from pydantic_core import MultiHostUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # --- GERAL ---
    PROJECT_NAME: str = "KyrusTech"
    ENVIRONMENT: str = "development" # "development", "production", "testing"
    API_V1_STR: str = "/api/v1"  # Prefixo das rotas da API
    BACKEND_PUBLIC_URL: str | None = None  # Ex: "https://kyrustech.com.br"
    
    # --- SEGURANÇA ---
    SECRET_KEY: str = "change-me-in-production-env" # Default para dev, obrigatório em produção
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_COOKIE_NAME: str = "kyrus_access_token"
    
    # CORS: Lista de URLs que podem acessar o backend (Front, Mobile, etc)
    # No .env use: BACKEND_CORS_ORIGINS=http://localhost:5501,http://meuapp.com
    BACKEND_CORS_ORIGINS: Union[List[str], str] = "*"

    # --- IA ASSISTENTE ---
    AI_PROVIDER: str = "gemini"  # gemini | openai
    AI_TIMEOUT_SECONDS: int = 30

    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-1.5-flash"

    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT_SECONDS: int = 30  # Compat legado

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str):
            raw = v.strip()

            # Aceita valores entre aspas no .env ("..." ou '...').
            if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
                raw = raw[1:-1].strip()

            if raw == "*":
                return ["*"]
            if raw.startswith("["):
                try:
                    # Permite lista JSON no .env
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        return [str(i).strip().rstrip("/") for i in parsed]
                except Exception:
                    pass
            return [i.strip().rstrip("/") for i in raw.split(",") if i.strip()]
        elif isinstance(v, list):
            return [str(i).strip().rstrip("/") for i in v if str(i).strip()]
        raise ValueError(v)

    def _normalized_cors_origins(self) -> list[str]:
        origins = self.BACKEND_CORS_ORIGINS if isinstance(self.BACKEND_CORS_ORIGINS, list) else [self.BACKEND_CORS_ORIGINS]
        normalized = [str(origin).strip().rstrip("/") for origin in origins if str(origin).strip()]

        if self.ENVIRONMENT.lower() == "production" and "*" in normalized:
            fallback_origins: list[str] = []
            if self.BACKEND_PUBLIC_URL:
                fallback_origins.append(self.BACKEND_PUBLIC_URL.strip().rstrip("/"))
            normalized = fallback_origins

        # Remove duplicados preservando ordem.
        return list(dict.fromkeys(normalized))

    @model_validator(mode="after")
    def validate_security_configuration(self):
        if self.ENVIRONMENT.lower() != "production":
            return self

        self.BACKEND_CORS_ORIGINS = self._normalized_cors_origins()

        if self.SECRET_KEY == "change-me-in-production-env":
            raise ValueError("SECRET_KEY insegura para produção. Defina uma chave forte no ambiente.")

        cors_origins = self.BACKEND_CORS_ORIGINS if isinstance(self.BACKEND_CORS_ORIGINS, list) else [self.BACKEND_CORS_ORIGINS]
        normalized_origins = {str(origin).strip() for origin in cors_origins if str(origin).strip()}
        if "*" in normalized_origins or "[*]" in normalized_origins:
            raise ValueError("BACKEND_CORS_ORIGINS não pode ser '*' em produção.")

        using_default_db = (
            self.POSTGRES_SERVER == "103.63.28.155"
            and self.POSTGRES_USER == "casaos"
            and self.POSTGRES_PASSWORD == "casaos"
            and self.POSTGRES_DB == "casaos"
        )
        if using_default_db:
            raise ValueError("Credenciais padrão do PostgreSQL detectadas em produção. Configure seu banco externo com valores próprios.")

        return self
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

    @model_validator(mode="after")
    def validate_security_settings(self):
        environment = (self.ENVIRONMENT or "development").strip().lower()
        if environment != "production":
            return self

        self.BACKEND_CORS_ORIGINS = self._normalized_cors_origins()

        issues: list[str] = []
        if self.SECRET_KEY == "change-me-in-production-env" or len(self.SECRET_KEY.strip()) < 32:
            issues.append("Configure uma SECRET_KEY forte e exclusiva em produção")

        cors_origins = self.BACKEND_CORS_ORIGINS if isinstance(self.BACKEND_CORS_ORIGINS, list) else [self.BACKEND_CORS_ORIGINS]
        if "*" in cors_origins:
            issues.append("Defina BACKEND_CORS_ORIGINS explicitamente em produção; '*' não é permitido")

        using_default_db = (
            self.POSTGRES_SERVER == "103.63.28.155"
            and self.POSTGRES_USER == "casaos"
            and self.POSTGRES_PASSWORD == "casaos"
            and self.POSTGRES_DB == "casaos"
        )
        if using_default_db:
            issues.append("Altere as credenciais padrão do PostgreSQL em produção")

        if issues:
            raise ValueError("; ".join(issues))

        return self

settings = Settings()