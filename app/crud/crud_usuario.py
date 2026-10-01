from typing import Optional
from sqlmodel import Session, select
from app.core.security import get_password_hash, verify_password
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.schemas.usuario import UserCreate

def get_by_email(db: Session, *, email: str) -> Optional[Usuario]:
    statement = select(Usuario).where(Usuario.email == email.strip().lower())
    return db.exec(statement).first()


def _sync_consultor_empresa_access(db: Session, *, user: Usuario) -> None:
    from app.models.consultor_empresa import ConsultorEmpresa

    existing_links = db.exec(
        select(ConsultorEmpresa).where(ConsultorEmpresa.usuario_id == user.id)
    ).all()

    if not user.is_consultor:
        for link in existing_links:
            link.ativo = False
            db.add(link)
        db.commit()
        return

    if not user.empresa_id:
        db.commit()
        return

    target_link = next((link for link in existing_links if link.empresa_id == user.empresa_id), None)
    if target_link:
        target_link.ativo = True
        db.add(target_link)
    else:
        db.add(
            ConsultorEmpresa(
                usuario_id=user.id,
                empresa_id=user.empresa_id,
                ativo=True,
            )
        )

    for link in existing_links:
        if link.empresa_id != user.empresa_id:
            link.ativo = False
            db.add(link)

    db.commit()


def _can_reassign_existing_user(db: Session, *, user: Usuario) -> bool:
    if getattr(user, "is_deleted", False):
        return True

    if user.empresa_id is None:
        return True

    empresa = db.get(Empresa, user.empresa_id)
    return empresa is None or bool(getattr(empresa, "is_deleted", False))

def create_user(db: Session, *, user_in: UserCreate) -> Usuario:
    normalized_email = user_in.email.strip().lower()
    existing_user = get_by_email(db, email=normalized_email)
    hashed_password = get_password_hash(user_in.password)

    if existing_user:
        if not _can_reassign_existing_user(db, user=existing_user):
            raise ValueError("Já existe um login ativo com este e-mail. Desative ou altere o vínculo do usuário atual antes de reutilizá-lo.")

        existing_user.email = normalized_email
        existing_user.nome = user_in.nome
        existing_user.hashed_password = hashed_password
        existing_user.is_active = user_in.is_active
        existing_user.is_consultor = user_in.is_consultor
        existing_user.consultor_role = user_in.consultor_role
        existing_user.empresa_id = user_in.empresa_id
        existing_user.foto_url = user_in.foto_url
        existing_user.is_deleted = False
        existing_user.deleted_at = None
        existing_user.deleted_by_id = None

        db.add(existing_user)
        db.commit()
        db.refresh(existing_user)
        _sync_consultor_empresa_access(db, user=existing_user)
        db.refresh(existing_user)
        return existing_user

    user_data = user_in.model_dump(exclude={"password"})
    user_data["email"] = normalized_email
    user_data["hashed_password"] = hashed_password
    db_user = Usuario(**user_data)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    _sync_consultor_empresa_access(db, user=db_user)
    db.refresh(db_user)
    return db_user

def authenticate_user(db: Session, *, email: str, password: str) -> Optional[Usuario]:
    user = get_by_email(db, email=email)
    if not user or not verify_password(password, user.hashed_password):
        return None
    if getattr(user, "is_service_account", False):
        return None
    if not user.is_active or getattr(user, "is_deleted", False):
        return None
    return user