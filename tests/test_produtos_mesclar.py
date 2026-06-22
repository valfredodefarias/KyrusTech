import io
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.models.empresa import Empresa
from app.models.produto import Produto
from app.models.plano_contas import PlanoContas
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia
from tests.test_pdv_conciliacao import setup_db_fixture

setup_db = setup_db_fixture

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

def test_importar_xml_autonomo(client: TestClient, session: Session, setup_db):
    def mock_get_current_user():
        user = setup_db["usuario"]
        user.is_consultor = True
        user.consultor_role = "SUPER_CONSULTOR"
        return user

    def mock_get_empresa_id_from_user():
        return 1

    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_current_active_user] = mock_get_current_user
    app.dependency_overrides[get_empresa_id_from_user] = mock_get_empresa_id_from_user

    try:
        # Seed existing product for Item 1
        produto_existente = Produto(
            id=101,
            nome="Meu Produto Interno A",
            preco_unitario=Decimal("35.00"),
            preco_custo_medio=20.0,
            empresa_id=1,
            codigo_barras="7891234560012"
        )
        session.add(produto_existente)

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

        # Execute autonomous NFe import
        files = {"arquivo": ("nfe.xml", io.BytesIO(MOCK_NFE_XML), "text/xml")}
        response = client.post("/api/v1/compras/importar-xml", files=files, params={"plano_contas_id": 999})

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "sucesso"
        assert len(data["itens_mapeados"]) == 2
        assert len(data["itens_pendentes"]) == 0

        # Verify temporary product creation
        temp_prod = session.exec(
            select(Produto).where(Produto.revisao_pendente == True, Produto.empresa_id == 1)
        ).first()
        assert temp_prod is not None
        assert temp_prod.nome == "Produto Pendente Sem Mapeamento"
        assert temp_prod.preco_custo_medio == 40.0
        assert temp_prod.ncm == "87654321"

        # Verify equivalence pointing to the new temporary product
        equiv = session.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.codigo_produto_fornecedor == "FORN-PROD-002",
                FornecedorProdutoEquivalencia.produto_interno_id == temp_prod.id,
                FornecedorProdutoEquivalencia.is_deleted == False
            )
        ).first()
        assert equiv is not None

        # Verify Kardex entry was created for both products
        movs_exist = session.exec(select(MovimentacaoEstoque).where(MovimentacaoEstoque.produto_id == 101)).all()
        assert len(movs_exist) == 1
        assert movs_exist[0].quantidade == 10.0

        movs_temp = session.exec(select(MovimentacaoEstoque).where(MovimentacaoEstoque.produto_id == temp_prod.id)).all()
        assert len(movs_temp) == 1
        assert movs_temp[0].quantidade == 5.0

    finally:
        app.dependency_overrides.clear()


def test_mesclar_produtos_sucesso(client: TestClient, session: Session, setup_db):
    def mock_get_current_user():
        user = setup_db["usuario"]
        return user

    def mock_get_empresa_id_from_user():
        return 1

    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_current_active_user] = mock_get_current_user
    app.dependency_overrides[get_empresa_id_from_user] = mock_get_empresa_id_from_user

    try:
        # 1. Seed products
        prod_temp = Produto(
            id=201,
            nome="Produto Temp",
            preco_unitario=Decimal("10.00"),
            preco_custo_medio=12.0,
            empresa_id=1,
            revisao_pendente=True,
            is_active=True
        )
        prod_exist = Produto(
            id=202,
            nome="Produto Catalog",
            preco_unitario=Decimal("15.00"),
            preco_custo_medio=10.0,
            empresa_id=1,
            revisao_pendente=False,
            is_active=True
        )
        session.add(prod_temp)
        session.add(prod_exist)

        # 2. Seed supplier equivalence pointing to temp
        equiv = FornecedorProdutoEquivalencia(
            id=501,
            empresa_id=1,
            fornecedor_id=1,
            codigo_produto_fornecedor="TEMP-001",
            produto_interno_id=201
        )
        session.add(equiv)

        # 3. Seed stock movements (Kardex)
        # Existing: 10 units at 10.0 (total 100.0) -> cost 10.0
        mov_exist = MovimentacaoEstoque(
            empresa_id=1,
            produto_id=202,
            quantidade=10.0,
            tipo="Entrada por Compra",
            valor_unitario=10.0,
            valor_total=100.0
        )
        # Temp: 5 units at 16.0 (total 80.0) -> cost should be (100+80)/(10+5) = 180/15 = 12.0
        mov_temp = MovimentacaoEstoque(
            empresa_id=1,
            produto_id=201,
            quantidade=5.0,
            tipo="Entrada por Compra",
            valor_unitario=16.0,
            valor_total=80.0
        )
        session.add(mov_exist)
        session.add(mov_temp)
        session.commit()

        # 4. Request merge
        response = client.post("/api/v1/pdv/produtos/201/mesclar/202")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "sucesso"
        assert data["produto_mesclado"]["id"] == 202
        assert data["produto_mesclado"]["preco_custo_medio"] == 12.0

        # Verify temporary product is soft-deleted
        session.refresh(prod_temp)
        assert prod_temp.is_deleted == True
        assert prod_temp.is_active == False

        # Verify stock movements are transferred
        session.refresh(mov_temp)
        assert mov_temp.produto_id == 202

        # Verify equivalence now points to catalog product
        session.refresh(equiv)
        assert equiv.produto_interno_id == 202
        assert equiv.is_deleted == False

    finally:
        app.dependency_overrides.clear()


def test_mesclar_produtos_rollback_on_failure(client: TestClient, session: Session, setup_db):
    def mock_get_current_user():
        user = setup_db["usuario"]
        return user

    def mock_get_empresa_id_from_user():
        return 1

    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_current_active_user] = mock_get_current_user
    app.dependency_overrides[get_empresa_id_from_user] = mock_get_empresa_id_from_user

    try:
        # Seed products
        prod_temp = Produto(
            id=301,
            nome="Produto Temp Rollback",
            preco_unitario=Decimal("10.00"),
            preco_custo_medio=12.0,
            empresa_id=1,
            revisao_pendente=True,
            is_active=True
        )
        prod_exist = Produto(
            id=302,
            nome="Produto Catalog Rollback",
            preco_unitario=Decimal("15.00"),
            preco_custo_medio=10.0,
            empresa_id=1,
            revisao_pendente=False,
            is_active=True
        )
        session.add(prod_temp)
        session.add(prod_exist)

        equiv = FornecedorProdutoEquivalencia(
            id=601,
            empresa_id=1,
            fornecedor_id=1,
            codigo_produto_fornecedor="TEMP-002",
            produto_interno_id=301
        )
        session.add(equiv)

        mov_temp = MovimentacaoEstoque(
            empresa_id=1,
            produto_id=301,
            quantidade=5.0,
            tipo="Entrada por Compra",
            valor_unitario=16.0,
            valor_total=80.0
        )
        session.add(mov_temp)
        session.commit()

        # Force a database commit error by mocking session.commit
        original_commit = session.commit
        def fail_commit():
            raise Exception("Mock DB Failure")
        session.commit = fail_commit

        # Perform request
        response = client.post("/api/v1/pdv/produtos/301/mesclar/302")
        assert response.status_code == 500
        assert "Erro ao mesclar produtos" in response.json()["detail"]

        # Restore commit
        session.commit = original_commit
        session.rollback()

        # Verify rollback left everything intact
        session.refresh(prod_temp)
        assert prod_temp.is_deleted == False
        assert prod_temp.is_active == True

        session.refresh(mov_temp)
        assert mov_temp.produto_id == 301

        session.refresh(equiv)
        assert equiv.produto_interno_id == 301

    finally:
        app.dependency_overrides.clear()


def test_criar_e_atualizar_produto_revisao_pendente(client: TestClient, session: Session, setup_db):
    def mock_get_current_user():
        return setup_db["usuario"]

    def mock_get_empresa_id_from_user():
        return 1

    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_current_active_user] = mock_get_current_user
    app.dependency_overrides[get_empresa_id_from_user] = mock_get_empresa_id_from_user

    try:
        # 1. Create a product with revisao_pendente=True
        response = client.post("/api/v1/pdv/produtos", json={
            "nome": "Produto Teste Revisa",
            "preco_unitario": "25.50",
            "tipo": "PRODUTO",
            "revisao_pendente": True
        })
        assert response.status_code == 201
        data = response.json()
        produto_id = data["id"]
        assert data["revisao_pendente"] is True

        # Verify in DB
        prod_db = session.get(Produto, produto_id)
        assert prod_db is not None
        assert prod_db.revisao_pendente is True

        # 2. Update the product to clear revisao_pendente (revisao_pendente=False)
        response = client.put(f"/api/v1/pdv/produtos/{produto_id}", json={
            "revisao_pendente": False
        })
        assert response.status_code == 200
        data_update = response.json()
        assert data_update["revisao_pendente"] is False

        # Verify in DB again
        session.expire(prod_db)
        prod_db_after = session.get(Produto, produto_id)
        assert prod_db_after.revisao_pendente is False

    finally:
        app.dependency_overrides.clear()

