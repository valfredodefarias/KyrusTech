from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.centro_custo import CentroCusto
from datetime import date

def run():
    session = Session(engine)
    
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    ccs = session.exec(select(CentroCusto).where(CentroCusto.empresa_id == 35)).all()
    cc_by_id = {cc.id: cc for cc in ccs}
    
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
    
    print("=== SOMA DE LANÇAMENTOS POR CENTRO DE CUSTO ===")
    
    sums = {}
    for l in launches:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        cc = cc_by_id.get(l.centro_custo_id)
        cc_name = cc.nome if cc else "Sem CC"
        
        key = (cc_name, code)
        sums[key] = sums.get(key, 0.0) + float(l.valor_pago or l.valor_previsto)
        
    for (cc_name, code), val in sorted(sums.items()):
        print(f"  CC: {cc_name:<15} | Cat: {code:<10} | Sum: R$ {val:,.2f}")

if __name__ == "__main__":
    run()
