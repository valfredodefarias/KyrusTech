"""
Script para limpar empresas de demonstração temporárias expiradas.
Pode ser executado via cron job, agendador de tarefas ou terminal.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.demo_cleanup_service import cleanup_expired_demos

if __name__ == "__main__":
    hours = 2
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        hours = int(sys.argv[1])
    cleanup_expired_demos(hours_threshold=hours)
