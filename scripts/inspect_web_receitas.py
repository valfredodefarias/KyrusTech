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
        
        print("======================================================================")
        print("INSPEÇÃO DE RECEITAS ORIGEM='WEB' EM JAN/2026 (UMARIZAL)")
        print("======================================================================")
        
        rows = conn.execute(text("""
            SELECT l.id, pc.codigo, pc.nome, l.valor_previsto, l.valor_pago, l.data_competencia, l.data_vencimento, l.observacao, l.import_hash
            FROM lancamentos l
            JOIN plano_contas pc ON pc.id = l.plano_contas_id
            WHERE l.empresa_id = :empresa_id
              AND l.is_deleted = false
              AND l.origem = 'WEB'
              AND pc.codigo IN ('01.01.04', '01.01.05')
              AND COALESCE(l.data_competencia, l.data_vencimento) >= '2026-01-01'
              AND COALESCE(l.data_competencia, l.data_vencimento) <= '2026-01-31'
            ORDER BY pc.codigo, l.id
        """), {"empresa_id": empresa_id}).all()
        
        for r in rows:
            val = r[4] if r[4] else r[3]
            print(f"ID: {r[0]} | PC: {r[1]} - {r[2]:20s} | Valor: {val:10.2f} | Obs: {r[7]} | Hash: {r[8]}")

if __name__ == "__main__":
    main()
