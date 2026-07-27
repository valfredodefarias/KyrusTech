# scripts/reconcile_prod_data_fix.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from datetime import datetime, date
from decimal import Decimal

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("======================================================================")
        print("AJUSTE E RECONCILIAÇÃO CIRÚRGICA DE BANCO DE DADOS (PRODUÇÃO)")
        print("======================================================================")
        
        # Target initial balances from target local DB
        target_initial_balances = {
            # Pizza Fábio Umarizal (35)
            324: Decimal("25695.88"),   # Caixa PDV Umarizal
            325: Decimal("0.00"),       # Tesouraria Umarizal
            326: Decimal("-11848.21"),  # Itaú Umarizal
            327: Decimal("-118682.98"), # Itaú Umarizal Aplicação
            
            # Pizza Fábio Ananindeua (37)
            320: Decimal("107051.33"),  # Itaú Ananindeua
            321: Decimal("0.00"),       # Tesouraria Ananindeua
            322: Decimal("-53621.29"),  # Itaú Ananindeua - Aplicação
            323: Decimal("-269381.58"), # PDV Ananindeua
            
            # Pizza Fábio Marco - Salão (39)
            328: Decimal("-586427.32"), # PDV Salão
            329: Decimal("46.50"),      # Tesouraria Marco
            330: Decimal("-62105.22"),  # Itaú Marco
            
            # Pizza Fábio Marco - Delivery (40)
            335: Decimal("-1732.82"),   # PDV Ifood
            336: Decimal("0.00"),       # Tesouraria Ifood Marco
            337: Decimal("-21894.52"),  # Itaú Ifood Marco
        }
        
        print("\n1. AJUSTANDO SALDO INICIAL DAS CONTAS PARA OS VALORES DE REFERÊNCIA...")
        for cid, target_s_ini in target_initial_balances.items():
            res = conn.execute(text("""
                UPDATE contas
                SET saldo_inicial = :saldo_inicial,
                    updated_at = NOW()
                WHERE id = :id
            """), {"saldo_inicial": target_s_ini, "id": cid})
            print(f"  - Conta ID {cid:4d}: saldo_inicial ajustado para R$ {target_s_ini:12.2f}")
            
        conn.commit()
        print("\n✅ Saldos iniciais das contas reconciliados com sucesso!")

if __name__ == "__main__":
    main()
