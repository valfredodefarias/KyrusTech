import pytest
from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.main import app
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.conta import Conta
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade

@pytest.fixture(name="setup_db")
def setup_db_fixture(session: Session):
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

    lancamento = Lancamento(
        id=1,
        descricao="Lancamento Teste",
        tipo="DESPESA",
        valor_previsto=Decimal("150.00"),
        valor_pago=Decimal("0.00"),
        data_vencimento=date(2026, 6, 15),
        data_competencia=date(2026, 6, 15),
        plano_contas_id=10,
        conta_id=1,
        entidade_id=5,
        empresa_id=1
    )
    session.add(lancamento)
    session.flush()

    session.commit()
    return {
        "empresa": empresa,
        "usuario": usuario,
        "conta": conta,
        "plano": plano,
        "entidade": entidade,
        "lancamento": lancamento
    }

def test_listar_lancamentos_minimized(client: TestClient, session: Session, setup_db):
    def mock_get_current_user():
        return setup_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    app.dependency_overrides.update(app_dependency_overrides)

    try:
        # Test normal listing (should contain related models and full fields)
        response_full = client.get("/api/v1/lancamentos/")
        assert response_full.status_code == 200
        data_full = response_full.json()
        assert len(data_full) == 1
        item_full = data_full[0]
        
        # Checking presence of full/nested/audit fields in normal query
        assert "created_at" in item_full
        assert "entidade" in item_full
        assert item_full["entidade"] is not None
        assert item_full["entidade"]["nome"] == "Fornecedor Teste"
        
        # Test minimized listing
        response_min = client.get("/api/v1/lancamentos/?minimized=true")
        assert response_min.status_code == 200
        data_min = response_min.json()
        assert len(data_min) == 1
        item_min = data_min[0]
        
        # Check expected fields in minimized response
        expected_keys = {
            "id", "descricao", "tipo", "status", "origem", "observacao", 
            "id_parcelamento", "data_vencimento", "data_pagamento", 
            "data_competencia", "competencia", "valor_previsto", "valor_pago", 
            "plano_contas_id", "conta_id", "entidade_id", "centro_custo_id", "cartao_id",
            "ipp", "previsto", "conciliado", "numero_parcela",
            "referencia_externa", "tipo_origem", "lote_cartao_id", "origem_uuid"
        }
        actual_keys = set(item_min.keys())
        
        assert actual_keys == expected_keys
        
        # Check specific values
        assert item_min["id"] == 1
        assert item_min["descricao"] == "Lancamento Teste"
        assert item_min["valor_previsto"] == 150.0
        assert item_min["entidade_id"] == 5
        
        # Checking absence of heavy fields
        assert "created_at" not in item_min
        assert "entidade" not in item_min
        assert "anexos" not in item_min
        assert "baixas" not in item_min

    finally:
        app.dependency_overrides.clear()
