# tests/test_recuperacao_senha.py
from datetime import datetime, timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.security import get_password_hash, verify_password
from app.models.usuario import Usuario
from app.models.password_reset_code import PasswordResetCode
from app.models.user_session import UserSession
from app.services.recuperacao_senha_service import (
    solicitar_codigo_recuperacao,
    validar_codigo_recuperacao,
    redefinir_senha,
    _compute_code_hash,
)


@pytest.fixture
def user_test(session: Session) -> Usuario:
    user = session.exec(select(Usuario).where(Usuario.email == "teste_reset@kyrustech.com")).first()
    if not user:
        user = Usuario(
            nome="Usuário Teste",
            email="teste_reset@kyrustech.com",
            hashed_password=get_password_hash("SenhaAntiga123!"),
            is_active=True,
            empresa_id=1,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        user.hashed_password = get_password_hash("SenhaAntiga123!")
        user.is_active = True
        session.add(user)
        session.commit()
    return user


def test_solicitar_codigo_para_usuario_existente(session: Session, user_test: Usuario):
    with patch("app.services.recuperacao_senha_service.enviar_codigo_recuperacao_senha", return_value=True) as mock_send:
        res = solicitar_codigo_recuperacao(session, email=user_test.email, ip_address="127.0.0.1")
        assert res.ok is True
        assert mock_send.called
        
        # Verifica se o código foi gravado no banco
        registro = session.exec(
            select(PasswordResetCode)
            .where(PasswordResetCode.email == user_test.email, PasswordResetCode.used == False)
        ).first()
        assert registro is not None
        assert registro.attempts == 0
        assert registro.expires_at > datetime.utcnow()


def test_solicitar_codigo_para_usuario_inexistente(session: Session):
    with patch("app.services.recuperacao_senha_service.enviar_codigo_recuperacao_senha") as mock_send:
        res = solicitar_codigo_recuperacao(session, email="naoexiste_xyz123@kyrustech.com")
        assert res.ok is True
        # Não deve enviar e-mail nem vazar erro
        assert not mock_send.called


def test_cooldown_solicitacao_codigo(session: Session, user_test: Usuario):
    with patch("app.services.recuperacao_senha_service.enviar_codigo_recuperacao_senha", return_value=True):
        # 1ª solicitação
        solicitar_codigo_recuperacao(session, email=user_test.email)
        
        # 2ª solicitação imediata deve falhar com 429
        with pytest.raises(HTTPException) as exc_info:
            solicitar_codigo_recuperacao(session, email=user_test.email)
        assert exc_info.value.status_code == 429


def test_tentativa_com_codigo_incorreto(session: Session, user_test: Usuario):
    # Cria registro manual
    code_hash = _compute_code_hash(user_test.email, "123456")
    reg = PasswordResetCode(
        email=user_test.email,
        code_hash=code_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=15),
        used=False,
        attempts=0,
    )
    session.add(reg)
    session.commit()

    with pytest.raises(HTTPException) as exc_info:
        validar_codigo_recuperacao(session, email=user_test.email, code="999999")
    assert exc_info.value.status_code == 400
    
    session.refresh(reg)
    assert reg.attempts == 1


def test_redefinir_senha_com_sucesso(session: Session, user_test: Usuario):
    # Cria sessão ativa antiga
    sess_antiga = UserSession(
        user_id=user_test.id,
        session_id="sess_old_123",
        is_active=True,
    )
    session.add(sess_antiga)
    session.commit()

    code_hash = _compute_code_hash(user_test.email, "654321")
    reg = PasswordResetCode(
        email=user_test.email,
        code_hash=code_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=15),
        used=False,
        attempts=0,
    )
    session.add(reg)
    session.commit()

    res = redefinir_senha(
        session,
        email=user_test.email,
        code="654321",
        new_password="NovaSenhaForte2026@"
    )
    assert res.ok is True

    # Verifica se a senha foi atualizada no usuário
    session.refresh(user_test)
    assert verify_password("NovaSenhaForte2026@", user_test.hashed_password) is True

    # Verifica se o código foi marcado como usado
    session.refresh(reg)
    assert reg.used is True

    # Verifica se a sessão antiga foi inativada
    session.refresh(sess_antiga)
    assert sess_antiga.is_active is False
