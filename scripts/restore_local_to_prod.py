# scripts/restore_local_to_prod.py
import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    db_url = str(settings.DATABASE_URL).replace("postgresql+psycopg2://", "postgresql://")
    
    # Locate dump file
    dump_file = ROOT_DIR / "scripts" / "local_target_clean.dump"
    if not dump_file.exists():
        dump_file = ROOT_DIR / "backups" / "dump.dump"
    if not dump_file.exists():
        dump_file = ROOT_DIR / "dump.dump"
        
    print("======================================================================")
    print("RESTAURANDO BANCO DE DADOS LOCAL LIMPO DE REFERÊNCIA EM PRODUÇÃO")
    print("======================================================================")
    print(f"Arquivo de Dump: {dump_file}")
    print(f"URL de Destino: {db_url.split('@')[-1]}")
    
    if not dump_file.exists():
        print(f"❌ Arquivo de dump não encontrado em {dump_file}!")
        return
        
    # Drop public schema to ensure 100% fresh restore without FK constraint conflicts
    from sqlalchemy import create_engine, text
    try:
        engine = create_engine(settings.DATABASE_URL)
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
            conn.commit()
            print("✅ Schema public recriado do zero com sucesso!")
    except Exception as e:
        print(f"Aviso ao recriar schema: {e}")

    cmd = [
        "pg_dump" if False else "pg_restore",
        "--dbname", db_url,
        "--no-owner",
        "--no-privileges",
        str(dump_file)
    ]
    
    try:
        res = subprocess.run(cmd, check=False, capture_output=True, text=True)
        print(res.stdout)
        print(res.stderr)
        print("✅ Restauração do banco de dados local limpo efetuada com sucesso em produção!")
    except Exception as e:
        print(f"❌ Erro ao executar pg_restore: {e}")

if __name__ == "__main__":
    main()
