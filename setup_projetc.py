# setup_project.py
# VERSÃO PROFISSIONAL - Focada em Escalabilidade e Paridade de Ambientes com Docker.
# Ideal para ambientes Linux como o Zorin OS.

import os
import textwrap

# --- Estrutura de Pastas e Arquivos ---
project_structure = {
    "app": {
        "api": {
            "v1": {
                "endpoints": {"auth.py": None, "empresas.py": None, "usuarios.py": None},
                "__init__.py": None, "api.py": None, "deps.py": None,
            }
        },
        "core": {"__init__.py": None, "config.py": None, "security.py": None},
        "crud": {"__init__.py": None, "base.py": None},
        "db": {"__init__.py": None, "base_class.py": None, "session.py": None},
        "models": {"__init__.py": None, "empresa.py": None, "usuario.py": None},
        "schemas": {"__init__.py": None, "token.py": None, "usuario.py": None},
        "__init__.py": None, "main.py": None,
    },
    "alembic": {"versions": {}, "env.py": None, "script.py.mako": None},
    ".env.example": None,
    "alembic.ini": None,
    "docker-compose.yml": None,
    "requirements.txt": None,
    "README.md": None,
}

# --- Conteúdo dos Arquivos Base ---
file_contents = {
    "README.md": """
    # 📘 Kyrus ERP - Arquitetura Escalável v4.0

    Este projeto foi configurado com paridade de ambientes em mente, utilizando Docker para garantir que o desenvolvimento seja o mais próximo possível da produção.

    ## Pré-requisitos
    - Python 3.10+
    - Docker e Docker Compose

    ## Workflow de Setup Inicial (Ambiente Linux)
    1.  **Configure o Ambiente:**
        - Renomeie `.env.example` para `.env`.
        - **IMPORTANTE:** As senhas no `.env` devem ser as mesmas do `docker-compose.yml`.

    2.  **Inicie o Banco de Dados com Docker:**
        ```bash
        docker compose up -d
        ```
        *(O `-d` roda em modo "detached", liberando seu terminal).*

    3.  **Crie e Ative o Ambiente Virtual Python:**
        ```bash
        python3 -m venv venv
        source venv/bin/activate
        ```

    4.  **Instale as Dependências:**
        ```bash
        pip install -r requirements.txt
        ```

    5.  **Configure e Execute as Migrações do Banco:**
        - Edite `alembic.ini` e `alembic/env.py` para conectar com o banco (instruções no terminal do setup).
        ```bash
        alembic revision --autogenerate -m "Cria tabelas iniciais"
        alembic upgrade head
        ```

    6.  **Rode o Servidor da Aplicação:**
        ```bash
        uvicorn app.main:app --reload
        ```

    ## Comandos Úteis do Docker
    - `docker compose up -d`: Inicia os serviços em segundo plano.
    - `docker compose down`: Para os serviços e remove os containers.
    - `docker compose logs -f db`: Vê os logs do banco de dados em tempo real.
    """,
    "requirements.txt": """
# Framework e Servidor
fastapi
uvicorn[standard]

# Configuração e Segurança
pydantic-settings
python-dotenv
passlib[bcrypt]
python-jose[cryptography]

# Banco de Dados e ORM (PostgreSQL)
sqlmodel
alembic
psycopg2-binary

# Armazenamento de Arquivos (AWS S3)
boto3
    """,
    ".env.example": """
# --- Configurações Gerais ---
PROJECT_NAME="Kyrus ERP"
SECRET_KEY="SUA_CHAVE_SECRETA_SUPER_LONGA_E_SEGURA_AQUI"
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# --- Banco de Dados PostgreSQL (deve ser igual ao docker-compose.yml) ---
POSTGRES_SERVER=localhost
POSTGRES_PORT=5432
POSTGRES_USER=kyrus_user
POSTGRES_PASSWORD=kyrus_pass
POSTGRES_DB=kyrus_db
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_SERVER}:${POSTGRES_PORT}/${POSTGRES_DB}

# --- Armazenamento de Arquivos (AWS S3) ---
AWS_ACCESS_KEY_ID="SUA_CHAVE_DE_ACESSO_AWS"
AWS_SECRET_ACCESS_KEY="SUA_CHAVE_SECRETA_AWS"
AWS_S3_BUCKET_NAME="nome-do-seu-bucket-kyrus-erp"
AWS_S3_REGION="us-east-1"
    """,
    "docker-compose.yml": """
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: kyrus_db_dev
    restart: always
    environment:
      - POSTGRES_USER=kyrus_user
      - POSTGRES_PASSWORD=kyrus_pass
      - POSTGRES_DB=kyrus_db
    ports:
      - "5432:5432"
    volumes:
      - ./postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
    """,
    "alembic.ini": """
[alembic]
script_location = alembic
sqlalchemy.url = driver://user:pass@localhost/dbname

[loggers]
keys = root,sqlalchemy,alembic
[handlers]
keys = console
[formatters]
keys = generic
[logger_root]
level = WARN
handlers = console
[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine
[logger_alembic]
level = INFO
handlers =
qualname = alembic
[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic
[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
    """,
    "alembic/env.py": """
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
target_metadata = None

def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
    """,
    "alembic/script.py.mako": """
\"\"\"${message}\"\"\"
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}
# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}
def upgrade() -> None:
    ${upgrades if upgrades else "pass"}
def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
    """,
    "app/main.py": """
from fastapi import FastAPI
from app.api.v1.api import api_router
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)

@app.get("/", tags=["Root"])
def read_root():
    return {"message": f"Bem-vindo à API do {settings.PROJECT_NAME}"}

app.include_router(api_router, prefix="/api/v1")
    """,
    "app/core/config.py": """
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Kyrus ERP"
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    
    POSTGRES_SERVER: str
    POSTGRES_PORT: int
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    DATABASE_URL: str

    AWS_ACCESS_KEY_ID: str
    AWS_SECRET_ACCESS_KEY: str
    AWS_S3_BUCKET_NAME: str
    AWS_S3_REGION: str

    class Config:
        env_file = ".env"

settings = Settings()
    """,
    "app/db/base_class.py": """
from sqlmodel import SQLModel
class Base(SQLModel):
    pass
    """,
    "app/api/v1/api.py": """
from fastapi import APIRouter
# Adicione seus endpoints aqui conforme cria
# from .endpoints import auth, usuarios

api_router = APIRouter()
# api_router.include_router(auth.router, prefix="/auth", tags=["Autenticação"])
    """,
}

# Função para criar a estrutura recursivamente
def create_project(base_path, structure):
    for name, content in structure.items():
        current_path = os.path.join(base_path, name)
        if isinstance(content, dict):
            os.makedirs(current_path, exist_ok=True)
            print(f"Diretório criado: {current_path}")
            create_project(current_path, content)
        else:
            with open(current_path, "w", encoding="utf-8") as f:
                relative_path = os.path.relpath(
                    current_path, start=os.getcwd()
                ).replace("\\", "/")
                if relative_path in file_contents:
                    f.write(textwrap.dedent(file_contents[relative_path]).strip())
                    print(f"Arquivo criado: {current_path} (com conteúdo)")
                else:
                    f.write("")
                    print(f"Arquivo criado: {current_path} (vazio)")

if __name__ == "__main__":
    project_root = os.getcwd()
    print("🚀 Iniciando a criação da estrutura do projeto focada em escalabilidade...")
    create_project(project_root, project_structure)
    print("\n✅ Estrutura profissional criada com sucesso!")
    print("\n➡️  SEUS PRÓXIMOS PASSOS (LEIA O README.md):")
    print("   1. Inicie o Docker: `docker compose up -d`.")
    print("   2. Crie e ative o ambiente Python: `python3 -m venv venv` e `source venv/bin/activate`.")
    print("   3. Instale as dependências: `pip install -r requirements.txt`.")
    print("   4. **FAÇA AS EDIÇÕES CRÍTICAS NO ALEMBIC (próximo passo).**")