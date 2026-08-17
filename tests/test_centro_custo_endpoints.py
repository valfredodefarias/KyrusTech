import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.main import app
from app.api.v1.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.enums import ConsultorRole

@pytest.fixture(name="mock_user_cc")
def mock_user_cc_fixture(session: Session):
    empresa = Empresa(razao_social="Empresa Teste CC", nome_fantasia="Empresa Teste CC", cnpj="11222333000188")
    session.add(empresa)
    session.commit()
    session.refresh(empresa)

    user = Usuario(
        email="cc@test.com", 
        nome="CC User", 
        is_active=True, 
        is_consultor=True, 
        consultor_role=ConsultorRole.SUPER_CONSULTOR.value,
        hashed_password="fake",
        empresa_id=empresa.id
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user

def test_centro_custo_crud(client: TestClient, session: Session, mock_user_cc: Usuario):
    def override_get_user():
        return mock_user_cc

    def override_get_empresa_id():
        return mock_user_cc.empresa_id

    app.dependency_overrides[get_current_user] = override_get_user
    app.dependency_overrides[get_current_active_user] = override_get_user
    app.dependency_overrides[get_empresa_id_from_user] = override_get_empresa_id

    try:
        # Create
        payload = {
            "nome": "Centro Teste",
            "status": "ATIVO",
        }
        res_create = client.post("/api/v1/centro-custo/", json=payload)
        assert res_create.status_code == 201, res_create.text
        cc_id = res_create.json()["id"]

        # Read
        res_read = client.get("/api/v1/centro-custo/")
        assert res_read.status_code == 200
        assert any(cc["id"] == cc_id for cc in res_read.json())

        # Update
        res_update = client.put(f"/api/v1/centro-custo/{cc_id}", json={"nome": "Centro Atualizado", "status": "INATIVO"})
        assert res_update.status_code == 200
        assert res_update.json()["nome"] == "Centro Atualizado"

        # Delete
        res_delete = client.delete(f"/api/v1/centro-custo/{cc_id}")
        assert res_delete.status_code == 200

        res_read_after = client.get("/api/v1/centro-custo/")
        assert not any(cc["id"] == cc_id for cc in res_read_after.json())
    finally:
        app.dependency_overrides.clear()
