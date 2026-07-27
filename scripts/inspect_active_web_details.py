# scripts/inspect_active_web_details.py
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
        print("DETALHAMENTO DE LANÇAMENTOS EM JAN/2026 POR CATEGORIA E ORIGEM")
        print("======================================================================")
        
        rows = conn.execute(text("""
            SELECT pc.codigo, pc.nome, l.origem, SUM(COALESCE(NULLIF(l.valor_pago, 0), l.valor_previsto))
            FROM lancamentos l
            JOIN plano_contas pc ON pc.id = l.plano_contas_id
            WHERE l.empresa_id = :empresa_id
              AND l.is_deleted = false
              AND pc.tipo = 'R'
              AND COALESCE(l.data_competencia, l.data_vencimento) >= '2026-01-01'
              AND COALESCE(l.data_competencia, l.data_vencimento) <= '2026-01-31'
            GROUP BY pc.codigo, pc.nome, l.origem
            ORDER BY pc.codigo, l.origem
        """), {"empresa_id": empresa_id}).all()
        
        for cod, nome, orig, val in rows:
            print(f"[{cod}] {nome:30s} | Origem: {orig:10s} | Total: R$ {Decimal(str(val or 0)):12.2f}")

if __name__ == "__main__":
    main()
