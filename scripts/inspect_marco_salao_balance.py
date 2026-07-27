# scripts/inspect_marco_salao_balance.py
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
        empresa_id = 39 # Marco - Salão
        
        print("======================================================================")
        print("INSPEÇÃO DE CONTAS E SALDOS - PIZZA FÁBIO MARCO SALÃO (ID 39)")
        print("======================================================================")
        
        # 1. Accounts list
        contas = conn.execute(text("""
            SELECT id, nome, tipo, saldo_inicial
            FROM contas
            WHERE empresa_id = :empresa_id AND is_deleted = false
            ORDER BY id
        """), {"empresa_id": empresa_id}).all()
        
        print("\n--- CONTAS DE EMPRESA 39 ---")
        for c in contas:
            print(f"ID: {c[0]:4d} | Nome: {c[1]:30s} | Tipo: {c[2]:10s} | Saldo Inicial: R$ {c[3]:12.2f}")
            
            # Recalculate balance for this account
            # Sum of revenues (R) - expenses (D) paid
            rev = conn.execute(text("""
                SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
                FROM lancamentos
                WHERE conta_id = :conta_id
                  AND is_deleted = false
                  AND tipo = 'R'
                  AND status IN ('PAGO', 'PARCIAL')
            """), {"conta_id": c[0]}).scalar() or 0
            
            exp = conn.execute(text("""
                SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
                FROM lancamentos
                WHERE conta_id = :conta_id
                  AND is_deleted = false
                  AND tipo = 'D'
                  AND status IN ('PAGO', 'PARCIAL')
            """), {"conta_id": c[0]}).scalar() or 0
            
            calculated_balance = Decimal(str(c[3] or 0)) + Decimal(str(rev)) - Decimal(str(exp))
            print(f"       -> Total Entradas (R): R$ {Decimal(str(rev)):12.2f}")
            print(f"       -> Total Saídas   (D): R$ {Decimal(str(exp)):12.2f}")
            print(f"       -> Saldo Recalculado Atual: R$ {calculated_balance:12.2f}")

        # Check soft-deleted card launches that had a conta_id assigned!
        deleted_with_account = conn.execute(text("""
            SELECT l.id, l.conta_id, pc.codigo, l.tipo, l.valor_pago, l.valor_previsto, l.deleted_at
            FROM lancamentos l
            JOIN plano_contas pc ON pc.id = l.plano_contas_id
            WHERE l.empresa_id = :empresa_id
              AND l.is_deleted = true
              AND l.conta_id IS NOT NULL
              AND l.deleted_at >= NOW() - INTERVAL '1 day'
            ORDER BY l.id DESC
            LIMIT 20
        """), {"empresa_id": empresa_id}).all()
        
        print(f"\n--- LANÇAMENTOS DELETADOS RECENTEMENTE COM CONTA_ID ASSOCIADA: {len(deleted_with_account)} ---")
        for d in deleted_with_account:
            val = d[4] if d[4] else d[5]
            print(f"ID: {d[0]} | Conta ID: {d[1]} | PC: {d[2]} | Tipo: {d[3]} | Valor: R$ {val:10.2f} | Deleted: {d[6]}")

if __name__ == "__main__":
    main()
