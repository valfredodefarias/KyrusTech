"""
Schemas para integrações bancárias.
"""
from typing import Optional
from sqlmodel import SQLModel
from datetime import datetime


class IntegracaoBancariaBase(SQLModel):
    nome: str
    tipo: str  # ASAAS, ITAU, NUBANK, etc.
    ambiente: str = "PRODUCAO"  # PRODUCAO ou SANDBOX
    token: str  # Token em texto puro (será criptografado ao salvar)
    configuracao_adicional: Optional[dict] = None
    ativo: bool = True
    sincronizar_automaticamente: bool = True
    intervalo_sincronizacao_minutos: int = 60
    categoria_padrao_id: Optional[int] = None
    usar_categoria_a_categorizar: bool = True
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None


class IntegracaoBancariaCreate(IntegracaoBancariaBase):
    pass


class IntegracaoBancariaUpdate(SQLModel):
    nome: Optional[str] = None
    ambiente: Optional[str] = None
    token: Optional[str] = None  # Se fornecido, será atualizado e criptografado
    configuracao_adicional: Optional[dict] = None
    ativo: Optional[bool] = None
    sincronizar_automaticamente: Optional[bool] = None
    intervalo_sincronizacao_minutos: Optional[int] = None
    categoria_padrao_id: Optional[int] = None
    usar_categoria_a_categorizar: Optional[bool] = None
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None


class IntegracaoBancariaRead(SQLModel):
    id: int
    nome: str
    tipo: str
    ambiente: str
    ativo: bool
    sincronizar_automaticamente: bool
    intervalo_sincronizacao_minutos: int
    ultima_sincronizacao: Optional[datetime] = None
    proxima_sincronizacao: Optional[datetime] = None
    categoria_padrao_id: Optional[int] = None
    usar_categoria_a_categorizar: bool
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    empresa_id: int
    created_at: datetime
    updated_at: datetime
    # NÃO inclui token_criptografado por segurança


class MapeamentoCategoriaCreate(SQLModel):
    """Schema para criar mapeamento de categoria"""
    categoria_externa: str  # Nome/código da categoria no sistema externo
    plano_contas_id: int  # ID da categoria no nosso sistema


class MapeamentoCategoriaRead(SQLModel):
    """Schema para ler mapeamento de categoria"""
    id: Optional[int] = None
    categoria_externa: str
    plano_contas_id: int
    plano_contas_nome: Optional[str] = None



