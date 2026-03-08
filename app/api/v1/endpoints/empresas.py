import shutil
import os
from uuid import uuid4
from typing import List
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile
from sqlmodel import Session, select
from loguru import logger

from app.db.session import get_db
from app.crud.crud_empresa import create_empresa, get_empresa, update_empresa
from app.schemas.empresa import EmpresaCreate, EmpresaRead, EmpresaUpdate
from app.models.empresa import Empresa
from app.api.v1.deps import get_empresa_id_from_user, get_current_active_user, get_consultor_user 

router = APIRouter()

# --- CONFIGURAÇÃO DE UPLOAD ---
UPLOAD_DIR = Path("static/logos")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True) # Cria a pasta se não existir
MAX_LOGO_SIZE = 2 * 1024 * 1024

# --- ROTA BLINDADA: LISTAR TODAS ---
@router.get("/", response_model=List[EmpresaRead])
def read_empresas(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user = Depends(get_consultor_user)
):
    empresas = db.exec(
        select(Empresa)
        .where(Empresa.is_deleted == False)
        .offset(skip)
        .limit(limit)
    ).all()
    return empresas

# --- ROTA BLINDADA: CRIAR EMPRESA ---
@router.post("/", response_model=EmpresaRead, status_code=201)
def create_endpoint(
    *,
    db: Session = Depends(get_db), 
    empresa_in: EmpresaCreate,
    current_user = Depends(get_consultor_user)
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
    current_user = Depends(get_current_active_user)
):
    if not current_user.is_consultor and current_user.empresa_id != empresa_id:
        raise HTTPException(status_code=403, detail="Você não tem permissão para ver esta empresa.")
        
    empresa = get_empresa(db, empresa_id)
    if not empresa or empresa.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if not current_user.is_consultor and not empresa.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
    return empresa

# --- ROTA HÍBRIDA: ATUALIZAR DADOS ---
@router.patch("/{empresa_id}", response_model=EmpresaRead)
def update_endpoint(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    empresa_in: EmpresaUpdate,
    current_user = Depends(get_current_active_user)
):
    if not current_user.is_consultor and current_user.empresa_id != empresa_id:
         raise HTTPException(status_code=403, detail="Acesso negado")

    db_obj = get_empresa(db, empresa_id)
    if not db_obj or db_obj.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    if not current_user.is_consultor and not db_obj.is_active:
        raise HTTPException(status_code=403, detail="Empresa desativada")
        
    empresa = update_empresa(db=db, db_obj=db_obj, obj_in=empresa_in)
    logger.success(f"Empresa {empresa_id} atualizada")
    return empresa

# --- NOVA ROTA: UPLOAD DE LOGO ---
@router.post("/{empresa_id}/logo", response_model=EmpresaRead)
def upload_logo(
    *,
    db: Session = Depends(get_db),
    empresa_id: int,
    file: UploadFile = File(...),
    current_user = Depends(get_current_active_user)
):
    """
    Recebe um arquivo de imagem, salva na pasta 'static/logos' 
    e atualiza a URL no banco de dados.
    """
    
    # --- VALIDAÇÃO DO ARQUIVO (Agora no lugar certo) ---
    ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Apenas imagens (JPG, PNG, WEBP) são permitidas.")

    # 1. Verifica Permissão
    if not current_user.is_consultor and current_user.empresa_id != empresa_id:
         raise HTTPException(status_code=403, detail="Acesso negado")

    db_obj = get_empresa(db, empresa_id)
    if not db_obj or db_obj.is_deleted:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = {".jpg", ".jpeg", ".png", ".webp"}
    if not ext or ext not in allowed_exts:
        raise HTTPException(400, detail="Extensão de arquivo inválida para logo.")

    # 2. Gera nome único para evitar cache do navegador (uuid)
    filename = f"logo_{empresa_id}_{uuid4().hex[:8]}{ext}"
    file_path = UPLOAD_DIR / filename

    # 3. Salva no Disco
    try:
        bytes_written = 0
        with open(file_path, "wb") as buffer:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_LOGO_SIZE:
                    buffer.close()
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
                buffer.write(chunk)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        logger.error(f"Erro ao salvar arquivo: {e}")
        raise HTTPException(status_code=500, detail="Falha ao salvar imagem")

    # 4. Atualiza Banco (URL Relativa)
    url_relativa = f"/static/logos/{filename}"
    
    db_obj.logo_url = url_relativa
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    
    logger.success(f"Logo atualizada para empresa {empresa_id}: {url_relativa}")
    return db_obj