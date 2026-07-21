from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def run():
    session = Session(engine)
    
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    # Obter categorias de receita
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    # 1. Regime de Caixa: data_pagamento em Janeiro/2026
    launches_caixa = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV",
            Lancamento.is_deleted == False,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    sums_caixa = {}
    for l in launches_caixa:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums_caixa[code] = sums_caixa.get(code, 0.0) + float(l.valor_pago or l.valor_previsto)
        
    print("=== SUM OF PDV LAUNCHES IN JAN/2026 (REGIME DE CAIXA: data_pagamento) ===")
    for code, val in sorted(sums_caixa.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")
        
    # 2. Regime de Competência: data_competencia em Janeiro/2026
    launches_comp = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV",
            Lancamento.is_deleted == False,
            Lancamento.data_competencia >= start,
            Lancamento.data_competencia <= end
        )
    ).all()
    
    sums_comp = {}
    for l in launches_comp:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums_comp[code] = sums_comp.get(code, 0.0) + float(l.valor_pago or l.valor_previsto)
        
    print("\n=== SUM OF PDV LAUNCHES IN JAN/2026 (REGIME DE COMPETÊNCIA: data_competencia) ===")
    for code, val in sorted(sums_comp.items()):
        print(f"  Cat: {code:<10} | Sum: R$ {val:,.2f}")

if __name__ == "__main__":
    run()
