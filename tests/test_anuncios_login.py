import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.models.usuario import Usuario
from app.models.anuncio_login import AnuncioLogin, NoticiaLogin
from app.enums import ConsultorRole
from app.core.security import get_password_hash


def test_public_anuncios_content(client: TestClient, session: Session):
    # Endpoint público deve retornar 200 e sementes iniciais se banco novo
    response = client.get("/api/v1/anuncios/public")
    assert response.status_code == 200
    data = response.json()
    assert "anuncios" in data
    assert "noticias" in data
    assert len(data["anuncios"]) >= 1
    assert len(data["noticias"]) <= 3


def test_super_consultor_can_crud_anuncio_and_noticia(client: TestClient, session: Session):
    # 1. Cria usuário Super Consultor
    super_user = Usuario(
        email="superconsultor_test@kyrustech.com.br",
        hashed_password=get_password_hash("Secret123!"),
        nome="Super Consultor Test",
        is_active=True,
        is_consultor=True,
        consultor_role=ConsultorRole.SUPER_CONSULTOR.value,
    )
    session.add(super_user)
    session.commit()
    session.refresh(super_user)

    # 2. Login para obter token
    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": "superconsultor_test@kyrustech.com.br", "password": "Secret123!"},
    )
    assert login_resp.status_code == 200
    token = client.cookies.get("access_token") or login_resp.headers.get("Authorization")
    # Se token não estiver no body direto, geramos o bearer header
    from app.core.security import create_access_token
    from datetime import timedelta
    access_token = create_access_token(subject=super_user.email, expires_delta=timedelta(minutes=60))
    headers = {"Authorization": f"Bearer {access_token}"}

    # 3. Listar anúncios admin
    res_list = client.get("/api/v1/anuncios/admin/anuncios", headers=headers)
    assert res_list.status_code == 200

    # 4. Criar anúncio
    create_payload = {
        "titulo": "Novo Anúncio Teste",
        "empresa_nome": "Empresa Teste SA",
        "descricao": "Descrição detalhada do anúncio de teste",
        "cta_texto": "Clique Aqui",
        "link_url": "https://teste.com.br",
        "ordem": 10,
        "is_ativo": True,
    }
    res_create = client.post("/api/v1/anuncios/admin/anuncios", json=create_payload, headers=headers)
    assert res_create.status_code == 201
    created_id = res_create.json()["id"]

    # 5. Desativar anúncio
    res_update = client.patch(
        f"/api/v1/anuncios/admin/anuncios/{created_id}",
        json={"is_ativo": False},
        headers=headers,
    )
    assert res_update.status_code == 200
    assert res_update.json()["is_ativo"] is False

    # 6. Criar e desativar notícia
    noticia_payload = {
        "titulo": "Manchete Teste",
        "resumo": "Resumo da notícia de teste",
        "fonte": "Portal Teste",
        "categoria": "Economia",
        "imagem_url": "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f",
        "link_url": "https://teste.com.br/noticia",
        "ordem": 99,
        "is_ativo": True,
    }
    res_noticia = client.post("/api/v1/anuncios/admin/noticias", json=noticia_payload, headers=headers)
    assert res_noticia.status_code == 201
    noticia_id = res_noticia.json()["id"]

    res_noticia_toggle = client.patch(
        f"/api/v1/anuncios/admin/noticias/{noticia_id}",
        json={"is_ativo": False},
        headers=headers,
    )
    assert res_noticia_toggle.status_code == 200
    assert res_noticia_toggle.json()["is_ativo"] is False
