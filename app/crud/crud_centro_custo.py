# app/crud/crud_centro_custo.py
from typing import List, Optional
from sqlmodel import Session, select
from app.models.centro_custo import CentroCusto
from app.schemas.centro_custo import CentroCustoCreate, CentroCustoUpdate

def get_multi(db: Session, *, empresa_id: int) -> List[CentroCusto]:
    statement = select(CentroCusto).where(CentroCusto.empresa_id == empresa_id).order_by(CentroCusto.nome)
    return list(db.exec(statement).all())

def create(db: Session, *, obj_in: CentroCustoCreate, empresa_id: int) -> CentroCusto:
    db_obj = CentroCusto.model_validate(obj_in, update={"empresa_id": empresa_id})
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

# (No futuro, podemos adicionar 'get', 'update' e 'delete' aqui se necessário)