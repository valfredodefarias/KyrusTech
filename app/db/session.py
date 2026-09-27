from typing import Generator
from fastapi import Request
from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy import event
from app.core.config import settings
from app.db import audit  # noqa: F401
from app.core.network import get_client_ip

# Garante que a URL seja uma string
database_url = str(settings.DATABASE_URL)

# Cria a engine com configurações otimizadas
engine = create_engine(
    database_url,
    pool_pre_ping=True,
    echo=False,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    pool_timeout=settings.DATABASE_POOL_TIMEOUT,
    pool_recycle=3600
)

# Adiciona timeouts defensivos nas conexões do pool (PostgreSQL)
@event.listens_for(engine, "connect")
def set_connection_timeouts(dbapi_connection, connection_record):
    if engine.dialect.name == "postgresql":
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("SET lock_timeout = '5000'")
            cursor.execute("SET statement_timeout = '8000'")
            cursor.close()
        except Exception:
            pass

# Criar todas as tabelas (apenas primeira vez)
def init_db():
    """Cria todas as tabelas no banco de dados"""
    SQLModel.metadata.create_all(engine)

# --- FUNÇÃO PRINCIPAL ---
def get_db(request: Request = None) -> Generator[Session, None, None]:
    """
    Dependência para injetar a sessão do banco em endpoints FastAPI.
    Abre a sessão, entrega para o endpoint e fecha automaticamente.
    """
    with Session(engine) as session:
        try:
            client_host = get_client_ip(request)
            user_agent = request.headers.get("user-agent") if request else None
            session.info["audit_ip_address"] = client_host
            session.info["audit_user_agent"] = user_agent
            yield session
        except Exception:
            session.rollback()
            raise

# --- APELIDO PARA COMPATIBILIDADE ---
get_session = get_db
