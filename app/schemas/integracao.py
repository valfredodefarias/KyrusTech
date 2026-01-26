# app/schemas/integracao.py
from typing import Optional
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin

class IntegracaoBase(SQLModel):
    nome: str
    provedor: str # ASAAS, ITAU
    ambiente: str = "PRODUCAO"
    ativo: bool = True
    sincronizar_automaticamente: bool = True
    conta_id: int
    empresa_id: int

class IntegracaoCreate(IntegracaoBase):
    token: str # O usuário envia o token real aqui (será criptografado no Service)
    configuracao_adicional: Optional[str] = None

class IntegracaoUpdate(SQLModel):
    nome: Optional[str] = None
    ativo: Optional[bool] = None
    sincronizar_automaticamente: Optional[bool] = None
    token: Optional[str] = None # Se enviado, atualiza a criptografia

class IntegracaoRead(IntegracaoBase, AuditReadMixin):
    # Não retornamos o token aqui por segurança
    pass