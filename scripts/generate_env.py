#!/usr/bin/env python3
"""
Script para gerar arquivo .env a partir do .env.example
Substitui placeholders por valores reais (especialmente SECRET_KEY)
"""

import os
import secrets
import sys
from pathlib import Path

def generate_secret_key(length: int = 32) -> str:
    """Gera uma chave secreta aleatória em hexadecimal"""
    return secrets.token_hex(length)

def generate_env_file(env_example_path: str, env_output_path: str) -> bool:
    """
    Gera arquivo .env a partir do .env.example
    Substitui valores dummy por valores reais
    """
    try:
        # Ler arquivo exemplo
        with open(env_example_path, 'r') as f:
            content = f.read()
        
        # Gerar SECRET_KEY
        secret_key = generate_secret_key()
        
        # Substituições
        replacements = {
            'sua-chave-secreta-aleatoria-aqui-min-32-caracteres': secret_key,
        }
        
        # Aplicar substituições
        for old, new in replacements.items():
            content = content.replace(old, new)
        
        # Escrever arquivo .env
        with open(env_output_path, 'w') as f:
            f.write(content)
        
        print(f"✅ Arquivo .env criado com sucesso: {env_output_path}")
        print(f"🔐 SECRET_KEY gerado: {secret_key[:16]}...")
        
        return True
    
    except FileNotFoundError:
        print(f"❌ Arquivo não encontrado: {env_example_path}")
        return False
    except Exception as e:
        print(f"❌ Erro ao gerar .env: {e}")
        return False

if __name__ == "__main__":
    ROOT_DIR = Path(__file__).resolve().parent.parent
    env_example = ROOT_DIR / ".env.example"
    env_output = ROOT_DIR / ".env"
    
    # Verificar se .env já existe
    if env_output.exists():
        response = input(f"⚠️  Arquivo {env_output} já existe. Sobrescrever? (s/n): ")
        if response.lower() != 's':
            print("Cancelado.")
            sys.exit(1)
    
    # Gerar arquivo
    success = generate_env_file(str(env_example), str(env_output))
    sys.exit(0 if success else 1)
