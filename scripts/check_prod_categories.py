from sqlmodel import Session, select
from app.db.session import engine
from app.models.plano_contas import PlanoContas

def run():
    session = Session(engine)
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n==================================================")
        print(f"PROD CATEGORIAS RECEITA EMPRESA ID: {emp_id}")
        print(f"==================================================")
        
        categories = session.exec(
            select(PlanoContas)
            .where(
                PlanoContas.empresa_id == emp_id,
                PlanoContas.tipo == "R",
                PlanoContas.is_deleted == False
            )
        ).all()
        
        categories.sort(key=lambda c: c.codigo or "")
        for c in categories:
            print(f"  Code: {c.codigo:<15} | Name: {c.nome:<40} | ID: {c.id}")

if __name__ == "__main__":
    run()
