from fastapi.testclient import TestClient
from app.core.config import settings

def test_health_check(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["message"] == "API is running"

def test_docs_environment_protection(client: TestClient):
    # 1. Testar no ambiente atual (testing/development)
    original_env = settings.ENVIRONMENT
    try:
        settings.ENVIRONMENT = "testing"
        
        # /docs deve retornar 200
        res_docs = client.get("/docs")
        assert res_docs.status_code == 200
        
        # /swagger deve retornar 200
        res_swagger = client.get("/swagger")
        assert res_swagger.status_code == 200
        
        # / deve listar as URLs
        res_root = client.get("/")
        data_root = res_root.json()
        assert data_root["docs"] == "/docs"
        assert data_root["swagger"] == "/swagger"
        assert data_root["openapi"] == "/openapi.json"
        
        # 2. Simular ambiente de produção
        settings.ENVIRONMENT = "production"
        
        # /docs deve retornar 404
        res_docs_prod = client.get("/docs")
        assert res_docs_prod.status_code == 404
        
        # /swagger deve retornar 404
        res_swagger_prod = client.get("/swagger")
        assert res_swagger_prod.status_code == 404
        
        # / deve omitir os links
        res_root_prod = client.get("/")
        data_root_prod = res_root_prod.json()
        assert data_root_prod["docs"] is None
        assert data_root_prod["swagger"] is None
        assert data_root_prod["openapi"] is None
        
    finally:
        settings.ENVIRONMENT = original_env

