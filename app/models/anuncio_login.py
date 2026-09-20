from __future__ import annotations

from typing import ClassVar, Optional
from datetime import datetime
from sqlmodel import Field, SQLModel
from app.models.base_audit import AuditMixin, utcnow


class AnuncioLogin(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "anuncios_login"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    titulo: str = Field(description="Título ou chamada do anúncio")
    empresa_nome: str = Field(index=True, description="Nome da empresa anunciante")
    logo_url: Optional[str] = Field(default=None, description="URL ou path da logo da empresa")
    descricao: str = Field(description="Texto publicitário ou descritivo")
    cta_texto: Optional[str] = Field(default="Saiba Mais", description="Texto do botão ou link de ação")
    link_url: str = Field(description="Link de destino do anunciante")
    ordem: int = Field(default=0, description="Ordem de exibição prioritária")
    is_ativo: bool = Field(default=True, index=True, description="Status de ativação do anúncio")
    is_homologado: bool = Field(default=False, description="Se o patrocinador possui homologação técnica verificada")
    tem_beneficios_exclusivos: bool = Field(default=False, description="Se a parceria oferece benefícios exclusivos aos usuários KyrusTECH")


class NoticiaLogin(AuditMixin, SQLModel, table=True):
    __tablename__: ClassVar[str] = "noticias_login"  # type: ignore[assignment]

    id: Optional[int] = Field(default=None, primary_key=True)
    titulo: str = Field(description="Título/Manchete da notícia")
    resumo: Optional[str] = Field(default=None, description="Breve resumo da notícia")
    fonte: str = Field(index=True, description="Nome do portal ou fonte da notícia")
    categoria: Optional[str] = Field(default="Mercado", description="Categoria da matéria (Ex: Mercado, Gestão, Tecnologia)")
    imagem_url: str = Field(description="URL da imagem em destaque")
    link_url: Optional[str] = Field(default=None, description="Link para a matéria completa")
    data_publicacao: datetime = Field(default_factory=utcnow, description="Data/hora de publicação da matéria")
    ordem: int = Field(default=0, description="Ordem ou peso de exibição")
    is_ativo: bool = Field(default=True, index=True, description="Se a matéria está ativa no rodízio diário")
