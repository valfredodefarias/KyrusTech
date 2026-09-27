# alembic/env.py

import builtins
import sqlmodel
setattr(builtins, "sqlmodel", sqlmodel)

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from sqlmodel import SQLModel
import os
import sys

# --- 1. CONFIGURAÇÃO DE CAMINHO (PATH) ---
# Adiciona a raiz do projeto ao Python Path para encontrar o módulo 'app'
current_path = os.path.dirname(os.path.abspath(__file__))
root_path = os.path.abspath(os.path.join(current_path, '..'))
sys.path.insert(0, root_path)

# --- 2. CARREGAR VARIÁVEIS DE AMBIENTE ---
from dotenv import load_dotenv
load_dotenv()

from app.core.config import settings

# --- 3. IMPORTAR TODOS OS MODELOS (CRUCIAL) ---
# Importa todos os modelos da aplicação registrando-os no SQLModel.metadata
import app.models  # noqa: F401



# --- 4. CONFIGURAÇÃO DO ALEMBIC ---
config = context.config

# Configura o log
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Define o metadata alvo como o do SQLModel
target_metadata = SQLModel.metadata

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    # Pega a URL do settings (arquivo .env)
    url = settings.DATABASE_URL
    
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Adicione compare_type=True se quiser detectar mudanças de String(50) para String(100)
        compare_type=True, 
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    
    # Sobrescreve a URL do alembic.ini com a do settings (.env)
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.DATABASE_URL

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, 
            target_metadata=target_metadata,
            compare_type=True # Detecta mudanças de tipos de coluna
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()