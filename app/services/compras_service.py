from __future__ import annotations

# app/services/compras_service.py
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional
from sqlmodel import Session, select
from app.services.importacao_nfe_service import parse_nfe_xml, NFeDocumento, NFeItem
from app.models.entidade import Entidade
from app.models.produto import Produto
from app.models.fornecedor_produto_equivalencia import FornecedorProdutoEquivalencia
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.lancamento import Lancamento

logger = logging.getLogger(__name__)

def calcular_novo_custo_medio(
    saldo_atual: float,
    custo_medio_atual: float,
    quantidade_entrada: float,
    valor_entrada: float
) -> float:
    """
    Calcula o custo médio ponderado de um produto após uma entrada de estoque.
    """
    if saldo_atual <= 0:
        if quantidade_entrada > 0:
            return float(valor_entrada / quantidade_entrada)
        return 0.0

    total_valor_antigo = saldo_atual * custo_medio_atual
    total_valor_novo = total_valor_antigo + valor_entrada
    total_quantidade_nova = saldo_atual + quantidade_entrada

    if total_quantidade_nova <= 0:
        return custo_medio_atual

    return float(total_valor_novo / total_quantidade_nova)


def obter_saldo_atual(db: Session, produto_id: int, empresa_id: int) -> float:
    """
    Obtém o saldo atual do estoque para um produto através da soma das quantidades do Kardex.
    """
    from sqlalchemy import func
    saldo = db.exec(
        select(func.sum(MovimentacaoEstoque.quantidade))
        .where(
            MovimentacaoEstoque.produto_id == produto_id,
            MovimentacaoEstoque.empresa_id == empresa_id,
            MovimentacaoEstoque.is_deleted == False
        )
    ).one_or_none()
    return float(saldo or 0.0)


def extrair_e_processar_fornecedor(db: Session, empresa_id: int, nfe_doc: NFeDocumento) -> Entidade:
    """
    Busca o fornecedor pelo CNPJ/CPF no banco de dados (filtrando por empresa_id).
    Se não existir, cria-o automaticamente.
    """
    cnpj_cpf = nfe_doc.emitente_documento
    
    # Busca fornecedor existente
    fornecedor = db.exec(
        select(Entidade)
        .where(
            Entidade.empresa_id == empresa_id,
            Entidade.cpf_cnpj == cnpj_cpf,
            Entidade.is_deleted == False
        )
    ).first()
    
    if not fornecedor:
        tipo_pessoa = "PJ" if len(cnpj_cpf) == 14 else "PF"
        fornecedor = Entidade(
            nome=nfe_doc.emitente_nome,
            nome_fantasia=nfe_doc.emitente_nome_fantasia or nfe_doc.emitente_nome,
            tipo="FORNECEDOR",
            tipo_pessoa=tipo_pessoa,
            cpf_cnpj=cnpj_cpf,
            cep=nfe_doc.emitente_cep or None,
            logradouro=nfe_doc.emitente_logradouro or None,
            numero=nfe_doc.emitente_numero or None,
            complemento=nfe_doc.emitente_complemento or None,
            bairro=nfe_doc.emitente_bairro or None,
            cidade=nfe_doc.emitente_cidade or None,
            uf=nfe_doc.emitente_uf or None,
            telefone=nfe_doc.emitente_telefone or None,
            empresa_id=empresa_id,
            status="ATIVO"
        )
        db.add(fornecedor)
        db.flush()
        logger.info(
            f"[NFE COMPRAS] Fornecedor auto-criado: CNPJ={cnpj_cpf}, ID={fornecedor.id}, empresa_id={empresa_id}"
        )
        
    return fornecedor


def processar_itens_xml_compras(
    db: Session,
    empresa_id: int,
    fornecedor_id: int,
    itens_xml: List[NFeItem]
) -> Dict[str, Any]:
    """
    Analisa os itens do XML de compras.
    Associa cada item a um produto interno do ERP via tabela De/Para ou código de barras.
    Se não associado, cria automaticamente um produto temporário (revisao_pendente = True)
    e sua equivalência. Atualiza as informações fiscais e recalcula o custo médio.
    """
    itens_mapeados = []
    itens_pendentes = []
    
    for item in itens_xml:
        produto_interno: Optional[Produto] = None
        
        # 1. Tenta buscar pela tabela de equivalência (De/Para)
        equivalencia = db.exec(
            select(FornecedorProdutoEquivalencia)
            .where(
                FornecedorProdutoEquivalencia.empresa_id == empresa_id,
                FornecedorProdutoEquivalencia.fornecedor_id == fornecedor_id,
                FornecedorProdutoEquivalencia.codigo_produto_fornecedor == item.c_prod,
                FornecedorProdutoEquivalencia.is_deleted == False
            )
        ).first()
        
        if equivalencia:
            produto_interno = db.get(Produto, equivalencia.produto_interno_id)
            
        # 2. Se não achou na equivalência, tenta buscar pelo código de barras (se houver)
        if not produto_interno and item.c_ean and item.c_ean.strip() and item.c_ean.upper() != "SEM GTIN":
            produto_interno = db.exec(
                select(Produto)
                .where(
                    Produto.empresa_id == empresa_id,
                    Produto.codigo_barras == item.c_ean.strip(),
                    Produto.is_deleted == False
                )
            ).first()
            
        if not produto_interno:
            # Produto não encontrado/não mapeado. Cria um produto temporário
            codigo_barras_limpo = item.c_ean.strip() if (item.c_ean and item.c_ean.strip() and item.c_ean.upper() != "SEM GTIN") else None
            
            # Evita duplicar produtos com o mesmo código de barras
            if codigo_barras_limpo:
                produto_interno = db.exec(
                    select(Produto)
                    .where(
                        Produto.empresa_id == empresa_id,
                        Produto.codigo_barras == codigo_barras_limpo,
                        Produto.is_deleted == False
                    )
                ).first()
                
            if not produto_interno:
                produto_interno = Produto(
                    nome=item.descricao,
                    preco_unitario=Decimal(str(item.valor_unitario)), # placeholder
                    empresa_id=empresa_id,
                    tipo="PRODUTO",
                    codigo_barras=codigo_barras_limpo,
                    preco_custo_medio=float(item.valor_unitario),
                    ncm=item.ncm,
                    cest=item.cest,
                    cfop_padrao=item.cfop,
                    revisao_pendente=True,
                    is_active=True
                )
                db.add(produto_interno)
                db.flush()
                
            # Cria a equivalência
            equivalencia = FornecedorProdutoEquivalencia(
                empresa_id=empresa_id,
                fornecedor_id=fornecedor_id,
                codigo_produto_fornecedor=item.c_prod,
                produto_interno_id=produto_interno.id
            )
            db.add(equivalencia)
            db.flush()
            
        if produto_interno:
            # Produto encontrado/criado! Atualiza as informações fiscais
            if item.ncm:
                produto_interno.ncm = item.ncm
            if item.cest:
                produto_interno.cest = item.cest
            if item.cfop:
                produto_interno.cfop_padrao = item.cfop
                
            # Calcula o novo Custo Médio Ponderado
            saldo_atual = obter_saldo_atual(db, produto_interno.id, empresa_id)
            custo_medio_atual = produto_interno.preco_custo_medio or 0.0
            
            novo_custo_medio = calcular_novo_custo_medio(
                saldo_atual=saldo_atual,
                custo_medio_atual=custo_medio_atual,
                quantidade_entrada=float(item.quantidade),
                valor_entrada=float(item.valor_total)
            )
            
            produto_interno.preco_custo_medio = novo_custo_medio
            db.add(produto_interno)
            
            itens_mapeados.append({
                "codigo_produto_fornecedor": item.c_prod,
                "descricao_fornecedor": item.descricao,
                "produto_interno_id": produto_interno.id,
                "produto_interno_nome": produto_interno.nome,
                "quantidade": float(item.quantidade),
                "valor_unitario": float(item.valor_unitario),
                "valor_total": float(item.valor_total),
                "preco_custo_medio_anterior": custo_medio_atual,
                "preco_custo_medio_novo": novo_custo_medio
            })
            
    return {
        "itens_mapeados": itens_mapeados,
        "itens_pendentes": itens_pendentes
    }


def extrair_e_analisar_xml_compras(
    db: Session,
    empresa_id: int,
    xml_content: bytes
) -> Dict[str, Any]:
    """
    Executa o fluxo completo do Passo 2 para um XML de compra.
    """
    nfe_doc = parse_nfe_xml(xml_content)
    fornecedor = extrair_e_processar_fornecedor(db, empresa_id, nfe_doc)
    relatorio_itens = processar_itens_xml_compras(
        db=db,
        empresa_id=empresa_id,
        fornecedor_id=fornecedor.id,
        itens_xml=nfe_doc.itens
    )
    
    return {
        "chave_nfe": nfe_doc.chave_nfe,
        "numero_nfe": nfe_doc.numero_nfe,
        "fornecedor_id": fornecedor.id,
        "fornecedor_nome": fornecedor.nome,
        "fornecedor_cnpj": fornecedor.cpf_cnpj,
        "valor_total": float(nfe_doc.valor_total),
        "itens_mapeados": relatorio_itens["itens_mapeados"],
        "itens_pendentes": relatorio_itens["itens_pendentes"]
    }


def confirmar_e_processar_compra_xml(
    db: Session,
    empresa_id: int,
    xml_content: bytes,
    plano_contas_id: Optional[int] = None,
    centro_custo_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Processa a nota fiscal de compras de forma transacional (ACID).
    Garante o rollback em caso de erro crítico.
    Retorna sucesso parcial se houver itens pendentes de mapeamento.
    """
    try:
        # 1. Parse do XML
        nfe_doc = parse_nfe_xml(xml_content)
        
        # 1b. Evita duplicidade de importacao de NFe
        parcela_group_id = f"NFE-{nfe_doc.chave_nfe}"
        existente = db.exec(
            select(Lancamento.id).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.id_parcelamento == parcela_group_id,
                Lancamento.is_deleted == False,
            )
        ).first()
        if existente:
            raise ValueError("Esta NF-e ja foi importada para esta empresa.")
        
        # 2. Fornecedor automatico
        fornecedor = extrair_e_processar_fornecedor(db, empresa_id, nfe_doc)
        
        # 3. Análise de Itens (De/Para + Fiscal + Custo Médio)
        relatorio_itens = processar_itens_xml_compras(
            db=db,
            empresa_id=empresa_id,
            fornecedor_id=fornecedor.id,
            itens_xml=nfe_doc.itens
        )
        
        # 4. Kardex (Auditoria de Estoque)
        # Registra no estoque apenas os itens que foram mapeados com sucesso
        movimentacoes_criadas = []
        for item_map in relatorio_itens["itens_mapeados"]:
            movimentacao = MovimentacaoEstoque(
                empresa_id=empresa_id,
                produto_id=item_map["produto_interno_id"],
                quantidade=item_map["quantidade"],
                tipo="Entrada por Compra",
                valor_unitario=item_map["valor_unitario"],
                valor_total=item_map["valor_total"],
                chave_nfe=nfe_doc.chave_nfe
            )
            db.add(movimentacao)
            movimentacoes_criadas.append(movimentacao)
            
        # 5. Contas a Pagar (Financeiro)
        # Extrai tags de cobrança (<cobr> e <dup>) e gera os lançamentos
        lancamentos_criados = []
        total_parcelas = len(nfe_doc.parcelas)
        
        # Se não tiver plano_contas_id informado, tenta buscar uma despesa padrão
        if not plano_contas_id:
            from app.models.plano_contas import PlanoContas
            fallback_pc = db.exec(
                select(PlanoContas)
                .where(
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.tipo == "D",
                    PlanoContas.is_deleted == False
                )
            ).first()
            if fallback_pc:
                plano_contas_id = fallback_pc.id
            else:
                plano_contas_id = 10  # Fallback de teste
                
        for parcela in nfe_doc.parcelas:
            import_hash = f"NFE-COMPRA-{nfe_doc.chave_nfe}-{parcela.index}"
            
            # Evita duplicidade de lançamentos
            lancamento_existente = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == empresa_id,
                    Lancamento.import_hash == import_hash,
                    Lancamento.is_deleted == False
                )
            ).first()
            
            if not lancamento_existente:
                data_competencia = nfe_doc.data_emissao
                competencia = data_competencia.strftime("%m-%Y")
                
                lancamento = Lancamento(
                    descricao=f"Compra NF-e {nfe_doc.numero_nfe} - Parcela {parcela.numero_label}/{total_parcelas}",
                    tipo="DESPESA",
                    status="EM ABERTO",
                    origem="NFE_XML",
                    previsto=True,
                    valor_previsto=parcela.valor,
                    valor_pago=Decimal("0.00"),
                    data_vencimento=parcela.data_vencimento,
                    data_competencia=data_competencia,
                    competencia=competencia,
                    numero_parcela=parcela.index,
                    id_parcelamento=f"NFE-{nfe_doc.chave_nfe}",
                    import_hash=import_hash,
                    empresa_id=empresa_id,
                    plano_contas_id=plano_contas_id,
                    entidade_id=fornecedor.id,
                    centro_custo_id=centro_custo_id
                )
                db.add(lancamento)
                lancamentos_criados.append(lancamento)
                
        # 6. Efetivar transação
        db.commit()
        
        # Refresh para retornar os IDs
        for m in movimentacoes_criadas:
            db.refresh(m)
        for l in lancamentos_criados:
            db.refresh(l)
            
        return {
            "status": "sucesso" if not relatorio_itens["itens_pendentes"] else "sucesso_parcial",
            "chave_nfe": nfe_doc.chave_nfe,
            "numero_nfe": nfe_doc.numero_nfe,
            "fornecedor_id": fornecedor.id,
            "fornecedor_nome": fornecedor.nome,
            "valor_total": float(nfe_doc.valor_total),
            "lancamentos_criados": [l.id for l in lancamentos_criados],
            "movimentacoes_estoque_criadas": [m.id for m in movimentacoes_criadas],
            "itens_mapeados": relatorio_itens["itens_mapeados"],
            "itens_pendentes": relatorio_itens["itens_pendentes"]
        }
    except Exception as exc:
        db.rollback()
        logger.exception(f"[NFE COMPRAS] Erro critico no processamento. Rollback efetuado. Erro: {str(exc)}")
        raise exc
