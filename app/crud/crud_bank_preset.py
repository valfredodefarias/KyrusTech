from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional
from unicodedata import normalize

from sqlalchemy.exc import ProgrammingError
from sqlalchemy import inspect
from sqlmodel import Session, select

from app.models.bank_preset_config import BankPresetConfig
from app.schemas.bank_preset import BankPresetCreate, BankPresetRead, BankPresetUpdate


BANK_PRESET_CONFIG_KEY = "default-bank-presets"

DEFAULT_BANK_PRESETS: list[dict[str, Any]] = [
    {"key": "itau", "label": "Itaú", "bank_name": "Itaú", "aliases": ["Itau", "Itaú"], "logo_url": "/itau.png", "sort_order": 10, "is_active": True},
    {"key": "bradesco", "label": "Bradesco", "bank_name": "Bradesco", "aliases": ["Bradesco"], "logo_url": "/bank-logos/bradesco.png", "sort_order": 20, "is_active": True},
    {"key": "santander", "label": "Santander", "bank_name": "Santander", "aliases": ["Santander"], "logo_url": "/bank-logos/santander.png", "sort_order": 30, "is_active": True},
    {"key": "inter", "label": "Inter", "bank_name": "Inter", "aliases": ["Inter", "Banco Inter"], "logo_url": "/bank-logos/inter.png", "sort_order": 40, "is_active": True},
    {"key": "bb", "label": "Banco do Brasil", "bank_name": "Banco do Brasil", "aliases": ["Banco do Brasil", "BB", "Banco Brasil"], "logo_url": "/bank-logos/banco-do-brasil.png", "sort_order": 50, "is_active": True},
    {"key": "banpara", "label": "Banpará", "bank_name": "Banpará", "aliases": ["Banpara", "Banpará"], "logo_url": "/bank-logos/banpara.png", "sort_order": 60, "is_active": True},
    {"key": "caixa", "label": "Caixa", "bank_name": "Caixa", "aliases": ["Caixa", "Caixa Econômica", "Caixa Economica"], "logo_url": "/bank-logos/caixa.png", "sort_order": 70, "is_active": True},
    {"key": "nubank", "label": "Nubank", "bank_name": "Nubank", "aliases": ["Nubank", "NuBank", "Nu"], "logo_url": "/bank-logos/nubank.png", "sort_order": 80, "is_active": True},
    {"key": "picpay", "label": "PicPay", "bank_name": "PicPay", "aliases": ["PicPay", "Pic Pay"], "logo_url": "/bank-logos/picpay.png", "sort_order": 90, "is_active": True},
    {"key": "sicredi", "label": "Sicredi", "bank_name": "Sicredi", "aliases": ["Sicredi"], "logo_url": "/bank-logos/sicredi.png", "sort_order": 100, "is_active": True},
    {"key": "sicoob", "label": "Sicoob", "bank_name": "Sicoob", "aliases": ["Sicoob"], "logo_url": "/bank-logos/sicoob.png", "sort_order": 110, "is_active": True},
    {"key": "c6", "label": "C6 Bank", "bank_name": "C6 Bank", "aliases": ["C6", "C6 Bank"], "logo_url": "/bank-logos/c6-bank.png", "sort_order": 120, "is_active": True},
    {"key": "mercadopago", "label": "Mercado Pago", "bank_name": "Mercado Pago", "aliases": ["Mercado Pago", "MercadoPago"], "logo_url": "/bank-logos/mercado-pago.png", "sort_order": 130, "is_active": True},
]


def _slugify(value: str) -> str:
    normalized = normalize("NFD", str(value or "").strip().lower())
    ascii_only = "".join(ch for ch in normalized if ch.isascii() and ch.isalnum())
    return ascii_only[:40] or "bank"


def _normalize_aliases(values: Optional[list[str]], *, label: str, bank_name: str) -> list[str]:
    merged = [label, bank_name, *(values or [])]
    unique: list[str] = []
    seen: set[str] = set()
    for value in merged:
        cleaned = str(value or "").strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)
    return unique


def _sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
    label = str(item.get("label") or item.get("bank_name") or "").strip()
    bank_name = str(item.get("bank_name") or label).strip()
    if not label or not bank_name:
        raise ValueError("label e bank_name sao obrigatorios")

    key = _slugify(str(item.get("key") or bank_name or label))
    return {
        "key": key,
        "label": label,
        "bank_name": bank_name,
        "aliases": _normalize_aliases(item.get("aliases"), label=label, bank_name=bank_name),
        "logo_url": str(item.get("logo_url") or "").strip() or None,
        "sort_order": int(item.get("sort_order") or 0),
        "is_active": bool(item.get("is_active", True)),
    }


def _has_bank_preset_table(db: Session) -> bool:
    try:
        return inspect(db.get_bind()).has_table(BankPresetConfig.__tablename__)
    except Exception:
        return False


def _ensure_bank_preset_table(db: Session) -> None:
    BankPresetConfig.__table__.create(bind=db.get_bind(), checkfirst=True)


def _sort_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: (int(item.get("sort_order") or 0), str(item.get("label") or "").lower()))


def _ensure_default_config(db: Session) -> BankPresetConfig:
    if not _has_bank_preset_table(db):
        _ensure_bank_preset_table(db)

    try:
        config = db.exec(select(BankPresetConfig).where(BankPresetConfig.config_key == BANK_PRESET_CONFIG_KEY)).first()
    except ProgrammingError as exc:
        if "bank_preset_configs" not in str(exc).lower():
            raise
        _ensure_bank_preset_table(db)
        config = db.exec(select(BankPresetConfig).where(BankPresetConfig.config_key == BANK_PRESET_CONFIG_KEY)).first()

    if config:
        return config

    config = BankPresetConfig(
        config_key=BANK_PRESET_CONFIG_KEY,
        items=[_sanitize_item(item) for item in deepcopy(DEFAULT_BANK_PRESETS)],
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def list_items(db: Session, *, include_inactive: bool = False) -> list[BankPresetRead]:
    config = _ensure_default_config(db)
    items = [_sanitize_item(item) for item in list(config.items or [])]
    if not include_inactive:
        items = [item for item in items if item["is_active"]]
    return [BankPresetRead.model_validate(item) for item in _sort_items(items)]


def save_item(db: Session, *, payload: BankPresetCreate) -> BankPresetRead:
    config = _ensure_default_config(db)
    items = [_sanitize_item(item) for item in list(config.items or [])]
    sanitized = _sanitize_item(payload.model_dump())
    existing = next((item for item in items if item["key"] == sanitized["key"]), None)
    if existing:
        raise ValueError("Ja existe um preset com esta chave")
    items.append(sanitized)
    config.items = _sort_items(items)
    db.add(config)
    db.commit()
    db.refresh(config)
    return BankPresetRead.model_validate(sanitized)


def update_item(db: Session, *, preset_key: str, payload: BankPresetUpdate) -> BankPresetRead:
    config = _ensure_default_config(db)
    items = [_sanitize_item(item) for item in list(config.items or [])]
    target = next((item for item in items if item["key"] == preset_key), None)
    if not target:
        raise KeyError("Preset nao encontrado")

    update_data = payload.model_dump(exclude_unset=True)
    merged = {**target, **update_data}
    sanitized = _sanitize_item(merged)
    sanitized["key"] = target["key"]

    updated_items = [sanitized if item["key"] == preset_key else item for item in items]
    config.items = _sort_items(updated_items)
    db.add(config)
    db.commit()
    db.refresh(config)
    return BankPresetRead.model_validate(sanitized)


def delete_item(db: Session, *, preset_key: str) -> None:
    config = _ensure_default_config(db)
    items = [_sanitize_item(item) for item in list(config.items or [])]
    if not any(item["key"] == preset_key for item in items):
        raise KeyError("Preset nao encontrado")
    config.items = [item for item in items if item["key"] != preset_key]
    db.add(config)
    db.commit()