# app/crud/crud_entidade.py
from typing import List, Optional
from sqlalchemy import func
from sqlmodel import Session, select
from app.models.entidade import Entidade
from app.schemas.entidade import EntidadeCreate, EntidadeUpdate
from app.crud.crud_centro_custo import ensure_centro_custo_principal


def _apply_model_update(db_obj, update_data: dict) -> None:
    if hasattr(db_obj, "sqlmodel_update"):
        db_obj.sqlmodel_update(update_data)
        return
    for campo, valor in update_data.items():
        setattr(db_obj, campo, valor)


def _normalize_entity_name(value: str) -> str:
    return str(value or "").strip().upper()


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
        from sqlalchemy import or_

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
    data = obj_in.model_dump()
    data["empresa_id"] = empresa_id
    db_obj = Entidade.model_validate(data)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)

    # Quando a entidade for pessoa fisica, garante o centro padrao da empresa.
    tipo_pessoa = str(db_obj.tipo_pessoa or "").strip().upper()
    if tipo_pessoa == "PF":
        ensure_centro_custo_principal(db=db, empresa_id=empresa_id)

    return db_obj


def create_bulk(db: Session, *, items_in: List[EntidadeCreate], empresa_id: int) -> List[Entidade]:
    requested_items: list[tuple[str, EntidadeCreate]] = []
    requested_keys: list[str] = []

    for item in items_in:
        normalized_name = str(item.nome or "").strip()
        if not normalized_name:
            continue
        normalized_key = _normalize_entity_name(normalized_name)
        if normalized_key in requested_keys:
            continue
        requested_keys.append(normalized_key)
        payload = EntidadeCreate(**{**item.model_dump(), "nome": normalized_name})
        requested_items.append((normalized_key, payload))

    if not requested_items:
        return []

    existing_rows = db.exec(
        select(Entidade).where(
            Entidade.empresa_id == empresa_id,
            func.upper(Entidade.nome).in_(requested_keys),
        )
    ).all()
    existing_by_key = {_normalize_entity_name(entity.nome): entity for entity in existing_rows}

    new_entities: list[Entidade] = []
    for normalized_key, payload in requested_items:
        if normalized_key in existing_by_key:
            continue
        data = payload.model_dump()
        data["empresa_id"] = empresa_id
        entity = Entidade.model_validate(data)
        db.add(entity)
        new_entities.append(entity)
        existing_by_key[normalized_key] = entity

    if new_entities:
        db.commit()
        for entity in new_entities:
            db.refresh(entity)

        if any(str(entity.tipo_pessoa or "").strip().upper() == "PF" for entity in new_entities):
            ensure_centro_custo_principal(db=db, empresa_id=empresa_id)
    else:
        db.rollback()

    return [existing_by_key[key] for key, _ in requested_items if key in existing_by_key]

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