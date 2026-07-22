from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from datetime import date

def run():
    session = Session(engine)
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.plano_contas_id.in_([6205, 6206]),
            Lancamento.is_deleted == False,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    sums_sangria = {}
    sums_other = {}
    
    for l in launches:
        obs = l.observacao or ""
        cat_id = l.plano_contas_id
        val = float(l.valor_pago or 0)
        
        if "Sangria" in obs:
            sums_sangria[cat_id] = sums_sangria.get(cat_id, 0.0) + val
        else:
            sums_other[cat_id] = sums_other.get(cat_id, 0.0) + val
            
    print("=== SOMA DE SANGRIAS ===")
    for cid, val in sums_sangria.items():
        print(f"  Cat ID: {cid} | Sum: R$ {val:,.2f}")
        
    print("\n=== SOMA DE OUTROS (SEM SANGRIA) ===")
    for cid, val in sums_other.items():
        print(f"  Cat ID: {cid} | Sum: R$ {val:,.2f}")

if __name__ == "__main__":
    run()
