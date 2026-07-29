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
from app.models.pdv_movimentacao import PdvMovimentacao

def test_todos_metodos_pagamento_pdv_e_conciliadora(client: TestClient, session: Session):
    """
    Testa rigorosamente a criação de vendas para todas as 5 formas de pagamento:
    1. DINHEIRO
    2. PIX (pix_chave)
    3. CARTÃO DÉBITO (D+1)
    4. CARTÃO CRÉDITO À VISTA (D+30)
    5. CARTÃO CRÉDITO PARCELADO 3X (D+30 pro rata)

    Verifica:
    - PdvMovimentacao.data é a data REAL da venda (para exibição no Movimentação PDV)
    - PdvMovimentacao é gerada para PIX e Dinheiro
    - Agenda de Recebíveis (/api/v1/pdv/recebiveis) e Regras da Conciliadora aplicam os prazos de repasse de cartão (D+1, D+30, Pro-Rata)
    """
    hoje = date(2026, 7, 29)
    empresa_id = 1

    # Seed de dados essenciais
    empresa = Empresa(
        id=empresa_id,
        razao_social="Empresa Teste Geral",
        nome_fantasia="Empresa Teste",
        cnpj="11111111000199",
        pdv_config=json.dumps({
            "categorias": {"cartao_credito_vista": 10, "cartao_credito_parcelado": 10, "cartao_debito": 10, "pix_chave": 10},
            "marcar_como_pago": {"dinheiro": True, "pix_chave": True},
            "contas": {"cartao_credito_vista": "1", "cartao_credito_parcelado": "1", "cartao_debito": "1", "pix_chave": "1"},
            "formas_pagamento": [
                {"key": "dinheiro", "label": "Dinheiro", "parcelada": False},
                {"key": "pix_chave", "label": "PIX", "parcelada": False},
                {"key": "cartao_credito_vista", "label": "Crédito à Vista", "parcelada": False},
                {"key": "cartao_credito_parcelado", "label": "Crédito Parcelado", "parcelada": True},
                {"key": "cartao_debito", "label": "Débito", "parcelada": False}
            ]
        })
    )
    session.add(empresa)
    usuario = Usuario(id=1, nome="Operador Caixa", email="caixa@teste.com", hashed_password="xyz", empresa_id=empresa_id, is_active=True)
    session.add(usuario)
    session.add(Entidade(id=1, empresa_id=empresa_id, tipo="CLIENTE", nome="Consumidor Final", is_deleted=False))
    session.add(CentroCusto(id=1, empresa_id=empresa_id, nome="PDV Loja 1", codigo="CC-01"))
    session.add(PlanoContas(id=10, empresa_id=empresa_id, codigo="1.01", nome="Vendas PDV", tipo="R", permite_lancamentos=True))
    session.add(Conta(id=1, empresa_id=empresa_id, nome="Caixa Principal", tipo="CAIXA", banco="BANCO CAIXA"))
    session.add(Produto(id=1, empresa_id=empresa_id, nome="Produto Teste", preco_unitario=Decimal("100.00")))

    # Criar Regras de Cartão na Conciliadora
    regra_debito = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento="cartao_debito",
        bandeira="VISA",
        dias_payout=1,
        taxa_porcentagem=Decimal("1.50"),
        centro_custo_id=1,
        conta_destino_id=1,
        is_deleted=False
    )
    regra_credito_vista = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento="cartao_credito_vista",
        bandeira="MASTERCARD",
        dias_payout=30,
        taxa_porcentagem=Decimal("2.50"),
        centro_custo_id=1,
        conta_destino_id=1,
        is_deleted=False
    )
    regra_credito_parc = RegraCartao(
        empresa_id=empresa_id,
        tipo_pagamento="cartao_credito_parcelado",
        bandeira="MASTERCARD",
        dias_payout=30,
        modo_parcelamento="PRO_RATA",
        taxa_porcentagem=Decimal("3.50"),
        centro_custo_id=1,
        conta_destino_id=1,
        is_deleted=False
    )
    session.add(regra_debito)
    session.add(regra_credito_vista)
    session.add(regra_credito_parc)
    session.commit()

    # Overrides de auth e DB para o TestClient
    from app.main import app
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: usuario
    app.dependency_overrides[get_current_active_user] = lambda: usuario
    app.dependency_overrides[get_empresa_id_from_user] = lambda: empresa_id

    try:
        # ==========================================
        # 1. TESTE VENDA EM DINHEIRO
        # ==========================================
        payload_dinheiro = {
            "entidade_id": 1, "centro_custo_id": 1, "vendedor_id": 1, "desconto": 0.0, "status": "REALIZADO",
            "data": str(hoje), "data_pagamento": str(hoje),
            "itens": [{"produto_id": 1, "quantidade": 1}],
            "pagamentos": [{"tipo_pagamento": "dinheiro", "valor": 100.0}]
        }
        res_dinh = client.post("/api/v1/pdv/vendas", json=payload_dinheiro)
        assert res_dinh.status_code == 201
        uuid_dinh = res_dinh.json()["venda_id_uuid"]
        session.expire_all()

        mov_dinh = session.exec(select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_dinh)).first()
        assert mov_dinh is not None
        assert mov_dinh.data == hoje
        assert mov_dinh.forma_pagamento == "DINHEIRO"
        assert mov_dinh.valor == Decimal("100.00")

        lanc_dinh = session.exec(select(Lancamento).where(Lancamento.id_parcelamento == uuid_dinh)).first()
        assert lanc_dinh is not None
        assert lanc_dinh.data_vencimento == hoje
        assert lanc_dinh.status == "PAGO"

        # ==========================================
        # 2. TESTE VENDA EM PIX
        # ==========================================
        payload_pix = {
            "entidade_id": 1, "centro_custo_id": 1, "vendedor_id": 1, "desconto": 0.0, "status": "REALIZADO",
            "data": str(hoje), "data_pagamento": str(hoje),
            "itens": [{"produto_id": 1, "quantidade": 2}],
            "pagamentos": [{"tipo_pagamento": "pix_chave", "valor": 200.0}]
        }
        res_pix = client.post("/api/v1/pdv/vendas", json=payload_pix)
        assert res_pix.status_code == 201
        uuid_pix = res_pix.json()["venda_id_uuid"]
        session.expire_all()

        mov_pix = session.exec(select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_pix)).first()
        assert mov_pix is not None, "PdvMovimentacao deve ser criado para vendas em PIX!"
        assert mov_pix.data == hoje
        assert mov_pix.forma_pagamento == "PIX"
        assert mov_pix.valor == Decimal("200.00")

        lanc_pix = session.exec(select(Lancamento).where(Lancamento.id_parcelamento == uuid_pix)).first()
        assert lanc_pix is not None
        assert lanc_pix.data_vencimento == hoje
        assert lanc_pix.status == "PAGO"

        # ==========================================
        # 3. TESTE VENDA EM CARTÃO DÉBITO (D+1)
        # ==========================================
        payload_debito = {
            "entidade_id": 1, "centro_custo_id": 1, "vendedor_id": 1, "desconto": 0.0, "status": "REALIZADO",
            "data": str(hoje), "data_pagamento": str(hoje),
            "itens": [{"produto_id": 1, "quantidade": 3}],
            "pagamentos": [{"tipo_pagamento": "cartao_debito", "valor": 300.0, "bandeira": "VISA"}]
        }
        res_deb = client.post("/api/v1/pdv/vendas", json=payload_debito)
        assert res_deb.status_code == 201
        uuid_deb = res_deb.json()["venda_id_uuid"]
        session.expire_all()

        mov_deb = session.exec(select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_deb)).first()
        assert mov_deb is not None
        assert mov_deb.data == hoje, "Movimentação PDV deve ter a data REAL da venda (29/07)"
        assert mov_deb.forma_pagamento == "DEBITO"
        assert mov_deb.bandeira == "VISA"

        # ==========================================
        # 4. TESTE VENDA EM CRÉDITO À VISTA (D+30)
        # ==========================================
        payload_cred_vista = {
            "entidade_id": 1, "centro_custo_id": 1, "vendedor_id": 1, "desconto": 0.0, "status": "REALIZADO",
            "data": str(hoje), "data_pagamento": str(hoje),
            "itens": [{"produto_id": 1, "quantidade": 5}],
            "pagamentos": [{"tipo_pagamento": "cartao_credito_vista", "valor": 500.0, "bandeira": "MASTERCARD"}]
        }
        res_vista = client.post("/api/v1/pdv/vendas", json=payload_cred_vista)
        assert res_vista.status_code == 201
        uuid_vista = res_vista.json()["venda_id_uuid"]
        session.expire_all()

        mov_vista = session.exec(select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_vista)).first()
        assert mov_vista is not None
        assert mov_vista.data == hoje, "Movimentação PDV deve ter a data REAL da venda (29/07)"
        assert mov_vista.forma_pagamento == "CREDITO_AVISTA"

        # ==========================================
        # 5. TESTE VENDA EM CRÉDITO PARCELADO 3X
        # ==========================================
        payload_parc = {
            "entidade_id": 1, "centro_custo_id": 1, "vendedor_id": 1, "desconto": 0.0, "status": "REALIZADO",
            "data": str(hoje), "data_pagamento": str(hoje),
            "itens": [{"produto_id": 1, "quantidade": 12}],
            "pagamentos": [{"tipo_pagamento": "cartao_credito_parcelado", "valor": 1200.0, "numero_parcelas": 3, "bandeira": "MASTERCARD"}]
        }
        res_parc = client.post("/api/v1/pdv/vendas", json=payload_parc)
        assert res_parc.status_code == 201
        uuid_parc = res_parc.json()["venda_id_uuid"]
        session.expire_all()

        movs_parc = session.exec(select(PdvMovimentacao).where(PdvMovimentacao.venda_id == uuid_parc).order_by(PdvMovimentacao.numero_parcela)).all()
        assert len(movs_parc) == 3
        for m in movs_parc:
            assert m.data == hoje, "Todas as parcelas da movimentação PDV pertencem ao dia da venda (29/07)"
            assert m.forma_pagamento == "CREDITO_PARCELADO"

        # ==========================================
        # 6. TESTE DA AGENDA DE RECEBÍVEIS (/api/v1/pdv/recebiveis)
        # ==========================================
        res_rec = client.get("/api/v1/pdv/recebiveis")
        assert res_rec.status_code == 200
        rec_list = res_rec.json()
        
        # Devem existir 5 recebíveis de cartão (1 débito + 1 crédito à vista + 3 crédito parcelado)
        assert len(rec_list) == 5

        deb_rec = next(r for r in rec_list if r["venda_id_uuid"] == uuid_deb)
        # Débito D+1: 29/07 -> 30/07/2026
        assert deb_rec["data_vencimento"] == "2026-07-30"

        vista_rec = next(r for r in rec_list if r["venda_id_uuid"] == uuid_vista)
        # Crédito à Vista D+30: 29/07 -> 28/08/2026
        assert vista_rec["data_vencimento"] == "2026-08-28"

        parc_recs = sorted([r for r in rec_list if r["venda_id_uuid"] == uuid_parc], key=lambda x: x["numero_parcela"])
        assert len(parc_recs) == 3
        # Parcela 1: 29/07 + 30d = 28/08/2026
        # Parcela 2: 29/08 + 30d = 28/09/2026
        # Parcela 3: 29/09 + 30d = 29/10/2026
        assert parc_recs[0]["data_vencimento"] == "2026-08-28"
        assert parc_recs[1]["data_vencimento"] == "2026-09-28"
        assert parc_recs[2]["data_vencimento"] == "2026-10-29"

    finally:
        app.dependency_overrides.clear()
