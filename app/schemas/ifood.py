# app/schemas/ifood.py
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional, List
from sqlmodel import SQLModel, Field

class PdvIfoodLancamentoCreate(SQLModel):
    forma_recebimento: str
    valor_bruto: Decimal
    data_venda: date
    hora_venda: Optional[str] = Field(default="00:00:00")
    data_recebimento_ajustada: date
    despesas_extras: Optional[List[str]] = Field(default_factory=list)

class PdvIfoodLancamentoRead(SQLModel):
    id: int
    empresa_id: int
    forma_recebimento: str
    valor_bruto: Decimal
    valor_liquido: Decimal
    data_venda: date
    hora_venda: str
    data_recebimento_ajustada: date
    despesas_extras: List[str]
    status_conciliado: bool


class PdvIfoodLancamentoUpdate(SQLModel):
    forma_recebimento: Optional[str] = None
    valor_bruto: Optional[Decimal] = None
    data_venda: Optional[date] = None
    hora_venda: Optional[str] = None
    data_recebimento_ajustada: Optional[date] = None
    despesas_extras: Optional[List[str]] = None
    status_conciliado: Optional[bool] = None
