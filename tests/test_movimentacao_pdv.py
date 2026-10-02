# tests/test_movimentacao_pdv.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from datetime import date, datetime
from decimal import Decimal
import json

from app.models import Usuario, Empresa, Lancamento, CentroCusto, Conta, PlanoContas, PdvMovimentacao, Produto, Entidade
from app.schemas.pdv import RegraCartaoCreate
from app.services.pdv_service import PdvService
from tests.test_pdv_conciliacao import setup_db_fixture
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user

# Reuse the setup_db fixture from pdv conciliation tests
setup_db = setup_db_fixture

def test_movimentacao_pdv_lifecycle(client: TestClient, session: Session, setup_db):
    # Retrieve user and company from setup_db
    usuario = setup_db["usuario"]
    usuario.is_consultor = True
    usuario.consultor_role = "SUPER_CONSULTOR"
    session.add(usuario)
    session.commit()
    empresa = setup_db["empresa"]

    # Configure mock authentication
    def mock_get_current_user():
        return usuario

    def mock_get_empresa_id_from_user():
        return empresa.id

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    from app.main import app
    app.dependency_overrides.update(app_dependency_overrides)
    
    try:
        # Check that cc and conta exist
        cc = session.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa.id)).first()
        assert cc is not None
        
        conta = session.exec(select(Conta).where(Conta.empresa_id == empresa.id)).first()
        assert conta is not None
        
        pc_rec = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa.id, PlanoContas.tipo == "RECEITA")).first()
        if not pc_rec:
            pc_rec = PlanoContas(nome="Vendas", tipo="RECEITA", empresa_id=empresa.id, permite_lancamentos=True)
            session.add(pc_rec)
            session.commit()
            session.refresh(pc_rec)

        # 1. Get list (should be empty initially)
        response = client.get("/api/v1/pdv/movimentacoes")
        assert response.status_code == 200
        initial_list = response.json()
        pdv_movements = [m for m in initial_list if m.get("id")]
        
        # 2. Create Entrada in Dinheiro
        payload_dinheiro = {
            "tipo": "ENTRADA",
            "descricao": "Venda Teste Dinheiro",
            "valor": 150.00,
            "forma_pagamento": "DINHEIRO",
            "bandeira": "OUTROS",
            "parcelas": 1,
            "data": "2026-07-12",
            "centro_custo_id": cc.id,
            "conta_id": conta.id
        }
        
        response = client.post("/api/v1/pdv/movimentacoes", json=payload_dinheiro)
        assert response.status_code == 200
        res_data = response.json()
        assert "id" in res_data
        created_id = res_data["id"]
        
        # 3. Verify created Lancamento
        session.expire_all()
        l_created = session.get(Lancamento, created_id)
        assert l_created is not None
        assert l_created.tipo == "RECEITA"
        assert l_created.valor_previsto == Decimal("150.00")
        assert l_created.status == "PAGO"
        meta = json.loads(l_created.observacao)
        assert meta.get("is_movimentacao_pdv") is True
        assert meta.get("forma_pagamento") == "DINHEIRO"
        
        m_created = session.get(PdvMovimentacao, created_id)
        assert m_created is not None
        assert m_created.tipo == "ENTRADA"
        assert m_created.valor == Decimal("150.00")
        
        # 4. Create Saida in Dinheiro (Sangria)
        payload_saida = {
            "tipo": "SAIDA",
            "descricao": "Sangria Teste",
            "valor": 50.00,
            "forma_pagamento": "DINHEIRO",
            "bandeira": "OUTROS",
            "parcelas": 1,
            "data": "2026-07-12",
            "centro_custo_id": cc.id,
            "conta_id": conta.id
        }
        
        response = client.post("/api/v1/pdv/movimentacoes", json=payload_saida)
        assert response.status_code == 200
        res_data_saida = response.json()
        assert "id" in res_data_saida
        saida_id = res_data_saida["id"]
        
        # 5. Verify created Saida Lancamento
        session.expire_all()
        l_saida = session.get(Lancamento, saida_id)
        assert l_saida is not None
        assert l_saida.tipo == "DESPESA"
        assert l_saida.valor_previsto == Decimal("50.00")
        assert l_saida.status == "PAGO"
        
        m_saida = session.get(PdvMovimentacao, saida_id)
        assert m_saida is not None
        assert m_saida.tipo == "SAIDA"
        
        # 5.5 Create Entrada in Cartao (DEBITO)
        payload_cartao = {
            "tipo": "ENTRADA",
            "descricao": "Venda Teste Cartao",
            "valor": 200.00,
            "forma_pagamento": "DEBITO",
            "bandeira": "VISA",
            "parcelas": 1,
            "data": "2026-07-12",
            "centro_custo_id": cc.id,
            "conta_id": conta.id
        }
        
        response = client.post("/api/v1/pdv/movimentacoes", json=payload_cartao)
        assert response.status_code == 200
        
        # 6. Get List again
        response = client.get("/api/v1/pdv/movimentacoes")
        assert response.status_code == 200
        movements_list = response.json()
        assert len(movements_list) >= 2
        assert any(m["id"] == created_id for m in movements_list)
        assert any(m["id"] == saida_id for m in movements_list)
        
        # 7. Try to delete Saida
        response = client.delete(f"/api/v1/pdv/movimentacoes/{saida_id}")
        assert response.status_code == 200
        
        session.expire_all()
        l_saida_del = session.get(Lancamento, saida_id)
        assert l_saida_del.is_deleted is True
        
        m_saida_del = session.get(PdvMovimentacao, saida_id)
        assert m_saida_del.is_deleted is True
        
        # 8. Test Lock for Conciliado
        session.expire_all()
        l_created = session.get(Lancamento, created_id)
        l_created.conciliado = True
        session.add(l_created)
        session.commit()
        
        # Try deleting a conciliado movement
        response = client.delete(f"/api/v1/pdv/movimentacoes/{created_id}")
        assert response.status_code == 400
        assert "conciliada" in response.json()["detail"]
        
        # Try updating a conciliado movement
        response = client.put(f"/api/v1/pdv/movimentacoes/{created_id}", json=payload_saida)
        assert response.status_code == 400
        assert "conciliada" in response.json()["detail"]
    finally:
        # Clean up overrides
        for key in app_dependency_overrides:
            app.dependency_overrides.pop(key, None)


def test_sangria_com_centavos_e_fuso_horario(client: TestClient, session: Session, setup_db):
    from zoneinfo import ZoneInfo
    from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
    BRAZIL_TZ = ZoneInfo("America/Sao_Paulo")

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

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    from app.main import app
    app.dependency_overrides.update(app_dependency_overrides)

    try:
        contas = session.exec(select(Conta).where(Conta.empresa_id == empresa.id)).all()
        assert len(contas) >= 1
        conta_origem = contas[0]
        if len(contas) < 2:
            conta_destino = Conta(
                nome="Conta Bancária Destino",
                tipo="CORRENTE",
                saldo_inicial=Decimal("0.00"),
                empresa_id=empresa.id
            )
            session.add(conta_destino)
            session.commit()
            session.refresh(conta_destino)
        else:
            conta_destino = contas[1]

        # 1. Registrar sangria com centavos exatos (R$ 84.75)
        sangria_payload = {
            "data": "2026-10-02",
            "valor": 84.75,
            "conta_destino_id": conta_destino.id,
            "descricao": "Sangria com centavos auditada"
        }
        resp = client.post("/api/v1/pdv/sangrias", json=sangria_payload)
        assert resp.status_code == 200, resp.text
        data_resp = resp.json()
        assert data_resp.get("status") == "success"
        saida_id = data_resp.get("saida_id")
        entrada_id = data_resp.get("entrada_id")
        assert saida_id is not None
        assert entrada_id is not None

        session.expire_all()
        l_saida = session.get(Lancamento, saida_id)
        assert l_saida is not None
        assert l_saida.valor_pago == Decimal("84.75")
        assert l_saida.valor_previsto == Decimal("84.75")

        l_entrada = session.get(Lancamento, entrada_id)
        assert l_entrada is not None
        assert l_entrada.valor_pago == Decimal("84.75")
        assert l_entrada.valor_previsto == Decimal("84.75")

        m_op = session.get(PdvMovimentacao, saida_id)
        assert m_op is not None
        assert m_op.valor == Decimal("84.75")

        # 2. Testar venda com fuso horário brasileiro
        produto = session.exec(select(Produto).where(Produto.empresa_id == empresa.id)).first()
        if not produto:
            produto = Produto(
                nome="Produto Teste Fuso",
                preco_unitario=Decimal("20.00"),
                empresa_id=empresa.id,
                is_active=True
            )
            session.add(produto)
            session.commit()
            session.refresh(produto)

        entidade = session.exec(select(Entidade).where(Entidade.empresa_id == empresa.id)).first()
        if not entidade:
            entidade = Entidade(
                nome="Cliente Padrão Teste",
                tipo="CLIENTE",
                empresa_id=empresa.id
            )
            session.add(entidade)
            session.commit()
            session.refresh(entidade)

        cc = session.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa.id)).first()
        assert cc is not None

        venda_in = PdvVendaCreate(
            entidade_id=entidade.id,
            centro_custo_id=cc.id,
            vendedor_id=usuario.id,
            desconto=Decimal("0.00"),
            status="REALIZADO",
            itens=[PdvVendaItemCreate(produto_id=produto.id, quantidade=1, preco_unitario=Decimal("20.00"))],
            pagamentos=[PdvVendaPagamento(tipo_pagamento="dinheiro", valor=Decimal("20.00"))]
        )
        venda_res = PdvService.criar_venda(session, venda_in, empresa_id=empresa.id, current_user_id=usuario.id)
        session.commit()

        expected_hora = datetime.now(BRAZIL_TZ).strftime("%H:%M")
        assert venda_res.hora == expected_hora
        assert venda_res.data == datetime.now(BRAZIL_TZ).date()
    finally:
        for key in app_dependency_overrides:
            app.dependency_overrides.pop(key, None)

