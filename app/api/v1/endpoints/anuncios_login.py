from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.db.session import get_db
from app.models.usuario import Usuario
from app.api.v1.deps import get_super_consultor_user
from app.crud.crud_anuncio_login import crud_anuncio_login
from app.schemas.anuncio_login import (
    AnuncioLoginCreate,
    AnuncioLoginUpdate,
    AnuncioLoginRead,
    NoticiaLoginCreate,
    NoticiaLoginUpdate,
    NoticiaLoginRead,
    LoginPublicContentResponse,
)

router = APIRouter()


# --- PÚBLICO (TELA DE LOGIN) ---
@router.get("/public", response_model=LoginPublicContentResponse)
def get_login_public_content(db: Session = Depends(get_db)):
    """
    Retorna os anúncios ativos e as 3 notícias selecionadas para o rodízio do dia.
    Endpoint público acessível sem token de autenticação.
    """
    return crud_anuncio_login.get_public_content(db)


# --- ADMIN: ANÚNCIOS (SUPER_CONSULTOR ONLY) ---
@router.get("/admin/anuncios", response_model=List[AnuncioLoginRead])
def list_admin_anuncios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Lista todos os anúncios cadastrados (ativos e inativos). Exclusivo Super Consultor."""
    return crud_anuncio_login.list_anuncios(db, include_inativos=True)


@router.post("/admin/anuncios", response_model=AnuncioLoginRead, status_code=status.HTTP_201_CREATED)
def create_admin_anuncio(
    payload: AnuncioLoginCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Cria um novo anúncio publicitário. Exclusivo Super Consultor."""
    return crud_anuncio_login.create_anuncio(db, payload, user_id=current_user.id)


@router.patch("/admin/anuncios/{anuncio_id}", response_model=AnuncioLoginRead)
def update_admin_anuncio(
    anuncio_id: int,
    payload: AnuncioLoginUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Atualiza dados ou ativação de um anúncio. Exclusivo Super Consultor."""
    updated = crud_anuncio_login.update_anuncio(db, anuncio_id, payload, user_id=current_user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anúncio não encontrado.")
    return updated


@router.delete("/admin/anuncios/{anuncio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_anuncio(
    anuncio_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Exclui logicamente um anúncio. Exclusivo Super Consultor."""
    success = crud_anuncio_login.delete_anuncio(db, anuncio_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anúncio não encontrado.")
    return None


# --- ADMIN: NOTÍCIAS & FONTES (SUPER_CONSULTOR ONLY) ---
@router.get("/admin/noticias", response_model=List[NoticiaLoginRead])
def list_admin_noticias(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Lista todas as notícias cadastradas no feed da tela de login. Exclusivo Super Consultor."""
    return crud_anuncio_login.list_noticias(db, include_inativos=True)


@router.post("/admin/noticias", response_model=NoticiaLoginRead, status_code=status.HTTP_201_CREATED)
def create_admin_noticia(
    payload: NoticiaLoginCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Cria uma nova notícia no rodízio. Exclusivo Super Consultor."""
    return crud_anuncio_login.create_noticia(db, payload, user_id=current_user.id)


@router.patch("/admin/noticias/{noticia_id}", response_model=NoticiaLoginRead)
def update_admin_noticia(
    noticia_id: int,
    payload: NoticiaLoginUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Atualiza dados ou ativa/desativa uma matéria do rodízio. Exclusivo Super Consultor."""
    updated = crud_anuncio_login.update_noticia(db, noticia_id, payload, user_id=current_user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notícia não encontrada.")
    return updated


@router.delete("/admin/noticias/{noticia_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_noticia(
    noticia_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Exclui logicamente uma notícia do rodízio. Exclusivo Super Consultor."""
    success = crud_anuncio_login.delete_noticia(db, noticia_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notícia não encontrada.")
    return None


@router.post("/admin/noticias/sync-g1", response_model=List[NoticiaLoginRead])
def sync_g1_noticias(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_super_consultor_user),
):
    """Sincroniza notícias em tempo real diretamente do feed RSS do G1 Economia. Exclusivo Super Consultor."""
    return crud_anuncio_login.fetch_and_sync_g1_noticias(db, max_items=6, user_id=current_user.id)

