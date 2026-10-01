# app/services/recuperacao_senha_service.py
from datetime import datetime, timedelta
import hashlib
import secrets
from typing import Optional

from fastapi import HTTPException, status
from loguru import logger
from sqlmodel import Session, select

from app.core.security import get_password_hash
from app.core.login_throttle import clear_login_failures
from app.models.usuario import Usuario
from app.models.user_session import UserSession
from app.models.password_reset_code import PasswordResetCode
from app.schemas.recuperacao_senha import PasswordResetMessageResponse
from app.services.email_service import enviar_codigo_recuperacao_senha

EXPIRATION_MINUTES = 15
MAX_ATTEMPTS = 5
COOLDOWN_SECONDS = 45


def _compute_code_hash(email: str, code: str) -> str:
    """Gera hash SHA-256 seguro associando o e-mail ao código."""
    normalized_email = email.strip().lower()
    normalized_code = code.strip()
    return hashlib.sha256(f"{normalized_email}:{normalized_code}".encode("utf-8")).hexdigest()


def solicitar_codigo_recuperacao(
    db: Session,
    email: str,
    ip_address: Optional[str] = None
) -> PasswordResetMessageResponse:
    """
    Solicita o envio de um código de 6 dígitos para o e-mail do usuário.
    Segue padrões OWASP para evitar enumeração de usuários.
    """
    normalized_email = email.strip().lower()
    user = db.exec(
        select(Usuario).where(
            Usuario.email == normalized_email,
            Usuario.is_active == True,
            Usuario.is_service_account == False,
        )
    ).first()

    # Resposta genérica mesmo se o e-mail não existir (boa prática de segurança)
    generic_success_msg = "Se este e-mail estiver cadastrado no sistema, você receberá um código de verificação em instantes."

    if not user:
        logger.info(f"[RecuperacaoSenha] Tentativa de recuperação para e-mail inexistente ou inativo: {normalized_email}")
        return PasswordResetMessageResponse(ok=True, message=generic_success_msg)

    # 1. Cooldown para evitar envio em massa (spam de cliques)
    agora = datetime.utcnow()
    ultimo_codigo = db.exec(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.email == normalized_email,
            PasswordResetCode.used == False
        )
        .order_by(PasswordResetCode.id.desc()) # type: ignore
    ).first()

    if ultimo_codigo and (agora - ultimo_codigo.created_at).total_seconds() < COOLDOWN_SECONDS:
        segundos_restantes = int(COOLDOWN_SECONDS - (agora - ultimo_codigo.created_at).total_seconds())
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Aguarde {segundos_restantes} segundos antes de solicitar um novo código."
        )

    # 2. Invalida códigos anteriores não utilizados
    anteriores = db.exec(
        select(PasswordResetCode).where(
            PasswordResetCode.email == normalized_email,
            PasswordResetCode.used == False
        )
    ).all()
    for reg in anteriores:
        reg.used = True
        db.add(reg)

    # 3. Gera código de 6 dígitos numéricos aleatório criptograficamente seguro
    codigo = f"{secrets.randbelow(1000000):06d}"
    code_hash = _compute_code_hash(normalized_email, codigo)
    expires_at = agora + timedelta(minutes=EXPIRATION_MINUTES)

    novo_registro = PasswordResetCode(
        email=normalized_email,
        code_hash=code_hash,
        expires_at=expires_at,
        used=False,
        attempts=0,
        ip_address=ip_address,
        created_at=agora,
    )
    db.add(novo_registro)
    db.commit()

    # 4. Dispara e-mail via Resend
    enviado = enviar_codigo_recuperacao_senha(
        email=normalized_email,
        codigo=codigo,
        nome=user.nome
    )

    if not enviado:
        logger.error(f"[RecuperacaoSenha] Falha ao enviar e-mail com código para {normalized_email}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível enviar o e-mail de recuperação neste momento. Verifique as credenciais do provedor de e-mail."
        )

    logger.info(f"[RecuperacaoSenha] Código gerado e despachado com sucesso para {normalized_email}")
    return PasswordResetMessageResponse(ok=True, message=generic_success_msg)


def validar_codigo_recuperacao(
    db: Session,
    email: str,
    code: str
) -> PasswordResetCode:
    """Valida o código de 6 dígitos fornecido contra o banco."""
    normalized_email = email.strip().lower()
    normalized_code = code.strip()
    agora = datetime.utcnow()

    registro = db.exec(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.email == normalized_email,
            PasswordResetCode.used == False,
            PasswordResetCode.expires_at > agora
        )
        .order_by(PasswordResetCode.id.desc()) # type: ignore
    ).first()

    if not registro:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificação inválido ou expirado. Solicite um novo."
        )

    # Limite de tentativas para evitar brute-force
    if registro.attempts >= MAX_ATTEMPTS:
        registro.used = True
        db.add(registro)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Número máximo de tentativas incorretas excedido. Solicite um novo código."
        )

    expected_hash = _compute_code_hash(normalized_email, normalized_code)
    if registro.code_hash != expected_hash:
        registro.attempts += 1
        db.add(registro)
        db.commit()
        tentativas_restantes = MAX_ATTEMPTS - registro.attempts
        msg = f"Código incorreto. Você tem mais {tentativas_restantes} tentativa(s)." if tentativas_restantes > 0 else "Código incorreto. Limite excedido."
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)

    return registro


def redefinir_senha(
    db: Session,
    email: str,
    code: str,
    new_password: str
) -> PasswordResetMessageResponse:
    """Valida o código e grava a nova senha criptografada do usuário."""
    normalized_email = email.strip().lower()
    
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A nova senha deve conter pelo menos 6 caracteres."
        )

    # 1. Valida o código
    registro = validar_codigo_recuperacao(db, normalized_email, code)

    # 2. Busca o usuário
    user = db.exec(
        select(Usuario).where(
            Usuario.email == normalized_email,
            Usuario.is_active == True,
            Usuario.is_service_account == False,
        )
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado ou inativo."
        )

    # 3. Atualiza a senha
    user.hashed_password = get_password_hash(new_password)
    db.add(user)

    # 4. Invalida o código utilizado
    registro.used = True
    db.add(registro)

    # 5. Invalida todas as sessões anteriores ativas por segurança
    active_sessions = db.exec(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.is_active == True
        )
    ).all()
    for s in active_sessions:
        s.is_active = False
        db.add(s)

    db.commit()

    # 6. Limpa tentativas de login falhas
    clear_login_failures(email=normalized_email)

    logger.info(f"[RecuperacaoSenha] Senha redefinida com sucesso para o usuário {normalized_email}")
    return PasswordResetMessageResponse(
        ok=True,
        message="Sua senha foi redefinida com sucesso! Você já pode entrar com a sua nova senha."
    )
