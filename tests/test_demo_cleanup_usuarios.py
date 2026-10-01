from app.models.usuario import Usuario
from app.services.demo_cleanup_service import _is_convidado_demo


def _usuario(email: str, is_consultor: bool = False) -> Usuario:
    return Usuario(email=email, hashed_password="x", is_consultor=is_consultor)


def test_convidado_da_demo_e_removivel():
    assert _is_convidado_demo(_usuario("convidado_ab12cd@kyrustech.com"))


def test_consultor_visualizando_demo_nunca_e_removido():
    assert not _is_convidado_demo(_usuario("consultor@empresa.com", is_consultor=True))
    assert not _is_convidado_demo(_usuario("convidado_ab12cd@kyrustech.com", is_consultor=True))


def test_usuario_comum_nao_e_tratado_como_convidado():
    assert not _is_convidado_demo(_usuario("joao@cliente.com.br"))
