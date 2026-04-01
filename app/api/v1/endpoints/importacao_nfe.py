from __future__ import annotations

from datetime import date
from decimal import Decimal
from difflib import SequenceMatcher
import hashlib
import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from loguru import logger
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.v1.deps import get_empresa_id_from_user, require_permission
from app.db.session import get_db
from app.models.centro_custo import CentroCusto
from app.models.conta import Conta
from app.models.empresa import Empresa
from app.models.entidade import Entidade
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.services.importacao_nfe_service import NFeDocumento, parse_nfe_xml

router = APIRouter()
NFE_FILE_SIZE_LIMIT = 5 * 1024 * 1024


class NfeParcelaAnalise(BaseModel):
    indice: int
    numero_parcela: str
    data_vencimento: str
    valor: float
    descricao: str
    cfop: Optional[str] = None
    ncm: Optional[str] = None
    plano_contas_sugerido_id: Optional[int] = None
    plano_contas_sugerido_nome: Optional[str] = None
    entidade_sugerida_id: Optional[int] = None
    entidade_sugerida_nome: Optional[str] = None
    requer_entidade_manual: bool = False
    requer_categoria_manual: bool = False


class NfeItemAnalise(BaseModel):
    descricao: str
    quantidade: float
    valor_unitario: float
    valor_total: float
    cfop: Optional[str] = None
    ncm: Optional[str] = None


class NfeAnaliseResponse(BaseModel):
    chave_nfe: str
    numero_nfe: str
    serie: str
    tipo_lancamento: str
    data_emissao: str
    valor_total: float
    emitente_nome: str
    emitente_documento: str
    destinatario_nome: str
    destinatario_documento: str
    entidade_referencia_nome: str
    entidade_referencia_documento: str
    valor_produtos: float
    valor_frete: float
    valor_seguro: float
    valor_desconto: float
    valor_outros: float
    entidade_sugerida_id: Optional[int] = None
    entidade_sugerida_nome: Optional[str] = None
    plano_contas_sugerido_id: Optional[int] = None
    plano_contas_sugerido_nome: Optional[str] = None
    itens: list[NfeItemAnalise]
    parcelas: list[NfeParcelaAnalise]
    alertas: list[str]
    pode_confirmar: bool


class NfeParcelaConfirmar(BaseModel):
    indice: int = Field(ge=1)
    numero_parcela: str
    data_vencimento: date
    valor: Decimal = Field(gt=0)
    descricao: Optional[str] = None
    plano_contas_id: Optional[int] = None
    entidade_id: Optional[int] = None


class NfeConfirmarRequest(BaseModel):
    chave_nfe: str
    numero_nfe: str
    tipo_lancamento: str
    data_emissao: date
    emitente_nome: Optional[str] = None
    emitente_documento: Optional[str] = None
    emitente_nome_fantasia: Optional[str] = None
    conta_id: Optional[int] = None
    centro_custo_id: Optional[int] = None
    entidade_id: Optional[int] = None
    plano_contas_id: Optional[int] = None
    observacao: Optional[str] = None
    parcelas: list[NfeParcelaConfirmar]


class NfeConfirmarResponse(BaseModel):
    chave_nfe: str
    numero_nfe: str
    tipo_lancamento: str
    total_parcelas: int
    lancamentos_criados: int
    lancamento_ids: list[int]


def _normalize_text(value: str) -> str:
    base = unicodedata.normalize("NFKD", str(value or ""))
    no_accent = "".join(char for char in base if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", no_accent).strip().lower()


def _normalizar_nome_entidade(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _only_digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _tipo_letra(tipo_lancamento: str) -> str:
    return "R" if str(tipo_lancamento).strip().upper() == "RECEITA" else "D"


def _descricao_parcela(numero_nfe: str, indice: int, total: int) -> str:
    return f"NFE: ({numero_nfe}) Parcela {indice}/{total}"


def _resumo_itens(itens: list, limite: int = 3) -> str:
    if not itens:
        return "Sem itens detalhados no XML"

    nomes = [str(item.descricao or "Item").strip() for item in itens[:limite]]
    resumo = ", ".join(nome for nome in nomes if nome)
    restante = len(itens) - len(nomes)
    if restante > 0:
        resumo = f"{resumo} e mais {restante} item(ns)" if resumo else f"{restante} item(ns) adicionais"
    return resumo or "Itens informados no XML"


def _parcelamento_id(chave_nfe: str) -> str:
    return f"NFE-{_only_digits(chave_nfe)}"


def _import_hash(empresa_id: int, chave_nfe: str, indice: int) -> str:
    payload = f"NFE|{empresa_id}|{_only_digits(chave_nfe)}|{indice}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolver_conta(
    db: Session,
    *,
    empresa_id: int,
    conta_id: Optional[int],
) -> Optional[Conta]:
    if not conta_id:
        return None

    conta = db.exec(
        select(Conta).where(
            Conta.id == conta_id,
            Conta.empresa_id == empresa_id,
            Conta.is_deleted == False,
        )
    ).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta nao encontrada para esta empresa")
    return conta


def _resolver_centro_custo(
    db: Session,
    *,
    empresa_id: int,
    centro_custo_id: Optional[int],
    conta: Optional[Conta],
) -> Optional[int]:
    centro_resolvido = centro_custo_id or (int(conta.centro_custo_id) if conta and conta.centro_custo_id else None)
    if not centro_resolvido:
        return None

    centro = db.exec(
        select(CentroCusto.id).where(
            CentroCusto.id == centro_resolvido,
            CentroCusto.empresa_id == empresa_id,
            CentroCusto.is_deleted == False,
        )
    ).first()
    if not centro:
        raise HTTPException(status_code=404, detail="Centro de custo nao encontrado para esta empresa")
    return int(centro)


def _buscar_entidade_sugerida(
    db: Session,
    *,
    empresa_id: int,
    nome_referencia: str,
    documento_referencia: str,
) -> Optional[Entidade]:
    documento_limpo = _only_digits(documento_referencia)

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    if documento_limpo:
        for entidade in candidatos:
            if _only_digits(str(entidade.cpf_cnpj or "")) == documento_limpo:
                return entidade

    nome_ref = _normalize_text(nome_referencia)
    if not nome_ref:
        return None

    melhor: Optional[Entidade] = None
    melhor_score = 0.0
    for entidade in candidatos:
        nome_entidade = _normalize_text(str(entidade.nome or ""))
        if not nome_entidade:
            continue
        score = SequenceMatcher(None, nome_ref, nome_entidade).ratio()
        if nome_ref in nome_entidade or nome_entidade in nome_ref:
            score += 0.15
        if score > melhor_score:
            melhor = entidade
            melhor_score = score

    if melhor and melhor_score >= 0.82:
        return melhor
    return None


def _buscar_categoria_sugerida(
    db: Session,
    *,
    empresa_id: int,
    tipo_lancamento: str,
    natureza_operacao: str,
    cfops: list[str],
    ncms: list[str],
) -> Optional[PlanoContas]:
    tipo = _tipo_letra(tipo_lancamento)
    categorias = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
            PlanoContas.permite_lancamentos == True,
            PlanoContas.eh_cabecalho == False,
            PlanoContas.oculta == False,
        )
    ).all()

    categorias = [
        categoria
        for categoria in categorias
        if str(categoria.tipo or "").strip().upper().startswith(tipo)
    ]

    if not categorias:
        return None

    contexto = " ".join([
        _normalize_text(natureza_operacao),
        " ".join(cfops),
        " ".join(ncms),
    ]).strip()

    if tipo == "R":
        keywords = ["fatur", "venda", "receita", "nota", "nf"]
        if any(str(cfop).startswith(("5", "6", "7")) for cfop in cfops):
            keywords.extend(["venda", "fatur"])
    else:
        keywords = ["compra", "custo", "fornec", "fornecedor", "insumo", "despesa", "mercador", "estoque", "aquis", "revenda"]
        if any(str(cfop).startswith(("1", "2", "3")) for cfop in cfops):
            keywords.extend(["compra", "fornec"])

    melhor: Optional[PlanoContas] = None
    melhor_score = -1

    for categoria in categorias:
        nome = _normalize_text(categoria.nome)
        codigo = _normalize_text(str(categoria.codigo or ""))
        score = 0

        for keyword in keywords:
            if keyword in nome:
                score += 3
            if keyword in codigo:
                score += 2
            if keyword in contexto:
                score += 1

        if "categorizar" in nome:
            score -= 3

        if score > melhor_score:
            melhor = categoria
            melhor_score = score

    if melhor:
        return melhor
    return None


def _tipo_pessoa_por_documento(documento: str) -> str:
    return "PJ" if len(_only_digits(documento)) > 11 else "PF"


def _buscar_ou_criar_entidade_nfe(
    db: Session,
    *,
    empresa_id: int,
    documento: NFeDocumento,
) -> Entidade:
    referencia_nome = _normalizar_nome_entidade(documento.entidade_referencia_nome)
    referencia_documento = _only_digits(documento.entidade_referencia_documento)

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    for entidade in candidatos:
        if referencia_documento and _only_digits(str(entidade.cpf_cnpj or "")) == referencia_documento:
            return entidade

    melhor: Optional[Entidade] = None
    melhor_score = 0.0
    if referencia_nome:
        for entidade in candidatos:
            nome_entidade = _normalize_text(str(entidade.nome or ""))
            if not nome_entidade:
                continue
            score = SequenceMatcher(None, _normalize_text(referencia_nome), nome_entidade).ratio()
            if _normalize_text(referencia_nome) in nome_entidade or nome_entidade in _normalize_text(referencia_nome):
                score += 0.15
            if score > melhor_score:
                melhor = entidade
                melhor_score = score

    if melhor and melhor_score >= 0.82:
        return melhor

    tipo_lancamento = str(documento.tipo_lancamento or "").strip().upper()
    tipo_entidade = "FORNECEDOR" if tipo_lancamento == "DESPESA" else "CLIENTE"
    nome_base = referencia_nome or documento.emitente_nome or documento.destinatario_nome or referencia_documento or "Entidade NF-e"
    nome_fantasia = documento.emitente_nome_fantasia if tipo_lancamento == "DESPESA" else None

    nova_entidade = Entidade(
        nome=nome_base,
        tipo=tipo_entidade,
        tipo_pessoa=_tipo_pessoa_por_documento(referencia_documento),
        nome_fantasia=nome_fantasia or None,
        cpf_cnpj=referencia_documento or None,
        telefone=documento.emitente_telefone or None if tipo_lancamento == "DESPESA" else None,
        cep=documento.emitente_cep or None if tipo_lancamento == "DESPESA" else None,
        logradouro=documento.emitente_logradouro or None if tipo_lancamento == "DESPESA" else None,
        numero=documento.emitente_numero or None if tipo_lancamento == "DESPESA" else None,
        complemento=documento.emitente_complemento or None if tipo_lancamento == "DESPESA" else None,
        bairro=documento.emitente_bairro or None if tipo_lancamento == "DESPESA" else None,
        cidade=documento.emitente_cidade or None if tipo_lancamento == "DESPESA" else None,
        uf=documento.emitente_uf or None if tipo_lancamento == "DESPESA" else None,
        observacoes=f"Criada automaticamente pela importacao da NF-e {documento.numero_nfe} ({documento.chave_nfe})",
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    logger.info(
        "[NFE] Entidade criada automaticamente empresa_id={} entidade_id={} nome={} documento={}",
        empresa_id,
        nova_entidade.id,
        nova_entidade.nome,
        nova_entidade.cpf_cnpj,
    )
    return nova_entidade


def _assert_categoria_valida(
    db: Session,
    *,
    empresa_id: int,
    categoria_id: int,
    tipo_lancamento: str,
) -> PlanoContas:
    categoria = db.exec(
        select(PlanoContas).where(
            PlanoContas.id == categoria_id,
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.is_deleted == False,
        )
    ).first()
    if not categoria:
        raise HTTPException(status_code=400, detail=f"Categoria {categoria_id} nao encontrada para esta empresa")

    if categoria.eh_cabecalho or not categoria.permite_lancamentos:
        raise HTTPException(status_code=400, detail=f"Categoria {categoria_id} nao permite lancamentos")

    tipo_esperado = _tipo_letra(tipo_lancamento)
    categoria_tipo = str(categoria.tipo or "").strip().upper()
    if not categoria_tipo.startswith(tipo_esperado):
        raise HTTPException(
            status_code=400,
            detail=f"Categoria {categoria_id} incompativel com o tipo {tipo_lancamento}",
        )

    return categoria


def _assert_entidade_valida(db: Session, *, empresa_id: int, entidade_id: int) -> Entidade:
    entidade = db.exec(
        select(Entidade).where(
            Entidade.id == entidade_id,
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).first()
    if not entidade:
        raise HTTPException(status_code=400, detail=f"Entidade {entidade_id} nao encontrada para esta empresa")
    return entidade


def _resolver_entidade_confirmacao_nfe(
    db: Session,
    *,
    empresa_id: int,
    request: NfeConfirmarRequest,
) -> Entidade:
    if request.entidade_id:
        return _assert_entidade_valida(db, empresa_id=empresa_id, entidade_id=int(request.entidade_id))

    emitente_nome = _normalizar_nome_entidade(request.emitente_nome or request.emitente_nome_fantasia or "")
    emitente_documento = _only_digits(request.emitente_documento or "")

    candidatos = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            Entidade.is_deleted == False,
        )
    ).all()

    if emitente_documento:
        for entidade in candidatos:
            if _only_digits(str(entidade.cpf_cnpj or "")) == emitente_documento:
                return entidade

    if emitente_nome:
        melhor: Optional[Entidade] = None
        melhor_score = 0.0
        for entidade in candidatos:
            nome_entidade = _normalize_text(str(entidade.nome or ""))
            if not nome_entidade:
                continue
            score = SequenceMatcher(None, _normalize_text(emitente_nome), nome_entidade).ratio()
            if _normalize_text(emitente_nome) in nome_entidade or nome_entidade in _normalize_text(emitente_nome):
                score += 0.15
            if score > melhor_score:
                melhor = entidade
                melhor_score = score

        if melhor and melhor_score >= 0.82:
            return melhor

    nova_entidade = Entidade(
        nome=emitente_nome or request.emitente_nome_fantasia or "Fornecedor NF-e",
        tipo="FORNECEDOR",
        tipo_pessoa=_tipo_pessoa_por_documento(emitente_documento or request.emitente_documento or ""),
        nome_fantasia=request.emitente_nome_fantasia or None,
        cpf_cnpj=emitente_documento or None,
        status="ATIVO",
        empresa_id=empresa_id,
    )
    db.add(nova_entidade)
    db.commit()
    db.refresh(nova_entidade)
    logger.info(
        "[NFE] Entidade criada automaticamente na confirmacao empresa_id={} entidade_id={} nome={} documento={}",
        empresa_id,
        nova_entidade.id,
        nova_entidade.nome,
        nova_entidade.cpf_cnpj,
    )
    return nova_entidade


@router.post(
    "/nfe/analisar",
    response_model=NfeAnaliseResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
async def analisar_nfe_xml(
    arquivo: UploadFile = File(...),
    conta_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not arquivo.filename or not arquivo.filename.lower().endswith(".xml"):
        raise HTTPException(status_code=400, detail="Selecione um arquivo XML de NF-e")

    if arquivo.size and arquivo.size > NFE_FILE_SIZE_LIMIT:
        raise HTTPException(status_code=400, detail="Arquivo XML excede o limite de 5 MB")

    logger.info(
        "[NFE] Inicio analise XML empresa_id={} conta_id={} arquivo={}",
        empresa_id,
        conta_id,
        arquivo.filename,
    )

    try:
        _resolver_conta(db, empresa_id=empresa_id, conta_id=conta_id)

        empresa = db.exec(
            select(Empresa).where(
                Empresa.id == empresa_id,
                Empresa.is_deleted == False,
            )
        ).first()

        conteudo = await arquivo.read()
        if len(conteudo) > NFE_FILE_SIZE_LIMIT:
            raise HTTPException(status_code=400, detail="Arquivo XML excede o limite de 5 MB")

        documento: NFeDocumento = parse_nfe_xml(conteudo, empresa_cnpj=str(empresa.cnpj or "") if empresa else "")

        entidade_sugerida = _buscar_entidade_sugerida(
            db,
            empresa_id=empresa_id,
            nome_referencia=documento.entidade_referencia_nome,
            documento_referencia=documento.entidade_referencia_documento,
        )
        if not entidade_sugerida:
            entidade_sugerida = _buscar_ou_criar_entidade_nfe(
                db,
                empresa_id=empresa_id,
                documento=documento,
            )
        categoria_sugerida = _buscar_categoria_sugerida(
            db,
            empresa_id=empresa_id,
            tipo_lancamento=documento.tipo_lancamento,
            natureza_operacao=documento.natureza_operacao,
            cfops=documento.cfops,
            ncms=documento.ncms,
        )

        total_parcelas = len(documento.parcelas)
        parcelas_payload: list[NfeParcelaAnalise] = []
        for parcela in documento.parcelas:
            parcelas_payload.append(
                NfeParcelaAnalise(
                    indice=parcela.index,
                    numero_parcela=parcela.numero_label,
                    data_vencimento=parcela.data_vencimento.isoformat(),
                    valor=float(parcela.valor),
                    descricao=_descricao_parcela(documento.numero_nfe, parcela.index, total_parcelas),
                    cfop=documento.cfops[0] if documento.cfops else None,
                    ncm=documento.ncms[0] if documento.ncms else None,
                    plano_contas_sugerido_id=int(categoria_sugerida.id) if categoria_sugerida and categoria_sugerida.id else None,
                    plano_contas_sugerido_nome=categoria_sugerida.nome if categoria_sugerida else None,
                    entidade_sugerida_id=int(entidade_sugerida.id) if entidade_sugerida and entidade_sugerida.id else None,
                    entidade_sugerida_nome=entidade_sugerida.nome if entidade_sugerida else None,
                    requer_entidade_manual=False,
                    requer_categoria_manual=categoria_sugerida is None,
                )
            )

        alertas: list[str] = []
        if not categoria_sugerida:
            alertas.append(
                "Nao foi possivel sugerir uma categoria compativel. Verifique o plano de contas antes de confirmar."
            )

        logger.info(
            "[NFE] Analise concluida empresa_id={} chave_nfe={} parcelas={} alerta_count={}",
            empresa_id,
            documento.chave_nfe,
            total_parcelas,
            len(alertas),
        )

        return NfeAnaliseResponse(
            chave_nfe=documento.chave_nfe,
            numero_nfe=documento.numero_nfe,
            serie=documento.serie,
            tipo_lancamento=documento.tipo_lancamento,
            data_emissao=documento.data_emissao.isoformat(),
            valor_total=float(documento.valor_total),
            emitente_nome=documento.emitente_nome,
            emitente_documento=documento.emitente_documento,
            destinatario_nome=documento.destinatario_nome,
            destinatario_documento=documento.destinatario_documento,
            entidade_referencia_nome=documento.entidade_referencia_nome,
            entidade_referencia_documento=documento.entidade_referencia_documento,
            valor_produtos=float(documento.valor_produtos),
            valor_frete=float(documento.valor_frete),
            valor_seguro=float(documento.valor_seguro),
            valor_desconto=float(documento.valor_desconto),
            valor_outros=float(documento.valor_outros),
            entidade_sugerida_id=int(entidade_sugerida.id) if entidade_sugerida and entidade_sugerida.id else None,
            entidade_sugerida_nome=entidade_sugerida.nome if entidade_sugerida else None,
            plano_contas_sugerido_id=int(categoria_sugerida.id) if categoria_sugerida and categoria_sugerida.id else None,
            plano_contas_sugerido_nome=categoria_sugerida.nome if categoria_sugerida else None,
            itens=[
                NfeItemAnalise(
                    descricao=str(item.descricao or "").strip() or "Item",
                    quantidade=float(item.quantidade),
                    valor_unitario=float(item.valor_unitario),
                    valor_total=float(item.valor_total),
                    cfop=item.cfop or None,
                    ncm=item.ncm or None,
                )
                for item in documento.itens
            ],
            parcelas=parcelas_payload,
            alertas=alertas,
            pode_confirmar=bool(documento.parcelas),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning(
            "[NFE] Erro de validacao no XML empresa_id={} arquivo={} detalhe={}",
            empresa_id,
            arquivo.filename,
            str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "[NFE] Falha inesperada na analise empresa_id={} arquivo={} erro={}",
            empresa_id,
            arquivo.filename,
            str(exc),
        )
        raise HTTPException(status_code=500, detail="Erro interno ao analisar XML de NF-e") from exc


@router.post(
    "/nfe/confirmar",
    response_model=NfeConfirmarResponse,
    dependencies=[Depends(require_permission("lancamentos:import_nfe"))],
)
def confirmar_importacao_nfe(
    request: NfeConfirmarRequest,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    if not request.parcelas:
        raise HTTPException(status_code=400, detail="Envie ao menos uma parcela para importacao")

    tipo_lancamento = str(request.tipo_lancamento or "").strip().upper()
    if tipo_lancamento != "DESPESA":
        raise HTTPException(status_code=400, detail="Importacao de NF-e aceita apenas DESPESA")
        raise HTTPException(status_code=400, detail="Tipo de lancamento invalido para importacao NF-e")

    chave_nfe = _only_digits(request.chave_nfe)
    if not chave_nfe:
        raise HTTPException(status_code=400, detail="Chave da NF-e invalida")

    numero_nfe = str(request.numero_nfe or "").strip()
    if not numero_nfe:
        raise HTTPException(status_code=400, detail="Numero da NF-e obrigatorio")

    parcela_group_id = _parcelamento_id(chave_nfe)

    logger.info(
        "[NFE] Inicio confirmacao empresa_id={} chave_nfe={} parcelas={} conta_id={} centro_custo_id={}",
        empresa_id,
        chave_nfe,
        len(request.parcelas),
        request.conta_id,
        request.centro_custo_id,
    )

    existente = db.exec(
        select(Lancamento.id).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.id_parcelamento == parcela_group_id,
            Lancamento.origem == "NFE_XML",
            Lancamento.is_deleted == False,
        )
    ).first()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta NF-e ja foi importada para esta empresa",
        )

    conta = _resolver_conta(db, empresa_id=empresa_id, conta_id=request.conta_id)
    centro_custo_id = _resolver_centro_custo(
        db,
        empresa_id=empresa_id,
        centro_custo_id=request.centro_custo_id,
        conta=conta,
    )
    entidade_padrao = _resolver_entidade_confirmacao_nfe(db, empresa_id=empresa_id, request=request)

    hashes_lote = [_import_hash(empresa_id, chave_nfe, parcela.indice) for parcela in request.parcelas]
    if len(set(hashes_lote)) != len(hashes_lote):
        raise HTTPException(status_code=400, detail="Parcelas duplicadas no payload de confirmacao")

    lancamento_table = getattr(Lancamento, "__table__")
    existing_hash = db.exec(
        select(Lancamento.import_hash).where(
            lancamento_table.c.empresa_id == empresa_id,
            lancamento_table.c.is_deleted == False,
            lancamento_table.c.import_hash.in_(hashes_lote),
        )
    ).first()
    if existing_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ja existe lancamento importado para uma ou mais parcelas desta NF-e",
        )

    lancamentos: list[Lancamento] = []
    total_parcelas = len(request.parcelas)

    try:
        for parcela in request.parcelas:
            categoria_id = int(parcela.plano_contas_id or request.plano_contas_id or 0)
            if not categoria_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Parcela {parcela.indice} sem categoria. Defina uma categoria padrao antes de confirmar.",
                )
            _assert_categoria_valida(
                db,
                empresa_id=empresa_id,
                categoria_id=categoria_id,
                tipo_lancamento=tipo_lancamento,
            )

            entidade_id = int(parcela.entidade_id or request.entidade_id or entidade_padrao.id or 0)
            if not entidade_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Parcela {parcela.indice} sem entidade. Nao foi possivel resolver o emitente da NF-e.",
                )
            _assert_entidade_valida(db, empresa_id=empresa_id, entidade_id=entidade_id)

            descricao = str(parcela.descricao or "").strip() or _descricao_parcela(
                numero_nfe,
                parcela.indice,
                total_parcelas,
            )

            data_competencia = request.data_emissao or parcela.data_vencimento
            competencia = data_competencia.strftime("%m/%Y")
            import_hash = _import_hash(empresa_id, chave_nfe, parcela.indice)

            observacao_base = str(request.observacao or f"NF-e {numero_nfe} | Chave {chave_nfe}").strip()
            lancamento = Lancamento(
                descricao=descricao,
                tipo=tipo_lancamento,
                origem="NFE_XML",
                ipp=False,
                previsto=True,
                valor_previsto=parcela.valor,
                valor_pago=Decimal("0.00"),
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=parcela.data_vencimento,
                data_pagamento=None,
                data_competencia=data_competencia,
                competencia=competencia,
                numero_parcela=parcela.indice,
                id_parcelamento=parcela_group_id,
                observacao=observacao_base,
                conciliado=False,
                import_hash=import_hash,
                transferencia_grupo_id=None,
                empresa_id=empresa_id,
                plano_contas_id=categoria_id,
                conta_id=int(conta.id) if conta and conta.id else None,
                entidade_id=entidade_id,
                cartao_id=None,
                centro_custo_id=centro_custo_id,
            )
            db.add(lancamento)
            lancamentos.append(lancamento)

        db.commit()

        lancamento_ids: list[int] = []
        for lancamento in lancamentos:
            db.refresh(lancamento)
            if lancamento.id is not None:
                lancamento_ids.append(int(lancamento.id))

        logger.info(
            "[NFE] Confirmacao concluida empresa_id={} chave_nfe={} lancamentos_criados={}",
            empresa_id,
            chave_nfe,
            len(lancamento_ids),
        )

        return NfeConfirmarResponse(
            chave_nfe=chave_nfe,
            numero_nfe=numero_nfe,
            tipo_lancamento=tipo_lancamento,
            total_parcelas=total_parcelas,
            lancamentos_criados=len(lancamento_ids),
            lancamento_ids=lancamento_ids,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception(
            "[NFE] Falha inesperada na confirmacao empresa_id={} chave_nfe={} erro={}",
            empresa_id,
            chave_nfe,
            str(exc),
        )
        raise HTTPException(status_code=500, detail="Erro interno ao confirmar importacao NF-e") from exc
