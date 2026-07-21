from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from datetime import date

def run():
    session = Session(engine)
    
    # Umarizal (35) - Jan/2026
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    categorias = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == 35)).all()
    cat_by_id = {c.id: c for c in categorias}
    
    # Buscar todos os lançamentos de origem WEB (tanto ativos quanto deletados)
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.origem == "WEB",
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento >= start,
            Lancamento.data_vencimento <= end
        )
    ).all()
    
    print("=== SOMA DE LANÇAMENTOS WEB EM JANEIRO/2026 ===")
    
    sums_by_code = {}
    for l in launches:
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        sums_by_code.setdefault(code, {"ativo": 0, "deletado": 0, "total": 0})
        
        val = l.valor_pago if (l.data_pagamento is not None or (l.valor_pago and l.valor_pago != 0)) else l.valor_previsto
        if l.is_deleted:
            sums_by_code[code]["deletado"] += val
        else:
            sums_by_code[code]["ativo"] += val
        sums_by_code[code]["total"] += val
        
    for code, s in sorted(sums_by_code.items()):
        print(f"  Cat: {code:<10} | Ativo: R$ {s['ativo']:<10.2f} | Deletado: R$ {s['deletado']:<10.2f} | Total (Sem Limpeza): R$ {s['total']:<10.2f}")

if __name__ == "__main__":
    run()
