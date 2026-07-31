from __future__ import annotations

from typing import Optional, TYPE_CHECKING
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel
from decimal import Decimal
import datetime

from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .conta import Conta
    from .baixa import Baixa


class Movimento(AuditMixin, SQLModel, table=True):
    __tablename__ = "movimentos"

    id: Optional[int] = Field(default=None, primary_key=True)
    descricao: str = Field(index=True)
    valor: Decimal = Field(max_digits=12, decimal_places=2)
    tipo: str = Field(index=True)  # RECEITA, DESPESA
    data: datetime.date = Field(index=True)
    import_hash: str = Field(index=True, unique=True)
    status: str = Field(default="ABERTO", index=True)  # ABERTO, CONCILIADO
    origem: str = Field(default="OFX", index=True)      # MANUAL, OFX, OPEN_FINANCE, CARTAO

    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    conta_id: int = Field(foreign_key="contas.id", index=True)

    # Campos Estruturados de Extrato OFX
    descricao_original: Optional[str] = Field(default=None, index=True)
    fitid: Optional[str] = Field(default=None, index=True)
    payee_bruto: Optional[str] = Field(default=None)
    documento_extrato: Optional[str] = Field(default=None)
    ocorrencia_index: int = Field(default=1)
    ofx_bank_id: Optional[str] = Field(default=None)
    ofx_agencia: Optional[str] = Field(default=None)
    ofx_conta_numero: Optional[str] = Field(default=None)
    pix_e2e_id: Optional[str] = Field(default=None, index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(sa_relationship=relationship("Empresa", lazy="selectin"))
    conta: "Conta" = Relationship(sa_relationship=relationship("Conta", lazy="selectin"))
    baixas: list["Baixa"] = Relationship(
        sa_relationship=relationship(
            "Baixa",
            back_populates="movimento",
            cascade="all, delete-orphan"
        )
    )
