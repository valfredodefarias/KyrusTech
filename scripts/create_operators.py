# scripts/create_operators.py
import sys
import secrets
import string
from pathlib import Path
from datetime import datetime
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.access_profile import AccessProfile
from app.models.access_permission import AccessPermission
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile
from app.core.security import get_password_hash
from app.enums import PdvPermission

# Permissions required for an operator to manage PDV and iFood without seeing corporate finance
OPERATOR_PERMISSION_CODES = [
    "page:importacao:view",    # Import page (Movimentação PDV)
    "page:integracoes:view",   # iFood / Integrations page (sidebar link)
    "integracoes:view",        # View integrations detail
    "integracoes:sync",        # Allow syncing/pulling from iFood
    PdvPermission.PDV_SER_VENDEDOR.value,         # Appears as seller
    PdvPermission.PDV_VER_TODAS_VENDAS.value,     # View dashboard for cashier
    PdvPermission.PDV_REALIZAR_SANGRIA.value,     # Cash withdrawal (sangria)
    PdvPermission.PDV_CANCELAR_VENDA.value,       # Cancel sales
    PdvPermission.PDV_CONCEDER_DESCONTO.value,    # Grant discounts
]

def generate_nice_password(company_keyword: str, index: int) -> str:
    # Generates a strong but readable password: Fabio<Keyword><Index>
    clean_keyword = company_keyword.replace(" ", "").replace("-", "").capitalize()
    return f"Fabio{clean_keyword}{index}"

def main():
    db = Session(engine)
    try:
        print("=== INICIANDO CRIAÇÃO DE USUÁRIOS OPERADORES ===")
        now = datetime.utcnow()
        
        # 1. Resolve Permissions IDs
        permissions = db.exec(
            select(AccessPermission).where(AccessPermission.code.in_(OPERATOR_PERMISSION_CODES))
        ).all()
        perm_ids = [p.id for p in permissions if p.id is not None]
        print(f"Mapeadas {len(perm_ids)} permissões de operador.")
        
        # Define requirements per company
        requirements = [
            {"name": "Pizza Fábio Umarizal", "count": 3, "keyword": "Umarizal", "prefix": "op.umarizal"},
            {"name": "Pizza Fábio Ananindeua", "count": 3, "keyword": "Ananindeua", "prefix": "op.ananindeua"},
            {"name": "Pizza Fábio Marco - Salão", "count": 2, "keyword": "Salao", "prefix": "op.salao"},
            {"name": "Pizza Fábio Marco - Delivery", "count": 2, "keyword": "Delivery", "prefix": "op.delivery"},
        ]
        
        results = []
        
        for req in requirements:
            company = db.exec(
                select(Empresa).where(Empresa.nome_fantasia == req["name"])
            ).first()
            
            if not company:
                print(f"[ERRO] Empresa '{req['name']}' não encontrada no banco. Pulando...")
                continue
                
            print(f"\nConfigurando empresa: '{company.nome_fantasia}' (ID: {company.id})")
            
            # 2. Find or Create custom AccessProfile for this company
            profile = db.exec(
                select(AccessProfile).where(
                    AccessProfile.empresa_id == company.id,
                    AccessProfile.code == "OPERADOR_LOJA",
                    AccessProfile.is_deleted == False
                )
            ).first()
            
            if not profile:
                profile = AccessProfile(
                    empresa_id=company.id,
                    name="Operador de Loja (PDV/iFood)",
                    code="OPERADOR_LOJA",
                    description="Acesso exclusivo ao PDV, Caixa, Sangrias e Conciliação de Vendas/iFood. Sem acesso ao financeiro geral.",
                    is_active=True,
                    is_system=True,
                    is_template=False,
                    created_at=now,
                    updated_at=now,
                    is_deleted=False
                )
                db.add(profile)
                db.commit()
                db.refresh(profile)
                print(f"  - Criado perfil de acesso 'OPERADOR_LOJA' (ID: {profile.id})")
            else:
                print(f"  - Perfil 'OPERADOR_LOJA' já existe (ID: {profile.id})")
                
            # 3. Associate permissions to the profile
            for p_id in perm_ids:
                existing_perm = db.exec(
                    select(AccessProfilePermission).where(
                        AccessProfilePermission.profile_id == profile.id,
                        AccessProfilePermission.permission_id == p_id,
                        AccessProfilePermission.is_deleted == False
                    )
                ).first()
                if not existing_perm:
                    app_perm = AccessProfilePermission(
                        profile_id=profile.id,
                        permission_id=p_id,
                        allowed=True,
                        created_at=now,
                        updated_at=now,
                        is_deleted=False
                    )
                    db.add(app_perm)
            db.commit()
            
            # 4. Create Users
            for i in range(1, req["count"] + 1):
                email = f"{req['prefix']}{i}@pizzadofabio.com"
                username = f"Operador {req['keyword']} {i}"
                password = generate_nice_password(req["keyword"], i)
                
                # Check if user already exists
                user = db.exec(
                    select(Usuario).where(Usuario.email == email, Usuario.is_deleted == False)
                ).first()
                
                if not user:
                    user = Usuario(
                        nome=username,
                        email=email,
                        hashed_password=get_password_hash(password),
                        is_active=True,
                        is_superuser=False,
                        is_consultor=False,
                        consultor_role="USUARIO_NORMAL",
                        empresa_id=company.id,
                        is_deleted=False,
                        created_at=now,
                        updated_at=now
                    )
                    db.add(user)
                    db.commit()
                    db.refresh(user)
                    print(f"  - Criado usuário: '{email}'")
                else:
                    # Update password just to be sure it matches the table output
                    user.hashed_password = get_password_hash(password)
                    db.add(user)
                    db.commit()
                    print(f"  - Usuário '{email}' já existia (Senha redefinida)")
                    
                # 5. Create or verify UserCompanyProfile linkage
                link = db.exec(
                    select(UserCompanyProfile).where(
                        UserCompanyProfile.usuario_id == user.id,
                        UserCompanyProfile.empresa_id == company.id,
                        UserCompanyProfile.is_deleted == False
                    )
                ).first()
                
                if not link:
                    link = UserCompanyProfile(
                        usuario_id=user.id,
                        empresa_id=company.id,
                        profile_id=profile.id,
                        is_active=True,
                        created_at=now,
                        updated_at=now
                    )
                    db.add(link)
                else:
                    link.profile_id = profile.id
                    db.add(link)
                db.commit()
                
                results.append({
                    "empresa": company.nome_fantasia,
                    "nome": username,
                    "email": email,
                    "senha": password
                })
                
        # Link Delivery operators to Salão company
        company_salao = db.exec(
            select(Empresa).where(Empresa.nome_fantasia == "Pizza Fábio Marco - Salão")
        ).first()
        company_delivery = db.exec(
            select(Empresa).where(Empresa.nome_fantasia == "Pizza Fábio Marco - Delivery")
        ).first()
        if company_salao and company_delivery:
            profile_salao = db.exec(
                select(AccessProfile).where(
                    AccessProfile.empresa_id == company_salao.id,
                    AccessProfile.code == "OPERADOR_LOJA",
                    AccessProfile.is_deleted == False
                )
            ).first()
            if profile_salao:
                for i in range(1, 3):
                    email = f"op.delivery{i}@pizzadofabio.com"
                    user_delivery = db.exec(
                        select(Usuario).where(Usuario.email == email, Usuario.is_deleted == False)
                    ).first()
                    if user_delivery:
                        link_salao = db.exec(
                            select(UserCompanyProfile).where(
                                UserCompanyProfile.usuario_id == user_delivery.id,
                                UserCompanyProfile.empresa_id == company_salao.id,
                                UserCompanyProfile.is_deleted == False
                            )
                        ).first()
                        if not link_salao:
                            link_salao = UserCompanyProfile(
                                usuario_id=user_delivery.id,
                                empresa_id=company_salao.id,
                                profile_id=profile_salao.id,
                                is_active=True,
                                created_at=now,
                                updated_at=now
                            )
                            db.add(link_salao)
                        else:
                            link_salao.profile_id = profile_salao.id
                            db.add(link_salao)
                db.commit()
                print("  - Vinculados operadores do Delivery à empresa do Salão.")

        # Print the Markdown report table
        print("\n\n=== TABELA DE OPERADORES CRIADOS ===")
        print("| Unidade / Empresa | Nome do Operador | E-mail / Login | Senha de Acesso |")
        print("| --- | --- | --- | --- |")
        for res in results:
            print(f"| {res['empresa']} | {res['nome']} | **{res['email']}** | `{res['senha']}` |")
            
        print("\n[OK] Script concluído com sucesso!")
        
    except Exception as e:
        print(f"[ERRO] Falha ao criar operadores: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    main()
