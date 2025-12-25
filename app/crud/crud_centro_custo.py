# app/crud/crud_centro_custo.py
from typing import Sequence, Optional
from sqlmodel import Session, select

# Ajuste os imports abaixo conforme onde você salvou o Model e o Schema
from app.models.centro_custo import CentroCusto
from app.schemas.centro_custo import CentroCustoCreate, CentroCustoUpdate

def get_multi(
    db: Session, 
    empresa_id: int, 
    skip: int = 0, 
    limit: int = 100
) -> Sequence[CentroCusto]:
    """
    Lista centros de custo filtrando pela empresa.
    Retorna uma Sequence para satisfazer a tipagem estrita do SQLModel.
    """
    statement = (
        select(CentroCusto)
        .where(CentroCusto.empresa_id == empresa_id)
        .offset(skip)
        .limit(limit)
    )
    return db.exec(statement).all()

def create(
    db: Session, 
    obj_in: CentroCustoCreate, 
    empresa_id: int
) -> CentroCusto:
    """Cria um novo centro de custo vinculado à empresa."""
    # O update={"empresa_id": ...} garante que o ID da empresa seja injetado
    # mesmo que não venha no corpo da requisição do front-end
    db_obj = CentroCusto.model_validate(obj_in, update={"empresa_id": empresa_id})
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def update(
    db: Session, 
    id: int, 
    obj_in: CentroCustoUpdate, 
    empresa_id: int
) -> Optional[CentroCusto]:
    """Atualiza um centro de custo existente."""
    db_obj = db.get(CentroCusto, id)
    
    # Segurança: Verifica se existe e se pertence à empresa do usuário
    if not db_obj or db_obj.empresa_id != empresa_id:
        return None
    
    # Atualiza apenas os campos enviados (exclude_unset=True)
    obj_data = obj_in.model_dump(exclude_unset=True)
    
    for key, value in obj_data.items():
        setattr(db_obj, key, value)
        
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(
    db: Session, 
    id: int, 
    empresa_id: int
) -> Optional[CentroCusto]:
    """Remove um centro de custo."""
    db_obj = db.get(CentroCusto, id)
    
    # Segurança: Verifica propriedade antes de deletar
    if not db_obj or db_obj.empresa_id != empresa_id:
        return None
    
    db.delete(db_obj)
    db.commit()
    return db_obj