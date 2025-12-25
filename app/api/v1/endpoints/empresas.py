from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
from app.crud.crud_empresa import create_empresa, get_empresa, update_empresa
from app.schemas.empresa import EmpresaCreate, EmpresaRead, EmpresaUpdate
from app.models.empresa import Empresa
from app.api.v1.deps import get_empresa_id_from_user

router = APIRouter()

@router.post("/", response_model=EmpresaRead, status_code=201)
def create_endpoint(
    *,
    db: Session = Depends(get_db), 
    empresa_in: EmpresaCreate
):
    logger.info(f"Criando empresa: {empresa_in.nome_fantasia}")
    empresa = create_empresa(db=db, empresa_in=empresa_in)
    return empresa

@router.get("/{empresa_id}", response_model=EmpresaRead)
def read_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    current_user_empresa_id: int = Depends(get_empresa_id_from_user)
):
    if empresa_id != current_user_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado")
        
    empresa = get_empresa(db, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return empresa

# --- ROTA DE ATUALIZAÇÃO (CORREÇÃO DO 405) ---
@router.patch("/{empresa_id}", response_model=EmpresaRead)
def update_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    empresa_in: EmpresaUpdate,
    current_user_empresa_id: int = Depends(get_empresa_id_from_user)
):
    logger.info(f"Recebido PATCH para empresa {empresa_id}")
    
    if empresa_id != current_user_empresa_id:
        raise HTTPException(status_code=403, detail="Acesso negado")

    db_obj = get_empresa(db, empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
        
    empresa = update_empresa(db=db, db_obj=db_obj, obj_in=empresa_in)
    logger.success("Empresa atualizada com sucesso")
    return empresa