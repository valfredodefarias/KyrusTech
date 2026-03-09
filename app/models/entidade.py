# app/models/entidade.py
from typing import Optional, List, TYPE_CHECKING
from sqlmodel import Field, Relationship, SQLModel
from .base_audit import AuditMixin

if TYPE_CHECKING:
    from .lancamento import Lancamento
    from .empresa import Empresa

class Entidade(AuditMixin, SQLModel, table=True):
    __tablename__ = "entidades"

    id: Optional[int] = Field(default=None, primary_key=True)
    nome: str = Field(index=True)
    tipo: str = Field(default="AMBOS", index=True) # CLIENTE, FORNECEDOR, AMBOS
    tipo_pessoa: str = Field(default="PJ", index=True) # PF, PJ
    nome_fantasia: Optional[str] = None
    cpf_cnpj: Optional[str] = Field(index=True)
    email: Optional[str] = None
    telefone: Optional[str] = None
    celular: Optional[str] = None
    contato_nome: Optional[str] = None
    cep: Optional[str] = None
    logradouro: Optional[str] = None
    numero: Optional[str] = None
    complemento: Optional[str] = None
    bairro: Optional[str] = None
    cidade: Optional[str] = None
    uf: Optional[str] = None
    observacoes: Optional[str] = None
    status: str = Field(default="ATIVO")
    
    empresa_id: int = Field(foreign_key="empresas.id", index=True)
    empresa: "Empresa" = Relationship(back_populates="entidades")
    
    lancamentos: List["Lancamento"] = Relationship(back_populates="entidade")