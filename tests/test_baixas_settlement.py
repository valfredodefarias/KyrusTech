import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from fastapi import status
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.main import app
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.movimento import Movimento
from app.models.baixa import Baixa

@pytest.fixture(name="setup_baixas_db")
def setup_baixas_db_fixture(session: Session):
    # Empresa
    empresa = Empresa(
        id=1,
        razao_social="Empresa Financeira S/A",
        nome_fantasia="Finances",
        cnpj="12345678000100",
        pdv_config="{}"
    )
    session.add(empresa)
    session.flush()

    # Usuario
    usuario = Usuario(
        id=1,
        nome="Admin Financeiro",
        email="admin@finances.com",
        hashed_password="hashed_pass",
        is_active=True,
        is_consultor=False,
        empresa_id=1
    )
    session.add(usuario)
    session.flush()

    # Centro de Custo
    centro = CentroCusto(
        id=1,
        nome="Financeiro",
        descricao="Depto Financeiro",
        empresa_id=1
    )
    session.add(centro)
    session.flush()

    # Conta
    conta = Conta(
        id=1,
        nome="Banco do Brasil",
        tipo="BANCO",
        saldo_inicial=Decimal("0.00"),
        status="ATIVO",
        empresa_id=1,
        conta_como_disponibilidade=True,
        centro_custo_id=1
    )
    session.add(conta)
    session.flush()

    # Plano de Contas (Receita)
    plano_receita = PlanoContas(
        id=10,
        codigo="1.1.01",
        nome="Receitas de Vendas",
        tipo="R",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano_receita)
    session.flush()

    session.commit()
    return {
        "empresa": empresa,
        "usuario": usuario,
        "conta": conta,
        "plano": plano_receita,
        "centro": centro
    }

def test_conciliation_one_to_many(client: TestClient, session: Session, setup_baixas_db):
    """
    Test 1:N Conciliation: 1 Movimento OFX paying 2 Launch previstos.
    """
    def mock_get_current_user():
        return setup_baixas_db["usuario"]

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
            # Create two previstos
            p1 = Lancamento(
                descricao="Prestacao Servico A",
                valor_previsto=Decimal("1500.00"),
                data_vencimento=date(2026, 6, 15),
                data_competencia=date(2026, 6, 15),
                tipo="RECEITA",
                status="PENDENTE",
                empresa_id=1,
                conta_id=1,
                plano_contas_id=10,
            )
            p2 = Lancamento(
                descricao="Prestacao Servico B",
                valor_previsto=Decimal("1000.00"),
                data_vencimento=date(2026, 6, 15),
                data_competencia=date(2026, 6, 15),
                tipo="RECEITA",
                status="PENDENTE",
                empresa_id=1,
                conta_id=1,
                plano_contas_id=10,
            )
            session.add_all([p1, p2])
            session.flush()

            # Create the Movimento
            mov = Movimento(
                descricao="DEPOSITO LOTE CLIENTE",
                valor=Decimal("2500.00"),
                tipo="RECEITA",
                data=date(2026, 6, 15),
                import_hash="hash_lote_recebimento_1",
                status="ABERTO",
                empresa_id=1,
                conta_id=1
            )
            session.add(mov)
            session.commit()

            # Confirm conciliation payload
            payload = {
                "conta_id": 1,
                "modo_importacao": "CONTA",
                "ignorar_divergencia": True,
                "conciliacoes": [
                    {
                        "movimento_id": mov.id,
                        "alocacoes": [
                            {"lancamento_id": p1.id, "valor_alocado": 1500.00, "tipo_baixa": "PRINCIPAL"},
                            {"lancamento_id": p2.id, "valor_alocado": 1000.00, "tipo_baixa": "PRINCIPAL"}
                        ]
                    }
                ]
            }

            response = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload)
            assert response.status_code == 200
            res_json = response.json()
            assert res_json["sucesso"] is True

            # Verify that both launches are now paid
            session.expire_all()
            session.refresh(p1)
            session.refresh(p2)
            assert p1.status == "PAGO"
            assert p1.valor_pago == Decimal("1500.00")
            assert p1.conciliado is True

            assert p2.status == "PAGO"
            assert p2.valor_pago == Decimal("1000.00")
            assert p2.conciliado is True

            # Verify baixas were created
            baixas = session.exec(select(Baixa).where(Baixa.movimento_id == mov.id)).all()
            assert len(baixas) == 2
            assert {b.lancamento_id for b in baixas} == {p1.id, p2.id}
            assert sum(b.valor_pago for b in baixas) == Decimal("2500.00")

            # Verify movimento is CONCILIADO
            session.refresh(mov)
            assert mov.status == "CONCILIADO"

        finally:
            app.dependency_overrides.clear()

def test_conciliation_many_to_one_partial(client: TestClient, session: Session, setup_baixas_db):
    """
    Test N:1 Conciliation: 2 separate MovimentoOFX paying a single Launch (partial payments).
    """
    def mock_get_current_user():
        return setup_baixas_db["usuario"]

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
            # Create a single previsto for 3000.00
            p = Lancamento(
                descricao="Fatura Consultoria Mensal",
                valor_previsto=Decimal("3000.00"),
                data_vencimento=date(2026, 6, 15),
                data_competencia=date(2026, 6, 15),
                tipo="RECEITA",
                status="PENDENTE",
                empresa_id=1,
                conta_id=1,
                plano_contas_id=10,
            )
            session.add(p)
            session.flush()

            # Create two separate bank movements of 1500.00 each
            mov1 = Movimento(
                descricao="PIX PARCELA 1",
                valor=Decimal("1500.00"),
                tipo="RECEITA",
                data=date(2026, 6, 15),
                import_hash="hash_pix_p1",
                status="ABERTO",
                empresa_id=1,
                conta_id=1
            )
            mov2 = Movimento(
                descricao="PIX PARCELA 2",
                valor=Decimal("1500.00"),
                tipo="RECEITA",
                data=date(2026, 6, 16),
                import_hash="hash_pix_p2",
                status="ABERTO",
                empresa_id=1,
                conta_id=1
            )
            session.add_all([mov1, mov2])
            session.commit()

            # Confirm first payment (partial)
            payload1 = {
                "conta_id": 1,
                "modo_importacao": "CONTA",
                "ignorar_divergencia": True,
                "conciliacoes": [
                    {
                        "movimento_id": mov1.id,
                        "alocacoes": [
                            {"lancamento_id": p.id, "valor_alocado": 1500.00, "tipo_baixa": "PRINCIPAL"}
                        ]
                    }
                ]
            }

            resp1 = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload1)
            assert resp1.status_code == 200
            
            session.expire_all()
            session.refresh(p)
            assert p.status == "PARCIALMENTE_PAGO"
            assert p.valor_pago == Decimal("1500.00")
            assert p.conciliado is True

            # Confirm second payment (completing the balance)
            payload2 = {
                "conta_id": 1,
                "modo_importacao": "CONTA",
                "ignorar_divergencia": True,
                "conciliacoes": [
                    {
                        "movimento_id": mov2.id,
                        "alocacoes": [
                            {"lancamento_id": p.id, "valor_alocado": 1500.00, "tipo_baixa": "PRINCIPAL"}
                        ]
                    }
                ]
            }

            resp2 = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload2)
            assert resp2.status_code == 200

            session.expire_all()
            session.refresh(p)
            assert p.status == "PAGO"
            assert p.valor_pago == Decimal("3000.00")
            assert p.conciliado is True

            # Verify both baixas
            baixas = session.exec(select(Baixa).where(Baixa.lancamento_id == p.id)).all()
            assert len(baixas) == 2
            assert sum(b.valor_pago for b in baixas) == Decimal("3000.00")

        finally:
            app.dependency_overrides.clear()

def test_gold_lock_validation_error(client: TestClient, session: Session, setup_baixas_db):
    """
    Test "Trava de Ouro" Math validation failure.
    Should fail with 400 Bad Request if allocations do not match MovimentoOFX.
    """
    def mock_get_current_user():
        return setup_baixas_db["usuario"]

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
            p = Lancamento(
                descricao="Taxa Adm",
                valor_previsto=Decimal("100.00"),
                data_vencimento=date(2026, 6, 15),
                data_competencia=date(2026, 6, 15),
                tipo="DESPESA",
                status="PENDENTE",
                empresa_id=1,
                conta_id=1,
                plano_contas_id=10,
            )
            session.add(p)
            session.flush()

            mov = Movimento(
                descricao="TARIFA BANCARIA",
                valor=Decimal("99.90"),  # Mismatch by 10 cents
                tipo="DESPESA",
                data=date(2026, 6, 15),
                import_hash="hash_tarifa_mismatch",
                status="ABERTO",
                empresa_id=1,
                conta_id=1
            )
            session.add(mov)
            session.commit()

            payload = {
                "conta_id": 1,
                "modo_importacao": "CONTA",
                "ignorar_divergencia": True,
                "conciliacoes": [
                    {
                        "movimento_id": mov.id,
                        "alocacoes": [
                            {"lancamento_id": p.id, "valor_alocado": 100.00, "tipo_baixa": "PRINCIPAL"}
                        ]
                    }
                ]
            }

            response = client.post("/api/v1/importacao/confirmar-lancamentos", json=payload)
            assert response.status_code == 400
            assert "Divergência matemática detectada" in response.json()["detail"]["message"]

        finally:
            app.dependency_overrides.clear()

def test_conciliation_lock_and_unconciliate(client: TestClient, session: Session, setup_baixas_db):
    """
    Test that conciliated launches cannot be edited or deleted directly,
    but can be unconciliated via the desconciliar endpoint, resetting fields and movements.
    """
    def mock_get_current_user():
        return setup_baixas_db["usuario"]

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
            # Create a conciliated launch
            l = Lancamento(
                descricao="Fatura Internet Conciliada",
                valor_previsto=Decimal("150.00"),
                valor_pago=Decimal("150.00"),
                data_vencimento=date(2026, 6, 15),
                data_competencia=date(2026, 6, 15),
                data_pagamento=date(2026, 6, 15),
                tipo="DESPESA",
                status="PAGO",
                conciliado=True,
                empresa_id=1,
                conta_id=1,
                plano_contas_id=10,
            )
            session.add(l)
            session.flush()

            # Create a movement
            mov = Movimento(
                descricao="DIVERSOS NET COM",
                valor=Decimal("-150.00"),
                tipo="DESPESA",
                data=date(2026, 6, 15),
                import_hash="hash_internet_conciliado",
                status="CONCILIADO",
                empresa_id=1,
                conta_id=1
            )
            session.add(mov)
            session.flush()

            # Create a Baixa linking them
            baixa = Baixa(
                empresa_id=1,
                lancamento_id=l.id,
                movimento_id=mov.id,
                valor_pago=Decimal("150.00"),
                tipo_baixa="PRINCIPAL",
                data_baixa=date(2026, 6, 15),
                is_deleted=False
            )
            session.add(baixa)
            session.commit()

            # 1. Try to delete the launch directly -> should fail with 400
            del_response = client.delete(f"/api/v1/lancamentos/{l.id}")
            assert del_response.status_code == 400
            assert "conciliados não podem ser excluídos" in del_response.json()["detail"]

            # 2. Try to edit a critical field (e.g. valor_previsto) -> should fail with 400
            edit_response = client.put(f"/api/v1/lancamentos/{l.id}", json={"valor_previsto": 200.00})
            assert edit_response.status_code == 400
            assert "Campos críticos" in edit_response.json()["detail"]

            # 3. Try to edit a non-critical field (e.g. observacao) -> should pass
            edit_ok_response = client.put(f"/api/v1/lancamentos/{l.id}", json={"observacao": "Nova Obs"})
            assert edit_ok_response.status_code == 200

            # 4. Desconciliar via endpoint
            desc_response = client.post(f"/api/v1/importacao/ofx/desconciliar/{l.id}")
            assert desc_response.status_code == 200
            assert desc_response.json()["sucesso"] is True

            # 5. Check database states after desconciliation
            session.expire_all()
            session.refresh(l)
            session.refresh(mov)
            session.refresh(baixa)

            assert l.conciliado is False
            assert l.status == "EM ABERTO"
            assert l.valor_pago == Decimal("0.00")
            assert l.data_pagamento is None

            assert mov.status == "ABERTO"
            assert baixa.is_deleted is True

        finally:
            app.dependency_overrides.clear()

