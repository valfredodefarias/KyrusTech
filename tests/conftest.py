import os
os.environ["AUTO_RUN_MIGRATIONS"] = "0"
os.environ["TESTING"] = "1"

import pytest
from typing import Generator
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlmodel import create_engine, Session, SQLModel
from app.main import app
from app.db.session import get_db
from app import models as _loaded_models

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(element, compiler, **kw):
    return "JSON"

# Banco SQLite em memória para testes
from sqlalchemy.pool import StaticPool

SQLITE_URL = "sqlite:///:memory:"

@pytest.fixture(name="session")
def session_fixture() -> Generator[Session, None, None]:
    # Configura o engine SQLite e ativa suporte a chaves estrangeiras
    engine = create_engine(
        SQLITE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        yield session
        
    SQLModel.metadata.drop_all(engine)

@pytest.fixture(name="client")
def client_fixture(session: Session) -> Generator[TestClient, None, None]:
    # Injeta a sessão de teste substituindo a conexão real do FastAPI
    def get_test_db(request: Request = None):
        try:
            # Configura informações de auditoria fake para o SQLite
            client_host = request.client.host if (request and getattr(request, "client", None)) else "127.0.0.1"
            user_agent = request.headers.get("user-agent", "pytest") if (request and hasattr(request, "headers")) else "pytest"
            session.info["audit_ip_address"] = client_host
            session.info["audit_user_agent"] = user_agent
            yield session
        except Exception:
            session.rollback()
            raise

    app.dependency_overrides[get_db] = get_test_db
    
    with TestClient(app) as client:
        yield client
        
    app.dependency_overrides.clear()
