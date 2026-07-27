# scripts/verify_dre_match.py
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
        empresa_id = 35 # Pizza Fábio Umarizal
        
        print("==========================================================================================")
        print("MATRIZ DRE DE JANEIRO A JULHO/2026 - PIZZA FÁBIO UMARIZAL (APÓS CONSOLIDAÇÃO)")
        print("==========================================================================================")
        
        months = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL"]
        categories = ["01.01.01", "01.01.02", "01.01.03", "01.01.04", "01.01.05", "01.01.06"]
        cat_names = {
            "01.01.01": "Dinheiro",
            "01.01.02": "Cartão crédito",
            "01.01.03": "Cartão débito",
            "01.01.04": "Pix/depósito",
            "01.01.05": "Pix QRS",
            "01.01.06": "Outras receitas"
        }
        
        matrix = {c: [Decimal("0.00")] * 7 for c in categories}
        tot_mes = [Decimal("0.00")] * 7
        
        for idx, m in enumerate(range(1, 8)):
            start_date = f"2026-{m:02d}-01"
            end_date = f"2026-{m:02d}-31" if m in [1, 3, 5, 7] else (f"2026-{m:02d}-30" if m != 2 else "2026-02-28")
            
            rows = conn.execute(text("""
                SELECT pc.codigo, SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto))
                FROM lancamentos l
                JOIN plano_contas pc ON pc.id = l.plano_contas_id
                WHERE l.empresa_id = :empresa_id
                  AND l.is_deleted = false
                  AND pc.tipo = 'R'
                  AND COALESCE(l.data_competencia, l.data_vencimento) >= :start_date
                  AND COALESCE(l.data_competencia, l.data_vencimento) <= :end_date
                GROUP BY pc.codigo
            """), {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date}).all()
            
            for cod, val in rows:
                if cod in matrix:
                    v = Decimal(str(val or 0))
                    matrix[cod][idx] = v
                    tot_mes[idx] += v
                    
        # Header
        hdr = f"{'CATEGORIA':25s} | " + " | ".join(f"{months[i]:>10s}" for i in range(7))
        print(hdr)
        print("-" * len(hdr))
        
        for c in categories:
            row_str = f"[{c}] {cat_names[c]:17s} | " + " | ".join(f"R$ {matrix[c][i]:>8.0f}" for i in range(7))
            print(row_str)
            
        print("-" * len(hdr))
        tot_str = f"{'TOTAL RECEITAS OPERACIONAIS':25s} | " + " | ".join(f"R$ {tot_mes[i]:>8.0f}" for i in range(7))
        print(tot_str)

if __name__ == "__main__":
    main()
