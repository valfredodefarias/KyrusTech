import sys
from pathlib import Path

# Executado como `python scripts/run_migrations.py`: o diretório do script entra no sys.path,
# não a raiz do projeto. Sem isto, `import app` falha e as migrações não rodam no startup.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from alembic.config import Config
from alembic import command
from sqlmodel import SQLModel
from app.db.session import engine
import app.models  # noqa: F401


def run():
    # 1. Tentar executar migrações do Alembic se configurado
    try:
        alembic_cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
        command.upgrade(alembic_cfg, "head")
        print("[Migrations] Migrações Alembic aplicadas com sucesso.")
    except Exception as exc:
        print(f"[Migrations] Aviso Alembic (ignorável se sem novas versões): {exc}", file=sys.stderr)

    # 2. Garantir criação idempotente de tabelas do SQLModel
    try:
        SQLModel.metadata.create_all(engine)
        print("[Migrations] Tabelas SQLModel verificadas e sincronizadas com sucesso.")
    except Exception as exc:
        print(f"[Migrations] Erro crítico ao sincronizar tabelas SQLModel: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    run()
