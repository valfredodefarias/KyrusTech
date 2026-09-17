# app/services/convite_usuario_service.py
from datetime import datetime, timedelta
import hashlib
import secrets
from typing import List, Optional

from fastapi import HTTPException, status
from loguru import logger
from sqlmodel import Session, select

from app.core.security import get_password_hash
from app.core.login_throttle import clear_login_failures
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.user_invite import UserInvite
from app.models.user_company_profile import UserCompanyProfile
from app.models.consultor_empresa import ConsultorEmpresa
from app.services.email_service import enviar_email_convite_usuario

TOKEN_EXPIRATION_HOURS = 48


def _compute_token_hash(token: str) -> str:
    """Calcula o hash SHA-256 do token para armazenamento seguro no banco."""
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def verificar_email_usuario(db: Session, email: str) -> dict:
    """
    Verifica se um e-mail já existe no KyrusERP.
    Retorna os dados do usuário e as empresas às quais ele já possui acesso.
    """
    normalized_email = email.strip().lower()
    user = db.exec(
        select(Usuario).where(
            Usuario.email == normalized_email,
            Usuario.is_deleted == False
        )
    ).first()

    if not user:
        return {"exists": False, "usuario": None, "empresas": []}

    # Busca as empresas às quais ele já está associado
    profiles = db.exec(
        select(UserCompanyProfile)
        .where(
            UserCompanyProfile.usuario_id == user.id,
            UserCompanyProfile.is_active == True,
            UserCompanyProfile.is_deleted == False
        )
    ).all()

    emp_ids = set(p.empresa_id for p in profiles)
    if user.empresa_id:
        emp_ids.add(user.empresa_id)

    consultor_links = db.exec(
        select(ConsultorEmpresa)
        .where(
            ConsultorEmpresa.usuario_id == user.id,
            ConsultorEmpresa.ativo == True
        )
    ).all()
    for cl in consultor_links:
        emp_ids.add(cl.empresa_id)

    empresas_existentes = []
    if emp_ids:
        emps = db.exec(
            select(Empresa).where(Empresa.id.in_(list(emp_ids)), Empresa.is_deleted == False)
        ).all()
        empresas_existentes = [
            {"id": e.id, "nome_fantasia": e.nome_fantasia or e.razao_social}
            for e in emps
        ]

    return {
        "exists": True,
        "usuario": {
            "id": user.id,
            "nome": user.nome,
            "email": user.email,
            "is_active": user.is_active,
        },
        "empresas": empresas_existentes,
    }


def convidar_ou_vincular_usuario(
    db: Session,
    email: str,
    nome: Optional[str],
    empresa_ids: List[int],
    profile_id: Optional[int] = None,
    base_url: str = "https://kyrustech.com.br",
    is_consultor: bool = False,
    consultor_role: str = "USUARIO_NORMAL",
) -> dict:
    """
    Cadastra novo usuário por convite OU adiciona novas empresas a um usuário existente.
    Dispara o e-mail estilizado apropriado.
    """
    normalized_email = email.strip().lower()
    if not normalized_email or "@" not in normalized_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-mail inválido.")

    if not empresa_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecione ao menos uma empresa para conceder acesso.")

    # Validar se as empresas existem
    empresas = db.exec(
        select(Empresa).where(Empresa.id.in_(empresa_ids), Empresa.is_deleted == False)
    ).all()
    if not empresas:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nenhuma das empresas selecionadas foi encontrada.")

    empresas_nomes = [e.nome_fantasia or e.razao_social for e in empresas]

    existing_user = db.exec(
        select(Usuario).where(
            Usuario.email == normalized_email,
            Usuario.is_deleted == False
        )
    ).first()

    # CASO 1: Usuário já existente no KyrusERP
    if existing_user:
        novas_vinculadas = 0
        for emp_id in empresa_ids:
            # Verifica se já tem vínculo em UserCompanyProfile
            profile_link = db.exec(
                select(UserCompanyProfile)
                .where(
                    UserCompanyProfile.usuario_id == existing_user.id,
                    UserCompanyProfile.empresa_id == emp_id
                )
            ).first()

            if profile_link:
                profile_link.is_active = True
                profile_link.is_deleted = False
                if profile_id:
                    profile_link.profile_id = profile_id
                db.add(profile_link)
            else:
                novo_link = UserCompanyProfile(
                    usuario_id=existing_user.id,
                    empresa_id=emp_id,
                    profile_id=profile_id or 1,
                    is_active=True
                )
                db.add(novo_link)
                novas_vinculadas += 1

            # Se for consultor, adiciona também em ConsultorEmpresa
            if existing_user.is_consultor:
                c_link = db.exec(
                    select(ConsultorEmpresa)
                    .where(
                        ConsultorEmpresa.usuario_id == existing_user.id,
                        ConsultorEmpresa.empresa_id == emp_id
                    )
                ).first()
                if c_link:
                    c_link.ativo = True
                    db.add(c_link)
                else:
                    db.add(ConsultorEmpresa(usuario_id=existing_user.id, empresa_id=emp_id, ativo=True))

        # Se o usuário não tinha empresa principal definida, atribui a primeira
        if not existing_user.empresa_id:
            existing_user.empresa_id = empresa_ids[0]
            db.add(existing_user)

        if is_consultor:
            existing_user.is_consultor = True
            existing_user.consultor_role = consultor_role
            db.add(existing_user)

        db.commit()

        # Envia e-mail notificando o novo acesso liberado
        link_login = f"{base_url.rstrip('/')}/login"
        enviar_email_convite_usuario(
            email=normalized_email,
            link_acesso=link_login,
            nome=existing_user.nome,
            empresas_nomes=empresas_nomes,
            is_existing_user=True,
        )

        logger.info(f"[ConviteUsuario] Empresas vinculadas ao usuário existente: {normalized_email} -> {empresas_nomes}")
        return {
            "status": "linked_existing",
            "message": f"Usuário '{existing_user.nome or existing_user.email}' já existente. Acesso liberado para as empresas selecionadas e notificação enviada por e-mail!",
            "usuario_id": existing_user.id,
        }

    # CASO 2: Novo usuário (Fluxo de Convite)
    if not nome or not nome.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nome completo é obrigatório para cadastrar um novo usuário.")

    # Gera uma senha aleatória provisória segura (o usuário definirá a sua no link de convite)
    temp_password_hash = get_password_hash(secrets.token_urlsafe(32))

    novo_usuario = Usuario(
        nome=nome.strip(),
        email=normalized_email,
        hashed_password=temp_password_hash,
        is_active=True,
        is_consultor=is_consultor,
        consultor_role=consultor_role if is_consultor else "USUARIO_NORMAL",
        empresa_id=empresa_ids[0] if empresa_ids else None,
    )
    db.add(novo_usuario)
    db.commit()
    db.refresh(novo_usuario)

    # Vincula o usuário a todas as empresas selecionadas
    for emp_id in empresa_ids:
        db.add(
            UserCompanyProfile(
                usuario_id=novo_usuario.id,
                empresa_id=emp_id,
                profile_id=profile_id or 1,
                is_active=True
            )
        )

    # Invalida convites anteriores pendentes para o mesmo e-mail
    convites_antigos = db.exec(
        select(UserInvite).where(UserInvite.email == normalized_email, UserInvite.used == False)
    ).all()
    for c in convites_antigos:
        c.used = True
        db.add(c)

    # Gera token único de convite
    raw_token = secrets.token_urlsafe(32)
    token_hash = _compute_token_hash(raw_token)
    expires_at = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRATION_HOURS)

    convite = UserInvite(
        usuario_id=novo_usuario.id,
        email=normalized_email,
        token_hash=token_hash,
        expires_at=expires_at,
        used=False,
    )
    db.add(convite)
    db.commit()

    # Dispara e-mail de convite com link seguro para completar o cadastro
    link_convite = f"{base_url.rstrip('/')}/completar-cadastro?token={raw_token}"
    email_ok = enviar_email_convite_usuario(
        email=normalized_email,
        link_acesso=link_convite,
        nome=novo_usuario.nome,
        empresas_nomes=empresas_nomes,
        is_existing_user=False,
    )

    logger.info(f"[ConviteUsuario] Novo usuário convidado: {normalized_email} (ID {novo_usuario.id}) | Email disparado: {email_ok}")
    return {
        "status": "invited_new",
        "message": f"Convite de acesso enviado com sucesso para {normalized_email}!",
        "usuario_id": novo_usuario.id,
    }


def validar_token_convite(db: Session, token: str) -> dict:
    """Valida se o token de convite é autêntico, não expirou e não foi utilizado."""
    if not token or not token.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token de convite não informado.")

    token_hash = _compute_token_hash(token)
    convite = db.exec(
        select(UserInvite).where(UserInvite.token_hash == token_hash)
    ).first()

    if not convite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Convite inválido ou não encontrado.")

    if convite.used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este convite já foi utilizado para ativar a conta. Por favor, acerte seu login."
        )

    if convite.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este link de convite expirou (validade de 48h). Solicite um novo convite ao administrador."
        )

    user = db.get(Usuario, convite.usuario_id)
    if not user or user.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário associado ao convite não foi localizado.")

    # Empresas vinculadas
    profiles = db.exec(
        select(UserCompanyProfile)
        .where(
            UserCompanyProfile.usuario_id == user.id,
            UserCompanyProfile.is_active == True,
            UserCompanyProfile.is_deleted == False
        )
    ).all()
    emp_ids = list(set([p.empresa_id for p in profiles] + ([user.empresa_id] if user.empresa_id else [])))
    
    empresas = []
    if emp_ids:
        emps = db.exec(select(Empresa).where(Empresa.id.in_(emp_ids), Empresa.is_deleted == False)).all()
        empresas = [{"id": e.id, "nome_fantasia": e.nome_fantasia or e.razao_social, "logo_url": e.logo_url} for e in emps]

    return {
        "valid": True,
        "usuario": {
            "id": user.id,
            "nome": user.nome,
            "email": user.email,
            "foto_url": user.foto_url,
        },
        "empresas": empresas,
    }


def completar_cadastro_convite(
    db: Session,
    token: str,
    nova_senha: str,
    foto_url: Optional[str] = None
) -> Usuario:
    """
    Conclui o onboarding: define a senha pessoal definitiva, salva a foto e invalida o convite.
    """
    validacao = validar_token_convite(db=db, token=token)
    user_id = validacao["usuario"]["id"]

    if not nova_senha or len(nova_senha) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A senha deve ter no mínimo 6 caracteres."
        )

    user = db.get(Usuario, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")

    token_hash = _compute_token_hash(token)
    convite = db.exec(select(UserInvite).where(UserInvite.token_hash == token_hash)).first()
    if convite:
        convite.used = True
        db.add(convite)

    user.hashed_password = get_password_hash(nova_senha)
    if foto_url:
        user.foto_url = foto_url
    user.is_active = True

    db.add(user)
    db.commit()
    db.refresh(user)

    clear_login_failures(email=user.email)
    logger.success(f"[ConviteUsuario] Cadastro concluído com sucesso para: {user.email}")
    return user
