"""
Script para corrigir problemas com o banco de dados PostgreSQL.
Recria o container e volume se necessário.
"""
import subprocess
import sys
import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def run_command(cmd, description):
    """Executa um comando e mostra o resultado."""
    print(f"\n[INFO] {description}...")
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=True,
            capture_output=True,
            text=True
        )
        if result.stdout:
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"[ERRO] {e.stderr}")
        return False


def fix_database():
    """Corrige o banco de dados recriando o container."""
    print("=" * 60)
    print("CORRECAO DO BANCO DE DADOS POSTGRESQL")
    print("=" * 60)
    
    # 1. Parar e remover container existente
    print("\n[1/5] Parando e removendo container existente...")
    run_command("docker stop kyrus_db_dev", "Parando container")
    run_command("docker rm kyrus_db_dev", "Removendo container")
    
    # 2. Fazer backup do volume (opcional, mas seguro)
    backup_dir = ROOT_DIR / "postgres_data_backup"
    if (ROOT_DIR / "postgres_data").exists():
        print("\n[2/5] Fazendo backup do volume atual...")
        import shutil
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        shutil.copytree(ROOT_DIR / "postgres_data", backup_dir)
        print(f"[OK] Backup criado em: {backup_dir}")
    
    # 3. Remover volume corrompido
    print("\n[3/5] Removendo volume corrompido...")
    import shutil
    postgres_data = ROOT_DIR / "postgres_data"
    if postgres_data.exists():
        shutil.rmtree(postgres_data)
        print("[OK] Volume removido")
    
    # 4. Recriar container com volume limpo
    print("\n[4/5] Recriando container com volume limpo...")
    os.chdir(ROOT_DIR)
    if run_command("docker-compose up -d db", "Iniciando PostgreSQL"):
        print("\n[OK] Container criado com sucesso!")
        
        # 5. Aguardar PostgreSQL estar pronto
        print("\n[5/5] Aguardando PostgreSQL estar pronto...")
        import time
        for i in range(30):  # Aguarda até 30 segundos
            result = subprocess.run(
                "docker exec kyrus_db_dev pg_isready -U kyrus_user",
                shell=True,
                capture_output=True
            )
            if result.returncode == 0:
                print("[OK] PostgreSQL esta pronto!")
                return True
            time.sleep(1)
            print(".", end="", flush=True)
        
        print("\n[AVISO] PostgreSQL pode nao estar totalmente pronto ainda.")
        print("        Aguarde alguns segundos e tente novamente.")
        return False
    else:
        print("\n[ERRO] Falha ao criar container")
        return False


if __name__ == "__main__":
    success = fix_database()
    if success:
        print("\n" + "=" * 60)
        print("[SUCESSO] BANCO DE DADOS CORRIGIDO COM SUCESSO!")
        print("=" * 60)
        print("\nAgora voce pode executar:")
        print("  alembic revision --autogenerate -m 'Cria tabelas iniciais'")
        print("  alembic upgrade head")
    else:
        print("\n" + "=" * 60)
        print("[ERRO] ERRO AO CORRIGIR BANCO DE DADOS")
        print("=" * 60)
        sys.exit(1)

