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
    
    print(f"=== CHECK PIX LAUNCHES ===")
    print(f"Total: {len(launches)}")
    
    for l in launches:
        obs = (l.observacao or "").lower()
        is_legacy = "importação financeiro" in obs or "importacao financeiro" in obs
        print(f"  ID: {l.id:<7} | Cat: {l.plano_contas_id} | Origem: {l.origem:<5} | Valor: {l.valor_pago or 0:.2f} | isLegacy: {is_legacy} | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()
