# app/schemas/lancamento.py
from typing import Optional, List
from decimal import Decimal
from datetime import date
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin
from .anexo import AnexoRead 

# --- BASE (Campos que o Frontend ENVIA) ---
class LancamentoBase(SQLModel):
    descricao: str
    tipo: str # RECEITA, DESPESA
    origem: str = "WEB"
    ipp: bool = False
    
    # Valores Monetários
    valor_previsto: Decimal
    valor_pago: Decimal = Decimal("0.00")
    valor_juros: Decimal = Decimal("0.00")
    valor_desconto: Decimal = Decimal("0.00")
    valor_multa: Decimal = Decimal("0.00")
    
    data_vencimento: date
    data_competencia: date # Importante para relatórios contábeis (DRE)
    data_pagamento: Optional[date] = None
    
    observacao: Optional[str] = None
    conciliado: bool = False
    
    # IDs (Foreign Keys)
    # OBS: Removemos 'empresa_id' daqui. O Backend pega pelo Token.
    plano_contas_id: int # Antigo categoria_id
    conta_id: Optional[int] = None
    entidade_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    cartao_id: Optional[int] = None

# --- CREATE (Herda da Base) ---
class LancamentoCreate(LancamentoBase):
    pass

# --- UPDATE (Tudo Opcional) ---
class LancamentoUpdate(SQLModel):
    descricao: Optional[str] = None
    tipo: Optional[str] = None
    valor_previsto: Optional[Decimal] = None
    valor_pago: Optional[Decimal] = None
    valor_juros: Optional[Decimal] = None
    valor_desconto: Optional[Decimal] = None
    valor_multa: Optional[Decimal] = None
    
    data_pagamento: Optional[date] = None
    data_vencimento: Optional[date] = None
    data_competencia: Optional[date] = None
    
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    
    status: Optional[str] = None
    observacao: Optional[str] = None
    conciliado: Optional[bool] = None

# --- READ (O que o Backend Devolve) ---
class LancamentoRead(LancamentoBase, AuditReadMixin):
    id: int
    empresa_id: int # Aqui sim mostramos o ID da empresa para leitura interna
    status: str 
    anexos: List[AnexoRead] = []

# --- SCHEMAS ESPECIAIS (BULK & TRANSFERÊNCIA) ---

class BulkActionSchema(SQLModel):
    ids: List[int]
    data_pagamento: Optional[date] = None
    conta_id: Optional[int] = None 

class BulkUpdateSchema(SQLModel):
    ids: List[int]
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    data_pagamento: Optional[date] = None
    status: Optional[str] = None

class TransferenciaCreate(SQLModel):
    conta_origem_id: int
    conta_destino_id: int
    valor: Decimal
    data: date
    plano_contas_id: Optional[int] = None # Padronizado (era categoria_id)
    observacao: Optional[str] = None