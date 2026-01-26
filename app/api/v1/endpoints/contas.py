# app/api/v1/endpoints/contas.py

from typing import List, Optional
from decimal import Decimal # <--- Importação vital para cálculos financeiros
from pathlib import Path
import shutil
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select, func, case
from loguru import logger
from pydantic import BaseModel

from app.db.session import get_db
from app.crud import crud_conta
from app.schemas.conta import ContaCreate, ContaRead, ContaUpdate
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.api.v1.deps import get_empresa_id_from_user
from app.core.network import get_backend_url

router = APIRouter()
UPLOAD_DIR = Path("static/uploads/contas")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Schema para retorno do saldo
class ContaSaldo(ContaRead):
    saldo_atual: float

@router.get("/", response_model=List[ContaSaldo])
def read_all_contas(
    *,
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    """
    Lista contas com SALDO CALCULADO (Inicial + Entradas - Saídas).
    """
    # Lista todas as contas da empresa
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    resultado = []

    for conta in contas:
        # 1. Calcula Receitas Pagas
        receitas = db.exec(
            select(func.sum(Lancamento.valor_pago))
            .where(
                Lancamento.conta_id == conta.id,
                Lancamento.status == 'PAGO',
                Lancamento.tipo == 'RECEITA'
            )
        ).one()

        # 2. Calcula Despesas Pagas
        despesas = db.exec(
            select(func.sum(Lancamento.valor_pago))
            .where(
                Lancamento.conta_id == conta.id,
                Lancamento.status == 'PAGO',
                Lancamento.tipo == 'DESPESA'
            )
        ).one()

        # --- CORREÇÃO DO ERRO DE TIPO ---
        # Convertemos tudo para Decimal antes de somar.
        # Usamos str() antes para garantir que a conversão seja exata.
        val_receitas = Decimal(str(receitas)) if receitas is not None else Decimal("0.00")
        val_despesas = Decimal(str(despesas)) if despesas is not None else Decimal("0.00")
        val_inicial = Decimal(str(conta.saldo_inicial))
        
        # Agora a matemática é segura: Decimal + Decimal - Decimal
        saldo_real = val_inicial + val_receitas - val_despesas
        # --------------------------------

        # Monta objeto de retorno
        conta_dict = conta.model_dump()
        # Garante URL completa da logo
        if conta_dict.get("logo_url") and not str(conta_dict["logo_url"]).startswith("http"):
            base = get_backend_url()
            conta_dict["logo_url"] = f"{base}{conta_dict['logo_url']}" if conta_dict['logo_url'].startswith("/") else f"{base}/{conta_dict['logo_url']}"

        conta_dict['saldo_atual'] = saldo_real
        resultado.append(conta_dict)

    return resultado

@router.post("/", response_model=ContaRead, status_code=201)
def create_conta(
    *,
    db: Session = Depends(get_db), 
    conta_in: ContaCreate, 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    return crud_conta.create(db=db, obj_in=conta_in, empresa_id=empresa_id)

@router.patch("/{conta_id}", response_model=ContaRead)
def update_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    conta_in: ContaUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    db_obj = crud_conta.get_by_id(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return crud_conta.update(db=db, db_obj=db_obj, obj_in=conta_in)

@router.delete("/{conta_id}")
def delete_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    db_obj = crud_conta.delete(db=db, id=conta_id, empresa_id=empresa_id)
    if not db_obj:
        raise HTTPException(status_code=404, detail="Conta não encontrada")
    return {"ok": True}


@router.api_route(
    "/{conta_id}/logo",
    methods=["POST", "PUT", "OPTIONS"],
    response_model=ContaRead,
)
@router.api_route(
    "/{conta_id}/logo/",
    methods=["POST", "PUT", "OPTIONS"],
    response_model=ContaRead,
    include_in_schema=False,  # Evita operação duplicada no OpenAPI
)
def upload_logo_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    file: UploadFile = File(...),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Salva uma logo/foto para a conta e retorna a conta atualizada."""
    conta = crud_conta.get_by_id(db=db, id=conta_id, empresa_id=empresa_id)
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    ext = Path(file.filename or "").suffix.lower()
    allowed_exts = {".png", ".jpg", ".jpeg", ".jiff", ".jfif"}
    if not ext or ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Formato de imagem não suportado. Use png, jpg, jpeg ou jiff.",
        )

    filename = f"conta_{conta_id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    with filepath.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Salva URL absoluta para não depender do host do frontend
    base = get_backend_url()
    relative_path = f"/static/uploads/contas/{filename}"
    conta.logo_url = f"{base}{relative_path}"
    db.add(conta)
    db.commit()
    db.refresh(conta)
    return conta