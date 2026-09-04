from __future__ import annotations

from typing import Optional, Any, TYPE_CHECKING
from decimal import Decimal
import datetime

from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship

# Import do Mixin de Auditoria
from .base_audit import AuditMixin

# Evita importação circular
if TYPE_CHECKING:
    from .empresa import Empresa
    from .cartao import Cartao
    from .plano_contas import PlanoContas
    from .centro_custo import CentroCusto
    from .entidade import Entidade
    from .lancamento import Lancamento


class LancamentoCartao(AuditMixin, SQLModel, table=True):
    """
    Tabela dedicada para armazenar despesas de cartão de crédito.
    Elas vivem aqui até a fatura ser paga, momento em que são convertidas
    (inseridas) na tabela Lancamento oficial para integrar o DRE e o fluxo de caixa.
    """
    __tablename__ = "lancamentos_cartao"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # --- Campos de Negócio ---
    descricao: str = Field(index=True)
    valor: Decimal = Field(max_digits=12, decimal_places=2)
    
    # --- Datas ---
    data_compra: datetime.date = Field(index=True)
    data_vencimento_fatura: datetime.date = Field(index=True)
    competencia_fatura: str = Field(index=True)  # ex: "2026-08"
    
    # --- Detalhes ---
    numero_parcela: Optional[int] = Field(default=None)
    id_parcelamento: Optional[str] = Field(default=None, index=True)
    observacao: Optional[str] = None
    import_hash: Optional[str] = Field(default=None, index=True)
    ofx_bank_id: Optional[str] = Field(default=None, index=True)
    regime_competencia: str = Field(default="COMPRA", index=True)
    
    # Indica se este item já foi pago e transferido para a tabela de Lancamento
    fatura_paga: bool = Field(default=False, index=True)

    # --- Chaves Estrangeiras ---
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    cartao_id: int = Field(foreign_key="cartoes.id", index=True)
    plano_contas_id: int = Field(foreign_key="plano_contas.id", index=True)
    
    # Opcionais
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True)
    entidade_id: Optional[int] = Field(default=None, foreign_key="entidades.id", index=True)
    
    # Quando for pago, ele gera um (ou se vincula a um) Lancamento real no fluxo de caixa
    lancamento_pagamento_id: Optional[int] = Field(default=None, foreign_key="lancamentos.id", index=True)

    # --- Relacionamentos ---
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa"))
    cartao: "Cartao" = Relationship(sa_relationship=relationship("Cartao"))
    plano_contas: "PlanoContas" = Relationship(sa_relationship=relationship("PlanoContas"))
    centro_custo: Optional["CentroCusto"] = Relationship(sa_relationship=relationship("CentroCusto"))
    entidade: Optional["Entidade"] = Relationship(sa_relationship=relationship("Entidade"))
    
    lancamento_pagamento: Optional["Lancamento"] = Relationship(
        sa_relationship=relationship("Lancamento", foreign_keys="[LancamentoCartao.lancamento_pagamento_id]")
    )
