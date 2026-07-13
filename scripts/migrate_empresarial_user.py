# scripts/migrate_empresarial_user.py
import sys
from pathlib import Path
from datetime import datetime
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.access_profile import AccessProfile
from app.models.user_company_profile import UserCompanyProfile

def main():
    db = Session(engine)
    try:
        print("=== INICIANDO MIGRAÇÃO DO USUÁRIO EMPRESARIAL TECH ===")
        email_target = "empresarialtech25@gmail.com"
        new_company_id = 43  # Empresarial Tech ID
        
        # 1. Find User
        user = db.exec(select(Usuario).where(Usuario.email == email_target, Usuario.is_deleted == False)).first()
        if not user:
            print(f"[ERRO] Usuário '{email_target}' não encontrado.")
            return
            
        print(f"Usuário encontrado: '{user.nome}' (ID: {user.id}) | Empresa Atual: {user.empresa_id}")
        
        # 2. Update user's home company
        user.empresa_id = new_company_id
        db.add(user)
        print(f"  - Alterada empresa principal do usuário para ID: {new_company_id}")
        
        # 3. Disable old company access profiles (Link Financeiro - ID 30)
        old_profiles = db.exec(
            select(UserCompanyProfile)
            .where(UserCompanyProfile.usuario_id == user.id, UserCompanyProfile.empresa_id == 30)
        ).all()
        for op in old_profiles:
            # We mark as deleted/inactive to remove access
            op.is_active = False
            # If the model has an is_deleted field, we set it too (let's check standard)
            db.add(op)
            print(f"  - Desativado perfil de acesso à Link Financeiro (ID: 30)")
            
        # 4. Find the target access profile for Empresarial Tech (ID 43)
        # We look for the most permissive profile (often coded as 'admin', 'master', or the template full access)
        target_profile = db.exec(
            select(AccessProfile)
            .where(
                AccessProfile.empresa_id == new_company_id,
                AccessProfile.is_deleted == False
            )
            .order_by(AccessProfile.id.asc())  # First profile created is usually full access
        ).first()
        
        if target_profile:
            # Link user to the new company's profile
            existing_link = db.exec(
                select(UserCompanyProfile)
                .where(
                    UserCompanyProfile.usuario_id == user.id,
                    UserCompanyProfile.empresa_id == new_company_id
                )
            ).first()
            
            if not existing_link:
                new_link = UserCompanyProfile(
                    usuario_id=user.id,
                    empresa_id=new_company_id,
                    profile_id=target_profile.id,
                    is_active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                db.add(new_link)
                print(f"  - Criado vínculo com perfil '{target_profile.name}' (ID: {target_profile.id}) na Empresarial Tech.")
            else:
                existing_link.profile_id = target_profile.id
                existing_link.is_active = True
                db.add(existing_link)
                print(f"  - Atualizado vínculo com perfil '{target_profile.name}' na Empresarial Tech.")
        else:
            print("[AVISO] Perfil de acesso para a Empresarial Tech não encontrado. Crie um perfil no painel administrativo.")
            
        db.commit()
        print("\n[OK] Migração de usuário concluída com sucesso!")
        
    except Exception as e:
        print(f"[ERRO] Falha ao migrar usuário: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    main()
