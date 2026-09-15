# app/services/pdv/estoque_service.py
from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import List, Dict, Any
from sqlmodel import Session, select
from sqlalchemy import func

from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.produto import Produto
from app.models.pdv_venda_item import PdvVendaItem
from app.models.lancamento import Lancamento


def processar_estoque_venda(
    db: Session,
    empresa_id: int,
    venda_id: str,
    itens: List[Dict[str, Any]],
    status: str,
    user_id: int
) -> List[str]:
    alertas = []

    # 1. Deletar (soft delete) quaisquer movimentações antigas vinculadas a esta venda
    movs_antigas = db.exec(
        select(MovimentacaoEstoque)
        .where(
            MovimentacaoEstoque.empresa_id == empresa_id,
            MovimentacaoEstoque.chave_nfe == f"pdv:{venda_id}",
            MovimentacaoEstoque.is_deleted == False
        )
    ).all()
    for m in movs_antigas:
        m.is_deleted = True
        m.deleted_at = datetime.utcnow()
        m.deleted_by_id = user_id
        db.add(m)
    db.flush()

    # 2. Se o status for REALIZADO, criar novas movimentações de saída
    if status.upper() == "REALIZADO":
        for item in itens:
            produto_id = item.get("produto_id")
            if not produto_id:
                continue
            produto = db.get(Produto, produto_id)
            if not produto or produto.is_deleted:
                continue
            
            # Ignorar serviços para controle de estoque
            if getattr(produto, "tipo", None) == "SERVICO":
                continue

            quantidade = float(item.get("quantidade", 0))
            if quantidade <= 0:
                continue

            custo_medio = getattr(produto, "preco_custo_medio", 0.0) or 0.0

            m = MovimentacaoEstoque(
                empresa_id=empresa_id,
                produto_id=produto_id,
                quantidade=-quantidade,
                tipo="Saída por Venda",
                valor_unitario=float(custo_medio),
                valor_total=float(Decimal(str(custo_medio)) * Decimal(str(quantidade))),
                chave_nfe=f"pdv:{venda_id}",
                created_by_id=user_id,
                updated_by_id=user_id,
                is_deleted=False,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            db.add(m)
            
            item["custo_medio_historico"] = float(custo_medio)

            # Alerta de estoque mínimo
            estoque_total = db.exec(
                select(func.sum(MovimentacaoEstoque.quantidade))
                .where(
                    MovimentacaoEstoque.produto_id == produto_id,
                    MovimentacaoEstoque.empresa_id == empresa_id,
                    MovimentacaoEstoque.is_deleted == False
                )
            ).first() or 0.0

            novo_estoque = estoque_total - quantidade
            estoque_minimo = getattr(produto, "estoque_minimo", None)
            if estoque_minimo is not None and novo_estoque < float(estoque_minimo):
                alertas.append(
                    f"Produto '{produto.nome}' ficou abaixo do estoque mínimo (Estoque atual: {novo_estoque:.2f}, Mínimo: {estoque_minimo:.2f})."
                )

            # Alerta de preço de venda abaixo do custo
            preco_unitario_venda = item.get("preco_unitario", 0.0)
            if preco_unitario_venda < float(custo_medio):
                alertas.append(
                    f"Produto '{produto.nome}' foi vendido abaixo do custo médio (Preço de venda: R$ {preco_unitario_venda:.2f}, Custo médio: R$ {custo_medio:.2f})."
                )

    return alertas


def recalcular_estoque_e_custo_medio_produto(db: Session, empresa_id: int, produto_id: int) -> None:
    produto = db.get(Produto, produto_id)
    if not produto or produto.is_deleted:
        return

    # Busca todas as movimentações chronologically
    movs = db.exec(
        select(MovimentacaoEstoque)
        .where(
            MovimentacaoEstoque.produto_id == produto_id,
            MovimentacaoEstoque.empresa_id == empresa_id,
            MovimentacaoEstoque.is_deleted == False
        )
        .order_by(MovimentacaoEstoque.created_at, MovimentacaoEstoque.id)
    ).all()

    saldo = 0.0
    custo_medio = 0.0

    for m in movs:
        if m.quantidade > 0:
            # Entrada de estoque
            # Recalcula custo médio
            if saldo <= 0:
                custo_medio = m.valor_unitario
            else:
                total_valor_antigo = saldo * custo_medio
                total_valor_novo = total_valor_antigo + m.valor_total
                total_quantidade_nova = saldo + m.quantidade
                if total_quantidade_nova > 0:
                    custo_medio = float(total_valor_novo / total_quantidade_nova)
            saldo += m.quantidade
        else:
            # Saída de estoque
            m.valor_unitario = custo_medio
            m.valor_total = float(Decimal(str(custo_medio)) * Decimal(str(abs(m.quantidade))))
            db.add(m)
            saldo += m.quantidade

    # Salva o custo médio final no produto
    produto.preco_custo_medio = custo_medio
    db.add(produto)
    db.flush()


def sincronizar_status_estoque_e_splits(
    db: Session,
    empresa_id: int,
    venda_id: str,
    novo_status: str,
    user_id: int
) -> None:
    # 1. Obter os itens da venda via tabela operacional PdvVendaItem
    itens_db = db.exec(
        select(PdvVendaItem)
        .where(PdvVendaItem.venda_id == venda_id)
    ).all()

    if not itens_db:
        return

    itens = [
        {
            "produto_id": it.produto_id,
            "quantidade": float(it.quantidade),
            "preco_unitario": float(it.preco_unitario),
            "desconto": float(it.desconto or 0),
            "subtotal": float(it.subtotal)
        }
        for it in itens_db
    ]

    # 2. Atualizar estoque
    processar_estoque_venda(db, empresa_id, venda_id, itens, novo_status, user_id)

    # 3. Recalcular custo médio e saldo dos produtos
    for item in itens:
        produto_id = item.get("produto_id")
        if produto_id:
            recalcular_estoque_e_custo_medio_produto(db, empresa_id, produto_id)

    # 4. Sincronizar o status de lançamentos de despesas extras (splits)
    desp_launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            Lancamento.id_parcelamento == venda_id,
            Lancamento.tipo == "DESPESA"
        )
    ).all()

    first_launch = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.origem == "PDV",
            Lancamento.id_parcelamento == venda_id,
            Lancamento.tipo == "RECEITA"
        )
    ).first()

    for d in desp_launches:
        if novo_status in ["CANCELADO", "DEVOLVIDO"]:
            d.status = novo_status
            d.valor_pago = Decimal("0.00")
        elif novo_status == "REALIZADO":
            receita_paga = (first_launch.status == "PAGO") if first_launch else False
            d.status = "PAGO" if receita_paga else "EM ABERTO"
            d.valor_pago = d.valor_previsto if receita_paga else Decimal("0.00")
        d.updated_by_id = user_id
        d.updated_at = datetime.utcnow()
        db.add(d)
    db.flush()
