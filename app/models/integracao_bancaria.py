# app/models/integracao_bancaria.py

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin # <--- Auditoria
from datetime import datetime, date

if TYPE_CHECKING:
    from .empresa import Empresa
    from .conta import Conta
    from .mapeamento_categoria import MapeamentoCategoria

class IntegracaoBancaria(AuditMixin, SQLModel, table=True):
    __tablename__ = "integracoes_bancarias"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Identificação
    nome: str = Field(description="Nome amigável, ex: 'Asaas Principal'")
    tipo: str = Field(index=True) # Ex: "ASAAS", "ITAU", "NUBANK"
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
    intervalo_sincronizacao_minutos: int = Field(default=60)
    data_inicio_sincronizacao: Optional[date] = Field(default=None)
    ultima_sincronizacao: Optional[datetime] = None
    proxima_sincronizacao: Optional[datetime] = None
    categoria_padrao_id: Optional[int] = Field(default=None, foreign_key="plano_contas.id")
    usar_categoria_a_categorizar: bool = Field(default=True)
    ativo: bool = Field(default=True)
    
    # Vínculos
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id", index=True)
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id")
    
    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", back_populates="integracoes_bancarias"))
    conta: Optional["Conta"] = Relationship(sa_relationship=relationship("Conta", back_populates="integracao"))
    mapeamentos_categoria: list["MapeamentoCategoria"] = Relationship(
        sa_relationship=relationship("MapeamentoCategoria", back_populates="integracao")
    )