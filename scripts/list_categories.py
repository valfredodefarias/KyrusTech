from sqlmodel import Session, select
from app.db.session import engine
from app.models.plano_contas import PlanoContas

def run():
    session = Session(engine)
    categorias = session.exec(
        select(PlanoContas)
        .where(PlanoContas.empresa_id == 35)
    ).all()
    
    print("=== CATEGORIAS DE PLANO DE CONTAS (UMARIZAL) ===")
    for c in sorted(categorias, key=lambda x: x.codigo or ""):
        print(f"  ID: {c.id:<5} | Codigo: {c.codigo:<12} | Nome: {c.nome:<30} | Tipo: {c.tipo}")

if __name__ == "__main__":
    run()
