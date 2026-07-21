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
    
    # Buscar lançamentos ativos na categoria 01.01.04 e 01.01.05 em Jan/2026
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.plano_contas_id.in_([6205, 6206]), # IDs de 01.01.04 e 01.01.05 em Umarizal
            Lancamento.is_deleted == False,
            Lancamento.data_pagamento >= start,
            Lancamento.data_pagamento <= end
        )
    ).all()
    
    print(f"=== ACTIVE LAUNCHES IN CATEGORIES 01.01.04 & 01.01.05 (JAN/2026) ===")
    print(f"Total: {len(launches)}")
    
    for l in sorted(launches, key=lambda x: x.data_pagamento):
        cat = cat_by_id.get(l.plano_contas_id)
        code = cat.codigo if cat else "Desconhecido"
        print(f"  ID: {l.id} | Origem: {l.origem} | Cat: {code} | Valor: R$ {l.valor_pago or l.valor_previsto:.2f} | Data Pagto: {l.data_pagamento} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()
