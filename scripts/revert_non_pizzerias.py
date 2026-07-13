# scripts/revert_non_pizzerias.py
import sys
from pathlib import Path
from datetime import datetime, timedelta
from sqlmodel import Session, select, text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.lancamento import Lancamento

def revert_non_pizzerias():
    print("=== REVERTENDO SURGICAMENTE OUTRAS EMPRESAS PARA NULL ===")
    db = Session(engine)
    try:
        # Pizzeria IDs to exclude from revert
        pizzeria_ids = [35, 37, 39, 40]
        
        # We only want to revert updates that happened in the last 60 minutes
        time_limit = datetime.utcnow() - timedelta(minutes=60)
        print(f"Buscando lançamentos atualizados após {time_limit} UTC...")
        
        # Find all transactions updated recently that do not belong to the pizzerias
        txs = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id.notin_(pizzeria_ids),
                Lancamento.updated_at >= time_limit
            )
        ).all()
        
        print(f"Lançamentos encontrados para reverter: {len(txs)}")
        
        updated_count = 0
        for tx in txs:
            tx.centro_custo_id = None
            db.add(tx)
            updated_count += 1
            
        db.commit()
        print(f"\n[OK] Reversão concluída! {updated_count} lançamentos voltaram a ter Centro de Custo = NULL.")
        
    except Exception as e:
        print(f"[ERRO] Falha ao reverter lançamentos: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    revert_non_pizzerias()
