from sqlmodel import Session, select, or_, not_
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from decimal import Decimal

# Contas e seus saldos originais correspondentes
ORIGINAL_BALANCES = {
    # UMARIZAL (ID: 35)
    326: Decimal("-11848.21"),    # Itaú Umarizal
    325: Decimal("0.00"),         # Tesouraria Umarizal
    324: Decimal("621226.13"),    # Caixa PDV Umarizal
    
    # ANANINDEUA (ID: 37)
    331: Decimal("107051.33"),    # Itaú Ananindeua
    334: Decimal("0.00"),         # Tesouraria Ananindeua
    
    # MARCO SALÃO (ID: 39)
    330: Decimal("-4551763.75"),  # Itaú Marco
    329: Decimal("-128.26"),      # Tesouraria Marco
    328: Decimal("-285479.44"),   # PDV Marco Salão
    
    # MARCO DELIVERY (ID: 40)
    337: Decimal("-246218.96")    # Itaú Ifood Marco (Delivery)
}

def get_corrected_balance(session, conta_id, initial_balance):
    # Selecionar lançamentos ativos
    query = select(Lancamento).where(
        Lancamento.conta_id == conta_id,
        Lancamento.is_deleted == False,
        or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
        or_(
            Lancamento.observacao.is_(None),
            (not_(Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%")) & not_(Lancamento.observacao.ilike('%"legacy_id_venda"%')))
        )
    )
    
    launches = session.exec(query).all()
    
    total_entradas = Decimal("0.00")
    total_saidas = Decimal("0.00")
    
    for m in launches:
        obs = m.observacao or ""
        
        # Se o lançamento foi restaurado por engano (era legado mas não foi deletado pela limpeza em massa)
        # nós devemos desconsiderar (tratar como se continuasse deletado)
        is_legacy = "importação financeiro" in obs.lower() or "importacao financeiro" in obs.lower()
        is_clean_up = "DUPLICADO DELETADO EM LIMPEZA EM MASSA" in obs
        
        # Se era legado e não foi deletado pela limpeza em massa (ou seja, já estava deletado antes), ignoramos ele!
        if is_legacy and not is_clean_up:
            continue
            
        val = Decimal(str(m.valor_pago if m.valor_pago is not None else 0))
        tipo = (m.tipo or "").strip().upper()
        if tipo.startswith("R"):
            total_entradas += val
        elif tipo.startswith("D"):
            total_saidas += val
            
    return initial_balance + total_entradas - total_saidas

def run():
    session = Session(engine)
    
    print("=== CALCULO DE SALDOS COM ANULAÇÃO DE RESTAURAÇÃO INDESEJADA ===")
    
    unidades = {
        35: "Pizza Fábio Umarizal",
        37: "Pizza Fábio Ananindeua",
        39: "Pizza Fábio Marco - Salão",
        40: "Pizza Fábio Marco - Delivery"
    }
    
    for emp_id, emp_name in unidades.items():
        print(f"\n==========================================")
        print(f"Unidade: {emp_name} (ID: {emp_id})")
        print(f"==========================================")
        
        contas_empresa = session.exec(
            select(Conta).where(Conta.empresa_id == emp_id).order_by(Conta.id)
        ).all()
        
        for conta in contas_empresa:
            original_val = ORIGINAL_BALANCES.get(conta.id, Decimal(str(conta.saldo_inicial or 0)))
            restored_actual_balance = get_corrected_balance(session, conta.id, original_val)
            
            print(f"  Conta '{conta.nome}' (ID: {conta.id}):")
            print(f"    - Saldo na Tela CORRIGIDO: R$ {restored_actual_balance:,.2f}")

if __name__ == "__main__":
    run()
