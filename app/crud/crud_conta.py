# app/crud/crud_conta.py

from datetime import datetime
from typing import List, Optional
from sqlmodel import Session, select
from app.models.conta import Conta
from app.schemas.conta import ContaCreate, ContaUpdate

def get_by_empresa(db: Session, *, empresa_id: int) -> List[Conta]:
    statement = select(Conta).where(
        Conta.empresa_id == empresa_id,
        Conta.is_deleted == False
    )
    return list(db.exec(statement).all())

def get_by_id(db: Session, *, id: int, empresa_id: int) -> Optional[Conta]:
    statement = select(Conta).where(
        Conta.id == id,
        Conta.empresa_id == empresa_id,
        Conta.is_deleted == False
    )
    return db.exec(statement).first()

def create(db: Session, *, obj_in: ContaCreate, empresa_id: int) -> Conta:
    data = obj_in.model_dump(exclude={"allowed_user_ids"})
    data["empresa_id"] = empresa_id
    db_obj = Conta.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update(db: Session, *, db_obj: Conta, obj_in: ContaUpdate) -> Conta:
    update_data = obj_in.model_dump(exclude_unset=True, exclude={"allowed_user_ids"})
    for key, value in update_data.items():
        setattr(db_obj, key, value)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[Conta]:
    db_obj = get_by_id(db=db, id=id, empresa_id=empresa_id)
    if db_obj:
        db_obj.is_deleted = True
        db_obj.deleted_at = datetime.utcnow()
        db.add(db_obj)
        db.commit()
    return db_obj
