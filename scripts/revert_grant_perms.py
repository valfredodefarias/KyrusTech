import sys
import os
from datetime import datetime, timezone, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlmodel import Session
from app.db.session import engine
from app.models.empresa import Empresa
from app.models.access_profile import AccessProfile
from app.models.access_permission import AccessPermission
from app.models.access_profile_permission import AccessProfilePermission

def revert_perms():
    db = Session(engine)
    try:
        # Pega as permissões alvo
        permissoes_alvo = [
            ("pdv:movimentacoes", "view"),
            ("pdv:movimentacoes", "edit"),
            ("pdv:movimentacoes", "create"),
            ("page:ifood", "view"),
            ("ifood", "sync")
        ]
        
        target_codes = [f"{m}:{a}" for m, a in permissoes_alvo]
        
        # Acha os IDs dessas permissoes
        perm_ids = []
        for code in target_codes:
            p_row = db.exec(select(AccessPermission).where(AccessPermission.code == code)).first()
            if p_row:
                perm_ids.append(p_row[0].id)
                
        if not perm_ids:
            print("Nenhuma permissão alvo encontrada no banco.")
            return

        # Limite de tempo (criados nas ultimas 2 horas)
        time_threshold = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)

        empresas = db.exec(select(Empresa)).all()
        empresas = [e[0] for e in empresas]
        
        deleted_count = 0
        
        for empresa in empresas:
            name = (empresa.nome_fantasia or "").lower()
            # Ignora as empresas que eram o alvo original
            if "pizza" in name or "ananindeua" in name or "delivery" in name:
                print(f"Mantendo permissões originais para a Pizza Fabio: {empresa.nome_fantasia}")
                continue
                
            print(f"Limpando permissões da empresa: {empresa.nome_fantasia} (ID: {empresa.id})")
            perfis_rows = db.exec(select(AccessProfile).where(AccessProfile.empresa_id == empresa.id)).all()
            perfis = [p[0] for p in perfis_rows]
            
            for perfil in perfis:
                # Busca as permissoes criadas nas ultimas 2 horas que coincidem com os IDs alvo
                apps = db.exec(
                    select(AccessProfilePermission)
                    .where(AccessProfilePermission.profile_id == perfil.id)
                    .where(AccessProfilePermission.permission_id.in_(perm_ids))
                    .where(AccessProfilePermission.created_at >= time_threshold)
                ).all()
                
                for app_row in apps:
                    app = app_row[0]
                    db.delete(app)
                    deleted_count += 1
                    print(f"  -> Removida permissão recém-criada do perfil: {perfil.name}")

        db.commit()
        print(f"Reversão executada com sucesso. Total de {deleted_count} vínculos apagados.")

    except Exception as e:
        db.rollback()
        print(f"Erro: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    revert_perms()
