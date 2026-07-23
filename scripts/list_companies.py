# scripts/list_companies.py
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.empresa import Empresa

def main():
    db = Session(engine)
    try:
        companies = db.exec(select(Empresa)).all()
        print(f"=== EMPRESAS NO BANCO DE DADOS (Total: {len(companies)}) ===")
        for c in companies:
            print(f"  ID: {c.id} | Nome Fantasia: '{c.nome_fantasia}' | Razão Social: '{c.razao_social}' | CNPJ: {c.cnpj}")
    except Exception as e:
        print(f"Erro ao listar empresas: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
