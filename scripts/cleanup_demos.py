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
        
        from sqlalchemy import text
        
        for empresa in empresas_expiradas:
            empresa_id = empresa.id
            print(f"[CLEANUP] Excluindo dados da empresa: {empresa.nome_fantasia} (ID: {empresa_id}, criada em: {empresa.created_at})...")
            
            # Obter IDs dos usuários dessa empresa
            users_ids = [int(u.id) for u in session.exec(select(Usuario).where(Usuario.empresa_id == empresa_id)).all() if u.id is not None]
            # Obter IDs dos perfis de acesso dessa empresa
            profiles_ids = [int(p.id) for p in session.exec(select(AccessProfile).where(AccessProfile.empresa_id == empresa_id)).all() if p.id is not None]
            # Executar deleções na ordem correta para evitar violação de foreign keys:
            
            # 1. UserSession e AccessProfilePermission e AnexoLancamento
            if users_ids:
                session.execute(text("DELETE FROM user_sessions WHERE user_id = ANY(:ids)"), {"ids": users_ids})
                
            if profiles_ids:
                session.execute(text("DELETE FROM access_profile_permissions WHERE profile_id = ANY(:ids)"), {"ids": profiles_ids})
                
            session.execute(text("DELETE FROM anexos_lancamento WHERE empresa_id = :id"), {"id": empresa_id})
                
            # 2. Tabelas de Movimento/Baixa/Lote que dependem de Lancamentos/Contas/Cartoes
            session.execute(text("DELETE FROM baixas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM movimentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM lote_cartao_itens WHERE lote_id IN (SELECT id FROM lote_cartoes WHERE empresa_id = :id)"), {"id": empresa_id})
            session.execute(text("DELETE FROM lote_cartoes WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_cartao WHERE empresa_id = :id"), {"id": empresa_id})
            
            # 3. Tabelas de PDV e Estoque
            session.execute(text("DELETE FROM pdv_movimentacoes WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM pdv_vendas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM movimentacoes_estoque WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM fornecedor_produto_equivalencias WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM produtos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM pdv_ifood_lancamentos WHERE empresa_id = :id"), {"id": empresa_id})
            
            # 4. Outras Tabelas de Config/Metas/Alertas
            session.execute(text("DELETE FROM orcamentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM import_jobs WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM integracoes_bancarias WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM mapeamentos_categoria WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM todo_items WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_comissao WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM metas_vendedores WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM alertas_anomalias WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_silenciamento_auditor WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM consultores_empresas WHERE empresa_id = :id"), {"id": empresa_id})
            
            # 5. Tabelas fundamentais
            session.execute(text("DELETE FROM audit_logs WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM lancamentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM cartoes WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM user_company_profiles WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM access_profiles WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM contas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM centros_custo WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM entidades WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM plano_contas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM usuarios WHERE empresa_id = :id"), {"id": empresa_id})
            
            # 6. Deletar a Empresa
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

