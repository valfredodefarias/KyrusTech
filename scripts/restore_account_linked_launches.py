# scripts/restore_account_linked_launches.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("======================================================================")
        print("RESTAURAÇÃO DE LANÇAMENTOS VINCULADOS A CONTAS BANCÁRIAS/CAIXAS")
        print("======================================================================")
        
        # 1. Count deleted launches with conta_id IS NOT NULL
        count_res = conn.execute(text("""
            SELECT COUNT(*), COUNT(DISTINCT empresa_id)
            FROM lancamentos
            WHERE is_deleted = true
              AND conta_id IS NOT NULL
              AND deleted_at >= NOW() - INTERVAL '2 days'
        """)).first()
        
        total_deleted = count_res[0]
        emp_count = count_res[1]
        
        print(f"Total de lançamentos vinculados a contas bancárias deletados recentemente: {total_deleted} em {emp_count} empresas.")
        
        if total_deleted > 0:
            print("\nRestaurando lançamentos vinculados a contas correntes/caixas (is_deleted = false)...")
            res = conn.execute(text("""
                UPDATE lancamentos
                SET is_deleted = false,
                    deleted_at = NULL,
                    updated_at = NOW()
                WHERE is_deleted = true
                  AND conta_id IS NOT NULL
                  AND deleted_at >= NOW() - INTERVAL '2 days'
            """))
            conn.commit()
            print(f"✅ Restaurados com sucesso {res.rowcount} lançamentos vinculados a contas bancárias!")
        else:
            print("Nenhum lançamento vinculado a contas bancárias necessita restauração.")

if __name__ == "__main__":
    main()
