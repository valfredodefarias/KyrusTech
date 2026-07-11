from typing import Generator
from fastapi import Request
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
    pool_size=10,
    max_overflow=10,
    pool_recycle=3600
)

# Criar todas as tabelas (apenas primeira vez)
def init_db():
    """Cria todas as tabelas no banco de dados"""
    SQLModel.metadata.create_all(engine)

# --- FUNÇÃO PRINCIPAL ---
def get_db(request: Request) -> Generator[Session, None, None]:
    """
    Dependência para injetar a sessão do banco em endpoints FastAPI.
    Abre a sessão, entrega para o endpoint e fecha automaticamente.
    """
    with Session(engine) as session:
        try:
            from app.core.network import get_client_ip
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
