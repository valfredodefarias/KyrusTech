import sys
from sqlmodel import Session, select
sys.path.append('.')

from app.db.session import engine
from app.models.usuario import Usuario
from app.models.access_profile import AccessProfile
from app.models.access_permission import AccessPermission
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile
from app.core.security import get_password_hash

def create_pdv_exclusive_users():
    empresa_id = 27  # Rosario Belem
    
    with Session(engine) as session:
        # 1. Encontrar as permissões do PDV necessárias
        perm_codes = ["PDV_SER_VENDEDOR", "PDV_VER_TODAS_VENDAS"]
        permissions = session.exec(
            select(AccessPermission).where(AccessPermission.code.in_(perm_codes))
        ).all()
        if len(permissions) != len(perm_codes):
            print(f"Erro: Alguma das permissões {perm_codes} não foi encontrada no banco de dados!")
            return
            
        perm_ids = {p.id for p in permissions}
        print(f"Permissões encontradas: {[p.code for p in permissions]}")
        
        # 2. Criar ou obter o perfil "PDV Exclusivo" para a empresa 27
        profile = session.exec(
            select(AccessProfile).where(
                AccessProfile.empresa_id == empresa_id,
                AccessProfile.code == "PDV_EXCLUSIVO"
            )
        ).first()
        
        if not profile:
            profile = AccessProfile(
                empresa_id=empresa_id,
                name="PDV Exclusivo",
                code="PDV_EXCLUSIVO",
                description="Acesso exclusivo ao PDV, permitindo apenas vender e ver as vendas",
                is_active=True,
                is_system=False,
                is_template=False
            )
            session.add(profile)
            session.commit()
            session.refresh(profile)
            print(f"Perfil criado: {profile.name} (ID: {profile.id})")
        else:
            print(f"Perfil existente encontrado: {profile.name} (ID: {profile.id})")
            
        # 3. Garantir que o perfil tem APENAS as permissões especificadas
        # Remover permissões antigas se existirem e não forem as desejadas
        existing_profile_perms = session.exec(
            select(AccessProfilePermission).where(AccessProfilePermission.profile_id == profile.id)
        ).all()
        for ep in existing_profile_perms:
            if ep.permission_id not in perm_ids:
                session.delete(ep)
        session.commit()
        
        # Adicionar as permissões se não estiverem vinculadas
        for perm in permissions:
            link = session.exec(
                select(AccessProfilePermission).where(
                    AccessProfilePermission.profile_id == profile.id,
                    AccessProfilePermission.permission_id == perm.id
                )
            ).first()
            
            if not link:
                link = AccessProfilePermission(
                    profile_id=profile.id,
                    permission_id=perm.id,
                    allowed=True
                )
                session.add(link)
                session.commit()
                print(f"Permissão '{perm.code}' vinculada ao perfil.")
            else:
                link.allowed = True
                session.add(link)
                session.commit()
                print(f"Permissão '{perm.code}' já estava vinculada e ativa.")

        # 4. Criar ou atualizar os usuários
        users_to_create = [
            {
                "email": "fernandesdan96@gmail.com",
                "nome": "Dan Fernandes",
                "password": "123456"
            },
            {
                "email": "erikbmaia@gmail.com",
                "nome": "Erik Maia",
                "password": "030509"
            }
        ]
        
        for u_data in users_to_create:
            email = u_data["email"]
            nome = u_data["nome"]
            pwd = u_data["password"]
            
            user = session.exec(select(Usuario).where(Usuario.email == email)).first()
            if not user:
                user = Usuario(
                    nome=nome,
                    email=email,
                    hashed_password=get_password_hash(pwd),
                    empresa_id=empresa_id,
                    is_active=True
                )
                session.add(user)
                session.commit()
                session.refresh(user)
                print(f"Usuário criado: {user.nome} ({user.email})")
            else:
                user.nome = nome
                user.hashed_password = get_password_hash(pwd)
                user.empresa_id = empresa_id
                user.is_active = True
                session.add(user)
                session.commit()
                session.refresh(user)
                print(f"Usuário atualizado: {user.nome} ({user.email})")
                
            # 5. Atribuir o perfil ao usuário
            ucp = session.exec(
                select(UserCompanyProfile).where(
                    UserCompanyProfile.usuario_id == user.id,
                    UserCompanyProfile.empresa_id == empresa_id,
                    UserCompanyProfile.profile_id == profile.id
                )
            ).first()
            
            if not ucp:
                ucp = UserCompanyProfile(
                    usuario_id=user.id,
                    empresa_id=empresa_id,
                    profile_id=profile.id,
                    is_active=True
                )
                session.add(ucp)
                print(f"Perfil '{profile.name}' atribuído ao usuário {user.nome}.")
            else:
                ucp.is_active = True
                ucp.is_deleted = False
                session.add(ucp)
                print(f"Atribuição existente de '{profile.name}' para {user.nome} reativada.")
                
            # Desativar outras atribuições para este usuário na empresa 27
            other_ucps = session.exec(
                select(UserCompanyProfile).where(
                    UserCompanyProfile.usuario_id == user.id,
                    UserCompanyProfile.empresa_id == empresa_id,
                    UserCompanyProfile.profile_id != profile.id
                )
            ).all()
            for o_ucp in other_ucps:
                o_ucp.is_active = False
                o_ucp.is_deleted = True
                session.add(o_ucp)
                print(f"Outra atribuição desativada para {user.nome} (Profile ID: {o_ucp.profile_id}).")
                
            session.commit()
            
        print("Script finalizado com sucesso!")

if __name__ == "__main__":
    create_pdv_exclusive_users()
