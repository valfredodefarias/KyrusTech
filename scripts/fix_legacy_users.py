# scripts/fix_legacy_users.py
import sys
import os
import re
import unicodedata
from sqlmodel import Session, select, col

# Add app to PYTHONPATH
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.session import engine
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from app.models.user_company_profile import UserCompanyProfile

def clean_email(nome_vendedor: str) -> str:
    n = unicodedata.normalize("NFKD", nome_vendedor.lower())
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r'[^a-z0-9\s_]', '', n)
    n = re.sub(r'\s+', '_', n)
    return f"{n}@kyrus_legado.com"

def run_fix():
    print("Iniciando correção de usuários legados...")
    with Session(engine) as db:
        # 1. Obter todos os usuários com domínio kyrus_legado.com
        users = db.exec(select(Usuario).where(Usuario.email.like("%@kyrus_legado.com"))).all()
        
        # 2. Mapeamento para fusão (email_limpo -> Usuario)
        email_map = {}
        for u in users:
            cleaned = clean_email(u.nome)
            if cleaned not in email_map:
                email_map[cleaned] = u
            else:
                # Duplicado encontrado! Precisamos fundir u (duplicado) com email_map[cleaned] (principal)
                principal = email_map[cleaned]
                duplicado = u
                print(f"Fusão: {duplicado.nome} (ID {duplicado.id}, Email {duplicado.email}) será fundido com {principal.nome} (ID {principal.id}, Email {principal.email})")
                
                # Atualizar lançamentos
                launches_created = db.exec(select(Lancamento).where(Lancamento.created_by_id == duplicado.id)).all()
                for l in launches_created:
                    l.created_by_id = principal.id
                    db.add(l)
                print(f"  Atualizados {len(launches_created)} lançamentos criados pelo duplicado.")
                
                launches_updated = db.exec(select(Lancamento).where(Lancamento.updated_by_id == duplicado.id)).all()
                for l in launches_updated:
                    l.updated_by_id = principal.id
                    db.add(l)
                print(f"  Atualizados {len(launches_updated)} lançamentos atualizados pelo duplicado.")
                
                # Remover perfis de acesso do duplicado
                profiles = db.exec(select(UserCompanyProfile).where(UserCompanyProfile.usuario_id == duplicado.id)).all()
                for p in profiles:
                    db.delete(p)
                print(f"  Removidos {len(profiles)} perfis do duplicado.")
                
                # Deletar usuário duplicado
                db.delete(duplicado)
                print(f"  Usuário ID {duplicado.id} deletado.")
        
        db.commit()
        
        # 3. Atualizar e ativar todos os usuários legados restantes com email normalizado e is_active=True
        remaining_users = db.exec(select(Usuario).where(Usuario.email.like("%@kyrus_legado.com"))).all()
        for u in remaining_users:
            old_email = u.email
            new_email = clean_email(u.nome)
            u.email = new_email
            u.is_active = True
            db.add(u)
            print(f"Ativado: {u.nome} | Email: {old_email} -> {new_email} | Ativo: {u.is_active}")
            
        db.commit()
        print("Correção concluída com sucesso!")

if __name__ == "__main__":
    run_fix()
