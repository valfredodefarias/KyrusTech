# app/schemas/pdv.py
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import List, Optional, Dict, Any
from sqlmodel import SQLModel


class PdvVendaItemRead(SQLModel):
    id: int
    rv: str
    data: date
    hora: Optional[str] = None
    vendedor: str
    status: str
    descricao: str
    valor: Decimal
    origem: Optional[str] = None
    venda_id_uuid: Optional[str] = None
    comprovante_url: Optional[str] = None
    comprovante_urls: Optional[List[str]] = None
    vendedor_id: Optional[int] = None
    entidade_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    desconto: Optional[Decimal] = None
    observacao_texto: Optional[str] = None
    itens_detalhe: Optional[list] = None
    pagamentos_detalhe: Optional[list] = None
    campos_extras: Optional[Dict[str, Any]] = None
    alertas: Optional[List[str]] = None
    is_direct_sale: Optional[bool] = False


class PdvVendaGrupoRead(SQLModel):
    data: date
    total: Decimal
    quantidade: int
    vendas: List[PdvVendaItemRead]


class PdvVendasRead(SQLModel):
    pode_ver_todas: bool
    total_vendas: int
    total_valor: Decimal
    grupos: List[PdvVendaGrupoRead]
    has_more: Optional[bool] = False



# --- Novos Schemas para Produtos e Vendas Itemizadas ---

class ProdutoRead(SQLModel):
    id: int
    nome: str
    preco_unitario: Decimal
    empresa_id: int
    is_active: bool
    tipo: str
    codigo_barras: Optional[str] = None
    imagem_url: Optional[str] = None
    preco_custo_medio: Optional[float] = 0.0
    ncm: Optional[str] = None
    cest: Optional[str] = None
    cfop_padrao: Optional[str] = None
    revisao_pendente: Optional[bool] = False
    quantidade_estoque: Optional[float] = 0.0


class ProdutoCreate(SQLModel):
    nome: str
    preco_unitario: Decimal
    tipo: str = "PRODUTO"
    codigo_barras: Optional[str] = None
    imagem_url: Optional[str] = None
    preco_custo_medio: Optional[float] = 0.0
    ncm: Optional[str] = None
    cest: Optional[str] = None
    cfop_padrao: Optional[str] = None
    revisao_pendente: bool = False


class ProdutoUpdate(SQLModel):
    nome: Optional[str] = None
    preco_unitario: Optional[Decimal] = None
    is_active: Optional[bool] = None
    tipo: Optional[str] = None
    codigo_barras: Optional[str] = None
    imagem_url: Optional[str] = None
    preco_custo_medio: Optional[float] = None
    ncm: Optional[str] = None
    cest: Optional[str] = None
    cfop_padrao: Optional[str] = None
    revisao_pendente: Optional[bool] = None


class PdvVendaItemCreate(SQLModel):
    produto_id: int
    quantidade: int
    desconto: Optional[Decimal] = Decimal("0.00")
    preco_unitario: Optional[Decimal] = None
    nome_customizado: Optional[str] = None


class PdvVendaPagamento(SQLModel):
    tipo_pagamento: str
    valor: Decimal
    numero_parcelas: Optional[int] = 1
    valor_parcela: Optional[Decimal] = None
    data_pagamento: Optional[date] = None
    bandeira: Optional[str] = "OUTROS"


class PdvVendaCreate(SQLModel):
    entidade_id: int
    centro_custo_id: int
    vendedor_id: int
    desconto: Decimal
    status: str = "REALIZADO"  # ORCAMENTO, REALIZADO
    itens: List[PdvVendaItemCreate]
    pagamentos: List[PdvVendaPagamento]
    rv: Optional[str] = None
    data_pagamento: Optional[date] = None
    cliente: Optional[str] = None  # mantido para compatibilidade
    observacao: Optional[str] = None
    comprovante_urls: Optional[List[str]] = None
    campos_extras: Optional[Dict[str, Any]] = None
    import_hash: Optional[str] = None
    is_direct_sale: Optional[bool] = False


# --- Schemas de Regras de Cartão ---

class RegraCartaoRead(SQLModel):
    id: int
    empresa_id: int
    tipo_pagamento: str
    bandeira: str
    centro_custo_id: Optional[int] = None
    taxa_porcentagem: Decimal
    dias_payout: int
    tipo_prazo: str
    dia_fixo: Optional[int] = None
    fds_proximo_dia_util: bool
    modo_parcelamento: str
    taxa_antecipacao: Decimal
    conta_destino_id: Optional[int] = None
    plano_contas_taxa_id: Optional[int] = None


class RegraCartaoCreate(SQLModel):
    tipo_pagamento: str
    bandeira: str = "OUTROS"
    centro_custo_id: Optional[int] = None
    taxa_porcentagem: Decimal = Decimal("0.00")
    dias_payout: int = 30
    tipo_prazo: str = "DIAS_CORRIDOS"
    dia_fixo: Optional[int] = None
    fds_proximo_dia_util: bool = True
    modo_parcelamento: str = "PRO_RATA"
    taxa_antecipacao: Decimal = Decimal("0.00")
    conta_destino_id: Optional[int] = None
    plano_contas_taxa_id: Optional[int] = None


class RegraCartaoUpdate(SQLModel):
    tipo_pagamento: Optional[str] = None
    bandeira: Optional[str] = None
    centro_custo_id: Optional[int] = None
    taxa_porcentagem: Optional[Decimal] = None
    dias_payout: Optional[int] = None
    tipo_prazo: Optional[str] = None
    dia_fixo: Optional[int] = None
    fds_proximo_dia_util: Optional[bool] = None
    modo_parcelamento: Optional[str] = None
    taxa_antecipacao: Optional[Decimal] = None
    conta_destino_id: Optional[int] = None
    plano_contas_taxa_id: Optional[int] = None


# --- Schemas de Lotes e Conciliação de Cartão ---

class LoteCartaoItemRead(SQLModel):
    id: int
    lote_cartao_id: int
    lancamento_id: int
    valor_bruto: Decimal
    valor_taxa: Decimal
    valor_liquido: Decimal
    descricao_venda: Optional[str] = None
    data_venda: Optional[date] = None


class LoteCartaoRead(SQLModel):
    id: int
    empresa_id: int
    data_pagamento: date
    valor_bruto: Decimal
    valor_taxa: Decimal
    valor_liquido: Decimal
    conta_destino_id: int
    lancamento_deposito_id: Optional[int] = None
    status: str
    itens: Optional[List[LoteCartaoItemRead]] = None


class LoteCartaoCreate(SQLModel):
    data_pagamento: date
    conta_destino_id: int
    lancamento_deposito_id: Optional[int] = None
    lancamento_ids: List[int]


class CustomFieldConfig(SQLModel):
    id: str
    label: str
    type: str  # 'text', 'number', 'currency', 'select', 'select_buttons', 'checkbox', 'date'
    required: bool
    order: int
    is_active: bool = True
    options: Optional[List[str]] = None
    defaultValue: Optional[Any] = None
    depends_on: Optional[Dict[str, Any]] = None
    validation_regex: Optional[str] = None
    input_mask: Optional[str] = None
    role: Optional[str] = None  # 'seller', 'client', 'cost_center', 'none'
    planoContasId: Optional[int] = None


class PdvConfigSchema(SQLModel):
    marcar_como_pago: Optional[Dict[str, bool]] = {}
    active_apps: Optional[List[str]] = []
    ifood_comissao_taxa: Optional[float] = 12.0
    ifood_merchant_name: Optional[str] = ""
    centro_custo_padrao_id: Optional[int] = None
    centro_custo_flexivel: Optional[bool] = False
    
    ifood_centro_custo_padrao_id: Optional[int] = None
    ifood_centro_custo_flexivel: Optional[bool] = False
    pdv_centro_custo_padrao_id: Optional[int] = None
    pdv_centro_custo_flexivel: Optional[bool] = False
    
    ifood_conta_padrao_id: Optional[int] = None
    pdv_conta_padrao_id: Optional[int] = None
    pdv_sangria_saida_plano_contas_id: Optional[int] = None
    pdv_sangria_entrada_plano_contas_id: Optional[int] = None


class SangriaCreateSchema(SQLModel):
    data: date
    valor: Decimal
    conta_destino_id: int
    descricao: Optional[str] = "Sangria de Caixa"


class PdvIfoodConsolidarIn(SQLModel):
    data_venda: date
    conta_id: int