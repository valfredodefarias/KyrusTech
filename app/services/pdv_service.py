# app/services/pdv_service.py
"""
Facade for backward-compatibility.
The actual implementation is organized by domain in `app.services.pdv.*`:
- `cartao_service`: Card rules, payout dates, and grouped receivables.
- `estoque_service`: Inventory depletion and average cost recalculation.
- `venda_service`: Checkout, pricing, and sales lifecycle.
- `ifood_service`: Marketplace consolidation and fee splits.
"""
from __future__ import annotations
from typing import List, Optional, Dict, Any
from sqlmodel import Session

from app.models.regra_cartao import RegraCartao
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemRead
from app.services.pdv.cartao_service import (
    obter_conta_caixa_fisica,
    calcular_vencimento_dia_fixo,
    adicionar_dias_uteis,
    calcular_payout_date,
    shift_months,
    obter_categoria_pagamento,
    obter_regra_cartao,
    format_card_description,
    adicionar_ou_atualizar_recebivel_cartao_agrupado,
    remover_contribuicoes_venda,
    atualizar_status_contribuicoes_venda,
    obter_categoria_taxas_cartao,
)
from app.services.pdv.estoque_service import (
    processar_estoque_venda,
    recalcular_estoque_e_custo_medio_produto,
    sincronizar_status_estoque_e_splits,
)
from app.services.pdv.venda_service import (
    obter_categoria_receita_pdv,
    obter_categoria_taxas_delivery,
    resolve_generic_products,
    validar_e_processar_campos_extras,
    criar_venda as _criar_venda,
    atualizar_venda as _atualizar_venda,
)
from app.services.pdv.ifood_service import (
    consolidar_transacoes_ifood,
)


class PdvService:
    @staticmethod
    def _resolve_generic_products(db: Session, empresa_id: int, itens: List[Any]):
        return resolve_generic_products(db, empresa_id, itens)

    @staticmethod
    def validar_e_processar_campos_extras(
        db: Session,
        empresa_id: int,
        campos_extras: Optional[Dict[str, Any]],
        current_user_id: int
    ) -> Dict[str, Any]:
        return validar_e_processar_campos_extras(db, empresa_id, campos_extras, current_user_id)

    @staticmethod
    def processar_estoque_venda(
        db: Session,
        empresa_id: int,
        venda_id: str,
        itens: List[Dict[str, Any]],
        status: str,
        user_id: int
    ) -> List[str]:
        return processar_estoque_venda(db, empresa_id, venda_id, itens, status, user_id)

    @staticmethod
    def recalcular_estoque_e_custo_medio_produto(db: Session, empresa_id: int, produto_id: int) -> None:
        return recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

    @staticmethod
    def sincronizar_status_estoque_e_splits(
        db: Session,
        empresa_id: int,
        venda_id: str,
        novo_status: str,
        user_id: int
    ) -> None:
        return sincronizar_status_estoque_e_splits(db, empresa_id, venda_id, novo_status, user_id)

    @staticmethod
    def criar_venda(
        db: Session,
        venda_in: PdvVendaCreate,
        empresa_id: int,
        current_user_id: int
    ) -> PdvVendaItemRead:
        return _criar_venda(db, venda_in, empresa_id, current_user_id)

    @staticmethod
    def atualizar_venda(
        db: Session,
        venda_id: str,
        venda_in: PdvVendaCreate,
        empresa_id: int,
        current_user_id: int
    ) -> PdvVendaItemRead:
        return _atualizar_venda(db, venda_id, venda_in, empresa_id, current_user_id)
