# tests/test_confirmacao_email.py
from datetime import datetime, timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.security import get_password_hash
from app.models.usuario import Usuario
from app.models.email_verification_code import EmailVerificationCode
from app.services.confirmacao_email_service import (
    solicitar_codigo_confirmacao,
    validar_codigo_confirmacao,
    _compute_code_hash,
)


@pytest.fixture
def user_email_test(session: Session) -> Usuario:
    user = session.exec(select(Usuario).where(Usuario.email == "teste_email_conf@kyrustech.com")).first()
    if not user:
        user = Usuario(
            nome="Usuário Teste Confirmação",
            email="teste_email_conf@kyrustech.com",
            telefone="(11) 98765-4321",
            email_confirmado=False,
            hashed_password=get_password_hash("SenhaTeste123!"),
            is_active=True,
            empresa_id=1,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        user.email_confirmado = False
        user.telefone = "(11) 98765-4321"
        session.add(user)
        session.commit()
    return user


def test_solicitar_codigo_confirmacao_sucesso(session: Session, user_email_test: Usuario):
    with patch("app.services.confirmacao_email_service.enviar_codigo_confirmacao_email", return_value=True) as mock_send:
        res = solicitar_codigo_confirmacao(session, usuario=user_email_test, ip_address="127.0.0.1")
        assert res["ok"] is True
        assert res["email"] == user_email_test.email
        assert mock_send.called

        # Verifica persistência no banco
        registro = session.exec(
            select(EmailVerificationCode)
            .where(
                EmailVerificationCode.usuario_id == user_email_test.id,
                EmailVerificationCode.used == False,
            )
        ).first()
        assert registro is not None
        assert registro.attempts == 0
        assert registro.expires_at > datetime.utcnow()


def test_cooldown_confirmacao_email(session: Session, user_email_test: Usuario):
    with patch("app.services.confirmacao_email_service.enviar_codigo_confirmacao_email", return_value=True):
        solicitar_codigo_confirmacao(session, usuario=user_email_test)

        # Tentativa imediata deve lançar 429
        with pytest.raises(HTTPException) as exc_info:
            solicitar_codigo_confirmacao(session, usuario=user_email_test)
        assert exc_info.value.status_code == 429


def test_validar_codigo_incorreto_e_tentativas(session: Session, user_email_test: Usuario):
    with patch("app.services.confirmacao_email_service.enviar_codigo_confirmacao_email", return_value=True):
        solicitar_codigo_confirmacao(session, usuario=user_email_test)

        with pytest.raises(HTTPException) as exc_info:
            validar_codigo_confirmacao(session, usuario=user_email_test, codigo="000000")
        assert exc_info.value.status_code == 400
        assert "Código incorreto" in exc_info.value.detail


def test_validar_codigo_correto(session: Session, user_email_test: Usuario):
    # Insere manualmente um código conhecido
    codigo_valido = "654321"
    code_hash = _compute_code_hash(user_email_test.email, codigo_valido)
    registro = EmailVerificationCode(
        usuario_id=user_email_test.id,  # type: ignore
        email=user_email_test.email,
        code_hash=code_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=15),
        used=False,
        attempts=0,
    )
    session.add(registro)
    session.commit()

    res = validar_codigo_confirmacao(session, usuario=user_email_test, codigo=codigo_valido)
    assert res["ok"] is True
    session.refresh(user_email_test)
    assert user_email_test.email_confirmado is True
