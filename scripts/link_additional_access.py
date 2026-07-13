# scripts/link_additional_access.py
import sys
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.consultor_empresa import ConsultorEmpresa

def link_access():
    db = Session(engine)
    try:
        # Find user linkfinanceiro@gmail.com
        user = db.exec(select(Usuario).where(Usuario.email == "linkfinanceiro@gmail.com")).first()
        if not user:
            print("[AVISO] Usuário linkfinanceiro@gmail.com não encontrado.")
            return
            
        print(f"Usuário encontrado: '{user.nome}' (ID: {user.id})")
        
        # Find the new pizzerias IDs
        new_marcos = db.exec(
            select(Empresa)
            .where(Empresa.nome_fantasia.like("%Pizza Fábio Marco%"))
        ).all()
        
        for marco in new_marcos:
            existing = db.exec(
                select(ConsultorEmpresa)
                .where(ConsultorEmpresa.usuario_id == user.id, ConsultorEmpresa.empresa_id == marco.id)
            ).first()
            if not existing:
                link = ConsultorEmpresa(usuario_id=user.id, empresa_id=marco.id, ativo=True)
                db.add(link)
                print(f"  - Vinculado acesso à empresa: '{marco.nome_fantasia}' (ID: {marco.id})")
            else:
                print(f"  - Acesso à empresa '{marco.nome_fantasia}' já existia.")
                
        db.commit()
        print("\n[OK] Vínculos adicionais configurados com sucesso!")
        
    except Exception as e:
        print(f"[ERRO] Falha ao configurar vínculos: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    link_access()
