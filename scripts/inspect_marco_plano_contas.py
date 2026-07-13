# scripts/inspect_marco_plano_contas.py
from sqlmodel import Session, select
from app.db.session import engine
from app.models.plano_contas import PlanoContas

def main():
    db = Session(engine)
    try:
        pcs = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == 76)).all()
        print(f"Total PlanoContas for Marco (ID 76): {len(pcs)}")
        
        r_pcs = [p for p in pcs if p.tipo == 'R']
        d_pcs = [p for p in pcs if p.tipo == 'D']
        
        print(f"Revenues (tipo='R'): {len(r_pcs)}")
        for p in r_pcs[:15]:
            print(f"  Code: {p.codigo} | Name: {p.nome} | Tipo: {p.tipo}")
            
        print(f"\nExpenses (tipo='D'): {len(d_pcs)}")
        for p in d_pcs[:15]:
            print(f"  Code: {p.codigo} | Name: {p.nome} | Tipo: {p.tipo}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
