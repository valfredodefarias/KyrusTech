# scripts/reimport_marco_salao.py
# Apaga os dados do Marco Salão (ID 39) e reimporta do arquivo correto
import sys, json
from pathlib import Path
from sqlmodel import Session, select, delete

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.entidade import Entidade

MARCO_SALAO_ID = 39
DRY_RUN = "--dry-run" in sys.argv

def main():
    db = Session(engine)
    try:
        mode = "[DRY RUN]" if DRY_RUN else "[EXECUCAO REAL]"
        print(f"=== LIMPEZA MARCO SALAO {mode} ===\n")

        # Count before
        lan_count = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == MARCO_SALAO_ID,
                Lancamento.is_deleted == False
            )
        ).all()
        venda_count = db.exec(
            select(PdvVenda).where(
                PdvVenda.empresa_id == MARCO_SALAO_ID,
                PdvVenda.is_deleted == False
            )
        ).all()

        print(f"Lancamentos a deletar: {len(lan_count)}")
        print(f"Vendas PDV a deletar:  {len(venda_count)}")

        if DRY_RUN:
            print("\n[DRY RUN] Nenhuma alteracao feita. Rode sem --dry-run para executar.")
            return

        confirm = input("\nTem certeza? Digite 'SIM' para confirmar: ")
        if confirm.strip().upper() != "SIM":
            print("Cancelado.")
            return

        print("\nDeletando lancamentos...")
        for lan in lan_count:
            lan.is_deleted = True
            db.add(lan)
        
        print("Deletando vendas PDV e itens...")
        for venda in venda_count:
            # Soft delete items
            itens = db.exec(
                select(PdvVendaItem).where(PdvVendaItem.venda_id == venda.id)
            ).all()
            for item in itens:
                item.is_deleted = True
                db.add(item)
            venda.is_deleted = True
            db.add(venda)

        print("Deletando movimentacoes PDV...")
        movs = db.exec(
            select(PdvMovimentacao).where(
                PdvMovimentacao.empresa_id == MARCO_SALAO_ID,
                PdvMovimentacao.is_deleted == False
            )
        ).all()
        for mov in movs:
            mov.is_deleted = True
            db.add(mov)

        db.commit()
        print(f"\n[OK] {len(lan_count)} lancamentos e {len(venda_count)} vendas deletados.")
        print("\nAgora rode o importador com a planilha correta:")
        print("  docker compose exec backend python scripts/import_pizza_fabio.py")

    except Exception as e:
        print(f"[ERRO] {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
