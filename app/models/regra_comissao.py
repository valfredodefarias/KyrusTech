# app/models/regra_comissao.py
from __future__ import annotations
from typing import Optional
from sqlmodel import Field, SQLModel
from decimal import Decimal
import datetime
from .base_audit import AuditMixin

class RegraComissao(AuditMixin, SQLModel, table=True):
    __tablename__ = "regras_comissao"

    id: Optional[int] = Field(default=None, primary_key=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    centro_custo_id: Optional[int] = Field(default=None, foreign_key="centros_custo.id", index=True, nullable=True)
    data_inicio: datetime.date = Field(index=True)
    
    # 1.00 significa 100% de repasse para serviços
    taxa_servico: Decimal = Field(default=Decimal("1.00"), max_digits=5, decimal_places=4)
    
    # Regras de atraso para boletos
    dias_tolerancia_atraso: int = Field(default=0)
    redutor_atraso_intermediario_pct: Decimal = Field(default=Decimal("0.00"), max_digits=5, decimal_places=4) # Ex: 0.50 significa perder 50% da comissão
    dias_limite_atraso: int = Field(default=365) # Ex: 30 significa que acima de 30 dias de atraso o vendedor não recebe comissão (0%)
    
    # Faixas de escalonamento de comissão de produtos em JSON
    # Ex: [{"min_faturamento": 0, "taxa": 0.006}, {"min_faturamento": 10000, "taxa": 0.019}]
    faixas_produtos_json: str = Field(default="[]")
