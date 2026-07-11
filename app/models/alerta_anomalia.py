from __future__ import annotations

from typing import Optional, Any
from sqlmodel import Field, SQLModel
from datetime import datetime
from sqlalchemy import JSON, Column
from .base_audit import AuditMixin

class AlertaAnomalia(AuditMixin, SQLModel, table=True):
    __tablename__ = "alertas_anomalia"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Relação com o registro auditado (Polimórfico)
    tipo_objeto: str = Field(index=True)      # "lancamento", "movimento", "baixa"
    objeto_id: int = Field(index=True)        # ID do registro correspondente
    
    # Detalhes da Anomalia
    tipo_anomalia: str = Field(index=True)    # DUPLICIDADE_OFX, VALOR_ATIPICO, PAGAMENTO_DUPLO, HORARIO_ATIPICO, EXCLUSAO_SUSPEITA
    gravidade: str = Field(default="ALTA", index=True) # BAIXA, MEDIA, ALTA, CRITICA
    descricao: str
    dados_extras: Optional[Any] = Field(default=None, sa_column=Column(JSON)) # Ex: {"media": 100.0, "desvio_padrao": 15.0, "valor_atual": 250.0}
    
    # Controle de Resolução
    status: str = Field(default="PENDENTE", index=True) # PENDENTE, IGNORADO, RESOLVIDO
    motivo_resolucao: Optional[str] = None
    resolvido_por_id: Optional[int] = Field(default=None, foreign_key="usuarios.id", nullable=True)
    resolvido_em: Optional[datetime] = Field(default=None, nullable=True)
    
    # Multitenancy
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
