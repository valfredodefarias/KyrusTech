from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.empresa import Empresa

def run(dry_run=True):
    session = Session(engine)
    
    # 1. Buscar todas as empresas Pizza Fábio
    empresas = session.exec(select(Empresa).where(Empresa.is_active == True)).all()
    
    emp_ids = []
    for emp in empresas:
        nome = (emp.nome_fantasia or emp.razao_social or "").lower()
        if "umarizal" in nome or "ananindeua" in nome or "marco" in nome:
            emp_ids.append(emp.id)
            
    print(f"Empresas Pizza Fábio identificadas: {emp_ids}")
    
    # 2. Buscar lançamentos WEB que estão marcados como deletados
    query = select(Lancamento).where(
        Lancamento.empresa_id.in_(emp_ids),
        Lancamento.origem == "WEB",
        Lancamento.is_deleted == True
    )
    
    deleted_launches = session.exec(query).all()
    print(f"Total de lançamentos WEB deletados encontrados: {len(deleted_launches)}")
    
    to_restore = []
    for l in deleted_launches:
        obs = (l.observacao or "").lower()
        is_legacy = "importação financeiro" in obs or "importacao financeiro" in obs
        if is_legacy:
            to_restore.append(l)
            
    print(f"Total de lançamentos importados da planilha para restaurar: {len(to_restore)}")
    
    if not dry_run:
        count = 0
        for l in to_restore:
            l.is_deleted = False
            session.add(l)
            count += 1
            if count % 1000 == 0:
                session.commit()
        session.commit()
        print(f"✅ Restaurados com sucesso {len(to_restore)} lançamentos no banco de dados!")
    else:
        print("--- MODO SIMULAÇÃO ---")
        print("Nenhum lançamento foi alterado. Rode com o argumento 'run' para aplicar.")

if __name__ == "__main__":
    import sys
    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        dry_run = False
    run(dry_run)
