# alembic/env.py

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os
import sys

# --- CORREÇÃO DO CAMINHO (CRUCIAL) ---
# Isso pega o diretório onde este arquivo (env.py) está...
current_path = os.path.dirname(os.path.abspath(__file__))
# ...e sobe um nível para chegar na raiz do projeto (KYRUS_ERP)
root_path = os.path.abspath(os.path.join(current_path, '..'))
# Adiciona a raiz ao Python Path para que ele encontre o módulo 'app'
sys.path.insert(0, root_path)
# -------------------------------------

# AGORA (e só agora) podemos importar coisas do app
from dotenv import load_dotenv
load_dotenv()

from app.core.config import settings
from app.db.base_class import Base

# Configuração do Alembic
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline() -> None:
    url = settings.DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.DATABASE_URL
    
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()