# app/services/seed_demo_data.py
import datetime
import random
import json
import base64
import hashlib
from decimal import Decimal
from sqlmodel import Session, select

from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.cartao import Cartao
from app.models.lancamento import Lancamento
from app.models.produto import Produto
from app.models.regra_cartao import RegraCartao
from app.models.regra_comissao import RegraComissao
from app.models.orcamento import Orcamento
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.services.pdv_service import PdvService
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.crud.crud_plano_contas import ensure_transfer_category

def seed_demo_data(db: Session, empresa_id: int):
    """
    Popula a empresa de demonstração informada com dados financeiros fictícios
    altamente realistas cobrindo cerca de 90 dias no passado e 30 dias no futuro.
    Inclui lançamentos recorrentes completados, vendas no PDV, recebíveis de cartão,
    metas de orçamento, NF-e de entrada e comissões do vendedor.
    """
    hoje = datetime.date.today()
    user = db.exec(select(Usuario).where(Usuario.empresa_id == empresa_id)).first()
    if not user:
        return

    # 1. Obter Categorias do Plano de Contas criadas por padrão
    categorias = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa_id)).all()

    # Auxiliar para encontrar ou criar categoria de forma segura
    def find_or_create_category(nome: str, tipo: str, dre_grupo: str, parent_name: str = None, eh_operacional: bool = True):
        existing = next((c for c in categorias if c.nome.lower() == nome.lower()), None)
        if existing:
            return existing

        parent_id = None
        parent_codigo = None
        if parent_name:
            parent = next((c for c in categorias if parent_name.lower() in c.nome.lower()), None)
            if parent:
                parent_id = parent.id
                parent_codigo = parent.codigo

        if parent_codigo:
            children = [c for c in categorias if c.conta_pai_id == parent_id]
            next_num = len(children) + 1
            codigo = f"{parent_codigo}.{next_num:02d}"
        else:
            roots = [c for c in categorias if c.conta_pai_id is None and c.tipo == tipo]
            next_num = len(roots) + 1
            codigo = f"{'1' if tipo == 'R' else '2'}.{next_num:02d}"

        cat = PlanoContas(
            nome=nome,
            tipo=tipo,
            codigo=codigo,
            empresa_id=empresa_id,
            conta_pai_id=parent_id,
            permite_lancamentos=True,
            eh_operacional=eh_operacional,
            considerar_nos_resultados=True,
            dre_grupo=dre_grupo
        )
        db.add(cat)
        db.flush()
        categorias.append(cat)
        return cat

    # Criar ou encontrar categorias específicas da demonstração
    cat_receita_prod = find_or_create_category("Receita de Venda de Produtos", "R", "RECEITA_BRUTA", "Receitas Operacionais")
    cat_receita_serv = find_or_create_category("Receita de Prestação de Serviços", "R", "RECEITA_BRUTA", "Receitas Operacionais")
    cat_rendimentos = find_or_create_category("Rendimentos de Aplicação", "R", "OUTRAS_RECEITAS", None, eh_operacional=False)
    
    cat_salarios = next((c for c in categorias if c.tipo == "D" and not c.eh_cabecalho and ("salário" in c.nome.lower() or "pessoal" in c.nome.lower())), None)
    if not cat_salarios:
        cat_salarios = find_or_create_category("Salario/ Bolsas/ Autonomia", "D", "DESPESAS_OPERACIONAIS", "Despesas de Pessoal")

    cat_aluguel = find_or_create_category("Aluguel e Condomínio", "D", "DESPESAS_OPERACIONAIS", "Despesas")
    cat_marketing = find_or_create_category("Marketing e Propaganda", "D", "DESPESAS_OPERACIONAIS", "Despesas")
    cat_energia = find_or_create_category("Energia e Água", "D", "DESPESAS_OPERACIONAIS", "Despesas")
    cat_impostos = find_or_create_category("Impostos e DAS", "D", "DEDUCOES_RECEITA", "Abatimento de Vendas")
    cat_fornecedores = find_or_create_category("Suprimentos e Mercadorias", "D", "CUSTOS_VARIAVEIS", "Custos")

    # Remover o centro de custo "principal" gerado por padrão para que a demonstração fique limpa
    cc_principal = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id, CentroCusto.nome.ilike("principal"))).first()
    if cc_principal:
        db.delete(cc_principal)
        db.flush()

    # 2. Criar Centros de Custo
    cc_adm = CentroCusto(nome="Administrativo", codigo="1.01", status="ATIVO", empresa_id=empresa_id)
    cc_comercial = CentroCusto(nome="Comercial", codigo="1.02", status="ATIVO", empresa_id=empresa_id)
    cc_operacoes = CentroCusto(nome="Operações", codigo="1.03", status="ATIVO", empresa_id=empresa_id)
    db.add(cc_adm)
    db.add(cc_comercial)
    db.add(cc_operacoes)
    db.flush()

    # 3. Criar Contas Bancárias
    conta_itau = Conta(
        nome="Itaú PJ",
        tipo="CORRENTE",
        banco="Itaú",
        agencia="0432",
        conta_numero="12345",
        conta_digito="6",
        saldo_inicial=Decimal("25000.00"),
        data_saldo_inicial=hoje - datetime.timedelta(days=90),
        status="ATIVO",
        cor="#EC7000",
        centro_custo_id=cc_adm.id,
        empresa_id=empresa_id
    )
    conta_caixinha = Conta(
        nome="Caixinha Escritório",
        tipo="CAIXA",
        saldo_inicial=Decimal("800.00"),
        data_saldo_inicial=hoje - datetime.timedelta(days=90),
        status="ATIVO",
        cor="#808080",
        centro_custo_id=cc_adm.id,
        empresa_id=empresa_id
    )
    conta_nubank = Conta(
        nome="Nubank Investimentos",
        tipo="INVESTIMENTO",
        banco="Nubank",
        saldo_inicial=Decimal("50000.00"),
        data_saldo_inicial=hoje - datetime.timedelta(days=90),
        status="ATIVO",
        cor="#8A05BE",
        centro_custo_id=cc_adm.id,
        empresa_id=empresa_id
    )
    db.add(conta_itau)
    db.add(conta_caixinha)
    db.add(conta_nubank)
    db.flush()

    # 4. Criar Entidades (Clientes e Fornecedores)
    c1 = Entidade(nome="ACME Corporation S.A.", tipo="CLIENTE", tipo_pessoa="PJ", cpf_cnpj="11111111000111", cidade="São Paulo", uf="SP", status="ATIVO", empresa_id=empresa_id)
    c2 = Entidade(nome="Inova Tech Soluções", tipo="CLIENTE", tipo_pessoa="PJ", cpf_cnpj="22222222000122", cidade="Belo Horizonte", uf="MG", status="ATIVO", empresa_id=empresa_id)
    c3 = Entidade(nome="João da Silva Santos", tipo="CLIENTE", tipo_pessoa="PF", cpf_cnpj="33333333333", cidade="Rio de Janeiro", uf="RJ", status="ATIVO", empresa_id=empresa_id)
    
    f1 = Entidade(nome="Telefônica Brasil S.A. (Vivo)", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="44444444000144", status="ATIVO", empresa_id=empresa_id)
    f2 = Entidade(nome="Distribuidora de Energia Neoenergia", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="55555555000155", status="ATIVO", empresa_id=empresa_id)
    f3 = Entidade(nome="Contabilidade Confiança Ltda", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="66666666000166", status="ATIVO", empresa_id=empresa_id)
    f4 = Entidade(nome="Google Brasil Internet Ltda (Ads)", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="77777777000177", status="ATIVO", empresa_id=empresa_id)
    
    # Entidades adicionais para Aluguel, Salários, Impostos, Lanches
    f5 = Entidade(nome="Locadora Lar Seguro Ltda", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="88888888000188", status="ATIVO", empresa_id=empresa_id)
    f6 = Entidade(nome="Colaboradores KyrusERP S.A.", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="99999999000199", status="ATIVO", empresa_id=empresa_id)
    f7 = Entidade(nome="Receita Federal (Simples Nacional)", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="00000000000100", status="ATIVO", empresa_id=empresa_id)
    f8 = Entidade(nome="Restaurante Sabor & Arte Ltda", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="11111111000112", status="ATIVO", empresa_id=empresa_id)
    f9 = Entidade(nome="Nubank S.A. (Rendimentos)", tipo="FORNECEDOR", tipo_pessoa="PJ", cpf_cnpj="22222222000180", status="ATIVO", empresa_id=empresa_id)

    db.add_all([c1, c2, c3, f1, f2, f3, f4, f5, f6, f7, f8, f9])
    db.flush()

    # 5. Criar Cartão de Crédito Corporativo
    cartao_corp = Cartao(
        nome_cartao="Visa Corporativo",
        bandeira="Visa",
        limite_total=Decimal("15000.00"),
        dia_fechamento=5,
        dia_vencimento=15,
        status="ATIVO",
        conta_id=conta_itau.id,
        centro_custo_id=cc_adm.id,
        empresa_id=empresa_id
    )
    db.add(cartao_corp)
    db.flush()

    # 6. Regras de Cartão no PDV
    regra_visa = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento="cartao_credito_vista",
        bandeira="VISA",
        centro_custo_id=cc_comercial.id,
        taxa_porcentagem=Decimal("2.50"),
        dias_payout=30,
        tipo_prazo="DIAS_CORRIDOS",
        fds_proximo_dia_util=True,
        modo_parcelamento="PRO_RATA",
        taxa_antecipacao=Decimal("0.00"),
        conta_destino_id=conta_itau.id,
        plano_contas_taxa_id=cat_fornecedores.id
    )
    regra_master = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento="cartao_credito_parcelado",
        bandeira="MASTERCARD",
        centro_custo_id=cc_comercial.id,
        taxa_porcentagem=Decimal("3.50"),
        dias_payout=30,
        tipo_prazo="DIAS_CORRIDOS",
        fds_proximo_dia_util=True,
        modo_parcelamento="PRO_RATA",
        taxa_antecipacao=Decimal("1.50"),
        conta_destino_id=conta_itau.id,
        plano_contas_taxa_id=cat_fornecedores.id
    )
    db.add(regra_visa)
    db.add(regra_master)
    db.flush()

    # 7. Regras de Comissão para Vendedores
    regra_comissao = RegraComissao(
        empresa_id=empresa_id,
        centro_custo_id=cc_comercial.id,
        data_inicio=hoje - datetime.timedelta(days=90),
        taxa_servico=Decimal("0.05"),
        dias_tolerancia_atraso=5,
        redutor_atraso_intermediario_pct=Decimal("0.50"),
        dias_limite_atraso=30,
        faixas_produtos_json='[{"min_faturamento": 0, "taxa": 0.03}, {"min_faturamento": 20000, "taxa": 0.04}, {"min_faturamento": 50000, "taxa": 0.05}]'
    )
    db.add(regra_comissao)
    db.flush()

    # 8. Metas de Orçamento (Orcamento) para 2026
    for m in range(1, 13):
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_receita_prod.id, ano=2026, mes=m, valor_orcado=Decimal("80000.00")))
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_receita_serv.id, ano=2026, mes=m, valor_orcado=Decimal("50000.00")))
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_salarios.id, ano=2026, mes=m, valor_orcado=Decimal("15000.00")))
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_aluguel.id, ano=2026, mes=m, valor_orcado=Decimal("4000.00")))
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_marketing.id, ano=2026, mes=m, valor_orcado=Decimal("3000.00")))
        db.add(Orcamento(empresa_id=empresa_id, plano_conta_id=cat_energia.id, ano=2026, mes=m, valor_orcado=Decimal("1000.00")))
    db.flush()

    # 9. Configurar o PDV na empresa (pdv_config JSON)
    pdv_config_dict = {
        "categorias": {
            "dinheiro": cat_receita_prod.id,
            "pix_chave": cat_receita_prod.id,
            "pix_qr": cat_receita_prod.id,
            "cartao_debito": cat_receita_prod.id,
            "cartao_credito_vista": cat_receita_prod.id,
            "cartao_credito_parcelado": cat_receita_prod.id,
            "boleto": cat_receita_prod.id
        },
        "contas": {
            "dinheiro": conta_itau.id,
            "pix_chave": conta_nubank.id,
            "pix_qr": conta_nubank.id,
            "cartao_debito": conta_itau.id,
            "cartao_credito_vista": conta_itau.id,
            "cartao_credito_parcelado": conta_itau.id,
            "boleto": conta_itau.id
        },
        "marcar_como_pago": {
            "dinheiro": True,
            "pix_chave": True,
            "pix_qr": True,
            "cartao_debito": True,
            "cartao_credito_vista": False,
            "cartao_credito_parcelado": False,
            "boleto": False
        },
        "formas_pagamento": [
            {"key": "dinheiro", "label": "Dinheiro", "parcelada": False},
            {"key": "pix_chave", "label": "PIX (Chave)", "parcelada": False},
            {"key": "pix_qr", "label": "PIX (QR Code)", "parcelada": False},
            {"key": "cartao_debito", "label": "Cartão de Débito", "parcelada": False},
            {"key": "cartao_credito_vista", "label": "Cartão de Crédito à Vista", "parcelada": False},
            {"key": "cartao_credito_parcelado", "label": "Cartão de Crédito Parcelado", "parcelada": True},
            {"key": "boleto", "label": "Boleto Bancário", "parcelada": True}
        ]
    }
    empresa = db.get(Empresa, empresa_id)
    if empresa:
        empresa.pdv_config = json.dumps(pdv_config_dict)
        db.add(empresa)
        db.flush()

    # 10. Criar Produtos no Estoque
    p1 = Produto(nome="Notebook Dell Inspiron 15", preco_unitario=Decimal("4299.00"), preco_custo_medio=2800.0, codigo_barras=f"789123{empresa_id:07d}", empresa_id=empresa_id)
    p2 = Produto(nome="Monitor UltraWide LG 29\"", preco_unitario=Decimal("1399.00"), preco_custo_medio=950.0, codigo_barras=f"789124{empresa_id:07d}", empresa_id=empresa_id)
    p3 = Produto(nome="Mouse Gamer Sem Fio Kyrus", preco_unitario=Decimal("249.90"), preco_custo_medio=110.0, codigo_barras=f"789125{empresa_id:07d}", empresa_id=empresa_id)
    p4 = Produto(nome="Teclado Mecânico RGB Kyrus", preco_unitario=Decimal("499.90"), preco_custo_medio=230.0, codigo_barras=f"789126{empresa_id:07d}", empresa_id=empresa_id)
    p5 = Produto(nome="Cadeira Gamer Kyrus Pro", preco_unitario=Decimal("1699.00"), preco_custo_medio=990.0, codigo_barras=f"789127{empresa_id:07d}", empresa_id=empresa_id)
    p6 = Produto(nome="Headset Bluetooth Kyrus Noise Canceling", preco_unitario=Decimal("389.00"), preco_custo_medio=180.0, codigo_barras=f"789128{empresa_id:07d}", empresa_id=empresa_id)
    db.add_all([p1, p2, p3, p4, p5, p6])
    db.flush()

    produtos_map = {p.id: p for p in [p1, p2, p3, p4, p5, p6]}

    # 11. Seedar Lançamentos Financeiros Fictícios
    # 11.1 Lançamentos Recorrentes Mensais
    for offset in range(-3, 2):
        m = hoje.month + offset
        y = hoje.year
        if m < 1:
            m += 12
            y -= 1
        elif m > 12:
            m -= 12
            y += 1
            
        competencia_str = f"{m:02d}/{y}"
        
        # Aluguel (todo dia 10)
        venc_aluguel = datetime.date(y, m, 10)
        pago_aluguel = venc_aluguel if venc_aluguel <= hoje else None
        db.add(
            Lancamento(
                descricao="Aluguel do Escritório",
                tipo="DESPESA",
                status="PAGO" if pago_aluguel else "EM ABERTO",
                previsto=True,
                valor_previsto=Decimal("3500.00"),
                valor_pago=Decimal("3500.00") if pago_aluguel else Decimal("0.00"),
                data_vencimento=venc_aluguel,
                data_pagamento=pago_aluguel,
                data_competencia=datetime.date(y, m, 1),
                competencia=competencia_str,
                empresa_id=empresa_id,
                plano_contas_id=cat_aluguel.id,
                conta_id=conta_itau.id if pago_aluguel else None,
                entidade_id=f5.id,
                centro_custo_id=cc_adm.id
            )
        )
        
        # Salários (todo dia 5)
        venc_salarios = datetime.date(y, m, 5)
        pago_salarios = venc_salarios if venc_salarios <= hoje else None
        db.add(
            Lancamento(
                descricao="Folha de Pagamento - Colaboradores",
                tipo="DESPESA",
                status="PAGO" if pago_salarios else "EM ABERTO",
                previsto=True,
                valor_previsto=Decimal("12000.00"),
                valor_pago=Decimal("12000.00") if pago_salarios else Decimal("0.00"),
                data_vencimento=venc_salarios,
                data_pagamento=pago_salarios,
                data_competencia=datetime.date(y, m, 1),
                competencia=competencia_str,
                empresa_id=empresa_id,
                plano_contas_id=cat_salarios.id,
                conta_id=conta_itau.id if pago_salarios else None,
                entidade_id=f6.id,
                centro_custo_id=cc_operacoes.id
            )
        )
        
        # Internet e Telefone (todo dia 15)
        venc_vivo = datetime.date(y, m, 15)
        pago_vivo = venc_vivo if venc_vivo <= hoje else None
        db.add(
            Lancamento(
                descricao="Fatura Vivo Fibra + Telefonia",
                tipo="DESPESA",
                status="PAGO" if pago_vivo else "EM ABERTO",
                previsto=True,
                valor_previsto=Decimal("350.00"),
                valor_pago=Decimal("350.00") if pago_vivo else Decimal("0.00"),
                data_vencimento=venc_vivo,
                data_pagamento=pago_vivo,
                data_competencia=datetime.date(y, m, 1),
                competencia=competencia_str,
                empresa_id=empresa_id,
                plano_contas_id=cat_energia.id,
                conta_id=conta_itau.id if pago_vivo else None,
                entidade_id=f1.id,
                centro_custo_id=cc_adm.id
            )
        )
        
        # Contabilidade (todo dia 20)
        venc_contab = datetime.date(y, m, 20)
        pago_contab = venc_contab if venc_contab <= hoje else None
        db.add(
            Lancamento(
                descricao="Honorários Contabilidade Confiança",
                tipo="DESPESA",
                status="PAGO" if pago_contab else "EM ABERTO",
                previsto=True,
                valor_previsto=Decimal("800.00"),
                valor_pago=Decimal("800.00") if pago_contab else Decimal("0.00"),
                data_vencimento=venc_contab,
                data_pagamento=pago_contab,
                data_competencia=datetime.date(y, m, 1),
                competencia=competencia_str,
                empresa_id=empresa_id,
                plano_contas_id=cat_marketing.id,
                conta_id=conta_itau.id if pago_contab else None,
                entidade_id=f3.id,
                centro_custo_id=cc_adm.id
            )
        )
        
        # Impostos DAS (todo dia 20)
        venc_impostos = datetime.date(y, m, 20)
        pago_impostos = venc_impostos if venc_impostos <= hoje else None
        db.add(
            Lancamento(
                descricao="Guia Simples Nacional (DAS)",
                tipo="DESPESA",
                status="PAGO" if pago_impostos else "EM ABERTO",
                previsto=True,
                valor_previsto=Decimal("1850.00"),
                valor_pago=Decimal("1850.00") if pago_impostos else Decimal("0.00"),
                data_vencimento=venc_impostos,
                data_pagamento=pago_impostos,
                data_competencia=datetime.date(y, m, 1),
                competencia=competencia_str,
                empresa_id=empresa_id,
                plano_contas_id=cat_impostos.id,
                conta_id=conta_itau.id if pago_impostos else None,
                entidade_id=f7.id,
                centro_custo_id=cc_adm.id
            )
        )

        # Rendimentos no Nubank (todo dia 30)
        venc_rend = datetime.date(y, m, 28)
        pago_rend = venc_rend if venc_rend <= hoje else None
        if pago_rend:
            db.add(
                Lancamento(
                    descricao="Rendimento de Aplicação Nubank",
                    tipo="RECEITA",
                    status="PAGO",
                    previsto=True,
                    valor_previsto=Decimal("380.00"),
                    valor_pago=Decimal("380.00"),
                    data_vencimento=venc_rend,
                    data_pagamento=pago_rend,
                    data_competencia=pago_rend,
                    competencia=competencia_str,
                    empresa_id=empresa_id,
                    plano_contas_id=cat_rendimentos.id,
                    conta_id=conta_nubank.id,
                    entidade_id=f9.id,
                    centro_custo_id=cc_adm.id
                )
            )

    # 11.2 Transferências Mensais de Itaú para Nubank
    cat_transf = ensure_transfer_category(db, empresa_id=empresa_id)
    for offset in range(-3, 1):
        m = hoje.month + offset
        y = hoje.year
        if m < 1:
            m += 12
            y -= 1
        transf_date = datetime.date(y, m, 25)
        if transf_date <= hoje:
            grupo_transf_id = str(hashlib.md5(f"{empresa_id}-transf-{y}-{m}".encode()).hexdigest())
            
            # Saída do Itaú
            db.add(Lancamento(
                descricao="Transferência para Nubank",
                tipo="DESPESA",
                valor_previsto=Decimal("4000.00"),
                valor_pago=Decimal("4000.00"),
                data_vencimento=transf_date,
                data_pagamento=transf_date,
                data_competencia=transf_date,
                competencia=f"{m:02d}/{y}",
                previsto=True,
                conta_id=conta_itau.id,
                status="PAGO",
                origem="TRANSFERENCIA",
                empresa_id=empresa_id,
                plano_contas_id=cat_transf.id,
                centro_custo_id=cc_adm.id,
                transferencia_grupo_id=grupo_transf_id
            ))
            # Entrada no Nubank
            db.add(Lancamento(
                descricao="Transferência de Itaú",
                tipo="RECEITA",
                valor_previsto=Decimal("4000.00"),
                valor_pago=Decimal("4000.00"),
                data_vencimento=transf_date,
                data_pagamento=transf_date,
                data_competencia=transf_date,
                competencia=f"{m:02d}/{y}",
                previsto=True,
                conta_id=conta_nubank.id,
                status="PAGO",
                origem="TRANSFERENCIA",
                empresa_id=empresa_id,
                plano_contas_id=cat_transf.id,
                centro_custo_id=cc_adm.id,
                transferencia_grupo_id=grupo_transf_id
            ))

    # 11.3 Lançamentos de Prestação de Serviços (Receitas Operacionais)
    random.seed(42)
    for i in range(25):
        dias_atras = random.randint(-90, 15)
        venc_dt = hoje + datetime.timedelta(days=dias_atras)
        valor = Decimal(f"{random.randint(2500, 7500)}.00")
        is_paid = venc_dt <= hoje
        pago_dt = venc_dt if is_paid else None
        cliente = random.choice([c1, c2, c3])
        
        db.add(
            Lancamento(
                descricao=f"Prestação de Serviços - {cliente.nome}",
                tipo="RECEITA",
                status="PAGO" if is_paid else "EM ABERTO",
                previsto=True,
                valor_previsto=valor,
                valor_pago=valor if is_paid else Decimal("0.00"),
                data_vencimento=venc_dt,
                data_pagamento=pago_dt,
                data_competencia=venc_dt,
                competencia=f"{venc_dt.month:02d}/{venc_dt.year}",
                empresa_id=empresa_id,
                plano_contas_id=cat_receita_serv.id,
                conta_id=conta_itau.id if is_paid else None,
                entidade_id=cliente.id,
                centro_custo_id=cc_comercial.id
            )
        )
        
    # 11.4 Despesas avulsas (Google Ads)
    for i in range(12):
        dias_atras = random.randint(-90, 5)
        venc_dt = hoje + datetime.timedelta(days=dias_atras)
        valor = Decimal(f"{random.randint(300, 1800)}.50")
        is_paid = venc_dt <= hoje
        pago_dt = venc_dt if is_paid else None
        
        db.add(
            Lancamento(
                descricao="Campanha Google Ads - Marketing",
                tipo="DESPESA",
                status="PAGO" if is_paid else "EM ABERTO",
                previsto=True,
                valor_previsto=valor,
                valor_pago=valor if is_paid else Decimal("0.00"),
                data_vencimento=venc_dt,
                data_pagamento=pago_dt,
                data_competencia=venc_dt,
                competencia=f"{venc_dt.month:02d}/{venc_dt.year}",
                empresa_id=empresa_id,
                plano_contas_id=cat_marketing.id,
                conta_id=conta_itau.id if is_paid else None,
                entidade_id=f4.id,
                centro_custo_id=cc_comercial.id
            )
        )
        
    # 11.5 Lançamentos no Cartão de Crédito
    for i in range(12):
        dias_atras = random.randint(-60, 0)
        venc_dt = hoje + datetime.timedelta(days=dias_atras)
        valor = Decimal(f"{random.randint(50, 450)}.00")
        
        db.add(
            Lancamento(
                descricao=f"Almoço Comercial com Cliente - Visa Corp {i+1}",
                tipo="DESPESA",
                status="PAGO",
                previsto=True,
                valor_previsto=valor,
                valor_pago=valor,
                data_vencimento=venc_dt,
                data_pagamento=venc_dt,
                data_competencia=venc_dt,
                competencia=f"{venc_dt.month:02d}/{venc_dt.year}",
                empresa_id=empresa_id,
                plano_contas_id=cat_fornecedores.id,
                cartao_id=cartao_corp.id,
                entidade_id=f8.id,
                centro_custo_id=cc_adm.id
            )
        )

    # 11.6 Movimentações no Caixinha Físico (Caixa)
    db.add(Lancamento(
        descricao="Café e Lanche para o Escritório",
        tipo="DESPESA",
        status="PAGO",
        previsto=True,
        valor_previsto=Decimal("45.00"),
        valor_pago=Decimal("45.00"),
        data_vencimento=hoje,
        data_pagamento=hoje,
        data_competencia=hoje,
        competencia=f"{hoje.month:02d}/{hoje.year}",
        empresa_id=empresa_id,
        plano_contas_id=cat_energia.id,
        conta_id=conta_caixinha.id,
        entidade_id=f8.id,
        centro_custo_id=cc_adm.id
    ))
    db.add(Lancamento(
        descricao="Resma de Papel A4 e Envelopes",
        tipo="DESPESA",
        status="PAGO",
        previsto=True,
        valor_previsto=Decimal("65.00"),
        valor_pago=Decimal("65.00"),
        data_vencimento=hoje - datetime.timedelta(days=1),
        data_pagamento=hoje - datetime.timedelta(days=1),
        data_competencia=hoje - datetime.timedelta(days=1),
        competencia=f"{hoje.month:02d}/{hoje.year}",
        empresa_id=empresa_id,
        plano_contas_id=cat_marketing.id,
        conta_id=conta_caixinha.id,
        entidade_id=f3.id,
        centro_custo_id=cc_adm.id
    ))
    db.add(Lancamento(
        descricao="Venda Local de Paletes Usados (Dinheiro)",
        tipo="RECEITA",
        status="PAGO",
        previsto=True,
        valor_previsto=Decimal("150.00"),
        valor_pago=Decimal("150.00"),
        data_vencimento=hoje - datetime.timedelta(days=2),
        data_pagamento=hoje - datetime.timedelta(days=2),
        data_competencia=hoje - datetime.timedelta(days=2),
        competencia=f"{hoje.month:02d}/{hoje.year}",
        empresa_id=empresa_id,
        plano_contas_id=cat_receita_prod.id,
        conta_id=conta_caixinha.id,
        entidade_id=c3.id,
        centro_custo_id=cc_adm.id
    ))

    # 12. Seedar NFes (Notas Fiscais de Entrada) na origem NFE_XML
    def seed_nfe(numero: str, chave: str, situacao: str, valor: Decimal, data: datetime.date, entidade_id: int):
        itens_nfe_meta = [
            {
                "descricao": f"Suprimentos Importados da NF-{numero}",
                "quantidade": 1.0,
                "valor_unitario": float(valor),
                "valor_total": float(valor),
                "cfop": "1102",
                "ncm": "48025690"
            }
        ]
        payload = json.dumps(itens_nfe_meta, ensure_ascii=False, separators=(",", ":"))
        token_itens = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")
        
        observacao = f"NF-e {numero} | Chave {chave} | EmitenteDoc 11111111000111 | CFOP 1102 | DestinoCompra ESTOQUE | ItensMeta {token_itens} | Situacao {situacao}"
        db.add(
            Lancamento(
                descricao=f"Compra NF-e {numero} Parcela 1/1",
                tipo="DESPESA",
                origem="NFE_XML",
                ipp=False,
                previsto=True,
                valor_previsto=valor,
                valor_pago=Decimal("0.00"),
                data_vencimento=data + datetime.timedelta(days=30),
                data_pagamento=None,
                data_competencia=data,
                competencia=f"{data.month:02d}/{data.year}",
                numero_parcela=1,
                id_parcelamento=f"NFE-{chave}",
                observacao=observacao,
                conciliado=False,
                import_hash=hashlib.sha256(f"{empresa_id}-{chave}-1".encode('utf-8')).hexdigest(),
                empresa_id=empresa_id,
                plano_contas_id=cat_fornecedores.id,
                entidade_id=entidade_id,
                centro_custo_id=cc_adm.id
            )
        )

    seed_nfe("1042", "35260711111111000111550010000010421234567890", "AGUARDANDO_ENTREGA", Decimal("1250.00"), hoje - datetime.timedelta(days=4), f3.id)
    seed_nfe("2088", "35260755555555000155550010000020881234567890", "ENTREGUE", Decimal("350.00"), hoje - datetime.timedelta(days=8), f2.id)
    seed_nfe("3051", "35260777777777000177550010000030511234567890", "CANCELADA", Decimal("800.00"), hoje - datetime.timedelta(days=12), f4.id)

    db.commit()

    # 13. Seedar Vendas reais do PDV via PdvService
    # Gerar 15 vendas realistas e itemizadas nos últimos 45 dias
    random.seed(123)
    pagamento_opcoes = ["dinheiro", "pix_chave", "cartao_credito_vista", "cartao_credito_parcelado"]
    clientes_list = [c1, c2, c3]
    
    for i in range(15):
        cliente = random.choice(clientes_list)
        dias_atras = random.randint(1, 45)
        data_venda = hoje - datetime.timedelta(days=dias_atras)
        
        # Escolher 1 ou 2 produtos
        prod1 = random.choice([p1, p2, p3, p4, p5, p6])
        prod2 = random.choice([p1, p2, p3, p4, p5, p6])
        
        itens = [
            PdvVendaItemCreate(produto_id=prod1.id, quantidade=random.randint(1, 2))
        ]
        if prod1.id != prod2.id:
            itens.append(PdvVendaItemCreate(produto_id=prod2.id, quantidade=1))
            
        subtotal = sum(Decimal(str(item.quantidade)) * produtos_map[item.produto_id].preco_unitario for item in itens)
        desconto = Decimal(f"{random.randint(0, int(subtotal * Decimal('0.08')))}.00")
        valor_liquido = subtotal - desconto
        
        pay_type = random.choice(pagamento_opcoes)
        num_parc = 3 if pay_type == "cartao_credito_parcelado" else 1
        
        pagamentos = [
            PdvVendaPagamento(
                tipo_pagamento=pay_type,
                valor=valor_liquido,
                numero_parcelas=num_parc,
                valor_parcela=(valor_liquido / num_parc).quantize(Decimal("0.01")),
                data_pagamento=data_venda,
                bandeira="VISA" if "credito" in pay_type else "OUTROS"
            )
        ]
        
        venda_in = PdvVendaCreate(
            entidade_id=cliente.id,
            centro_custo_id=cc_comercial.id,
            vendedor_id=user.id,
            desconto=desconto,
            status="REALIZADO",
            itens=itens,
            pagamentos=pagamentos,
            data_pagamento=data_venda
        )
        
        try:
            PdvService.criar_venda(db, venda_in, empresa_id, user.id)
        except Exception as e:
            # Silently catch to avoid crashing the whole seed if there's any local parameter validation issue
            pass

    # 9. Inserir lançamentos fictícios de demonstração do iFood
    try:
        from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
        
        # Gerar dados para os últimos 10 dias
        for offset in range(1, 11):
            dia_venda = hoje - datetime.timedelta(days=offset)
            
            faturamento_dia = Decimal(f"{random.randint(1500, 8000)}.{random.randint(10, 99)}")
            num_transacoes = random.randint(3, 7)
            restante = faturamento_dia
            
            formas = ["debito_ifood", "pix_ifood", "credito_vista", "carteira_digital"]
            
            for t_idx in range(num_transacoes):
                if t_idx == num_transacoes - 1:
                    valor_bruto = restante
                else:
                    valor_bruto = (restante / Decimal(str(num_transacoes - t_idx)) * Decimal(str(random.uniform(0.7, 1.3)))).quantize(Decimal("0.01"))
                    restante -= valor_bruto
                
                if valor_bruto <= 0:
                    continue
                    
                forma = random.choice(formas)
                taxa = Decimal("0.12")
                valor_liquido = (valor_bruto * (Decimal("1.00") - taxa)).quantize(Decimal("0.01"))
                
                prazo = 1 if forma == "pix_ifood" else 7
                dia_recebimento = dia_venda + datetime.timedelta(days=prazo)
                
                hora_random = f"{random.randint(11, 23):02d}:{random.randint(0, 59):02d}:{random.randint(0, 59):02d}"
                
                despesas = []
                if random.random() < 0.3:
                    despesas.append("cupom_descontos")
                if random.random() < 0.2:
                    despesas.append("motoboy_ifood")
                
                despesas_str = ",".join(despesas) if despesas else None
                
                t_ifood = PdvIfoodLancamento(
                    empresa_id=empresa_id,
                    forma_recebimento=forma,
                    valor_bruto=valor_bruto,
                    valor_liquido=valor_liquido,
                    data_venda=dia_venda,
                    hora_venda=hora_random,
                    data_recebimento_ajustada=dia_recebimento,
                    despesas_extras_str=despesas_str,
                    status_conciliado=False,
                    created_by_id=user.id,
                    updated_by_id=user.id,
                    created_at=datetime.datetime.utcnow(),
                    updated_at=datetime.datetime.utcnow()
                )
                db.add(t_ifood)
    except Exception:
        pass

    db.commit()
