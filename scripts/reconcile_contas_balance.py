# scripts/reconcile_contas_balance.py
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
        print("RECONCILIAÇÃO FINAL DE SALDOS BANCÁRIOS (CONTAS.PY ALIGNMENT)")
        print("======================================================================")
        
        # Target balances mapping per company and account name/ID
        targets = {
            # Pizza Fábio Marco - Salão (39)
            328: ("PDV Salão", Decimal("8716.55"), 39),
            329: ("Tesouraria Marco", Decimal("1266.99"), 39),
            330: ("Itaú Marco", Decimal("43402.37"), 39),
            
            # Pizza Fábio Ananindeua (37)
            320: ("Itaú Ananindeua", Decimal("20783.83"), 37),
            321: ("Tesouraria Ananindeua", Decimal("2189.56"), 37),
            322: ("Itaú Ananindeua - Aplicação", Decimal("0.00"), 37),
            323: ("PDV Ananindeua", Decimal("1578.24"), 37),
        }
        
        for cid, (cname, target_bal, emp_id) in targets.items():
            # Query exact sum of revenues and expenses as done in app/api/v1/endpoints/contas.py
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
            
            print(f"\nConta [{cname}] (ID {cid}):")
            print(f"  Saldo Atual Exibido no API:  R$ {current_calc_saldo:12.2f}")
            print(f"  Saldo Alvo Desejado (Target): R$ {target_bal:12.2f}")
            
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
                print(f"  ✅ Saldo inicial ajustado! Novo Saldo Atual Exibido no API: R$ {target_bal:.2f}")
            else:
                print("  ✅ Saldo já está 100% perfeito!")

if __name__ == "__main__":
    main()
