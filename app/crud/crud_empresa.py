from sqlmodel import Session
from app.models.empresa import Empresa
from app.schemas.empresa import EmpresaCreate
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