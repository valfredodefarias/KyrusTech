from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlmodel import Session

from app.api.v1.deps import get_current_active_user, get_super_consultor_user
from app.crud import crud_bank_preset
from app.db.session import get_db
from app.schemas.bank_preset import BankPresetCreate, BankPresetRead, BankPresetUpdate

router = APIRouter()


@router.get("/", response_model=List[BankPresetRead])
def list_bank_presets(
    *,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_active_user),
    include_inactive: bool = Query(False),
):
    if include_inactive and not current_user.is_consultor:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso negado")
    if include_inactive and getattr(current_user, "consultor_role", "") != "SUPER_CONSULTOR":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso negado")
    return crud_bank_preset.list_items(db=db, include_inactive=include_inactive)


@router.post("/", response_model=BankPresetRead, status_code=201)
def create_bank_preset(
    *,
    payload: BankPresetCreate,
    db: Session = Depends(get_db),
    super_consultor = Depends(get_super_consultor_user),
):
    try:
        item = crud_bank_preset.save_item(db=db, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.warning(f"[SUPER] {super_consultor.email} criou preset de banco {item.key}")
    return item


@router.patch("/{preset_key}", response_model=BankPresetRead)
def update_bank_preset(
    *,
    preset_key: str,
    payload: BankPresetUpdate,
    db: Session = Depends(get_db),
    super_consultor = Depends(get_super_consultor_user),
):
    try:
        item = crud_bank_preset.update_item(db=db, preset_key=preset_key, payload=payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logger.warning(f"[SUPER] {super_consultor.email} atualizou preset de banco {preset_key}")
    return item


@router.delete("/{preset_key}")
def delete_bank_preset(
    *,
    preset_key: str,
    db: Session = Depends(get_db),
    super_consultor = Depends(get_super_consultor_user),
):
    try:
        crud_bank_preset.delete_item(db=db, preset_key=preset_key)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logger.warning(f"[SUPER] {super_consultor.email} removeu preset de banco {preset_key}")
    return {"ok": True}