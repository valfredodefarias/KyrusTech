# tests/test_movimentacao_pdv.py
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from datetime import date, datetime
from decimal import Decimal
import json

from app.models import Usuario, Empresa, Lancamento, CentroCusto, Conta, PlanoContas, PdvMovimentacao
from app.schemas.pdv import RegraCartaoCreate
from app.services.pdv_service import PdvService
from tests.test_pdv_conciliacao import setup_db_fixture
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user

# Reuse the setup_db fixture from pdv conciliation tests
setup_db = setup_db_fixture

def test_movimentacao_pdv_lifecycle(client: TestClient, session: Session, setup_db):
    # Retrieve user and company from setup_db
    usuario = setup_db["usuario"]
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
