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
    
    # Buscar todos os lançamentos ativos (is_deleted == False) em Jan/2026
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.is_deleted == False,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    print("=== SOMA DE TODOS OS LANÇAMENTOS ATIVOS NO BANCO (JANEIRO/2026 - CAIXA) ===")
    
    sums = {}
    for l in launches:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums[code] = sums.get(code, 0.0) + float(l.valor_pago or l.valor_previsto)
        
    for code, val in sorted(sums.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")

if __name__ == "__main__":
    run()
