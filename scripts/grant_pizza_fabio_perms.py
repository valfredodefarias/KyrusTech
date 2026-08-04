import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlmodel import Session
from app.db.session import engine
from app.models.usuario import Usuario
from app.models.empresa import Empresa
from app.models.access_profile import AccessProfile
from app.models.access_permission import AccessPermission
from app.models.access_profile_permission import AccessProfilePermission
from app.models.user_company_profile import UserCompanyProfile

def grant_pizza_fabio_perms():
    db = Session(engine)
    try:
        # Busca todas as empresas para tentar encontrar a Pizza do Fabio (lidando com Row objects de tupla)
        empresas = db.exec(select(Empresa)).all()
        empresa = next((e[0] for e in empresas if e[0].nome_fantasia and "Pizza" in e[0].nome_fantasia and "Fabio" in e[0].nome_fantasia), None)
        
        if not empresa:
            print("Empresa Pizza do Fabio não encontrada. Aplicando para a primeira empresa do banco...")
            if empresas:
                empresa = empresas[0][0]
            else:
                return

        print(f"Empresa selecionada: {empresa.nome_fantasia} (ID: {empresa.id})")

        # Busca todos os perfis de acesso da empresa
        perfis_rows = db.exec(select(AccessProfile).where(AccessProfile.empresa_id == empresa.id)).all()
        perfis = [p[0] for p in perfis_rows]
        
        if not perfis:
            print("Nenhum perfil de acesso encontrado para a empresa. Procurando por operadores...")
        
        permissoes_alvo = [
            ("pdv:movimentacoes", "view"),
            ("pdv:movimentacoes", "edit"),
            ("pdv:movimentacoes", "create"),
            ("page:ifood", "view"),
            ("ifood", "sync")
        ]

        # Garante que as permissões existam no banco
        perm_objs = []
        for p_module, p_action in permissoes_alvo:
            p_code = f"{p_module}:{p_action}"
            p_row = db.exec(select(AccessPermission).where(AccessPermission.code == p_code)).first()
            p_obj = p_row[0] if p_row else None
            if not p_obj:
                p_obj = AccessPermission(
                    code=p_code, 
                    module=p_module, 
                    action=p_action,
                    description=f"Permissão automática: {p_code}"
                )
                db.add(p_obj)
                db.flush()
            perm_objs.append(p_obj)

        # Adiciona aos perfis da empresa
        for perfil in perfis:
            existing_perms_ids = {p.permission_id for p in perfil.permissions}
            for p_obj in perm_objs:
                if p_obj.id not in existing_perms_ids:
                    app = AccessProfilePermission(profile_id=perfil.id, permission_id=p_obj.id, allowed=True)
                    db.add(app)
            print(f"Permissões injetadas no perfil: {perfil.name}")

        db.commit()
        print("Script executado com sucesso.")

    except Exception as e:
        db.rollback()
        print(f"Erro: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    grant_pizza_fabio_perms()
