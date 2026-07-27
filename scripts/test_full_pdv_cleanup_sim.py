# scripts/test_full_pdv_cleanup_sim.py
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
        
        print("======================================================================")
        print("SIMULAÇÃO DRE PIZZA FÁBIO UMARIZAL (APÓS LIMPEZA DE ESPELHOS PDV - CARTÃO E PIX)")
        print("======================================================================")
        
        # Categories mapping
        pcs = conn.execute(text("SELECT id, codigo, nome FROM plano_contas WHERE empresa_id = 35 AND is_deleted = false")).all()
        pc_map = {p[0]: p for p in pcs}
        
        for m in range(1, 8):
            start_date = f"2026-{m:02d}-01"
            end_date = f"2026-{m:02d}-31" if m in [1, 3, 5, 7] else (f"2026-{m:02d}-30" if m != 2 else "2026-02-28")
            
            # Query active revenue launches EXCLUDING non-cash PDV launches for <= 2026-07-31
            rows = conn.execute(text("""
                SELECT 
                    pc.codigo, pc.nome, l.origem,
                    SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto)) as val
                FROM lancamentos l
                JOIN plano_contas pc ON pc.id = l.plano_contas_id
                WHERE l.empresa_id = :empresa_id
                  AND l.is_deleted = false
                  AND pc.tipo = 'R'
                  AND COALESCE(l.data_competencia, l.data_vencimento) >= :start_date
                  AND COALESCE(l.data_competencia, l.data_vencimento) <= :end_date
                  AND NOT (
                      l.origem = 'PDV' 
                      AND pc.codigo NOT IN ('01.01', '01.01.01') 
                      AND LOWER(pc.nome) NOT LIKE '%dinheiro%'
                  )
                GROUP BY pc.codigo, pc.nome, l.origem
                ORDER BY pc.codigo
            """), {"empresa_id": empresa_id, "start_date": start_date, "end_date": end_date}).all()
            
            cat_totals = {}
            total_mes = Decimal("0.00")
            for cod, nome, orig, val in rows:
                v = Decimal(str(val or 0))
                cat_totals[cod] = cat_totals.get(cod, Decimal("0.00")) + v
                total_mes += v
                
            print(f"\n--- MÊS 2026-{m:02d} (TOTAL RECEITAS: R$ {total_mes:,.2f}) ---")
            print(f"  01.01.01 Dinheiro     : R$ {cat_totals.get('01.01.01', Decimal('0.00')):,.2f}")
            print(f"  01.01.02 Cartão crédito: R$ {cat_totals.get('01.01.02', Decimal('0.00')):,.2f}")
            print(f"  01.01.03 Cartão débito : R$ {cat_totals.get('01.01.03', Decimal('0.00')):,.2f}")
            print(f"  01.01.04 Pix/depósito : R$ {cat_totals.get('01.01.04', Decimal('0.00')):,.2f}")
            print(f"  01.01.05 Pix QRS      : R$ {cat_totals.get('01.01.05', Decimal('0.00')):,.2f}")

if __name__ == "__main__":
    main()
