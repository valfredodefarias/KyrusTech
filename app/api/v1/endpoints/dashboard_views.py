from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.v1.deps import get_current_active_user, get_empresa_id_from_user
from app.db.session import get_db
from app.models.dashboard_view_config import DashboardViewConfig
from app.models.usuario import Usuario
from app.schemas.dashboard_view import DashboardViewsResponse, DashboardViewsUpdate
from app.enums import ConsultorRole

router = APIRouter()

GLOBAL_DASHBOARD_CONFIG_KEY = "global-default"


def _is_super_consultor(user: Usuario) -> bool:
    return bool(user.is_consultor and user.consultor_role == ConsultorRole.SUPER_CONSULTOR.value)


def _get_empresa_config_key(empresa_id: int) -> str:
    return f"empresa:{empresa_id}"


@router.get("/", response_model=DashboardViewsResponse)
def read_dashboard_views(
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
):
    config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.config_key == _get_empresa_config_key(empresa_id))
    ).first()
    global_config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.config_key == GLOBAL_DASHBOARD_CONFIG_KEY)
    ).first()
    return DashboardViewsResponse(
        empresa_id=empresa_id,
        default_view=(global_config.views[0] if global_config and global_config.views else None),
        views=(config.views if config else []),
        can_manage_default=_is_super_consultor(current_user),
    )


@router.put("/", response_model=DashboardViewsResponse)
def update_dashboard_views(
    payload: DashboardViewsUpdate,
    db: Session = Depends(get_db),
    empresa_id: int = Depends(get_empresa_id_from_user),
    current_user: Usuario = Depends(get_current_active_user),
):
    config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.config_key == _get_empresa_config_key(empresa_id))
    ).first()
    if not config:
        config = DashboardViewConfig(
            empresa_id=empresa_id,
            scope="empresa",
            config_key=_get_empresa_config_key(empresa_id),
            views=[],
        )

    config.views = [view.model_dump(mode="json") for view in payload.views]
    db.add(config)

    if payload.update_default:
        if not _is_super_consultor(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Somente super consultor pode alterar o dashboard padrão global",
            )
        if not payload.default_view:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Envie a vista padrão para atualizar o dashboard global",
            )

        global_config = db.exec(
            select(DashboardViewConfig).where(DashboardViewConfig.config_key == GLOBAL_DASHBOARD_CONFIG_KEY)
        ).first()
        if not global_config:
            global_config = DashboardViewConfig(
                empresa_id=None,
                scope="global_default",
                config_key=GLOBAL_DASHBOARD_CONFIG_KEY,
                views=[],
            )
        global_config.views = [payload.default_view.model_dump(mode="json")]
        db.add(global_config)

    db.commit()
    db.refresh(config)

    global_config = db.exec(
        select(DashboardViewConfig).where(DashboardViewConfig.config_key == GLOBAL_DASHBOARD_CONFIG_KEY)
    ).first()

    return DashboardViewsResponse(
        empresa_id=empresa_id,
        default_view=(global_config.views[0] if global_config and global_config.views else None),
        views=config.views,
        can_manage_default=_is_super_consultor(current_user),
    )