# app/schemas/lancamento.py
from typing import Optional, List
from decimal import Decimal
import datetime
from sqlmodel import SQLModel

# Base comum
class LancamentoBase(SQLModel):
    descricao: str
    valor_previsto: float # Usamos float no schema para facilitar JSON, Decimal no model
    valor_pago: float = 0.0
    
    data_vencimento: datetime.date
    data_competencia: Optional[datetime.date] = None
    data_pagamento: Optional[datetime.date] = None
    
    tipo: str # RECEITA ou DESPESA
    status: str = "PENDENTE"
    
    # IDs de vínculo
    plano_contas_id: int
    conta_id: Optional[int] = None
    entidade_id: Optional[int] = None
    cartao_id: Optional[int] = None
    
    numero_parcela: Optional[str] = None
    conciliado: bool = False
    observacao: Optional[str] = None

# Criação (Herda tudo da base)
class LancamentoCreate(LancamentoBase):
    pass

# Leitura (Inclui ID e campos "virtuais" para o front-end)
class LancamentoRead(LancamentoBase):
    id: int
    empresa_id: int
    
    # Campos que preencheremos via JOIN no CRUD
    nome_entidade: Optional[str] = None 
    nome_conta: Optional[str] = None 
    nome_cartao: Optional[str] = None
    nome_plano_contas: Optional[str] = None 

# Atualização (Tudo opcional)
class LancamentoUpdate(SQLModel):
    descricao: Optional[str] = None
    valor_previsto: Optional[float] = None
    valor_pago: Optional[float] = None
    data_vencimento: Optional[datetime.date] = None
    data_pagamento: Optional[datetime.date] = None
    status: Optional[str] = None
    conta_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None
    conciliado: Optional[bool] = None

# Schema Especial para Ações em Massa (Bulk)
class BulkActionSchema(SQLModel):
    ids: List[int]
    data_pagamento: Optional[datetime.date] = None
    copiar_valor: bool = True


# Schema específico para Transferência
class TransferenciaCreate(SQLModel):
    conta_origem_id: int
    conta_destino_id: int
    valor: Decimal
    data_transferencia: datetime.date
    observacao: Optional[str] = None
    # Opcional: IDs de categorias específicas para identificar transferências
    categoria_saida_id: int 
    categoria_entrada_id: int