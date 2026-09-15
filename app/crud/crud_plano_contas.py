# app/crud/crud_plano_contas.py

import re
from copy import deepcopy
from typing import Any, Optional

from sqlalchemy import inspect
from sqlalchemy.exc import ProgrammingError
from sqlmodel import Session, select

from app.models.plano_contas import PlanoContas
from app.models.plano_contas_template_config import PlanoContasTemplateConfig
from app.schemas.plano_contas import PlanoContasCreate, PlanoContasUpdate


TemplateNode = dict[str, Any]
TemplateItem = dict[str, Any]

TEMPLATE_CONFIG_KEYS = {
    "PF": "template-default-pf",
    "PJ": "template-default-pj",
}
TRANSFER_CATEGORY_NAME = "Transferencias internas"
AUTHORIZED_OPERATIONAL_EMAIL = "cirocaue12@gmail.com"
DRE_GRUPOS_VALIDOS = {
    "RECEITA_BRUTA",
    "DEDUCOES_RECEITA",
    "CUSTOS_VARIAVEIS",
    "DESPESAS_OPERACIONAIS",
    "OUTRAS_RECEITAS",
    "OUTRAS_DESPESAS",
    "NAO_OPERACIONAL",
}


def _apply_model_update(db_obj, update_data: dict) -> None:
    if hasattr(db_obj, "sqlmodel_update"):
        db_obj.sqlmodel_update(update_data)
        return
    for campo, valor in update_data.items():
        setattr(db_obj, campo, valor)


def _normalizar_tipo_plano(tipo: Optional[str], default: str = "D") -> str:
    valor = (tipo or "").strip().upper()
    if valor.startswith("R"):
        return "R"
    if valor.startswith("D"):
        return "D"
    return default


def _normalizar_tipo_pessoa(tipo_pessoa: Optional[str]) -> str:
    valor = (tipo_pessoa or "PJ").strip().upper()
    return "PF" if valor == "PF" else "PJ"


def _strip_codigo_prefixo(nome: str) -> str:
    texto = (nome or "").strip()
    match = re.match(r"^\s*\d+(?:\.\d+)*\.?\s+(.+)$", texto)
    if match:
        return match.group(1).strip()
    return texto


def can_manage_operational_flag(user_email: Optional[str], consultor_role: Optional[str] = None) -> bool:
    if consultor_role and str(consultor_role).strip().upper() == "SUPER_CONSULTOR":
        return True
    return (user_email or "").strip().lower() == AUTHORIZED_OPERATIONAL_EMAIL


def _default_dre_grupo_por_tipo(tipo: Optional[str]) -> str:
    return "RECEITA_BRUTA" if _normalizar_tipo_plano(tipo, default="D") == "R" else "DESPESAS_OPERACIONAIS"


def _normalizar_dre_grupo(valor: Optional[str], tipo: Optional[str]) -> str:
    normalized = (valor or "").strip().upper()
    if normalized in DRE_GRUPOS_VALIDOS:
        return normalized
    return _default_dre_grupo_por_tipo(tipo)


def _sort_items_by_code(items: list[Any]) -> list[Any]:
    return sorted(items, key=lambda item: (str(getattr(item, "codigo", None) if not isinstance(item, dict) else item.get("codigo") or "zzz"), str(getattr(item, "nome", None) if not isinstance(item, dict) else item.get("nome") or "")))


def sync_company_operational_hierarchy(db: Session, *, empresa_id: int) -> None:
    contas = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.oculta == False,
        )
    ).all()
    if not contas:
        return

    filhos_por_pai: dict[int, list[PlanoContas]] = {}
    roots: list[PlanoContas] = []
    for conta in contas:
        parent_id = int(conta.conta_pai_id) if conta.conta_pai_id is not None else None
        if parent_id is None:
            roots.append(conta)
            continue
        filhos_por_pai.setdefault(parent_id, []).append(conta)

    updated = False

    def walk(conta: PlanoContas, parent_effective: Optional[bool]) -> None:
        nonlocal updated
        current_value = bool(conta.eh_operacional)
        # Regra: pai operacional propaga True para os filhos; pai nao operacional nao forca False.
        effective_value = current_value if parent_effective is None else (parent_effective or current_value)

        if conta.eh_operacional != effective_value:
            conta.eh_operacional = effective_value
            db.add(conta)
            updated = True

        for child in _sort_items_by_code(filhos_por_pai.get(int(conta.id or 0), [])):
            walk(child, effective_value)

    for root in _sort_items_by_code(roots):
        walk(root, None)

    if updated:
        db.commit()


def sync_template_operational_hierarchy(items: list[TemplateItem]) -> list[TemplateItem]:
    filhos_por_pai: dict[int, list[TemplateItem]] = {}
    roots: list[TemplateItem] = []
    items_index = {int(item["id"]): item for item in items}

    for item in items:
        parent_id = item.get("conta_pai_id")
        if parent_id is None or int(parent_id) not in items_index:
            roots.append(item)
            continue
        filhos_por_pai.setdefault(int(parent_id), []).append(item)

    def item_sort_key(item: TemplateItem) -> tuple[str, str]:
        return (str(item.get("codigo") or "zzz"), str(item.get("nome") or ""))

    def walk(item: TemplateItem, parent_effective: Optional[bool]) -> None:
        current_value = bool(item.get("eh_operacional", True))
        # Regra alinhada ao frontend: heranca so propaga operacional=True.
        effective_value = current_value if parent_effective is None else (parent_effective or current_value)
        item["eh_operacional"] = effective_value
        for child in sorted(filhos_por_pai.get(int(item["id"]), []), key=item_sort_key):
            walk(child, effective_value)

    for root in sorted(roots, key=item_sort_key):
        walk(root, None)

    return items


def _pf_template_nodes() -> list[TemplateNode]:
    return [
        {
            "nome": "Receitas",
            "tipo": "R",
            "dre_grupo": "RECEITA_BRUTA",
            "permite_lancamentos": False,
            "children": [
                {
                    "nome": "Renda Principal",
                    "tipo": "R",
                    "dre_grupo": "RECEITA_BRUTA",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Salario", "tipo": "R"},
                        {"nome": "Pro-labore", "tipo": "R"},
                    ],
                },
                {
                    "nome": "Rendas Extras",
                    "tipo": "R",
                    "dre_grupo": "OUTRAS_RECEITAS",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Freelance", "tipo": "R"},
                        {"nome": "Rendimentos", "tipo": "R"},
                    ],
                },
            ],
        },
        {
            "nome": "Despesas",
            "tipo": "D",
            "dre_grupo": "DESPESAS_OPERACIONAIS",
            "permite_lancamentos": False,
            "children": [
                {
                    "nome": "Moradia",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Aluguel", "tipo": "D"},
                        {"nome": "Condominio", "tipo": "D"},
                        {"nome": "Agua e Luz", "tipo": "D"},
                    ],
                },
                {
                    "nome": "Alimentacao",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Mercado", "tipo": "D"},
                        {"nome": "Restaurantes", "tipo": "D"},
                    ],
                },
                {
                    "nome": "Transporte",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Combustivel", "tipo": "D"},
                        {"nome": "Uber/Taxi", "tipo": "D"},
                    ],
                },
            ],
        },
    ]


def _pj_template_nodes() -> list[TemplateNode]:
    return [
        {
            "nome": "Receitas Operacionais",
            "tipo": "R",
            "dre_grupo": "RECEITA_BRUTA",
            "permite_lancamentos": False,
            "children": [
                {"nome": "Cartoes de Credito", "tipo": "R"},
                {"nome": "Cartoes de Debito", "tipo": "R"},
                {"nome": "Vale Refeicao/Alimentacao", "tipo": "R"},
                {"nome": "Cheque", "tipo": "R"},
                {"nome": "Boleto", "tipo": "R"},
                {"nome": "Deposito", "tipo": "R"},
                {"nome": "Dinheiro", "tipo": "R"},
                {"nome": "Outros Recebimentos Operacionais", "tipo": "R"},
            ],
        },
        {
            "nome": "Abatimento de Vendas",
            "tipo": "D",
            "dre_grupo": "DEDUCOES_RECEITA",
            "permite_lancamentos": False,
            "children": [
                {
                    "nome": "Imposto sobre Faturamento",
                    "tipo": "D",
                    "dre_grupo": "DEDUCOES_RECEITA",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "ICMS", "tipo": "D"},
                        {"nome": "ISS", "tipo": "D"},
                        {"nome": "PIS", "tipo": "D"},
                        {"nome": "COFINS", "tipo": "D"},
                        {"nome": "SIMPLES", "tipo": "D"},
                        {"nome": "IR", "tipo": "D"},
                        {"nome": "CSLL", "tipo": "D"},
                    ],
                },
                {"nome": "Devolucoes de Vendas", "tipo": "D"},
            ],
        },
        {
            "nome": "Custos",
            "tipo": "D",
            "dre_grupo": "CUSTOS_VARIAVEIS",
            "permite_lancamentos": False,
            "children": [
                {
                    "nome": "Operacao",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Fornecedores", "tipo": "D"},
                        {"nome": "Fretes", "tipo": "D"},
                        {"nome": "Energia", "tipo": "D"},
                        {"nome": "Tarifas", "tipo": "D"},
                        {"nome": "Embalagens e Similares", "tipo": "D"},
                        {"nome": "Manutencao de Maquinas e Equipamentos", "tipo": "D"},
                        {"nome": "Seguro de Maquinarios", "tipo": "D"},
                        {"nome": "Seguro com Mercadorias", "tipo": "D"},
                        {"nome": "Outros Custos na Operacao", "tipo": "D"},
                    ],
                },
                {
                    "nome": "Logistica",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Multas de Transito", "tipo": "D"},
                        {"nome": "Manutencao de Transportes", "tipo": "D"},
                        {"nome": "Combustivel", "tipo": "D"},
                        {"nome": "Vistorias e Taxas DETRAN", "tipo": "D"},
                        {"nome": "Tercerizacao de Veiculos", "tipo": "D"},
                        {"nome": "Seguro de Veiculos", "tipo": "D"},
                        {"nome": "Aluguel de Maquinarios Logisticos", "tipo": "D"},
                        {"nome": "Estacionamentos e Pedagios", "tipo": "D"},
                        {"nome": "Outros Custos com Logisticas", "tipo": "D"},
                    ],
                },
                {
                    "nome": "Comercial e Marketing",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Comissoes", "tipo": "D"},
                        {"nome": "Publicidade e Divulgacao", "tipo": "D"},
                        {"nome": "Eventos e Feiras", "tipo": "D"},
                        {"nome": "Brindes e Similares", "tipo": "D"},
                        {"nome": "Viagens Comerciais", "tipo": "D"},
                        {"nome": "Outros Custos com Comercial e Marketing (MKT)", "tipo": "D"},
                    ],
                },
            ],
        },
        {
            "nome": "Despesas",
            "tipo": "D",
            "dre_grupo": "DESPESAS_OPERACIONAIS",
            "permite_lancamentos": False,
            "children": [
                {
                    "nome": "Despesas de Pessoal",
                    "tipo": "D",
                    "permite_lancamentos": False,
                    "children": [
                        {"nome": "Salario/ Bolsas/ Autonomia", "tipo": "D"},
                        {"nome": "Pro-labore", "tipo": "D"},
                        {"nome": "Encargos Sociais", "tipo": "D"},
                        {"nome": "Gratificacoes", "tipo": "D"},
                    ],
                },
            ],
        },
    ]


def _default_template_nodes(tipo_pessoa: str) -> list[TemplateNode]:
    normalized = _normalizar_tipo_pessoa(tipo_pessoa)
    return deepcopy(_pf_template_nodes() if normalized == "PF" else _pj_template_nodes())


def _flatten_template_nodes(nodes: list[TemplateNode]) -> list[TemplateItem]:
    flat_items: list[TemplateItem] = []
    next_id = 1

    def traverse(
        group_nodes: list[TemplateNode],
        prefix: str,
        parent_id: Optional[int] = None,
        inherited_dre_grupo: Optional[str] = None,
    ) -> None:
        nonlocal next_id
        for index, node in enumerate(group_nodes, start=1):
            node_id = next_id
            next_id += 1
            codigo = f"{prefix}.{str(index).zfill(2)}"
            tipo_normalizado = _normalizar_tipo_plano(node.get("tipo"), default="D")
            dre_grupo = _normalizar_dre_grupo(node.get("dre_grupo") or inherited_dre_grupo, tipo_normalizado)
            flat_items.append(
                {
                    "id": node_id,
                    "nome": _strip_codigo_prefixo(str(node.get("nome", ""))),
                    "tipo": tipo_normalizado,
                    "codigo": codigo,
                    "permite_lancamentos": bool(node.get("permite_lancamentos", not bool(node.get("children")))),
                    "eh_operacional": bool(node.get("eh_operacional", True)),
                    "considerar_nos_resultados": bool(node.get("considerar_nos_resultados", True)),
                    "dre_grupo": dre_grupo,
                    "conta_pai_id": parent_id,
                }
            )

            children = node.get("children") or []
            if children:
                traverse(children, codigo, node_id, dre_grupo)

    receitas = [node for node in nodes if _normalizar_tipo_plano(node.get("tipo"), default="D") == "R"]
    despesas = [node for node in nodes if _normalizar_tipo_plano(node.get("tipo"), default="D") == "D"]
    traverse(receitas, "1")
    traverse(despesas, "2")
    return flat_items


def _default_template_items(tipo_pessoa: str) -> list[TemplateItem]:
    return _flatten_template_nodes(_default_template_nodes(tipo_pessoa))


def _template_config_key(tipo_pessoa: str) -> str:
    return TEMPLATE_CONFIG_KEYS[_normalizar_tipo_pessoa(tipo_pessoa)]


def _sanitize_template_item(item: dict[str, Any]) -> TemplateItem:
    tipo_normalizado = _normalizar_tipo_plano(item.get("tipo"), default="D")
    return {
        "id": int(item["id"]),
        "nome": _strip_codigo_prefixo(str(item.get("nome", "")).strip()),
        "tipo": tipo_normalizado,
        "codigo": item.get("codigo"),
        "permite_lancamentos": bool(item.get("permite_lancamentos", True)),
        "eh_operacional": bool(item.get("eh_operacional", True)),
        "considerar_nos_resultados": bool(item.get("considerar_nos_resultados", True)),
        "dre_grupo": _normalizar_dre_grupo(item.get("dre_grupo"), tipo_normalizado),
        "conta_pai_id": item.get("conta_pai_id"),
    }


def _ensure_template_config_table(db: Session) -> None:
    table = getattr(PlanoContasTemplateConfig, "__table__", None)
    if table is None:
        return
    table.create(bind=db.get_bind(), checkfirst=True)


def _has_template_config_table(db: Session) -> bool:
    try:
        return inspect(db.get_bind()).has_table(str(PlanoContasTemplateConfig.__tablename__))
    except Exception:
        return False


def get_template_config(db: Session, *, tipo_pessoa: str) -> Optional[PlanoContasTemplateConfig]:
    normalized = _normalizar_tipo_pessoa(tipo_pessoa)
    if not _has_template_config_table(db):
        _ensure_template_config_table(db)
    statement = select(PlanoContasTemplateConfig).where(
        PlanoContasTemplateConfig.tipo_pessoa == normalized,
        PlanoContasTemplateConfig.config_key == _template_config_key(normalized),
    )
    try:
        return db.exec(statement).first()
    except ProgrammingError as exc:
        if "plano_contas_template_configs" not in str(exc).lower():
            raise
        db.rollback()
        _ensure_template_config_table(db)
        return db.exec(statement).first()


def get_template_items(db: Session, *, tipo_pessoa: str) -> list[TemplateItem]:
    normalized = _normalizar_tipo_pessoa(tipo_pessoa)
    config = get_template_config(db=db, tipo_pessoa=normalized)
    if not config or not config.items:
        return _default_template_items(normalized)

    items = [_sanitize_template_item(item) for item in config.items]
    return sorted(items, key=lambda item: ((item.get("codigo") or "zzz"), item.get("nome") or ""))


def save_template_items(db: Session, *, tipo_pessoa: str, items: list[dict[str, Any]]) -> list[TemplateItem]:
    normalized = _normalizar_tipo_pessoa(tipo_pessoa)
    sanitized_items = [_sanitize_template_item(item) for item in items]
    _ensure_template_config_table(db)
    config = get_template_config(db=db, tipo_pessoa=normalized)
    if not config:
        config = PlanoContasTemplateConfig(
            tipo_pessoa=normalized,
            config_key=_template_config_key(normalized),
            items=[],
        )

    config.items = sanitized_items
    db.add(config)
    db.commit()
    db.refresh(config)
    return [_sanitize_template_item(item) for item in config.items]


def get(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    statement = select(PlanoContas).where(PlanoContas.id == id, PlanoContas.empresa_id == empresa_id)
    return db.exec(statement).first()


def get_by_empresa(db: Session, *, empresa_id: int) -> list[PlanoContas]:
    statement = select(PlanoContas).where(PlanoContas.empresa_id == empresa_id, PlanoContas.oculta == False).order_by(PlanoContas.nome)
    return list(db.exec(statement).all())


def normalize_company_operational_categories(db: Session, *, empresa_id: int) -> None:
    contas = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.oculta == False,
        )
    ).all()
    if not contas:
        return

    parent_ids = {
        int(conta.conta_pai_id)
        for conta in contas
        if conta.conta_pai_id is not None
    }

    updated = False
    for conta in contas:
        changed = False

        if conta.considerar_nos_resultados is False:
            conta.considerar_nos_resultados = True
            changed = True

        expected_dre = _normalizar_dre_grupo(getattr(conta, "dre_grupo", None), conta.tipo)
        if getattr(conta, "dre_grupo", None) != expected_dre:
            conta.dre_grupo = expected_dre
            changed = True

        has_children = conta.id is not None and int(conta.id) in parent_ids
        if has_children and conta.permite_lancamentos is not False:
            conta.permite_lancamentos = False
            changed = True

        if not has_children and conta.eh_cabecalho is not True and conta.permite_lancamentos is False:
            conta.permite_lancamentos = True
            changed = True

        if changed:
            db.add(conta)
            updated = True

    if updated:
        db.commit()


def create(db: Session, *, obj_in: PlanoContasCreate, empresa_id: int) -> PlanoContas:
    data = obj_in.model_dump()
    data["tipo"] = _normalizar_tipo_plano(data.get("tipo"), default="D")
    data["empresa_id"] = empresa_id
    data["eh_operacional"] = bool(data.get("eh_operacional", True))
    data["considerar_nos_resultados"] = True
    data["dre_grupo"] = _normalizar_dre_grupo(data.get("dre_grupo"), data.get("tipo"))
    data["oculta"] = False
    db_obj = PlanoContas.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update(db: Session, *, db_obj: PlanoContas, obj_in: PlanoContasUpdate) -> PlanoContas:
    update_data = obj_in.model_dump(exclude_unset=True)
    if "codigo" in update_data and isinstance(update_data["codigo"], str) and not update_data["codigo"].strip():
        update_data.pop("codigo")
    if "tipo" in update_data and update_data["tipo"] is not None:
        update_data["tipo"] = _normalizar_tipo_plano(update_data["tipo"], default=db_obj.tipo)
    if "eh_operacional" in update_data and update_data["eh_operacional"] is not None:
        update_data["eh_operacional"] = bool(update_data["eh_operacional"])
    if "dre_grupo" in update_data:
        tipo_referencia = update_data.get("tipo") or db_obj.tipo
        update_data["dre_grupo"] = _normalizar_dre_grupo(update_data.get("dre_grupo"), tipo_referencia)
    if not db_obj.oculta:
        update_data["considerar_nos_resultados"] = True
    _apply_model_update(db_obj, update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def delete(db: Session, *, id: int, empresa_id: int) -> Optional[PlanoContas]:
    db_obj = get(db=db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj


def ensure_transfer_category(db: Session, *, empresa_id: int) -> PlanoContas:
    categoria = db.exec(
        select(PlanoContas).where(
            PlanoContas.empresa_id == empresa_id,
            PlanoContas.oculta == True,
            PlanoContas.nome == TRANSFER_CATEGORY_NAME,
        )
    ).first()

    if categoria is None:
        categoria = PlanoContas(
            nome=TRANSFER_CATEGORY_NAME,
            tipo="D",
            codigo=None,
            empresa_id=empresa_id,
            permite_lancamentos=False,
            eh_operacional=False,
            considerar_nos_resultados=False,
            dre_grupo="NAO_OPERACIONAL",
            oculta=True,
        )
    else:
        categoria.tipo = "D"
        categoria.permite_lancamentos = False
        categoria.eh_operacional = False
        categoria.considerar_nos_resultados = False
        categoria.dre_grupo = "NAO_OPERACIONAL"
        categoria.oculta = True

    db.add(categoria)
    db.flush()
    return categoria


def seed_plano_contas_padrao(db: Session, *, empresa_id: int, tipo_pessoa: str = "PJ"):
    template_items = get_template_items(db=db, tipo_pessoa=tipo_pessoa)
    created_ids: dict[int, int] = {}

    for item in sorted(template_items, key=lambda current: ((current.get("codigo") or "zzz"), current.get("nome") or "")):
        template_id = int(item["id"])
        parent_template_id = item.get("conta_pai_id")
        conta = PlanoContas(
            nome=_strip_codigo_prefixo(str(item.get("nome", ""))),
            tipo=_normalizar_tipo_plano(item.get("tipo"), default="D"),
            codigo=item.get("codigo"),
            empresa_id=empresa_id,
            conta_pai_id=created_ids.get(int(parent_template_id)) if parent_template_id is not None else None,
            permite_lancamentos=bool(item.get("permite_lancamentos", True)),
            eh_operacional=bool(item.get("eh_operacional", True)),
            considerar_nos_resultados=True,
            dre_grupo=_normalizar_dre_grupo(item.get("dre_grupo"), item.get("tipo")),
        )
        db.add(conta)
        db.flush()
        if conta.id is None:
            raise ValueError("Falha ao gerar ID da categoria do plano de contas")
        created_ids[template_id] = int(conta.id)

    ensure_transfer_category(db=db, empresa_id=empresa_id)
    db.commit()