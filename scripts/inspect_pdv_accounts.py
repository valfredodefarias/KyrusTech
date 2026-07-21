from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from collections import Counter

def run():
    session = Session(engine)
    
    # Obter todas as contas
    contas = session.exec(select(Conta)).all()
    conta_by_id = {c.id: c.nome for c in contas}
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n>>> Empresa ID: {emp_id}")
        
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.origem == "PDV",
                Lancamento.is_deleted == False
            )
        ).all()
        
        print(f"Total de lançamentos PDV: {len(launches)}")
        
        counts = Counter(l.conta_id for l in launches)
        for cid, cnt in counts.items():
            cname = conta_by_id.get(cid, "Nenhum (NULL)")
            print(f"  Conta: {cname} (ID: {cid}) -> {cnt} lançamentos")

if __name__ == "__main__":
    run()
