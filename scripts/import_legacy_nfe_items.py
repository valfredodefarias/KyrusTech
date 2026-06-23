# scripts/import_legacy_nfe_items.py
import os
import sys
import argparse
from pathlib import Path
from decimal import Decimal
from sqlmodel import Session, select, or_

# Add root dir to sys path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import engine
from app.services.importacao_nfe_service import parse_nfe_xml, NFeDocumento
from app.services.compras_service import (
    extrair_e_processar_fornecedor,
    processar_itens_xml_compras,
)
from app.models.lancamento import Lancamento
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas

EMPRESA_ID = 27  # Rosario Belem

def parse_args():
    parser = argparse.ArgumentParser(description="Importar itens e estoque de XMLs de NF-e legadas vinculando ao financeiro existente")
    parser.add_argument("directory", help="Diretório contendo os arquivos XML das Notas Fiscais")
    parser.add_argument("--dry-run", action="store_true", help="Simular importação sem salvar no banco de dados")
    return parser.parse_args()

def process_single_xml(db: Session, xml_path: Path, dry_run: bool = False):
    print(f"\n----------------------------------------")
    print(f"Processando arquivo: {xml_path.name}")
    
    with open(xml_path, "rb") as f:
        xml_content = f.read()
        
    try:
        nfe_doc = parse_nfe_xml(xml_content)
    except Exception as e:
        print(f"Erro ao parsear XML: {e}")
        return False

    chave = nfe_doc.chave_nfe
    numero_nfe = nfe_doc.numero_nfe
    print(f"NF-e: {numero_nfe} | Chave: {chave}")
    print(f"Fornecedor: {nfe_doc.emitente_nome} (CNPJ/CPF: {nfe_doc.emitente_documento})")
    print(f"Valor Total: R$ {nfe_doc.valor_total:.2f}")

    # 1. Verificar se o estoque para esta chave já foi importado
    estoque_existente = db.exec(
        select(MovimentacaoEstoque.id)
        .where(
            MovimentacaoEstoque.empresa_id == EMPRESA_ID,
            MovimentacaoEstoque.chave_nfe == chave,
            MovimentacaoEstoque.is_deleted == False
        )
    ).first()
    
    if estoque_existente:
        print(f"Aviso: Itens de estoque para a NF-e {numero_nfe} já foram importados anteriormente.")
        # Mesmo se o estoque já foi importado, vamos tentar verificar/vincular o financeiro caso falte
    
    # 2. Obter ou criar fornecedor
    fornecedor = extrair_e_processar_fornecedor(db, EMPRESA_ID, nfe_doc)
    
    # 3. Processar itens (mapeamento De/Para, impostos e custo médio)
    relatorio_itens = processar_itens_xml_compras(
        db=db,
        empresa_id=EMPRESA_ID,
        fornecedor_id=fornecedor.id,
        itens_xml=nfe_doc.itens
    )
    
    print(f"Itens mapeados com sucesso: {len(relatorio_itens['itens_mapeados'])}")
    if relatorio_itens["itens_pendentes"]:
        print(f"Aviso: {len(relatorio_itens['itens_pendentes'])} itens criados com revisão pendente.")

    # 4. Criar movimentações de estoque (Kardex) se ainda não existirem
    if not estoque_existente and not dry_run:
        for item_map in relatorio_itens["itens_mapeados"]:
            movimentacao = MovimentacaoEstoque(
                empresa_id=EMPRESA_ID,
                produto_id=item_map["produto_interno_id"],
                quantidade=item_map["quantidade"],
                tipo="Entrada por Compra",
                valor_unitario=item_map["valor_unitario"],
                valor_total=item_map["valor_total"],
                chave_nfe=chave
            )
            db.add(movimentacao)
        print("Movimentações de estoque registradas com sucesso.")

    # 5. Conciliar/Vincular com o Financeiro Existente
    parcela_group_id = f"NFE-{chave}"
    total_parcelas = len(nfe_doc.parcelas)
    
    # Buscar todos os lançamentos de despesa abertos/pagos do fornecedor
    lancamentos_fornecedor = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == EMPRESA_ID,
            Lancamento.entidade_id == fornecedor.id,
            Lancamento.tipo == "DESPESA",
            Lancamento.is_deleted == False
        )
    ).all()

    # Tenta achar um plano de contas padrão para compras de mercadorias/insumos
    fallback_pc = db.exec(
        select(PlanoContas)
        .where(
            PlanoContas.empresa_id == EMPRESA_ID,
            PlanoContas.tipo == "D",
            PlanoContas.is_deleted == False
        )
    ).first()
    plano_contas_id = fallback_pc.id if fallback_pc else 10

    for idx, parcela in enumerate(nfe_doc.parcelas):
        import_hash = f"NFE-COMPRA-{chave}-{parcela.index}"
        
        # Verificar se já existe um lançamento com o import_hash ou id_parcelamento exato
        lancamento_vinculado = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == EMPRESA_ID,
                or_(
                    Lancamento.import_hash == import_hash,
                    (Lancamento.id_parcelamento == parcela_group_id) & (Lancamento.numero_parcela == parcela.index)
                ),
                Lancamento.is_deleted == False
            )
        ).first()

        if lancamento_vinculado:
            print(f"Parcela {parcela.index}/{total_parcelas} (R$ {parcela.valor:.2f}): Já vinculada ao Lançamento ID {lancamento_vinculado.id}.")
            continue

        # Se não houver vínculo exato por hash/id_parcelamento, tenta buscar por heurística no financeiro existente:
        # Busca por mesmo valor e data de vencimento próxima (tolerância de 5 dias)
        match_candidato = None
        for l in lancamentos_fornecedor:
            # Pula se o lançamento já estiver vinculado a outra NFe
            if l.id_parcelamento and l.id_parcelamento.startswith("NFE-") and l.id_parcelamento != parcela_group_id:
                continue
                
            valor_ok = abs(l.valor_previsto - parcela.valor) < Decimal("0.02") or abs(l.valor_pago - parcela.valor) < Decimal("0.02")
            data_ok = abs((l.data_vencimento - parcela.data_vencimento).days) <= 5
            
            # Se a descrição contiver o número da NFe, aumenta muito a certeza
            num_nfe_no_titulo = numero_nfe in (l.descricao or "") or numero_nfe in (l.observacao or "")
            
            if valor_ok and (data_ok or num_nfe_no_titulo):
                match_candidato = l
                break

        if match_candidato:
            print(f"Parcela {parcela.index}/{total_parcelas} (R$ {parcela.valor:.2f}): Vinculando ao Lançamento Existente ID {match_candidato.id} ('{match_candidato.descricao}')")
            if not dry_run:
                match_candidato.id_parcelamento = parcela_group_id
                match_candidato.import_hash = import_hash
                match_candidato.numero_parcela = parcela.index
                # Atualiza com as informações da nota se estiver sem
                if not match_candidato.competencia:
                    match_candidato.data_competencia = nfe_doc.data_emissao
                    match_candidato.competencia = nfe_doc.data_emissao.strftime("%m-%Y")
                db.add(match_candidato)
        else:
            # Se não achou candidato compatível, cria um lançamento novo para a parcela
            print(f"Parcela {parcela.index}/{total_parcelas} (R$ {parcela.valor:.2f}): Nenhum lançamento compatível encontrado. Criando novo no financeiro.")
            if not dry_run:
                data_competencia = nfe_doc.data_emissao
                competencia = data_competencia.strftime("%m-%Y")
                
                novo_lancamento = Lancamento(
                    descricao=f"Compra NF-e {numero_nfe} - Parcela {parcela.numero_label}/{total_parcelas}",
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
                    id_parcelamento=parcela_group_id,
                    import_hash=import_hash,
                    empresa_id=EMPRESA_ID,
                    plano_contas_id=plano_contas_id,
                    entidade_id=fornecedor.id
                )
                db.add(novo_lancamento)

    if not dry_run:
        db.commit()
    print(f"Sucesso!")
    return True

def main():
    args = parse_args()
    xml_dir = Path(args.directory)
    
    if not xml_dir.is_dir():
        print(f"Erro: O diretório '{args.directory}' não existe ou não é um diretório válido.")
        sys.exit(1)
        
    xml_files = list(xml_dir.glob("*.xml")) + list(xml_dir.glob("*.XML"))
    if not xml_files:
        print(f"Nenhum arquivo XML encontrado no diretório: {xml_dir.resolve()}")
        sys.exit(0)
        
    print(f"Encontrados {len(xml_files)} arquivos XML para processamento.")
    if args.dry_run:
        print("AVISO: Modo DRY RUN ativo. Nenhuma alteração será salva no banco de dados.")

    sucessos = 0
    with Session(engine) as db:
        for xml_file in xml_files:
            try:
                if process_single_xml(db, xml_file, dry_run=args.dry_run):
                    sucessos += 1
            except Exception as e:
                print(f"Falha ao processar {xml_file.name}: {e}")
                db.rollback()
                
    print("\n========================================")
    print(f"Processamento concluído. Sucesso: {sucessos}/{len(xml_files)}")
    print("========================================")

if __name__ == "__main__":
    main()
