# scripts/run_production_import.py
import os
import sys
import subprocess

os.environ["DISABLE_AUDIT"] = "1"

# Add root dir to sys path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import Session, engine
from scripts.import_pizza_fabio import import_all_data

def run_backup():
    print("=== Disparando Backup Automático (pg_dump) ===")
    os.makedirs("backups", exist_ok=True)
    # Execute pg_dump within the backend network pointing to the 'db' host
    cmd = [
        "pg_dump",
        "-h", "db_kyrustech",
        "-U", "kyrus_user",
        "-d", "kyrus_erp",
        "-F", "c",
        "-b",
        "-v",
        "-f", "/app/backups/backup_pre_importacao_fabio.dump"
    ]
    # Set PGPASSWORD environment variable
    env = os.environ.copy()
    env["PGPASSWORD"] = "kyrus_pass"
    
    try:
        result = subprocess.run(cmd, env=env, check=True, capture_output=True, text=True)
        print("Backup concluído com sucesso!")
        print(f"Dump salvo em: backups/backup_pre_importacao_fabio.dump")
    except subprocess.CalledProcessError as e:
        print(f"ERRO ao gerar backup: {e.stderr}")
        raise e

def main():
    # 1. Run database backup snapshot
    run_backup()

    # 2. Run import
    print("\n=== Iniciando Importação de Produção ===")
    db = Session(engine)
    try:
        import_all_data(
            db=db,
            path_umarizal="scripts/Base_PizzaFabioUmarizal.xlsx",
            path_ananindeua="scripts/Base_PizzaFabioAnanindeua.xlsx",
            path_ifood_marco="scripts/Base_IFood_PizzaFabioMarco.xlsx",
            dry_run=False
        )
        print("\nImportação concluída com sucesso no banco oficial!")
    except Exception as e:
        print(f"\nERRO CRÍTICO durante importação: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    main()
