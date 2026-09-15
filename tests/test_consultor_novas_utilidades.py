# tests/test_consultor_novas_utilidades.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.db.session import get_db
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.plano_contas import PlanoContas
from app.enums import ConsultorRole
from app.core.security import get_password_hash


def test_consultor_export_import_and_sync(session: Session, client: TestClient):
    # 1. Setup super consultor user
    super_user = Usuario(
        email="super_test@example.com",
        nome="Super Test",
        hashed_password=get_password_hash("pass123"),
        is_active=True,
        is_consultor=True,
        consultor_role=ConsultorRole.SUPER_CONSULTOR.value,
        is_superuser=False,
    )
    session.add(super_user)

    # 2. Setup a target company
    empresa = Empresa(
        nome_fantasia="Empresa Teste Sincronia",
        razao_social="Empresa Teste Sincronia LTDA",
        cnpj="11222333000199",
        tipo_pessoa="PJ",
        is_active=True,
        is_deleted=False,
    )
    session.add(empresa)
    session.commit()
    session.refresh(super_user)
    session.refresh(empresa)

    app.dependency_overrides[get_db] = lambda: session
    from app.api.v1.deps import get_current_active_user, get_consultor_user, get_super_consultor_user
    from app.api.deps import get_current_user
    app.dependency_overrides[get_current_active_user] = lambda: super_user
    app.dependency_overrides[get_consultor_user] = lambda: super_user
    app.dependency_overrides[get_super_consultor_user] = lambda: super_user
    app.dependency_overrides[get_current_user] = lambda: super_user

    try:
        # Test Export
        resp_export = client.get("/api/v1/consultor/super/plano-contas-templates/PJ/exportar")
        assert resp_export.status_code == 200
        data_export = resp_export.json()
        assert data_export["tipo_pessoa"] == "PJ"
        assert "items" in data_export
        assert len(data_export["items"]) > 0

        # Test Sync to company
        resp_sync = client.post(f"/api/v1/consultor/super/empresas/{empresa.id}/sincronizar-template", json={"tipo_pessoa": "PJ"})
        assert resp_sync.status_code == 200
        data_sync = resp_sync.json()
        assert data_sync["success"] is True
        assert data_sync["total_categorias_empresa"] > 0

        # Verify created categories in company
        contas_empresa = session.exec(
            select(PlanoContas).where(PlanoContas.empresa_id == empresa.id)
        ).all()
        assert len(contas_empresa) > 0

        # Test user creation as consultor
        resp_user = client.post("/api/v1/usuarios/", json={
            "email": "novo_consultor@example.com",
            "nome": "Novo Consultor",
            "password": "senha123456",
            "is_consultor": True,
        })
        assert resp_user.status_code == 201
        created_user = resp_user.json()
        assert created_user["is_consultor"] is True
        assert created_user["consultor_role"] == "CONSULTOR"

        # Test updating user by super consultor (change role and active status)
        resp_update = client.put(f"/api/v1/usuarios/{created_user['id']}", json={
            "nome": "Consultor Atualizado",
            "consultor_role": "SUPER_CONSULTOR",
        })
        assert resp_update.status_code == 200
        updated_data = resp_update.json()
        assert updated_data["nome"] == "Consultor Atualizado"
        assert updated_data["consultor_role"] == "SUPER_CONSULTOR"

    finally:
        app.dependency_overrides.clear()
