# app/services/confirmacao_email_service.py
from datetime import datetime, timedelta
import hashlib
import secrets
from typing import Optional

from fastapi import HTTPException, status
from loguru import logger
from sqlmodel import Session, select

from app.models.usuario import Usuario
from app.models.email_verification_code import EmailVerificationCode
from app.services.email_service import enviar_codigo_confirmacao_email

EXPIRATION_MINUTES = 15
MAX_ATTEMPTS = 5
COOLDOWN_SECONDS = 45


def _compute_code_hash(email: str, code: str) -> str:
    """Gera hash SHA-256 seguro associando o e-mail ao código."""
    normalized_email = email.strip().lower()
    normalized_code = code.strip()
    return hashlib.sha256(f"{normalized_email}:{normalized_code}".encode("utf-8")).hexdigest()


def solicitar_codigo_confirmacao(
    db: Session,
    usuario: Usuario,
    ip_address: Optional[str] = None
) -> dict:
    """
    Gera e envia um código de 6 dígitos para o e-mail do usuário para validação.
    Aplica cooldown de 45s e invalida códigos anteriores não utilizados.
    """
    normalized_email = usuario.email.strip().lower()

    agora = datetime.utcnow()

    # 1. Cooldown de envio
    ultimo_codigo = db.exec(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.usuario_id == usuario.id,
            EmailVerificationCode.used == False
        )
        .order_by(EmailVerificationCode.id.desc())  # type: ignore
    ).first()

    if ultimo_codigo and (agora - ultimo_codigo.created_at).total_seconds() < COOLDOWN_SECONDS:
        segundos_restantes = int(COOLDOWN_SECONDS - (agora - ultimo_codigo.created_at).total_seconds())
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Aguarde {segundos_restantes} segundos antes de solicitar um novo código."
        )

    # 2. Invalida códigos anteriores não utilizados
    anteriores = db.exec(
        select(EmailVerificationCode).where(
            EmailVerificationCode.usuario_id == usuario.id,
            EmailVerificationCode.used == False
        )
    ).all()
    for reg in anteriores:
        reg.used = True
        db.add(reg)

    # 3. Gera código numérico de 6 dígitos criptograficamente seguro
    codigo = f"{secrets.randbelow(1000000):06d}"
    code_hash = _compute_code_hash(normalized_email, codigo)
    expires_at = agora + timedelta(minutes=EXPIRATION_MINUTES)

    novo_registro = EmailVerificationCode(
        usuario_id=usuario.id,  # type: ignore
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

    # 4. Despacha o e-mail via EmailService
    enviar_codigo_confirmacao_email(
        email=normalized_email,
        codigo=codigo,
        nome=usuario.nome
    )

    logger.info(f"[ConfirmacaoEmail] Código gerado e despachado para usuário ID {usuario.id} ({normalized_email})")
    return {
        "ok": True,
        "message": f"Código de confirmação de 6 dígitos enviado para {normalized_email}.",
        "email": normalized_email,
    }


def validar_codigo_confirmacao(
    db: Session,
    usuario: Usuario,
    codigo: str
) -> dict:
    """
    Valida o código de 6 dígitos fornecido pelo usuário e confirma o e-mail na conta.
    """
    normalized_email = usuario.email.strip().lower()
    normalized_code = codigo.strip()

    if not normalized_code or len(normalized_code) != 6 or not normalized_code.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de verificação inválido. Forneça o código numérico de 6 dígitos."
        )

    registro = db.exec(
        select(EmailVerificationCode)
        .where(
            EmailVerificationCode.usuario_id == usuario.id,
            EmailVerificationCode.used == False,
        )
        .order_by(EmailVerificationCode.id.desc())  # type: ignore
    ).first()

    if not registro:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhum código ativo encontrado para este usuário. Solicite um novo código."
        )

    agora = datetime.utcnow()

    # 1. Verifica expiração
    if agora > registro.expires_at:
        registro.used = True
        db.add(registro)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este código de confirmação expirou. Solicite um novo código."
        )

    # 2. Verifica limite de tentativas
    if registro.attempts >= MAX_ATTEMPTS:
        registro.used = True
        db.add(registro)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Limite de tentativas excedido para este código. Solicite um novo código."
        )

    # 3. Compara Hash
    expected_hash = _compute_code_hash(normalized_email, normalized_code)
    if not secrets.compare_digest(registro.code_hash, expected_hash):
        registro.attempts += 1
        tentativas_restantes = MAX_ATTEMPTS - registro.attempts
        db.add(registro)
        db.commit()

        if tentativas_restantes <= 0:
            registro.used = True
            db.add(registro)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Código incorreto. Limite de tentativas atingido. Solicite um novo código."
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Código incorreto. Você tem mais {tentativas_restantes} tentativa(s)."
        )

    # 4. Código válido: confirma e-mail do usuário
    registro.used = True
    usuario.email_confirmado = True
    db.add(registro)
    db.add(usuario)
    db.commit()
    db.refresh(usuario)

    logger.success(f"[ConfirmacaoEmail] E-mail {normalized_email} confirmado com sucesso para usuário ID {usuario.id}")
    return {
        "ok": True,
        "message": "E-mail confirmado com sucesso!",
    }
