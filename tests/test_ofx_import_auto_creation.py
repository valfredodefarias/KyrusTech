import pytest
from datetime import date, datetime
from decimal import Decimal
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.db.session import get_db
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.main import app

@pytest.fixture(name="setup_test_db")
def setup_test_db_fixture(session: Session):
    # Seed Empresa
    empresa = Empresa(
        id=1,
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste",
        cnpj="12345678000199",
        pdv_config="{}"
    )
    session.add(empresa)
    session.flush()

    # Seed Usuario
    usuario = Usuario(
        id=1,
        nome="João Vendedor",
        email="vendedor@teste.com",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=False,
        empresa_id=1
    )
    session.add(usuario)
    session.flush()

    # Seed Centro de Custo
    centro = CentroCusto(
        id=1,
        nome="Matriz",
        descricao="Filial Principal",
        empresa_id=1
    )
    session.add(centro)
    session.flush()

    # Seed Conta Bancaria (linked to Centro de Custo)
    conta = Conta(
        id=1,
        nome="Banco Itaú",
        tipo="BANCO",
        saldo_inicial=Decimal("1000.00"),
        status="ATIVO",
        empresa_id=1,
        conta_como_disponibilidade=True,
        centro_custo_id=1
    )
    session.add(conta)
    session.flush()

    # Seed Plano de Contas
    plano = PlanoContas(
        id=10,
        codigo="1.1.01",
        nome="Vendas de Mercadorias",
        tipo="R",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano)
    session.flush()

    session.commit()
    return {
        "empresa": empresa,
        "usuario": usuario,
        "conta": conta,
        "plano": plano,
        "centro": centro
    }

def test_ofx_import_auto_creation_and_divergence_bypass(client: TestClient, session: Session, setup_test_db):
    # Authentication overrides
    def mock_get_current_user():
        return setup_test_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    app.dependency_overrides.update(app_dependency_overrides)
    
    # Use patch to mock has_permission
    with patch("app.api.deps.has_permission", return_value=True):
        try:
            # Check that no Entidades named "Interessado Automatico LTDA" exist in database
            entities_before = session.exec(select(Entidade).where(Entidade.nome == "Interessado Automatico LTDA")).all()
            assert len(entities_before) == 0

            # 1. Payload with no Entidade ID, but custom 'interessado_digitado'
            payload = {
                "conta_id": 1,
                "modo_importacao": "CONTA",
                "ignorar_divergencia": True,
                "lancamentos": [
                    {
                        "data": "2026-06-13",
                        "descricao": "RECEBIMENTO CLIENTE AUTO",
                        "valor": 500.00,
                        "tipo": "RECEITA",
                        "origem": "OFX",
                        "linha_arquivo": 1,
                        "sugestao_acao": "CRIAR_NOVO",
                        "plano_contas_id": 10,
                        "entidade_id": None,
                        "interessado_digitado": "Interessado Automatico LTDA",
                        "import_hash": "hash_teste_auto_creation_1"
                    }
                ]
            }

            response = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload)
            print("RESPONSE JSON:", response.json())
            assert response.status_code == 200
            res_json = response.json()
            assert res_json["sucesso"] is True
            assert res_json["lancamentos_criados"] == 1

            # Verify Entidade was automatically created
            session.expire_all()
            entities_after = session.exec(select(Entidade).where(Entidade.nome == "Interessado Automatico LTDA")).all()
            assert len(entities_after) == 1
            created_entity = entities_after[0]
            assert created_entity.empresa_id == 1

            # Verify Lancamento has the created Entidade ID
            lancamentos = session.exec(select(Lancamento).where(Lancamento.descricao == "RECEBIMENTO CLIENTE AUTO")).all()
            assert len(lancamentos) == 1
            assert lancamentos[0].entidade_id == created_entity.id

        finally:
            app.dependency_overrides.clear()
