from sqlmodel import Session, select
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional

db = Session(engine)

try:
    conta = db.get(Conta, 228)
    if conta:
        def get_balance(ref_date: date):
            filtros = [
                Lancamento.conta_id == 228,
                Lancamento.is_deleted == False,
                (Lancamento.status == "PAGO") | (Lancamento.data_pagamento.is_not(None))
            ]
            
            lancs = db.exec(select(Lancamento).where(*filtros)).all()
            
            receitas = []
            despesas = []
            for l in lancs:
                dt = l.data_pagamento or l.data_vencimento
                if dt and dt > ref_date:
                    continue
                if l.tipo.upper().startswith("R"):
                    receitas.append(l)
                elif l.tipo.upper().startswith("D"):
                    despesas.append(l)
            
            sum_rec = sum(r.valor_pago for r in receitas)
            sum_desp = sum(d.valor_pago for d in despesas)
            
            return conta.saldo_inicial + sum_rec - sum_desp

        # Find which dates correspond to system balance close to 6174.09
        print("Checking daily system balance values:")
        start_date = date(2026, 5, 25)
        for i in range(50):
            d = start_date + timedelta(days=i)
            bal = get_balance(d)
            if abs(bal - Decimal("6174.09")) < Decimal("1000.00") or d.day == 1 or d.day == 15:
                print(f"- Date: {d} | Balance: {bal}")
finally:
    db.close()
