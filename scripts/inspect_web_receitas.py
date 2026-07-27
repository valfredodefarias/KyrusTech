# scripts/inspect_web_receitas.py
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
        empresa_id = 35 # Umarizal
        
        print("==========================================================================================")
        print("DETALHAMENTO MENSAL DE RECEITAS ORIGEM='WEB' vs 'PDV' (JANEIRO A JULHO/2026) - UMARIZAL")
        print("==========================================================================================")
        
        months = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL"]
        categories = ["01.01.01", "01.01.02", "01.01.03", "01.01.04", "01.01.05", "01.01.06"]
        
        for m_idx, m in enumerate(range(1, 8)):
            start_date = f"2026-{m:02d}-01"
            end_date = f"2026-{m:02d}-31" if m in [1, 3, 5, 7] else (f"2026-{m:02d}-30" if m != 2 else "2026-02-28")
            
            rows = conn.execute(text("""
                SELECT pc.codigo, l.origem, SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto))
                FROM lancamentos l
                JOIN plano_contas pc ON pc.id = l.plano_contas_id
                WHERE l.empresa_id = :empresa_id
                  AND l.is_deleted = false
                  AND pc.tipo = 'R'
                  AND COALESCE(l.data_competencia, l.data_vencimento) >= :start_date
                  AND COALESCE(l.data_competencia, l.data_vencimento) <= :end_date
                GROUP BY pc.codigo, l.origem
                ORDER BY pc.codigo, l.origem
            """), {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date}).all()
            
            totals = {}
            for cod, orig, val in rows:
                if cod not in totals:
                    totals[cod] = {}
                totals[cod][orig] = Decimal(str(val or 0))
                
            print(f"\n--- MÊS {months[m_idx]}/2026 ---")
            tot_mes = Decimal("0.00")
            for c in categories:
                web_val = totals.get(c, {}).get("WEB", Decimal("0.00"))
                pdv_val = totals.get(c, {}).get("PDV", Decimal("0.00"))
                tot_cat = web_val + pdv_val
                tot_mes += tot_cat
                print(f"  [{c}] WEB: R$ {web_val:>10.2f} | PDV: R$ {pdv_val:>10.2f} | TOTAL: R$ {tot_cat:>10.2f}")
            print(f"  TOTAL MÊS: R$ {tot_mes:>10.2f}")

if __name__ == "__main__":
    main()

