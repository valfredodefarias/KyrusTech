# scripts/audit_and_fix_all_balances.py
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
        print("AUDITORIA GERAL DE CONTAS BANCÁRIAS E CAIXAS (TODAS AS LOJAS)")
        print("======================================================================")
        
        contas = conn.execute(text("""
            SELECT c.id, e.nome_fantasia, c.nome, c.tipo, c.saldo_inicial
            FROM contas c
            JOIN empresas e ON e.id = c.empresa_id
            WHERE c.empresa_id IN (35, 37, 39, 40)
              AND c.is_deleted = false
            ORDER BY c.empresa_id, c.id
        """)).all()
        
        for c in contas:
            cid = c[0]
            emp_nome = c[1]
            c_nome = c[2]
            tipo = c[3]
            s_ini = Decimal(str(c[4] or 0))
            
            # Revenues paid
            rev = conn.execute(text("""
                SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
                FROM lancamentos
                WHERE conta_id = :conta_id
                  AND is_deleted = false
                  AND tipo = 'R'
                  AND status IN ('PAGO', 'PARCIAL')
            """), {"conta_id": cid}).scalar() or 0
            
            # Expenses paid
            exp = conn.execute(text("""
                SELECT SUM(COALESCE(NULLIF(valor_pago, 0), valor_previsto))
                FROM lancamentos
                WHERE conta_id = :conta_id
                  AND is_deleted = false
                  AND tipo = 'D'
                  AND status IN ('PAGO', 'PARCIAL')
            """), {"conta_id": cid}).scalar() or 0
            
            calc_bal = s_ini + Decimal(str(rev)) - Decimal(str(exp))
            print(f"Empresa [{emp_nome:28s}] | Conta '{c_nome:20s}' (ID {cid:4d}): Saldo Calculado = R$ {calc_bal:12.2f}")

if __name__ == "__main__":
    main()
