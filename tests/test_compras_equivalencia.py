import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia
from tests.test_pdv_conciliacao import setup_db_fixture

setup_db = setup_db_fixture

def test_endpoint_criar_equivalencia(client: TestClient, session: Session, setup_db):
    # Mock do Usuario e Empresa de autenticacao
    def mock_get_current_user():
        user = setup_db["usuario"]
        user.is_consultor = True
        user.consultor_role = "SUPER_CONSULTOR"
        return user

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    app.dependency_overrides.update(app_dependency_overrides)

    try:
        payload = {
            "fornecedor_id": 10,
            "codigo_produto_fornecedor": "FORN-PROD-999",
            "produto_interno_id": 55
        }

        # 1. Cria a equivalencia
        response = client.post("/api/v1/compras/equivalencias", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "sucesso"
        assert "id" in data

        # 2. Verifica no banco de dados
        equivalencia = session.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.empresa_id == 1,
                FornecedorProdutoEquivalencia.fornecedor_id == 10,
                FornecedorProdutoEquivalencia.codigo_produto_fornecedor == "FORN-PROD-999"
            )
        ).first()
        assert equivalencia is not None
        assert equivalencia.produto_interno_id == 55

        # 3. Atualiza a equivalencia
        payload_update = {
            "fornecedor_id": 10,
            "codigo_produto_fornecedor": "FORN-PROD-999",
            "produto_interno_id": 66
        }
        response_update = client.post("/api/v1/compras/equivalencias", json=payload_update)
        assert response_update.status_code == 201
        
        # 4. Verifica se atualizou o registro no banco
        session.expire_all()
        equivalencia_atualizada = session.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.empresa_id == 1,
                FornecedorProdutoEquivalencia.fornecedor_id == 10,
                FornecedorProdutoEquivalencia.codigo_produto_fornecedor == "FORN-PROD-999"
            )
        ).first()
        assert equivalencia_atualizada is not None
        assert equivalencia_atualizada.produto_interno_id == 66
        assert equivalencia_atualizada.id == equivalencia.id

    finally:
        app.dependency_overrides.clear()
