import pytest
from datetime import date, datetime
from decimal import Decimal
from sqlmodel import Session, select
from fastapi.testclient import TestClient


from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.entidade import Entidade
from app.models.lancamento import Lancamento
from app.models.movimento import Movimento
from app.models.alerta_anomalia import AlertaAnomalia
from app.services.auditor_anomalia_service import AuditorAnomaliaService
from app.services.lancamento_service import LancamentoService
from app.schemas.lancamento import LancamentoCreate

@pytest.fixture(name="setup_auditor_db")
def setup_auditor_db_fixture(session: Session):
    empresa = Empresa(
        id=1,
        razao_social="Empresa Auditada LTDA",
        nome_fantasia="Empresa Auditada",
        cnpj="11222333000100",
        pdv_config="{}"
    )
    session.add(empresa)
    session.flush()

    usuario = Usuario(
        id=1,
        nome="Auditor Principal",
        email="auditor@teste.com",
        hashed_password="fakehashpassword",
        is_active=True,
        empresa_id=1
    )
    session.add(usuario)
    session.flush()

    centro = CentroCusto(
        id=1,
        nome="Sede",
        descricao="Sede",
        empresa_id=1
    )
    session.add(centro)
    session.flush()

    conta = Conta(
        id=1,
        nome="Banco Principal",
        tipo="BANCO",
        saldo_inicial=Decimal("10000.00"),
        status="ATIVO",
        empresa_id=1,
        conta_como_disponibilidade=True,
        centro_custo_id=1
    )
    session.add(conta)
    session.flush()

    plano = PlanoContas(
        id=10,
        codigo="1.1.01",
        nome="Aluguel PJ",
        tipo="D",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano)
    session.flush()

    entidade = Entidade(
        id=1,
        nome="Cliente Teste",
        tipo="AMBOS",
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
        "centro": centro,
        "entidade": entidade
    }

def test_auditor_alerta_pagamento_duplo(session: Session, setup_auditor_db):
    service = LancamentoService(session)


    
    # 1. Criar o primeiro lançamento de aluguel
    lanc1 = LancamentoCreate(
        descricao="Aluguel Julho",
        valor_previsto=Decimal("2000.00"),

        data_vencimento=date(2026, 7, 10),
        tipo="DESPESA",
        plano_contas_id=10,
        conta_id=1,
        centro_custo_id=1,
        entidade_id=1
    )
    db_l1 = service.create(lanc1, empresa_id=1, user_id=1)
    
    # 2. Criar um segundo lançamento idêntico no mesmo dia -> Deve alertar PAGAMENTO_DUPLO
    lanc2 = LancamentoCreate(
        descricao="Aluguel Julho Duplicado",
        valor_previsto=Decimal("2000.00"),
        data_vencimento=date(2026, 7, 10),
        tipo="DESPESA",
        plano_contas_id=10,
        conta_id=1,
        centro_custo_id=1,
        entidade_id=1
    )
    db_l2 = service.create(lanc2, empresa_id=1, user_id=1)
    
    # Verificar que o alerta foi criado para o db_l2
    alerta = session.exec(
        select(AlertaAnomalia).where(
            AlertaAnomalia.tipo_objeto == "lancamento",
            AlertaAnomalia.objeto_id == db_l2.id,
            AlertaAnomalia.tipo_anomalia == "PAGAMENTO_DUPLO"
        )
    ).first()
    
    assert alerta is not None
    assert alerta.gravidade == "ALTA"
    assert alerta.status == "PENDENTE"



def test_auditor_alerta_valor_atipico(session: Session, setup_auditor_db):
    service = LancamentoService(session)
    
    # 1. Popular histórico com 5 lançamentos de valor R$ 100,00
    for i in range(5):
        lanc = LancamentoCreate(
            descricao=f"Despesa Historica {i}",
            valor_previsto=Decimal("100.00"),
            data_vencimento=date(2026, 7, 1 + i),
            tipo="DESPESA",
            plano_contas_id=10,
            conta_id=1,
            centro_custo_id=1,
            entidade_id=1
        )
        service.create(lanc, empresa_id=1, user_id=1)
        
    # 2. Criar despesa de valor R$ 1000.00 (desvio padrão é 0, média é 100, limite é 100.0) -> Deve alertar VALOR_ATIPICO
    lanc_atipico = LancamentoCreate(
        descricao="Super Despesa Atípica",
        valor_previsto=Decimal("1000.00"),
        data_vencimento=date(2026, 7, 15),
        tipo="DESPESA",
        plano_contas_id=10,
        conta_id=1,
        centro_custo_id=1,
        entidade_id=1
    )
    db_atipico = service.create(lanc_atipico, empresa_id=1, user_id=1)
    
    alerta = session.exec(
        select(AlertaAnomalia).where(
            AlertaAnomalia.tipo_objeto == "lancamento",
            AlertaAnomalia.objeto_id == db_atipico.id,
            AlertaAnomalia.tipo_anomalia == "VALOR_ATIPICO"
        )
    ).first()
    
    assert alerta is not None
    assert alerta.gravidade == "MEDIA"
    assert alerta.dados_extras["media"] == 100.0

def test_auditor_alerta_exclusao_suspeita(session: Session, setup_auditor_db):
    service = LancamentoService(session)
    
    # 1. Criar um lançamento de alto valor (R$ 15.000,00)
    lanc = LancamentoCreate(
        descricao="Compra de Servidores",
        valor_previsto=Decimal("15000.00"),
        data_vencimento=date(2026, 7, 10),
        tipo="DESPESA",
        plano_contas_id=10,
        conta_id=1,
        centro_custo_id=1,
        entidade_id=1
    )
    db_l = service.create(lanc, empresa_id=1, user_id=1)
    
    # 2. Deletar esse lançamento -> Deve gerar alerta de exclusão suspeita
    service.delete(db_l.id, empresa_id=1, user_id=1)
    
    alerta = session.exec(
        select(AlertaAnomalia).where(
            AlertaAnomalia.tipo_objeto == "lancamento",
            AlertaAnomalia.objeto_id == db_l.id,
            AlertaAnomalia.tipo_anomalia == "EXCLUSAO_SUSPEITA"
        )
    ).first()
    
    assert alerta is not None
    assert alerta.gravidade == "CRITICA"
    assert "alto valor" in alerta.descricao

def test_auditor_alerta_duplicidade_ofx(session: Session, setup_auditor_db):
    auditor = AuditorAnomaliaService(session)
    
    # 1. Criar um movimento no banco
    mov1 = Movimento(
        descricao="PIX RECEBIDO CLIENTE A",
        valor=Decimal("500.00"),
        tipo="RECEITA",
        data=date(2026, 7, 10),
        status="ABERTO",
        origem="OFX",
        import_hash="hash_pix_duplicado_teste_1",
        empresa_id=1,
        conta_id=1
    )
    session.add(mov1)
    session.commit()
    
    # 2. Criar outro movimento com mesmo hash -> Deve alertar DUPLICIDADE_OFX
    mov2 = Movimento(
        descricao="PIX RECEBIDO CLIENTE A",
        valor=Decimal("500.00"),
        tipo="RECEITA",
        data=date(2026, 7, 10),
        status="ABERTO",
        origem="OFX",
        import_hash="hash_pix_duplicado_teste_2",
        empresa_id=1,
        conta_id=1
    )
    session.add(mov2)
    session.commit()
    
    auditor.analisar_movimento(mov2)
    
    alerta = session.exec(
        select(AlertaAnomalia).where(
            AlertaAnomalia.tipo_objeto == "movimento",
            AlertaAnomalia.objeto_id == mov2.id,
            AlertaAnomalia.tipo_anomalia == "DUPLICIDADE_OFX"
        )
    ).first()
    
    assert alerta is not None
    assert alerta.gravidade == "ALTA"


def test_api_alertas_anomalia(client: TestClient, session: Session, setup_auditor_db):
    from app.main import app
    from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
    
    def mock_get_current_user():
        return setup_auditor_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    app.dependency_overrides.update(app_dependency_overrides)

    try:
        # 1. Criar um alerta manual no banco de dados para testar a listagem
        alerta = AlertaAnomalia(
            tipo_objeto="lancamento",
            objeto_id=1,
            tipo_anomalia="PAGAMENTO_DUPLO",
            gravidade="ALTA",
            descricao="Aluguel duplicado detectado",
            status="PENDENTE",
            empresa_id=1
        )
        session.add(alerta)
        session.commit()

        # 2. Testar listagem via GET /api/v1/auditoria/alertas
        response = client.get("/api/v1/auditoria/alertas")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1
        assert data["items"][0]["tipo_anomalia"] == "PAGAMENTO_DUPLO"

        alerta_id = data["items"][0]["id"]

        # 3. Testar resolver via POST /api/v1/auditoria/alertas/{id}/resolver
        response_resolv = client.post(
            f"/api/v1/auditoria/alertas/{alerta_id}/resolver",
            json={"observacoes": "Revisado pelo financeiro. Ok."}
        )
        assert response_resolv.status_code == 200
        assert response_resolv.json()["message"] == "Alerta resolvido com sucesso"

        # Verificar no banco
        session.refresh(alerta)
        assert alerta.status == "RESOLVIDO"
        assert alerta.motivo_resolucao == "Revisado pelo financeiro. Ok."


        # 4. Testar ignorar via POST /api/v1/auditoria/alertas/{id}/ignorar
        # Primeiro, muda de volta para PENDENTE no banco
        alerta.status = "PENDENTE"
        session.add(alerta)
        session.commit()

        response_ignore = client.post(f"/api/v1/auditoria/alertas/{alerta_id}/ignorar")
        assert response_ignore.status_code == 200
        assert response_ignore.json()["message"] == "Alerta ignorado com sucesso"

        session.refresh(alerta)
        assert alerta.status == "IGNORADO"

    finally:
        app.dependency_overrides.clear()


def test_auditoria_lote_e_automatico(client: TestClient, session: Session, setup_auditor_db):
    from app.main import app
    from app.api.deps import get_current_user
    from app.models.empresa import Empresa
    from app.models.usuario import Usuario
    from app.models.audit_log import AuditLog
    from app.models.lancamento import Lancamento
    from app.models.movimento import Movimento
    
    empresa = session.exec(select(Empresa)).first()
    usuario = session.exec(select(Usuario).where(Usuario.empresa_id == empresa.id)).first()
    
    # 1. Criar um log automático
    log_auto = AuditLog(
        table_name="lancamentos",
        record_id=999,
        action="UPDATE",
        empresa_id=empresa.id,
        user_id=usuario.id,
        is_automatic=True
    )
    # 2. Criar um lote de logs manuais com batch_id
    batch_id = "OFX:teste.ofx:10_07_2026 11_41:abcd"
    log_manual_1 = AuditLog(
        table_name="lancamentos",
        record_id=1001,
        action="CREATE",
        empresa_id=empresa.id,
        user_id=usuario.id,
        batch_id=batch_id,
        is_automatic=False
    )
    log_manual_2 = AuditLog(
        table_name="movimentos",
        record_id=2002,
        action="CREATE",
        empresa_id=empresa.id,
        user_id=usuario.id,
        batch_id=batch_id,
        is_automatic=False
    )
    
    session.add(log_auto)
    session.add(log_manual_1)
    session.add(log_manual_2)
    session.commit()
    
    app.dependency_overrides[get_current_user] = lambda: usuario
    try:
        # 1. Testar GET /api/v1/auditoria/ sem incluir_automaticos (padrão)
        resp = client.get("/api/v1/auditoria/")
        assert resp.status_code == 200
        data = resp.json()
        items = data["items"]
        assert len(items) >= 2
        for item in items:
            assert item["id"] != log_auto.id
            
        # 2. Testar GET /api/v1/auditoria/ com incluir_automaticos=true
        resp_all = client.get("/api/v1/auditoria/?incluir_automaticos=true")
        assert resp_all.status_code == 200
        data_all = resp_all.json()
        assert any(item["id"] == log_auto.id for item in data_all["items"])
        
        # 3. Testar GET /api/v1/auditoria/batches
        resp_batches = client.get("/api/v1/auditoria/batches")
        assert resp_batches.status_code == 200
        batches = resp_batches.json()["items"]
        assert len(batches) >= 1
        test_batch = next((b for b in batches if b["batch_id"] == batch_id), None)
        assert test_batch is not None
        assert test_batch["total_itens"] == 2
        assert test_batch["undone"] is False
        
        # 4. Testar POST /api/v1/auditoria/batch/{batch_id}/undo
        lanc = Lancamento(
            id=1001,
            descricao="Teste",
            valor_previsto=100,
            empresa_id=empresa.id,
            tipo="RECEITA",
            data_vencimento=date.today(),
            data_competencia=date.today(),
            competencia="07/2026",
            plano_contas_id=10,
            conta_id=1,
            entidade_id=1,
            centro_custo_id=1
        )
        mov = Movimento(
            id=2002,
            descricao="Teste Mov",
            valor=100,
            empresa_id=empresa.id,
            tipo="RECEITA",
            data=date.today(),
            conta_id=1,
            import_hash="hash_teste_2002"
        )
        session.add(lanc)
        session.add(mov)
        session.commit()
        
        resp_undo = client.post(f"/api/v1/auditoria/batch/{batch_id}/undo")
        assert resp_undo.status_code == 200
        assert resp_undo.json()["sucesso"] is True
        
        session.refresh(lanc)
        assert lanc.is_deleted is True
        
        mov_deleted = session.get(Movimento, 2002)
        assert mov_deleted.is_deleted is True
        
        session.refresh(log_manual_1)
        session.refresh(log_manual_2)
        assert log_manual_1.undone is True
        assert log_manual_2.undone is True
        
    finally:
        app.dependency_overrides.clear()


def test_auditoria_extendida_e_integridade(client: TestClient, session: Session, setup_auditor_db):
    from app.main import app
    from app.api.deps import get_current_user
    from app.models.empresa import Empresa
    from app.models.usuario import Usuario
    from app.models.audit_log import AuditLog
    from app.models.regra_silenciamento_auditor import RegraSilenciamentoAuditor
    
    empresa = session.exec(select(Empresa)).first()
    usuario = session.exec(select(Usuario).where(Usuario.empresa_id == empresa.id)).first()
    
    app.dependency_overrides[get_current_user] = lambda: usuario
    try:
        # 1. Testar verificar-integridade
        resp = client.get("/api/v1/auditoria/verificar-integridade")
        assert resp.status_code == 200
        data = resp.json()
        assert "integro" in data
        
        # 2. Criar uma regra de silenciamento via API
        resp_rule = client.post(
            "/api/v1/auditoria/silenciamento",
            json={
                "tipo_anomalia": "VALOR_ATIPICO",
                "plano_contas_id": 10,
                "entidade_id": 1,
                "valor_limite": 5000.00
            }
        )
        assert resp_rule.status_code == 200
        rule_data = resp_rule.json()
        assert rule_data["tipo_anomalia"] == "VALOR_ATIPICO"
        assert rule_data["plano_contas_id"] == 10
        assert rule_data["entidade_id"] == 1
        
        # Listar as regras
        resp_list = client.get("/api/v1/auditoria/silenciamento")
        assert resp_list.status_code == 200
        rules = resp_list.json()
        assert len(rules) >= 1
        
        # 3. Deletar a regra
        rule_id = rule_data["id"]
        resp_del = client.delete(f"/api/v1/auditoria/silenciamento/{rule_id}")
        assert resp_del.json()["mensagem"] == "Regra deletada com sucesso"
        
    finally:
        app.dependency_overrides.clear()



