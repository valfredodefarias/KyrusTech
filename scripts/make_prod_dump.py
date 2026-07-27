# scripts/make_prod_dump.py
import sys
import os
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def main():
    db_url = settings.DATABASE_URL
    output_path = "/root/KyrusERP/prod_backup_today.dump"
    
    print("======================================================================")
    print("GERANDO DUMP COMPLETO DO BANCO DE DADOS EM PRODUÇÃO (.DUMP)")
    print("======================================================================")
    print(f"URL de Conexão: {db_url.split('@')[-1]}")
    
    # Run pg_dump using connection string
    cmd = [
        "pg_dump",
        "--dbname", db_url,
        "-F", "c",
        "-f", output_path
    ]
    
    try:
        res = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✅ Dump gerado com sucesso em: {output_path}")
    except subprocess.CalledProcessError as e:
        print(f"Erro ao executar pg_dump: {e.stderr}")
        # Try local folder if /root is not writable inside container
        fallback_path = str(ROOT_DIR / "prod_backup_today.dump")
        cmd[-1] = fallback_path
        res = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✅ Dump gerado com sucesso em: {fallback_path}")

if __name__ == "__main__":
    main()
