from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from loguru import logger

from app.db.session import get_db
from app.crud.crud_empresa import create_empresa, get_empresa, update_empresa
from app.schemas.empresa import EmpresaCreate, EmpresaRead, EmpresaUpdate
from app.models.empresa import Empresa
# IMPORTANTE: Importamos as dependências de segurança
from app.api.v1.deps import get_empresa_id_from_user, get_current_active_user, get_consultor_user 

router = APIRouter()

# --- ROTA BLINDADA: LISTAR TODAS ---
# Segurança: Apenas Consultores podem ver a lista completa
@router.get("/", response_model=List[EmpresaRead])
def read_empresas(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user = Depends(get_consultor_user) # <--- AQUI ESTÁ O SEGredo
):
    """
    Lista todas as empresas.
    Apenas usuários com 'is_consultor=True' podem acessar.
    """
    empresas = db.exec(select(Empresa).offset(skip).limit(limit)).all()
    return empresas

# --- ROTA BLINDADA: CRIAR EMPRESA ---
# Segurança: Apenas Consultores podem criar empresas
@router.post("/", response_model=EmpresaRead, status_code=201)
def create_endpoint(
    *,
    db: Session = Depends(get_db), 
    empresa_in: EmpresaCreate,
    current_user = Depends(get_consultor_user) # <--- AQUI TAMBÉM
):
    logger.info(f"Criando empresa: {empresa_in.nome_fantasia}")
    
    if empresa_in.cnpj:
        existing = db.exec(select(Empresa).where(Empresa.cnpj == empresa_in.cnpj)).first()
        if existing:
            raise HTTPException(status_code=400, detail="CNPJ já cadastrado")

    empresa = create_empresa(db=db, empresa_in=empresa_in)
    return empresa

# --- ROTA HÍBRIDA: VER DETALHES ---
@router.get("/{empresa_id}", response_model=EmpresaRead)
def read_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    current_user = Depends(get_current_active_user) # Qualquer usuário logado entra, MAS...
):
    # ... aqui dentro a gente filtra:
    # Se NÃO for consultor E estiver tentando ver empresa dos outros -> BLOQUEIA
    if not current_user.is_consultor and current_user.empresa_id != empresa_id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para ver esta empresa.")
        
    empresa = get_empresa(db, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return empresa

# --- ROTA HÍBRIDA: ATUALIZAR ---
@router.patch("/{empresa_id}", response_model=EmpresaRead)
def update_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    empresa_in: EmpresaUpdate,
    current_user = Depends(get_current_active_user)
):
    logger.info(f"Recebido PATCH para empresa {empresa_id}")
    
    # Mesma lógica de proteção
    if not current_user.is_consultor and current_user.empresa_id != empresa_id:
         raise HTTPException(status_code=403, detail="Acesso negado")

    db_obj = get_empresa(db, empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
        
    empresa = update_empresa(db=db, db_obj=db_obj, obj_in=empresa_in)
    logger.success("Empresa atualizada com sucesso")
    return empresa