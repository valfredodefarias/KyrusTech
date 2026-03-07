import hashlib
import hmac
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Literal, Optional

import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from loguru import logger
from sqlmodel import Session, select

from app.api.v1.deps import get_current_user, get_empresa_id_from_user
from app.core.config import settings
from app.db.session import get_db
from app.models.cartao import Cartao
from app.models.centro_custo import CentroCusto
from app.models.conta import Conta
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas
from app.models.usuario import Usuario
from app.schemas.lancamento import LancamentoCreate
from app.services.lancamento_service import LancamentoService

router = APIRouter()

SAFE_REFUSAL_MESSAGE = (
    "Nao posso ajudar com esse pedido. Posso explicar somente os dados financeiros "
    "da tela atual, sem expor informacoes sensiveis, tecnicas ou de outras empresas."
)

SENSITIVE_KEY_PARTS = {
    "senha",
    "password",
    "token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
    "cpf",
    "cnpj",
    "email",
    "telefone",
    "celular",
    "endereco",
}

FORBIDDEN_REQUEST_PATTERNS = [
    re.compile(r"\b(api|endpoint|backend|servidor|infra|docker|nginx|sql|query|script|comando)\b", re.IGNORECASE),
    re.compile(r"\b(chave|senha|token|credencial|segredo|secret|api[_\s-]?key)\b", re.IGNORECASE),
    re.compile(r"\b(prompt\s+do\s+sistema|system\s+prompt|ignore\s+as\s+instrucoes)\b", re.IGNORECASE),
    re.compile(r"\b(outra\s+empresa|empresas?\s+de\s+outros|dados\s+de\s+outras?)\b", re.IGNORECASE),
    re.compile(r"\b(hip[oó]tese|hipot[ée]tico|suponha|imagine)\b.*\b(api|backend|banco|dados\s+internos|credenciais)\b", re.IGNORECASE),
]

FORBIDDEN_RESPONSE_PATTERNS = [
    re.compile(r"\b(api[_\s-]?key|secret|token|password|senha)\b", re.IGNORECASE),
    re.compile(r"\b(select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from)\b", re.IGNORECASE),
    re.compile(r"\b(/api/v\d|authorization:|bearer\s+[a-z0-9._-]+)\b", re.IGNORECASE),
]

ACTIONABLE_LANCAMENTO_PATTERNS = [
    re.compile(r"\b(criar|gerar|incluir|adicionar|lancar|lan[cç]ar|lan[cç]amento|lancamentos)\b", re.IGNORECASE),
    re.compile(r"\b(aluguel|sal[áa]rio|previs[oõ]es?|recorrente|parcela|mensal|anual|ano\s+inteiro)\b", re.IGNORECASE),
    re.compile(r"\b(alterar|editar|atualizar)\s+lan[cç]amentos?\b", re.IGNORECASE),
]


class PlanoLancamentoItem(BaseModel):
    descricao: str
    tipo: Literal["RECEITA", "DESPESA"]
    valor_previsto: Decimal
    data_vencimento: str
    plano_contas_id: int
    previsto: bool = True
    conta_id: Optional[int] = None
    entidade_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    cartao_id: Optional[int] = None
    competencia: Optional[str] = None
    observacao: Optional[str] = None
    data_pagamento: Optional[str] = None


class AssistenteAnexo(BaseModel):
    nome: str = Field(min_length=1, max_length=140)
    mime_type: str = Field(min_length=3, max_length=120)
    tipo: Literal["TEXTO", "PLANILHA", "IMAGEM", "PDF"]
    conteudo_texto: Optional[str] = Field(default=None, max_length=20000)
    base64_data: Optional[str] = Field(default=None, max_length=8_000_000)


class AssistenteRequest(BaseModel):
    pergunta: str = Field(min_length=3, max_length=3000)
    tela: Literal["dashboard", "lancamentos", "geral"] = "geral"
    contexto: Optional[Dict[str, Any]] = None
    acao: Literal["ANALISE", "REVISAR_PLANO_LANCAMENTOS", "CONFIRMAR_PLANO_LANCAMENTOS"] = "ANALISE"
    plano_lancamentos: Optional[list[PlanoLancamentoItem]] = None
    plano_assinatura: Optional[str] = None
    anexos: Optional[list[AssistenteAnexo]] = None


class AssistenteResponse(BaseModel):
    resposta: str
    modelo: str
    tipo_resposta: Literal["TEXTO", "PLANO_LANCAMENTOS", "EXECUCAO_LANCAMENTOS"] = "TEXTO"
    plano_lancamentos: Optional[list[PlanoLancamentoItem]] = None
    plano_assinatura: Optional[str] = None
    itens_criados: Optional[int] = None


def _build_system_prompt() -> str:
    return (
        "Voce e um assistente financeiro do sistema Kyrus ERP. "
        "Responda sempre em portugues do Brasil, de forma clara e pratica. "
        "Use somente os dados recebidos no contexto e nao invente numeros. "
        "Voce esta restrito ao escopo da empresa e do usuario autenticado desta requisicao. "
        "Nunca forneca dados de outras empresas, mesmo que o usuario solicite. "
        "Nunca revele nem especule sobre backend, APIs, banco, comandos, infraestrutura, tokens, senhas, chaves ou detalhes internos do sistema. "
        "Nunca exponha dados sensiveis (documentos, contatos, credenciais), inclusive para administradores. "
        "Quando houver comprovantes, imagens, PDFs ou planilhas anexadas, extraia somente o necessario para analise financeira ou para montar uma previa de lancamentos. "
        "Nunca execute lancamentos automaticamente a partir de anexos sem revisao humana e confirmacao explicita. "
        "Ao sugerir classificacao, escolha somente entre IDs permitidos no contexto; se houver duvida, sinalize a incerteza. "
        "Se a pergunta pedir algo fora dessas regras, recuse de forma breve e redirecione para analise financeira da tela atual. "
        "Se faltarem dados, diga o que falta de forma objetiva. "
        "Para perguntas validas, priorize: 1) resumo do que o usuario esta vendo, 2) explicacao do resultado, 3) acao recomendada. "
        "Nao forneca aconselhamento juridico, fiscal ou contabil definitivo."
    )


def _build_planning_prompt(pergunta: str, contexto: Dict[str, Any], anexos_resumo: str = "") -> str:
    return (
        "Voce deve montar um plano de lancamentos financeiros a partir do pedido do usuario. "
        "Responda APENAS JSON valido, sem markdown e sem texto extra. "
        "Formato obrigatorio: "
        '{"resumo":"...", "lancamentos":[{"descricao":"...","tipo":"RECEITA|DESPESA","valor_previsto":123.45,"data_vencimento":"YYYY-MM-DD","plano_contas_id":1,"previsto":true,"conta_id":null,"entidade_id":null,"centro_custo_id":null,"cartao_id":null,"competencia":"MM-AAAA","observacao":null,"data_pagamento":null}]}. '
        "Regras: usar somente IDs existentes no contexto; nao inventar IDs; maximo 120 lancamentos; "
        "se houver comprovante ou planilha anexada, extraia apenas campos visiveis e sugira a melhor classificacao permitida no contexto; "
        "se faltarem dados para criar com seguranca, retorne lancamentos vazio e explique no resumo. "
        f"Pedido do usuario: {pergunta}\n"
        f"Resumo dos anexos: {anexos_resumo or 'sem anexos'}\n"
        f"Contexto JSON: {json.dumps(contexto, ensure_ascii=False)}"
    )


def _is_sensitive_key(key: str) -> bool:
    key_l = key.strip().lower()
    return any(part in key_l for part in SENSITIVE_KEY_PARTS)


def _sanitize_context(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "[MAX_DEPTH]"

    if isinstance(value, dict):
        sanitized: Dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 120:
                sanitized["_truncated"] = True
                break
            key = str(k)
            if _is_sensitive_key(key):
                sanitized[key] = "[REDACTED]"
            else:
                sanitized[key] = _sanitize_context(v, depth + 1)
        return sanitized

    if isinstance(value, list):
        return [_sanitize_context(v, depth + 1) for v in value[:120]]

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    text = str(value)
    return text[:600]


def _contains_forbidden_request(text: str) -> bool:
    return any(pattern.search(text) for pattern in FORBIDDEN_REQUEST_PATTERNS)


def _contains_forbidden_response(text: str) -> bool:
    return any(pattern.search(text) for pattern in FORBIDDEN_RESPONSE_PATTERNS)


def _is_actionable_lancamento_request(text: str) -> bool:
    return any(pattern.search(text) for pattern in ACTIONABLE_LANCAMENTO_PATTERNS)


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        snippet = text[start : end + 1]
        parsed = json.loads(snippet)
        if isinstance(parsed, dict):
            return parsed

    raise HTTPException(status_code=502, detail="Falha ao interpretar plano da IA.")


def _prepare_attachment_payloads(anexos: Optional[list[AssistenteAnexo]], provider: str) -> tuple[list[Dict[str, Any]], str]:
    if not anexos:
        return [], ""

    if len(anexos) > 4:
        raise HTTPException(status_code=422, detail="Envie no maximo 4 anexos por vez.")

    gemini_parts: list[Dict[str, Any]] = []
    resumos: list[str] = []

    for idx, anexo in enumerate(anexos, start=1):
        mime_type = anexo.mime_type.strip().lower()
        nome = anexo.nome.strip()[:140]
        resumo_base = f"Anexo {idx}: {nome} ({mime_type})"

        if anexo.tipo in {"TEXTO", "PLANILHA"}:
            if not anexo.conteudo_texto:
                raise HTTPException(status_code=422, detail=f"Conteudo textual ausente no anexo {idx}.")
            texto = anexo.conteudo_texto.replace("\x00", " ").strip()[:16000]
            resumos.append(f"{resumo_base}\nConteudo extraido:\n{texto}")
            continue

        if anexo.tipo == "IMAGEM":
            if not mime_type.startswith("image/"):
                raise HTTPException(status_code=422, detail=f"Tipo MIME invalido no anexo {idx}.")
        elif anexo.tipo == "PDF":
            if mime_type != "application/pdf":
                raise HTTPException(status_code=422, detail=f"Tipo MIME invalido no anexo {idx}.")

        if not anexo.base64_data:
            raise HTTPException(status_code=422, detail=f"Arquivo binario ausente no anexo {idx}.")

        if provider == "gemini":
            gemini_parts.append({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": anexo.base64_data,
                }
            })
            resumos.append(f"{resumo_base}\nUse o arquivo somente para leitura, classificacao sugerida e montagem de previa revisavel.")
        else:
            resumos.append(f"{resumo_base}\nArquivo visual enviado. Neste provedor, use apenas a descricao textual da conversa para responder.")

    return gemini_parts, "\n\n".join(resumos)


def _serialize_plan_for_signature(items: list[PlanoLancamentoItem], empresa_id: int) -> str:
    payload = {
        "empresa_id": empresa_id,
        "plano_lancamentos": [item.model_dump(mode="json") for item in items],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _sign_plan(items: list[PlanoLancamentoItem], empresa_id: int) -> str:
    message = _serialize_plan_for_signature(items, empresa_id).encode("utf-8")
    key = settings.SECRET_KEY.encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def _verify_plan_signature(items: list[PlanoLancamentoItem], assinatura: str, empresa_id: int) -> bool:
    expected = _sign_plan(items, empresa_id)
    return hmac.compare_digest(expected, assinatura)


def _validate_competencia(value: str) -> bool:
    return bool(re.match(r"^(0[1-9]|1[0-2])-\d{4}$", value or ""))


def _validate_and_convert_plan(
    items: list[PlanoLancamentoItem],
    empresa_id: int,
    session: Session,
) -> list[LancamentoCreate]:
    if not items:
        raise HTTPException(status_code=422, detail="Plano sem lancamentos para executar.")
    if len(items) > 120:
        raise HTTPException(status_code=422, detail="Plano excede o limite de 120 lancamentos.")

    planos = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa_id)).all()
    contas = session.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
    entidades = session.exec(select(Entidade).where(Entidade.empresa_id == empresa_id)).all()
    centros = session.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).all()
    cartoes = session.exec(select(Cartao).where(Cartao.empresa_id == empresa_id)).all()

    plano_ids = {int(p.id) for p in planos if p.id is not None}
    conta_ids = {int(c.id) for c in contas if c.id is not None}
    entidade_ids = {int(e.id) for e in entidades if e.id is not None}
    centro_ids = {int(c.id) for c in centros if c.id is not None}
    cartao_ids = {int(c.id) for c in cartoes if c.id is not None}

    converted: list[LancamentoCreate] = []

    for idx, item in enumerate(items, start=1):
        if item.plano_contas_id not in plano_ids:
            raise HTTPException(status_code=422, detail=f"Plano invalido no item {idx}.")
        if item.conta_id is not None and item.conta_id not in conta_ids:
            raise HTTPException(status_code=422, detail=f"Conta invalida no item {idx}.")
        if item.entidade_id is not None and item.entidade_id not in entidade_ids:
            raise HTTPException(status_code=422, detail=f"Entidade invalida no item {idx}.")
        if item.centro_custo_id is not None and item.centro_custo_id not in centro_ids:
            raise HTTPException(status_code=422, detail=f"Centro de custo invalido no item {idx}.")
        if item.cartao_id is not None and item.cartao_id not in cartao_ids:
            raise HTTPException(status_code=422, detail=f"Cartao invalido no item {idx}.")

        try:
            valor = Decimal(str(item.valor_previsto))
        except (InvalidOperation, ValueError):
            raise HTTPException(status_code=422, detail=f"Valor invalido no item {idx}.")
        if valor <= 0:
            raise HTTPException(status_code=422, detail=f"Valor deve ser positivo no item {idx}.")

        try:
            data_vencimento = date.fromisoformat(item.data_vencimento)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Data de vencimento invalida no item {idx}.")

        data_pagamento = None
        if item.data_pagamento:
            try:
                data_pagamento = date.fromisoformat(item.data_pagamento)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Data de pagamento invalida no item {idx}.")

        competencia = item.competencia
        if competencia and not _validate_competencia(competencia):
            raise HTTPException(status_code=422, detail=f"Competencia invalida no item {idx}. Use MM-AAAA.")

        converted.append(
            LancamentoCreate(
                descricao=item.descricao.strip()[:255],
                tipo=item.tipo,
                origem="WEB",
                ipp=False,
                previsto=bool(item.previsto),
                valor_previsto=valor,
                valor_pago=valor if data_pagamento else Decimal("0.00"),
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=data_vencimento,
                competencia=competencia,
                data_pagamento=data_pagamento,
                observacao=(item.observacao or "")[:500] or None,
                conciliado=False,
                plano_contas_id=item.plano_contas_id,
                conta_id=item.conta_id,
                entidade_id=item.entidade_id,
                centro_custo_id=item.centro_custo_id,
                cartao_id=item.cartao_id,
            )
        )

    return converted


def _resolve_llm_provider() -> tuple[str, str, int]:
    provider = (settings.AI_PROVIDER or "gemini").strip().lower()

    if provider == "gemini":
        if not settings.GEMINI_API_KEY:
            raise HTTPException(status_code=503, detail="Assistente IA indisponivel no momento.")
        return provider, settings.GEMINI_MODEL, settings.AI_TIMEOUT_SECONDS

    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise HTTPException(status_code=503, detail="Assistente IA indisponivel no momento.")
        timeout = settings.AI_TIMEOUT_SECONDS or settings.OPENAI_TIMEOUT_SECONDS
        return provider, settings.OPENAI_MODEL, timeout

    raise HTTPException(status_code=500, detail="Provedor de IA invalido na configuracao.")


def _call_llm(provider: str, modelo: str, user_prompt: str, timeout: int, temperature: float = 0.2, max_tokens: int = 500, attachment_parts: Optional[list[Dict[str, Any]]] = None) -> str:
    if provider == "openai":
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": modelo,
                "messages": [
                    {"role": "system", "content": _build_system_prompt()},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

    # Gemini
    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
        params={"key": settings.GEMINI_API_KEY},
        headers={"Content-Type": "application/json"},
        json={
            "contents": [
                {
                    "role": "user",
                    "parts": [*(attachment_parts or []), {"text": f"{_build_system_prompt()}\n\n{user_prompt}"}],
                }
            ],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()

    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    content = candidates[0].get("content", {})
    parts = content.get("parts") or []
    texts = [str(p.get("text", "")) for p in parts if isinstance(p, dict)]
    return "\n".join(t for t in texts if t).strip()


@router.post("/assistente", response_model=AssistenteResponse)
def perguntar_assistente(
    payload: AssistenteRequest,
    current_user: Usuario = Depends(get_current_user),
    empresa_id: int = Depends(get_empresa_id_from_user),
    db: Session = Depends(get_db),
):
    _ = current_user

    provider, modelo, llm_timeout = _resolve_llm_provider()

    if payload.acao == "CONFIRMAR_PLANO_LANCAMENTOS":
        if payload.tela != "lancamentos":
            raise HTTPException(status_code=400, detail="Acao permitida apenas na tela de lancamentos.")
        if not payload.plano_lancamentos or not payload.plano_assinatura:
            raise HTTPException(status_code=400, detail="Plano e assinatura sao obrigatorios para confirmar.")
        if not _verify_plan_signature(payload.plano_lancamentos, payload.plano_assinatura, empresa_id):
            raise HTTPException(status_code=403, detail="Plano invalido ou alterado. Gere uma nova previa.")

        lista_create = _validate_and_convert_plan(payload.plano_lancamentos, empresa_id, db)
        service = LancamentoService(db)
        criados = service.criar_em_massa(lista_create, empresa_id, int(current_user.id or 0))

        return AssistenteResponse(
            resposta=f"Concluido. Criei {len(criados)} lancamento(s) com sucesso.",
            modelo="policy-local",
            tipo_resposta="EXECUCAO_LANCAMENTOS",
            itens_criados=len(criados),
        )

    if payload.acao == "REVISAR_PLANO_LANCAMENTOS":
        if payload.tela != "lancamentos":
            raise HTTPException(status_code=400, detail="Acao permitida apenas na tela de lancamentos.")
        if not payload.plano_lancamentos:
            raise HTTPException(status_code=400, detail="Plano obrigatorio para revisao.")

        lista_create = _validate_and_convert_plan(payload.plano_lancamentos, empresa_id, db)
        _ = lista_create
        assinatura = _sign_plan(payload.plano_lancamentos, empresa_id)
        return AssistenteResponse(
            resposta="Revisei o plano editado. Se estiver correto, agora voce pode confirmar a criacao.",
            modelo="policy-local",
            tipo_resposta="PLANO_LANCAMENTOS",
            plano_lancamentos=payload.plano_lancamentos,
            plano_assinatura=assinatura,
        )

    pergunta = payload.pergunta.strip()
    if _contains_forbidden_request(pergunta):
        return AssistenteResponse(resposta=SAFE_REFUSAL_MESSAGE, modelo="policy-local")

    contexto_sanitizado = _sanitize_context(payload.contexto or {})
    attachment_parts, anexos_resumo = _prepare_attachment_payloads(payload.anexos, provider)
    if payload.tela == "lancamentos" and _is_actionable_lancamento_request(pergunta):
        try:
            planning_prompt = _build_planning_prompt(pergunta, contexto_sanitizado, anexos_resumo)
            raw_plan = _call_llm(provider=provider, modelo=modelo, user_prompt=planning_prompt, timeout=llm_timeout, temperature=0.1, max_tokens=1200, attachment_parts=attachment_parts)
            parsed = _extract_json_object(raw_plan)

            resumo = str(parsed.get("resumo") or "Revise os lancamentos sugeridos abaixo antes de confirmar.").strip()
            lancamentos_raw = parsed.get("lancamentos") or []
            if not isinstance(lancamentos_raw, list):
                raise HTTPException(status_code=502, detail="Plano da IA em formato invalido.")

            plano_items = [PlanoLancamentoItem.model_validate(item) for item in lancamentos_raw]

            # Valida ownership e dados antes da confirmacao para garantir preview consistente.
            _validate_and_convert_plan(plano_items, empresa_id, db)
            assinatura = _sign_plan(plano_items, empresa_id)

            return AssistenteResponse(
                resposta=resumo,
                modelo=modelo,
                tipo_resposta="PLANO_LANCAMENTOS",
                plano_lancamentos=plano_items,
                plano_assinatura=assinatura,
            )
        except HTTPException:
            raise
        except requests.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else "unknown"
            body = (exc.response.text[:1000] if exc.response is not None and exc.response.text else "")
            logger.error(f"Falha no provedor IA (planejamento). status={status_code} body={body}")
            raise HTTPException(status_code=502, detail="Falha ao consultar o provedor de IA.")
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="Falha de rede ao consultar o provedor de IA.")
        except Exception:
            raise HTTPException(status_code=422, detail="Nao consegui montar um plano seguro com os dados atuais.")

    user_prompt = (
        f"Empresa ID: {empresa_id}\n"
        f"Tela: {payload.tela}\n"
        f"Resumo dos anexos: {anexos_resumo or 'sem anexos'}\n"
        f"Contexto JSON: {json.dumps(contexto_sanitizado, ensure_ascii=False)}\n\n"
        f"Pergunta: {pergunta}"
    )

    try:
        content = _call_llm(provider=provider, modelo=modelo, user_prompt=user_prompt, timeout=llm_timeout, temperature=0.2, max_tokens=500, attachment_parts=attachment_parts)
        if not content:
            raise HTTPException(status_code=502, detail="Assistente IA sem resposta no momento.")
        if _contains_forbidden_response(content):
            return AssistenteResponse(resposta=SAFE_REFUSAL_MESSAGE, modelo="policy-local")
        return AssistenteResponse(resposta=content, modelo=modelo)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else "unknown"
        body = (exc.response.text[:1000] if exc.response is not None and exc.response.text else "")
        logger.error(f"Falha no provedor IA (analise). status={status_code} body={body}")
        raise HTTPException(status_code=502, detail="Falha ao consultar o provedor de IA.")
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Falha de rede ao consultar o provedor de IA.")
