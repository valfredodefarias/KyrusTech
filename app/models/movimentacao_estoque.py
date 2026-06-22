from __future__ import annotations

# app/models/movimentacao_estoque.py
from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .produto import Produto

class MovimentacaoEstoque(AuditMixin, SQLModel, table=True):
    __tablename__ = "movimentacoes_estoque"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    produto_id: int = Field(foreign_key="produtos.id", index=True)
    quantidade: float = Field(description="Quantidade movimentada (positiva para entrada, negativa para saida)")
    tipo: str = Field(index=True, description="Tipo de movimentacao (ex: Entrada por Compra, Saida por Venda)")
    valor_unitario: float = Field(default=0.0, description="Valor unitario do produto na movimentacao")
    valor_total: float = Field(default=0.0, description="Valor total da movimentacao")
    chave_nfe: Optional[str] = Field(default=None, index=True, description="Chave da NF-e associada")

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    produto: "Produto" = Relationship(sa_relationship=relationship("Produto"))
