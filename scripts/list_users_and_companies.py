# scripts/list_users_and_companies.py
import sys
from pathlib import Path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa

def main():
    db = Session(engine)
    try:
        print("\n=== LISTA DE EMPRESAS NO BANCO ===")
        companies = db.exec(select(Empresa)).all()
        for c in companies:
            print(f"  ID: {c.id} | Nome: '{c.nome_fantasia}' | Razão: '{c.razao_social}' | CNPJ: {c.cnpj}")
            
        print("\n=== LISTA DE USUÁRIOS NO BANCO ===")
        users = db.exec(select(Usuario).where(Usuario.is_deleted == False)).all()
        for u in users:
            associated_companies = []
            if u.is_consultor:
                # Find linked companies in ConsultorEmpresa
                accesses = db.exec(
                    select(ConsultorEmpresa)
                    .where(ConsultorEmpresa.usuario_id == u.id, ConsultorEmpresa.ativo == True)
                ).all()
                for ac in accesses:
                    emp = db.get(Empresa, ac.empresa_id)
                    associated_companies.append(f"{emp.nome_fantasia if emp else ac.empresa_id} (ID: {ac.empresa_id})")
            else:
                emp = db.get(Empresa, u.empresa_id)
                associated_companies.append(f"{emp.nome_fantasia if emp else u.empresa_id} (ID: {u.empresa_id})")
                
            print(f"  ID: {u.id} | Nome: '{u.nome}' | Email: '{u.email}'")
            print(f"    - Consultor: {u.is_consultor} | Role: {u.consultor_role}")
            print(f"    - Acesso a Empresas: {', '.join(associated_companies) if associated_companies else 'Nenhuma'}")
            print("-" * 50)
            
    except Exception as e:
        print(f"Erro ao listar dados: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
