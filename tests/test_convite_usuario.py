# tests/test_convite_usuario.py
from datetime import datetime, timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.user_invite import UserInvite
from app.models.user_company_profile import UserCompanyProfile
from app.services.convite_usuario_service import (
    verificar_email_usuario,
    convidar_ou_vincular_usuario,
    validar_token_convite,
    completar_cadastro_convite,
    _compute_token_hash,
)


@pytest.fixture
def empresas_teste(session: Session) -> list[Empresa]:
    e1 = session.exec(select(Empresa).where(Empresa.nome_fantasia == "Empresa Convite 1")).first()
    if not e1:
        e1 = Empresa(nome_fantasia="Empresa Convite 1", razao_social="Empresa Convite 1 LTDA")
        session.add(e1)
        session.commit()
        session.refresh(e1)

    e2 = session.exec(select(Empresa).where(Empresa.nome_fantasia == "Empresa Convite 2")).first()
    if not e2:
        e2 = Empresa(nome_fantasia="Empresa Convite 2", razao_social="Empresa Convite 2 LTDA")
        session.add(e2)
        session.commit()
        session.refresh(e2)

    return [e1, e2]


def test_verificar_email_inexistente(session: Session):
    res = verificar_email_usuario(session, email="novo_usuario_inexistente@kyrustech.com")
    assert res["exists"] is False
    assert res["usuario"] is None
    assert len(res["empresas"]) == 0


def test_convidar_novo_usuario_flow(session: Session, empresas_teste: list[Empresa]):
    email = "joao.convidado@kyrustech.com"
    emp_ids = [empresas_teste[0].id, empresas_teste[1].id]

    # Limpeza prévia
    u_old = session.exec(select(Usuario).where(Usuario.email == email)).first()
    if u_old:
        session.delete(u_old)
        session.commit()

    with patch("app.services.convite_usuario_service.enviar_email_convite_usuario", return_value=True) as mock_send:
        res = convidar_ou_vincular_usuario(
            db=session,
            email=email,
            nome="João Convidado",
            empresa_ids=emp_ids,
            profile_id=1,
            base_url="https://kyrustech.com.br"
        )
        assert res["status"] == "invited_new"
        assert mock_send.called
        # Confirma que link foi montado com /completar-cadastro?token=
        call_kwargs = mock_send.call_args.kwargs
        assert "/completar-cadastro?token=" in call_kwargs["link_acesso"]
        assert call_kwargs["is_existing_user"] is False

    # Verifica usuário no banco
    user = session.exec(select(Usuario).where(Usuario.email == email)).first()
    assert user is not None
    assert user.nome == "João Convidado"
    assert user.is_active is True

    # Verifica vínculos das 2 empresas
    profiles = session.exec(
        select(UserCompanyProfile).where(UserCompanyProfile.usuario_id == user.id)
    ).all()
    assert len(profiles) == 2
    assert set(p.empresa_id for p in profiles) == set(emp_ids)

    # Verifica o convite gerado
    invite = session.exec(
        select(UserInvite).where(UserInvite.usuario_id == user.id, UserInvite.used == False)
    ).first()
    assert invite is not None
    assert invite.expires_at > datetime.utcnow()


def test_convidar_usuario_ja_existente(session: Session, empresas_teste: list[Empresa]):
    email = "usuario.existente@kyrustech.com"
    u = session.exec(select(Usuario).where(Usuario.email == email)).first()
    senha_original_hash = get_password_hash("SenhaExistenteSegura123!")
    if not u:
        u = Usuario(
            nome="Maria Existente",
            email=email,
            hashed_password=senha_original_hash,
            empresa_id=empresas_teste[0].id,
            is_active=True
        )
        session.add(u)
        session.commit()
        session.refresh(u)
    else:
        u.hashed_password = senha_original_hash
        session.add(u)
        session.commit()

    # Tenta convidar para a Empresa 2
    with patch("app.services.convite_usuario_service.enviar_email_convite_usuario", return_value=True) as mock_send:
        res = convidar_ou_vincular_usuario(
            db=session,
            email=email,
            nome="Maria Existente",
            empresa_ids=[empresas_teste[1].id],
            base_url="https://kyrustech.com.br"
        )
        assert res["status"] == "linked_existing"
        assert mock_send.called
        call_kwargs = mock_send.call_args.kwargs
        assert call_kwargs["is_existing_user"] is True
        assert "/login" in call_kwargs["link_acesso"]

    # Senha NÃO pode ter sido alterada
    session.refresh(u)
    assert verify_password("SenhaExistenteSegura123!", u.hashed_password)

    # Vínculo com Empresa 2 deve existir
    p2 = session.exec(
        select(UserCompanyProfile).where(
            UserCompanyProfile.usuario_id == u.id,
            UserCompanyProfile.empresa_id == empresas_teste[1].id
        )
    ).first()
    assert p2 is not None
    assert p2.is_active is True


def test_validar_e_completar_cadastro(session: Session, empresas_teste: list[Empresa]):
    raw_token = "meu_token_super_secreto_valido_123"
    token_hash = _compute_token_hash(raw_token)
    email = "onboarding.teste@kyrustech.com"

    u = Usuario(
        nome="Carlos Onboarding",
        email=email,
        hashed_password="temp",
        empresa_id=empresas_teste[0].id,
        is_active=True
    )
    session.add(u)
    session.commit()
    session.refresh(u)

    invite = UserInvite(
        usuario_id=u.id,
        email=email,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(hours=48),
        used=False
    )
    session.add(invite)
    session.commit()

    # 1. Validar token
    dados = validar_token_convite(session, token=raw_token)
    assert dados["valid"] is True
    assert dados["usuario"]["nome"] == "Carlos Onboarding"
    assert dados["usuario"]["email"] == email

    # 2. Completar cadastro
    user_final = completar_cadastro_convite(
        db=session,
        token=raw_token,
        nova_senha="MinhaNovaSenha@2026",
        foto_url="/static/uploads/usuarios/carlos.png"
    )
    assert user_final.id == u.id
    assert user_final.foto_url == "/static/uploads/usuarios/carlos.png"
    assert verify_password("MinhaNovaSenha@2026", user_final.hashed_password)

    # Convite deve ter sido marcado como used
    session.refresh(invite)
    assert invite.used is True

    # 3. Tentar reutilizar convite deve falhar
    with pytest.raises(HTTPException) as exc:
        validar_token_convite(session, token=raw_token)
    assert exc.value.status_code == 400
    assert "já foi utilizado" in exc.value.detail


def test_api_validar_e_completar_cadastro(client, session: Session, empresas_teste: list[Empresa]):
    raw_token = "token_api_teste_onboarding_456"
    token_hash = _compute_token_hash(raw_token)
    email = "ana.api@kyrustech.com"

    u = Usuario(
        nome="Ana API",
        email=email,
        hashed_password="temp",
        empresa_id=empresas_teste[0].id,
        is_active=True
    )
    session.add(u)
    session.commit()
    session.refresh(u)

    invite = UserInvite(
        usuario_id=u.id,
        email=email,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(hours=48),
        used=False
    )
    session.add(invite)
    session.commit()

    # 1. GET /api/v1/usuarios/convite/validar
    res_val = client.get(f"/api/v1/usuarios/convite/validar?token={raw_token}")
    assert res_val.status_code == 200
    data_val = res_val.json()
    assert data_val["valid"] is True
    assert data_val["usuario"]["nome"] == "Ana API"

    # 2. POST /api/v1/usuarios/convite/completar
    res_comp = client.post(
        "/api/v1/usuarios/convite/completar",
        json={
            "token": raw_token,
            "password": "NovaSenhaSegura2026!",
            "foto_url": None
        }
    )
    assert res_comp.status_code == 200
    data_comp = res_comp.json()
    assert "access_token" in data_comp
    assert data_comp["user"]["email"] == email

    # 3. GET validar novamente agora deve retornar erro 400
    res_val2 = client.get(f"/api/v1/usuarios/convite/validar?token={raw_token}")
    assert res_val2.status_code == 400
