# app/models/mapeamento_categoria.py
from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .integracao_bancaria import IntegracaoBancaria
    from .plano_contas import PlanoContas

class MapeamentoCategoria(AuditMixin, SQLModel, table=True):
    __tablename__ = "mapeamentos_categoria"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Lógica: "Quando vier 'Serviços' do Asaas (categoria_externa) -> vira 'Receita de Vendas' (plano_contas)"
    categoria_externa: str = Field(description="Nome/código da categoria no sistema externo")
    
    plano_contas_id: int = Field(foreign_key="plano_contas.id")
    integracao_id: int = Field(foreign_key="integracoes_bancarias.id")
    
    # Relacionamentos
    integracao: "IntegracaoBancaria" = Relationship(
        sa_relationship=relationship("IntegracaoBancaria", back_populates="mapeamentos_categoria")
    )
    plano_contas: "PlanoContas" = Relationship(
        sa_relationship=relationship("PlanoContas", back_populates="mapeamentos")
    )