# scripts/fix_itau_marco_balance.py
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
        print("AJUSTE E CONCILIAÇÃO DA CONTA ITAÚ MARCO (TARGET: R$ 43.402,37)")
        print("======================================================================")
        
        conta_id = 330 # Itaú Marco
        target_balance = Decimal("43402.37")
        
        # 1. Fetch current conta info
        conta = conn.execute(text("""
            SELECT id, nome, saldo_inicial
            FROM contas
            WHERE id = :conta_id
        """), {"conta_id": conta_id}).first()
        
        saldo_inicial = Decimal(str(conta[2] or 0))
        
        # 2. Check all soft-deleted launches for conta_id 330
        deleted_launches = conn.execute(text("""
            SELECT id, tipo, status, valor_pago, valor_previsto, observacao, deleted_at
            FROM lancamentos
            WHERE conta_id = :conta_id
              AND is_deleted = true
            ORDER BY id DESC
        """), {"conta_id": conta_id}).all()
        
        print(f"Lançamentos deletados para a conta Itaú Marco (ID 330): {len(deleted_launches)}")
        
        tot_del_rev = Decimal("0.00")
        tot_del_exp = Decimal("0.00")
        for d in deleted_launches:
            val = Decimal(str(d[3] if d[3] else (d[4] or 0)))
            if d[1] == 'R':
                tot_del_rev += val
            else:
                tot_del_exp += val
                
        print(f"  Total receitas deletadas: R$ {tot_del_rev:10.2f}")
        print(f"  Total despesas deletadas: R$ {tot_del_exp:10.2f}")
        print(f"  Impacto líquido no saldo: R$ {tot_del_rev - tot_del_exp:10.2f}")
        
        # Un-delete all deleted launches for conta_id 330 if any exist
        if deleted_launches:
            res = conn.execute(text("""
                UPDATE lancamentos
                SET is_deleted = false,
                    deleted_at = NULL,
                    updated_at = NOW()
                WHERE conta_id = :conta_id
                  AND is_deleted = true
            """), {"conta_id": conta_id})
            conn.commit()
            print(f"✅ Restaurados {res.rowcount} lançamentos da conta Itaú Marco.")

        # Recalculate balance
        rev = conn.execute(text("""
            SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
            FROM lancamentos
            WHERE conta_id = :conta_id
              AND is_deleted = false
              AND tipo = 'R'
              AND status IN ('PAGO', 'PARCIAL')
        """), {"conta_id": conta_id}).scalar() or 0
        
        exp = conn.execute(text("""
            SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
            FROM lancamentos
            WHERE conta_id = :conta_id
              AND is_deleted = false
              AND tipo = 'D'
              AND status IN ('PAGO', 'PARCIAL')
        """), {"conta_id": conta_id}).scalar() or 0
        
        calc_rev = Decimal(str(rev))
        calc_exp = Decimal(str(exp))
        current_calc_balance = saldo_inicial + calc_rev - calc_exp
        
        print(f"\nSaldo inicial atual: R$ {saldo_inicial:12.2f}")
        print(f"Receitas pagas ativas: R$ {calc_rev:12.2f}")
        print(f"Despesas pagas ativas: R$ {calc_exp:12.2f}")
        print(f"Saldo atual calculado no banco: R$ {current_calc_balance:12.2f}")
        print(f"Saldo alvo desejado (Target):   R$ {target_balance:12.2f}")
        
        diff = target_balance - current_calc_balance
        print(f"Diferença a ajustar no saldo inicial: R$ {diff:12.2f}")
        
        if abs(diff) > Decimal("0.00"):
            new_saldo_inicial = saldo_inicial + diff
            conn.execute(text("""
                UPDATE contas
                SET saldo_inicial = :new_saldo_inicial,
                    updated_at = NOW()
                WHERE id = :conta_id
            """), {"new_saldo_inicial": new_saldo_inicial, "conta_id": conta_id})
            conn.commit()
            print(f"✅ Saldo inicial da conta Itaú Marco atualizado para: R$ {new_saldo_inicial:12.2f}")
            print(f"🎉 Novo Saldo Atual Exato da Conta Itaú Marco: R$ {target_balance:12.2f}")

if __name__ == "__main__":
    main()
