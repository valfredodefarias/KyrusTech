# tests/test_recebiveis_origem.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from datetime import date, datetime
from decimal import Decimal

from app.models import Usuario, Empresa, CentroCusto, Conta, PlanoContas, PdvMovimentacao, PdvVenda, PdvIfoodLancamento
from app.schemas.ifood import PdvIfoodLancamentoCreate
from app.services.pdv.ifood_service import criar_transacao_ifood
from tests.test_pdv_conciliacao import setup_db_fixture
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user

setup_db = setup_db_fixture

def test_recebiveis_origem_identificacao(client: TestClient, session: Session, setup_db):
    usuario = setup_db["usuario"]
    usuario.is_consultor = True
    usuario.consultor_role = "SUPER_CONSULTOR"
    session.add(usuario)
    session.commit()
    empresa = setup_db["empresa"]

    def mock_get_current_user():
        return usuario

    def mock_get_empresa_id_from_user():
        return empresa.id

    from app.main import app
    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_current_active_user] = mock_get_current_user
    app.dependency_overrides[get_empresa_id_from_user] = mock_get_empresa_id_from_user

    try:
        # 1. Criar recebível com origem pdv_movimentacao
        mov_frente = PdvMovimentacao(
            empresa_id=empresa.id,
            tipo="ENTRADA",
            descricao="Venda Frente Caixa Cartão",
            valor=Decimal("150.00"),
            forma_pagamento="CREDITO_AVISTA",
            bandeira="VISA",
            parcelas=1,
            numero_parcela=1,
            data=date.today(),
            origem_tipo="pdv_movimentacao",
            origem_id="999001"
        )
        session.add(mov_frente)

        # 2. Criar recebível com origem pdv_venda
        venda_obj = PdvVenda(
            id="venda-uuid-origem-test-123",
            empresa_id=empresa.id,
            data_venda=date.today(),
            valor_subtotal=Decimal("200.00"),
            valor_desconto=Decimal("0.00"),
            valor_total=Decimal("200.00"),
            status="REALIZADO",
            rv="RV-123456"
        )
        session.add(venda_obj)
        session.flush()

        mov_venda = PdvMovimentacao(
            empresa_id=empresa.id,
            tipo="ENTRADA",
            descricao="Venda de Itens PDV",
            valor=Decimal("200.00"),
            forma_pagamento="CREDITO_AVISTA",
            bandeira="MASTERCARD",
            parcelas=1,
            numero_parcela=1,
            data=date.today(),
            venda_id=venda_obj.id,
            origem_tipo="pdv_venda",
            origem_id=venda_obj.id
        )
        session.add(mov_venda)

        # 3. Criar recebível com origem manual
        mov_manual = PdvMovimentacao(
            empresa_id=empresa.id,
            tipo="ENTRADA",
            descricao="Recebível Lançado Manualmente",
            valor=Decimal("80.00"),
            forma_pagamento="DEBITO",
            bandeira="ELO",
            parcelas=1,
            numero_parcela=1,
            data=date.today(),
            origem_tipo="manual",
            origem_id="777001"
        )
        session.add(mov_manual)

        # 4. Criar transação iFood usando ifood_service para validar gravação de origem_tipo e origem_id
        ifood_in = PdvIfoodLancamentoCreate(
            forma_recebimento="credito_vista",
            valor_bruto=Decimal("120.00"),
            data_venda=date.today(),
            hora_venda="12:30:00",
            data_recebimento_ajustada=date.today(),
            despesas_extras=[]
        )
        ifood_tx = criar_transacao_ifood(session, ifood_in, empresa.id, usuario.id)
        
        # Validar que ifood_service gravou origem_tipo e origem_id reais
        assert ifood_tx.origem_tipo == "pdv_ifood_lancamento"
        assert ifood_tx.origem_id == str(ifood_tx.id)

        # 5. Requisitar a lista de recebíveis
        response = client.get("/api/v1/pdv/recebiveis")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 4

        # Validar campos de origem expostos
        origens_encontradas = {r["origem"]["tipo"]: r for r in data if "origem" in r}

        assert "pdv_movimentacao" in origens_encontradas
        assert origens_encontradas["pdv_movimentacao"]["origem"]["id"] == "999001"

        assert "pdv_venda" in origens_encontradas
        assert origens_encontradas["pdv_venda"]["origem"]["id"] == "venda-uuid-origem-test-123"

        assert "manual" in origens_encontradas
        assert origens_encontradas["manual"]["origem"]["id"] == "777001"

        assert "pdv_ifood_lancamento" in origens_encontradas
        ifood_rec = origens_encontradas["pdv_ifood_lancamento"]
        assert ifood_rec["origem"]["id"] == str(ifood_tx.id)
        assert ifood_rec["origem_id"] == str(ifood_tx.id)
        assert ifood_rec["origem_tipo"] == "pdv_ifood_lancamento"
        assert ifood_rec["id"] == ifood_tx.id

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)
        app.dependency_overrides.pop(get_empresa_id_from_user, None)
