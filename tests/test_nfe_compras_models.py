import pytest
from decimal import Decimal
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError
from app.models.empresa import Empresa
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia

def test_produto_new_fields(session: Session):
    # Seed Empresa
    empresa = Empresa(
        id=1,
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste",
        cnpj="12345678000199"
    )
    session.add(empresa)
    session.commit()

    # Criar Produto com os novos campos
    produto = Produto(
        nome="Produto Teste",
        preco_unitario=Decimal("50.00"),
        empresa_id=1,
        codigo_barras="7891234567890",
        imagem_url="http://localhost/images/prod_teste.png",
        preco_custo_medio=35.50,
        ncm="8517.12.31",
        cest="21.053.00",
        cfop_padrao="5102"
    )
    session.add(produto)
    session.commit()
    session.refresh(produto)

    # Validar campos salvos
    assert produto.codigo_barras == "7891234567890"
    assert produto.imagem_url == "http://localhost/images/prod_teste.png"
    assert produto.preco_custo_medio == 35.50
    assert produto.ncm == "8517.12.31"
    assert produto.cest == "21.053.00"
    assert produto.cfop_padrao == "5102"

    # Testar unicidade do código de barras
    duplicate_produto = Produto(
        nome="Produto Duplicado",
        preco_unitario=Decimal("60.00"),
        empresa_id=1,
        codigo_barras="7891234567890"
    )
    session.add(duplicate_produto)
    with pytest.raises(IntegrityError):
        session.commit()

def test_fornecedor_produto_equivalencia_creation_and_constraints(session: Session):
    # Seed Empresa, Fornecedor (Entidade) e Produto
    empresa = Empresa(
        id=1,
        razao_social="Empresa Teste LTDA",
        nome_fantasia="Empresa Teste",
        cnpj="12345678000199"
    )
    session.add(empresa)
    
    fornecedor = Entidade(
        id=1,
        nome="Fornecedor Parcial",
        tipo="FORNECEDOR",
        empresa_id=1
    )
    session.add(fornecedor)
    
    produto = Produto(
        id=1,
        nome="Produto Interno A",
        preco_unitario=Decimal("100.00"),
        empresa_id=1
    )
    session.add(produto)
    session.commit()

    # Criar Equivalência
    equivalencia = FornecedorProdutoEquivalencia(
        empresa_id=1,
        fornecedor_id=1,
        codigo_produto_fornecedor="FORN-COD-999",
        produto_interno_id=1
    )
    session.add(equivalencia)
    session.commit()
    session.refresh(equivalencia)

    # Validar campos da Equivalência
    assert equivalencia.empresa_id == 1
    assert equivalencia.fornecedor_id == 1
    assert equivalencia.codigo_produto_fornecedor == "FORN-COD-999"
    assert equivalencia.produto_interno_id == 1
    assert equivalencia.created_at is not None

    # Testar UniqueConstraint: (empresa_id, fornecedor_id, codigo_produto_fornecedor)
    dup_equivalencia = FornecedorProdutoEquivalencia(
        empresa_id=1,
        fornecedor_id=1,
        codigo_produto_fornecedor="FORN-COD-999",
        produto_interno_id=1
    )
    session.add(dup_equivalencia)
    with pytest.raises(IntegrityError):
        session.commit()
