# app/api/v1/endpoints/empresas.py

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from loguru import logger

from app.db.session import get_db
from app.crud.crud_empresa import create_empresa
from app.schemas.empresa import EmpresaCreate, EmpresaRead

# --- IMPORTAÇÕES ADICIONADAS PARA CORRIGIR O ERRO ---
from app.models.empresa import Empresa
from app.api.v1.deps import get_empresa_id_from_user
# ----------------------------------------------------

router = APIRouter()

@router.post("/", response_model=EmpresaRead, status_code=201)
def create(
    *,
    db: Session = Depends(get_db), 
    empresa_in: EmpresaCreate
):
    """Cria uma nova empresa e gera o plano de contas padrão."""
    logger.info(f"Recebida requisição para criar empresa: {empresa_in.nome_fantasia}")
    
    empresa = create_empresa(db=db, empresa_in=empresa_in)
    
    logger.success(f"Empresa '{empresa.nome_fantasia}' criada com sucesso com ID: {empresa.id}")
    return empresa

@router.get("/{empresa_id}", response_model=EmpresaRead)
def read_empresa(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    # Valida se o usuário logado pertence a esta empresa
    current_user_empresa_id: int = Depends(get_empresa_id_from_user)
):
    """Retorna os dados de uma empresa específica."""
    
    # Segurança: Impede que um usuário veja dados de outra empresa
    if empresa_id != current_user_empresa_id:
        logger.warning(f"Tentativa de acesso não autorizado à empresa {empresa_id} pelo usuário da empresa {current_user_empresa_id}")
        raise HTTPException(status_code=403, detail="Acesso negado a esta empresa")
        
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return empresa