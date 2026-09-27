from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, select, or_, func

from app.api.v1.deps import get_empresa_id_from_user, require_permission
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
    receita_operacional_total: float
    despesa_operacional_total: float
    resultado_operacional_total: float
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


@router.get(
    "/anual",
    dependencies=[Depends(require_permission("page:dre:view"))],
)
def read_dre_anual(
    ano: Optional[int] = Query(default=None, ge=2000, le=2100),
    centro_custo_id: Optional[int] = Query(default=None),
    somente_pagos: bool = Query(default=True),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    from app.services.dre_service import get_dre_anual
    return get_dre_anual(
        db=db,
        empresa_id=empresa_id,
        ano=ano,
        centro_custo_id=centro_custo_id,
        somente_pagos=somente_pagos,
    )


@router.get(
    "/",
    response_model=DREResponse,
    dependencies=[Depends(require_permission("page:dre:view"))],
)
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

    categorias = db.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id)
        .where(PlanoContas.is_deleted == False)
        .where(PlanoContas.oculta == False)
    ).all()
    filhos_por_pai: Dict[int, List[int]] = {}
    categorias_operacionais_ids: set[int] = set()
    for categoria in categorias:
        if categoria.id is None:
            continue
        if categoria.conta_pai_id is not None:
            filhos_por_pai.setdefault(int(categoria.conta_pai_id), []).append(int(categoria.id))
        if categoria.eh_operacional:
            categorias_operacionais_ids.add(int(categoria.id))

    fila = list(categorias_operacionais_ids)
    while fila:
        atual = fila.pop(0)
        for filho_id in filhos_por_pai.get(atual, []):
            if filho_id not in categorias_operacionais_ids:
                categorias_operacionais_ids.add(filho_id)
                fila.append(filho_id)

    categorias_por_id = {int(categoria.id): categoria for categoria in categorias if categoria.id is not None}
    comp_date = func.coalesce(Lancamento.data_competencia, Lancamento.data_vencimento)
    rows = db.exec(
        select(
            Lancamento.plano_contas_id,
            Lancamento.tipo,
            Lancamento.data_competencia,
            Lancamento.data_vencimento,
            Lancamento.valor_pago,
            Lancamento.valor_previsto,
            Lancamento.data_pagamento,
            Lancamento.conta_id,
        )
        .where(Lancamento.empresa_id == empresa_id)
        .where(Lancamento.is_deleted == False)
        .where(comp_date >= inicio_serie)
        .where(comp_date <= fim_mes)
    ).all()

    receitas_mes = Decimal("0")
    despesas_mes = Decimal("0")
    receitas_operacionais_mes = Decimal("0")
    despesas_operacionais_mes = Decimal("0")
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

    for plano_contas_id, tipo_lan, data_competencia, data_vencimento, valor_pago, valor_previsto, data_pagamento, conta_id in rows:
        is_paid = data_pagamento is not None or (valor_pago is not None and valor_pago > 0)
        if is_paid and (conta_id is None or conta_id <= 0):
            continue
        categoria = categorias_por_id.get(int(plano_contas_id or 0))
        if categoria is None:
            continue

        grupo_dre = str(categoria.dre_grupo or "").strip().upper()
        eh_operacional = getattr(categoria, 'eh_operacional', True)
        considerar_nos_resultados = getattr(categoria, 'considerar_nos_resultados', True)

        if (
            grupo_dre in ("FORA_DRE", "FORA DRE", "FORA DA DRE", "NAO_OPERACIONAL", "NAO OPERACIONAL", "NÃO_OPERACIONAL", "NÃO OPERACIONAL", "NAO OP.", "NAO_DRE", "NÃO_DRE")
            or eh_operacional is False
            or considerar_nos_resultados is False
        ):
            continue

        competencia = data_competencia or data_vencimento
        
        # valor
        val_pago = Decimal(str(valor_pago or 0))
        if data_pagamento is not None or val_pago != Decimal("0"):
            valor = val_pago if val_pago != Decimal("0") else Decimal(str(valor_previsto or 0))
        else:
            valor = Decimal(str(valor_previsto or 0))

        key = _month_key(competencia)
        tipo = (categoria.tipo or tipo_lan or "").upper()

        if key not in serie_dict:
            continue

        if tipo.startswith("R") or tipo == "RECEITA":
            serie_dict[key]["receitas"] += valor
            if inicio_mes <= competencia <= fim_mes:
                receitas_mes += valor
                if grupo_dre == "OUTRAS_RECEITAS":
                    pass
                elif grupo_dre != "NAO_OPERACIONAL":
                    receitas_operacionais_mes += valor
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
                if grupo_dre in ("DEDUCOES_RECEITA", "DEDUCOES DE RECEITA", "DEDUCOES"):
                    pass
                elif grupo_dre in ("CUSTOS_VARIAVEIS", "CUSTO_VARIAVEL", "CUSTOS"):
                    pass
                elif grupo_dre in ("OUTRAS_DESPESAS", "OUTRA_DESPESA"):
                    pass
                elif grupo_dre != "NAO_OPERACIONAL":
                    despesas_operacionais_mes += valor
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
        receita_operacional_total=float(receitas_operacionais_mes),
        despesa_operacional_total=float(despesas_operacionais_mes),
        resultado_operacional_total=float(receitas_operacionais_mes - despesas_operacionais_mes),
        margem_percentual=margem,
        categorias_receita=categorias_receita_sorted,
        categorias_despesa=categorias_despesa_sorted,
        serie_mensal=serie_mensal,
    )