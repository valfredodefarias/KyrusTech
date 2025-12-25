from typing import Optional
from sqlmodel import Session
from app.models.empresa import Empresa
from app.schemas.empresa import EmpresaCreate, EmpresaUpdate
from app.crud.crud_plano_contas import seed_plano_contas_padrao

def create_empresa(db: Session, *, empresa_in: EmpresaCreate) -> Empresa:
    db_empresa = Empresa.model_validate(empresa_in)
    db.add(db_empresa)
    db.commit()
    db.refresh(db_empresa)
    
    if db_empresa.id:
        seed_plano_contas_padrao(db=db, empresa_id=db_empresa.id)
        db.commit()
        
    return db_empresa

def get_empresa(db: Session, id: int) -> Optional[Empresa]:
    return db.get(Empresa, id)

def update_empresa(db: Session, *, db_obj: Empresa, obj_in: EmpresaUpdate) -> Empresa:
    empresa_data = obj_in.model_dump(exclude_unset=True)
    for key, value in empresa_data.items():
        setattr(db_obj, key, value)
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj