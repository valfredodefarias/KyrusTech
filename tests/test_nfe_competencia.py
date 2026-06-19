import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.main import app
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.conta import Conta
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento

@pytest.fixture(name="setup_nfe_db")
def setup_nfe_db_fixture(session: Session):
    empresa = Empresa(
        id=1,
        razao_social="Empresa Teste",
        nome_fantasia="Teste",
        cnpj="12345678000100",
        pdv_config="{}"
    )
    session.add(empresa)
    session.flush()

    usuario = Usuario(
        id=1,
        nome="Admin Teste",
        email="admin@test.com",
        hashed_password="hashed_pass",
        is_active=True,
        is_consultor=False,
        empresa_id=1
    )
    session.add(usuario)
    session.flush()

    conta = Conta(
        id=1,
        nome="Caixa Geral",
        tipo="CAIXA",
        saldo_inicial=Decimal("0.00"),
        status="ATIVO",
        empresa_id=1,
        conta_como_disponibilidade=True
    )
    session.add(conta)
    session.flush()

    plano = PlanoContas(
        id=10,
        codigo="2.1.01",
        nome="Fornecedores",
        tipo="D",
        eh_cabecalho=False,
        permite_lancamentos=True,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano)
    session.flush()

    entidade = Entidade(
        id=5,
        nome="Fornecedor Teste",
        tipo="FORNECEDOR",
        tipo_pessoa="PJ",
        cpf_cnpj="98765432100019",
        status="ATIVO",
        empresa_id=1
    )
    session.add(entidade)
    session.flush()

    session.commit()
    return {
        "empresa": empresa,
        "usuario": usuario,
        "conta": conta,
        "plano": plano,
        "entidade": entidade
    }

def test_confirmar_nfe_competencia(client: TestClient, session: Session, setup_nfe_db):
    def mock_get_current_user():
        return setup_nfe_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    app.dependency_overrides.update(app_dependency_overrides)

    with patch("app.api.deps.has_permission", return_value=True):
        try:
            payload = {
                "chave_nfe": "35231012345678000100550010001234561234567890",
                "numero_nfe": "123456",
                "tipo_lancamento": "DESPESA",
                "situacao": "AGUARDANDO_ENTREGA",
                "data_emissao": "2026-06-01",
                "plano_contas_id": 10,
                "entidade_id": 5,
                "conta_id": 1,
                "parcelas": [
                    {
                        "indice": 1,
                        "numero_parcela": "1",
                        "data_vencimento": "2026-07-15",
                        "valor": 100.0,
                        "plano_contas_id": 10,
                        "entidade_id": 5
                    },
                    {
                        "indice": 2,
                        "numero_parcela": "2",
                        "data_vencimento": "2026-08-15",
                        "valor": 100.0,
                        "plano_contas_id": 10,
                        "entidade_id": 5
                    }
                ]
            }

            response = client.post("/api/v1/importacao/nfe/confirmar", json=payload)
            assert response.status_code == 200
            res_json = response.json()
            assert res_json["lancamentos_criados"] == 2

            session.expire_all()
            lancamentos = session.exec(select(Lancamento).where(Lancamento.id_parcelamento == res_json["id_parcelamento"])).all()
            assert len(lancamentos) == 2
            for lanc in lancamentos:
                assert lanc.data_competencia == date(2026, 6, 1)
                assert lanc.competencia == "06-2026"

        finally:
            app.dependency_overrides.clear()
