from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlmodel import Field, SQLModel

from .base_audit import AuditReadMixin


class OrcamentoBase(SQLModel):
    plano_conta_id: int
    ano: int
    mes: int = Field(ge=1, le=12)
    valor_orcado: Decimal = Field(max_digits=14, decimal_places=2)


class OrcamentoCreate(OrcamentoBase):
    pass


class OrcamentoUpdate(SQLModel):
    plano_conta_id: Optional[int] = None
    ano: Optional[int] = None
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    valor_orcado: Optional[Decimal] = Field(default=None, max_digits=14, decimal_places=2)


class OrcamentoRead(OrcamentoBase, AuditReadMixin):
    empresa_id: int


class OrcamentoMatrizMesRead(SQLModel):
    mes: int
    valor_realizado: Decimal = Decimal("0.00")
    valor_orcado: Decimal = Decimal("0.00")
    desvio_absoluto: Decimal = Decimal("0.00")
    desvio_percentual: Decimal = Decimal("0.00")


class OrcamentoMatrizNodeRead(SQLModel):
    plano_contas_id: int
    conta_pai_id: Optional[int] = None
    nome: str
    codigo: Optional[str] = None
    tipo: str
    dre_grupo: Optional[str] = None
    oculta: bool = False
    meses: list[OrcamentoMatrizMesRead] = Field(default_factory=list)
    total_realizado: Decimal = Decimal("0.00")
    total_orcado: Decimal = Decimal("0.00")
    total_desvio_absoluto: Decimal = Decimal("0.00")
    total_desvio_percentual: Decimal = Decimal("0.00")
    children: list["OrcamentoMatrizNodeRead"] = Field(default_factory=list)


OrcamentoMatrizNodeRead.model_rebuild()