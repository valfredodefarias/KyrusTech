# scripts/inspect_prod_db.py
import sys
from pathlib import Path
from sqlalchemy import create_engine, inspect, text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    engine = create_engine(settings.DATABASE_URL)
    
    print("--- ALEMBIC VERSION ---")
    try:
        with engine.connect() as conn:
            res = conn.execute(text("SELECT version_num FROM alembic_version"))
            versions = res.all()
            print("Current versions in alembic_version table:", [v[0] for v in versions])
    except Exception as e:
        print("Error reading alembic_version:", e)

    inspector = inspect(engine)
    
    tables = ["pdv_movimentacoes", "lote_cartao_itens", "pdv_ifood_lancamentos"]
    for table in tables:
        print(f"\n--- COLUMNS FOR {table} ---")
        try:
            columns = inspector.get_columns(table)
            for col in columns:
                print(f"  {col['name']}: {col['type']}")
        except Exception as e:
            print(f"Error reading table {table}: {e}")

if __name__ == "__main__":
    main()
