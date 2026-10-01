from __future__ import annotations

import datetime
from loguru import logger
from sqlalchemy import text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.access_profile import AccessProfile


def cleanup_expired_demos(hours_threshold: int = 2, db_session: Session | None = None) -> int:
    """
    Remove empresas de demonstração temporárias (DEMO_TEMP_*) criadas há mais de `hours_threshold` horas.
    Exclui todos os dados associados em cascata respeitando integridade referencial.
    """
    cutoff = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(hours=hours_threshold)

    if db_session is not None:
        return _execute_cleanup(db_session, cutoff, hours_threshold)
    else:
        with Session(engine) as session:
            return _execute_cleanup(session, cutoff, hours_threshold)


def _is_convidado_demo(usuario: Usuario) -> bool:
    """Usuário convidado criado pelo /auth/demo-login (convidado_<id>@kyrustech.com, não consultor)."""
    email = (usuario.email or "").lower()
    return (
        not usuario.is_consultor
        and email.startswith("convidado_")
        and email.endswith("@kyrustech.com")
    )


def _execute_cleanup(session: Session, cutoff: datetime.datetime, hours_threshold: int) -> int:
    try:
        empresas_expiradas = session.exec(
            select(Empresa).where(
                Empresa.razao_social.like("DEMO_TEMP_%"),
                Empresa.created_at < cutoff
            )
        ).all()

        if not empresas_expiradas:
            logger.debug("[DemoCleanup] Nenhuma empresa de demonstração expirada (limite de {}h).", hours_threshold)
            return 0

        logger.info("[DemoCleanup] Encontradas {} empresas de demonstração expiradas para remoção.", len(empresas_expiradas))
        total_removidas = 0

        for empresa in empresas_expiradas:
            empresa_id = empresa.id
            logger.info("[DemoCleanup] Excluindo dados da empresa: {} (ID: {}, criada em: {})...", empresa.nome_fantasia, empresa_id, empresa.created_at)

            usuarios_na_empresa = session.exec(select(Usuario).where(Usuario.empresa_id == empresa_id)).all()
            # Só o convidado criado pelo /auth/demo-login pertence à demo e pode ser excluído.
            # Consultores (inclusive super consultores) que apenas estavam visualizando a demo
            # são usuários reais: têm o contexto de empresa liberado, nunca são apagados.
            users_ids = [int(u.id) for u in usuarios_na_empresa if u.id is not None and _is_convidado_demo(u)]
            usuarios_reais_ids = [int(u.id) for u in usuarios_na_empresa if u.id is not None and not _is_convidado_demo(u)]
            profiles_ids = [int(p.id) for p in session.exec(select(AccessProfile).where(AccessProfile.empresa_id == empresa_id)).all() if p.id is not None]

            # 1. Sessões, permissões, acessos e anexos
            if users_ids:
                users_ids_str = ",".join(str(x) for x in users_ids)
                session.execute(text(f"DELETE FROM user_sessions WHERE user_id IN ({users_ids_str})"))
                session.execute(text(f"DELETE FROM usuario_conta_acesso WHERE usuario_id IN ({users_ids_str})"))

            if profiles_ids:
                profiles_ids_str = ",".join(str(x) for x in profiles_ids)
                session.execute(text(f"DELETE FROM access_profile_permissions WHERE profile_id IN ({profiles_ids_str})"))

            session.execute(text("DELETE FROM anexos_lancamento WHERE empresa_id = :id"), {"id": empresa_id})

            # 2. Movimentos, Baixas, Lotes de Cartão e Regras
            session.execute(text("DELETE FROM baixas WHERE movimento_id IN (SELECT id FROM movimentos WHERE empresa_id = :id) OR lancamento_id IN (SELECT id FROM lancamentos WHERE empresa_id = :id)"), {"id": empresa_id})
            session.execute(text("DELETE FROM movimentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM lote_cartao_itens WHERE lote_cartao_id IN (SELECT id FROM lotes_cartao WHERE empresa_id = :id)"), {"id": empresa_id})
            session.execute(text("DELETE FROM lotes_cartao WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_cartao WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM lancamentos_cartao WHERE empresa_id = :id"), {"id": empresa_id})

            # 3. PDV e Estoque
            session.execute(text("DELETE FROM pdv_movimentacoes WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM pdv_venda_itens WHERE venda_id IN (SELECT id FROM pdv_vendas WHERE empresa_id = :id)"), {"id": empresa_id})
            session.execute(text("DELETE FROM pdv_vendas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM movimentacoes_estoque WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM fornecedor_produto_equivalencias WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM produtos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM pdv_ifood_lancamentos WHERE empresa_id = :id"), {"id": empresa_id})

            # 4. Outras Configurações, Metas e Alertas
            session.execute(text("DELETE FROM orcamentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM import_jobs WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM mapeamentos_categoria WHERE integracao_id IN (SELECT id FROM integracoes_bancarias WHERE empresa_id = :id)"), {"id": empresa_id})
            session.execute(text("DELETE FROM integracoes_bancarias WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM todo_items WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_comissao WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM metas_vendedores WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM alertas_anomalia WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM regras_silenciamento_auditor WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM consultor_empresa WHERE empresa_id = :id"), {"id": empresa_id})

            # 5. Entidades e Lançamentos Fundamentais
            session.execute(text("DELETE FROM audit_logs WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM lancamentos WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM cartoes WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM user_company_profiles WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM access_profiles WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM contas WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM centros_custo WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM entidades WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("UPDATE plano_contas SET conta_pai_id = NULL WHERE empresa_id = :id"), {"id": empresa_id})
            session.execute(text("DELETE FROM plano_contas WHERE empresa_id = :id"), {"id": empresa_id})
            if usuarios_reais_ids:
                session.execute(
                    text(f"UPDATE usuarios SET empresa_id = NULL WHERE id IN ({','.join(str(x) for x in usuarios_reais_ids)})")
                )
            if users_ids:
                session.execute(text(f"DELETE FROM usuarios WHERE id IN ({users_ids_str})"))

            # 6. Excluir a Empresa
            session.delete(empresa)
            total_removidas += 1
            logger.info("[DemoCleanup] Empresa {} removida com sucesso.", empresa_id)

        session.commit()
        logger.info("[DemoCleanup] Limpeza concluída: {} empresas removidas.", total_removidas)
        return total_removidas

    except Exception as e:
        session.rollback()
        logger.error("[DemoCleanup] Falha durante a limpeza: {}", e)
        raise
