from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.enums import PdvPermission
from app.services.access_control_service import has_permission


def apply_pdv_venda_visibility_filter(
    query: Any,
    *,
    db: Session,
    current_user: Any,
    empresa_id: int,
    venda_model: Any,
):
    """Aplica o filtro de visibilidade das vendas do PDV para o usuário logado."""
    if not has_permission(
        db,
        user_id=int(current_user.id),
        empresa_id=int(empresa_id),
        is_consultor=bool(getattr(current_user, "is_consultor", False)),
        consultor_role=str(getattr(current_user, "consultor_role", "") or ""),
        permission_code=PdvPermission.PDV_VER_TODAS_VENDAS.value,
    ):
        query = query.where(venda_model.vendedor_id == current_user.id)

    return query