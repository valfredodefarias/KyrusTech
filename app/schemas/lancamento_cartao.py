from typing import Optional
from decimal import Decimal
from datetime import date
from pydantic import BaseModel, Field

class LancamentoCartaoBase(BaseModel):
    descricao: str
    valor: Decimal
    data_compra: date
    plano_contas_id: int
    centro_custo_id: Optional[int] = None
    entidade_id: Optional[int] = None
    observacao: Optional[str] = None

class LancamentoCartaoCreate(LancamentoCartaoBase):
    quantidade_parcelas: int = Field(default=1, ge=1)
    
    # Campo opcional que permite o frontend dizer em qual competência essa compra deve iniciar
    # Formato: YYYY-MM
    competencia_fatura_inicial: Optional[str] = None
    
    tipo_valor: str = Field(default="TOTAL") # "TOTAL" or "PARCELA"
    regime_competencia: str = Field(default="COMPRA") # "COMPRA" or "PARCELA"

class LancamentoCartaoUpdate(BaseModel):
    descricao: Optional[str] = None
    valor: Optional[Decimal] = None
    data_compra: Optional[date] = None
    plano_contas_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    entidade_id: Optional[int] = None
    observacao: Optional[str] = None

class LancamentoCartaoRead(LancamentoCartaoBase):
    id: int
    cartao_id: int
    empresa_id: int
    data_vencimento_fatura: date
    competencia_fatura: str
    numero_parcela: Optional[int] = None
    id_parcelamento: Optional[str] = None
    fatura_paga: bool
    import_hash: Optional[str] = None
    ofx_bank_id: Optional[str] = None
    lancamento_pagamento_id: Optional[int] = None

    class Config:
        from_attributes = True
