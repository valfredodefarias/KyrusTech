#!/usr/bin/env python3
"""
Script para executar migrations do Alembic automaticamente
Executado na inicialização do container
"""

import sys
import os
from pathlib import Path
from subprocess import run, PIPE

# Adicionar raiz ao path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

def run_migrations():
    """Executa Alembic upgrade"""
    try:
        print("🔄 Executando migrations do Alembic...")
        
        result = run(
            ["alembic", "upgrade", "head"],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("✅ Migrations executadas com sucesso!")
            print(result.stdout)
            return True
        else:
            print("❌ Erro ao executar migrations:")
            print(result.stderr)
            return False
    
    except Exception as e:
        print(f"❌ Erro: {e}")
        return False

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    success = run_migrations()
    sys.exit(0 if success else 1)
