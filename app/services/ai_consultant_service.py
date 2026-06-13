from __future__ import annotations

import asyncio
import json
import os
from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Optional, Sequence

import requests
from fastapi import HTTPException
from loguru import logger
from sqlmodel import Session, func, select

from app.core.config import settings
from app.crud import crud_orcamento
from app.db.session import engine
from app.models.empresa import Empresa
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas


ZERO = Decimal("0.00")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
STAGE_TIMEOUT_SECONDS = max(120, int(settings.AI_TIMEOUT_SECONDS or 0) * 6 or 180)
FINAL_STAGE_TIMEOUT_SECONDS = max(STAGE_TIMEOUT_SECONDS * 2, 360)


class AiConsultantServiceError(RuntimeError):
    pass


@dataclass(slots=True)
class DossieContext:
    empresa_id: int
    empresa_nome: str
    ano: int
    mes: int
    considerar_po: bool
    competencia_label: str
    mes_anterior: int
    ano_mes_anterior: int
    dre: dict[str, Any]
    matriz: list[dict[str, Any]]
    candidatas_tool: list[dict[str, Any]]


def _decimal(value: Any) -> Decimal:
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money(value: Any) -> str:
    return f"{_decimal(value):.2f}"


def _pct(value: Optional[Decimal]) -> Optional[str]:
    if value is None:
        return None
    return f"{value:.2f}"


def _json_dumps(data: Any, *, indent: int = 2) -> str:
    return json.dumps(data, ensure_ascii=False, indent=indent, default=str)


def _month_bounds(ano: int, mes: int) -> tuple[date, date]:
    return date(ano, mes, 1), date(ano, mes, monthrange(ano, mes)[1])


def _month_label(ano: int, mes: int) -> str:
    meses = [
        "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
        "Jul", "Ago", "Set", "Out", "Nov", "Dez",
    ]
    return f"{meses[mes - 1]}/{ano}"


def _resolve_competencia(lancamento: Lancamento) -> date:
    return lancamento.data_competencia or lancamento.data_vencimento


def _resolve_valor(lancamento: Lancamento) -> Decimal:
    valor_pago = _decimal(lancamento.valor_pago)
    if lancamento.data_pagamento is not None or valor_pago != ZERO:
        return valor_pago if valor_pago != ZERO else _decimal(lancamento.valor_previsto)
    return _decimal(lancamento.valor_previsto)


def _is_receita(tipo: str) -> bool:
    normalized = str(tipo or "").strip().upper()
    return normalized.startswith("R") or normalized == "RECEITA"


def _collect_operational_ids(planos: Sequence[PlanoContas]) -> set[int]:
    filhos_por_pai: dict[int, list[int]] = {}
    operacionais: set[int] = set()

    for plano in planos:
        if plano.id is None:
            continue
        if plano.conta_pai_id is not None:
            filhos_por_pai.setdefault(int(plano.conta_pai_id), []).append(int(plano.id))
        if plano.eh_operacional:
            operacionais.add(int(plano.id))

    fila = list(operacionais)
    while fila:
        atual = fila.pop(0)
        for filho_id in filhos_por_pai.get(atual, []):
            if filho_id not in operacionais:
                operacionais.add(filho_id)
                fila.append(filho_id)

    return operacionais


def _flatten_matriz(
    nodes: list[Any],
    *,
    mes_atual: int,
    mes_anterior: int,
    considerar_po: bool,
    level: int = 0,
) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []

    for node in nodes:
        current_mes = node.meses[mes_atual - 1]
        previous_mes = node.meses[mes_anterior - 1]

        budget_current = current_mes.valor_orcado if considerar_po else None
        budget_previous = previous_mes.valor_orcado if considerar_po else None

        current_realizado = _decimal(current_mes.valor_realizado)
        previous_realizado = _decimal(previous_mes.valor_realizado)
        current_orcado = _decimal(budget_current) if budget_current is not None else None
        previous_orcado = _decimal(budget_previous) if budget_previous is not None else None

        deviation_budget = None
        deviation_previous = None
        if current_orcado is not None and current_orcado != ZERO:
            deviation_budget = (current_realizado - current_orcado) / current_orcado * Decimal("100")
        if previous_realizado != ZERO:
            deviation_previous = (current_realizado - previous_realizado) / previous_realizado * Decimal("100")

        item = {
            "plano_contas_id": node.plano_contas_id,
            "codigo": node.codigo,
            "nome": node.nome,
            "tipo": node.tipo,
            "dre_grupo": node.dre_grupo,
            "oculta": bool(node.oculta),
            "nivel": level,
            "has_children": bool(node.children),
            "mes_atual": {
                "realizado": _money(current_realizado),
                "orcado": _money(current_orcado) if current_orcado is not None else None,
                "desvio_absoluto": _money(current_realizado - current_orcado) if current_orcado is not None else None,
                "desvio_percentual": _pct(deviation_budget),
            },
            "mes_anterior": {
                "realizado": _money(previous_realizado),
                "orcado": _money(previous_orcado) if previous_orcado is not None else None,
                "desvio_absoluto": _money(previous_realizado - previous_orcado) if previous_orcado is not None else None,
                "desvio_percentual": _pct(None),
            },
            "variacao_vs_mes_anterior_percentual": _pct(deviation_previous),
            "total_realizado": _money(node.total_realizado),
            "total_orcado": _money(node.total_orcado if considerar_po else ZERO) if considerar_po else None,
            "total_desvio_absoluto": _money(node.total_desvio_absoluto if considerar_po else ZERO) if considerar_po else None,
            "total_desvio_percentual": _pct(node.total_desvio_percentual if considerar_po else None),
        }
        flattened.append(item)

        if node.children:
            flattened.extend(
                _flatten_matriz(
                    node.children,
                    mes_atual=mes_atual,
                    mes_anterior=mes_anterior,
                    considerar_po=considerar_po,
                    level=level + 1,
                )
            )

    return flattened


def _build_dre_context(
    db: Session,
    *,
    empresa_id: int,
    ano: int,
    mes: int,
    considerar_po: bool,
) -> DossieContext:
    empresa = db.get(Empresa, empresa_id)
    if not empresa:
        raise AiConsultantServiceError(f"Empresa {empresa_id} nao encontrada.")

    inicio_mes, fim_mes = _month_bounds(ano, mes)
    inicio_serie = date(inicio_mes.year, inicio_mes.month, 1)
    for _ in range(11):
        prev_month = inicio_serie.month - 1 or 12
        prev_year = inicio_serie.year - 1 if inicio_serie.month == 1 else inicio_serie.year
        inicio_serie = date(prev_year, prev_month, 1)

    mes_anterior = mes - 1 or 12
    ano_mes_anterior = ano - 1 if mes == 1 else ano

    planos = db.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == empresa_id)
        .where(PlanoContas.is_deleted == False)
        .where(PlanoContas.oculta == False)
        .order_by(PlanoContas.codigo, PlanoContas.nome)
    ).all()

    operational_ids = _collect_operational_ids(planos)
    matriz_nodes = crud_orcamento.get_matriz(db=db, ano=ano, empresa_id=empresa_id)
    flattened_matriz = _flatten_matriz(
        matriz_nodes,
        mes_atual=mes,
        mes_anterior=mes_anterior,
        considerar_po=considerar_po,
    )

    rows = db.exec(
        select(Lancamento)
        .where(Lancamento.empresa_id == empresa_id)
        .where(Lancamento.is_deleted == False)
        .where(Lancamento.data_vencimento >= inicio_serie)
        .where(Lancamento.data_vencimento <= fim_mes)
    ).all()

    categorias_por_id = {int(plano.id): plano for plano in planos if plano.id is not None}

    receitas_mes = ZERO
    despesas_mes = ZERO
    receitas_operacionais_mes = ZERO
    despesas_operacionais_mes = ZERO
    categorias_receita: dict[int, dict[str, Any]] = {}
    categorias_despesa: dict[int, dict[str, Any]] = {}
    serie_dict: dict[str, dict[str, Decimal]] = {}

    cursor = inicio_serie
    for _ in range(12):
        key = f"{cursor.year:04d}-{cursor.month:02d}"
        serie_dict[key] = {"receitas": ZERO, "despesas": ZERO}
        next_month = cursor.month + 1
        next_year = cursor.year + 1 if next_month == 13 else cursor.year
        cursor = date(next_year, 1 if next_month == 13 else next_month, 1)

    for lancamento in rows:
        categoria = categorias_por_id.get(int(lancamento.plano_contas_id or 0))
        if categoria is None:
            continue

        competencia = _resolve_competencia(lancamento)
        valor = _resolve_valor(lancamento)
        key = f"{competencia.year:04d}-{competencia.month:02d}"
        if key not in serie_dict:
            continue

        tipo = str(categoria.tipo or lancamento.tipo or "").upper()
        if _is_receita(tipo):
            serie_dict[key]["receitas"] += valor
            if inicio_mes <= competencia <= fim_mes:
                receitas_mes += valor
                if int(categoria.id or 0) in operational_ids:
                    receitas_operacionais_mes += valor
                categoria_item = categorias_receita.get(int(categoria.id or 0))
                if not categoria_item:
                    categoria_item = {
                        "plano_contas_id": categoria.id,
                        "nome": categoria.nome,
                        "codigo": categoria.codigo,
                        "tipo": "R",
                        "total": ZERO,
                    }
                    categorias_receita[int(categoria.id or 0)] = categoria_item
                categoria_item["total"] = _decimal(categoria_item["total"]) + valor
        else:
            serie_dict[key]["despesas"] += valor
            if inicio_mes <= competencia <= fim_mes:
                despesas_mes += valor
                if int(categoria.id or 0) in operational_ids:
                    despesas_operacionais_mes += valor
                categoria_item = categorias_despesa.get(int(categoria.id or 0))
                if not categoria_item:
                    categoria_item = {
                        "plano_contas_id": categoria.id,
                        "nome": categoria.nome,
                        "codigo": categoria.codigo,
                        "tipo": "D",
                        "total": ZERO,
                    }
                    categorias_despesa[int(categoria.id or 0)] = categoria_item
                categoria_item["total"] = _decimal(categoria_item["total"]) + valor

    resultado = receitas_mes - despesas_mes
    margem = (resultado / receitas_mes) * Decimal("100") if receitas_mes != ZERO else ZERO

    serie_mensal = [
        {
            "competencia": _month_label(int(key[:4]), int(key[5:7])),
            "receitas": _money(payload["receitas"]),
            "despesas": _money(payload["despesas"]),
            "resultado": _money(payload["receitas"] - payload["despesas"]),
        }
        for key, payload in sorted(serie_dict.items())
    ]

    categorias_receita_sorted = sorted(categorias_receita.values(), key=lambda item: _decimal(item["total"]), reverse=True)
    categorias_despesa_sorted = sorted(categorias_despesa.values(), key=lambda item: _decimal(item["total"]), reverse=True)

    tool_candidates: list[dict[str, Any]] = []
    for item in flattened_matriz:
        if item["has_children"]:
            continue
        if item["plano_contas_id"] is None:
            continue

        current_realizado = _decimal(item["mes_atual"]["realizado"])
        current_orcado = _decimal(item["mes_atual"]["orcado"]) if item["mes_atual"]["orcado"] is not None else None
        previous_realizado = _decimal(item["mes_anterior"]["realizado"])

        percent_budget = None
        percent_previous = None
        motivo: list[str] = []

        if current_orcado is not None:
            if current_orcado == ZERO:
                if current_realizado != ZERO:
                    motivo.append("orcamento_zero_com_realizado")
            else:
                percent_budget = ((current_realizado - current_orcado) / current_orcado) * Decimal("100")
                if abs(percent_budget) > Decimal("10"):
                    motivo.append("desvio_vs_orcamento_maior_10pct")

        if previous_realizado == ZERO:
            if current_realizado != ZERO:
                motivo.append("base_mes_anterior_zero_com_movimento")
        else:
            percent_previous = ((current_realizado - previous_realizado) / previous_realizado) * Decimal("100")
            if abs(percent_previous) > Decimal("10"):
                motivo.append("desvio_vs_mes_anterior_maior_10pct")

        if not motivo:
            continue

        candidate = {
            **item,
            "motivos": motivo,
            "desvio_percentual_orcamento": _pct(percent_budget),
            "desvio_percentual_mes_anterior": _pct(percent_previous),
            "tool_priority": False,
        }
        tool_candidates.append(candidate)

    tool_candidates.sort(
        key=lambda item: (
            len(item["motivos"]),
            _decimal(item["mes_atual"]["realizado"]),
            item.get("codigo") or "",
        ),
        reverse=True,
    )

    for candidate in tool_candidates[:12]:
        candidate["tool_priority"] = True

    dre_context = {
        "empresa": {
            "id": empresa.id,
            "nome_fantasia": empresa.nome_fantasia,
            "razao_social": empresa.razao_social,
            "cnpj": empresa.cnpj,
            "tipo_pessoa": empresa.tipo_pessoa,
        },
        "periodo": {
            "ano": ano,
            "mes": mes,
            "competencia_label": _month_label(ano, mes),
            "mes_anterior": mes_anterior,
            "ano_mes_anterior": ano_mes_anterior,
            "considerar_po": considerar_po,
        },
        "resumo": {
            "receita_total": _money(receitas_mes),
            "despesa_total": _money(despesas_mes),
            "resultado_total": _money(resultado),
            "receita_operacional_total": _money(receitas_operacionais_mes),
            "despesa_operacional_total": _money(despesas_operacionais_mes),
            "resultado_operacional_total": _money(receitas_operacionais_mes - despesas_operacionais_mes),
            "margem_percentual": _pct(margem),
        },
        "serie_mensal": serie_mensal,
        "categorias_receita": [
            {
                **item,
                "total": _money(item["total"]),
            }
            for item in categorias_receita_sorted
        ],
        "categorias_despesa": [
            {
                **item,
                "total": _money(item["total"]),
            }
            for item in categorias_despesa_sorted
        ],
        "observacoes": [
            "DRE sintética calculada por competência baseada em data_vencimento/data_competencia.",
            "Categorias ocultas foram excluídas.",
            "Os nós de matriz incluem consolidação hierárquica para leitura executiva.",
        ],
    }

    return DossieContext(
        empresa_id=empresa_id,
        empresa_nome=empresa.nome_fantasia,
        ano=ano,
        mes=mes,
        considerar_po=considerar_po,
        competencia_label=_month_label(ano, mes),
        mes_anterior=mes_anterior,
        ano_mes_anterior=ano_mes_anterior,
        dre=dre_context,
        matriz=flattened_matriz,
        candidatas_tool=tool_candidates,
    )


def _build_tool_schema() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "buscar_detalhes_lancamentos",
                "description": "Busca os lancamentos detalhados de uma conta problematica no mes de referencia para auditoria analitica.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "plano_conta_id": {
                            "type": "integer",
                            "description": "ID da conta/plano de contas que sera investigada.",
                        },
                        "mes": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 12,
                            "description": "Mes de referencia para a investigacao.",
                        },
                    },
                    "required": ["plano_conta_id", "mes"],
                    "additionalProperties": False,
                },
            },
        }
    ]


def _build_stage1_messages(context: DossieContext) -> list[dict[str, Any]]:
    system_prompt = (
        "Você é um Analista de Dados Financeiros. Sua única função é analisar a DRE fornecida e cruzar com o orçamento "
        "(se houver) e o mês anterior. Identifique as contas com desvio superior a 10%. "
        "Quando encontrar uma conta problemática, chame a ferramenta buscar_detalhes_lancamentos para investigar os lançamentos ofensores. "
        "Seja conservador: não invente causa, limite-se aos fatos observáveis."
    )

    user_prompt = {
        "objetivo": "Analise a DRE sintética e liste contas com desvio material.",
        "regras": [
            "Considere como desvio material qualquer conta com variação acima de 10% versus orçamento ou mês anterior.",
            "Se considerar_po for falso, ignore orçamento e use apenas comparação com mês anterior.",
            "Chame a ferramenta para as contas problemáticas com maior relevância material.",
            "Seu retorno final deve ser bruto, objetivo e rastreável, preferencialmente em JSON ou texto estruturado.",
        ],
        "contexto_dre": context.dre,
        "contas_prioritarias_para_tool": [item for item in context.candidatas_tool if item.get("tool_priority")],
        "contas_com_desvio_identificadas": context.candidatas_tool,
    }

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": _json_dumps(user_prompt, indent=2)},
    ]


def _build_stage_messages(
    *,
    system_prompt: str,
    user_content: str,
) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


def _invoke_tool_buscar_detalhes_lancamentos(
    db: Session,
    *,
    empresa_id: int,
    ano: int,
    plano_conta_id: int,
    mes: int,
) -> dict[str, Any]:
    inicio, fim = _month_bounds(ano, mes)
    plano = db.get(PlanoContas, plano_conta_id)
    if not plano or plano.empresa_id != empresa_id:
        return {
            "erro": "plano_conta_nao_encontrado_ou_fornecedor_invalido",
            "plano_conta_id": plano_conta_id,
            "mes": mes,
            "ano": ano,
        }

    rows = db.exec(
        select(Lancamento)
        .where(Lancamento.empresa_id == empresa_id)
        .where(Lancamento.is_deleted == False)
        .where(Lancamento.plano_contas_id == plano_conta_id)
        .where(Lancamento.data_vencimento >= inicio)
        .where(Lancamento.data_vencimento <= fim)
        .order_by(Lancamento.data_vencimento, Lancamento.id)  # type: ignore
    ).all()

    ofensores: list[dict[str, Any]] = []
    total_previsto = ZERO
    total_pago = ZERO
    total_delta = ZERO
    total_abertos = 0

    for lancamento in rows:
        valor_previsto = _decimal(lancamento.valor_previsto)
        valor_pago = _decimal(lancamento.valor_pago)
        delta = valor_pago - valor_previsto
        total_previsto += valor_previsto
        total_pago += valor_pago
        total_delta += delta
        if str(lancamento.status or "").upper() != "PAGO":
            total_abertos += 1

        ofensores.append(
            {
                "id": lancamento.id,
                "descricao": lancamento.descricao,
                "tipo": lancamento.tipo,
                "status": lancamento.status,
                "origem": lancamento.origem,
                "data_vencimento": lancamento.data_vencimento.isoformat() if lancamento.data_vencimento else None,
                "data_pagamento": lancamento.data_pagamento.isoformat() if lancamento.data_pagamento else None,
                "competencia": lancamento.competencia,
                "valor_previsto": _money(valor_previsto),
                "valor_pago": _money(valor_pago),
                "delta": _money(delta),
                "conta_id": lancamento.conta_id,
                "entidade_id": lancamento.entidade_id,
                "centro_custo_id": lancamento.centro_custo_id,
                "cartao_id": lancamento.cartao_id,
                "conciliado": bool(lancamento.conciliado),
                "observacao": lancamento.observacao,
                "plano_contas": {
                    "id": plano.id,
                    "codigo": plano.codigo,
                    "nome": plano.nome,
                    "tipo": plano.tipo,
                    "dre_grupo": plano.dre_grupo,
                },
            }
        )

    return {
        "plano_conta_id": plano.id,
        "ano": ano,
        "mes": mes,
        "competencia_label": _month_label(ano, mes),
        "plano_contas": {
            "id": plano.id,
            "codigo": plano.codigo,
            "nome": plano.nome,
            "tipo": plano.tipo,
            "dre_grupo": plano.dre_grupo,
            "eh_operacional": bool(plano.eh_operacional),
            "considerar_nos_resultados": bool(plano.considerar_nos_resultados),
        },
        "totais": {
            "lancamentos": len(rows),
            "abertos": total_abertos,
            "valor_previsto": _money(total_previsto),
            "valor_pago": _money(total_pago),
            "delta": _money(total_delta),
        },
        "ofensores": ofensores,
    }


def _build_tool_message_content(result: dict[str, Any]) -> str:
    return _json_dumps(result, indent=2)


async def _post_chat_completion(messages: list[dict[str, Any]], *, max_tokens: int, temperature: float, tools: list[dict[str, Any]] | None = None, timeout: int | None = None) -> dict[str, Any]:
    if not settings.OPENAI_API_KEY:
        raise AiConsultantServiceError("OPENAI_API_KEY nao configurada para o serviço de consultoria financeira.")

    payload: dict[str, Any] = {
        "model": settings.OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    def _do_request() -> dict[str, Any]:
        response = requests.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout or STAGE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()

    try:
        return await asyncio.to_thread(_do_request)
    except requests.Timeout as exc:
        raise AiConsultantServiceError("Timeout ao chamar a API de IA.") from exc
    except requests.RequestException as exc:
        raise AiConsultantServiceError(f"Falha na API de IA: {exc}") from exc


async def _run_stage_with_tools(
    *,
    stage_name: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    timeout_seconds: int,
    max_tokens: int,
    temperature: float,
    tool_executor: Callable[[str | None, dict[str, Any]], Any],
) -> str:
    pending_messages = list(messages)
    tool_rounds = 0

    while True:
        response = await asyncio.wait_for(
            _post_chat_completion(
                pending_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                tools=tools,
                timeout=timeout_seconds,
            ),
            timeout=timeout_seconds,
        )

        choice = (response.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = (message.get("content") or "").strip()
        tool_calls = message.get("tool_calls") or []

        pending_messages.append(
            {
                "role": "assistant",
                "content": content or None,
                "tool_calls": tool_calls or None,
            }
        )

        if not tool_calls:
            if not content:
                raise AiConsultantServiceError(f"{stage_name}: resposta vazia da IA.")
            return content

        tool_rounds += 1
        if tool_rounds > 3:
            raise AiConsultantServiceError(f"{stage_name}: excedido limite de rounds de tool calling.")

        for tool_call in tool_calls:
            function_payload = tool_call.get("function") or {}
            function_name = function_payload.get("name")
            raw_arguments = function_payload.get("arguments") or "{}"

            try:
                arguments = json.loads(raw_arguments)
            except json.JSONDecodeError:
                arguments = {}

            try:
                tool_result = tool_executor(function_name, arguments)
            except Exception as exc:  # noqa: BLE001
                tool_result = {
                    "erro": str(exc),
                    "tool": function_name,
                    "arguments": arguments,
                }

            pending_messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.get("id"),
                    "content": _build_tool_message_content(tool_result if isinstance(tool_result, dict) else {"resultado": tool_result}),
                }
            )


async def _run_stage_simple(
    *,
    stage_name: str,
    messages: list[dict[str, Any]],
    timeout_seconds: int,
    max_tokens: int,
    temperature: float,
) -> str:
    response = await asyncio.wait_for(
        _post_chat_completion(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=timeout_seconds,
        ),
        timeout=timeout_seconds,
    )

    choice = (response.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    content = (message.get("content") or "").strip()
    if not content:
        raise AiConsultantServiceError(f"{stage_name}: resposta vazia da IA.")
    return content


def _build_stage2_messages(context: DossieContext, output1: str) -> list[dict[str, Any]]:
    system_prompt = (
        "Você é um Controller Sênior. Analise os dados brutos e os lançamentos levantados pelo Analista. "
        "Escreva um diagnóstico profundo sobre Eficiência Operacional, Margem de Contribuição e impacto no Fluxo de Caixa. "
        "Encontre ineficiências ocultas. Baseie-se somente nos fatos fornecidos e, quando necessário, destaque incertezas de forma explícita."
    )
    user_content = (
        "CONTEXTO ORIGINAL DA DRE SINTÉTICA:\n"
        f"{_json_dumps(context.dre, indent=2)}\n\n"
        "OUTPUT DA ETAPA 1:\n"
        f"{output1}\n\n"
        "Agora produza um diagnóstico financeiro profundo, com foco em causa e efeito."
    )
    return _build_stage_messages(system_prompt=system_prompt, user_content=user_content)


def _build_stage3_messages(context: DossieContext, output2: str) -> list[dict[str, Any]]:
    system_prompt = (
        "Você é um Conselheiro de Administração (Board Member). Com base no diagnóstico do Controller, escreva um "
        "Sumário Executivo cirúrgico e um Plano de Ação Estratégico (cortes, investimentos, ajustes de rota) de forma direta, "
        "sem jargões motivacionais, voltado para os próximos 30 dias."
    )
    user_content = (
        "CONTEXTUALIZAÇÃO EXECUTIVA:\n"
        f"Empresa: {context.empresa_nome}\n"
        f"Competência: {context.competencia_label}\n\n"
        "OUTPUT DA ETAPA 2:\n"
        f"{output2}\n\n"
        "Entregue um sumário executivo curto, mas denso, seguido de um plano de ação pragmático para 30 dias."
    )
    return _build_stage_messages(system_prompt=system_prompt, user_content=user_content)


def _build_stage4_messages(context: DossieContext, output1: str, output2: str, output3: str) -> list[dict[str, Any]]:
    system_prompt = (
        "Você é o Editor Chefe Financeiro. Compile as análises recebidas em um Dossiê Executivo denso, detalhado e coeso. "
        "Formate ESTRITAMENTE em Markdown. Estrutura obrigatória: 1. Sumário Executivo C-Level, 2. Diagnóstico de Receitas, "
        "3. Eficiência Operacional e Custos, 4. Deep Dive de Anomalias (citando os lançamentos exatos), 5. Impacto de Caixa, "
        "6. Plano de Ação Estratégico. Desenvolva parágrafos longos e analíticos."
    )
    user_content = (
        "CONTEXTO BASE:\n"
        f"{_json_dumps(context.dre, indent=2)}\n\n"
        "MATRIZ SINTÉTICA FLATTENED:\n"
        f"{_json_dumps(context.matriz, indent=2)}\n\n"
        "OUTPUT DA ETAPA 1:\n"
        f"{output1}\n\n"
        "OUTPUT DA ETAPA 2:\n"
        f"{output2}\n\n"
        "OUTPUT DA ETAPA 3:\n"
        f"{output3}\n\n"
        "Compilação final obrigatória em Markdown, com narrativa executiva longa, precisa e sem omitir as anomalias detalhadas."
    )
    return _build_stage_messages(system_prompt=system_prompt, user_content=user_content)


async def gerar_dossie_mensal(empresa_id: int, ano: int, mes: int, considerar_po: bool) -> str:
    if mes < 1 or mes > 12:
        raise HTTPException(status_code=400, detail="Mes invalido. Use um valor entre 1 e 12.")
    if ano < 2000 or ano > 2100:
        raise HTTPException(status_code=400, detail="Ano invalido.")

    with Session(engine) as db:
        contexto = _build_dre_context(
            db,
            empresa_id=empresa_id,
            ano=ano,
            mes=mes,
            considerar_po=considerar_po,
        )

        stage1_messages = _build_stage1_messages(contexto)

        def tool_executor(function_name: str | None, arguments: dict[str, Any]) -> dict[str, Any]:
            if function_name != "buscar_detalhes_lancamentos":
                return {
                    "erro": f"tool_desconhecida:{function_name}",
                    "arguments": arguments,
                }

            plano_conta_id = int(arguments.get("plano_conta_id") or 0)
            mes_tool = int(arguments.get("mes") or mes)
            return _invoke_tool_buscar_detalhes_lancamentos(
                db,
                empresa_id=empresa_id,
                ano=ano,
                plano_conta_id=plano_conta_id,
                mes=mes_tool,
            )

        logger.info(
            "Iniciando dossie financeiro para empresa={} ano={} mes={} considerar_po={}",
            empresa_id,
            ano,
            mes,
            considerar_po,
        )

        output1 = await _run_stage_with_tools(
            stage_name="Etapa 1 - Agente de Dados",
            messages=stage1_messages,
            tools=_build_tool_schema(),
            timeout_seconds=STAGE_TIMEOUT_SECONDS,
            max_tokens=1600,
            temperature=0.15,
            tool_executor=tool_executor,
        )

        output2 = await _run_stage_simple(
            stage_name="Etapa 2 - Agente Controller",
            messages=_build_stage2_messages(contexto, output1),
            timeout_seconds=STAGE_TIMEOUT_SECONDS,
            max_tokens=2200,
            temperature=0.2,
        )

        output3 = await _run_stage_simple(
            stage_name="Etapa 3 - Agente Estrategista C-Level",
            messages=_build_stage3_messages(contexto, output2),
            timeout_seconds=STAGE_TIMEOUT_SECONDS,
            max_tokens=1400,
            temperature=0.2,
        )

        final_output = await _run_stage_simple(
            stage_name="Etapa 4 - Editor Chefe Financeiro",
            messages=_build_stage4_messages(contexto, output1, output2, output3),
            timeout_seconds=FINAL_STAGE_TIMEOUT_SECONDS,
            max_tokens=5000,
            temperature=0.25,
        )

        if not final_output.lstrip().startswith("#"):
            final_output = (
                f"# Dossiê Executivo Financeiro\n\n"
                f"{final_output}"
            )

        return final_output


__all__ = ["gerar_dossie_mensal", "AiConsultantServiceError"]