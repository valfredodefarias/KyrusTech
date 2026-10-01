# app/schemas/api_key.py
from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100, description="Nome identificador da integração (ex: N8N Vendas)")
    description: Optional[str] = Field(default=None, max_length=255, description="Descrição opcional do propósito da chave")
    profile_id: int = Field(description="ID do perfil de acesso (RBAC) que dita as permissões da chave")
    expires_at: Optional[datetime] = Field(default=None, description="Data/hora de expiração opcional")


class ApiKeyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=255)
    profile_id: Optional[int] = None
    expires_at: Optional[datetime] = None


class ApiKeyRead(BaseModel):
    id: int
    empresa_id: int
    name: str
    description: Optional[str] = None
    key_prefix: str
    masked_key: str
    environment: str
    profile_id: int
    profile_name: Optional[str] = None
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    last_used_ip: Optional[str] = None
    revoked_at: Optional[datetime] = None
    is_active: bool
    created_by_user_id: int
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ApiKeyCreatedResponse(ApiKeyRead):
    key: str = Field(description="Chave de API completa em texto plano. Exibida apenas uma vez na criação ou rotação.")


class ApiKeyProfileOption(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_template: bool = False
    permissions_count: int = 0
