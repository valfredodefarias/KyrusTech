# scripts/list_imported_accounts.py
import sys
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.empresa import Empresa
from app.models.conta import Conta

def main():
    db = Session(engine)
    try:
        pizzeria_names = ["Pizza Fábio Umarizal", "Pizza Fábio Ananindeua", "Pizza Fábio Marco - Salão", "Pizza Fábio Marco - Delivery"]
        companies = db.exec(
            select(Empresa).where(Empresa.nome_fantasia.in_(pizzeria_names))
        ).all()
        
        for comp in companies:
            print(f"\n=== Contas Bancárias: {comp.nome_fantasia} (ID: {comp.id}) ===")
            contas = db.exec(select(Conta).where(Conta.empresa_id == comp.id)).all()
            for c in contas:
                print(f"  ID: {c.id} | Nome: '{c.nome}' | Banco: '{c.banco}' | Centro Custo ID: {c.centro_custo_id}")
                
    finally:
        db.close()

if __name__ == "__main__":
    main()
