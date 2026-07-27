from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, select, or_, func

from app.api.v1.deps import get_empresa_id_from_user
from app.db.session import get_db
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.pdv_movimentacao import PdvMovimentacao

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

    for plano_contas_id, tipo_lan, data_competencia, data_vencimento, valor_pago, valor_previsto, data_pagamento in rows:
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

    # 1. Obter a última data de importação da planilha (WEB) para esta empresa (limitada até a data atual)
    max_web_date = db.exec(
        select(func.max(Lancamento.data_vencimento))
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.origem == "WEB",
            Lancamento.is_deleted == False,
            Lancamento.data_vencimento <= date.today()
        )
    ).first()

    if max_web_date is None:
        max_web_date = date(2000, 1, 1)

    # 2. Buscar faturamento de cartões no PDV a partir do dia seguinte ao último import da planilha
    pdv_movs = db.exec(
        select(
            PdvMovimentacao.data,
            PdvMovimentacao.valor,
            PdvMovimentacao.forma_pagamento
        )
        .where(PdvMovimentacao.empresa_id == empresa_id)
        .where(PdvMovimentacao.is_deleted == False)
        .where(PdvMovimentacao.tipo == "ENTRADA")
        .where(PdvMovimentacao.forma_pagamento.in_(["DEBITO", "CREDITO_AVISTA", "CREDITO_PARCELADO"]))
        .where(PdvMovimentacao.data > max_web_date)
        .where(PdvMovimentacao.data <= fim_mes)
    ).all()

    credito_cat = next((c for c in categorias if c.codigo in ("01.02", "01.01.02")), None)
    debito_cat = next((c for c in categorias if c.codigo in ("01.03", "01.01.03")), None)

    for data_mov, valor_mov, forma_pag in pdv_movs:
        competencia_mov = data_mov
        key_mov = _month_key(competencia_mov)
        if key_mov not in serie_dict:
            continue

        cat_obj = debito_cat if forma_pag == "DEBITO" else credito_cat
        if not cat_obj:
            continue

        val_dec = Decimal(str(valor_mov))
        serie_dict[key_mov]["receitas"] += val_dec

        if inicio_mes <= competencia_mov <= fim_mes:
            receitas_mes += val_dec
            grupo_dre = str(cat_obj.dre_grupo or "").strip().upper()
            if grupo_dre != "NAO_OPERACIONAL":
                receitas_operacionais_mes += val_dec

            categoria_item = categorias_receita.get(cat_obj.id or 0)
            if not categoria_item:
                categoria_item = DRECategoriaItem(
                    plano_contas_id=cat_obj.id,
                    nome=cat_obj.nome,
                    codigo=cat_obj.codigo,
                    tipo="R",
                    total=0.0,
                )
                categorias_receita[cat_obj.id or 0] = categoria_item
            categoria_item.total = float(Decimal(str(categoria_item.total)) + val_dec)

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