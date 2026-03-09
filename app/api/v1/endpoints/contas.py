# app/api/v1/endpoints/contas.py

from typing import List, Optional
from decimal import Decimal # <--- Importação vital para cálculos financeiros
from pathlib import Path
import shutil
from urllib.parse import urlparse
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select, func, case, or_
from loguru import logger
from pydantic import BaseModel
from datetime import date

from app.db.session import get_db
from app.crud import crud_conta
from app.schemas.conta import ContaCreate, ContaRead, ContaUpdate
from app.schemas.lancamento import LancamentoRead
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.lancamento import Lancamento
from app.api.v1.deps import get_empresa_id_from_user
from app.core.network import get_backend_url

router = APIRouter()
UPLOAD_DIR = Path("static/uploads/contas")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_CONTA_LOGO_SIZE = 2 * 1024 * 1024

# Schema para retorno do saldo
class ContaSaldo(ContaRead):
    saldo_atual: float

# Schema leve para extrato
class LancamentoExtratoOut(BaseModel):
    id: int
    data_pagamento: Optional[date]
    descricao: str
    valor_pago: Decimal
    tipo: str


def _normalize_logo_url(logo_url: Optional[str], base: str) -> Optional[str]:
    if not logo_url:
        return logo_url
    if str(logo_url).startswith("/"):
        return f"{base}{logo_url}"
    if str(logo_url).startswith("http://") and "/static/" in str(logo_url):
        return f"{base}{urlparse(str(logo_url)).path}"
    if not str(logo_url).startswith("http"):
        return f"{base}/{logo_url}"
    return logo_url


@router.get("/", response_model=List[ContaSaldo])
def read_all_contas(
    *,
    db: Session = Depends(get_db), 
    empresa_id: int = Depends(get_empresa_id_from_user),
    include_saldo: bool = True,
):
    """
    Lista contas com SALDO CALCULADO (Inicial + Entradas - Saídas).
    """
    # Lista todas as contas da empresa
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    resultado = []

    base = get_backend_url()

    # Agrega receitas e despesas por conta em uma única query (evita N+1)
    saldos_por_conta = {}
    if include_saldo:
        tipo_receita = func.upper(Lancamento.tipo).like("R%")
        tipo_despesa = func.upper(Lancamento.tipo).like("D%")
        movimento_pago = or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))

        saldo_query = (
            select(
                Lancamento.conta_id,
                func.sum(
                    case(
                        (tipo_receita, Lancamento.valor_pago),
                        else_=0,
                    )
                ).label("receitas"),
                func.sum(
                    case(
                        (tipo_despesa, Lancamento.valor_pago),
                        else_=0,
                    )
                ).label("despesas"),
            )
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                movimento_pago,
                Lancamento.conta_id.is_not(None),
            )
            .group_by(Lancamento.conta_id)
        )

        saldos_por_conta = {
            row[0]: (row[1], row[2])
            for row in db.exec(saldo_query).all()
        }

    for conta in contas:
        receitas, despesas = saldos_por_conta.get(conta.id, (0, 0)) if include_saldo else (0, 0)

        # --- CORREÇÃO DO ERRO DE TIPO ---
        # Convertemos tudo para Decimal antes de somar.
        # Usamos str() antes para garantir que a conversão seja exata.
        val_inicial = Decimal(str(conta.saldo_inicial))
        if include_saldo:
            val_receitas = Decimal(str(receitas)) if receitas is not None else Decimal("0.00")
            val_despesas = Decimal(str(despesas)) if despesas is not None else Decimal("0.00")
            # Agora a matemática é segura: Decimal + Decimal - Decimal
            saldo_real = val_inicial + val_receitas - val_despesas
        else:
            saldo_real = val_inicial
        # --------------------------------

        # Monta objeto de retorno
        conta_dict = conta.model_dump()
        # Garante URL completa da logo (e normaliza URLs antigas http://IP)
        conta_dict["logo_url"] = _normalize_logo_url(conta_dict.get("logo_url"), base)

        conta_dict['saldo_atual'] = saldo_real
        resultado.append(conta_dict)

    return resultado

@router.get("/{conta_id}/extrato", response_model=List[LancamentoExtratoOut])
def extrato_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    skip: int = 0,
    limit: int = 15,
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    """
    Retorna os últimos lançamentos pagos de uma conta.
    """
    query = (
        select(
            Lancamento.id,
            Lancamento.data_pagamento,
            Lancamento.descricao,
            Lancamento.valor_pago,
            Lancamento.tipo,
        )
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.conta_id == conta_id,
            Lancamento.is_deleted == False,
            or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
        )
        .order_by(Lancamento.data_pagamento.desc())
        .offset(skip)
        .limit(limit)
    )

    rows = db.exec(query).all()
    return [
        {
            "id": row[0],
            "data_pagamento": row[1],
            "descricao": row[2],
            "valor_pago": row[3],
            "tipo": row[4],
        }
        for row in rows
    ]

@router.post("/", response_model=ContaRead, status_code=201)
def create_conta(
    *,
    db: Session = Depends(get_db), 
    conta_in: ContaCreate, 
    empresa_id: int = Depends(get_empresa_id_from_user)
):
    conta_data = conta_in.model_dump()
    if conta_data.get("centro_custo_id") is None:
        conta_data["centro_custo_id"] = _resolver_centro_custo_id(db, empresa_id)
    conta_in = ContaCreate(**conta_data)
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
    update_data = conta_in.model_dump(exclude_unset=True)
    if "centro_custo_id" in update_data and update_data.get("centro_custo_id") is None:
        update_data["centro_custo_id"] = _resolver_centro_custo_id(db, empresa_id)
    elif "centro_custo_id" not in update_data and db_obj.centro_custo_id is None:
        update_data["centro_custo_id"] = _resolver_centro_custo_id(db, empresa_id)
    conta_in = ContaUpdate(**update_data)
    return crud_conta.update(db=db, db_obj=db_obj, obj_in=conta_in)


def _resolver_centro_custo_id(db: Session, empresa_id: int) -> int:
    centros = db.exec(
        select(CentroCusto.id).where(CentroCusto.empresa_id == empresa_id).limit(2)
    ).all()
    if len(centros) == 1:
        return centros[0]
    raise HTTPException(
        status_code=400,
        detail="Conta deve estar vinculada a um centro de custo."
    )

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

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Arquivo inválido para imagem.")

    filename = f"conta_{conta_id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    bytes_written = 0
    with filepath.open("wb") as buffer:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            bytes_written += len(chunk)
            if bytes_written > MAX_CONTA_LOGO_SIZE:
                buffer.close()
                filepath.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
            buffer.write(chunk)

    # Salva URL absoluta para não depender do host do frontend
    base = get_backend_url()
    relative_path = f"/static/uploads/contas/{filename}"
    conta.logo_url = f"{base}{relative_path}"
    db.add(conta)
    db.commit()
    db.refresh(conta)
    return conta