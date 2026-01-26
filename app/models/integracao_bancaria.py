# app/models/integracao_bancaria.py

from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin # <--- Auditoria

if TYPE_CHECKING:
    from .empresa import Empresa
    from .conta import Conta
    from .mapeamento_categoria import MapeamentoCategoria

class IntegracaoBancaria(AuditMixin, SQLModel, table=True):
    __tablename__ = "integracoes_bancarias"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Identificação
    nome: str = Field(description="Nome amigável, ex: 'Asaas Principal'")
    provedor: str = Field(index=True) # Ex: "ASAAS", "ITAU", "NUBANK"
    ambiente: str = Field(default="PRODUCAO") # "PRODUCAO" ou "SANDBOX"
    
    # --- SEGURANÇA (O Cofre) ---
    # Nunca salvar o token puro. O Backend deve criptografar antes de salvar aqui.
    token_criptografado: str = Field(description="API Key ou Token OAuth criptografado")
    
    # Configurações extras (Webhook secret, Client ID, etc) em JSON
    configuracao_adicional: Optional[str] = Field(
        default=None, 
        description="JSON string com configurações específicas do provedor"
    )
    
    # Automação
    sincronizar_automaticamente: bool = Field(default=True)
    ativo: bool = Field(default=True)
    
    # Vínculos
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    conta_id: int = Field(foreign_key="contas.id", unique=True, index=True) 
    # ^ unique=True pois uma conta bancária só deve ter UMA integração ativa de cada vez
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="integracoes_bancarias")
    conta: "Conta" = Relationship(back_populates="integracao")
    mapeamentos_categoria: list["MapeamentoCategoria"] = Relationship(back_populates="integracao")