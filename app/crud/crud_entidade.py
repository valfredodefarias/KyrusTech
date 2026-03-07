# app/crud/crud_entidade.py
from typing import List, Optional
from sqlmodel import Session, select
from app.models.entidade import Entidade
from app.schemas.entidade import EntidadeCreate, EntidadeUpdate
from app.crud.crud_centro_custo import ensure_centro_custo_principal


def _apply_model_update(db_obj, update_data: dict) -> None:
    if hasattr(db_obj, "sqlmodel_update"):
        db_obj.sqlmodel_update(update_data)
        return
    for campo, valor in update_data.items():
        setattr(db_obj, campo, valor)

def get_multi(db: Session, *, empresa_id: int) -> List[Entidade]:
    statement = select(Entidade).where(Entidade.empresa_id == empresa_id).order_by(Entidade.nome)
    return list(db.exec(statement).all())

def get_by_id(db: Session, *, id: int, empresa_id: int) -> Optional[Entidade]:
    statement = select(Entidade).where(Entidade.id == id, Entidade.empresa_id == empresa_id)
    return db.exec(statement).first()

def create(db: Session, *, obj_in: EntidadeCreate, empresa_id: int) -> Entidade:
    data = obj_in.model_dump()
    data["empresa_id"] = empresa_id
    db_obj = Entidade.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)

    # Quando a entidade for pessoa fisica, garante o centro padrao da empresa.
    tipo = str(db_obj.tipo or "").strip().upper()
    if tipo in {"PESSOA_FISICA", "PF"}:
        ensure_centro_custo_principal(db=db, empresa_id=empresa_id)

    return db_obj

def update(db: Session, *, id: int, obj_in: EntidadeUpdate, empresa_id: int) -> Optional[Entidade]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if not db_obj:
        return None
    update_data = obj_in.model_dump(exclude_unset=True)
    _apply_model_update(db_obj, update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[Entidade]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj