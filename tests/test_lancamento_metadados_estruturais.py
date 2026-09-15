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


@pytest.fixture
def client_and_auth(session: Session):
    # Criar empresa
    empresa = Empresa(
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste Metadados",
        cnpj="12345678000199",
        regime_tributario="SIMPLES_NACIONAL",
        is_active=True,
    )
    session.add(empresa)
    session.flush()

    # Criar usuário admin
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

    # Conta Bancária
    conta = Conta(
        nome="Banco Principal",
        empresa_id=empresa.id,
        saldo_inicial=Decimal("0.00"),
        saldo_atual=Decimal("1000.00"),
        tipo="CORRENTE",
    )
    session.add(conta)

    # Plano de Contas
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


def test_lancamento_dual_read_and_structural_columns(session: Session, client_and_auth):
    empresa = client_and_auth["empresa"]
    conta = client_and_auth["conta"]
    plano_receita = client_and_auth["plano_receita"]
    plano_despesa = client_and_auth["plano_despesa"]

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

    # 2. Inserir um registro "Novo" (com lote_cartao_id e tipo_origem estruturados)
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
        observacao=f'{{"lote_cartao_id": {lote.id}, "conciliacao_faturamento": true}}',
    )
    session.add(lanc_novo)

    # 3. Inserir um registro "Legado" (somente com observacao JSON, sem lote_cartao_id na coluna)
    # Simulando um registro antigo que ainda não passou pela migration
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
        observacao=f'{{"lote_cartao_id": {lote_legado_id}, "conciliacao_faturamento": true}}',
    )
    session.add(lanc_legado)
    session.commit()

    # 4. Testar Dual-Read para o lote NOVO (deve encontrar por lote_cartao_id indexado)
    query_novo = session.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa.id,
            (Lancamento.lote_cartao_id == lote.id)
            | col(Lancamento.observacao).like(f'%"lote_cartao_id": {lote.id}%')
        )
    ).all()
    assert len(query_novo) == 1
    assert query_novo[0].id == lanc_novo.id
    assert query_novo[0].tipo_origem == "PDV_CONCILIACAO_FATURAMENTO"
    assert query_novo[0].lote_cartao_id == lote.id

    # 5. Testar Dual-Read para o lote LEGADO (deve encontrar pelo fallback de observacao)
    query_legado = session.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa.id,
            (Lancamento.lote_cartao_id == lote_legado_id)
            | col(Lancamento.observacao).like(f'%"lote_cartao_id": {lote_legado_id}%')
        )
    ).all()
    assert len(query_legado) == 1
    assert query_legado[0].id == lanc_legado.id
    assert query_legado[0].lote_cartao_id is None

    # 6. Testar agrupamento com tipo_origem
    lanc_agrupado = Lancamento(
        descricao="Recebimento Cartões Mastercard Débito",
        tipo="RECEITA",
        status="EM ABERTO",
        origem="PDV",
        tipo_origem="PDV_CARTAO_AGRUPADO",
        valor_previsto=Decimal("150.00"),
        data_vencimento=date.today(),
        data_competencia=date.today(),
        empresa_id=empresa.id,
        plano_contas_id=plano_receita.id,
        observacao='{"grouped_card_launch": true, "bandeira": "Mastercard"}',
    )
    session.add(lanc_agrupado)
    session.commit()

    query_agrupado = session.exec(
        select(Lancamento).where(
            Lancamento.empresa_id == empresa.id,
            (Lancamento.tipo_origem == "PDV_CARTAO_AGRUPADO")
            | col(Lancamento.observacao).like('%"grouped_card_launch": true%')
        )
    ).all()
    assert any(l.id == lanc_agrupado.id for l in query_agrupado)
