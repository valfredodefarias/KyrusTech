from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from datetime import date

db = Session(engine)

try:
    lancs = db.exec(
        select(Lancamento)
        .where(
            Lancamento.conta_id == 228,
            Lancamento.is_deleted == False,
            (Lancamento.status == "PAGO") | (Lancamento.data_pagamento.is_not(None))
        )
        .order_by(Lancamento.data_pagamento)
    ).all()
    
    print("Launches paid in June 2026:")
    for l in lancs:
        dt = l.data_pagamento or l.data_vencimento
        if dt and date(2026, 6, 1) <= dt <= date(2026, 6, 15):
            print(f"- ID #{l.id} | {l.descricao} | Tipo: {l.tipo} | Valor Pago: {l.valor_pago} | Pag: {l.data_pagamento}")
finally:
    db.close()
