import os
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.core.config import settings
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.access_permission import AccessPermission
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile
from app.models.api_key import ApiKey
from app.models.idempotency_log import IdempotencyLog
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.services import api_key_service
from app.services.access_control_service import invalidate_permission_cache


@pytest.fixture(name="setup_api_keys_env")
def setup_api_keys_env_fixture(session: Session):
    empresa1 = Empresa(id=1, razao_social="Matriz Tech LTDA", nome_fantasia="Matriz", cnpj="11111111000101")
    empresa2 = Empresa(id=2, razao_social="Filial Tech LTDA", nome_fantasia="Filial", cnpj="22222222000102")
    session.add(empresa1)
    session.add(empresa2)
    session.flush()

    admin_user = Usuario(
        id=10,
        email="admin@matriz.com.br",
        nome="Admin Matriz",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=False,
        empresa_id=1,
    )
    session.add(admin_user)
    session.flush()

    perm_manage = AccessPermission(code="config.api_keys.manage", module="configuracoes", action="manage", description="Gerenciar Chaves")
    perm_lanc_create = AccessPermission(code="lancamentos:create", module="lancamentos", action="create", description="Criar")
    perm_lanc_view = AccessPermission(code="lancamentos:view", module="lancamentos", action="view", description="Ver")
    perm_user_del = AccessPermission(code="usuarios:delete", module="usuarios", action="delete", description="Excluir usuario")
    session.add(perm_manage)
    session.add(perm_lanc_create)
    session.add(perm_lanc_view)
    session.add(perm_user_del)
    session.flush()

    # Perfil admin para o criador
    profile_admin = AccessProfile(empresa_id=1, name="Admin Key Profile", code="ADMIN_KEY_PROF")
    session.add(profile_admin)
    session.flush()
    session.add(AccessProfilePermission(profile_id=profile_admin.id, permission_id=perm_manage.id))
    session.add(AccessProfilePermission(profile_id=profile_admin.id, permission_id=perm_lanc_create.id))
    session.add(AccessProfilePermission(profile_id=profile_admin.id, permission_id=perm_lanc_view.id))

    # Vincula o admin_user ao profile_admin
    session.add(UserCompanyProfile(usuario_id=admin_user.id, empresa_id=1, profile_id=profile_admin.id))

    # Perfil integração para a chave de API
    profile_integ = AccessProfile(empresa_id=1, name="Perfil Integracao", code="INTEGRACAO_API")
    session.add(profile_integ)
    session.flush()
    session.add(AccessProfilePermission(profile_id=profile_integ.id, permission_id=perm_lanc_create.id))
    session.add(AccessProfilePermission(profile_id=profile_integ.id, permission_id=perm_lanc_view.id))

    # Perfil com permissões extras (para teste de anti-escalada)
    profile_escalated = AccessProfile(empresa_id=1, name="Perfil Perigoso", code="PERIGOSO")
    session.add(profile_escalated)
    session.flush()
    session.add(AccessProfilePermission(profile_id=profile_escalated.id, permission_id=perm_user_del.id))

    session.commit()
    from app.services.access_control_service import invalidate_permission_cache
    invalidate_permission_cache()

    yield {
        "empresa1": empresa1,
        "empresa2": empresa2,
        "admin_user": admin_user,
        "profile_admin": profile_admin,
        "profile_integ": profile_integ,
        "profile_escalated": profile_escalated,
        "perm_lanc_create": perm_lanc_create,
        "perm_lanc_view": perm_lanc_view,
    }

    invalidate_permission_cache()


def test_create_api_key_returns_raw_key_once(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin
    app.dependency_overrides[get_empresa_id_from_user] = lambda: 1

    try:
        payload = {
            "name": "Chave n8n Produção",
            "profile_id": profile_integ.id,
        }
        res = client.post("/api/v1/api-keys", json=payload)
        assert res.status_code == 201
        data = res.json()

        assert "raw_key" not in data
        key = data.get("key")
        assert key is not None
        assert key.startswith(("kyr_live_", "kyr_test_"))
        assert len(key) > 30

        assert data["key_prefix"].startswith(("kyr_live_", "kyr_test_"))
        assert "••••" in data["masked_key"]
        assert data["masked_key"].startswith(data["key_prefix"])
        assert data["is_active"] is True

        # Listagem subsequente nunca retorna a raw_key nem o hash
        res_list = client.get("/api/v1/api-keys")
        assert res_list.status_code == 200
        items = res_list.json()
        assert len(items) == 1
        item = items[0]
        assert "raw_key" not in item
        assert "key" not in item
        assert "key_hash" not in item
        assert item["masked_key"] == data["masked_key"]
    finally:
        app.dependency_overrides.clear()


def test_authenticate_with_api_key_header(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Header Test",
        profile_id=profile_integ.id,
    )

    # Acesso via header X-Api-Key a endpoint público
    res = client.get("/api/v1/lancamentos/", headers={"X-Api-Key": raw_key})
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_authenticate_with_bearer_api_key(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Bearer Test",
        profile_id=profile_integ.id,
    )

    # Acesso via Authorization: Bearer kyr_live_...
    res = client.get("/api/v1/lancamentos/", headers={"Authorization": f"Bearer {raw_key}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_revoke_api_key_blocks_access(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Revogada Test",
        profile_id=profile_integ.id,
    )

    # Revoga a chave
    api_key_service.revoke_api_key(session, key_id=api_key.id, empresa_id=1, revoked_by=admin)

    # Requisição subsequente deve ser recusada com 401
    res = client.get("/api/v1/lancamentos/", headers={"X-Api-Key": raw_key})
    assert res.status_code == 401


def test_expired_api_key_blocks_access(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Expirada Test",
        profile_id=profile_integ.id,
        expires_at=datetime.utcnow() - timedelta(days=1),
    )

    res = client.get("/api/v1/lancamentos/", headers={"X-Api-Key": raw_key})
    assert res.status_code == 401


def test_api_key_cross_company_isolation(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Tenant Test",
        profile_id=profile_integ.id,
    )

    # Tenta acessar enviando X-Company-ID: 2 (outra empresa)
    res = client.get("/api/v1/lancamentos/", headers={"X-Api-Key": raw_key, "X-Company-ID": "2"})
    assert res.status_code == 403
    assert "outra empresa" in res.json()["detail"].lower()


def test_api_key_cannot_login_or_reset_password(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Service User Test",
        profile_id=profile_integ.id,
    )
    service_user = session.get(Usuario, api_key.service_user_id)
    assert service_user is not None
    assert service_user.is_service_account is True

    # 1. Login bloqueado
    res_login = client.post(
        "/api/v1/auth/login",
        data={"username": service_user.email, "password": "QualquerSenha123!"},
    )
    assert res_login.status_code in (400, 401)

    # 2. Reset de senha bloqueado: nenhuma chave de reset é gerada e redefinição direta é rejeitada
    from app.models.password_reset_code import PasswordResetCode
    res_solicitar = client.post(
        "/api/v1/auth/recuperar-senha/solicitar",
        json={"email": service_user.email},
    )
    assert res_solicitar.status_code == 200
    code_in_db = session.exec(select(PasswordResetCode).where(PasswordResetCode.email == service_user.email)).first()
    assert code_in_db is None

    res_redefinir = client.post(
        "/api/v1/auth/recuperar-senha/redefinir",
        json={"email": service_user.email, "code": "123456", "new_password": "NewSecretPassword123!"},
    )
    assert res_redefinir.status_code == 400


def test_anti_escalation_fails_if_profile_has_extra_permissions(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_escalated = setup_api_keys_env["profile_escalated"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin
    app.dependency_overrides[get_empresa_id_from_user] = lambda: 1

    try:
        # admin não possui usuarios:delete, mas profile_escalated possui
        payload = {
            "name": "Chave Escalada Maliciosa",
            "profile_id": profile_escalated.id,
        }
        res = client.post("/api/v1/api-keys", json=payload)
        assert res.status_code == 403
        assert "usuarios:delete" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_non_public_endpoint_blocked_for_api_key(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Public Guard Test",
        profile_id=profile_integ.id,
    )

    # /api/v1/usuarios/me não está em PUBLIC_API_TAGS -> deve retornar 403
    res = client.get("/api/v1/usuarios/me", headers={"X-Api-Key": raw_key})
    assert res.status_code == 403
    assert "disponível para chaves de api" in res.json()["detail"].lower()


def test_rate_limit_isolated_per_api_key(client: TestClient, session: Session, setup_api_keys_env, monkeypatch):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Rate Limit Test",
        profile_id=profile_integ.id,
    )

    from app.main import _RATE_LIMIT_EVENTS
    _RATE_LIMIT_EVENTS.clear()

    try:
        # Simula ambiente de produção para ativar o middleware de rate limit
        monkeypatch.setenv("TESTING", "0")
        monkeypatch.setattr(settings, "RATE_LIMIT_API_KEY_MAX_REQUESTS", 2)

        headers = {"X-Api-Key": raw_key}

        # 1ª requisição -> 200
        res1 = client.get("/api/v1/lancamentos/", headers=headers)
        assert res1.status_code == 200
        assert "X-RateLimit-Limit" in res1.headers
        assert res1.headers["X-RateLimit-Limit"] == "2"

        # 2ª requisição -> 200
        res2 = client.get("/api/v1/lancamentos/", headers=headers)
        assert res2.status_code == 200

        # 3ª requisição -> 429
        res3 = client.get("/api/v1/lancamentos/", headers=headers)
        assert res3.status_code == 429
        assert "X-RateLimit-Limit" in res3.headers
        assert res3.headers["X-RateLimit-Remaining"] == "0"
    finally:
        _RATE_LIMIT_EVENTS.clear()


def test_api_key_via_cookie_is_rejected(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Cookie Rejection Test",
        profile_id=profile_integ.id,
    )

    # Chave enviada via cookie não pode ser aceita como chave de API nem como JWT válido
    cookie_name = settings.ACCESS_TOKEN_COOKIE_NAME
    res = client.get("/api/v1/lancamentos/", cookies={cookie_name: raw_key})
    assert res.status_code in (401, 403)
    assert res.status_code != 200


def test_service_account_rejected_in_jwt_flow(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave JWT Rejection Test",
        profile_id=profile_integ.id,
    )
    service_user = session.get(Usuario, api_key.service_user_id)

    # Forja um JWT válido apontando para o e-mail da conta de serviço
    from jose import jwt
    token = jwt.encode(
        {"sub": service_user.email, "exp": datetime.utcnow() + timedelta(hours=1)},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )

    res = client.get("/api/v1/lancamentos/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401
    assert "contas de serviço não podem ser autenticadas via jwt" in res.json()["detail"].lower()


def test_service_account_empty_profile_does_not_get_fallback_permissions(session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]

    # Cria perfil totalmente vazio
    profile_empty = AccessProfile(empresa_id=1, name="Perfil Vazio Test", code="PERFIL_VAZIO_TEST")
    session.add(profile_empty)
    session.commit()

    api_key, raw_key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Perfil Vazio Test",
        profile_id=profile_empty.id,
    )

    from app.services.access_control_service import get_effective_permission_codes
    perms = get_effective_permission_codes(
        session,
        user_id=api_key.service_user_id,
        empresa_id=1,
        is_consultor=False,
        consultor_role="",
        is_service_account=True,
    )
    # Mesmo em ambiente de teste/dev onde settings.ENVIRONMENT != 'production',
    # a conta de serviço NUNCA ganha permissões por fallback de transição
    assert perms == set()


def test_key_prefix_collision_retry(session: Session, setup_api_keys_env, monkeypatch):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]

    # Primeiro criamos uma chave existente
    api_key1, raw_key1 = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Existente",
        profile_id=profile_integ.id,
    )

    original_generate = api_key_service.generate_api_key
    calls = []

    def mock_generate(environment=None):
        calls.append(len(calls))
        if len(calls) == 1:
            # 1ª tentativa gera prefixo colidente
            _, _, cand_hash = original_generate(environment)
            return raw_key1, api_key1.key_prefix, cand_hash
        return original_generate(environment)

    monkeypatch.setattr(api_key_service, "generate_api_key", mock_generate)

    api_key2, raw_key2 = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Com Retry",
        profile_id=profile_integ.id,
    )

    assert len(calls) == 2
    assert api_key2.id != api_key1.id
    assert api_key2.key_prefix != api_key1.key_prefix


def test_idempotency_cross_company_isolation(session: Session):
    import asyncio
    from app.api.deps import check_idempotency
    from fastapi import Request

    async def _test():
        shared_key = "idemp-shared-key-cross-company-999"
        req1 = Request(scope={"type": "http", "headers": [(b"idempotency-key", shared_key.encode())]})
        gen1 = check_idempotency(request=req1, session=session, empresa_id=1)
        val1 = await gen1.asend(None)
        assert val1 == shared_key

        req2 = Request(scope={"type": "http", "headers": [(b"idempotency-key", shared_key.encode())]})
        gen2 = check_idempotency(request=req2, session=session, empresa_id=2)
        val2 = await gen2.asend(None)
        assert val2 == shared_key

        logs = session.exec(
            select(IdempotencyLog).where(IdempotencyLog.idempotency_key == shared_key)
        ).all()
        assert len(logs) == 2
        assert {l.empresa_id for l in logs} == {1, 2}

        await gen1.aclose()
        await gen2.aclose()

    asyncio.run(_test())


def test_audit_log_records_api_key_id(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_admin = setup_api_keys_env["profile_admin"]
    perm_ent_create = AccessPermission(code="entidades:create", module="entidades", action="create", description="Criar Entidade")
    session.add(perm_ent_create)
    session.flush()

    # O criador precisa ter a permissão para não violar a regra anti-escalada
    session.add(AccessProfilePermission(profile_id=profile_admin.id, permission_id=perm_ent_create.id))

    profile_ent = AccessProfile(empresa_id=1, name="Perfil Entidades Audit", code="ENT_AUDIT_PROF")
    session.add(profile_ent)
    session.flush()
    session.add(AccessProfilePermission(profile_id=profile_ent.id, permission_id=perm_ent_create.id))
    session.commit()
    invalidate_permission_cache()

    api_key, key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Entidades Audit Test",
        profile_id=profile_ent.id,
    )

    payload = {
        "nome": "Fornecedor Integrado via Chave Audit",
        "tipo": "FORNECEDOR",
    }
    res = client.post("/api/v1/entidades/", json=payload, headers={"X-Api-Key": key})
    assert res.status_code == 201
    entidade_id = res.json()["id"]

    from app.models.audit_log import AuditLog
    session.expire_all()
    log = session.exec(
        select(AuditLog).where(
            AuditLog.table_name == "entidades",
            AuditLog.record_id == entidade_id,
            AuditLog.action == "CREATE",
        )
    ).first()
    assert log is not None
    assert log.api_key_id == api_key.id
    assert log.empresa_id == 1


def test_api_key_rbac_permission_denied(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    perm_lanc_view = setup_api_keys_env["perm_lanc_view"]

    profile_read = AccessProfile(empresa_id=1, name="Perfil Somente Leitura Lanc", code="READ_ONLY_LANC")
    session.add(profile_read)
    session.flush()
    session.add(AccessProfilePermission(profile_id=profile_read.id, permission_id=perm_lanc_view.id))
    session.commit()
    invalidate_permission_cache()

    api_key, key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave Read Only Test",
        profile_id=profile_read.id,
    )

    payload = {
        "descricao": "Tentativa não autorizada",
        "tipo": "RECEITA",
        "valor_previsto": 100.0,
        "data_vencimento": datetime.utcnow().strftime("%Y-%m-%d"),
        "plano_contas_id": 1,
    }
    res = client.post("/api/v1/lancamentos/", json=payload, headers={"X-Api-Key": key})
    assert res.status_code == 403
    assert "permissao" in res.json()["detail"].lower() or "acesso negado" in res.json()["detail"].lower()


def test_anti_escalation_on_patch(client: TestClient, session: Session, setup_api_keys_env):
    admin = setup_api_keys_env["admin_user"]
    profile_integ = setup_api_keys_env["profile_integ"]
    profile_escalated = setup_api_keys_env["profile_escalated"]

    api_key, key = api_key_service.create_api_key(
        session,
        empresa_id=1,
        created_by=admin,
        name="Chave para Patch Escalation",
        profile_id=profile_integ.id,
    )

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin
    app.dependency_overrides[get_empresa_id_from_user] = lambda: 1

    try:
        res = client.patch(f"/api/v1/api-keys/{api_key.id}", json={"profile_id": profile_escalated.id})
        assert res.status_code == 403
        assert "superiores" in res.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


