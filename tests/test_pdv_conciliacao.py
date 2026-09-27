import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
from fastapi.testclient import TestClient
from sqlmodel import Session, select, col

from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.db.session import get_db
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.produto import Produto
from app.models.lancamento import Lancamento
from app.models.regra_cartao import RegraCartao
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem
from app.models.pdv_movimentacao import PdvMovimentacao

@pytest.fixture(name="setup_db")
def setup_db_fixture(session: Session):
    # 1. Seed Empresa
    empresa = Empresa(
        id=1,
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste",
        cnpj="12345678000199",
        pdv_config=json.dumps({
            "categorias": {
                "cartao_credito_vista": 10,
                "cartao_credito_parcelado": 10,
                "cartao_debito": 10
            },
            "marcar_como_pago": {
                "dinheiro": True,
                "pix_chave": True,
                "pix_qr": True
            },
            "contas": {
                "cartao_credito_vista": "1",
                "cartao_credito_parcelado": "1",
                "cartao_debito": "1"
            },
            "formas_pagamento": [
                {"key": "dinheiro", "label": "Dinheiro", "parcelada": False},
                {"key": "cartao_credito_vista", "label": "Crédito à Vista", "parcelada": False},
                {"key": "cartao_credito_parcelado", "label": "Crédito Parcelado", "parcelada": True},
                {"key": "cartao_debito", "label": "Débito", "parcelada": False}
            ]
        })
    )
    session.add(empresa)
    session.flush()

    # 2. Seed Usuario (Vendedor & Admin)
    usuario = Usuario(
        id=1,
        nome="João Vendedor",
        email="vendedor@teste.com",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=True,
        consultor_role="SUPER_CONSULTOR",
        empresa_id=1
    )
    session.add(usuario)
    session.flush()

    # 3. Seed Entidade (Cliente)
    cliente = Entidade(
        id=1,
        nome="Cliente Consumidor",
        tipo="CLIENTE",
        empresa_id=1
    )
    session.add(cliente)
    session.flush()

    # 4. Seed Centro de Custo
    centro = CentroCusto(
        id=1,
        nome="Matriz",
        descricao="Filial Principal",
        empresa_id=1
    )
    session.add(centro)
    session.flush()

    # 5. Seed Plano de Contas (Receitas)
    plano_receita = PlanoContas(
        id=10,
        codigo="1.1.01",
        nome="Vendas de Mercadorias",
        tipo="R",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano_receita)
    
    # Plano de Contas (Despesas de Taxas de Cartão)
    plano_despesa = PlanoContas(
        id=20,
        codigo="2.1.05",
        nome="Taxas e Tarifas de Cartões",
        tipo="D",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano_despesa)
    session.flush()

    # 6. Seed Conta Bancária
    conta = Conta(
        id=1,
        nome="Banco Itaú",
        tipo="BANCO",
        saldo_inicial=Decimal("0.00"),
        status="ATIVO",
        empresa_id=1,
        conta_como_disponibilidade=True
    )
    session.add(conta)
    session.flush()

    # 7. Seed Produto
    produto = Produto(
        id=1,
        nome="Smartphone X",
        preco_unitario=Decimal("1000.00"),
        tipo="PRODUTO",
        empresa_id=1,
        is_deleted=False
    )
    session.add(produto)
    
    session.commit()
    return {
        "empresa": empresa,
        "usuario": usuario,
        "cliente": cliente,
        "centro": centro,
        "plano_receita": plano_receita,
        "plano_despesa": plano_despesa,
        "conta": conta,
        "produto": produto
    }


def test_pdv_card_rules_and_reconciliation_workflow(client: TestClient, session: Session, setup_db):
    # 1. Configurar override de autenticação
    def mock_get_current_user():
        return setup_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    # Aplicar overrides temporários no client
    from app.main import app
    app.dependency_overrides.update(app_dependency_overrides)
    
    try:
        # --- TESTE A: Criar Regra de Cartão via API ---
        # Regra de Crédito à Vista: D+30 corridos, taxa 2.50%
        payload_regra_vista = {
            "tipo_pagamento": "cartao_credito_vista",
            "bandeira": "VISA",
            "taxa_porcentagem": 2.50,
            "dias_payout": 30,
            "tipo_prazo": "DIAS_CORRIDOS",
            "fds_proximo_dia_util": True,
            "conta_destino_id": 1,
            "plano_contas_taxa_id": 20
        }
        res_regra_vista = client.post("/api/v1/pdv/regras-cartao", json=payload_regra_vista)
        assert res_regra_vista.status_code == 201
        regra_vista_id = res_regra_vista.json()["id"]

        # Regra de Crédito Parcelado: D+30 corridos por parcela (PRO_RATA), taxa 3.00%
        payload_regra_parcelado = {
            "tipo_pagamento": "cartao_credito_parcelado",
            "bandeira": "MASTERCARD",
            "taxa_porcentagem": 3.00,
            "dias_payout": 30,
            "tipo_prazo": "DIAS_CORRIDOS",
            "modo_parcelamento": "PRO_RATA",
            "fds_proximo_dia_util": True,
            "conta_destino_id": 1,
            "plano_contas_taxa_id": 20
        }
        res_regra_parc = client.post("/api/v1/pdv/regras-cartao", json=payload_regra_parcelado)
        assert res_regra_parc.status_code == 201

        # --- TESTE B: Realizar Venda de Cartão à Vista (Credit Card 1x) ---
        # Venda de R$ 1.000,00 com cartão Visa
        hoje = date(2026, 6, 13)  # É um sábado
        payload_venda_vista = {
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
                    "tipo_pagamento": "cartao_credito_vista",
                    "valor": 1000.00,
                    "bandeira": "VISA"
                }
            ]
        }
        res_venda_vista = client.post("/api/v1/pdv/vendas", json=payload_venda_vista)
        assert res_venda_vista.status_code == 201
        venda_vista = res_venda_vista.json()
        uuid_vista = venda_vista["venda_id_uuid"]
        
        # Verificar se a movimentação no banco calculou corretamente
        mov_vista = session.exec(
            select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_vista)
        ).first()
        assert mov_vista is not None
        # Data da movimentação operacional no PDV: 13/06/2026 (Data da venda)
        assert mov_vista.data == date(2026, 6, 13)
        assert mov_vista.bandeira == "VISA"
        assert mov_vista.forma_pagamento == "CREDITO_AVISTA"
        assert mov_vista.valor == Decimal("1000.00")

        # --- TESTE C: Realizar Venda de Cartão Parcelado 3x (PRO_RATA) ---
        payload_venda_parcelado = {
            "entidade_id": 1,
            "centro_custo_id": 1,
            "vendedor_id": 1,
            "desconto": 0.00,
            "status": "REALIZADO",
            "data_pagamento": str(hoje),
            "itens": [
                {"produto_id": 1, "quantidade": 3}  # Total R$ 3000
            ],
            "pagamentos": [
                {
                    "tipo_pagamento": "cartao_credito_parcelado",
                    "valor": 3000.00,
                    "numero_parcelas": 3,
                    "bandeira": "MASTERCARD"
                }
            ]
        }
        res_venda_parc = client.post("/api/v1/pdv/vendas", json=payload_venda_parcelado)
        assert res_venda_parc.status_code == 201
        venda_parc = res_venda_parc.json()
        uuid_parc = venda_parc["venda_id_uuid"]

        # Devem existir 3 movimentações parceladas registradas na data da venda (13/06/2026)
        movs_parc = session.exec(
            select(PdvMovimentacao)
            .where(PdvMovimentacao.venda_id == uuid_parc)
            .order_by(PdvMovimentacao.numero_parcela)
        ).all()
        assert len(movs_parc) == 3

        # Data da transação no PDV: 13/06/2026
        assert movs_parc[0].data == date(2026, 6, 13)
        assert movs_parc[1].data == date(2026, 6, 13)
        assert movs_parc[2].data == date(2026, 6, 13)

        for mp in movs_parc:
            assert mp.conciliado == False
            assert mp.bandeira == "MASTERCARD"
            assert mp.forma_pagamento == "CREDITO_PARCELADO"
            assert mp.valor == Decimal("1000.00")

        # --- TESTE D: Agenda de Recebíveis ---
        res_recebiveis = client.get("/api/v1/pdv/recebiveis")
        assert res_recebiveis.status_code == 200
        recebiveis = res_recebiveis.json()
        
        # Deve listar todos os recebíveis de cartão ativos (movimentações + lançamentos agrupados no financeiro)
        assert len(recebiveis) >= 4

        # --- TESTE E: Auto-Match de Conciliação ---
        # Simulamos que recebemos R$ 975,00 no banco Itaú (ref. repasse Visa Credit)
        deposito = Lancamento(
            descricao="Depósito Cielo S.A.",
            tipo="RECEITA",
            status="PAGO",
            origem="EXTRATO",
            valor_previsto=Decimal("975.00"),
            valor_pago=Decimal("975.00"),
            data_vencimento=date(2026, 7, 13),
            data_pagamento=date(2026, 7, 13),
            data_competencia=date(2026, 7, 13),
            empresa_id=1,
            conta_id=1,
            plano_contas_id=10,
            is_deleted=False,
            conciliado=False
        )
        session.add(deposito)
        session.commit()
        session.refresh(deposito)

        # Chamar auto-match
        res_match = client.post(
            f"/api/v1/pdv/conciliacao/auto-match?lancamento_deposito_id={deposito.id}"
        )
        assert res_match.status_code == 200
        suggestions = res_match.json()
        
        # A melhor sugestão deve ser a PdvMovimentacao de Crédito à Vista (líquido R$ 975,00)
        assert len(suggestions) > 0
        melhor_opcao = suggestions[0]
        assert melhor_opcao["valor_liquido"] == 975.00
        assert mov_vista.id in melhor_opcao["lancamentos"]

        # --- TESTE F: Liquidar/Conciliar Lote ---
        # Baixar o recebível da venda à vista (Visa) contra o depósito do extrato
        payload_lote = {
            "data_pagamento": "2026-07-13",
            "conta_destino_id": 1,
            "lancamento_deposito_id": deposito.id,
            "lancamento_ids": [mov_vista.id]
        }
        res_lote = client.post("/api/v1/pdv/conciliacao/lotes", json=payload_lote)
        assert res_lote.status_code == 201
        
        # 1. Verificar se o lote foi salvo no banco
        lote_id = res_lote.json()["id"]
        lote_db = session.get(LoteCartao, lote_id)
        assert lote_db is not None
        assert lote_db.valor_bruto == Decimal("1000.00")
        assert lote_db.valor_taxa == Decimal("25.00")
        assert lote_db.valor_liquido == Decimal("975.00")

        # 2. Verificar se a movimentação foi liquidada e conciliada
        session.refresh(mov_vista)
        assert mov_vista.conciliado is True
        assert mov_vista.conta_id == 1

        # 3. Verificar se a despesa de taxas adquirentes foi gerada e liquidada no dia do recebimento
        lanc_taxa = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == 1,
                Lancamento.tipo == "DESPESA",
                (Lancamento.lote_cartao_id == lote_id) | col(Lancamento.observacao).like(f'%"lote_cartao_id": {lote_id}%')
            )
        ).first()
        assert lanc_taxa is not None
        assert lanc_taxa.lote_cartao_id == lote_id
        assert lanc_taxa.tipo_origem == "PDV_CONCILIACAO_TAXA"
        assert lanc_taxa.valor_previsto == Decimal("25.00")
        assert lanc_taxa.valor_pago == Decimal("25.00")
        assert lanc_taxa.status == "PAGO"
        assert str(lanc_taxa.data_pagamento).startswith("2026-07-13")  # No exato dia do recebimento
        assert lanc_taxa.plano_contas_id == 20
        assert lanc_taxa.conciliado is True

        # 4. Verificar se o depósito do extrato bancário foi conciliado
        session.refresh(deposito)
        assert deposito.status == "PAGO"
        assert deposito.conciliado is True

        # 5. Verificar se a rota /contas/{conta_id}/saldo-detalhe retorna has_lote_card correto
        res_saldo_detalhe = client.get("/api/v1/contas/1/saldo-detalhe")
        assert res_saldo_detalhe.status_code == 200
        saldo_detalhe = res_saldo_detalhe.json()
        movs = saldo_detalhe["movimentos"]
        
        # O deposito (ID do deposito) deve ter has_lote_card = True
        dep_mov = next((m for m in movs if m["id"] == deposito.id), None)
        assert dep_mov is not None
        assert dep_mov["has_lote_card"] is True
        
    finally:
        # Limpar overrides no FastAPI
        app.dependency_overrides.clear()
