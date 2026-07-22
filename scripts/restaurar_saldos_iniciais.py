from sqlmodel import Session, select
from app.db.session import engine
from app.models.conta import Conta
from decimal import Decimal

ORIGINAL_BALANCES = {
    326: Decimal("-11848.21"),    # Itaú Umarizal
    325: Decimal("0.00"),         # Tesouraria Umarizal
    324: Decimal("621226.13"),    # Caixa PDV Umarizal
    331: Decimal("107051.33"),    # Itaú Ananindeua
    334: Decimal("0.00"),         # Tesouraria Ananindeua
    330: Decimal("-4551763.75"),  # Itaú Marco
    329: Decimal("-128.26"),      # Tesouraria Marco
    328: Decimal("-285479.44"),   # PDV Marco Salão
    337: Decimal("-246218.96")    # Itaú Ifood Marco (Delivery)
}

def run(dry_run=True):
    session = Session(engine)
    
    print("=== RESTAURAÇÃO DE SALDOS INICIAIS ORIGINAIS ===")
    if dry_run:
        print("--- MODO SIMULAÇÃO (Sem alterações no banco de dados) ---")
    else:
        print("--- EXECUTANDO EM PRODUÇÃO ---")
        
    for cid, original_val in ORIGINAL_BALANCES.items():
        conta = session.get(Conta, cid)
        if not conta:
            print(f"Conta ID {cid} não encontrada no banco de dados!")
            continue
            
        current_val = Decimal(str(conta.saldo_inicial or 0))
        diff = current_val - original_val
        
        print(f"  Conta '{conta.nome}' (ID: {cid}):")
        print(f"    - Saldo Inicial Atual:  R$ {current_val:,.2f}")
        print(f"    - Saldo Inicial Desejado: R$ {original_val:,.2f}")
        print(f"    - Diferença (excesso):  R$ {diff:,.2f}")
        
        if not dry_run:
            conta.saldo_inicial = original_val
            session.add(conta)
            
    if not dry_run:
        session.commit()
        print("\n✅ Saldos iniciais restaurados e salvos com sucesso!")
    else:
        print("\nSimulação concluída. Rode com 'run' para aplicar as mudanças.")

if __name__ == "__main__":
    import sys
    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        dry_run = False
    run(dry_run)
