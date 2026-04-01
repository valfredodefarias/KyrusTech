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

        return self
    # --- BANCO DE DADOS (POSTGRES) ---
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5444
    POSTGRES_USER: str = "kyrus_user"
    POSTGRES_PASSWORD: str = "kyrus_pass"
    POSTGRES_DB: str = "kyrus_erp"
    POSTGRES_ALLOWED_CIDRS: str = ""

    # --- BANCO DE DADOS LEGADO (MIGRAÇÃO ÚNICA) ---
    COPY_LEGACY_DATABASE: bool = False
    DROP_UNUSED_TABLES: bool = False
    LEGACY_POSTGRES_SERVER: str | None = None
    LEGACY_POSTGRES_PORT: int = 5432
    LEGACY_POSTGRES_USER: str | None = None
    LEGACY_POSTGRES_PASSWORD: str | None = None
    LEGACY_POSTGRES_DB: str | None = None

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

    @computed_field
    @property
    def LEGACY_DATABASE_URL(self) -> str | None:
        if not all([
            self.LEGACY_POSTGRES_SERVER,
            self.LEGACY_POSTGRES_USER,
            self.LEGACY_POSTGRES_PASSWORD,
            self.LEGACY_POSTGRES_DB,
        ]):
            return None

        return MultiHostUrl.build(
            scheme="postgresql+psycopg2",
            username=self.LEGACY_POSTGRES_USER,
            password=self.LEGACY_POSTGRES_PASSWORD,
            host=self.LEGACY_POSTGRES_SERVER,
            port=self.LEGACY_POSTGRES_PORT,
            path=self.LEGACY_POSTGRES_DB,
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

        if issues:
            raise ValueError("; ".join(issues))

        return self

settings = Settings()