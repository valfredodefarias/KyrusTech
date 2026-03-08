from typing import Any, List

from pydantic import field_validator
from sqlmodel import SQLModel


class DashboardWidgetConfigPayload(SQLModel):
    id: str
    visible: bool = True
    size: str = "md"


class DashboardViewPayload(SQLModel):
    id: str
    name: str
    widgets: List[DashboardWidgetConfigPayload]


class DashboardViewsUpdate(SQLModel):
    views: List[DashboardViewPayload]

    @field_validator("views")
    @classmethod
    def validate_views(cls, value: List[DashboardViewPayload]) -> List[DashboardViewPayload]:
        if not value:
            raise ValueError("Ao menos uma vista deve ser enviada")
        return value


class DashboardViewsResponse(SQLModel):
    empresa_id: int
    views: List[Any]