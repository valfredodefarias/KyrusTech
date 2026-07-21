import json
import datetime
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.core.cache import clear_transaction_cache

def run_revert_overdue_pdv_launches():
    with Session(engine) as session:
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.is_deleted == True,
                Lancamento.origem == 'PDV'
            )
        ).all()

        empresas_afetadas = set()
        count = 0
        for l in launches:
            if not l.observacao:
                continue
            try:
                meta = json.loads(l.observacao)
                if meta.get("auto_soft_deleted_overdue_pdv") is True:
                    meta["auto_soft_deleted_overdue_pdv"] = False
                    l.observacao = json.dumps(meta)
                    l.is_deleted = False
                    l.deleted_at = None
                    session.add(l)
                    count += 1
                    if l.empresa_id:
                        empresas_afetadas.add(l.empresa_id)
            except Exception:
                pass

        session.commit()

        for emp_id in empresas_afetadas:
            clear_transaction_cache(emp_id, force=True)

        print(f"[Revert Overdue PDV] Sucesso: {count} lançamentos foram restaurados (is_deleted = False).")

if __name__ == "__main__":
    run_revert_overdue_pdv_launches()
