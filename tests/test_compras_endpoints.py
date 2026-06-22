import io
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user, require_permission
from app.models.empresa import Empresa
from app.models.produto import Produto
from app.models.plano_contas import PlanoContas
from tests.test_pdv_conciliacao import setup_db_fixture  # Reutiliza o setup_db do PDV

# Mock do Setup DB
setup_db = setup_db_fixture

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

def test_endpoint_importar_xml_sucesso_parcial(client: TestClient, session: Session, setup_db):
    # Mock do Usuario e Empresa de autenticacao
    def mock_get_current_user():
        user = setup_db["usuario"]
        user.is_consultor = True
        user.consultor_role = "SUPER_CONSULTOR"
        return user

    def mock_get_empresa_id_from_user():
        return 1

    app_dependency_overrides = {
        get_current_user: mock_get_current_user,
        get_current_active_user: mock_get_current_user,
        get_empresa_id_from_user: mock_get_empresa_id_from_user
    }
    
    app.dependency_overrides.update(app_dependency_overrides)

    try:
        # Seed um produto para testar o mapeamento (Item 1 EAN matches barcode)
        produto_interno = Produto(
            id=101,
            nome="Meu Produto Interno A",
            preco_unitario=Decimal("35.00"),
            preco_custo_medio=20.0,
            empresa_id=1,
            codigo_barras="7891234560012"
        )
        session.add(produto_interno)
        
        # Seed Plano de Contas para DESPESA
        plano_contas = PlanoContas(
            id=999,
            codigo="2.1.99",
            nome="Compras de Mercadorias",
            tipo="D",
            eh_cabecalho=False,
            is_deleted=False,
            empresa_id=1
        )
        session.add(plano_contas)
        session.commit()

        # Envia a requisicao multipart form/data com o arquivo XML
        files = {
            "arquivo": ("nfe.xml", io.BytesIO(MOCK_NFE_XML), "text/xml")
        }
        params = {
            "plano_contas_id": 999
        }
        
        response = client.post("/api/v1/compras/importar-xml", files=files, params=params)
        
        # Validar resposta HTTP
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "sucesso"
        assert data["numero_nfe"] == "123"
        assert len(data["itens_mapeados"]) == 2
        assert len(data["itens_pendentes"]) == 0
        
        # Validar banco de dados
        # Fornecedor criado
        from app.models.entidade import Entidade
        forn = session.exec(select(Entidade).where(Entidade.cpf_cnpj == "98765432000199")).first()
        assert forn is not None
        assert forn.nome == "Fornecedor Distribuidora XYZ LTDA"
        
        # Kardex criado para o mapeado
        from app.models.movimentacao_estoque import MovimentacaoEstoque
        movs = session.exec(select(MovimentacaoEstoque).where(MovimentacaoEstoque.produto_id == 101)).all()
        assert len(movs) == 1
        assert movs[0].quantidade == 10.0
        
        # Lancamento financeiro gerado
        from app.models.lancamento import Lancamento
        lancs = session.exec(select(Lancamento).where(Lancamento.empresa_id == 1)).all()
        assert len(lancs) == 1
        assert lancs[0].valor_previsto == Decimal("450.00")

    finally:
        app.dependency_overrides.clear()
