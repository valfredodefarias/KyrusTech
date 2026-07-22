from sqlmodel import Session, select, or_, not_
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
    # exact Kyrus query filters:
    query = select(Lancamento).where(
        Lancamento.conta_id == conta_id,
        Lancamento.is_deleted == False,
        # _movimento_influencia_saldo_clause()
        or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
        # observation filters
        or_(
            Lancamento.observacao.is_(None),
            (not_(Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%")) & not_(Lancamento.observacao.ilike('%"legacy_id_venda"%')))
        )
    )
    
    launches = session.exec(query).all()
    
    total_entradas = Decimal("0.00")
    total_saidas = Decimal("0.00")
    
    for m in launches:
        val = Decimal(str(m.valor_pago if m.valor_pago is not None else 0))
        tipo = (m.tipo or "").strip().upper()
        if tipo.startswith("R"):
            total_entradas += val
        elif tipo.startswith("D"):
            total_saidas += val
            
    return initial_balance + total_entradas - total_saidas

def run():
    session = Session(engine)
    
    print("=== CALCULO DE SALDOS ATUAIS COM FILTROS EXATOS DO KYRUS (UMARIZAL) ===")
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
