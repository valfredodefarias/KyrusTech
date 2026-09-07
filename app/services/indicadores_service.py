# app/services/indicadores_service.py
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional, Dict, Any, List
from zoneinfo import ZoneInfo

from sqlmodel import Session, select
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas

SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")


def _is_receita(tipo: Optional[str]) -> bool:
    t = (tipo or "").strip().lower()
    return t.startswith(("r", "receita", "recebimento", "entrada", "credito"))


def _is_despesa(tipo: Optional[str]) -> bool:
    t = (tipo or "").strip().lower()
    return t.startswith(("d", "despesa", "pagamento", "saida", "debito"))


def _is_pago(item: Lancamento) -> bool:
    s = (item.status or "").strip().lower()
    if s in ("pago", "quitado", "liquidado") or s.startswith("parcial"):
        return True
    if item.data_pagamento is not None:
        return True
    if item.valor_pago and item.valor_pago > 0:
        return True
    return False


def _get_status_key(item: Lancamento, today: date, tomorrow: date) -> str:
    if _is_pago(item):
        return "PAGO"
    due = item.data_vencimento
    if not due:
        return "EM_ABERTO"
    if due == today:
        return "HOJE"
    if due == tomorrow:
        return "AMANHA"
    if due < today:
        return "ATRASADO"
    return "EM_ABERTO"


def _get_status_label(status_key: str) -> str:
    labels = {
        "PAGO": "Pago",
        "EM_ABERTO": "Em aberto",
        "ATRASADO": "Atrasado",
        "HOJE": "Vence hoje",
        "AMANHA": "Vence amanhã",
    }
    return labels.get(status_key, status_key)


EXCLUDED_DRE_GROUPS = {
    "FORA_DRE",
    "FORA DRE",
    "FORA DA DRE",
    "NAO_OPERACIONAL",
    "NÃO_OPERACIONAL",
    "NAO OPERACIONAL",
    "NÃO OPERACIONAL",
    "NAO OPERACIONAL / FORA DA DRE",
    "NAO OP.",
    "NAO_DRE",
    "NÃO_DRE",
}


def get_indicadores_resumo(
    db: Session,
    empresa_id: int,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    centro_custo_id: Optional[int] = None,
) -> Dict[str, Any]:
    from datetime import datetime
    now_sp = datetime.now(SAO_PAULO_TZ).date()

    ano = ano or now_sp.year
    mes = mes or now_sp.month

    today = now_sp
    tomorrow = today + timedelta(days=1)

    ano_inicio = date(ano, 1, 1)
    ano_fim = date(ano, 12, 31)

    # 1. Contas bancárias
    contas = db.exec(
        select(Conta.id, Conta.nome, Conta.banco).where(
            Conta.empresa_id == empresa_id,
            Conta.is_deleted == False,
        )
    ).all()
    conta_map = {c[0]: c[1] or c[2] or f"Conta #{c[0]}" for c in contas if c[0] is not None}

    # 2. Entidades
    entidades = db.exec(
        select(Entidade.id, Entidade.nome, Entidade.nome_fantasia).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()
    entidade_map = {e[0]: (e[2] or e[1] or "").strip() for e in entidades if e[0] is not None}

    # 3. Plano de Contas (para filtrar fora DRE se aplicável)
    planos = db.exec(
        select(PlanoContas.id, PlanoContas.dre_grupo, PlanoContas.eh_operacional).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
        )
    ).all()
    fora_dre_ids = set()
    for pid, dre_grupo, eh_operacional in planos:
        if pid is not None:
            if eh_operacional is False:
                fora_dre_ids.add(pid)
            elif (dre_grupo or "").strip().upper() in EXCLUDED_DRE_GROUPS:
                fora_dre_ids.add(pid)

    # 4. Consulta de Lançamentos
    query = select(Lancamento).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.data_vencimento >= ano_inicio,
        Lancamento.data_vencimento <= ano_fim,
    )
    if centro_custo_id is not None:
        query = query.where(Lancamento.centro_custo_id == centro_custo_id)

    lancamentos = db.exec(query).all()

    # 5. Agregações
    monthly_recebimento = [0.0] * 12
    monthly_pagamento = [0.0] * 12

    days_in_month = monthrange(ano, mes)[1]
    daily_recebimento = [0.0] * days_in_month
    daily_pagamento = [0.0] * days_in_month

    situacao_mes = {"PAGO": 0.0, "EM_ABERTO": 0.0, "ATRASADO": 0.0, "HOJE": 0.0, "AMANHA": 0.0}
    situacao_ano = {"PAGO": 0.0, "EM_ABERTO": 0.0, "ATRASADO": 0.0, "HOJE": 0.0, "AMANHA": 0.0}

    rows: List[Dict[str, Any]] = []

    for item in lancamentos:
        plano_id = item.plano_contas_id
        if plano_id and plano_id in fora_dre_ids:
            continue

        due = item.data_vencimento
        if not due:
            continue

        m_idx = due.month - 1
        d_idx = due.day

        is_rec = _is_receita(item.tipo)
        flow_type = "RECEBIMENTO" if is_rec else "PAGAMENTO"
        status_key = _get_status_key(item, today, tomorrow)

        has_paid_val = item.valor_pago is not None and item.valor_pago > 0
        base_val = float(item.valor_pago if (status_key == "PAGO" and has_paid_val) else (item.valor_previsto or item.valor_pago or Decimal("0")))
        val_abs = abs(base_val)
        signed_val = val_abs if is_rec else -val_abs

        # Timeline mensal
        if 0 <= m_idx < 12:
            if is_rec:
                monthly_recebimento[m_idx] += val_abs
            else:
                monthly_pagamento[m_idx] += val_abs

        # Timeline diária do mês selecionado
        if due.month == mes:
            day_idx = d_idx - 1
            if 0 <= day_idx < days_in_month:
                if is_rec:
                    daily_recebimento[day_idx] += val_abs
                else:
                    daily_pagamento[day_idx] += val_abs

            if status_key in situacao_mes:
                situacao_mes[status_key] += val_abs

        if status_key in situacao_ano:
            situacao_ano[status_key] += val_abs

        # Interessado
        interessado = ""
        if item.entidade_id and item.entidade_id in entidade_map:
            interessado = entidade_map[item.entidade_id]
        if not interessado and item.descricao:
            # Fallback para extrair da descrição se for asaas
            interessado = item.descricao.split("-")[0].strip()

        rows.append({
            "id": item.id,
            "rowKey": f"lancamento-{item.id}",
            "descricao": item.descricao,
            "flowType": flow_type,
            "statusKey": status_key,
            "statusLabel": _get_status_label(status_key),
            "dataVencimento": due.isoformat(),
            "monthIndex": m_idx,
            "dayOfMonth": d_idx,
            "valor": signed_val,
            "valorAbsoluto": val_abs,
            "interessado": interessado,
            "contaId": item.conta_id,
            "contaNome": conta_map.get(item.conta_id, ""),
            "planoContasId": item.plano_contas_id,
            "centroCustoId": item.centro_custo_id,
            "origem": item.origem,
            "observacao": item.observacao,
        })

    # Ordenar rows por vencimento
    rows.sort(key=lambda r: (r["dataVencimento"] or "", -r["valorAbsoluto"]))

    return {
        "monthly_recebimento": [round(v, 2) for v in monthly_recebimento],
        "monthly_pagamento": [round(v, 2) for v in monthly_pagamento],
        "daily_recebimento": [round(v, 2) for v in daily_recebimento],
        "daily_pagamento": [round(v, 2) for v in daily_pagamento],
        "situacao_mes": {k: round(v, 2) for k, v in situacao_mes.items()},
        "situacao_ano": {k: round(v, 2) for k, v in situacao_ano.items()},
        "flow_totals": {
            "recebimento": round(sum(monthly_recebimento), 2),
            "pagamento": round(sum(monthly_pagamento), 2),
        },
        "rows": rows,
        "total_rows": len(rows),
    }
