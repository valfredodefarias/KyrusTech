# scripts/cleanup_legacy_badges.py
from sqlmodel import Session, select
from app.db.session import engine
from app.models.pdv_ifood_lancamento import PdvIfoodLancamento

def main():
    print("Iniciando limpeza de marcadores legacy_id nas transações iFood...")
    db = Session(engine)
    try:
        txs = db.exec(
            select(PdvIfoodLancamento)
            .where(PdvIfoodLancamento.despesas_extras_str.like("legacy_id:%"))
        ).all()
        
        print(f"Encontrados {len(txs)} lançamentos com marcador legacy_id.")
        for tx in txs:
            tx.despesas_extras_str = None
            
        db.commit()
        print("Limpeza concluída com sucesso! Todos os marcadores visuais foram limpos.")
    except Exception as e:
        print(f"Erro durante a limpeza: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()
