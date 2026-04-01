from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import ConfigDict, field_validator
from sqlmodel import SQLModel


class DashboardWidgetConfigPayload(SQLModel):
    model_config = ConfigDict(extra="allow")

    id: str
    visible: bool = True
    size: str = "md"
    autoWidth: Optional[bool] = None
    autoHeight: Optional[bool] = None
    x: Optional[int] = None
    y: Optional[int] = None
    w: Optional[int] = None
    h: Optional[int] = None
    customDefinition: Optional[Dict[str, Any]] = None


class DashboardViewPayload(SQLModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    widgets: List[DashboardWidgetConfigPayload]


class DashboardViewsUpdate(SQLModel):
    views: List[DashboardViewPayload] = []
    default_view: Optional[DashboardViewPayload] = None
    update_default: bool = False

    @field_validator("views")
    @classmethod
    def validate_views(cls, value: List[DashboardViewPayload]) -> List[DashboardViewPayload]:
        return value or []


class DashboardViewsResponse(SQLModel):
    empresa_id: int
    default_view: Optional[Any] = None
    views: List[Any] = []
    can_manage_default: bool = False