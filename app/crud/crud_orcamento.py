from __future__ import annotations

from decimal import Decimal
from typing import List

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, select

from app.models.lancamento import Lancamento
from app.models.orcamento import Orcamento
from app.models.plano_contas import PlanoContas
from app.schemas.orcamento import OrcamentoCreate
from app.schemas.orcamento import (
    OrcamentoMatrizMesRead,
    OrcamentoMatrizNodeRead,
)


ZERO = Decimal("0.00")


def _decimal(value: object) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value))


def _build_month_items() -> list[OrcamentoMatrizMesRead]:
    return [OrcamentoMatrizMesRead(mes=mes) for mes in range(1, 13)]


def upsert_batch(
    db: Session,
    *,
    items_in: List[OrcamentoCreate],
    empresa_id: int,
) -> List[Orcamento]:
    if not items_in:
        return []

    if len(items_in) > 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tamanho de lote excede o limite permitido (máximo de 1.000 itens)."
        )

    plano_ids = {int(item.plano_conta_id) for item in items_in}
    if plano_ids:
        contas_validas = db.exec(
            select(PlanoContas.id)
            .where(
                PlanoContas.id.in_(plano_ids),
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False
            )
        ).all()
        if len(contas_validas) != len(plano_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Um ou mais planos de contas informados são inválidos ou não pertencem a esta empresa."
            )

    payloads = [
        {
            **item.model_dump(),
            "empresa_id": empresa_id,
        }
        for item in items_in
    ]

    statement = insert(Orcamento).values(payloads)
    statement = statement.on_conflict_do_update(
        index_elements=["empresa_id", "plano_conta_id", "ano", "mes"],
        set_={"valor_orcado": statement.excluded.valor_orcado},
    ).returning(Orcamento)

    result = db.exec(statement)
    db.commit()
    return list(result.scalars().all())


def get_matriz(
    db: Session,
    *,
    ano: int,
    empresa_id: int,
) -> List[OrcamentoMatrizNodeRead]:
    planos = db.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id)
        .where(PlanoContas.is_deleted == False)
        .where(PlanoContas.oculta == False)
        .order_by(PlanoContas.codigo, PlanoContas.nome)
    ).all()

    orcamento_rows = db.exec(
        select(
            Orcamento.plano_conta_id,
            Orcamento.mes,
            func.coalesce(func.sum(Orcamento.valor_orcado), ZERO),
        )
        .where(Orcamento.empresa_id == empresa_id)
        .where(Orcamento.ano == ano)
        .group_by(Orcamento.plano_conta_id, Orcamento.mes)
    ).all()

    realizado_rows = db.exec(
        select(
            Lancamento.plano_contas_id,
            func.extract("month", Lancamento.data_pagamento),
            func.coalesce(func.sum(Lancamento.valor_pago), ZERO),
        )
        .where(Lancamento.empresa_id == empresa_id)
        .where(Lancamento.is_deleted == False)
        .where(Lancamento.status == "PAGO")
        .where(Lancamento.data_pagamento.is_not(None))
        .where(func.extract("year", Lancamento.data_pagamento) == ano)
        .group_by(Lancamento.plano_contas_id, func.extract("month", Lancamento.data_pagamento))
    ).all()

    orcamentos_por_plano: dict[int, dict[int, Decimal]] = {}
    for plano_conta_id, mes, total in orcamento_rows:
        if plano_conta_id is None or mes is None:
            continue
        orcamentos_por_plano.setdefault(int(plano_conta_id), {})[int(mes)] = _decimal(total)

    realizados_por_plano: dict[int, dict[int, Decimal]] = {}
    for plano_conta_id, mes, total in realizado_rows:
        if plano_conta_id is None or mes is None:
            continue
        realizados_por_plano.setdefault(int(plano_conta_id), {})[int(mes)] = _decimal(total)

    nodes_by_id: dict[int, OrcamentoMatrizNodeRead] = {}
    for plano in planos:
        if plano.id is None:
            continue

        node = OrcamentoMatrizNodeRead(
            plano_contas_id=int(plano.id),
            conta_pai_id=int(plano.conta_pai_id) if plano.conta_pai_id is not None else None,
            nome=plano.nome,
            codigo=plano.codigo,
            tipo=plano.tipo,
            dre_grupo=plano.dre_grupo,
            oculta=bool(plano.oculta),
            meses=_build_month_items(),
        )

        for mes_item in node.meses:
            is_auto = False
            if mes_item.mes in orcamentos_por_plano.get(int(plano.id), {}):
                valor_orcado = orcamentos_por_plano[int(plano.id)][mes_item.mes]
            else:
                valor_orcado = realizados_por_plano.get(int(plano.id), {}).get(mes_item.mes, ZERO)
                is_auto = True
                
            valor_realizado = realizados_por_plano.get(int(plano.id), {}).get(mes_item.mes, ZERO)
            mes_item.valor_orcado = valor_orcado
            mes_item.valor_realizado = valor_realizado
            mes_item.is_auto = is_auto
            mes_item.desvio_absoluto = valor_realizado - valor_orcado
            mes_item.desvio_percentual = (
                (mes_item.desvio_absoluto / valor_orcado) * Decimal("100")
                if valor_orcado != ZERO
                else ZERO
            )

        nodes_by_id[int(plano.id)] = node

    roots: list[OrcamentoMatrizNodeRead] = []
    for node in nodes_by_id.values():
        parent_id = node.conta_pai_id
        if parent_id is not None and parent_id in nodes_by_id:
            nodes_by_id[parent_id].children.append(node)
        else:
            roots.append(node)

    def aggregate(node: OrcamentoMatrizNodeRead) -> None:
        for child in node.children:
            aggregate(child)

        for idx, mes_item in enumerate(node.meses):
            for child in node.children:
                child_mes = child.meses[idx]
                mes_item.valor_realizado += child_mes.valor_realizado
                mes_item.valor_orcado += child_mes.valor_orcado

            mes_item.desvio_absoluto = mes_item.valor_realizado - mes_item.valor_orcado
            mes_item.desvio_percentual = (
                (mes_item.desvio_absoluto / mes_item.valor_orcado) * Decimal("100")
                if mes_item.valor_orcado != ZERO
                else ZERO
            )

        node.total_realizado = sum((mes.valor_realizado for mes in node.meses), ZERO)
        node.total_orcado = sum((mes.valor_orcado for mes in node.meses), ZERO)
        node.total_desvio_absoluto = node.total_realizado - node.total_orcado
        node.total_desvio_percentual = (
            (node.total_desvio_absoluto / node.total_orcado) * Decimal("100")
            if node.total_orcado != ZERO
            else ZERO
        )

    for root in roots:
        aggregate(root)

    def sort_key(item: OrcamentoMatrizNodeRead) -> tuple[str, str]:
        return (str(item.codigo or "zzz"), item.nome)

    def sort_tree(items: list[OrcamentoMatrizNodeRead]) -> None:
        items.sort(key=sort_key)
        for item in items:
            if item.children:
                sort_tree(item.children)

    sort_tree(roots)
    return roots