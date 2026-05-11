from __future__ import annotations

import asyncio
from datetime import datetime, timezone
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


def run_due_integracoes_sync() -> None:
    now = datetime.utcnow()
    with Session(engine) as db:
        lock_row = db.exec(text(f"SELECT pg_try_advisory_lock({SCHEDULER_LEADER_LOCK_ID})")).first()
        lock_acquired = bool(lock_row[0]) if lock_row else False
        if not lock_acquired:
            logger.debug("[Scheduler] Outro worker já está executando o ciclo de integrações")
            return

        try:
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

            for integracao in due_integracoes:
                try:
                    if str(integracao.tipo or "").upper() == "ASAAS":
                        logger.info(
                            "[Scheduler] Sincronizando integração Asaas id={} empresa_id={}",
                            integracao.id,
                            integracao.empresa_id,
                        )
                        sincronizar_asaas(
                            db=db,
                            integracao=integracao,
                            data_inicio=None,
                            data_fim=now.date(),
                        )
                    elif str(integracao.tipo or "").upper() == "NFSTOCK":
                        logger.info(
                            "[Scheduler] Sincronizando integração NFStock id={} empresa_id={}",
                            integracao.id,
                            integracao.empresa_id,
                        )
                        sincronizar_nfstock(
                            db=db,
                            integracao=integracao,
                            dry_run=False,
                        )
                except Exception as exc:
                    logger.error(
                        "[Scheduler] Falha ao sincronizar integração id={} tipo={} empresa_id={}: {}",
                        integracao.id,
                        integracao.tipo,
                        integracao.empresa_id,
                        exc,
                    )
        finally:
            db.exec(text(f"SELECT pg_advisory_unlock({SCHEDULER_LEADER_LOCK_ID})"))


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
