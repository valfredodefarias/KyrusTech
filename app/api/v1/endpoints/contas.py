# app/api/v1/endpoints/contas.py

from typing import List, Optional
from decimal import Decimal # <--- Importação vital para cálculos financeiros
from pathlib import Path
import shutil
from urllib.parse import urlparse
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select, func, case, or_
from sqlalchemy import text
from sqlalchemy.orm import selectinload
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
from app.core.upload_security import IMAGE_ALLOWED_EXT_TO_MIME, UploadValidationError, write_validated_upload_file

router = APIRouter()
UPLOAD_DIR = Path("static/uploads/contas")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_CONTA_LOGO_SIZE = 2 * 1024 * 1024


def _ensure_legacy_conta_columns(db: Session) -> None:
    db.execute(text("ALTER TABLE contas ADD COLUMN IF NOT EXISTS conta_como_disponibilidade BOOLEAN NOT NULL DEFAULT TRUE"))
    db.commit()

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


class ContaSaldoMovimentoOut(BaseModel):
    id: int
    descricao: str
    tipo: str
    status: str
    origem: str
    conciliado: bool
    data_vencimento: date
    data_pagamento: Optional[date] = None
    data_competencia: Optional[date] = None
    valor_previsto: Decimal
    valor_pago: Decimal
    valor_entrada: Decimal
    valor_saida: Decimal
    saldo_apos_movimento: Decimal
    numero_parcela: Optional[int] = None
    entidade_id: Optional[int] = None
    entidade_nome: Optional[str] = None
    plano_contas_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    cartao_id: Optional[int] = None
    cartao_nome: Optional[str] = None


class ContaSaldoDetalheOut(BaseModel):
    conta_id: int
    conta_nome: str
    saldo_inicial: Decimal
    total_entradas: Decimal
    total_saidas: Decimal
    saldo_atual: Decimal
    quantidade_movimentos: int
    movimentos: List[ContaSaldoMovimentoOut]


def _tipo_receita_clause():
    return func.upper(Lancamento.tipo).like("R%")


def _tipo_despesa_clause():
    return func.upper(Lancamento.tipo).like("D%")


def _movimento_influencia_saldo_clause():
    return or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None))


def _normalize_logo_url(logo_url: Optional[str], base: str) -> Optional[str]:
    if not logo_url:
        return logo_url
    if str(logo_url).startswith("/"):
        return str(logo_url)
    if str(logo_url).startswith("http://") and "/static/" in str(logo_url):
        return urlparse(str(logo_url)).path
    if not str(logo_url).startswith("http"):
        return f"/{str(logo_url).lstrip('/')}"
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
    _ensure_legacy_conta_columns(db)
    # Lista todas as contas da empresa
    contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    resultado = []

    base = get_backend_url()

    # Agrega receitas e despesas por conta em uma única query (evita N+1)
    saldos_por_conta = {}
    if include_saldo:
        tipo_receita = _tipo_receita_clause()
        tipo_despesa = _tipo_despesa_clause()
        movimento_pago = _movimento_influencia_saldo_clause()

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
            _movimento_influencia_saldo_clause(),
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


@router.get("/{conta_id}/saldo-detalhe", response_model=ContaSaldoDetalheOut)
def saldo_detalhe_conta(
    *,
    db: Session = Depends(get_db),
    conta_id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    conta = db.exec(
        select(Conta).where(Conta.id == conta_id, Conta.empresa_id == empresa_id)
    ).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta não encontrada")

    movimentos = db.exec(
        select(Lancamento)
        .options(
            selectinload(Lancamento.cartao),
            selectinload(Lancamento.entidade),
        )
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.conta_id == conta_id,
            Lancamento.is_deleted == False,
            _movimento_influencia_saldo_clause(),
        )
        .order_by(func.coalesce(Lancamento.data_pagamento, Lancamento.data_vencimento).asc(), Lancamento.id.asc())
    ).all()

    total_entradas = Decimal("0.00")
    total_saidas = Decimal("0.00")
    movimentos_out: List[ContaSaldoMovimentoOut] = []
    saldo_corrente = Decimal(str(conta.saldo_inicial))

    for movimento in movimentos:
        valor_utilizado = Decimal(str(movimento.valor_pago if movimento.valor_pago is not None else 0))
        tipo_normalizado = (movimento.tipo or "").strip().upper()
        valor_entrada = Decimal("0.00")
        valor_saida = Decimal("0.00")
        if tipo_normalizado.startswith("R"):
            impacto = valor_utilizado
            valor_entrada = valor_utilizado
            total_entradas += valor_utilizado
        elif tipo_normalizado.startswith("D"):
            impacto = valor_utilizado * Decimal("-1")
            valor_saida = valor_utilizado
            total_saidas += valor_utilizado
        else:
            impacto = Decimal("0.00")

        saldo_corrente += impacto

        movimentos_out.append(
            ContaSaldoMovimentoOut(
                id=movimento.id or 0,
                descricao=movimento.descricao,
                tipo=movimento.tipo,
                status=movimento.status,
                origem=movimento.origem,
                conciliado=bool(movimento.conciliado),
                data_vencimento=movimento.data_vencimento,
                data_pagamento=movimento.data_pagamento,
                data_competencia=movimento.data_competencia,
                valor_previsto=movimento.valor_previsto,
                valor_pago=movimento.valor_pago,
                valor_entrada=valor_entrada,
                valor_saida=valor_saida,
                saldo_apos_movimento=saldo_corrente,
                numero_parcela=movimento.numero_parcela,
                entidade_id=movimento.entidade_id,
                entidade_nome=movimento.entidade.nome if movimento.entidade else None,
                plano_contas_id=movimento.plano_contas_id,
                centro_custo_id=movimento.centro_custo_id,
                cartao_id=movimento.cartao_id,
                cartao_nome=movimento.cartao.nome_cartao if movimento.cartao else None,
            )
        )

    movimentos_out.reverse()

    saldo_inicial = Decimal(str(conta.saldo_inicial))
    saldo_atual = saldo_inicial + total_entradas - total_saidas

    return ContaSaldoDetalheOut(
        conta_id=conta.id or 0,
        conta_nome=conta.nome,
        saldo_inicial=saldo_inicial,
        total_entradas=total_entradas,
        total_saidas=total_saidas,
        saldo_atual=saldo_atual,
        quantidade_movimentos=len(movimentos_out),
        movimentos=movimentos_out,
    )

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
    allowed_exts = set(IMAGE_ALLOWED_EXT_TO_MIME.keys())
    if not ext or ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail="Formato de imagem não suportado. Use png, jpg, jpeg, webp ou gif.",
        )

    filename = f"conta_{conta_id}_{uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    try:
        write_validated_upload_file(
            upload=file,
            destination=filepath,
            max_size=MAX_CONTA_LOGO_SIZE,
            allowed_ext_to_mime=IMAGE_ALLOWED_EXT_TO_MIME,
            max_filename_len=180,
        )
    except UploadValidationError as exc:
        if exc.status_code == 413:
            raise HTTPException(status_code=413, detail="Arquivo muito grande. Máximo 2MB.")
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    relative_path = f"/static/uploads/contas/{filename}"
    conta.logo_url = relative_path
    db.add(conta)
    db.commit()
    db.refresh(conta)
    return conta