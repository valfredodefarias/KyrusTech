# scripts/fix_pago_receivables.py
import sys, os
from sqlalchemy import text
from sqlmodel import Session

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DISABLE_AUDIT", "1")

from app.db.session import engine

def run():
    print("=== INICIANDO AJUSTE DE LANÇAMENTOS PAGO COM VALOR_PAGO/DATA_PAGAMENTO ZERADOS ===")
    with Session(engine) as session:
        # Update lancamentos
        sql = """
            UPDATE lancamentos 
            SET valor_pago = valor_previsto, 
                data_pagamento = COALESCE(data_pagamento, data_vencimento)
            WHERE origem = 'PDV' 
              AND tipo = 'RECEITA' 
              AND status = 'PAGO' 
              AND (data_pagamento IS NULL OR valor_pago = 0);
        """
        result = session.execute(text(sql))
        session.commit()
        print(f"[OK] Atualizados {result.rowcount} lançamentos do PDV com sucesso!")

if __name__ == "__main__":
    run()
