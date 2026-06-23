# scripts/import_legacy_database_items.py
import os
import sys
import argparse
import base64
import json
import re
from datetime import datetime, time
from decimal import Decimal
from sqlmodel import Session, select, col

# Add root dir to sys path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.produto import Produto
from app.models.movimentacao_estoque import MovimentacaoEstoque
from app.services.compras_service import calcular_novo_custo_medio, obter_saldo_atual

def decode_itens_meta(token: str) -> list[dict]:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        return []

def normalize_prod_name(name: str) -> str:
    import unicodedata
    n = unicodedata.normalize("NFKD", name.strip().lower())
    return "".join(c for c in n if not unicodedata.combining(c))

def parse_args():
    parser = argparse.ArgumentParser(description="Importar itens e estoque do legado das observações sem mexer no financeiro")
    parser.add_argument("--dry-run", action="store_true", help="Simular importação sem salvar no banco de dados")
    return parser.parse_args()

def main():
    args = parse_args()
    dry_run = args.dry_run

    if dry_run:
        print("=" * 60)
        print("ATENÇÃO: MODO DRY RUN ATIVO. Nenhuma alteração será salva no banco.")
        print("=" * 60)

    db = Session(engine)

    # 1. Fetch lancamentos containing ItensMeta
    lancamentos = db.exec(
        select(Lancamento)
        .where(
            Lancamento.observacao.like("%ItensMeta%"),
            Lancamento.is_deleted == False
        )
        .order_by(Lancamento.id_parcelamento, Lancamento.id)
    ).all()

    print(f"Total de lançamentos encontrados com ItensMeta: {len(lancamentos)}")

    # Caches
    # (empresa_id, normalized_name) -> Produto
    product_cache = {}
    
    # Populate cache with existing active products
    all_products = db.exec(select(Produto).where(Produto.is_deleted == False)).all()
    for p in all_products:
        key = (p.empresa_id, normalize_prod_name(p.nome))
        product_cache[key] = p

    processed_notes = set()
    notes_processed_count = 0
    items_imported_count = 0
    products_created_count = 0
    skipped_count = 0

    for lanc in lancamentos:
        id_parcelamento = lanc.id_parcelamento
        if not id_parcelamento:
            continue

        if id_parcelamento in processed_notes:
            continue

        processed_notes.add(id_parcelamento)

        # Extract chave_nfe from observacao
        obs = lanc.observacao or ""
        chave_match = re.search(r"Chave\s*([0-9]{44})", obs, flags=re.IGNORECASE)
        chave_nfe = chave_match.group(1) if chave_match else id_parcelamento

        # Check if stock movements already exist for this invoice key
        existing_mov = db.exec(
            select(MovimentacaoEstoque.id)
            .where(
                MovimentacaoEstoque.empresa_id == lanc.empresa_id,
                MovimentacaoEstoque.chave_nfe == chave_nfe,
                MovimentacaoEstoque.is_deleted == False
              )
        ).first()

        if existing_mov:
            skipped_count += 1
            continue

        # Extract ItensMeta
        itens_match = re.search(r"ItensMeta\s*[:=]?\s*([A-Za-z0-9_-]+={0,2})", obs, flags=re.IGNORECASE)
        if not itens_match:
            continue

        token = itens_match.group(1)
        itens = decode_itens_meta(token)
        if not itens:
            continue

        print(f"\nProcessando NF-e: {id_parcelamento} | Chave: {chave_nfe} | Empresa: {lanc.empresa_id} | CC: {lanc.centro_custo_id} | Fornecedor: {lanc.entidade_id}")
        print(f"Total de itens na nota: {len(itens)}")

        notes_processed_count += 1

        # Combine date to datetime for stock movement log
        movement_date = datetime.combine(lanc.data_competencia, time(12, 0, 0))

        for item in itens:
            desc = item.get("descricao", "").strip()
            if not desc:
                continue

            qty = float(item.get("quantidade", 0.0))
            val_unit = float(item.get("valor_unitario", 0.0))
            val_total = float(item.get("valor_total", 0.0))
            ncm = item.get("ncm")
            cfop = item.get("cfop")

            # Resolve product
            norm_name = normalize_prod_name(desc)
            cache_key = (lanc.empresa_id, norm_name)

            prod = product_cache.get(cache_key)
            if not prod:
                # Create new pending product
                prod = Produto(
                    nome=desc,
                    preco_unitario=Decimal(str(val_unit)),
                    empresa_id=lanc.empresa_id,
                    tipo="PRODUTO",
                    preco_custo_medio=val_unit,
                    ncm=ncm,
                    cfop_padrao=cfop,
                    revisao_pendente=True,
                    is_active=True
                )
                if not dry_run:
                    db.add(prod)
                    db.flush()
                    product_cache[cache_key] = prod
                products_created_count += 1
                print(f"  [NEW PRODUCT] {desc} (Custo: R$ {val_unit:.2f})")
            else:
                # Update NCM/CFOP if empty
                if not prod.ncm and ncm:
                    prod.ncm = ncm
                if not prod.cfop_padrao and cfop:
                    prod.cfop_padrao = cfop
                if not dry_run:
                    db.add(prod)
                print(f"  [FOUND PRODUCT] {prod.nome} (ID: {prod.id})")

            # Calculate and update Custo Médio
            if not dry_run:
                saldo_atual = obter_saldo_atual(db, prod.id, lanc.empresa_id)
                custo_medio_atual = prod.preco_custo_medio or 0.0
                novo_custo_medio = calcular_novo_custo_medio(
                    saldo_atual=saldo_atual,
                    custo_medio_atual=custo_medio_atual,
                    quantidade_entrada=qty,
                    valor_entrada=val_total
                )
                prod.preco_custo_medio = novo_custo_medio
                db.add(prod)

            # Create stock movement
            mov = MovimentacaoEstoque(
                empresa_id=lanc.empresa_id,
                produto_id=prod.id if not dry_run else 0, # dummy ID for dry run
                quantidade=qty,
                tipo="Entrada por Compra",
                valor_unitario=val_unit,
                valor_total=val_total,
                chave_nfe=chave_nfe,
                created_at=movement_date
            )
            if not dry_run:
                db.add(mov)
            items_imported_count += 1
            print(f"  -> Movimento Estoque: Qtd: {qty} | Total: R$ {val_total:.2f}")

        if not dry_run:
            db.commit()

    db.close()

    print("\n" + "=" * 60)
    print("RESUMO DA EXECUÇÃO:")
    print(f"Notas processadas com sucesso: {notes_processed_count}")
    print(f"Notas puladas (já importadas): {skipped_count}")
    print(f"Novos produtos criados: {products_created_count}")
    print(f"Movimentações de estoque geradas: {items_imported_count}")
    print("=" * 60)

if __name__ == "__main__":
    main()
