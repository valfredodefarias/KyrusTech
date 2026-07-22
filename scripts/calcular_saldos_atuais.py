from sqlmodel import Session, select
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from decimal import Decimal

ORIGINAL_BALANCES = {
    326: Decimal("-11848.21"),    # Itaú Umarizal
    325: Decimal("0.00"),         # Tesouraria Umarizal
    324: Decimal("621226.13")     # Caixa PDV Umarizal
}

def get_current_balance(session, conta_id, initial_balance):
    # Saldo = inicial + total de receitas pagas - total de despesas pagas
    # Receitas
    receitas_query = select(Lancamento).where(
        Lancamento.conta_id == conta_id,
        Lancamento.tipo == "RECEITA",
        Lancamento.is_deleted == False,
        Lancamento.status == "PAGO"
    )
    receitas = sum(Decimal(str(l.valor_pago or l.valor_previsto or 0)) for l in session.exec(receitas_query).all())
    
    # Despesas
    despesas_query = select(Lancamento).where(
        Lancamento.conta_id == conta_id,
        Lancamento.tipo == "DESPESA",
        Lancamento.is_deleted == False,
        Lancamento.status == "PAGO"
    )
    despesas = sum(Decimal(str(l.valor_pago or l.valor_previsto or 0)) for l in session.exec(despesas_query).all())
    
    return initial_balance + receitas - despesas

def run():
    session = Session(engine)
    
    print("=== CALCULO DE SALDOS ATUAIS (UMARIZAL) ===")
    for cid, original_val in ORIGINAL_BALANCES.items():
        conta = session.get(Conta, cid)
        if not conta:
            continue
            
        current_initial = Decimal(str(conta.saldo_inicial or 0))
        
        # Calcular saldo atual com o saldo inicial atual (inflado)
        current_actual_balance = get_current_balance(session, cid, current_initial)
        
        # Calcular saldo atual com o saldo inicial restaurado (correto)
        restored_actual_balance = get_current_balance(session, cid, original_val)
        
        print(f"\nConta: '{conta.nome}' (ID: {cid})")
        print(f"  - Saldo Inicial Atual (inflado): R$ {current_initial:,.2f}")
        print(f"  - Saldo Atual na Tela HOJE:       R$ {current_actual_balance:,.2f}")
        print(f"  - Novo Saldo Inicial (desejado): R$ {original_val:,.2f}")
        print(f"  - Novo Saldo Atual na Tela:      R$ {restored_actual_balance:,.2f}")

if __name__ == "__main__":
    run()
