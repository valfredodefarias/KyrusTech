from __future__ import annotations

# app/models/audit_log.py
from typing import Optional, Any
from sqlmodel import Field, SQLModel
from datetime import datetime
from sqlalchemy import JSON, Column # Precisamos do SQLAlchemy para usar JSON nativo

class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Onde ocorreu?
    table_name: str = Field(index=True) # Ex: "lancamentos"
    record_id: int = Field(index=True)  # Ex: ID 150
    
    # O que aconteceu?
    action: str = Field(index=True) # CREATE, UPDATE, SOFT_DELETE, RESTORE
    
    # O que mudou? (Armazena JSON)
    # Ex: {"valor_pago": {"old": 100.00, "new": 150.00}}
    changes: Optional[Any] = Field(default=None, sa_column=Column(JSON))
    
    undone: bool = Field(default=False, nullable=False)
    
    batch_id: Optional[str] = Field(default=None, index=True)
    is_automatic: bool = Field(default=False, index=True)
    
    # Metadados
    user_id: Optional[int] = Field(default=None, index=True) # Quem fez
    api_key_id: Optional[int] = Field(default=None, foreign_key="api_keys.id", index=True, nullable=True) # Chave de API se integração
    empresa_id: Optional[int] = Field(default=None, index=True) # A qual empresa pertence o registro
    ip_address: Optional[str] = None # Segurança extra
    user_agent: Optional[str] = None # Navegador/Dispositivo
    signature_hash: Optional[str] = Field(default=None, index=True)
    previous_hash: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)