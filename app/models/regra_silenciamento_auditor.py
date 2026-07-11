from __future__ import annotations

from typing import Optional
from sqlmodel import Field, SQLModel
from .base_audit import AuditMixin

class RegraSilenciamentoAuditor(AuditMixin, SQLModel, table=True):
    __tablename__ = "regras_silenciamento_auditor"

    id: Optional[int] = Field(default=None, primary_key=True)
    tipo_anomalia: str = Field(index=True)                  # Ex: "VALOR_ATIPICO", "DESVIO_PLANO_CONTAS"
    plano_contas_id: Optional[int] = Field(default=None, foreign_key="plano_contas.id", nullable=True)
    entidade_id: Optional[int] = Field(default=None, foreign_key="entidades.id", nullable=True)
    valor_limite: Optional[float] = Field(default=None, nullable=True) # Silenciar se valor for menor ou igual
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
