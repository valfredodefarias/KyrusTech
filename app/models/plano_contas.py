# app/models/plano_contas.py

from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .empresa import Empresa
    from .lancamento import Lancamento
    from .mapeamento_categoria import MapeamentoCategoria

class PlanoContas(AuditMixin, SQLModel, table=True):
    __tablename__ = "plano_contas"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Estrutura
    nome: str = Field(index=True)
    codigo: Optional[str] = Field(index=True) # Hierarquia: "1.01.002"
    tipo: str = Field(index=True)  # 'R' (Receita) ou 'D' (Despesa)
    
    # --- Novas Regras de Negócio ---
    
    # Se True, é apenas um agrupador (Ex: "1. Despesas Operacionais").
    # O Frontend deve bloquear a seleção deste item em lançamentos.
    eh_cabecalho: bool = Field(default=False) 
    
    # Identifica se a categoria se refere a empréstimos/dívidas (Passivo)
    # Útil para relatórios de endividamento.
    eh_divida: bool = Field(default=False) 
    
    permite_lancamentos: bool = Field(default=True)
    eh_operacional: bool = Field(default=True)
    considerar_nos_resultados: bool = Field(default=True)
    dre_grupo: str = Field(default="DESPESAS_OPERACIONAIS", index=True)
    oculta: bool = Field(default=False, index=True)
    
    # Hierarquia (Auto-relacionamento)
    conta_pai_id: Optional[int] = Field(default=None, foreign_key="plano_contas.id")
    
    # Multi-tenant
    empresa_id: int = Field(foreign_key="empresas.id", index=True)

    # Relacionamentos
    empresa: "Empresa" = Relationship(back_populates="plano_contas")
    
    conta_pai: Optional["PlanoContas"] = Relationship(
        back_populates="contas_filhas",
        sa_relationship_kwargs={"remote_side": "PlanoContas.id"}
    )
    contas_filhas: List["PlanoContas"] = Relationship(back_populates="conta_pai")
    
    # Para integrações (Saber onde jogar a taxa do Asaas, por exemplo)
    mapeamentos: List["MapeamentoCategoria"] = Relationship(back_populates="plano_contas")