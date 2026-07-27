# scripts/simulate_dre_after_alignment.py
import sys
import openpyxl
from pathlib import Path
from datetime import datetime, date
from decimal import Decimal
from sqlmodel import Session, select
from sqlalchemy import create_engine, text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("==========================================================================================")
        print("SIMULAÇÃO DRE PÓS-ALINHAMENTO (JANEIRO A JUNHO/2026) & AUDITORIA DE SALDOS BANCÁRIOS")
        print("==========================================================================================")
        
        empresas = [
            (35, "Pizza Fábio Umarizal"),
            (37, "Pizza Fábio Ananindeua"),
            (39, "Pizza Fábio Marco - Salão"),
            (40, "Pizza Fábio Marco - Delivery"),
        ]
        
        # 1. Audit Bank Balances
        print("\n--- 1. SALDOS DAS CONTAS BANCÁRIAS E CAIXAS DAS EMPRESAS ---")
        contas = conn.execute(text("""
            SELECT c.id, e.nome_fantasia, c.nome, c.saldo_inicial
            FROM contas c
            JOIN empresas e ON e.id = c.empresa_id
            WHERE c.empresa_id IN (35, 37, 39, 40)
              AND c.is_deleted = false
            ORDER BY c.empresa_id, c.id
        """)).all()
        
        for c in contas:
            print(f"  Empresa [{c[1]}] | Conta '{c[2]}' (ID {c[0]}): Saldo Inicial = R$ {c[3]:10.2f}")
            
        # 2. Simulate DRE totals for Jan to Jun 2026
        print("\n--- 2. MATRIZ DRE DE RECEITAS SIMULADA (JAN A JUN/2026) ---")
        categories = ["01.01.01", "01.01.02", "01.01.03", "01.01.04", "01.01.05", "01.01.06"]
        cat_names = {
            "01.01.01": "Dinheiro",
            "01.01.02": "Cartão crédito",
            "01.01.03": "Cartão débito",
            "01.01.04": "Pix/depósito",
            "01.05": "Pix QRS",
            "01.01.05": "Pix QRS",
            "01.01.06": "Outras receitas"
        }
        
        for emp_id, emp_nome in empresas:
            print(f"\n==========================================================================================")
            print(f"   EMPRESA: [{emp_id}] {emp_nome}")
            print(f"==========================================================================================")
            
            for m in range(1, 7):
                start_date = f"2026-{m:02d}-01"
                end_date = f"2026-{m:02d}-31" if m in [1, 3, 5] else (f"2026-{m:02d}-30" if m != 2 else "2026-02-28")
                
                # Query clean WEB launches (plus cash PDV)
                rows = conn.execute(text("""
                    SELECT pc.codigo, SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto))
                    FROM lancamentos l
                    JOIN plano_contas pc ON pc.id = l.plano_contas_id
                    WHERE l.empresa_id = :empresa_id
                      AND l.is_deleted = false
                      AND pc.tipo = 'R'
                      AND (l.origem = 'WEB' OR (l.origem = 'PDV' AND pc.codigo = '01.01.01'))
                      AND COALESCE(l.data_competencia, l.data_vencimento) >= :start_date
                      AND COALESCE(l.data_competencia, l.data_vencimento) <= :end_date
                    GROUP BY pc.codigo
                """), {"empresa_id": emp_id, "start_date": start_date, "end_date": end_date}).all()
                
                tot_by_cat = {c[0]: Decimal(str(c[1] or 0)) for c in rows}
                
                tot_mes = sum(tot_by_cat.values(), Decimal("0.00"))
                print(f"\n  MÊS 2026-{m:02d} | RECEITA TOTAL SIMULADA: R$ {tot_mes:12.2f}")
                for cat in categories:
                    val = tot_by_cat.get(cat, Decimal("0.00"))
                    name = cat_names.get(cat, cat)
                    print(f"    - [{cat}] {name:25s}: R$ {val:10.2f}")

if __name__ == "__main__":
    main()
