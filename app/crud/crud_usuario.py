from typing import Optional
from sqlmodel import Session, select
from app.core.security import get_password_hash, verify_password
from app.models.usuario import Usuario
from app.schemas.usuario import UserCreate

def get_by_email(db: Session, *, email: str) -> Optional[Usuario]:
    statement = select(Usuario).where(Usuario.email == email)
    return db.exec(statement).first()

def create_user(db: Session, *, user_in: UserCreate) -> Usuario:
    hashed_password = get_password_hash(user_in.password)
    user_data = user_in.model_dump(exclude={"password"})
    user_data["hashed_password"] = hashed_password
    db_user = Usuario(**user_data)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    
    # Se for consultor e tiver empresa_id, vincular via ConsultorEmpresa
    if db_user.is_consultor and db_user.empresa_id:
        from app.models.consultor_empresa import ConsultorEmpresa
        ce = ConsultorEmpresa(
            usuario_id=db_user.id,
            empresa_id=db_user.empresa_id,
            ativo=True
        )
        db.add(ce)
        db.commit()
    
    return db_user

def authenticate_user(db: Session, *, email: str, password: str) -> Optional[Usuario]:
    user = get_by_email(db, email=email)
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user