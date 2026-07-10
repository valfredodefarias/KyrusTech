# scripts/cleanup_demos.py
"""
Script para limpar empresas de demonstração temporárias expiradas.
Pode ser executado via cron job ou agendador de tarefas.
"""
import sys
from pathlib import Path

# Adiciona o diretório raiz ao path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import datetime
from sqlmodel import Session, select, delete
from app.db.session import engine

# Importa todos os modelos para garantir que os relacionamentos funcionem
from app.models import *
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.user_session import UserSession
from app.models.lancamento import Lancamento
from app.models.cartao import Cartao
from app.models.user_company_profile import UserCompanyProfile
from app.models.access_profile import AccessProfile
from app.models.access_profile_permission import AccessProfilePermission
from app.models.conta import Conta
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.plano_contas import PlanoContas
from app.models.audit_log import AuditLog

def cleanup_expired_demos(hours_threshold: int = 2, db_session: Session | None = None):
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours_threshold)
    
    if db_session is not None:
        _execute_cleanup(db_session, cutoff, hours_threshold)
    else:
        with Session(engine) as session:
            _execute_cleanup(session, cutoff, hours_threshold)

def _execute_cleanup(session: Session, cutoff: datetime.datetime, hours_threshold: int):
    try:
        # Buscar empresas temporárias criadas há mais de hours_threshold horas
        empresas_expiradas = session.exec(
            select(Empresa)
            .where(
                Empresa.razao_social.like("DEMO_TEMP_%"),
                Empresa.created_at < cutoff
            )
        ).all()
        
        if not empresas_expiradas:
            print(f"[INFO] Nenhuma empresa de demonstração expirada (limite de {hours_threshold}h).")
            return
        
        print(f"[INFO] Encontradas {len(empresas_expiradas)} empresas de demonstração expiradas para remoção.")
        
        for empresa in empresas_expiradas:
            empresa_id = empresa.id
            print(f"[CLEANUP] Excluindo dados da empresa: {empresa.nome_fantasia} (ID: {empresa_id}, criada em: {empresa.created_at})...")
            
            # Obter IDs dos usuários dessa empresa
            users_ids = [int(u.id) for u in session.exec(select(Usuario).where(Usuario.empresa_id == empresa_id)).all() if u.id is not None]
            # Obter IDs dos perfis de acesso dessa empresa
            profiles_ids = [int(p.id) for p in session.exec(select(AccessProfile).where(AccessProfile.empresa_id == empresa_id)).all() if p.id is not None]
            
            # Executar deleções na ordem correta para evitar violação de foreign keys:
            
            # 1. UserSession
            if users_ids:
                session.exec(delete(UserSession).where(UserSession.user_id.in_(users_ids))) # type: ignore
                
            # 2. AuditLog
            session.exec(delete(AuditLog).where(AuditLog.empresa_id == empresa_id)) # type: ignore
            
            # 3. Lancamento
            session.exec(delete(Lancamento).where(Lancamento.empresa_id == empresa_id)) # type: ignore
            
            # 4. Cartao
            session.exec(delete(Cartao).where(Cartao.empresa_id == empresa_id)) # type: ignore
            
            # 5. UserCompanyProfile
            session.exec(delete(UserCompanyProfile).where(UserCompanyProfile.empresa_id == empresa_id)) # type: ignore
            
            # 6. AccessProfilePermission
            if profiles_ids:
                session.exec(delete(AccessProfilePermission).where(AccessProfilePermission.profile_id.in_(profiles_ids))) # type: ignore
                
            # 7. AccessProfile
            session.exec(delete(AccessProfile).where(AccessProfile.empresa_id == empresa_id)) # type: ignore
            
            # 8. Conta
            session.exec(delete(Conta).where(Conta.empresa_id == empresa_id)) # type: ignore
            
            # 9. CentroCusto
            session.exec(delete(CentroCusto).where(CentroCusto.empresa_id == empresa_id)) # type: ignore
            
            # 10. Entidade
            session.exec(delete(Entidade).where(Entidade.empresa_id == empresa_id)) # type: ignore
            
            # 11. PlanoContas
            session.exec(delete(PlanoContas).where(PlanoContas.empresa_id == empresa_id)) # type: ignore
            
            # 12. Usuario
            session.exec(delete(Usuario).where(Usuario.empresa_id == empresa_id)) # type: ignore
            
            # 13. Empresa
            session.delete(empresa)
            
            print(f"[CLEANUP] Empresa {empresa_id} removida com sucesso!")
            
        session.commit()
        print("[OK] Limpeza concluída com sucesso.")
        
    except Exception as e:
        session.rollback()
        print(f"[ERRO] Falha durante a limpeza: {e}")
        raise

if __name__ == "__main__":
    cleanup_expired_demos()

