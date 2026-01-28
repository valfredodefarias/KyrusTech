# app/crud/crud_cartao.py
from typing import List, Optional
from sqlmodel import Session, select
from app.models.cartao import Cartao
from app.schemas.cartao import CartaoCreate, CartaoUpdate

def get_multi(db: Session, *, empresa_id: int) -> List[Cartao]:
    statement = select(Cartao).where(Cartao.empresa_id == empresa_id).order_by(Cartao.nome_cartao)
    return list(db.exec(statement).all())

def get_by_id(db: Session, *, id: int, empresa_id: int) -> Optional[Cartao]:
    statement = select(Cartao).where(Cartao.id == id, Cartao.empresa_id == empresa_id)
    return db.exec(statement).first()

def create(db: Session, *, obj_in: CartaoCreate, empresa_id: int) -> Cartao:
    data = obj_in.model_dump()
    data["empresa_id"] = empresa_id
    db_obj = Cartao.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update(db: Session, *, id: int, obj_in: CartaoUpdate, empresa_id: int) -> Optional[Cartao]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if not db_obj:
        return None
    update_data = obj_in.model_dump(exclude_unset=True)
    db_obj.sqlmodel_update(update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[Cartao]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj