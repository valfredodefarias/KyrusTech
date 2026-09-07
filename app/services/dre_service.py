from datetime import date
from decimal import Decimal
from typing import Optional, Dict, Any, List
from zoneinfo import ZoneInfo

from sqlmodel import Session, select
from sqlalchemy import func, case, and_, or_, extract

from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas

SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")

EXCLUDED_DRE_GROUPS = {
    "FORA_DRE", "FORA DRE", "FORA DA DRE",
    "NAO_OPERACIONAL", "NAO OPERACIONAL",
    "NÃO_OPERACIONAL", "NÃO OPERACIONAL",
    "NAO OP.", "NAO_DRE", "NÃO_DRE",
}


def get_dre_anual(
    db: Session,
    empresa_id: int,
    ano: Optional[int] = None,
    centro_custo_id: Optional[int] = None,
    somente_pagos: bool = True,
) -> Dict[str, Any]:
    from datetime import datetime
    now_sp = datetime.now(SAO_PAULO_TZ).date()
    ano = ano or now_sp.year

    start_date = date(ano, 1, 1)
    end_date = date(ano, 12, 31)

    # 1. Carregar Plano de Contas da Empresa
    categorias = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
        )
    ).all()

    categorias_por_id: Dict[int, PlanoContas] = {int(c.id): c for c in categorias if c.id is not None}

    # 2. Construir Query de Agregação por plano_contas_id e mês
    if somente_pagos:
        date_col = func.coalesce(Lancamento.data_pagamento, Lancamento.data_competencia, Lancamento.data_vencimento)
        val_expr = case(
            (Lancamento.valor_pago != None, Lancamento.valor_pago),
            else_=func.coalesce(Lancamento.valor_previsto, 0)
        )
    else:
        date_col = func.coalesce(Lancamento.data_competencia, Lancamento.data_vencimento)
        val_expr = case(
            (and_(or_(Lancamento.status == "PAGO", Lancamento.data_pagamento != None), Lancamento.valor_pago != None, Lancamento.valor_pago > 0), Lancamento.valor_pago),
            else_=func.coalesce(Lancamento.valor_previsto, Lancamento.valor_pago, 0)
        )

    month_expr = extract("month", date_col)

    query = select(
        Lancamento.plano_contas_id,
        month_expr.label("mes"),
        func.sum(val_expr).label("total")
    ).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.plano_contas_id != None,
        date_col >= start_date,
        date_col <= end_date,
    )

    if somente_pagos:
        query = query.where(
            or_(Lancamento.status == "PAGO", Lancamento.data_pagamento != None, Lancamento.valor_pago > 0),
            Lancamento.conta_id != None,
            Lancamento.conta_id > 0,
        )

    if centro_custo_id is not None:
        query = query.where(Lancamento.centro_custo_id == centro_custo_id)

    query = query.group_by(Lancamento.plano_contas_id, month_expr)

    results = db.exec(query).all()

    # 3. Mapear resultados em valores_categorias: Dict[int, List[float]] (12 meses por conta)
    valores_categorias: Dict[int, List[float]] = {}
    for pid, mes_num, total in results:
        if pid is None or mes_num is None:
            continue
        p_id = int(pid)
        m_idx = int(mes_num) - 1
        if 0 <= m_idx < 12:
            if p_id not in valores_categorias:
                valores_categorias[p_id] = [0.0] * 12
            valores_categorias[p_id][m_idx] = float(total or 0)

    # 4. Totais mensais dos grupos DRE
    receita_operacional_monthly = [0.0] * 12
    deducoes_monthly = [0.0] * 12
    custos_monthly = [0.0] * 12
    despesas_operacionais_monthly = [0.0] * 12
    outras_receitas_monthly = [0.0] * 12
    outras_despesas_monthly = [0.0] * 12

    for pid, monthly_vals in valores_categorias.items():
        conta = categorias_por_id.get(pid)
        if not conta:
            continue
        grupo = str(conta.dre_grupo or "").strip().upper()
        if grupo in EXCLUDED_DRE_GROUPS:
            continue
        if getattr(conta, 'eh_operacional', True) is False:
            continue
        if getattr(conta, 'considerar_nos_resultados', True) is False:
            continue

        tipo = str(conta.tipo or "").upper()
        is_rec = tipo.startswith("R")
        is_desp = tipo.startswith("D")

        for i in range(12):
            v = monthly_vals[i]
            if is_rec:
                if grupo == "OUTRAS_RECEITAS":
                    outras_receitas_monthly[i] += v
                elif grupo != "NAO_OPERACIONAL":
                    receita_operacional_monthly[i] += v
            elif is_desp:
                if grupo in ("DEDUCOES_RECEITA", "DEDUCOES DE RECEITA", "DEDUCOES"):
                    deducoes_monthly[i] += v
                elif grupo in ("CUSTOS_VARIAVEIS", "CUSTO_VARIAVEL", "CUSTOS"):
                    custos_monthly[i] += v
                elif grupo in ("OUTRAS_DESPESAS", "OUTRA_DESPESA"):
                    outras_despesas_monthly[i] += v
                elif grupo != "NAO_OPERACIONAL":
                    despesas_operacionais_monthly[i] += v

    receita_liquida_monthly = [
        receita_operacional_monthly[i] - deducoes_monthly[i] for i in range(12)
    ]
    margem_contribuicao_monthly = [
        receita_liquida_monthly[i] - custos_monthly[i] for i in range(12)
    ]
    resultado_operacional_monthly = [
        margem_contribuicao_monthly[i] - despesas_operacionais_monthly[i] for i in range(12)
    ]
    resultado_final_monthly = [
        resultado_operacional_monthly[i] + outras_receitas_monthly[i] - outras_despesas_monthly[i] for i in range(12)
    ]

    return {
        "ano": ano,
        "somente_pagos": somente_pagos,
        "valores_categorias": valores_categorias,
        "totais": {
            "receita_operacional": receita_operacional_monthly,
            "deducoes": deducoes_monthly,
            "receita_liquida": receita_liquida_monthly,
            "custos": custos_monthly,
            "margem_contribuicao": margem_contribuicao_monthly,
            "despesas_operacionais": despesas_operacionais_monthly,
            "resultado_operacional": resultado_operacional_monthly,
            "outras_receitas": outras_receitas_monthly,
            "outras_despesas": outras_despesas_monthly,
            "resultado_final": resultado_final_monthly,
        }
    }
