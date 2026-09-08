from typing import List, Optional, Dict, Any
from decimal import Decimal
from sqlmodel import Session, select
from sqlalchemy import func, case, or_

from app.models.conta import Conta
from app.models.lancamento import Lancamento


def _tipo_receita_clause():
    return func.upper(Lancamento.tipo).like("R%")


def _tipo_despesa_clause():
    return func.upper(Lancamento.tipo).like("D%")


def _movimento_influencia_saldo_clause():
    return or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))


def calcular_saldos_contas(
    db: Session,
    empresa_id: int,
    conta_ids: Optional[List[int]] = None,
    apenas_ativas: bool = False,
    centro_custo_id: Optional[int] = None,
) -> Dict[int, Dict[str, Any]]:
    """
    Fonte Única da Verdade para cálculo de saldo bancário de contas.
    Calcula: saldo_atual = saldo_inicial + receitas_pagas - despesas_pagas.
    Retorna dicionário mapeado por conta_id contendo:
    - conta: objeto Conta
    - saldo_inicial: Decimal
    - total_receitas: Decimal
    - total_despesas: Decimal
    - saldo_atual: Decimal
    """
    query_contas = select(Conta).where(
        Conta.empresa_id == empresa_id,
        Conta.is_deleted == False,
    )
    if apenas_ativas:
        query_contas = query_contas.where(func.upper(Conta.status) == "ATIVO")
    if centro_custo_id is not None:
        query_contas = query_contas.where(Conta.centro_custo_id == centro_custo_id)
    if conta_ids:
        query_contas = query_contas.where(Conta.id.in_(conta_ids))

    contas = db.exec(query_contas).all()
    if not contas:
        return {}

    ids = [c.id for c in contas if c.id is not None]

    tipo_receita = _tipo_receita_clause()
    tipo_despesa = _tipo_despesa_clause()
    movimento_pago = _movimento_influencia_saldo_clause()

    saldo_query = (
        select(
            Lancamento.conta_id,
            func.coalesce(
                func.sum(
                    case(
                        (tipo_receita, Lancamento.valor_pago),
                        else_=0,
                    )
                ),
                0,
            ).label("receitas"),
            func.coalesce(
                func.sum(
                    case(
                        (tipo_despesa, Lancamento.valor_pago),
                        else_=0,
                    )
                ),
                0,
            ).label("despesas"),
        )
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            movimento_pago,
            Lancamento.conta_id.in_(ids),
        )
        .group_by(Lancamento.conta_id)
    )

    saldos_movimentos = {
        int(row[0]): (Decimal(str(row[1] or 0)), Decimal(str(row[2] or 0)))
        for row in db.exec(saldo_query).all()
        if row[0] is not None
    }

    resultado: Dict[int, Dict[str, Any]] = {}
    for conta in contas:
        cid = int(conta.id) if conta.id is not None else 0
        val_inicial = Decimal(str(conta.saldo_inicial or 0))
        receitas, despesas = saldos_movimentos.get(cid, (Decimal("0.00"), Decimal("0.00")))
        saldo_real = val_inicial + receitas - despesas

        resultado[cid] = {
            "conta": conta,
            "saldo_inicial": val_inicial,
            "total_receitas": receitas,
            "total_despesas": despesas,
            "saldo_atual": saldo_real,
        }

    return resultado
