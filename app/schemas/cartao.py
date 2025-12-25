# app/schemas/cartao.py
from typing import Optional
from sqlmodel import SQLModel

class CartaoBase(SQLModel):
    nome_cartao: str
    limite_total: float
    dia_fechamento: int
    dia_vencimento: int
    status: str = "ATIVO"
    id_conta_padrao: Optional[int] = None 
    
    # --- NOVO CAMPO ---
    centro_custo_id: Optional[int] = None

class CartaoCreate(CartaoBase):
    pass

class CartaoRead(CartaoBase):
    id: int
    empresa_id: int
    # Opcional: Se quiser retornar o nome do centro de custo direto na leitura futuramente
    # nome_centro_custo: Optional[str] = None 

class CartaoUpdate(SQLModel):
    nome_cartao: Optional[str] = None
    limite_total: Optional[float] = None
    dia_fechamento: Optional[int] = None
    dia_vencimento: Optional[int] = None
    status: Optional[str] = None
    id_conta_padrao: Optional[int] = None
    
    # --- NOVO CAMPO PARA EDIÇÃO ---
    centro_custo_id: Optional[int] = None