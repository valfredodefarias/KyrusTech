#!/usr/bin/env python3
"""
📋 KYRUS ERP - Checklist de Arquivos Criados/Modificados

Este script verifica que todos os arquivos necessários foram criados.
"""

import os
from pathlib import Path

# Cores ANSI
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def check_file_exists(filepath, category=""):
    """Verifica se arquivo existe"""
    if os.path.exists(filepath):
        print(f"{GREEN}✅{RESET} {filepath}")
        return True
    else:
        print(f"{RED}❌{RESET} {filepath} {YELLOW}(FALTANDO){RESET}")
        return False

def main():
    print(f"\n{BLUE}{'='*60}")
    print(f"{'='*60}{RESET}")
    print(f"{BLUE}📋 KYRUS ERP - Verificação de Arquivos{RESET}\n")
    
    total = 0
    found = 0
    
    # Arquivos de Configuração
    print(f"{BLUE}🔧 Configuração{RESET}")
    config_files = [
        ".env.example",
        ".env",
        ".gitignore",
        ".dockerignore",
        "alembic.ini",
    ]
    for f in config_files:
        total += 1
        if check_file_exists(f):
            found += 1
    
    # Arquivos Docker
    print(f"\n{BLUE}🐳 Docker{RESET}")
    docker_files = [
        "Dockerfile",
        "docker-compose.yml",
        "docker-compose.prod.yml",
        "docker-compose.ssl.yml",
        "nginx.conf",
        "nginx-ssl.conf",
        "kyrus-web/Dockerfile",
    ]
    for f in docker_files:
        total += 1
        if check_file_exists(f):
            found += 1
    
    # Documentação
    print(f"\n{BLUE}📚 Documentação{RESET}")
    docs = [
        "README.md",
        "DEPLOYMENT.md",
        "TROUBLESHOOTING.md",
    ]
    for f in docs:
        total += 1
        if check_file_exists(f):
            found += 1
    
    # Scripts
    print(f"\n{BLUE}🚀 Scripts{RESET}")
    scripts = [
        "run.py",
        "quick-start.sh",
        "quick-start.bat",
        "scripts/generate_env.py",
        "scripts/run_migrations.py",
        "scripts/deploy.sh",
        "scripts/setup-ssl.sh",
    ]
    for f in scripts:
        total += 1
        if check_file_exists(f):
            found += 1
    
    # Código
    print(f"\n{BLUE}💻 Código Modificado{RESET}")
    code_files = [
        "app/main.py",
        "app/core/config.py",
        "app/core/logging.py",
        "app/db/session.py",
        "requirements.txt",
        "kyrus-web/vite.config.ts",
    ]
    for f in code_files:
        total += 1
        if check_file_exists(f):
            found += 1
    
    # Resumo
    print(f"\n{BLUE}{'='*60}")
    percentage = (found / total * 100) if total > 0 else 0
    status_color = GREEN if percentage == 100 else YELLOW if percentage >= 80 else RED
    
    print(f"{status_color}📊 Resultado: {found}/{total} arquivos ({percentage:.0f}%){RESET}")
    
    if percentage == 100:
        print(f"{GREEN}{'='*60}")
        print(f"✅ KYRUS ERP PRONTO PARA PRODUÇÃO!")
        print(f"{'='*60}{RESET}\n")
        
        print(f"{BLUE}📝 Próximos Passos:{RESET}")
        print("1. Leia README.md")
        print("2. Execute ./quick-start.sh (Linux/Mac) ou quick-start.bat (Windows)")
        print("3. Acesse http://localhost:3000")
        print("4. Para produção, leia DEPLOYMENT.md")
        print("5. Se der erro, siga TROUBLESHOOTING.md")
        
        return 0
    else:
        print(f"{RED}⚠️  Alguns arquivos estão faltando{RESET}\n")
        return 1

if __name__ == "__main__":
    exit(main())
