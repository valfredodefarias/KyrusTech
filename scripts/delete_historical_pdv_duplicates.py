# scripts/delete_historical_pdv_duplicates.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
from decimal import Decimal

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        print("======================================================================")
        print("EXCLUSÃO CIRÚRGICA DE DUPLICATAS LEGADAS NO BANCO (IS_DELETED = TRUE)")
        print("======================================================================")
        
        # Soft-delete legacy migrated PDV launches for Jan-Jun 2026
        # where official WEB spreadsheet entries exist
        res = conn.execute(text("""
            UPDATE lancamentos
            SET is_deleted = true,
                deleted_at = NOW(),
                updated_at = NOW()
            WHERE empresa_id IN (35, 37, 39, 40)
              AND origem = 'PDV'
              AND is_deleted = false
              AND COALESCE(data_competencia, data_vencimento) < '2026-07-01'
              AND (
                  observacao ILIKE '%"origem": "PDV"%'
                  OR observacao ILIKE '%"rv":%'
                  OR observacao ILIKE '%"legacy_id_venda"%'
                  OR observacao ILIKE '%"is_movimentacao_pdv": true%'
              )
        """))
        conn.commit()
        
        print(f"✅ Total de {res.rowcount} lançamentos duplicados legados desativados no banco de dados!")

if __name__ == "__main__":
    main()
