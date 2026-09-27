import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.main import app
from app.api.v1.deps import get_current_user, get_current_active_user, get_consultor_user, get_super_consultor_user
from app.models.usuario import Usuario
from app.enums import ConsultorRole

@pytest.fixture(name="mock_user")
def mock_user_fixture(session: Session):
    user = Usuario(
        email="admin@test.com", 
        nome="Admin Teste", 
        is_active=True, 
        is_consultor=True, 
        consultor_role=ConsultorRole.SUPER_CONSULTOR.value,
        hashed_password="fake"
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

def test_empresas_crud_flow(client: TestClient, session: Session, mock_user: Usuario):
    def override_get_user():
        return mock_user

    app.dependency_overrides[get_current_user] = override_get_user
    app.dependency_overrides[get_super_consultor_user] = override_get_user
    app.dependency_overrides[get_consultor_user] = override_get_user
    app.dependency_overrides[get_current_active_user] = override_get_user

    try:
        # Create
        payload = {
            "razao_social": "Empresa Teste LTDA",
            "nome_fantasia": "Teste Empresa",
            "cnpj": "11222333000199",
            "is_active": True,
            "tipo_pessoa": "PJ"
        }
        res_create = client.post("/api/v1/empresas/", json=payload)
        assert res_create.status_code == 201, res_create.text
        data = res_create.json()
        assert data["nome_fantasia"] == "Teste Empresa"
        empresa_id = data["id"]

        # Read List
        res_list = client.get("/api/v1/empresas/")
        assert res_list.status_code == 200
        assert isinstance(res_list.json(), list)

        # Read specific
        res_get = client.get(f"/api/v1/empresas/{empresa_id}")
        assert res_get.status_code == 200
        assert res_get.json()["id"] == empresa_id

        # Update
        update_payload = {"nome_fantasia": "Nome Atualizado"}
        res_patch = client.patch(f"/api/v1/empresas/{empresa_id}", json=update_payload)
        assert res_patch.status_code == 200
        assert res_patch.json()["nome_fantasia"] == "Nome Atualizado"

    finally:
        app.dependency_overrides.clear()
