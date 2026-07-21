from sqlmodel import Session, select
from app.db.session import engine
from app.models.plano_contas import PlanoContas

def run():
    session = Session(engine)
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n==================================================")
        print(f"CATEGORIAS RECEITA EMPRESA ID: {emp_id}")
        print(f"==================================================")
        
        categories = session.exec(
            select(PlanoContas)
            .where(
                PlanoContas.empresa_id == emp_id,
                PlanoContas.tipo == "R",
                PlanoContas.is_deleted == False
            )
        ).all()
        
        # Ordenar por código
        categories.sort(key=lambda c: c.codigo or "")
        
        for c in categories:
            print(f"  Code: {c.codigo:<10} | Name: {c.nome:<40} | DRE Grupo: {c.dre_grupo}")

if __name__ == "__main__":
    run()
