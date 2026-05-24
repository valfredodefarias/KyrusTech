from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlmodel import Field, SQLModel


class Orcamento(SQLModel, table=True):
    __tablename__ = "orcamentos"
    __table_args__ = (
        UniqueConstraint(
            "empresa_id",
            "plano_conta_id",
            "ano",
            "mes",
            name="uq_orcamentos_empresa_plano_conta_ano_mes",
        ),
        CheckConstraint("mes >= 1 AND mes <= 12", name="ck_orcamentos_mes_1_12"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    plano_conta_id: int = Field(foreign_key="plano_contas.id", index=True)
    ano: int = Field(index=True)
    mes: int = Field(index=True, ge=1, le=12)
    valor_orcado: Decimal = Field(max_digits=14, decimal_places=2)