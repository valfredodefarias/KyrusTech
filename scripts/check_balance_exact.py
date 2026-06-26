from sqlmodel import Session, select, func, or_, case
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional

db = Session(engine)

def _calcular_saldo_atual_conta(
    db: Session,
    empresa_id: int,
    conta_id: int,
    data_referencia: Optional[date] = None,
) -> Decimal:
    tipo_receita = func.upper(Lancamento.tipo).like("R%")
    tipo_despesa = func.upper(Lancamento.tipo).like("D%")
    movimento_pago = or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))

    conta = db.exec(
        select(Conta).where(
            Conta.empresa_id == empresa_id,
            Conta.id == conta_id,
        )
    ).first()
    if not conta:
        return Decimal("0.00")

    filtros_saldo = [
        Lancamento.empresa_id == empresa_id,
        Lancamento.conta_id == conta_id,
        Lancamento.is_deleted == False,
        movimento_pago,
    ]
    if data_referencia is not None:
        filtros_saldo.append(
            func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento) <= data_referencia
        )

    soma = db.exec(
        select(
            func.sum(case((tipo_receita, Lancamento.valor_pago), else_=0)).label("receitas"),
            func.sum(case((tipo_despesa, Lancamento.valor_pago), else_=0)).label("despesas"),
        )
        .where(*filtros_saldo)
    ).first()

    receitas = Decimal(str((soma[0] if soma else 0) or 0))
    despesas = Decimal(str((soma[1] if soma else 0) or 0))
    saldo_inicial = Decimal(str(conta.saldo_inicial or 0))
    return saldo_inicial + receitas - despesas

try:
    start_date = date(2026, 6, 1)
    for i in range(30):
        d = start_date + timedelta(days=i)
        bal = _calcular_saldo_atual_conta(db, 28, 228, d)
        print(f"Date: {d} -> Balance: {bal}")

finally:
    db.close()
