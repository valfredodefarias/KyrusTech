import pytest
from datetime import date
from decimal import Decimal
from sqlmodel import Session

from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa
from app.services.conta_service import calcular_saldos_contas
from app.services.boletim_service import get_boletim_resumo
from app.core.cache import get_transaction_cache, set_transaction_cache, clear_transaction_cache


def test_calcular_saldos_contas_consistencia(session: Session):
    """
    Valida se calcular_saldos_contas calcula:
    saldo_atual = saldo_inicial + receitas_pagas - despesas_pagas
    """
    # 1. Cria empresa e plano de contas
    empresa = Empresa(
        razao_social="Empresa Teste Saldos LTDA",
        nome_fantasia="Empresa Teste Saldos",
        cnpj="11222333000199",
    )
    session.add(empresa)
    session.flush()

    plano = PlanoContas(
        codigo="1.01",
        nome="Receitas Operacionais",
        tipo="RECEITA",
        empresa_id=empresa.id,
    )
    session.add(plano)
    session.flush()

    # 2. Cria conta bancária com saldo inicial de 1000.00
    conta = Conta(
        nome="Banco Teste",
        banco="Itaú",
        tipo="CORRENTE",
        saldo_inicial=Decimal("1000.00"),
        status="ATIVO",
        conta_como_disponibilidade=True,
        empresa_id=empresa.id,
    )
    session.add(conta)
    session.flush()

    # 3. Cria receita paga de 500.00
    rec = Lancamento(
        descricao="Receita Venda",
        tipo="RECEITA",
        status="PAGO",
        data_vencimento=date.today(),
        data_pagamento=date.today(),
        data_competencia=date.today(),
        valor_previsto=Decimal("500.00"),
        valor_pago=Decimal("500.00"),
        conta_id=conta.id,
        empresa_id=empresa.id,
        plano_contas_id=plano.id,
    )
    # 4. Cria despesa paga de 200.00
    desp = Lancamento(
        descricao="Despesa Luz",
        tipo="DESPESA",
        status="PAGO",
        data_vencimento=date.today(),
        data_pagamento=date.today(),
        data_competencia=date.today(),
        valor_previsto=Decimal("200.00"),
        valor_pago=Decimal("200.00"),
        conta_id=conta.id,
        empresa_id=empresa.id,
        plano_contas_id=plano.id,
    )
    # 5. Cria despesa em aberto (NÃO deve afetar saldo bancário)
    desp_aberto = Lancamento(
        descricao="Despesa Futura",
        tipo="DESPESA",
        status="EM ABERTO",
        data_vencimento=date.today(),
        data_pagamento=None,
        data_competencia=date.today(),
        valor_previsto=Decimal("300.00"),
        valor_pago=Decimal("0.00"),
        conta_id=conta.id,
        empresa_id=empresa.id,
        plano_contas_id=plano.id,
    )
    session.add(rec)
    session.add(desp)
    session.add(desp_aberto)
    session.commit()

    # Executa cálculo oficial
    saldos = calcular_saldos_contas(db=session, empresa_id=empresa.id)
    assert conta.id in saldos

    info = saldos[conta.id]
    assert info["saldo_inicial"] == Decimal("1000.00")
    assert info["total_receitas"] == Decimal("500.00")
    assert info["total_despesas"] == Decimal("200.00")
    # 1000 + 500 - 200 = 1300
    assert info["saldo_atual"] == Decimal("1300.00")


def test_boletim_resumo_filtro_contas_ativas_e_centro_custo(session: Session):
    """
    Garante que get_boletim_resumo retorna apenas contas ativas
    e filtra corretamente pelo centro de custo selecionado.
    """
    empresa = Empresa(
        razao_social="Empresa Teste Boletim LTDA",
        nome_fantasia="Empresa Teste Boletim",
        cnpj="99888777000166",
    )
    session.add(empresa)
    session.flush()

    plano = PlanoContas(
        codigo="1.02",
        nome="Receitas Operacionais",
        tipo="RECEITA",
        empresa_id=empresa.id,
    )
    session.add(plano)
    session.flush()

    # Conta ativa vinculada ao Centro de Custo 99
    conta_cc99 = Conta(
        nome="Santander CC 99",
        banco="Santander",
        tipo="CORRENTE",
        saldo_inicial=Decimal("2500.00"),
        status="ATIVO",
        conta_como_disponibilidade=True,
        centro_custo_id=99,
        empresa_id=empresa.id,
    )
    # Conta ativa vinculada ao Centro de Custo 88
    conta_cc88 = Conta(
        nome="Bradesco CC 88",
        banco="Bradesco",
        tipo="CORRENTE",
        saldo_inicial=Decimal("1500.00"),
        status="ATIVO",
        conta_como_disponibilidade=True,
        centro_custo_id=88,
        empresa_id=empresa.id,
    )
    # Conta inativa
    conta_inativa = Conta(
        nome="Banco Inativo",
        banco="Caixa",
        tipo="CORRENTE",
        saldo_inicial=Decimal("500.00"),
        status="INATIVO",
        conta_como_disponibilidade=True,
        centro_custo_id=99,
        empresa_id=empresa.id,
    )
    session.add(conta_cc99)
    session.add(conta_cc88)
    session.add(conta_inativa)
    session.commit()

    # 1. Sem filtro de centro de custo -> apenas ativas (cc99 e cc88), sem inativa
    resumo_todos = get_boletim_resumo(
        db=session,
        empresa_id=empresa.id,
        ano=date.today().year,
        mes=date.today().month,
        centro_custo_id=None,
    )
    nomes_todos = [b["nome"] for b in resumo_todos["bancos"]]
    assert "Santander CC 99" in nomes_todos
    assert "Bradesco CC 88" in nomes_todos
    assert "Banco Inativo" not in nomes_todos
    assert len(resumo_todos["bancos"]) == 2

    # 2. Com filtro de centro de custo 99 -> apenas conta_cc99
    resumo_cc99 = get_boletim_resumo(
        db=session,
        empresa_id=empresa.id,
        ano=date.today().year,
        mes=date.today().month,
        centro_custo_id=99,
    )
    nomes_cc99 = [b["nome"] for b in resumo_cc99["bancos"]]
    assert nomes_cc99 == ["Santander CC 99"]
    assert resumo_cc99["saldo_disponivel"] == 2500.00


def test_cache_invalidation():
    """
    Valida que set_transaction_cache salva e clear_transaction_cache invalida.
    """
    empresa_id = 9999
    key = "test_key_123"
    payload = '{"items": [1, 2, 3]}'

    set_transaction_cache(empresa_id, key, payload)
    cached = get_transaction_cache(empresa_id, key)
    assert cached == payload

    clear_transaction_cache(empresa_id)
    assert get_transaction_cache(empresa_id, key) is None
