# scripts/import_legacy_nfe_items.py
import os
import sys
import argparse
from pathlib import Path
from sqlmodel import Session, select

# Add root dir to sys path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import engine
from app.services.importacao_nfe_service import parse_nfe_xml
from app.services.compras_service import (
    extrair_e_processar_fornecedor,
    processar_itens_xml_compras,
)
from app.models.movimentacao_estoque import MovimentacaoEstoque

EMPRESA_ID = 27  # Rosario Belem

def parse_args():
    parser = argparse.ArgumentParser(description="Importar itens e estoque de XMLs de NF-e legadas SEM alterar o financeiro")
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
    print(f"Valor Total XML: R$ {nfe_doc.valor_total:.2f}")

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
        print(f"Aviso: Itens de estoque para a NF-e {numero_nfe} já foram importados anteriormente. Pulando.")
        return True
    
    # 2. Obter ou criar fornecedor (necessário para a equivalência de De/Para)
    fornecedor = extrair_e_processar_fornecedor(db, EMPRESA_ID, nfe_doc)
    
    # 3. Processar itens (mapeamento De/Para, impostos e custo médio)
    relatorio_itens = processar_itens_xml_compras(
        db=db,
        empresa_id=EMPRESA_ID,
        fornecedor_id=fornecedor.id,
        itens_xml=nfe_doc.itens
    )
    
    print(f"Itens mapeados com sucesso: {len(relatorio_itens['itens_mapeados'])}")
    for item in relatorio_itens["itens_mapeados"]:
        print(f"  - Produto: {item['produto_interno_name']} (Qtd: {item['quantidade']} | Cust. Méd. Anterior: R$ {item['preco_custo_medio_anterior']:.2f} -> Novo: R$ {item['preco_custo_medio_novo']:.2f})")
        
    if relatorio_itens["itens_pendentes"]:
        print(f"Aviso: {len(relatorio_itens['itens_pendentes'])} itens criados com revisão pendente no painel.")

    # 4. Criar movimentações de estoque (Kardex) se ainda não existirem
    if not dry_run:
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
        db.commit()
        print("Movimentações de estoque registradas com sucesso no banco de dados.")
    else:
        print("[DRY RUN] Simulação concluída. Nenhuma movimentação de estoque foi gravada.")

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
        
    print(f"Encontrados {len(xml_files)} arquivos XML para processamento de estoque.")
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
