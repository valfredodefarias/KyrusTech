from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional, Dict, Any
from zoneinfo import ZoneInfo

from sqlmodel import Session, select
from sqlalchemy import func, case, and_, or_

from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.plano_contas import PlanoContas

SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")


def get_boletim_resumo(
    db: Session,
    empresa_id: int,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    centro_custo_id: Optional[int] = None,
    conta_id: Optional[int] = None,
) -> Dict[str, Any]:
    from datetime import datetime
    now_sp = datetime.now(SAO_PAULO_TZ).date()
    
    ano = ano or now_sp.year
    mes = mes or now_sp.month
    
    today = now_sp
    tomorrow = today + timedelta(days=1)
    
    primeiro_dia_mes = date(ano, mes, 1)
    ultimo_dia_mes = date(ano, mes, monthrange(ano, mes)[1])

    # 1. Saldos Bancários (Fonte Única da Verdade unificada com Contas Bancárias)
    from app.services.conta_service import calcular_saldos_contas
    contas_alvo_ids = [conta_id] if conta_id is not None else None
    saldos_dict = calcular_saldos_contas(
        db=db,
        empresa_id=empresa_id,
        conta_ids=contas_alvo_ids,
        apenas_ativas=True,
        centro_custo_id=centro_custo_id,
    )

    saldo_disponivel = Decimal("0")
    saldo_total = Decimal("0")
    bancos_resumo = []

    for cid, info in saldos_dict.items():
        conta = info["conta"]
        saldo_inicial = info["saldo_inicial"]
        saldo_atual = info["saldo_atual"]
        status_conta = getattr(conta, "status", "ATIVO") or "ATIVO"

        if status_conta == "ATIVO":
            if conta.conta_como_disponibilidade:
                saldo_disponivel += saldo_atual
            saldo_total += saldo_atual

        bancos_resumo.append({
            "id": cid,
            "nome": conta.nome,
            "banco": conta.banco,
            "logo_url": conta.logo_url,
            "saldo": float(saldo_atual),
            "saldo_inicial": float(saldo_inicial),
            "saldo_atual": float(saldo_atual),
            "status": status_conta,
            "tipo": getattr(conta, "tipo", "CORRENTE") or "CORRENTE",
            "conta_como_disponibilidade": conta.conta_como_disponibilidade,
            "centro_custo_id": conta.centro_custo_id,
        })

    # Ordenar bancos por saldo decrescente
    bancos_resumo.sort(key=lambda x: x["saldo"], reverse=True)

    # 2. Query Agregada Única para Contas a Pagar e Contas a Receber
    where_clauses = [
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
    ]
    if centro_custo_id is not None:
        where_clauses.append(Lancamento.centro_custo_id == centro_custo_id)
    if conta_id is not None:
        where_clauses.append(Lancamento.conta_id == conta_id)

    # Condições de status
    is_unpaid = and_(Lancamento.status == "EM ABERTO", Lancamento.data_pagamento == None)
    is_paid = or_(Lancamento.status == "PAGO", Lancamento.data_pagamento != None)
    paid_val = func.coalesce(Lancamento.valor_pago, Lancamento.valor_previsto)
    unpaid_val = func.coalesce(Lancamento.valor_previsto, 0)

    agg_query = select(
        # --- DESPESAS (PAGAR) ---
        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", is_unpaid, Lancamento.data_vencimento == today), unpaid_val),
            else_=0
        )), 0).label("pagar_hoje"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", is_unpaid, Lancamento.data_vencimento == tomorrow), unpaid_val),
            else_=0
        )), 0).label("pagar_amanha"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", is_unpaid, Lancamento.data_vencimento < today), unpaid_val),
            else_=0
        )), 0).label("pagar_atrasadas"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", is_unpaid, Lancamento.data_vencimento >= primeiro_dia_mes, Lancamento.data_vencimento <= ultimo_dia_mes), unpaid_val),
            else_=0
        )), 0).label("pagar_em_aberto_mes"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", is_paid, Lancamento.data_pagamento >= primeiro_dia_mes, Lancamento.data_pagamento <= ultimo_dia_mes), paid_val),
            else_=0
        )), 0).label("pagar_pagas_mes"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "DESPESA", Lancamento.data_vencimento >= primeiro_dia_mes, Lancamento.data_vencimento <= ultimo_dia_mes), case((is_paid, paid_val), else_=unpaid_val)),
            else_=0
        )), 0).label("pagar_total_mes"),

        # --- RECEITAS (RECEBER) ---
        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", is_unpaid, Lancamento.data_vencimento == today), unpaid_val),
            else_=0
        )), 0).label("receber_hoje"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", is_unpaid, Lancamento.data_vencimento == tomorrow), unpaid_val),
            else_=0
        )), 0).label("receber_amanha"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", is_unpaid, Lancamento.data_vencimento < today), unpaid_val),
            else_=0
        )), 0).label("receber_atrasadas"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", is_unpaid, Lancamento.data_vencimento >= primeiro_dia_mes, Lancamento.data_vencimento <= ultimo_dia_mes), unpaid_val),
            else_=0
        )), 0).label("receber_em_aberto_mes"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", is_paid, Lancamento.data_pagamento >= primeiro_dia_mes, Lancamento.data_pagamento <= ultimo_dia_mes), paid_val),
            else_=0
        )), 0).label("receber_recebidas_mes"),

        func.coalesce(func.sum(case(
            (and_(Lancamento.tipo == "RECEITA", Lancamento.data_vencimento >= primeiro_dia_mes, Lancamento.data_vencimento <= ultimo_dia_mes), case((is_paid, paid_val), else_=unpaid_val)),
            else_=0
        )), 0).label("receber_total_mes"),
    ).where(*where_clauses)

    agg_result = db.exec(agg_query).first()

    p_hoje = Decimal(str(agg_result[0] or 0))
    p_amanha = Decimal(str(agg_result[1] or 0))
    p_atrasadas = Decimal(str(agg_result[2] or 0))
    p_em_aberto = Decimal(str(agg_result[3] or 0))
    p_pagas_mes = Decimal(str(agg_result[4] or 0))
    p_total_mes = Decimal(str(agg_result[5] or 0))

    r_hoje = Decimal(str(agg_result[6] or 0))
    r_amanha = Decimal(str(agg_result[7] or 0))
    r_atrasadas = Decimal(str(agg_result[8] or 0))
    r_em_aberto = Decimal(str(agg_result[9] or 0))
    r_recebidas_mes = Decimal(str(agg_result[10] or 0))
    r_total_mes = Decimal(str(agg_result[11] or 0))

    # 3. Resultados Financeiros (Regime de Caixa Oficial unificado com a DRE)
    from app.services.dre_service import get_dre_anual
    dre_caixa = get_dre_anual(
        db=db,
        empresa_id=empresa_id,
        ano=ano,
        centro_custo_id=centro_custo_id,
        somente_pagos=True,
    )
    mes_idx = max(0, min(11, mes - 1))
    rec_op = dre_caixa["totais"]["receita_operacional"][mes_idx]
    out_rec = dre_caixa["totais"]["outras_receitas"][mes_idx]
    ded = dre_caixa["totais"]["deducoes"][mes_idx]
    custos = dre_caixa["totais"]["custos"][mes_idx]
    desp_op = dre_caixa["totais"]["despesas_operacionais"][mes_idx]
    out_desp = dre_caixa["totais"]["outras_despesas"][mes_idx]

    receitas_realizadas_mes = rec_op + out_rec
    despesas_realizadas_mes = ded + custos + desp_op + out_desp

    resultado_operacional_mes = dre_caixa["totais"]["resultado_operacional"][mes_idx]
    resultado_final_mes = dre_caixa["totais"]["resultado_final"][mes_idx]
    resultado_operacional_monthly = dre_caixa["totais"]["resultado_operacional"]
    resultado_final_monthly = dre_caixa["totais"]["resultado_final"]

    return {
        "ano": ano,
        "mes": mes,
        "data_hoje": today.isoformat(),
        "hoje_iso": today.isoformat(),
        "data_amanha": tomorrow.isoformat(),
        "amanha_iso": tomorrow.isoformat(),
        "saldo_disponivel": float(saldo_disponivel),
        "saldo_total": float(saldo_total),
        "bancos": bancos_resumo,
        "pagar": {
            "hoje": float(p_hoje),
            "amanha": float(p_amanha),
            "atrasadas": float(p_atrasadas),
            "em_aberto": float(p_em_aberto),
            "pagas_no_mes": float(p_pagas_mes),
            "pagas_mes": float(p_pagas_mes),
            "total_mes": float(p_total_mes),
        },
        "receber": {
            "hoje": float(r_hoje),
            "amanha": float(r_amanha),
            "atrasadas": float(r_atrasadas),
            "em_aberto": float(r_em_aberto),
            "recebidas_no_mes": float(r_recebidas_mes),
            "recebidas_mes": float(r_recebidas_mes),
            "total_mes": float(r_total_mes),
        },
        "resultados": {
            "receitas_realizadas": float(receitas_realizadas_mes),
            "receitas_recebidas": float(receitas_realizadas_mes),
            "receitas_pendentes": float(r_em_aberto),
            "despesas_realizadas": float(despesas_realizadas_mes),
            "despesas_pagas": float(despesas_realizadas_mes),
            "despesas_pendentes": float(p_em_aberto),
            "resultado_operacional": float(resultado_operacional_mes),
            "resultado_operacional_mes": float(resultado_operacional_mes),
            "resultado_final": float(resultado_final_mes),
            "resultado_final_mes": float(resultado_final_mes),
            "resultado_operacional_monthly": resultado_operacional_monthly,
            "resultado_final_monthly": resultado_final_monthly,
        },
    }
