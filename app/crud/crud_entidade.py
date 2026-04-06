# app/crud/crud_entidade.py
import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from typing import Any, List, Optional

from sqlalchemy import func, or_, update as sql_update
from sqlmodel import Session, select

from app.models.entidade import Entidade
from app.models.lancamento import Lancamento
from app.schemas.entidade import EntidadeCreate, EntidadeUpdate
from app.crud.crud_centro_custo import ensure_centro_custo_principal


def _apply_model_update(db_obj, update_data: dict) -> None:
    if hasattr(db_obj, "sqlmodel_update"):
        db_obj.sqlmodel_update(update_data)
        return
    for campo, valor in update_data.items():
        setattr(db_obj, campo, valor)


def _normalize_entity_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"\s+", " ", normalized).strip().upper()
    return normalized


def _normalize_document(value: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits or None


def _normalize_text(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _normalize_email(value: Optional[str]) -> Optional[str]:
    text = _normalize_text(value)
    return text.lower() if text else None


def _normalize_phone(value: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits or None


def _normalize_uf(value: Optional[str]) -> Optional[str]:
    text = _normalize_text(value)
    return text.upper()[:2] if text else None


def _normalize_tipo(value: Optional[str]) -> str:
    normalized = str(value or "AMBOS").strip().upper()
    if normalized in {"CLIENTE", "FORNECEDOR", "AMBOS"}:
        return normalized
    return "AMBOS"


def _normalize_tipo_pessoa(value: Optional[str], document: Optional[str] = None) -> str:
    if document:
        return "PJ" if len(document) > 11 else "PF"
    normalized = str(value or "PJ").strip().upper()
    return "PF" if normalized == "PF" else "PJ"


def _normalize_entity_payload(data: dict[str, Any]) -> dict[str, Any]:
    document = _normalize_document(data.get("cpf_cnpj"))
    payload = {
        "nome": _normalize_text(data.get("nome")) or "",
        "tipo": _normalize_tipo(data.get("tipo")),
        "tipo_pessoa": _normalize_tipo_pessoa(data.get("tipo_pessoa"), document),
        "nome_fantasia": _normalize_text(data.get("nome_fantasia")),
        "cpf_cnpj": document,
        "email": _normalize_email(data.get("email")),
        "telefone": _normalize_phone(data.get("telefone")),
        "celular": _normalize_phone(data.get("celular")),
        "contato_nome": _normalize_text(data.get("contato_nome")),
        "cep": _normalize_phone(data.get("cep")),
        "logradouro": _normalize_text(data.get("logradouro")),
        "numero": _normalize_text(data.get("numero")),
        "complemento": _normalize_text(data.get("complemento")),
        "bairro": _normalize_text(data.get("bairro")),
        "cidade": _normalize_text(data.get("cidade")),
        "uf": _normalize_uf(data.get("uf")),
        "observacoes": _normalize_text(data.get("observacoes")),
        "status": _normalize_text(data.get("status")) or "ATIVO",
    }
    return payload


def _entity_to_payload(entity: Entidade) -> dict[str, Any]:
    return _normalize_entity_payload(
        {
            "nome": entity.nome,
            "tipo": entity.tipo,
            "tipo_pessoa": entity.tipo_pessoa,
            "nome_fantasia": entity.nome_fantasia,
            "cpf_cnpj": entity.cpf_cnpj,
            "email": entity.email,
            "telefone": entity.telefone,
            "celular": entity.celular,
            "contato_nome": entity.contato_nome,
            "cep": entity.cep,
            "logradouro": entity.logradouro,
            "numero": entity.numero,
            "complemento": entity.complemento,
            "bairro": entity.bairro,
            "cidade": entity.cidade,
            "uf": entity.uf,
            "observacoes": entity.observacoes,
            "status": entity.status,
        }
    )


def _entity_information_score(payload: dict[str, Any]) -> int:
    score = 0
    weighted_fields = {
        "cpf_cnpj": 5,
        "contato_nome": 3,
        "email": 2,
        "telefone": 2,
        "celular": 2,
        "nome_fantasia": 1,
        "cep": 1,
        "logradouro": 1,
        "numero": 1,
        "complemento": 1,
        "bairro": 1,
        "cidade": 1,
        "uf": 1,
        "observacoes": 1,
    }
    for field, weight in weighted_fields.items():
        if payload.get(field):
            score += weight
    return score


def _merge_tipo(current: Optional[str], incoming: Optional[str]) -> str:
    current_normalized = _normalize_tipo(current)
    incoming_normalized = _normalize_tipo(incoming)
    if current_normalized == incoming_normalized:
        return current_normalized
    if "AMBOS" in {current_normalized, incoming_normalized}:
        return "AMBOS"
    return "AMBOS"


def _entity_matches_payload(entity: Entidade, payload: dict[str, Any]) -> bool:
    if entity.is_deleted:
        return False

    payload_name = _normalize_entity_name(payload.get("nome") or "")
    payload_doc = payload.get("cpf_cnpj")
    entity_name = _normalize_entity_name(entity.nome)
    entity_doc = _normalize_document(entity.cpf_cnpj)

    if payload_doc:
        if entity_doc and entity_doc == payload_doc:
            return True
        return entity_name == payload_name and (entity_doc is None or entity_doc == payload_doc)

    if entity_doc:
        return False
    return entity_name == payload_name


def _merge_payload_into_entity(entity: Entidade, payload: dict[str, Any]) -> bool:
    changed = False

    merged_tipo = _merge_tipo(entity.tipo, payload.get("tipo"))
    if entity.tipo != merged_tipo:
        entity.tipo = merged_tipo
        changed = True

    simple_fields = [
        "nome_fantasia",
        "cpf_cnpj",
        "email",
        "telefone",
        "celular",
        "contato_nome",
        "cep",
        "logradouro",
        "numero",
        "complemento",
        "bairro",
        "cidade",
        "uf",
        "observacoes",
    ]
    for field in simple_fields:
        current_value = _normalize_text(getattr(entity, field, None)) if field not in {"cpf_cnpj", "telefone", "celular", "cep"} else getattr(entity, field, None)
        incoming_value = payload.get(field)
        if incoming_value and not current_value:
            setattr(entity, field, incoming_value)
            changed = True

    inferred_tipo_pessoa = _normalize_tipo_pessoa(payload.get("tipo_pessoa") or entity.tipo_pessoa, payload.get("cpf_cnpj") or entity.cpf_cnpj)
    if entity.tipo_pessoa != inferred_tipo_pessoa:
        entity.tipo_pessoa = inferred_tipo_pessoa
        changed = True

    if (entity.status or "").strip().upper() != "ATIVO" and (payload.get("status") or "").strip().upper() == "ATIVO":
        entity.status = "ATIVO"
        changed = True

    return changed


def _soft_delete_entity(entity: Entidade) -> None:
    entity.is_deleted = True
    entity.deleted_at = datetime.utcnow()
    entity.updated_at = datetime.utcnow()


def _reassign_lancamentos_to_entity(db: Session, *, source_id: int, target_id: int) -> None:
    if source_id == target_id:
        return
    db.exec(
        sql_update(Lancamento)
        .where(Lancamento.entidade_id == source_id)
        .values(entidade_id=target_id, updated_at=datetime.utcnow())
    )


def _select_survivor(candidates: list[Entidade]) -> Entidade:
    return max(
        candidates,
        key=lambda entity: (
            _entity_information_score(_entity_to_payload(entity)),
            1 if entity.id is not None else 0,
            -(int(entity.id) if entity.id is not None else 10**9),
        ),
    )


def _consolidate_matching_entities(
    db: Session,
    *,
    payload: dict[str, Any],
    empresa_id: int,
    candidate_pool: list[Entidade],
) -> Entidade:
    candidates = [entity for entity in candidate_pool if entity.empresa_id == empresa_id and _entity_matches_payload(entity, payload)]
    if not candidates:
        entity = Entidade.model_validate({**payload, "empresa_id": empresa_id})
        db.add(entity)
        candidate_pool.append(entity)
        return entity

    survivor = _select_survivor(candidates)
    if survivor.id is None:
        db.flush()

    changed = _merge_payload_into_entity(survivor, payload)
    duplicates = [entity for entity in candidates if entity is not survivor]
    for duplicate in duplicates:
        changed = _merge_payload_into_entity(survivor, _entity_to_payload(duplicate)) or changed
        if survivor.id is None:
            db.flush()
        if duplicate.id is not None and survivor.id is not None:
            _reassign_lancamentos_to_entity(db, source_id=int(duplicate.id), target_id=int(survivor.id))
        _soft_delete_entity(duplicate)
        db.add(duplicate)

    if changed:
        db.add(survivor)
    return survivor


def _merge_requested_bulk_payloads(items_in: List[EntidadeCreate]) -> list[dict[str, Any]]:
    merged_payloads: list[dict[str, Any]] = []
    for item in items_in:
        payload = _normalize_entity_payload(item.model_dump())
        if not payload.get("nome"):
            continue

        matched_index: Optional[int] = None
        for index, existing in enumerate(merged_payloads):
            probe = Entidade.model_validate({**existing, "empresa_id": 0})
            if _entity_matches_payload(probe, payload):
                matched_index = index
                break

        if matched_index is None:
            merged_payloads.append(payload)
            continue

        merged_entity = Entidade.model_validate({**merged_payloads[matched_index], "empresa_id": 0})
        _merge_payload_into_entity(merged_entity, payload)
        merged_payloads[matched_index] = _entity_to_payload(merged_entity)

    return merged_payloads


def deduplicate_company_entities(db: Session, *, empresa_id: int) -> int:
    entities = list(
        db.exec(
            select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.is_deleted == False).order_by(Entidade.id)
        ).all()
    )
    if not entities:
        return 0

    index_by_entity = {id(entity): index for index, entity in enumerate(entities)}
    parents = list(range(len(entities)))

    def find(node: int) -> int:
        while parents[node] != node:
            parents[node] = parents[parents[node]]
            node = parents[node]
        return node

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    doc_groups: dict[str, list[int]] = defaultdict(list)
    name_groups: dict[str, list[int]] = defaultdict(list)

    for index, entity in enumerate(entities):
        name_groups[_normalize_entity_name(entity.nome)].append(index)
        document = _normalize_document(entity.cpf_cnpj)
        if document:
            doc_groups[document].append(index)

    for indexes in doc_groups.values():
        if len(indexes) < 2:
            continue
        anchor = indexes[0]
        for current in indexes[1:]:
            union(anchor, current)

    for indexes in name_groups.values():
        if len(indexes) < 2:
            continue

        blank_indexes = [index for index in indexes if not _normalize_document(entities[index].cpf_cnpj)]
        doc_values = {_normalize_document(entities[index].cpf_cnpj) for index in indexes if _normalize_document(entities[index].cpf_cnpj)}

        if not doc_values and len(blank_indexes) > 1:
            anchor = blank_indexes[0]
            for current in blank_indexes[1:]:
                union(anchor, current)
            continue

        if len(doc_values) == 1 and blank_indexes:
            doc_value = next(iter(doc_values))
            doc_indexes = [index for index in indexes if _normalize_document(entities[index].cpf_cnpj) == doc_value]
            if doc_indexes:
                anchor = doc_indexes[0]
                for current in blank_indexes:
                    union(anchor, current)

    grouped_indexes: dict[int, list[int]] = defaultdict(list)
    for index in range(len(entities)):
        grouped_indexes[find(index)].append(index)

    merged = 0
    for indexes in grouped_indexes.values():
        if len(indexes) < 2:
            continue

        component_entities = [entities[index] for index in indexes if not entities[index].is_deleted]
        if len(component_entities) < 2:
            continue

        survivor = _select_survivor(component_entities)
        changed = False
        for entity in component_entities:
            if entity is survivor:
                continue
            changed = _merge_payload_into_entity(survivor, _entity_to_payload(entity)) or changed
            if survivor.id is None:
                db.flush()
            if entity.id is not None and survivor.id is not None:
                _reassign_lancamentos_to_entity(db, source_id=int(entity.id), target_id=int(survivor.id))
            _soft_delete_entity(entity)
            db.add(entity)
            merged += 1

        if changed:
            db.add(survivor)

    return merged


def _build_search_filter(search: Optional[str]):
    normalized = str(search or "").strip()
    if not normalized:
        return None

    term = f"%{normalized}%"
    digits = "".join(ch for ch in normalized if ch.isdigit())
    filters = [
        Entidade.nome.ilike(term),
        Entidade.nome_fantasia.ilike(term),
        Entidade.email.ilike(term),
        Entidade.cidade.ilike(term),
        Entidade.contato_nome.ilike(term),
    ]
    if digits:
        filters.append(Entidade.cpf_cnpj.ilike(f"%{digits}%"))
    return filters

def get_multi(db: Session, *, empresa_id: int) -> List[Entidade]:
    statement = select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.is_deleted == False).order_by(Entidade.nome)
    return list(db.exec(statement).all())


def get_page(
    db: Session,
    *,
    empresa_id: int,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
) -> tuple[List[Entidade], int]:
    filters = [Entidade.empresa_id == empresa_id, Entidade.is_deleted == False]
    search_filters = _build_search_filter(search)

    statement = select(Entidade).where(*filters)
    count_statement = select(func.count()).select_from(Entidade).where(*filters)

    if search_filters:
        statement = statement.where(or_(*search_filters))
        count_statement = count_statement.where(or_(*search_filters))

    items = list(
        db.exec(
            statement.order_by(Entidade.nome).offset(skip).limit(limit)
        ).all()
    )
    total = int(db.exec(count_statement).one() or 0)
    return items, total

def get_by_id(db: Session, *, id: int, empresa_id: int) -> Optional[Entidade]:
    statement = select(Entidade).where(Entidade.id == id, Entidade.empresa_id == empresa_id, Entidade.is_deleted == False)
    return db.exec(statement).first()

def create(db: Session, *, obj_in: EntidadeCreate, empresa_id: int) -> Entidade:
    payload = _normalize_entity_payload(obj_in.model_dump())
    existing_entities = list(
        db.exec(
            select(Entidade).where(Entidade.empresa_id == empresa_id, Entidade.is_deleted == False)
        ).all()
    )
    db_obj = _consolidate_matching_entities(db, payload=payload, empresa_id=empresa_id, candidate_pool=existing_entities)
    db.commit()
    db.refresh(db_obj)

    # Quando a entidade for pessoa fisica, garante o centro padrao da empresa.
    tipo_pessoa = str(db_obj.tipo_pessoa or "").strip().upper()
    if tipo_pessoa == "PF":
        ensure_centro_custo_principal(db=db, empresa_id=empresa_id)

    return db_obj


def create_bulk(db: Session, *, items_in: List[EntidadeCreate], empresa_id: int) -> List[Entidade]:
    requested_payloads = _merge_requested_bulk_payloads(items_in)
    if not requested_payloads:
        return []

    name_keys = list({_normalize_entity_name(payload["nome"]) for payload in requested_payloads if payload.get("nome")})
    document_keys = list({payload["cpf_cnpj"] for payload in requested_payloads if payload.get("cpf_cnpj")})

    filters = [Entidade.empresa_id == empresa_id, Entidade.is_deleted == False]
    lookup_filters = []
    if name_keys:
        lookup_filters.append(func.upper(Entidade.nome).in_(name_keys))
    if document_keys:
        lookup_filters.append(Entidade.cpf_cnpj.in_(document_keys))

    existing_entities = list(
        db.exec(
            select(Entidade).where(*filters).where(or_(*lookup_filters)) if lookup_filters else select(Entidade).where(*filters)
        ).all()
    )

    resolved_entities: list[Entidade] = []
    for payload in requested_payloads:
        entity = _consolidate_matching_entities(db, payload=payload, empresa_id=empresa_id, candidate_pool=existing_entities)
        resolved_entities.append(entity)

    # Garante IDs para novos registros antes do commit final.
    db.flush()

    unique_results: list[Entidade] = []
    seen_ids: set[int] = set()
    for entity in resolved_entities:
        if entity.id is None:
            continue

        entity_id = int(entity.id)
        if entity_id in seen_ids:
            continue

        seen_ids.add(entity_id)
        unique_results.append(entity)

    # Evita expirar instancias no commit para nao gerar N consultas extras no response_model.
    previous_expire_on_commit = getattr(db, "expire_on_commit", None)
    if previous_expire_on_commit is not None:
        db.expire_on_commit = False
    try:
        db.commit()
    finally:
        if previous_expire_on_commit is not None:
            db.expire_on_commit = previous_expire_on_commit

    if any(str(entity.tipo_pessoa or "").strip().upper() == "PF" for entity in unique_results):
        ensure_centro_custo_principal(db=db, empresa_id=empresa_id)

    return unique_results

def update(db: Session, *, id: int, obj_in: EntidadeUpdate, empresa_id: int) -> Optional[Entidade]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if not db_obj:
        return None
    update_data = obj_in.model_dump(exclude_unset=True)
    _apply_model_update(db_obj, update_data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj

def delete(db: Session, *, id: int, empresa_id: int) -> Optional[Entidade]:
    db_obj = get_by_id(db, id=id, empresa_id=empresa_id)
    if db_obj:
        db.delete(db_obj)
        db.commit()
    return db_obj