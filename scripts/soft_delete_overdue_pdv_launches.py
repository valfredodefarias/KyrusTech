import datetime
import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.core.cache import clear_transaction_cache

def run_soft_delete_overdue_pdv_launches():
    hoje = datetime.date.today()
    with Session(engine) as session:
        atrasados = session.exec(
            select(Lancamento)
            .where(
                Lancamento.is_deleted == False,
                Lancamento.origem == 'PDV',
                Lancamento.status == 'EM ABERTO',
                Lancamento.data_vencimento < hoje
            )
        ).all()

        print(f"[Soft-Delete Overdue PDV] Encontrados {len(atrasados)} lançamentos em aberto atrasados do PDV.")
        
        empresas_afetadas = set()
        count = 0
        for l in atrasados:
            meta = {}
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    meta = {"observacao_original": l.observacao}
            
            meta["auto_soft_deleted_overdue_pdv"] = True
            l.observacao = json.dumps(meta)
            l.is_deleted = True
            l.deleted_at = datetime.datetime.utcnow()
            session.add(l)
            count += 1
            if l.empresa_id:
                empresas_afetadas.add(l.empresa_id)

        session.commit()
        
        for emp_id in empresas_afetadas:
            clear_transaction_cache(emp_id, force=True)
            
        print(f"[Soft-Delete Overdue PDV] Sucesso: {count} lançamentos foram marcados como deletados (soft-deleted).")

if __name__ == "__main__":
    run_soft_delete_overdue_pdv_launches()
