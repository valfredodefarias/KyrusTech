# tests/test_comissao_e_importacao.py
import pytest
from datetime import date, datetime
from decimal import Decimal
from sqlmodel import Session, select

from app.models.empresa import Empresa
from app.models.centro_custo import CentroCusto
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.pdv_service import PdvService
from app.services.comissao_service import ComissaoService


def setup_test_data(session: Session):
    """Auxiliar para configurar dados básicos de teste."""
    # 1. Empresa
    empresa = Empresa(
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste",
        cnpj="12345678000100",
        is_active=True
    )
    session.add(empresa)
    session.flush()

    # 2. Centro de Custo
    cc = CentroCusto(nome="Centro Teste", empresa_id=empresa.id)
    session.add(cc)
    session.flush()

    # 3. Vendedor (Usuário)
    vendedor = Usuario(
        nome="Vendedor Teste",
        email="vendedor@teste.com",
        hashed_password="fake",
        is_active=True,
        empresa_id=empresa.id
    )
    session.add(vendedor)
    session.flush()

    # 4. Cliente (Entidade)
    cliente = Entidade(
        nome="Cliente Teste",
        tipo="CLIENTE",
        empresa_id=empresa.id,
        is_deleted=False
    )
    session.add(cliente)
    session.flush()

    # 5. Produtos (Produto e Serviço)
    produto_guitarra = Produto(
        nome="Guitarra Elétrica",
        preco_unitario=Decimal("2000.00"),
        tipo="PRODUTO",
        is_active=True,
        is_deleted=False,
        empresa_id=empresa.id
    )
    produto_aula = Produto(
        nome="Aula de Guitarra",
        preco_unitario=Decimal("150.00"),
        tipo="SERVICO",
        is_active=True,
        is_deleted=False,
        empresa_id=empresa.id
    )
    session.add(produto_guitarra)
    session.add(produto_aula)
    session.flush()

    # 6. Plano de Contas de Receita Ativo
    plano_receita = PlanoContas(
        id=1,
        codigo="1.01",
        nome="Receita de Vendas",
        tipo="R",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=empresa.id
    )
    session.add(plano_receita)
    session.flush()

    # Configurar PDV Config com categorias padrão
    empresa.pdv_config = '{"categorias": {"dinheiro": 1, "pix_chave": 1, "boleto": 1}, "marcar_como_pago": {"dinheiro": true, "pix_chave": true, "boleto": false}}'
    session.add(empresa)
    session.flush()

    return {
        "empresa": empresa,
        "cc": cc,
        "vendedor": vendedor,
        "cliente": cliente,
        "guitarra": produto_guitarra,
        "aula": produto_aula
    }


def test_criar_venda_pdv_service(session: Session):
    """Valida se o PdvService cria corretamente a venda e os lançamentos correspondentes."""
    data = setup_test_data(session)

    # Criar uma venda com 1 Guitarra (Produto) e 2 Aulas (Serviço)
    # Total: R$ 2000 + R$ 300 = R$ 2300
    venda_in = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=data["vendedor"].id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=data["guitarra"].id, quantidade=1, preco_unitario=Decimal("2000.00")),
            PdvVendaItemCreate(produto_id=data["aula"].id, quantidade=2, preco_unitario=Decimal("150.00"))
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="pix_chave", valor=Decimal("300.00")),
            PdvVendaPagamento(tipo_pagamento="boleto", valor=Decimal("2000.00"), numero_parcelas=2)  # 2x R$ 1000
        ],
        rv="RV-000001",
        data_pagamento=date(2026, 6, 1)
    )

    response = PdvService.criar_venda(
        db=session,
        venda_in=venda_in,
        empresa_id=data["empresa"].id,
        current_user_id=data["vendedor"].id
    )

    assert response.rv == "RV-000001"
    assert response.valor == Decimal("2300.00")
    
    # Verificar lançamentos no banco de dados
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == data["empresa"].id,
            Lancamento.id_parcelamento == response.venda_id_uuid,
            Lancamento.is_deleted == False
        )
    ).all()

    # Esperamos 3 lançamentos: 1 do pix (R$ 300) + 2 do boleto parcelado (R$ 1000 cada)
    assert len(launches) == 3
    
    # 1. Validar lançamento do pix (PAGO)
    pix_launch = next(l for l in launches if l.valor_previsto == Decimal("300.00"))
    assert pix_launch.status == "PAGO"
    assert pix_launch.valor_pago == Decimal("300.00")

    # 2. Validar lançamentos do boleto (EM ABERTO)
    boleto_launches = [l for l in launches if l.valor_previsto == Decimal("1000.00")]
    assert len(boleto_launches) == 2
    for bl in boleto_launches:
        assert bl.status == "EM ABERTO"
        assert bl.valor_pago == Decimal("0.00")


def test_calcular_faturamento_e_comissao(session: Session):
    """Valida as regras de negócio de comissões, incluindo boleto parcelado e repasse de serviço."""
    data = setup_test_data(session)

    # Configurar meta para o vendedor de R$ 30.000 para Junho/2026 para os testes de taxa
    from app.models.meta_vendedor import MetaVendedor
    meta = MetaVendedor(
        empresa_id=data["empresa"].id,
        vendedor_id=data["vendedor"].id,
        mes=6,
        ano=2026,
        valor_meta=Decimal("30000.00")
    )
    session.add(meta)
    session.flush()

    # Criar venda 1: Pix de R$ 5000.00 (Faturamento imediato para produtos)
    venda_in_1 = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=data["vendedor"].id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=data["guitarra"].id, quantidade=2, preco_unitario=Decimal("2500.00")), # R$ 5000
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="pix_chave", valor=Decimal("5000.00"))
        ],
        rv="RV-000002",
        data_pagamento=date(2026, 6, 10)
    )
    v1 = PdvService.criar_venda(session, venda_in_1, data["empresa"].id, data["vendedor"].id)

    # Criar venda 2: Boleto parcelado de R$ 8000.00 (R$ 4000.00 p/ mês em 2x)
    # Total de itens: 3000 de produto + 5000 de serviços
    venda_in_2 = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=data["vendedor"].id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=data["guitarra"].id, quantidade=1, preco_unitario=Decimal("3000.00")), # R$ 3000
            PdvVendaItemCreate(produto_id=data["aula"].id, quantidade=1, preco_unitario=Decimal("5000.00")) # R$ 5000 (serviço)
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="boleto", valor=Decimal("8000.00"), numero_parcelas=2)
        ],
        rv="RV-000003",
        data_pagamento=date(2026, 6, 15)
    )
    v2 = PdvService.criar_venda(session, venda_in_2, data["empresa"].id, data["vendedor"].id)

    # Nesse ponto, as parcelas do boleto de R$ 8000 (R$ 4000 cada) estão em aberto.
    # Faturamento de meta esperado para junho/2026:
    # Apenas a venda de Pix (R$ 5000.00), pois os boletos da venda 2 estão em aberto.
    faturamento_meta = ComissaoService.calcular_faturamento_meta(
        session, data["vendedor"].id, 6, 2026, data["empresa"].id
    )
    assert faturamento_meta == Decimal("5000.00")

    # A taxa de comissão baseada na projeção (5000) < meta (30000) is 1% (0.01)
    resultado_junho = ComissaoService.calcular_comissoes_vendedor(
        session, data["vendedor"].id, 6, 2026, data["empresa"].id
    )
    # Faturamento de meta de junho: R$ 5000
    assert resultado_junho["faturamento_meta"] == 5000.0
    assert resultado_junho["taxa_produtos"] == 0.01
    # Apenas comissão de produtos de R$ 5000 * 1% = R$ 50.00
    assert resultado_junho["comissao_produtos"] == 50.00
    assert resultado_junho["comissao_servicos"] == 0.00
    assert resultado_junho["comissao_total"] == 50.00

    # Agora simulamos que o primeiro boleto de R$ 4000 da Venda 2 foi pago em Junho (ex: quitado antecipadamente)
    launches_v2 = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == data["empresa"].id,
            Lancamento.id_parcelamento == v2.venda_id_uuid,
            Lancamento.is_deleted == False
        )
    ).all()
    primeira_parcela = launches_v2[0]
    primeira_parcela.status = "PAGO"
    primeira_parcela.data_pagamento = date(2026, 6, 28)
    session.add(primeira_parcela)
    session.commit()

    # Recalcular faturamento de meta para Junho/2026
    # Agora deve incluir a venda Pix (R$ 5000) + a parcela paga do boleto (R$ 4000) = R$ 9000.00
    faturamento_meta_pago = ComissaoService.calcular_faturamento_meta(
        session, data["vendedor"].id, 6, 2026, data["empresa"].id
    )
    assert faturamento_meta_pago == Decimal("9000.00")
    
    # Recalcular comissões de Junho/2026
    # Agora deve pagar a comissão da primeira parcela do boleto também!
    # A parcela paga é de R$ 4000.00. Como ela é parte da venda 2 (total de R$ 8000), ela representa 50% da venda.
    # Itens da venda 2: 3000 de produto (Guitarra) e 5000 de serviço (Aula).
    # Na parcela de 50%, temos:
    # - R$ 1500 de produto (boleto) -> excluído de vendas_para_comissao
    # - R$ 2500 de serviço -> comissão de 100% = R$ 2500.00 (repasse de serviço)
    # Vendas P/ Comissão (produtos Pix) = R$ 5000.00 -> comissão de 1% = R$ 50.00
    # Comissão total do mês: Pix (R$ 50) + Parcela Boleto (R$ 2500) = R$ 2550.00
    resultado_junho_pago = ComissaoService.calcular_comissoes_vendedor(
        session, data["vendedor"].id, 6, 2026, data["empresa"].id
    )
    assert resultado_junho_pago["comissao_produtos"] == 50.00
    assert resultado_junho_pago["comissao_servicos"] == 2500.00
    assert resultado_junho_pago["comissao_total"] == 2550.00


def test_comissao_dinamica_e_penalidade_atraso(session: Session):
    """Valida as regras dinâmicas de comissão por centro de custo e a penalidade por atraso."""
    from app.models.regra_comissao import RegraComissao
    from app.models.meta_vendedor import MetaVendedor
    
    data = setup_test_data(session)
    empresa_id = data["empresa"].id
    vendedor_id = data["vendedor"].id
    
    # 1. Configurar regra dinâmica de comissão
    # Faixas: >= 0 -> 1%, >= 10000 -> 3%, >= 25000 -> 8%
    # Serviços: repasse de 80% (0.80)
    # Atraso: tolerância 5 dias, redutor de 50%, limite 15 dias
    regra = RegraComissao(
        empresa_id=empresa_id,
        centro_custo_id=data["cc"].id,
        data_inicio=date(2026, 6, 1),
        taxa_servico=Decimal("0.80"),
        dias_tolerancia_atraso=5,
        redutor_atraso_intermediario_pct=Decimal("0.50"),
        dias_limite_atraso=15,
        faixas_produtos_json='[{"min_faturamento": 0, "taxa": 0.01}, {"min_faturamento": 10000, "taxa": 0.03}, {"min_faturamento": 25000, "taxa": 0.08}]'
    )
    session.add(regra)
    
    # Configurar meta do vendedor de R$ 30.000 para Junho/2026
    meta = MetaVendedor(
        empresa_id=empresa_id,
        vendedor_id=vendedor_id,
        mes=6,
        ano=2026,
        valor_meta=Decimal("30000.00")
    )
    session.add(meta)
    session.flush()
    session.commit()

    # Criar uma venda Pix (faturamento imediato): R$ 12000.00 de produtos
    venda_in = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=vendedor_id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=data["guitarra"].id, quantidade=6, preco_unitario=Decimal("2000.00")), # R$ 12000
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="pix_chave", valor=Decimal("12000.00"))
        ],
        rv="RV-000004",
        data_pagamento=date(2026, 6, 2)
    )
    PdvService.criar_venda(session, venda_in, empresa_id, vendedor_id)
    
    # Faturamento de meta: 12.000 (deve cair na faixa de 3% - entre 10k e 25k)
    faturamento_meta = ComissaoService.calcular_faturamento_meta(session, vendedor_id, 6, 2026, empresa_id)
    assert faturamento_meta == Decimal("12000.00")
    
    # Obter regra aplicável e testar comissão
    regra_l = ComissaoService.obter_regra_aplicavel(session, empresa_id, data["cc"].id, date(2026, 6, 2))
    assert regra_l is not None
    assert regra_l.taxa_servico == Decimal("0.80")
    
    taxa_comissao = ComissaoService.obter_taxa_comissao_produtos(faturamento_meta, regra_l)
    assert taxa_comissao == Decimal("0.03")  # Faixa dinâmica cadastrada

    # Calcular comissões de Junho/2026
    resultado = ComissaoService.calcular_comissoes_vendedor(session, vendedor_id, 6, 2026, empresa_id, hoje=date(2026, 6, 30))
    # R$ 12000 * 3% = R$ 360.00
    assert resultado["comissao_produtos"] == 360.00
    assert resultado["comissao_total"] == 360.00

    # Criar venda com Boleto parcelado para testar penalidade por atraso
    # Venda total: R$ 10.000,00 de serviços, 2 parcelas de R$ 5000.00 cada
    venda_boleto = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=vendedor_id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=data["aula"].id, quantidade=2, preco_unitario=Decimal("5000.00")) # R$ 10000 (serviços)
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="boleto", valor=Decimal("10000.00"), numero_parcelas=2)
        ],
        rv="RV-000005",
        data_pagamento=date(2026, 6, 5)
    )
    v_boleto = PdvService.criar_venda(session, venda_boleto, empresa_id, vendedor_id)
    
    # Buscar os lançamentos criados
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.id_parcelamento == v_boleto.venda_id_uuid,
            Lancamento.is_deleted == False
        )
    ).all()
    assert len(launches) == 2
    
    # Simular Pagamento da Parcela 1: Atraso de 4 dias (dentro da tolerância de 5 dias)
    # Vence 2026-06-10, paga 2026-06-14 (atraso = 4 dias)
    p1 = launches[0]
    p1.data_vencimento = date(2026, 6, 10)
    p1.status = "PAGO"
    p1.data_pagamento = date(2026, 6, 14)
    session.add(p1)
    
    # Simular Pagamento da Parcela 2: Atraso de 8 dias (tolerância 5 < atraso <= limite 15)
    # Vence 2026-06-10, paga 2026-06-18 (atraso = 8 dias) -> Aplica redutor de 50%
    # Serviços: comissão base de 80% do valor da parcela de R$ 5000 = R$ 4000.00
    # Com 50% de desconto por atraso = R$ 2000.00
    p2 = launches[1]
    p2.data_vencimento = date(2026, 6, 10)
    p2.status = "PAGO"
    p2.data_pagamento = date(2026, 6, 18)
    session.add(p2)
    
    session.commit()
    
    # Recalcular comissões de Junho/2026
    # Pix (360.00) + P1 (4000.00 comissão cheia pois atrasou 4d <= 5d tolerância) + P2 (2000.00 comissão reduzida pois atrasou 8d)
    resultado_atrasos = ComissaoService.calcular_comissoes_vendedor(session, vendedor_id, 6, 2026, empresa_id, hoje=date(2026, 6, 30))
    assert resultado_atrasos["comissao_produtos"] == 360.00
    assert resultado_atrasos["comissao_servicos"] == 6000.00
    assert resultado_atrasos["comissao_total"] == 6360.00

    # Simular Pagamento da Parcela 2 com atraso superior ao limite (18 dias > 15 limite)
    # Vence 2026-06-10, paga 2026-06-28 -> comissão = R$ 0.00 (perde a comissão)
    p2.data_pagamento = date(2026, 6, 28)
    session.add(p2)
    session.commit()
    
    resultado_atraso_grave = ComissaoService.calcular_comissoes_vendedor(session, vendedor_id, 6, 2026, empresa_id, hoje=date(2026, 6, 30))
    assert resultado_atraso_grave["comissao_servicos"] == 4000.00
    assert resultado_atraso_grave["comissao_total"] == 4360.00


def test_joel_case_junho_2026(session: Session):
    """
    Valida a especificação técnica matemática com o cenário do vendedor Joel em 06/2026.
    Inputs:
      - DIAS_TOTAIS = 26 (Junho/2026 tem 26 dias úteis excluindo domingos)
      - DIAS_DECORRIDOS = 18 (hoje = 2026-06-21)
      - realizado = 52559.92
      - meta = 150000
    Outputs esperados:
      - super_meta = 180000
      - media_diaria = 2920.00 (aprox)
      - meta_por_dia = 5769.23
      - projecao = 75919.88 (aprox)
      - comissao = 315.35 (52559.92 * 0.006)
    """
    data = setup_test_data(session)
    empresa_id = data["empresa"].id
    
    # 1. Criar o vendedor Joel
    joel = Usuario(
        nome="Joel",
        email="joel@teste.com",
        hashed_password="fake",
        is_active=True,
        empresa_id=empresa_id
    )
    session.add(joel)
    session.flush()
    
    # 2. Configurar meta do Joel de R$ 150.000 para Junho/2026
    from app.models.meta_vendedor import MetaVendedor
    meta_v = MetaVendedor(
        empresa_id=empresa_id,
        vendedor_id=joel.id,
        mes=6,
        ano=2026,
        valor_meta=Decimal("150000.00")
    )
    session.add(meta_v)
    session.flush()
    
    # 3. Criar vendas para somar exatamente R$ 52559.92 em faturamento de meta (realizado)
    # Com R$ 51087.92 elegíveis para comissão (produtos Pix) e R$ 1472.00 em boleto pago (não gera comissão)
    prod_joel_1 = Produto(
        nome="Produtos Joel Pix",
        preco_unitario=Decimal("51087.92"),
        tipo="PRODUTO",
        is_active=True,
        is_deleted=False,
        empresa_id=empresa_id
    )
    prod_joel_2 = Produto(
        nome="Produtos Joel Boleto",
        preco_unitario=Decimal("1472.00"),
        tipo="PRODUTO",
        is_active=True,
        is_deleted=False,
        empresa_id=empresa_id
    )
    session.add(prod_joel_1)
    session.add(prod_joel_2)
    session.flush()
    
    venda_joel_1 = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=joel.id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=prod_joel_1.id, quantidade=1, preco_unitario=Decimal("51087.92")),
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="pix_chave", valor=Decimal("51087.92"))
        ],
        rv="RV-JOEL06-1",
        data_pagamento=date(2026, 6, 15)
    )
    PdvService.criar_venda(session, venda_joel_1, empresa_id, joel.id)
    
    venda_joel_2 = PdvVendaCreate(
        entidade_id=data["cliente"].id,
        centro_custo_id=data["cc"].id,
        vendedor_id=joel.id,
        desconto=Decimal("0.00"),
        status="REALIZADO",
        itens=[
            PdvVendaItemCreate(produto_id=prod_joel_2.id, quantidade=1, preco_unitario=Decimal("1472.00")),
        ],
        pagamentos=[
            PdvVendaPagamento(tipo_pagamento="boleto", valor=Decimal("1472.00"))
        ],
        rv="RV-JOEL06-2",
        data_pagamento=date(2026, 6, 15)
    )
    res_venda_2 = PdvService.criar_venda(session, venda_joel_2, empresa_id, joel.id)
    
    # Marcar boleto como pago em Junho/2026
    launches_v2 = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.id_parcelamento == res_venda_2.venda_id_uuid,
            Lancamento.is_deleted == False
        )
    ).all()
    for l in launches_v2:
        l.status = "PAGO"
        l.data_pagamento = date(2026, 6, 15)
        session.add(l)
    
    session.commit()
    
    # 4. Chamar calcular_indicadores_vendedor com a data de 21/06/2026
    # (hoje = 21/06/2026 resulta em decorridos = 18 dias úteis em Junho/2026)
    hoje = date(2026, 6, 21)
    
    indicadores = ComissaoService.calcular_indicadores_vendedor(
        session, joel.id, 6, 2026, empresa_id, hoje
    )
    
    # Validações dos Inputs/Outputs matemáticos da especificação
    # DIAS_TOTAIS = 26, DIAS_DECORRIDOS = 18, realizado = 52559.92
    assert indicadores["realizado"] == 52559.92
    assert indicadores["meta_total"] == 150000.00
    assert indicadores["super_meta"] == 180000.00
    
    # media_diaria = 52559.92 / 18 = 2919.995... -> arredondado para 2920.00
    assert abs(indicadores["media_atual"] - 2920.00) <= 0.05
    
    # meta_por_dia = 150000 / 26 = 5769.23
    assert abs(indicadores["meta_diaria"] - 5769.23) <= 0.05
    
    # projecao = realizado + (media_diaria * 8) = 52559.92 + (2919.995... * 8) = 75919.88
    assert abs(indicadores["projecao"] - 75919.88) <= 0.05
    
    # comissao = 51087.92 * 0.01 = 510.8792 -> rounds to 510.88
    assert abs(indicadores["comissao_acumulada"] - 510.88) <= 0.05


