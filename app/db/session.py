from typing import Generator
from sqlmodel import create_engine, Session, SQLModel
from app.core.config import settings
from app.db import audit  # noqa: F401

# Garante que a URL seja uma string
database_url = str(settings.DATABASE_URL)

# Cria a engine com configurações otimizadas
engine = create_engine(
    database_url,
    pool_pre_ping=True,
    echo=False,
    pool_size=20,
    max_overflow=40,
    pool_recycle=3600
)

# Criar todas as tabelas (apenas primeira vez)
def init_db():
    """Cria todas as tabelas no banco de dados"""
    SQLModel.metadata.create_all(engine)

# --- FUNÇÃO PRINCIPAL ---
def get_db() -> Generator[Session, None, None]:
    """
    Dependência para injetar a sessão do banco em endpoints FastAPI.
    Abre a sessão, entrega para o endpoint e fecha automaticamente.
    """
    with Session(engine) as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise

# --- APELIDO PARA COMPATIBILIDADE ---
get_session = get_db
