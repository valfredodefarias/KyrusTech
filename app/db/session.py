# app/db/session.py
from typing import Generator
from sqlmodel import create_engine, Session
from app.core.config import settings

# Configuração para SQLite (evita erro de thread) ou Postgres
connect_args = {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}

engine = create_engine(
    settings.DATABASE_URL, 
    echo=False, 
    connect_args=connect_args
)

# A função principal com o nome novo
def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

# --- O PULO DO GATO 🐱 ---
# Criamos um apelido: quem chamar 'get_db' recebe a 'get_session'
get_db = get_session