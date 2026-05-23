# app/schemas/lancamento.py
from __future__ import annotations

from typing import Optional, List
from decimal import Decimal
from datetime import date
from sqlmodel import SQLModel
from .base_audit import AuditReadMixin
from .entidade import EntidadeLookup
from .anexo import AnexoRead 

# --- BASE (Campos que o Frontend ENVIA) ---
class LancamentoBase(SQLModel):
    descricao: str
    tipo: str # RECEITA, DESPESA
    origem: str = "WEB"
    ipp: bool = False
    previsto: bool = True
    
    # Valores Monetários
    valor_previsto: Decimal
    valor_pago: Decimal = Decimal("0.00")
    valor_juros: Decimal = Decimal("0.00")
    valor_desconto: Decimal = Decimal("0.00")
    valor_multa: Decimal = Decimal("0.00")
    
    data_vencimento: date
    data_competencia: Optional[date] = None
    competencia: Optional[str] = None
    # Regra de Negócio: Se vier Nulo, é considerado EM ABERTO
    data_pagamento: Optional[date] = None
    
    observacao: Optional[str] = None
    conciliado: bool = False
    numero_parcela: Optional[int] = None
    id_parcelamento: Optional[str] = None
    
    # --- CHAVES ESTRANGEIRAS ---
    
    # OBRIGATÓRIO: Todo lançamento precisa ter uma categoria (Plano de Contas)
    plano_contas_id: int 
    
    # OPCIONAIS: O usuário pode lançar algo sem saber o banco ou o cliente ainda
    conta_id: Optional[int] = None
    entidade_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    cartao_id: Optional[int] = None

# --- CREATE ---
class LancamentoCreate(LancamentoBase):
    pass

# --- UPDATE ---
class LancamentoUpdate(SQLModel):
    descricao: Optional[str] = None
    tipo: Optional[str] = None
    ipp: Optional[bool] = None
    previsto: Optional[bool] = None
    valor_previsto: Optional[Decimal] = None
    valor_pago: Optional[Decimal] = None
    valor_juros: Optional[Decimal] = None
    valor_desconto: Optional[Decimal] = None
    valor_multa: Optional[Decimal] = None
    
    data_pagamento: Optional[date] = None
    data_vencimento: Optional[date] = None
    data_competencia: Optional[date] = None
    competencia: Optional[str] = None
    
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    
    status: Optional[str] = None
    observacao: Optional[str] = None
    conciliado: Optional[bool] = None
    numero_parcela: Optional[int] = None
    id_parcelamento: Optional[str] = None

# --- READ ---
class LancamentoRead(LancamentoBase, AuditReadMixin):
    id: int
    empresa_id: int 
    status: str 
    anexos: List[AnexoRead] = []
    entidade: Optional[EntidadeLookup] = None

# --- SCHEMAS ESPECIAIS ---

class BulkActionSchema(SQLModel):
    ids: List[int]
    data_pagamento: Optional[date] = None
    conta_id: Optional[int] = None 
    confirmar_exclusao_pagos: bool = False

class BulkUpdateSchema(SQLModel):
    ids: List[int]
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    descricao: Optional[str] = None
    data_vencimento: Optional[date] = None
    competencia: Optional[str] = None
    data_pagamento: Optional[date] = None
    status: Optional[str] = None

class TransferenciaCreate(SQLModel):
    conta_origem_id: int
    conta_destino_id: int
    valor: Decimal
    data: date
    # Aqui é opcional, se não enviar pegamos a categoria padrão do sistema
    plano_contas_id: Optional[int] = None 
    centro_custo_id: Optional[int] = None
    observacao: Optional[str] = None