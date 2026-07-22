from sqlmodel import Session, select, or_
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def parse_month_index(date_str):
    if not date_str:
        return -1
    try:
        month = int(date_str[5:7])
        if 1 <= month <= 12:
            return month - 1
    except:
        pass
    return -1

def resolve_competencia_date(l, somente_pagos=False):
    if somente_pagos:
        return l.data_pagamento.strftime("%Y-%m-%d") if l.data_pagamento else None
    return l.data_competencia.strftime("%Y-%m-%d") if l.data_competencia else None

def resolve_month_index(l, somente_pagos=False):
    if not somente_pagos:
        if l.competencia:
            try:
                month = int(l.competencia.split("-")[0])
                return month - 1
            except:
                pass
        comp_date = resolve_competencia_date(l, False)
        return parse_month_index(comp_date)
    return parse_month_index(resolve_competencia_date(l, True))

def resolve_lancamento_value(l, somente_pagos=False):
    valor_pago = float(l.valor_pago or 0)
    if somente_pagos:
        return valor_pago
    if l.data_pagamento or valor_pago != 0:
        return valor_pago if valor_pago != 0 else float(l.valor_previsto or 0)
    return float(l.valor_previsto or 0)

def run():
    session = Session(engine)
    
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    # Simular consulta backend para o ano de 2026
    data_inicio = date(2026, 1, 1)
    data_fim = date(2026, 12, 31)
    
    query = select(Lancamento).where(
        Lancamento.empresa_id == 35,
        Lancamento.tipo == "RECEITA",
        Lancamento.is_deleted == False
    )
    
    query = query.where(
        or_(
            (Lancamento.data_vencimento >= data_inicio) & (Lancamento.data_vencimento <= data_fim),
            (Lancamento.data_pagamento.is_not(None))
            & (Lancamento.data_pagamento >= data_inicio)
            & (Lancamento.data_pagamento <= data_fim),
        )
    )
    
    launches = session.exec(query).all()
    print(f"Total retornados pelo backend para 2026: {len(launches)}")
    
    somente_pagos = True
    
    # Filtrar lançamentos como no frontend
    filtered_launches = []
    for l in launches:
        status = (l.status or "").upper()
        has_pagamento = l.data_pagamento is not None
        has_valor_pago = l.valor_pago is not None and float(l.valor_pago) != 0
        
        if somente_pagos:
            if status == "PAGO" or status.startswith("PARCIAL") or has_pagamento or has_valor_pago:
                filtered_launches.append(l)
        else:
            filtered_launches.append(l)
            
    print(f"Total filtrado no Regime de Caixa: {len(filtered_launches)}")
    
    # Agrupar por categoria e mês de Janeiro (index 0)
    sums = {}
    for l in filtered_launches:
        m_idx = resolve_month_index(l, somente_pagos)
        if m_idx == 0:  # Janeiro
            cat = cat_by_id.get(l.plano_contas_id)
            code = cat.codigo if cat else "Desconhecido"
            val = resolve_lancamento_value(l, somente_pagos)
            sums[code] = sums.get(code, 0.0) + val
            
    print("\n=== SIMULAÇÃO DA DRE DO FRONTEND - JANEIRO/2026 (REGIME DE CAIXA) ===")
    total = 0.0
    for code, val in sorted(sums.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")
        total += val
    print(f"Total Geral: R$ {total:,.2f}")

if __name__ == "__main__":
    run()
