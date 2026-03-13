from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional

from sqlalchemy import inspect
from sqlmodel import SQLModel, Session, select

from app.models.bank_preset_config import BankPresetConfig

AUTO_ADJUST_CONFIG_KEY = "global-auto-adjustment-config-v1"

DEFAULT_ITEM = {
    "juros_multa": {
        "template_id": None,
        "categoria_nome": "Juros e Multas",
        "tipo": "D",
        "dre_grupo": "OUTRAS_DESPESAS",
    },
    "descontos": {
        "template_id": None,
        "categoria_nome": "Descontos Concedidos",
        "tipo": "D",
        "dre_grupo": "DEDUCOES_RECEITA",
    },
}

DEFAULT_CONFIG = {
    "PF": deepcopy(DEFAULT_ITEM),
    "PJ": deepcopy(DEFAULT_ITEM),
}


def _normalize_tipo_pessoa(tipo_pessoa: str) -> str:
    value = (tipo_pessoa or "").strip().upper()
    if value not in {"PF", "PJ"}:
        raise ValueError("tipo_pessoa invalido. Use PF ou PJ")
    return value


def _normalize_item(item: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    source = item if isinstance(item, dict) else {}
    return {
        "template_id": int(source["template_id"]) if source.get("template_id") is not None else None,
        "categoria_nome": str(source.get("categoria_nome") or fallback.get("categoria_nome") or "").strip() or str(fallback.get("categoria_nome") or ""),
        "tipo": str(source.get("tipo") or fallback.get("tipo") or "D").strip().upper()[:1] or "D",
        "dre_grupo": str(source.get("dre_grupo") or fallback.get("dre_grupo") or "DESPESAS_OPERACIONAIS").strip().upper() or "DESPESAS_OPERACIONAIS",
    }


def _sanitize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    data = deepcopy(DEFAULT_CONFIG)
    source = payload or {}
    for tipo in ("PF", "PJ"):
        source_tipo = source.get(tipo)
        raw_tipo: dict[str, Any] = source_tipo if isinstance(source_tipo, dict) else {}
        juros_raw = raw_tipo.get("juros_multa") if isinstance(raw_tipo.get("juros_multa"), dict) else {}
        descontos_raw = raw_tipo.get("descontos") if isinstance(raw_tipo.get("descontos"), dict) else {}
        data[tipo] = {
            "juros_multa": _normalize_item(juros_raw, DEFAULT_CONFIG[tipo]["juros_multa"]),
            "descontos": _normalize_item(descontos_raw, DEFAULT_CONFIG[tipo]["descontos"]),
        }
    return data


def _ensure_table(db: Session) -> None:
    bind = db.get_bind()
    if inspect(bind).has_table("bank_preset_configs"):
        return
    SQLModel.metadata.create_all(bind=bind)


def _ensure_config(db: Session) -> BankPresetConfig:
    _ensure_table(db)
    config = db.exec(select(BankPresetConfig).where(BankPresetConfig.config_key == AUTO_ADJUST_CONFIG_KEY)).first()
    if config:
        config.items = _sanitize_payload(config.items if isinstance(config.items, dict) else {})
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    config = BankPresetConfig(config_key=AUTO_ADJUST_CONFIG_KEY, items=deepcopy(DEFAULT_CONFIG))  # type: ignore[call-arg]
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def get_all(db: Session) -> dict[str, Any]:
    config = _ensure_config(db)
    return _sanitize_payload(config.items if isinstance(config.items, dict) else {})


def get_for_tipo_pessoa(db: Session, *, tipo_pessoa: str) -> dict[str, Any]:
    tipo = _normalize_tipo_pessoa(tipo_pessoa)
    payload = get_all(db)
    return deepcopy(payload.get(tipo) or DEFAULT_CONFIG[tipo])


def save_for_tipo_pessoa(
    db: Session,
    *,
    tipo_pessoa: str,
    juros_multa: dict[str, Any],
    descontos: dict[str, Any],
) -> dict[str, Any]:
    tipo = _normalize_tipo_pessoa(tipo_pessoa)
    config = _ensure_config(db)
    payload = _sanitize_payload(config.items if isinstance(config.items, dict) else {})
    payload[tipo] = {
        "juros_multa": _normalize_item(juros_multa or {}, DEFAULT_CONFIG[tipo]["juros_multa"]),
        "descontos": _normalize_item(descontos or {}, DEFAULT_CONFIG[tipo]["descontos"]),
    }
    config.items = payload
    db.add(config)
    db.commit()
    db.refresh(config)
    return deepcopy(payload[tipo])
