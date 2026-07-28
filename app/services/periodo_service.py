# app/services/periodo_service.py

from datetime import date
from typing import Optional
from sqlmodel import Session
from app.models.empresa import Empresa

class PeriodoService:
    @staticmethod
    def obter_data_limite_bloqueio(db: Optional[Session], empresa_id: int) -> date:
        """
        Retorna a data limite de fechamento de período para a empresa.
        Se configurada na empresa (data_bloqueio_periodo), utiliza ela.
        Caso contrário, calcula dinamicamente o 1º dia do mês corrente (ex: 2026-07-01).
        """
        if db is not None:
            try:
                empresa = db.get(Empresa, empresa_id)
                if empresa and getattr(empresa, "data_bloqueio_periodo", None):
                    return empresa.data_bloqueio_periodo
            except Exception:
                pass
            
        today = date.today()
        # Retorna o 1º dia do mês corrente em aberto de forma 100% dinâmica
        return date(today.year, today.month, 1)

    @staticmethod
    def validar_e_ajustar_competencia(db: Optional[Session], empresa_id: int, data_alvo: Optional[date]) -> date:
        """
        Garante que data_alvo não invada períodos passados fechados.
        Se a data for anterior ao limite de bloqueio, ajusta dinamicamente para a data limite em aberto.
        """
        if not data_alvo:
            today = date.today()
            return date(today.year, today.month, 1)
            
        limite = PeriodoService.obter_data_limite_bloqueio(db, empresa_id)
        if data_alvo < limite:
            return limite
        return data_alvo
