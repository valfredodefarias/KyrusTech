# app/api/v1/endpoints/entidades.py
import time
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from loguru import logger # <-- Import do logger

from app.db.session import get_db
from app.schemas.entidade import EntidadeCreate, EntidadeRead, EntidadeUpdate, EntidadeLookup, EntidadePage
from app.crud import crud_entidade
from app.api.v1.deps import get_empresa_id_from_user, require_permission
from app.models.entidade import Entidade

router = APIRouter()

@router.get("/", response_model=List[EntidadeRead])
def read_entidades(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Listando entidades para empresa ID: {empresa_id}")
    return crud_entidade.get_multi(db=db, empresa_id=empresa_id)


@router.get("/paged", response_model=EntidadePage)
def read_entidades_paged(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    q: Optional[str] = Query(None),
):
    items, total = crud_entidade.get_page(db=db, empresa_id=empresa_id, skip=skip, limit=limit, search=q)
    logger.info(f"Listando entidades paginadas para empresa ID: {empresa_id} | skip={skip} limit={limit} q={q!r} total={total}")
    return EntidadePage(items=items, total=total, skip=skip, limit=limit)


@router.get("/lookup", response_model=List[EntidadeLookup])
def read_entidades_lookup(
    *,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    """Lista entidades em formato leve (lookup)."""
    rows = db.exec(
        select(Entidade.id, Entidade.nome, Entidade.tipo, Entidade.tipo_pessoa, Entidade.cpf_cnpj)
        .where(Entidade.empresa_id == empresa_id, Entidade.is_deleted == False)
        .order_by(Entidade.nome)
    ).all()

    return [{"id": row[0], "nome": row[1], "tipo": row[2], "tipo_pessoa": row[3], "cpf_cnpj": row[4]} for row in rows]

@router.post(
    "/",
    response_model=EntidadeRead,
    status_code=201,
    dependencies=[Depends(require_permission("entidades:create"))],
)
def create_entidade(
    *,
    db: Session = Depends(get_db),
    obj_in: EntidadeCreate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} criando entidade: '{obj_in.nome}' ({obj_in.tipo})")
    # O crud_entidade.create espera empresa_id como parâmetro separado
    entidade = crud_entidade.create(db=db, obj_in=obj_in, empresa_id=empresa_id)
    logger.success(f"Entidade '{entidade.nome}' criada com ID: {entidade.id}")
    return entidade


@router.post(
    "/bulk",
    response_model=List[EntidadeRead],
    status_code=201,
    dependencies=[Depends(require_permission("entidades:import"))],
)
def create_entidades_bulk(
    *,
    db: Session = Depends(get_db),
    obj_in_list: List[EntidadeCreate],
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} criando {len(obj_in_list)} entidade(s) em massa")
    started_at = time.perf_counter()
    entidades = crud_entidade.create_bulk(db=db, items_in=obj_in_list, empresa_id=empresa_id)
    elapsed_seconds = time.perf_counter() - started_at
    logger.success(
        f"Empresa {empresa_id} processou {len(entidades)} entidade(s) no bulk em {elapsed_seconds:.2f}s"
    )
    return entidades

@router.put(
    "/{id}",
    response_model=EntidadeRead,
    dependencies=[Depends(require_permission("entidades:update"))],
)
def update_entidade(
    *,
    db: Session = Depends(get_db),
    id: int,
    obj_in: EntidadeUpdate,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} atualizando entidade ID: {id}")
    entidade = crud_entidade.update(db=db, id=id, obj_in=obj_in, empresa_id=empresa_id)
    if not entidade:
        logger.warning(f"Entidade ID {id} não encontrada para atualização.")
        raise HTTPException(status_code=404, detail="Entidade não encontrada")
    
    logger.success(f"Entidade ID {id} atualizada com sucesso.")
    return entidade

@router.delete(
    "/{id}",
    dependencies=[Depends(require_permission("entidades:delete"))],
)
def delete_entidade(
    *,
    db: Session = Depends(get_db),
    id: int,
    empresa_id: int = Depends(get_empresa_id_from_user),
):
    logger.info(f"Empresa {empresa_id} deletando entidade ID: {id}")
    entidade = crud_entidade.delete(db=db, id=id, empresa_id=empresa_id)
    if not entidade:
        logger.warning(f"Entidade ID {id} não encontrada para exclusão.")
        raise HTTPException(status_code=404, detail="Entidade não encontrada")
    
    logger.success(f"Entidade ID {id} removida com sucesso.")
    return {"ok": True}