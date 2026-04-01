# app/api/v1/deps.py
# Este arquivo serve apenas como atalho para o arquivo principal
from app.api.deps import (
    get_current_user,
    get_current_active_user,
    get_empresa_id_from_user,
    get_consultor_user,
    get_super_consultor_user,
    get_current_user_permission_codes,
    require_permission,
    require_any_permission,
)