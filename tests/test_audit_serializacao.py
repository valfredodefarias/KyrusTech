import json
from datetime import datetime
from decimal import Decimal

from app.db.audit import _build_create_changes, _build_delete_changes, _serialize_value
from app.models.access_profile import AccessProfile
from app.models.user_company_profile import UserCompanyProfile


def _perfil_com_relacionamento_carregado() -> UserCompanyProfile:
    profile = AccessProfile(id=7, empresa_id=1, name="Administrador", code="ADMIN")
    ucp = UserCompanyProfile(id=3, usuario_id=10, empresa_id=1, profile_id=7)
    ucp.profile = profile  # relacionamento carregado no __dict__, como acontece na limpeza de demos
    return ucp


def test_delete_ignora_relacionamentos_e_e_serializavel():
    changes = _build_delete_changes(_perfil_com_relacionamento_carregado())

    assert "profile" not in changes
    assert changes["profile_id"]["old"] == 7
    json.dumps(changes)  # não pode levantar "Object of type AccessProfile is not JSON serializable"


def test_create_ignora_relacionamentos_e_e_serializavel():
    changes = _build_create_changes(_perfil_com_relacionamento_carregado())

    assert "profile" not in changes
    assert changes["usuario_id"]["new"] == 10
    json.dumps(changes)


def test_serialize_value_converte_tipos_nao_json():
    assert _serialize_value(Decimal("10.50")) == "10.50"
    assert _serialize_value(datetime(2026, 10, 1, 7, 0)) == "2026-10-01T07:00:00"
    assert isinstance(_serialize_value(object()), str)
