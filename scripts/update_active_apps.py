# scripts/update_active_apps.py
import sys
import os
import json
from sqlmodel import Session, select

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import engine
from app.models.empresa import Empresa

def run():
    print("Iniciando atualização de pdv_config para as empresas da Pizza Fábio...")
    with Session(engine) as db:
        empresas = db.exec(select(Empresa).where(Empresa.id.in_([75, 76, 77]))).all()
        for emp in empresas:
            print(f"Empresa: {emp.nome_fantasia} (ID: {emp.id})")
            config = {}
            if emp.pdv_config:
                try:
                    config = json.loads(emp.pdv_config)
                except Exception as e:
                    print(f"  Erro ao ler pdv_config: {e}")
            
            # Atualizar active_apps
            config["active_apps"] = ["movimentacao_pdv", "ifood"]
            emp.pdv_config = json.dumps(config)
            db.add(emp)
            print(f"  Configurações atualizadas: {emp.pdv_config}")
        
        db.commit()
        print("Atualização concluída com sucesso!")

if __name__ == "__main__":
    run()
