import pytest
from datetime import date, datetime
from decimal import Decimal
from sqlmodel import Session, select, col
from fastapi.testclient import TestClient

from app.main import app
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.plano_contas import PlanoContas
from app.models.lancamento import Lancamento
from app.models.lote_cartao import LoteCartao
from app.services.lancamento_autoheal import auto_heal_lancamento


@pytest.fixture
def client_and_auth(session: Session):
    empresa = Empresa(
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste Metadados",
        cnpj="12345678000199",
        regime_tributario="SIMPLES_NACIONAL",
        is_active=True,
    )
    session.add(empresa)
    session.flush()

    usuario = Usuario(
        nome="Admin Metadados",
        email="admin_meta@example.com",
        hashed_password="hash",
        empresa_id=empresa.id,
        role="ADMIN",
        ativo=True,
    )
    session.add(usuario)
    session.flush()

    conta = Conta(
        nome="Banco Principal",
        empresa_id=empresa.id,
        saldo_inicial=Decimal("0.00"),
        saldo_atual=Decimal("1000.00"),
        tipo="CORRENTE",
    )
    session.add(conta)

    plano_receita = PlanoContas(
        codigo="1.01",
        nome="Receita de Cartão",
        tipo="RECEITA",
        empresa_id=empresa.id,
    )
    plano_despesa = PlanoContas(
        codigo="2.01",
        nome="Taxa de Cartão",
        tipo="DESPESA",
        empresa_id=empresa.id,
    )
    session.add(plano_receita)
    session.add(plano_despesa)
    session.commit()

    return {
        "empresa": empresa,
        "usuario": usuario,
        "conta": conta,
        "plano_receita": plano_receita,
        "plano_despesa": plano_despesa,
    }


def test_lancamento_single_write_and_auto_heal(session: Session, client_and_auth):
    empresa = client_and_auth["empresa"]
    conta = client_and_auth["conta"]
    plano_receita = client_and_auth["plano_receita"]

    # 1. Criar Lote de Cartão de teste
    lote = LoteCartao(
        empresa_id=empresa.id,
        data_pagamento=date.today(),
        valor_bruto=Decimal("500.00"),
        valor_taxa=Decimal("15.00"),
        valor_liquido=Decimal("485.00"),
        conta_destino_id=conta.id,
        status="CONCILIADO",
        bandeira="MASTERCARD",
        forma_pagamento="Débito",
    )
    session.add(lote)
    session.flush()

    # 2. Inserir um registro Novo com Single-Write ESTRUTURAL (sem JSON na observação)
    lanc_novo = Lancamento(
        descricao=f"Recebimento Cartão Novo #{lote.id}",
        tipo="RECEITA",
        status="PAGO",
        origem="PDV",
        tipo_origem="PDV_CONCILIACAO_FATURAMENTO",
        lote_cartao_id=lote.id,
        valor_previsto=Decimal("500.00"),
        valor_pago=Decimal("500.00"),
        data_vencimento=date.today(),
        data_pagamento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        observacao=None,  # Single-Write: observação limpa
    )
    session.add(lanc_novo)

    # 3. Inserir um registro Legado (com observacao JSON antiga que requer Auto-Healing)
    lote_legado_id = 9999
    lanc_legado = Lancamento(
        descricao=f"Recebimento Cartão Legado #{lote_legado_id}",
        tipo="RECEITA",
        status="PAGO",
        origem="PDV",
        tipo_origem=None,
        lote_cartao_id=None,
        valor_previsto=Decimal("300.00"),
        valor_pago=Decimal("300.00"),
        data_vencimento=date.today(),
        data_pagamento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        observacao=f'{{"lote_cartao_id": {lote_legado_id}, "conciliacao_faturamento": true, "user_notes": "Nota digitada pelo operador"}}',
    )
    session.add(lanc_legado)
    session.commit()

    # 4. Verificar consulta direta pelo campo estrutural no registro novo
    query_novo = session.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa.id,
            Lancamento.lote_cartao_id == lote.id,
        )
    ).all()
    assert len(query_novo) == 1
    assert query_novo[0].id == lanc_novo.id
    assert query_novo[0].tipo_origem == "PDV_CONCILIACAO_FATURAMENTO"
    assert query_novo[0].observacao is None

    # 5. Executar Auto-Healing no registro legado
    healed = auto_heal_lancamento(lanc_legado, session)
    assert healed is True
    session.commit()
    session.refresh(lanc_legado)

    # Assegurar que os campos estruturais foram populados e o JSON removido
    assert lanc_legado.lote_cartao_id == lote_legado_id
    assert lanc_legado.tipo_origem == "PDV_CONCILIACAO_FATURAMENTO"
    assert lanc_legado.observacao == "Nota digitada pelo operador"

    # Uma segunda passagem de Auto-Healing não deve fazer nada
    assert auto_heal_lancamento(lanc_legado, session) is False


def test_auto_heal_sangria_and_ifood(session: Session, client_and_auth):
    empresa = client_and_auth["empresa"]
    conta = client_and_auth["conta"]
    plano_receita = client_and_auth["plano_receita"]

    # Sangria Legada com JSON
    lanc_sangria = Lancamento(
        descricao="Sangria de Caixa",
        tipo="DESPESA",
        status="PAGO",
        origem="PDV",
        valor_previsto=Decimal("100.00"),
        data_vencimento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        observacao='{"is_sangria": true, "sangria_uuid": "sangria-abc-123"}',
    )
    session.add(lanc_sangria)

    # iFood Legado com JSON
    lanc_ifood = Lancamento(
        descricao="Vendas iFood",
        tipo="RECEITA",
        status="EM ABERTO",
        origem="PDV",
        valor_previsto=Decimal("250.00"),
        data_vencimento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        observacao='{"ifood_consolidado": true}',
    )
    session.add(lanc_ifood)
    session.commit()

    # Executar Auto-Healing
    assert auto_heal_lancamento(lanc_sangria, session) is True
    assert auto_heal_lancamento(lanc_ifood, session) is True
    session.commit()

    session.refresh(lanc_sangria)
    session.refresh(lanc_ifood)

    assert lanc_sangria.tipo_origem == "PDV_SANGRIA_SAIDA"
    assert lanc_sangria.origem_uuid == "sangria-abc-123"
    assert lanc_sangria.observacao is None

    assert lanc_ifood.tipo_origem == "PDV_IFOOD_REPASSE"
    assert lanc_ifood.observacao is None


def test_codigo_barras_structural_and_auto_heal(session: Session, client_and_auth):
    empresa = client_and_auth["empresa"]
    conta = client_and_auth["conta"]
    plano_receita = client_and_auth["plano_receita"]

    barcode_example = "34191790010104351004791020150008891230026000"

    # Lançamento criado diretamente com a coluna estrutural codigo_barras
    lanc_boleto = Lancamento(
        descricao="Pagamento Boleto Fornecedor",
        tipo="DESPESA",
        status="EM ABERTO",
        origem="WEB",
        valor_previsto=Decimal("260.00"),
        data_vencimento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        codigo_barras=barcode_example,
        observacao="Nota fiscal 1234",
    )
    session.add(lanc_boleto)

    # Lançamento legado com codigo_barras dentro de JSON em observacao
    lanc_legado_boleto = Lancamento(
        descricao="Boleto Antigo",
        tipo="DESPESA",
        status="EM ABERTO",
        origem="WEB",
        valor_previsto=Decimal("150.00"),
        data_vencimento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        conta_id=conta.id,
        codigo_barras=None,
        observacao=f'{{"codigo_barras": "{barcode_example}", "user_notes": "Boleto referente a energia"}}',
    )
    session.add(lanc_legado_boleto)
    session.commit()

    # Validação do campo estrutural
    assert lanc_boleto.codigo_barras == barcode_example
    assert lanc_boleto.observacao == "Nota fiscal 1234"

    # Auto-heal no registro legado
    assert auto_heal_lancamento(lanc_legado_boleto, session) is True
    session.commit()
    session.refresh(lanc_legado_boleto)

    assert lanc_legado_boleto.codigo_barras == barcode_example
    assert lanc_legado_boleto.observacao == "Boleto referente a energia"

