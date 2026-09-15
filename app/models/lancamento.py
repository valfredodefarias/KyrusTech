from __future__ import annotations

from typing import Optional, Any, TYPE_CHECKING

from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime

# Import do Mixin de Auditoria
from .base_audit import AuditMixin

# Evita importação circular: estas classes só existem para o MyPy/VS Code aqui
if TYPE_CHECKING:
    from .empresa import Empresa
    from .plano_contas import PlanoContas
    from .conta import Conta
    from .entidade import Entidade
    from .cartao import Cartao
    from .centro_custo import CentroCusto
    from .anexo_lancamento import AnexoLancamento
    from .baixa import Baixa
    from .lote_cartao import LoteCartao

class Lancamento(AuditMixin, SQLModel, table=True):
    __tablename__ = "lancamentos"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # --- Campos de Negócio ---
    descricao: str = Field(index=True)
    tipo: str = Field(index=True) # RECEITA, DESPESA
    status: str = Field(default="EM ABERTO", index=True) 
    origem: str = Field(default="WEB", index=True)
    ipp: bool = Field(default=False)
    previsto: bool = Field(default=True, index=True)
    
    # --- Valores ---
    valor_previsto: Decimal = Field(max_digits=12, decimal_places=2)
    valor_pago: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_juros: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_desconto: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)
    valor_multa: Decimal = Field(default=Decimal("0.00"), max_digits=12, decimal_places=2)

    # --- Datas ---
    data_vencimento: datetime.date = Field(index=True)
    data_pagamento: Optional[datetime.date] = Field(default=None, index=True) 
    data_competencia: datetime.date = Field(index=True)
    competencia: Optional[str] = Field(default=None, index=True)
    
    # --- Detalhes ---
    numero_parcela: Optional[int] = Field(default=None)
    id_parcelamento: Optional[str] = None
    observacao: Optional[str] = None
    tipo_origem: Optional[str] = Field(default=None, index=True, nullable=True)
    origem_uuid: Optional[str] = Field(default=None, index=True, nullable=True)
    conciliado: bool = Field(default=False)
    import_hash: Optional[str] = Field(default=None, index=True)
    movimento_uid: Optional[str] = Field(default=None, index=True)
    referencia_externa: Optional[str] = Field(default=None, index=True)
    ofx_bank_id: Optional[str] = Field(default=None, index=True)
    transferencia_grupo_id: Optional[str] = Field(default=None, index=True)

    # --- Chaves Estrangeiras ---
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    plano_contas_id: int = Field(foreign_key="plano_contas.id", index=True)
    conta_id: Optional[int] = Field(default=None, foreign_key="contas.id", index=True, nullable=True)
    entidade_id: Optional[int] = Field(default=None, foreign_key="entidades.id", index=True)
    cartao_id: Optional[int] = Field(default=None, foreign_key="cartoes.id", index=True)
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True)
    lote_cartao_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("lotes_cartao.id", use_alter=True, name="fk_lancamentos_lote_cartao_id_lotes_cartao"),
            nullable=True,
            index=True
        )
    )

    # --- Relacionamentos ---
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", back_populates="lancamentos"))
    plano_contas: "PlanoContas" = Relationship(sa_relationship=relationship("PlanoContas"))
    conta: Optional["Conta"] = Relationship(sa_relationship=relationship("Conta", back_populates="lancamentos"))
    entidade: Optional["Entidade"] = Relationship(sa_relationship=relationship("Entidade", back_populates="lancamentos"))
    cartao: Optional["Cartao"] = Relationship(sa_relationship=relationship("Cartao", back_populates="lancamentos"))
    centro_custo: Optional["CentroCusto"] = Relationship(sa_relationship=relationship("CentroCusto", back_populates="lancamentos"))
    lote_cartao: Optional["LoteCartao"] = Relationship(
        sa_relationship=relationship("LoteCartao", foreign_keys="[Lancamento.lote_cartao_id]")
    )
    anexos: list["AnexoLancamento"] = Relationship(
        sa_relationship=relationship("AnexoLancamento", back_populates="lancamento")
    )
    baixas: list["Baixa"] = Relationship(
        sa_relationship=relationship("Baixa", back_populates="lancamento", cascade="all, delete-orphan")
    )

    def calcular_status(self) -> str:
        return "PAGO" if self.data_pagamento is not None else "EM ABERTO"

    def __init__(self, **data: Any):
        super().__init__(**data)
        if "status" not in data:
            self.status = self.calcular_status()

    def atualizar_status(self):
        self.status = self.calcular_status()