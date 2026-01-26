# app/models/anexo_lancamento.py

from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin  # Importando sua auditoria

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class AnexoLancamento(AuditMixin, SQLModel, table=True):
    __tablename__ = "anexos_lancamento"

    id: Optional[int] = Field(default=None, primary_key=True)
    
    # Metadados do Arquivo
    nome_arquivo: str = Field(index=True) # Ex: "NF-001.pdf"
    url: str = Field(description="URL pública ou caminho do arquivo no Storage")
    tipo: str = Field(default="OUTROS", index=True) # BOLETO, NOTA_FISCAL, COMPROVANTE
    tamanho_bytes: Optional[int] = None # Útil para controle de quota de disco
    content_type: Optional[str] = None # Ex: "application/pdf", "image/jpeg"

    # Chaves Estrangeiras
    lancamento_id: int = Field(foreign_key="lancamentos.id", index=True)
    empresa_id: int = Field(foreign_key="empresas.id", index=True) 

    # Relacionamentos
    lancamento: "Lancamento" = Relationship(back_populates="anexos")
    empresa: "Empresa" = Relationship()