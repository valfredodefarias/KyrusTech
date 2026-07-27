# scripts/set_all_target_balances_exact.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from decimal import Decimal

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("======================================================================")
        print("ALINHAMENTO DEFINITIVO E PRECISO DE SALDOS BANCÁRIOS (TODAS AS 4 LOJAS)")
        print("======================================================================")
        
        # Exact target balances from local target database (localhost:3000)
        target_balances = {
            # Pizza Fábio Umarizal (35)
            324: ("Caixa PDV Umarizal", Decimal("25695.88"), 35),
            325: ("Tesouraria Umarizal", Decimal("0.00"), 35),
            326: ("Itaú Umarizal", Decimal("-11848.21"), 35),
            327: ("Itaú Umarizal - Aplicação", Decimal("-118682.98"), 35),
            
            # Pizza Fábio Ananindeua (37)
            320: ("Itaú Ananindeua", Decimal("20783.83"), 37),
            321: ("Tesouraria Ananindeua", Decimal("2189.56"), 37),
            322: ("Itaú Ananindeua - Aplicação", Decimal("0.00"), 37),
            323: ("PDV Ananindeua", Decimal("1578.24"), 37),
            
            # Pizza Fábio Marco - Salão (39)
            328: ("PDV Salão", Decimal("8716.55"), 39),
            329: ("Tesouraria Marco", Decimal("1266.99"), 39),
            330: ("Itaú Marco", Decimal("43402.37"), 39),
            
            # Pizza Fábio Marco - Delivery (40)
            335: ("PDV Ifood", Decimal("-1732.82"), 40),
            336: ("Tesouraria Ifood Marco", Decimal("0.00"), 40),
            337: ("Itaú Ifood Marco", Decimal("-21894.52"), 40),
        }
        
        for cid, (cname, target_bal, emp_id) in target_balances.items():
            # Query movement net matching app/api/v1/endpoints/contas.py
            row = conn.execute(text("""
                SELECT 
                    COALESCE(SUM(CASE WHEN UPPER(tipo) LIKE 'R%' THEN valor_pago ELSE 0 END), 0) AS receitas,
                    COALESCE(SUM(CASE WHEN UPPER(tipo) LIKE 'D%' THEN valor_pago ELSE 0 END), 0) AS despesas
                FROM lancamentos
                WHERE empresa_id = :empresa_id
                  AND conta_id = :conta_id
                  AND is_deleted = false
                  AND (status = 'PAGO' OR data_pagamento IS NOT NULL)
                  AND (observacao IS NULL OR (
                      observacao NOT ILIKE '%DestinoCompra DEMONSTRACAO%' 
                      AND observacao NOT ILIKE '%"legacy_id_venda"%'
                  ))
            """), {"empresa_id": emp_id, "conta_id": cid}).first()
            
            calc_rev = Decimal(str(row[0] or 0)) if row else Decimal("0.00")
            calc_exp = Decimal(str(row[1] or 0)) if row else Decimal("0.00")
            mov_net = calc_rev - calc_exp
            
            # Read current saldo_inicial
            conta = conn.execute(text("SELECT saldo_inicial FROM contas WHERE id = :id"), {"id": cid}).first()
            if not conta:
                continue
                
            current_s_ini = Decimal(str(conta[0] or 0))
            current_calc_saldo = current_s_ini + mov_net
            
            diff = target_bal - current_calc_saldo
            if abs(diff) > Decimal("0.00"):
                new_s_ini = current_s_ini + diff
                conn.execute(text("""
                    UPDATE contas
                    SET saldo_inicial = :new_s_ini,
                        updated_at = NOW()
                    WHERE id = :id
                """), {"new_s_ini": new_s_ini, "id": cid})
                conn.commit()
                print(f"  - Conta ID {cid:4d} [{cname:25s}]: Saldo Exibido Ajustado R$ {current_calc_saldo:10.2f} -> R$ {target_bal:10.2f}")
            else:
                print(f"  - Conta ID {cid:4d} [{cname:25s}]: Saldo Atual R$ {target_bal:10.2f} (100% Ok)")

if __name__ == "__main__":
    main()
