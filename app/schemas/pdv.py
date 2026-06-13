# app/schemas/pdv.py
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import List, Optional
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


# --- Novos Schemas para Produtos e Vendas Itemizadas ---

class ProdutoRead(SQLModel):
    id: int
    nome: str
    preco_unitario: Decimal
    empresa_id: int
    is_active: bool
    tipo: str


class ProdutoCreate(SQLModel):
    nome: str
    preco_unitario: Decimal
    tipo: str = "PRODUTO"


class ProdutoUpdate(SQLModel):
    nome: Optional[str] = None
    preco_unitario: Optional[Decimal] = None
    is_active: Optional[bool] = None
    tipo: Optional[str] = None


class PdvVendaItemCreate(SQLModel):
    produto_id: int
    quantidade: int
    desconto: Optional[Decimal] = Decimal("0.00")
    preco_unitario: Optional[Decimal] = None


class PdvVendaPagamento(SQLModel):
    tipo_pagamento: str
    valor: Decimal
    numero_parcelas: Optional[int] = 1
    valor_parcela: Optional[Decimal] = None
    data_pagamento: Optional[date] = None


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