from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.v1.deps import get_empresa_id_from_user
from app.db.session import get_db
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas

router = APIRouter()

MONTH_LABELS = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
]


class DRECategoriaItem(BaseModel):
    plano_contas_id: Optional[int] = None
    nome: str
    codigo: Optional[str] = None
    tipo: str
    total: float


class DRESerieItem(BaseModel):
    competencia: str
    receitas: float
    despesas: float
    resultado: float


class DREResponse(BaseModel):
    ano: int
    mes: int
    competencia_label: str
    receita_total: float
    despesa_total: float
    resultado_total: float
    margem_percentual: float
    categorias_receita: List[DRECategoriaItem]
    categorias_despesa: List[DRECategoriaItem]
    serie_mensal: List[DRESerieItem]


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_label(year: int, month: int) -> str:
    return f"{MONTH_LABELS[month - 1]}/{year}"


def _resolve_competencia(lancamento: Lancamento) -> date:
    return lancamento.data_competencia or lancamento.data_vencimento


def _resolve_valor(lancamento: Lancamento) -> Decimal:
    valor_pago = Decimal(str(lancamento.valor_pago or 0))
    if lancamento.data_pagamento is not None or valor_pago != Decimal("0"):
        return valor_pago if valor_pago != Decimal("0") else Decimal(str(lancamento.valor_previsto or 0))
    return Decimal(str(lancamento.valor_previsto or 0))


def _month_window(ano: int, mes: int) -> tuple[date, date]:
    start = date(ano, mes, 1)
    end = date(ano, mes, monthrange(ano, mes)[1])
    return start, end


@router.get("/", response_model=DREResponse)
def read_dre(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    ano: Optional[int] = Query(default=None, ge=2000, le=2100),
    mes: Optional[int] = Query(default=None, ge=1, le=12),
):
    hoje = date.today()
    ano = ano or hoje.year
    mes = mes or hoje.month
    inicio_mes, fim_mes = _month_window(ano, mes)
    inicio_serie = date(inicio_mes.year, inicio_mes.month, 1)
    for _ in range(11):
        prev_month = inicio_serie.month - 1 or 12
        prev_year = inicio_serie.year - 1 if inicio_serie.month == 1 else inicio_serie.year
        inicio_serie = date(prev_year, prev_month, 1)

    rows = db.exec(
        select(Lancamento, PlanoContas)
        .join(PlanoContas, PlanoContas.id == Lancamento.plano_contas_id)
        .where(Lancamento.empresa_id == empresa_id)
        .where(Lancamento.is_deleted == False)
        .where(PlanoContas.is_deleted == False)
        .where(PlanoContas.considerar_nos_resultados == True)
        .where(Lancamento.data_vencimento >= inicio_serie)
        .where(Lancamento.data_vencimento <= fim_mes)
    ).all()

    receitas_mes = Decimal("0")
    despesas_mes = Decimal("0")
    categorias_receita: Dict[int, DRECategoriaItem] = {}
    categorias_despesa: Dict[int, DRECategoriaItem] = {}
    serie_dict: Dict[str, Dict[str, Decimal]] = {}

    cursor = inicio_serie
    for _ in range(12):
        key = _month_key(cursor)
        serie_dict[key] = {"receitas": Decimal("0"), "despesas": Decimal("0")}
        next_month = cursor.month + 1
        next_year = cursor.year + 1 if next_month == 13 else cursor.year
        cursor = date(next_year, 1 if next_month == 13 else next_month, 1)

    for lancamento, categoria in rows:
        competencia = _resolve_competencia(lancamento)
        valor = _resolve_valor(lancamento)
        key = _month_key(competencia)
        tipo = (categoria.tipo or lancamento.tipo or "").upper()

        if key not in serie_dict:
            continue

        if tipo.startswith("R") or tipo == "RECEITA":
            serie_dict[key]["receitas"] += valor
            if inicio_mes <= competencia <= fim_mes:
                receitas_mes += valor
                categoria_item = categorias_receita.get(categoria.id or 0)
                if not categoria_item:
                    categoria_item = DRECategoriaItem(
                        plano_contas_id=categoria.id,
                        nome=categoria.nome,
                        codigo=categoria.codigo,
                        tipo="R",
                        total=0.0,
                    )
                    categorias_receita[categoria.id or 0] = categoria_item
                categoria_item.total = float(Decimal(str(categoria_item.total)) + valor)
        else:
            serie_dict[key]["despesas"] += valor
            if inicio_mes <= competencia <= fim_mes:
                despesas_mes += valor
                categoria_item = categorias_despesa.get(categoria.id or 0)
                if not categoria_item:
                    categoria_item = DRECategoriaItem(
                        plano_contas_id=categoria.id,
                        nome=categoria.nome,
                        codigo=categoria.codigo,
                        tipo="D",
                        total=0.0,
                    )
                    categorias_despesa[categoria.id or 0] = categoria_item
                categoria_item.total = float(Decimal(str(categoria_item.total)) + valor)

    resultado = receitas_mes - despesas_mes
    margem = float((resultado / receitas_mes) * Decimal("100")) if receitas_mes != Decimal("0") else 0.0

    serie_mensal = [
        DRESerieItem(
            competencia=_month_label(int(key[:4]), int(key[5:7])),
            receitas=float(payload["receitas"]),
            despesas=float(payload["despesas"]),
            resultado=float(payload["receitas"] - payload["despesas"]),
        )
        for key, payload in sorted(serie_dict.items())
    ]

    categorias_receita_sorted = sorted(categorias_receita.values(), key=lambda item: item.total, reverse=True)
    categorias_despesa_sorted = sorted(categorias_despesa.values(), key=lambda item: item.total, reverse=True)

    return DREResponse(
        ano=ano,
        mes=mes,
        competencia_label=_month_label(ano, mes),
        receita_total=float(receitas_mes),
        despesa_total=float(despesas_mes),
        resultado_total=float(resultado),
        margem_percentual=margem,
        categorias_receita=categorias_receita_sorted,
        categorias_despesa=categorias_despesa_sorted,
        serie_mensal=serie_mensal,
    )