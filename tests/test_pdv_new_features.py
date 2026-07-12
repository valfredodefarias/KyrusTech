import pytest
from decimal import Decimal
import json
from datetime import date
from sqlmodel import Session, select

from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.produto import Produto
from app.models.lancamento import Lancamento
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.schemas.pdv import PdvVendaCreate, PdvVendaItemCreate, PdvVendaPagamento
from app.services.pdv_service import PdvService

@pytest.fixture(name="setup_new_features")
def setup_new_features_fixture(session: Session):
  # 1. Seed Empresa with dynamic custom fields configuration
  empresa = Empresa(
    id=2,
    razao_social="Empresa Dynamic LTDA",
    nome_fantasia="Empresa Dynamic",
    cnpj="98765432100019",
    pdv_config=json.dumps({
      "formas_pagamento": [
        {"key": "dinheiro", "label": "Dinheiro", "parcelada": False, "ativa": True}
      ],
      "campos_personalizados": [
        {
          "id": "taxa_entregador",
          "label": "Taxa do Entregador",
          "type": "currency",
          "required": False,
          "planoContasId": 21 # Maps to expense plano contas
        },
        {
          "id": "canal_venda",
          "label": "Canal de Venda",
          "type": "select",
          "required": True,
          "options": ["Ifood", "Site", "Balcao"]
        },
        {
          "id": "cupom_promocional",
          "label": "Cupom Promocional",
          "type": "text",
          "required": False,
          "validation_regex": "^CUPOM_[A-Z0-9]+$"
        }
      ]
    })
  )
  session.add(empresa)
  session.flush()

  # Seed Usuario (Vendedor) for Company 2
  usuario = Usuario(
    id=2,
    nome="Carlos Vendedor",
    email="vendedor2@teste.com",
    hashed_password="fakehashpassword",
    is_active=True,
    is_consultor=False,
    empresa_id=2
  )
  session.add(usuario)
  session.flush()

  # 2. Seed Cliente (Entidade) with observations for Credit Limit (limite_credito: 500)
  cliente = Entidade(
    id=2,
    nome="Cliente Limite Especial",
    tipo="CLIENTE",
    observacoes="Este cliente tem um limite_credito: 500.00 reais para compras a prazo.",
    empresa_id=2
  )
  session.add(cliente)

  # 3. Seed Centro de Custo
  centro = CentroCusto(
    id=2,
    nome="Matriz Dynamic",
    empresa_id=2
  )
  session.add(centro)

  # 4. Seed Plano de Contas (Receita)
  plano_rec = PlanoContas(
    id=11,
    codigo="1.1.02",
    nome="Receitas de Vendas",
    tipo="R",
    eh_cabecalho=False,
    is_deleted=False,
    empresa_id=2
  )
  session.add(plano_rec)

  # 5. Seed Plano de Contas (Despesa para o split)
  plano_desp = PlanoContas(
    id=21,
    codigo="2.1.10",
    nome="Servicos de Terceiros - Entregadores",
    tipo="D",
    eh_cabecalho=False,
    is_deleted=False,
    empresa_id=2
  )
  session.add(plano_desp)

  # 6. Seed Conta
  conta = Conta(
    id=2,
    nome="Banco Brasil",
    tipo="BANCO",
    saldo_inicial=Decimal("0.00"),
    status="ATIVO",
    empresa_id=2
  )
  session.add(conta)

  # 7. Seed Produto (Smart TV with preco_custo_medio=1500)
  produto = Produto(
    id=2,
    nome="Smart TV 55",
    preco_unitario=Decimal("2500.00"),
    tipo="PRODUTO",
    empresa_id=2,
    preco_custo_medio=Decimal("1500.00"),
    is_deleted=False
  )
  session.add(produto)
  session.flush()

  # Seed initial stock level: 10.0 units via stock movement
  seed_estoque = MovimentacaoEstoque(
    empresa_id=2,
    produto_id=2,
    quantidade=10.0,
    tipo="Entrada por Compra",
    valor_unitario=1500.00,
    valor_total=15000.00,
    chave_nfe="seed",
    is_deleted=False
  )
  session.add(seed_estoque)
  session.add(produto)

  session.commit()
  return {
    "empresa": empresa,
    "usuario": usuario,
    "cliente": cliente,
    "centro": centro,
    "plano_rec": plano_rec,
    "plano_desp": plano_desp,
    "conta": conta,
    "produto": produto
  }

def test_pdv_new_features_flow(session: Session, setup_new_features):
  # Try to create a sale validation of required custom fields
  # canal_venda is required, so omitting it or leaving blank should fail
  venda_payload_invalid = PdvVendaCreate(
    entidade_id=2,
    centro_custo_id=2,
    vendedor_id=2,
    desconto=Decimal("0.00"),
    status="REALIZADO",
    data_pagamento="2026-07-11",
    itens=[PdvVendaItemCreate(produto_id=2, quantidade=1, desconto=Decimal("0.00"))],
    pagamentos=[PdvVendaPagamento(tipo_pagamento="dinheiro", valor=Decimal("2500.00"))],
    campos_extras={"taxa_entregador": 15.00} # missing required 'canal_venda'
  )

  with pytest.raises(Exception) as excinfo:
    PdvService.criar_venda(session, venda_payload_invalid, empresa_id=2, current_user_id=2)
  assert "Canal de Venda" in str(excinfo.value)

  # Validate regex constraint on cupom_promocional
  venda_payload_invalid_regex = PdvVendaCreate(
    entidade_id=2,
    centro_custo_id=2,
    vendedor_id=2,
    desconto=Decimal("0.00"),
    status="REALIZADO",
    data_pagamento="2026-07-11",
    itens=[PdvVendaItemCreate(produto_id=2, quantidade=1, desconto=Decimal("0.00"))],
    pagamentos=[PdvVendaPagamento(tipo_pagamento="dinheiro", valor=Decimal("2500.00"))],
    campos_extras={"canal_venda": "Ifood", "cupom_promocional": "CUPOM_INVALID_123_!!!"} # invalid regex
  )
  with pytest.raises(Exception) as excinfo:
    PdvService.criar_venda(session, venda_payload_invalid_regex, empresa_id=2, current_user_id=2)
  assert "Cupom Promocional" in str(excinfo.value)

  # Validate credit limit check
  # Since sale is a prazo (e.g. EM ABERTO status) and value (R$ 2500) exceeds limit (R$ 500) -> should fail
  venda_payload_exceeds_limit = PdvVendaCreate(
    entidade_id=2,
    centro_custo_id=2,
    vendedor_id=2,
    desconto=Decimal("0.00"),
    status="EM ABERTO", # a prazo triggers credit limit check
    data_pagamento="2026-07-11",
    itens=[PdvVendaItemCreate(produto_id=2, quantidade=1, desconto=Decimal("0.00"))],
    pagamentos=[PdvVendaPagamento(tipo_pagamento="a_prazo", valor=Decimal("2500.00"))],
    campos_extras={"canal_venda": "Ifood"}
  )
  with pytest.raises(Exception) as excinfo:
    PdvService.criar_venda(session, venda_payload_exceeds_limit, empresa_id=2, current_user_id=2)
  assert "limite de crédito" in str(excinfo.value).lower()

  # Create a valid sale
  # Standard cash sale with split expense (taxa_entregador = 15.00) and stock deduction
  venda_payload_valid = PdvVendaCreate(
    entidade_id=2,
    centro_custo_id=2,
    vendedor_id=2,
    desconto=Decimal("0.00"),
    status="REALIZADO",
    data_pagamento="2026-07-11",
    itens=[PdvVendaItemCreate(produto_id=2, quantidade=2, desconto=Decimal("0.00"))], # 2 units -> stock goes from 10 to 8
    pagamentos=[PdvVendaPagamento(tipo_pagamento="dinheiro", valor=Decimal("5000.00"))],
    campos_extras={"canal_venda": "Ifood", "taxa_entregador": 15.00}
  )

  venda_grupo = PdvService.criar_venda(session, venda_payload_valid, empresa_id=2, current_user_id=2)
  session.commit()

  assert venda_grupo is not None
  uuid_venda = venda_grupo.venda_id_uuid

  # 1. Verify split expense (DESPESA) was created under same id_parcelamento
  launches = session.exec(
    select(Lancamento).where(Lancamento.id_parcelamento == uuid_venda)
  ).all()
  
  # Should have 1 RECEITA launch and 1 DESPESA launch (split expense)
  receitas = [l for l in launches if l.tipo == "RECEITA"]
  despesas = [l for l in launches if l.tipo == "DESPESA"]
  assert len(receitas) == 1
  assert len(despesas) == 1
  assert despesas[0].valor_previsto == Decimal("15.00")
  assert despesas[0].plano_contas_id == 21

  # 2. Verify automatic stock control created inventory entry
  movements = session.exec(
    select(MovimentacaoEstoque).where(MovimentacaoEstoque.chave_nfe == f"pdv:{uuid_venda}")
  ).all()
  assert len(movements) == 1
  assert movements[0].quantidade == -2 # negative movement for sale
  assert movements[0].produto_id == 2

  # 3. Verify stock balance on product was decremented to 8 (10 initial - 2 sold)
  from sqlalchemy import func
  estoque_total = session.exec(
    select(func.sum(MovimentacaoEstoque.quantidade))
    .where(
      MovimentacaoEstoque.produto_id == 2,
      MovimentacaoEstoque.empresa_id == 2,
      MovimentacaoEstoque.is_deleted == False
    )
  ).first() or 0.0
  assert float(estoque_total) == 8.0

  # 4. Verify PdvVenda and PdvVendaItem operational records
  from app.models.pdv_venda import PdvVenda
  from app.models.pdv_venda_item import PdvVendaItem
  venda_op = session.get(PdvVenda, uuid_venda)
  assert venda_op is not None
  assert venda_op.valor_total == Decimal("5000.00")
  assert venda_op.status == "REALIZADO"
  assert len(venda_op.itens) == 1
  assert venda_op.itens[0].produto_id == 2
  assert venda_op.itens[0].quantidade == Decimal("2.00")
  assert venda_op.itens[0].subtotal == Decimal("5000.00")
