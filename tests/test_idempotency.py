import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.models.idempotency_log import IdempotencyLog
from tests.test_pdv_conciliacao import setup_db_fixture  # Reutiliza o setup_db do PDV

# Para evitar NameError de setup_db
setup_db = setup_db_fixture

def test_idempotency_workflow(client: TestClient, session: Session, setup_db):
    # Configurar mock de autenticação
    def mock_get_current_user():
        return setup_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    from app.main import app
    app.dependency_overrides.update(app_dependency_overrides)
    
    try:
        hoje = date(2026, 6, 13)
        payload = {
            "entidade_id": 1,
            "centro_custo_id": 1,
            "vendedor_id": 1,
            "desconto": 0.00,
            "status": "REALIZADO",
            "data_pagamento": str(hoje),
            "itens": [
                {"produto_id": 1, "quantidade": 1}
            ],
            "pagamentos": [
                {
                    "tipo_pagamento": "dinheiro",
                    "valor": 1000.00
                }
            ]
        }

        key = "idemp-key-test-123"

        # 1. Primeira chamada: Deve criar a venda com status 201 Created
        res1 = client.post("/api/v1/pdv/vendas", json=payload, headers={"X-Idempotency-Key": key})
        assert res1.status_code == 201
        data1 = res1.json()
        assert data1["venda_id_uuid"] is not None
        
        # Verificar se o log foi criado como completed
        log = session.exec(select(IdempotencyLog).where(IdempotencyLog.idempotency_key == key)).first()
        assert log is not None
        assert log.status == "completed"
        assert log.response_body is not None
        assert log.response_body["rv"] == data1["rv"]

        # 2. Segunda chamada com a mesma chave: Deve retornar 200 OK com exatamente a mesma resposta
        res2 = client.post("/api/v1/pdv/vendas", json=payload, headers={"X-Idempotency-Key": key})
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2 == data1

        # 3. Teste de concorrência/processing status
        # Simulamos que existe um log em andamento ("processing") no BD
        processing_key = "idemp-key-processing"
        proc_log = IdempotencyLog(
            idempotency_key=processing_key,
            status="processing"
        )
        session.add(proc_log)
        session.commit()

        # Envia uma chamada com a chave que está "processing" -> Deve retornar 409 Conflict
        res_proc = client.post("/api/v1/pdv/vendas", json=payload, headers={"X-Idempotency-Key": processing_key})
        assert res_proc.status_code == 409
        assert "Aguarde o processamento" in res_proc.json()["detail"]

        # 4. Teste de falha anterior (failed status)
        # Simulamos que uma tentativa falhou anteriormente ("failed")
        failed_key = "idemp-key-failed"
        failed_log = IdempotencyLog(
            idempotency_key=failed_key,
            status="failed"
        )
        session.add(failed_log)
        session.commit()

        # Chamada com chave falhada anteriormente -> Deve processar normalmente (retornar 201 Created)
        res_fail = client.post("/api/v1/pdv/vendas", json=payload, headers={"X-Idempotency-Key": failed_key})
        assert res_fail.status_code == 201
        data_fail = res_fail.json()
        
        # O log deve ter sido atualizado para completed
        session.refresh(failed_log)
        assert failed_log.status == "completed"
        assert failed_log.response_body["id"] == data_fail["id"]

    finally:
        app.dependency_overrides.clear()
