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


def test_ofx_value_proximity_and_greedy_matching(client: TestClient, session: Session, setup_test_db):
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
    
    # Create a planned transaction (previsto) in the DB
    previsto = Lancamento(
        descricao="Internet Mensal",
        valor_previsto=Decimal("800.00"),
        data_vencimento=date(2026, 6, 11),
        data_competencia=date(2026, 6, 11),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    session.add(previsto)
    session.commit()
    session.refresh(previsto)

    # We mock processar_ofx to return two OFX rows:
    # Row 1 has value 780.00 (difference 20.00)
    # Row 2 has value 790.00 (difference 10.00)
    mocked_ofx_rows = [
        {
            "data": date(2026, 6, 11),
            "data_pagamento": "2026-06-11",
            "data_vencimento": "2026-06-11",
            "descricao": "BOLETO MENSAL INTERNET SERVICE A",
            "razao_social": "Internet Provider",
            "cpf_cnpj": "",
            "valor": Decimal("780.00"),
            "tipo": "DESPESA",
            "origem": "OFX_EXTRATO",
            "linha_arquivo": 1,
            "saldo_informativo": False
        },
        {
            "data": date(2026, 6, 11),
            "data_pagamento": "2026-06-11",
            "data_vencimento": "2026-06-11",
            "descricao": "BOLETO MENSAL INTERNET SERVICE B",
            "razao_social": "Internet Provider",
            "cpf_cnpj": "",
            "valor": Decimal("790.00"),
            "tipo": "DESPESA",
            "origem": "OFX_EXTRATO",
            "linha_arquivo": 2,
            "saldo_informativo": False
        }
    ]

    with patch("app.api.v1.endpoints.importacao_ofx.processar_ofx", return_value=mocked_ofx_rows), \
         patch("app.api.deps.has_permission", return_value=True):
        try:
            # Call upload endpoint
            response = client.post(
                "/api/v1/importacao/ofx/upload?conta_id=1",
                files={"arquivo": ("extrato.ofx", b"OFX CONTENT", "application/xml")}
            )
            assert response.status_code == 200
            res_json = response.json()
            
            # Row 2 (index 1 in processados, because it was closer, 790 vs 800) should get B.
            # Row 1 (index 0 in processados, 780 vs 800) should NOT get B.
            processados = res_json["lancamentos"]
            assert len(processados) == 2
            
            row_780 = next(p for p in processados if p["linha_arquivo"] == 1)
            row_790 = next(p for p in processados if p["linha_arquivo"] == 2)
            
            # Verify row_790 matched previsto because it is closer (value score is higher)
            assert row_790["sugestao_acao"] == "BAIXAR_PREVISTO"
            assert row_790["lancamento_previsto_id"] == previsto.id
            
            # Verify row_780 was NOT matched to previsto because it lost the greedy match (was assigned to row_790)
            assert row_780["sugestao_acao"] == "CRIAR_NOVO"
            assert row_780["lancamento_previsto_id"] is None

        finally:
            app.dependency_overrides.clear()


def test_ofx_close_date_previsto_prioritization(client: TestClient, session: Session, setup_test_db):
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
    
    # 1. Create a previsto that is on a different day (vencimento tomorrow, 2026-06-12) with the exact same value (2570.00)
    previsto = Lancamento(
        descricao="Previsto Correto",
        valor_previsto=Decimal("2570.00"),
        data_vencimento=date(2026, 6, 12),
        data_competencia=date(2026, 6, 12),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    
    # 2. Create an atrasado that has a matching value (within 5%, e.g., 2500.00) but is on an older date (vencimento 10 days ago, 2026-06-01)
    atrasado = Lancamento(
        descricao="Atrasado Qualquer",
        valor_previsto=Decimal("2500.00"),
        data_vencimento=date(2026, 6, 1),
        data_competencia=date(2026, 6, 1),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    
    session.add(previsto)
    session.add(atrasado)
    session.commit()
    session.refresh(previsto)
    session.refresh(atrasado)

    mocked_ofx_rows = [
        {
            "data": date(2026, 6, 11), # Payment date
            "data_pagamento": "2026-06-11",
            "data_vencimento": "2026-06-11",
            "descricao": "PAGAMENTO TESTE",
            "razao_social": "Favorecido Teste",
            "cpf_cnpj": "",
            "valor": Decimal("2570.00"),
            "tipo": "DESPESA",
            "origem": "OFX_EXTRATO",
            "linha_arquivo": 1,
            "saldo_informativo": False
        }
    ]

    with patch("app.api.v1.endpoints.importacao_ofx.processar_ofx", return_value=mocked_ofx_rows), \
         patch("app.api.deps.has_permission", return_value=True):
        try:
            # Call upload endpoint
            response = client.post(
                "/api/v1/importacao/ofx/upload?conta_id=1",
                files={"arquivo": ("extrato.ofx", b"OFX CONTENT", "application/xml")}
            )
            assert response.status_code == 200
            res_json = response.json()
            
            processados = res_json["lancamentos"]
            assert len(processados) == 1
            row = processados[0]
            
            # The system should prioritize BAIXAR_PREVISTO with the close-date previsto (valor exato)
            # over RELACIONAR_ATRASADOS with the older atrasado.
            assert row["sugestao_acao"] == "BAIXAR_PREVISTO"
            assert row["lancamento_previsto_id"] == previsto.id

        finally:
            app.dependency_overrides.clear()


def test_ofx_import_split_previsto_reconciliation(client: TestClient, session: Session, setup_test_db):
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
    
    # Create one single previsto with a total value of 2739.99
    previsto = Lancamento(
        descricao="Salario Previsto",
        valor_previsto=Decimal("2739.99"),
        data_vencimento=date(2026, 6, 15),
        data_competencia=date(2026, 6, 15),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    session.add(previsto)
    session.commit()
    session.refresh(previsto)

    # We mock confirming/submitting the reconciliation payload
    # Two OFX rows will target the same previsto.id
    payload = {
        "conta_id": 1,
        "modo_importacao": "CONTA",
        "ignorar_divergencia": True,
        "lancamentos": [
            {
                "data": "2026-06-15",
                "descricao": "PIX ENVIADO PARTE 1",
                "valor": 1000.00,
                "tipo": "DESPESA",
                "origem": "OFX",
                "linha_arquivo": 1,
                "sugestao_acao": "BAIXAR_PREVISTO",
                "sugestao_confirmada": True,
                "lancamento_previsto_id": previsto.id,
                "plano_contas_id": 10,
                "import_hash": "hash_split_test_1"
            },
            {
                "data": "2026-06-15",
                "descricao": "PIX ENVIADO PARTE 2",
                "valor": 1739.99,
                "tipo": "DESPESA",
                "origem": "OFX",
                "linha_arquivo": 2,
                "sugestao_acao": "BAIXAR_PREVISTO",
                "sugestao_confirmada": True,
                "lancamento_previsto_id": previsto.id,
                "plano_contas_id": 10,
                "import_hash": "hash_split_test_2"
            }
        ]
    }

    with patch("app.api.deps.has_permission", return_value=True):
        try:
            response = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload)
            print("SPLIT RESPONSE JSON:", response.json())
            assert response.status_code == 200
            res_json = response.json()
            assert res_json["sucesso"] is True

            # Query database to check the split results
            session.expire_all()
            all_lancs = session.exec(
                select(Lancamento)
                .where(Lancamento.empresa_id == 1)
                .where(Lancamento.is_deleted == False)
                .where(Lancamento.descricao.like("%Salario%"))
            ).all()
            
            # Since confirmation creates reconciled entries,
            # let's assert there are 2 launches matching Salario
            assert len(all_lancs) == 2
            
            # Check they have status "PAGO" or similar, and are marked conciliado
            for lanc in all_lancs:
                assert lanc.conciliado is True
                assert lanc.id_parcelamento is not None
                assert lanc.id_parcelamento.startswith("split-previsto-")
                
            # Verify values
            values = {lanc.valor_previsto for lanc in all_lancs}
            assert Decimal("1000.00") in values
            assert Decimal("1739.99") in values

            # Verify that their id_parcelamento is exactly equal
            assert all_lancs[0].id_parcelamento == all_lancs[1].id_parcelamento

        finally:
            app.dependency_overrides.clear()


def test_ofx_multiple_atrasados_only_preselects_best_match(client: TestClient, session: Session, setup_test_db):
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
    
    # Create two atrasados (overdue expected launches):
    # Atrasado A: closer date/better match (vencimento 2026-06-05, value 450)
    # Atrasado B: further date/lower score (vencimento 2026-05-20, value 444)
    atrasado_a = Lancamento(
        descricao="proseg",
        valor_previsto=Decimal("450.00"),
        data_vencimento=date(2026, 6, 5),
        data_competencia=date(2026, 6, 5),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    atrasado_b = Lancamento(
        descricao="NFE 60919",
        valor_previsto=Decimal("444.00"),
        data_vencimento=date(2026, 5, 20),
        data_competencia=date(2026, 5, 20),
        tipo="DESPESA",
        status="PENDENTE",
        empresa_id=1,
        conta_id=1,
        plano_contas_id=10,
        is_deleted=False
    )
    session.add(atrasado_a)
    session.add(atrasado_b)
    session.commit()
    session.refresh(atrasado_a)
    session.refresh(atrasado_b)

    mocked_ofx_rows = [
        {
            "data": date(2026, 6, 15),
            "data_pagamento": "2026-06-15",
            "data_vencimento": "2026-06-15",
            "descricao": "PIX ENVIADO BRENO SANCHES",
            "razao_social": "proseg",
            "cpf_cnpj": "",
            "valor": Decimal("450.00"),
            "tipo": "DESPESA",
            "origem": "OFX_EXTRATO",
            "linha_arquivo": 1,
            "saldo_informativo": False
        }
    ]

    with patch("app.api.v1.endpoints.importacao_ofx.processar_ofx", return_value=mocked_ofx_rows), \
         patch("app.api.deps.has_permission", return_value=True):
        try:
            response = client.post(
                "/api/v1/importacao/ofx/upload?conta_id=1",
                files={"arquivo": ("extrato.ofx", b"OFX CONTENT", "application/xml")}
            )
            assert response.status_code == 200
            res_json = response.json()
            
            processados = res_json["lancamentos"]
            assert len(processados) == 1
            row = processados[0]
            
            # Should have action RELACIONAR_ATRASADOS
            assert row["sugestao_acao"] == "RELACIONAR_ATRASADOS"
            
            # lancamentos_atrasados_ids should contain ONLY the best match (atrasado_a)
            assert row["lancamentos_atrasados_ids"] == [atrasado_a.id]
            
            # lancamentos_atrasados_resumo should contain both
            resumo_ids = [r["id"] for r in row["lancamentos_atrasados_resumo"]]
            assert atrasado_a.id in resumo_ids
            assert atrasado_b.id in resumo_ids
            assert len(resumo_ids) >= 2

        finally:
            app.dependency_overrides.clear()

