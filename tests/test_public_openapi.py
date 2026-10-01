from fastapi.testclient import TestClient
from app.main import app
from app.core.public_api import PUBLIC_API_TAGS
from app.api.v1.endpoints.public import clear_public_openapi_cache


def test_public_openapi_endpoint_unauthenticated(client: TestClient):
    clear_public_openapi_cache()

    res = client.get("/api/v1/public/openapi.json")
    assert res.status_code == 200
    data = res.json()

    assert data["info"]["title"] == "Kyrus API - Desenvolvedores"
    assert "components" in data
    assert "securitySchemes" in data["components"]
    assert "ApiKeyAuth" in data["components"]["securitySchemes"]
    assert data["components"]["securitySchemes"]["ApiKeyAuth"]["name"] == "X-Api-Key"

    # Servidores de prod e local
    servers = [s["url"] for s in data.get("servers", [])]
    assert "https://api.kyrustech.com.br" in servers

    # Todas as rotas no schema devem possuir apenas tags públicas
    paths = data.get("paths", {})
    assert len(paths) > 0

    for path, methods in paths.items():
        for method, op in methods.items():
            if method in {"get", "post", "put", "patch", "delete"}:
                tags = op.get("tags", [])
                assert any(t in PUBLIC_API_TAGS for t in tags), f"Rota não pública vazou: {path} {method} tags={tags}"
                # Nenhuma rota privada de administração de usuários ou RBAC deve existir
                assert "Usuários" not in tags
                assert "RBAC" not in tags
                assert "Autenticação" not in tags

    # Verifica cache
    res2 = client.get("/api/v1/public/openapi.json")
    assert res2.status_code == 200
    assert res2.json() == data
