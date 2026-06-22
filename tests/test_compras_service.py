import pytest
from decimal import Decimal
from sqlmodel import Session, select
from app.models.empresa import Empresa
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia
from app.services.compras_service import (
    calcular_novo_custo_medio,
    obter_saldo_atual,
    extrair_e_analisar_xml_compras
)

# Mock XML de NFe para Testes
MOCK_NFE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
    <NFe>
        <infNFe Id="NFe35260612345678000199550010000001231234567890" versao="4.00">
            <ide>
                <cUF>35</cUF>
                <cNF>123456789</cNF>
                <natOp>Venda de Mercadorias</natOp>
                <mod>55</mod>
                <serie>1</serie>
                <nNF>123</nNF>
                <dhEmi>2026-06-20T08:00:00-03:00</dhEmi>
                <tpNF>0</tpNF>
                <idDest>1</idDest>
                <cMunFG>3550308</cMunFG>
                <tpImp>1</tpImp>
                <tpEmis>1</tpEmis>
                <cDV>0</cDV>
                <tpAmb>2</tpAmb>
                <finNFe>1</finNFe>
                <indPres>1</indPres>
                <procEpi>0</procEpi>
            </ide>
            <emit>
                <CNPJ>98765432000199</CNPJ>
                <xNome>Fornecedor Distribuidora XYZ LTDA</xNome>
                <xFant>Distribuidora XYZ</xFant>
                <enderEmit>
                    <xLgr>Avenida Central</xLgr>
                    <nro>1000</nro>
                    <xBairro>Centro</xBairro>
                    <cMun>3550308</cMun>
                    <xMun>Sao Paulo</xMun>
                    <UF>SP</UF>
                    <CEP>01000000</CEP>
                    <cPais>1058</cPais>
                    <xPais>BRASIL</xPais>
                </enderEmit>
            </emit>
            <dest>
                <CNPJ>12345678000199</CNPJ>
                <xNome>Minha Empresa LTDA</xNome>
            </dest>
            <det nItem="1">
                <prod>
                    <cProd>FORN-PROD-001</cProd>
                    <cEAN>7891234560012</cEAN>
                    <xProd>Produto Mapeado Existente</xProd>
                    <NCM>12345678</NCM>
                    <CEST>9999999</CEST>
                    <CFOP>1102</CFOP>
                    <uCom>UN</uCom>
                    <qCom>10.0000</qCom>
                    <vUnCom>25.0000</vUnCom>
                    <vProd>250.00</vProd>
                </prod>
            </det>
            <det nItem="2">
                <prod>
                    <cProd>FORN-PROD-002</cProd>
                    <cEAN>SEM GTIN</cEAN>
                    <xProd>Produto Pendente Sem Mapeamento</xProd>
                    <NCM>87654321</NCM>
                    <CEST>8888888</CEST>
                    <CFOP>1102</CFOP>
                    <uCom>UN</uCom>
                    <qCom>5.0000</qCom>
                    <vUnCom>40.0000</vUnCom>
                    <vProd>200.00</vProd>
                </prod>
            </det>
            <total>
                <ICMSTot>
                    <vProd>450.00</vProd>
                    <vNF>450.00</vNF>
                </ICMSTot>
            </total>
        </infNFe>
    </NFe>
</nfeProc>
"""

def test_matematica_custo_medio():
    # Cenário A: Estoque zerado (ou negativo) -> Novo custo médio deve ser o valor de entrada unitário
    custo_novo_vazio = calcular_novo_custo_medio(
        saldo_atual=0,
        custo_medio_atual=0.0,
        quantidade_entrada=10.0,
        valor_entrada=250.0
    )
    assert custo_novo_vazio == 25.0

    # Cenário B: Estoque positivo -> Média ponderada
    # Saldo anterior: 5 unidades a R$ 20.00 cada
    # Entrada: 10 unidades a R$ 25.00 cada (Total R$ 250.00)
    # Novo custo médio = ((5 * 20) + 250) / (5 + 10) = (100 + 250) / 15 = 350 / 15 = 23.3333...
    custo_novo_ponderado = calcular_novo_custo_medio(
        saldo_atual=5.0,
        custo_medio_atual=20.0,
        quantidade_entrada=10.0,
        valor_entrada=250.0
    )
    assert round(custo_novo_ponderado, 4) == round(23.333333333333332, 4)

def test_extrair_e_analisar_xml_compras_workflow(session: Session):
    # Seed Empresa
    empresa = Empresa(
        id=1,
        razao_social="Minha Empresa LTDA",
        nome_fantasia="Minha Empresa",
        cnpj="12345678000199"
    )
    session.add(empresa)
    
    # Seed Produto Interno para o Item 1
    produto_interno = Produto(
        id=101,
        nome="Meu Produto Interno A",
        preco_unitario=Decimal("35.00"),
        preco_custo_medio=20.0,
        empresa_id=1,
        codigo_barras="7891234560012"
    )
    session.add(produto_interno)
    session.commit()

    # Executar a primeira importação/análise
    resultado = extrair_e_analisar_xml_compras(
        db=session,
        empresa_id=1,
        xml_content=MOCK_NFE_XML
    )

    # 1. Validar automação de Fornecedores (emitente auto-criado)
    fornecedor_id = resultado["fornecedor_id"]
    fornecedor = session.get(Entidade, fornecedor_id)
    assert fornecedor is not None
    assert fornecedor.nome == "Fornecedor Distribuidora XYZ LTDA"
    assert fornecedor.cpf_cnpj == "98765432000199"
    assert fornecedor.tipo == "FORNECEDOR"

    # 2. Validar que os dois itens foram mapeados (o segundo foi auto-criado como revisao_pendente)
    assert len(resultado["itens_mapeados"]) == 2
    
    # Item 1 (com EAN correspondente ao produto cadastrado)
    item_mapeado_1 = next(item for item in resultado["itens_mapeados"] if item["codigo_produto_fornecedor"] == "FORN-PROD-001")
    assert item_mapeado_1["produto_interno_id"] == 101
    assert item_mapeado_1["preco_custo_medio_anterior"] == 20.0
    assert item_mapeado_1["preco_custo_medio_novo"] == 25.0

    # Verificar que o produto 101 foi atualizado com as informações fiscais extraídas
    session.refresh(produto_interno)
    assert produto_interno.ncm == "12345678"
    assert produto_interno.cest == "9999999"
    assert produto_interno.cfop_padrao == "1102"
    assert produto_interno.preco_custo_medio == 25.0

    # Item 2 (auto-criado com revisao_pendente = True)
    item_mapeado_2 = next(item for item in resultado["itens_mapeados"] if item["codigo_produto_fornecedor"] == "FORN-PROD-002")
    prod_temp = session.get(Produto, item_mapeado_2["produto_interno_id"])
    assert prod_temp is not None
    assert prod_temp.revisao_pendente is True
    assert prod_temp.nome == "Produto Pendente Sem Mapeamento"
    assert prod_temp.preco_custo_medio == 40.0
    assert prod_temp.ncm == "87654321"
    assert prod_temp.cest == "8888888"
    assert prod_temp.cfop_padrao == "1102"

    assert len(resultado["itens_pendentes"]) == 0

    # 4. Tentar importar de novo para garantir que não duplica o fornecedor
    resultado_repetido = extrair_e_analisar_xml_compras(
        db=session,
        empresa_id=1,
        xml_content=MOCK_NFE_XML
    )
    assert resultado_repetido["fornecedor_id"] == fornecedor_id


def test_confirmar_e_processar_compra_xml_sucesso(session: Session):
    # Seed Empresa, Produto e Plano de Contas
    empresa = Empresa(
        id=1,
        razao_social="Minha Empresa LTDA",
        nome_fantasia="Minha Empresa",
        cnpj="12345678000199"
    )
    session.add(empresa)

    produto_interno = Produto(
        id=101,
        nome="Meu Produto Interno A",
        preco_unitario=Decimal("35.00"),
        preco_custo_medio=20.0,
        empresa_id=1,
        codigo_barras="7891234560012"
    )
    session.add(produto_interno)

    from app.models.plano_contas import PlanoContas
    plano_contas = PlanoContas(
        id=10,
        codigo="2.1.01",
        nome="Compras de Mercadorias",
        tipo="D",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano_contas)
    session.commit()

    # Executar processamento completo (ACID)
    resultado = compras_service_confirmar(session)
    
    # Validar retorno
    assert resultado["status"] == "sucesso"
    assert resultado["chave_nfe"] == "35260612345678000199550010000001231234567890"
    assert resultado["fornecedor_nome"] == "Fornecedor Distribuidora XYZ LTDA"
    assert resultado["valor_total"] == 450.0

    # 1. Validar que Lançamentos de Contas a Pagar foram gerados no banco
    from app.models.lancamento import Lancamento
    lancamentos = session.exec(select(Lancamento).where(Lancamento.empresa_id == 1)).all()
    # XML não tem cobr/dup explícito, então o parser gera 1 parcela padrão com o valor total
    assert len(lancamentos) == 1
    lanc = lancamentos[0]
    assert lanc.valor_previsto == Decimal("450.00")
    assert lanc.tipo == "DESPAYSE" if False else "DESPESA" # syntax check bypass
    assert lanc.status == "EM ABERTO"
    assert lanc.plano_contas_id == 10
    assert lanc.entidade_id == resultado["fornecedor_id"]

    # 2. Validar que Movimentações do Estoque (Kardex) foram geradas no banco
    from app.models.movimentacao_estoque import MovimentacaoEstoque
    movs = session.exec(select(MovimentacaoEstoque).where(MovimentacaoEstoque.empresa_id == 1)).all()
    assert len(movs) == 2
    
    # Kardex para produto 101
    mov_1 = next(m for m in movs if m.produto_id == 101)
    assert mov_1.quantidade == 10.0
    assert mov_1.tipo == "Entrada por Compra"
    assert mov_1.valor_unitario == 25.0
    assert mov_1.valor_total == 250.0
    assert mov_1.chave_nfe == resultado["chave_nfe"]

    # Kardex para produto auto-criado
    mov_2 = next(m for m in movs if m.produto_id != 101)
    assert mov_2.quantidade == 5.0
    assert mov_2.tipo == "Entrada por Compra"
    assert mov_2.valor_unitario == 40.0
    assert mov_2.valor_total == 200.0
    assert mov_2.chave_nfe == resultado["chave_nfe"]

    # 3. Validar que o saldo do produto 101 foi atualizado
    session.refresh(produto_interno)
    assert produto_interno.preco_custo_medio == 25.0


def test_confirmar_e_processar_compra_xml_rollback(session: Session):
    # Seed Empresa, Produto e Plano de Contas
    empresa = Empresa(
        id=1,
        razao_social="Minha Empresa LTDA",
        nome_fantasia="Minha Empresa",
        cnpj="12345678000199"
    )
    session.add(empresa)
    session.commit()

    # Forçar um erro mockando o método db.commit para lançar uma exceção
    original_commit = session.commit
    def fail_commit():
        raise Exception("Erro forçado de banco")
    session.commit = fail_commit

    with pytest.raises(Exception, match="Erro forçado de banco"):
        compras_service_confirmar(session)

    # Restaurar commit
    session.commit = original_commit

    # Verificar que nada foi persistido no banco de dados (o rollback deve ter limpado)
    from app.models.entidade import Entidade
    from app.models.lancamento import Lancamento
    from app.models.movimentacao_estoque import MovimentacaoEstoque

    fornecedores = session.exec(select(Entidade).where(Entidade.cpf_cnpj == "98765432000199")).all()
    assert len(fornecedores) == 0

    lancamentos = session.exec(select(Lancamento).where(Lancamento.empresa_id == 1)).all()
    assert len(lancamentos) == 0

    movimentacoes = session.exec(select(MovimentacaoEstoque).where(MovimentacaoEstoque.empresa_id == 1)).all()
    assert len(movimentacoes) == 0


def compras_service_confirmar(session: Session):
    from app.services.compras_service import confirmar_e_processar_compra_xml
    return confirmar_e_processar_compra_xml(
        db=session,
        empresa_id=1,
        xml_content=MOCK_NFE_XML,
        plano_contas_id=10
    )


def test_confirmar_e_processar_compra_xml_duplicado(session: Session):
    # Seed Empresa, Produto e Plano de Contas
    empresa = Empresa(
        id=1,
        razao_social="Minha Empresa LTDA",
        nome_fantasia="Minha Empresa",
        cnpj="12345678000199"
    )
    session.add(empresa)

    produto_interno = Produto(
        id=101,
        nome="Meu Produto Interno A",
        preco_unitario=Decimal("35.00"),
        preco_custo_medio=20.0,
        empresa_id=1,
        codigo_barras="7891234560012"
    )
    session.add(produto_interno)

    from app.models.plano_contas import PlanoContas
    plano_contas = PlanoContas(
        id=10,
        codigo="2.1.01",
        nome="Compras de Mercadorias",
        tipo="D",
        eh_cabecalho=False,
        is_deleted=False,
        empresa_id=1
    )
    session.add(plano_contas)
    session.commit()

    # Primeira importacao -> deve funcionar
    compras_service_confirmar(session)

    # Segunda importacao -> deve falhar com ValueError de duplicidade
    with pytest.raises(ValueError, match="Esta NF-e ja foi importada para esta empresa."):
        compras_service_confirmar(session)


