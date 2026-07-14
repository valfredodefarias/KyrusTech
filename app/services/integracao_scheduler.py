from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from threading import Event

from loguru import logger
from sqlalchemy import or_, text
from sqlmodel import Session, select

from app.db.session import engine
from app.models.integracao_bancaria import IntegracaoBancaria
from app.services.integracao_asaas import sincronizar_asaas
from app.services.integracao_nfstock import sincronizar_nfstock


SCHEDULER_POLL_SECONDS = 60
SCHEDULER_LEADER_LOCK_ID = 24030902


def _to_utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def cleanup_old_idempotency_logs(db: Session) -> None:
    """Remove logs de idempotência mais antigos que 3 dias para economizar espaço no BD."""
    try:
        cutoff = datetime.utcnow() - timedelta(days=3)
        statement = text("DELETE FROM idempotency_logs WHERE created_at < :cutoff")
        result = db.execute(statement, {"cutoff": cutoff})
        db.commit()
        if result.rowcount > 0:
            logger.info("[Scheduler] Limpeza de idempotência: {} registros antigos deletados", result.rowcount)
    except Exception as exc:
        logger.error("[Scheduler] Falha ao limpar logs de idempotência: {}", exc)


def run_due_integracoes_sync() -> None:
    now = datetime.utcnow()
    due_integracoes_data = []

    with Session(engine) as db:
        lock_row = db.exec(text(f"SELECT pg_try_advisory_lock({SCHEDULER_LEADER_LOCK_ID})")).first()
        lock_acquired = bool(lock_row[0]) if lock_row else False
        if not lock_acquired:
            logger.debug("[Scheduler] Outro worker já está executando o ciclo de integrações")
            return

        try:
            cleanup_old_idempotency_logs(db)
            due_integracoes = db.exec(
                select(IntegracaoBancaria).where(
                    IntegracaoBancaria.is_deleted == False,
                    IntegracaoBancaria.ativo == True,
                    IntegracaoBancaria.sincronizar_automaticamente == True,
                    IntegracaoBancaria.tipo.in_(["ASAAS", "NFSTOCK"]),
                    or_(
                        IntegracaoBancaria.proxima_sincronizacao.is_(None),
                        IntegracaoBancaria.proxima_sincronizacao <= now,
                    ),
                )
            ).all()
            for integ in due_integracoes:
                due_integracoes_data.append({
                    "id": integ.id,
                    "tipo": integ.tipo,
                    "empresa_id": integ.empresa_id,
                })
        except Exception as exc:
            logger.error(f"[Scheduler] Erro ao carregar integrações devidas: {exc}")
            return
        finally:
            db.exec(text(f"SELECT pg_advisory_unlock({SCHEDULER_LEADER_LOCK_ID})"))

    for integ_info in due_integracoes_data:
        with Session(engine) as db_sync:
            try:
                integracao = db_sync.get(IntegracaoBancaria, integ_info["id"])
                if not integracao or not integracao.ativo or integracao.is_deleted:
                    continue

                tipo_upper = str(integracao.tipo or "").upper()
                if tipo_upper == "ASAAS":
                    logger.info(
                        "[Scheduler] Sincronizando integração Asaas id={} empresa_id={}",
                        integracao.id,
                        integracao.empresa_id,
                    )
                    sincronizar_asaas(
                        db=db_sync,
                        integracao=integracao,
                        data_inicio=None,
                        data_fim=now.date(),
                    )
                elif tipo_upper == "NFSTOCK":
                    logger.info(
                        "[Scheduler] Sincronizando integração NFStock id={} empresa_id={}",
                        integracao.id,
                        integracao.empresa_id,
                    )
                    sincronizar_nfstock(
                        db=db_sync,
                        integracao=integracao,
                        dry_run=False,
                    )
            except Exception as exc:
                logger.error(
                    "[Scheduler] Falha ao sincronizar integração id={} tipo={} empresa_id={}: {}",
                    integ_info["id"],
                    integ_info["tipo"],
                    integ_info["empresa_id"],
                    exc,
                )


async def run_integracao_scheduler(stop_event: Event) -> None:
    logger.info("[Scheduler] Worker de integração (Asaas/NFStock) iniciado")
    while not stop_event.is_set():
        try:
            # Isola chamadas bloqueantes (DB + HTTP externo) fora do event loop.
            await asyncio.to_thread(run_due_integracoes_sync)
        except Exception as exc:
            logger.error("[Scheduler] Erro no ciclo do scheduler Asaas: {}", exc)
        await asyncio.sleep(SCHEDULER_POLL_SECONDS)
    logger.info("[Scheduler] Worker de integração (Asaas/NFStock) finalizado")
