from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
from app.db.session import get_db
from app.models.dashboard_view_config import DashboardViewConfig
from app.models.usuario import Usuario
from app.schemas.dashboard_view import DashboardViewsResponse, DashboardViewsUpdate

router = APIRouter()


@router.get("/", response_model=DashboardViewsResponse)
def read_dashboard_views(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
):
    config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.empresa_id == empresa_id)
    ).first()
    return DashboardViewsResponse(
        empresa_id=empresa_id,
        views=(config.views if config else []),
    )


@router.put("/", response_model=DashboardViewsResponse)
def update_dashboard_views(
    payload: DashboardViewsUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
):
    config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.empresa_id == empresa_id)
    ).first()
    if not config:
        config = DashboardViewConfig(empresa_id=empresa_id, views=[])

    config.views = [view.model_dump(mode="json") for view in payload.views]
    db.add(config)
    db.commit()
    db.refresh(config)

    return DashboardViewsResponse(
        empresa_id=empresa_id,
        views=config.views,
    )