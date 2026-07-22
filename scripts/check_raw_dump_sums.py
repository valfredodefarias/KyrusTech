from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def run():
    session = Session(engine)
    
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    # 1. Buscar todos os lançamentos ativos (is_deleted == False)
    launches_active = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.is_deleted == False,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    # 2. Buscar todos os lançamentos deletados (is_deleted == True)
    launches_deleted = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.is_deleted == True,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    print("=== ACTIVE LAUNCHES ===")
    sums_active = {}
    for l in launches_active:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums_active[code] = sums_active.get(code, 0.0) + float(l.valor_pago or 0)
    for code, val in sorted(sums_active.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")
        
    print("\n=== DELETED LAUNCHES ===")
    sums_deleted = {}
    for l in launches_deleted:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums_deleted[code] = sums_deleted.get(code, 0.0) + float(l.valor_pago or 0)
    for code, val in sorted(sums_deleted.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")
        
    print("\n=== TOTAL (ACTIVE + DELETED) ===")
    all_codes = set(sums_active.keys()).union(sums_deleted.keys())
    for code in sorted(all_codes):
        active_val = sums_active.get(code, 0.0)
        deleted_val = sums_deleted.get(code, 0.0)
        total_val = active_val + deleted_val
        print(f"  Cat: {code:<10} | Active: R$ {active_val:,.2f} | Deleted: R$ {deleted_val:,.2f} | Total: R$ {total_val:,.2f}")

if __name__ == "__main__":
    run()
