from __future__ import annotations

# app/models/fornecedor_produto_equivalencia.py
from typing import Optional, TYPE_CHECKING
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .entidade import Entidade
    from .produto import Produto

class FornecedorProdutoEquivalencia(AuditMixin, SQLModel, table=True):
    __tablename__ = "fornecedor_produto_equivalencias"
    __table_args__ = (
        UniqueConstraint(
            "empresa_id",
            "fornecedor_id",
            "codigo_produto_fornecedor",
            name="uq_forn_prod_equiv_empresa_forn_cod",
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    fornecedor_id: int = Field(foreign_key="entidades.id", index=True)
    codigo_produto_fornecedor: str = Field(index=True)
    produto_interno_id: int = Field(foreign_key="produtos.id", index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    fornecedor: "Entidade" = Relationship(sa_relationship=relationship("Entidade"))
    produto_interno: "Produto" = Relationship(sa_relationship=relationship("Produto"))
