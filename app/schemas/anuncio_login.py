from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict


# --- ANÚNCIOS ---
class AnuncioLoginBase(BaseModel):
    titulo: str
    empresa_nome: str
    logo_url: Optional[str] = None
    descricao: str
    cta_texto: Optional[str] = "Saiba Mais"
    link_url: str
    ordem: int = 0
    is_ativo: bool = True
    is_homologado: bool = False
    tem_beneficios_exclusivos: bool = False


class AnuncioLoginCreate(AnuncioLoginBase):
    pass


class AnuncioLoginUpdate(BaseModel):
    titulo: Optional[str] = None
    empresa_nome: Optional[str] = None
    logo_url: Optional[str] = None
    descricao: Optional[str] = None
    cta_texto: Optional[str] = None
    link_url: Optional[str] = None
    ordem: Optional[int] = None
    is_ativo: Optional[bool] = None
    is_homologado: Optional[bool] = None
    tem_beneficios_exclusivos: Optional[bool] = None


class AnuncioLoginRead(AnuncioLoginBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- NOTÍCIAS ---
class NoticiaLoginBase(BaseModel):
    titulo: str
    resumo: Optional[str] = None
    fonte: str
    categoria: Optional[str] = "Mercado"
    imagem_url: str
    link_url: Optional[str] = None
    data_publicacao: Optional[datetime] = None
    ordem: int = 0
    is_ativo: bool = True


class NoticiaLoginCreate(NoticiaLoginBase):
    pass


class NoticiaLoginUpdate(BaseModel):
    titulo: Optional[str] = None
    resumo: Optional[str] = None
    fonte: Optional[str] = None
    categoria: Optional[str] = None
    imagem_url: Optional[str] = None
    link_url: Optional[str] = None
    data_publicacao: Optional[datetime] = None
    ordem: Optional[int] = None
    is_ativo: Optional[bool] = None


class NoticiaLoginRead(NoticiaLoginBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- RESPOSTA PÚBLICA PARA A TELA DE LOGIN ---
class LoginPublicContentResponse(BaseModel):
    anuncios: List[AnuncioLoginRead]
    noticias: List[NoticiaLoginRead]
