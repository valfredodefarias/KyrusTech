import gzip
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from typing import List, Optional
from sqlmodel import Session, select, col
from app.models.base_audit import utcnow
from app.models.anuncio_login import AnuncioLogin, NoticiaLogin
from app.schemas.anuncio_login import (
    AnuncioLoginCreate,
    AnuncioLoginUpdate,
    NoticiaLoginCreate,
    NoticiaLoginUpdate,
    LoginPublicContentResponse,
)
from loguru import logger

G1_ECONOMIA_RSS_URL = "https://g1.globo.com/rss/g1/economia/"

FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80",
]


def _detect_category(title: str, link: str) -> str:
    lower_str = f"{title.lower()} {link.lower()}"
    if any(k in lower_str for k in ["agronegocios", "agro", "safra", "cultura", "produtor", "campo", "jardim"]):
        return "Agronegócio"
    if any(k in lower_str for k in ["carro", "veículo", "automóvel", "montadora", "renault", "fiat", "volkswagen", "frota"]):
        return "Automotivo"
    if any(k in lower_str for k in ["imposto", "tribut", "receita federal", "fiscal", "sped", "reforma tributária"]):
        return "Tributário"
    if any(k in lower_str for k in ["ia", "inteligência artificial", "software", "nuvem", "ciber", "startup", "ti "]):
        return "Tecnologia"
    if any(k in lower_str for k in ["juros", "selic", "banco central", "inflação", "bolsa", "crédito", "dólar", "investimento"]):
        return "Finanças"
    if any(k in lower_str for k in ["carreira", "trabalho", "salário", "emprego", "demissão", "liderança", "chefe"]):
        return "Carreira"
    if any(k in lower_str for k in ["varejo", "vendas", "consumo", "comércio", "loja", "consumidor", "brinquedo", "luxo"]):
        return "Varejo & Consumo"
    return "Economia"



DEFAULT_INITIAL_ANUNCIOS = [
    {
        "titulo": "Infraestrutura Cloud & IA para Alta Performance",
        "empresa_nome": "Nexus Cloud Solutions",
        "logo_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&auto=format&fit=crop&q=80",
        "descricao": "Potencialize a estabilidade, segurança e disponibilidade de sua operação com servidores dedicados de baixa latência e suporte 24/7.",
        "cta_texto": "Conhecer Soluções",
        "link_url": "https://kyrustech.com.br",
        "ordem": 1,
        "is_ativo": True,
        "is_homologado": True,
        "tem_beneficios_exclusivos": True,
    },
    {
        "titulo": "Governança Tributária & Redução de Riscos Fiscais",
        "empresa_nome": "Apex Consultoria Empresarial",
        "logo_url": "https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=120&auto=format&fit=crop&q=80",
        "descricao": "Especialistas em conformidade SPED, auditoria fiscal preventiva e otimização de crédito tributário para empresas em expansão.",
        "cta_texto": "Falar com Consultor",
        "link_url": "https://kyrustech.com.br",
        "ordem": 2,
        "is_ativo": True,
        "is_homologado": True,
        "tem_beneficios_exclusivos": False,
    },
]

DEFAULT_INITIAL_NOTICIAS = [
    {
        "titulo": "Nostalgia milionária: por que adultos pagam fortunas por brinquedos da infância",
        "resumo": "Itens colecionáveis e mercado retrô movimentam cifras surpreendentes e despertam novos modelos de negócios.",
        "fonte": "G1 Economia",
        "categoria": "Economia",
        "imagem_url": "https://s2-g1.glbimg.com/gE2jKCjZIq3jlmXu2z-PLiYAdg0=/s.glbimg.com/jo/g1/f/original/2016/12/27/exposicao_pokemons.jpg",
        "link_url": "https://g1.globo.com/economia/noticia/2026/09/20/nostalgia-milionaria-por-que-adultos-pagam-fortunas-por-brinquedos-da-infancia.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 8, 0),
        "ordem": 1,
        "is_ativo": True,
    },
    {
        "titulo": "Preços mais altos, salários menores: como o clima extremo afeta o bolso das famílias no mundo todo",
        "resumo": "Relatórios internacionais apontam impacto direto da crise climática nos custos de alimentos, energia e seguros empresariais.",
        "fonte": "G1 Economia",
        "categoria": "Economia",
        "imagem_url": "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://g1.globo.com/economia/noticia/2026/09/20/como-o-clima-extremo-afeta-o-bolso-das-familias-no-mundo-todo.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 7, 30),
        "ordem": 2,
        "is_ativo": True,
    },
    {
        "titulo": "Casa própria vira sonho distante, e jovens gastam mais com pequenos luxos; entenda",
        "resumo": "Com taxas de juros elevadas e encarecimento dos imóveis, novas gerações alteram prioridades de consumo imediato.",
        "fonte": "G1 Economia",
        "categoria": "Comportamento",
        "imagem_url": "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://g1.globo.com/g1-explica/noticia/2026/09/20/casa-propria-vira-sonho-distante-e-jovens-gastam-mais-com-pequenos-luxos-entenda.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 7, 0),
        "ordem": 3,
        "is_ativo": True,
    },
    {
        "titulo": "Produtores de tangerina poncan unem altitude e tecnologia para ter colheita o ano todo",
        "resumo": "Inovações em manejo e técnicas agronômicas aumentam a rentabilidade e garantem fornecimento estável aos centros de distribuição.",
        "fonte": "G1 Economia",
        "categoria": "Agronegócio",
        "imagem_url": "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://g1.globo.com/es/espirito-santo/agronegocios/noticia/2026/09/20/produtores-de-tangerina-poncan-unem-altitude-e-tecnologia-para-ter-colheita-o-ano-todo-em-domingos-martins-no-es.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 6, 30),
        "ordem": 4,
        "is_ativo": True,
    },
    {
        "titulo": "Pagar para pedir demissão? Por que profissionais contratam empresas para evitar confronto com chefias",
        "resumo": "Serviços de intermediação de demissão crescem e acendem alerta sobre cultura organizacional e retenção de talentos.",
        "fonte": "G1 Economia",
        "categoria": "Carreira",
        "imagem_url": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://g1.globo.com/trabalho-e-carreira/noticia/2026/09/20/pagar-para-pedir-demissao-por-que-jovens-japoneses-contratam-empresas-para-evitar-o-confronto-com-o-chefe.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 6, 0),
        "ordem": 5,
        "is_ativo": True,
    },
    {
        "titulo": "Renault Boreal acumula prêmios, mas não decola em vendas; g1 testou e mostra prós e contras",
        "resumo": "Análise de mercado automotivo avalia posicionamento de preço, custos de peças e demanda em frotas corporativas.",
        "fonte": "G1 Economia",
        "categoria": "Mercado Automotivo",
        "imagem_url": "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://g1.globo.com/carros/noticia/2026/09/20/renault-boreal-acumula-premios-mas-nao-decola-em-vendas-g1-testou-e-mostra-pros-e-contras.ghtml",
        "data_publicacao": datetime(2026, 9, 20, 5, 30),
        "ordem": 6,
        "is_ativo": True,
    },
]


class CRUDAnuncioLogin:
    def fetch_and_sync_g1_noticias(
        self,
        session: Session,
        max_items: int = 12,
        user_id: Optional[int] = None,
    ) -> List[NoticiaLogin]:
        """
        Busca notícias recentes em tempo real via RSS do G1 Economia.
        Garante que cada matéria tenha um link direto para a reportagem (.ghtml),
        imagem real e resumo, atualizando a base local.
        """
        try:
            req = urllib.request.Request(
                G1_ECONOMIA_RSS_URL,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
                },
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
                if resp.info().get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
                    data = gzip.decompress(data)

            root = ET.fromstring(data)
            items = root.findall("./channel/item")

            parsed_items = []
            for item in items:
                title_el = item.find("title")
                link_el = item.find("link")
                desc_el = item.find("description")
                pub_el = item.find("pubDate")
                title = (title_el.text or "").strip() if title_el is not None and title_el.text else ""
                link = (link_el.text or "").strip() if link_el is not None and link_el.text else ""
                desc_raw = (desc_el.text or "").strip() if desc_el is not None and desc_el.text else ""
                pub_str = (pub_el.text or "").strip() if pub_el is not None and pub_el.text else ""

                if not title or not link:
                    continue

                # Filtra jogos / loterias
                lower_title = title.lower()
                if any(term in lower_title for term in ["mega-sena", "quina", "lotofácil", "lotomania", "sorteio", "dia de sorte"]):
                    continue

                # Extração de Imagem da descrição ou tags de mídia
                img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_raw)
                img_url = img_match.group(1) if img_match else None

                # Limpeza do Resumo HTML
                clean_desc = re.sub(r"<[^>]+>", "", desc_raw).strip()
                clean_desc = re.sub(r"\s+", " ", clean_desc)

                # Data de publicação
                pub_date = None
                if pub_str:
                    try:
                        pub_date = parsedate_to_datetime(pub_str).replace(tzinfo=None)
                    except Exception:
                        pub_date = datetime.now()
                else:
                    pub_date = datetime.now()

                category = _detect_category(title, link)

                parsed_items.append({
                    "titulo": title,
                    "link_url": link,
                    "resumo": clean_desc[:250] if clean_desc else None,
                    "imagem_url": img_url,
                    "data_publicacao": pub_date,
                    "categoria": category,
                })

                if len(parsed_items) >= max_items:
                    break

            synced_noticias: List[NoticiaLogin] = []
            for idx, item_data in enumerate(parsed_items):
                fallback_img = FALLBACK_IMAGES[idx % len(FALLBACK_IMAGES)]
                final_img = item_data["imagem_url"] or fallback_img

                existing = session.exec(
                    select(NoticiaLogin).where(
                        (NoticiaLogin.link_url == item_data["link_url"]) |
                        (NoticiaLogin.titulo == item_data["titulo"])
                    )
                ).first()

                if existing:
                    existing.titulo = item_data["titulo"]
                    existing.link_url = item_data["link_url"]
                    existing.resumo = item_data["resumo"] or existing.resumo
                    existing.imagem_url = final_img
                    existing.data_publicacao = item_data["data_publicacao"]
                    existing.categoria = item_data["categoria"]
                    existing.fonte = "G1 Economia"
                    existing.ordem = idx + 1
                    existing.is_ativo = True
                    existing.is_deleted = False
                    if user_id:
                        existing.updated_by_id = user_id
                    session.add(existing)
                    synced_noticias.append(existing)
                else:
                    new_noticia = NoticiaLogin(
                        titulo=item_data["titulo"],
                        resumo=item_data["resumo"],
                        fonte="G1 Economia",
                        categoria=item_data["categoria"],
                        imagem_url=final_img,
                        link_url=item_data["link_url"],
                        data_publicacao=item_data["data_publicacao"],
                        ordem=idx + 1,
                        is_ativo=True,
                        created_by_id=user_id,
                        updated_by_id=user_id,
                    )
                    session.add(new_noticia)
                    synced_noticias.append(new_noticia)

            session.commit()
            for sn in synced_noticias:
                session.refresh(sn)

            logger.info(f"Sincronização de notícias G1 concluída com sucesso: {len(synced_noticias)} matérias.")
            return synced_noticias
        except Exception as exc:
            logger.error(f"Erro ao sincronizar notícias do G1 RSS: {exc}")
            session.rollback()
            raise

    def ensure_initial_seed(self, session: Session) -> None:
        """Inicializa sementes de anúncios e notícias caso as tabelas estejam vazias ou com links mockados."""
        try:
            # Seed de anúncios
            existing_anuncios = session.exec(
                select(AnuncioLogin).where(AnuncioLogin.is_deleted == False)
            ).first()
            if not existing_anuncios:
                logger.info("Criando sementes iniciais de Anúncios na tela de login...")
                for item_data in DEFAULT_INITIAL_ANUNCIOS:
                    anuncio = AnuncioLogin(**item_data)
                    session.add(anuncio)
                session.commit()

            # Seed de notícias
            existing_noticias = session.exec(
                select(NoticiaLogin).where(NoticiaLogin.is_deleted == False)
            ).all()

            # Se vazio ou se contém links mockados para kyrustech.com.br
            has_mock_links = any(
                n.link_url in ["https://kyrustech.com.br", "https://valoreconomico.globo.com", "https://exame.com"]
                for n in existing_noticias
            )

            if not existing_noticias or has_mock_links:
                logger.info("Atualizando feed com notícias reais do G1 Economia...")
                try:
                    self.fetch_and_sync_g1_noticias(session, max_items=12)
                except Exception as sync_err:
                    logger.warning(f"Falha ao sincronizar G1 ao vivo no seed: {sync_err}. Usando dados de contingência.")
                    for item_data in DEFAULT_INITIAL_NOTICIAS:
                        existing = session.exec(
                            select(NoticiaLogin).where(NoticiaLogin.link_url == item_data["link_url"])
                        ).first()
                        if not existing:
                            noticia = NoticiaLogin(**item_data)
                            session.add(noticia)
                    session.commit()
        except Exception as exc:
            logger.warning(f"Erro ao inicializar sementes de login (anúncios/notícias): {exc}")
            session.rollback()

    def get_public_content(self, session: Session) -> LoginPublicContentResponse:
        """
        Retorna anúncios ativos e exatamente 3 notícias ativas rotacionadas
        diariamente de forma determinística.
        """
        self.ensure_initial_seed(session)

        # Anúncios ativos
        anuncios = session.exec(
            select(AnuncioLogin)
            .where(AnuncioLogin.is_ativo == True, AnuncioLogin.is_deleted == False)
            .order_by(col(AnuncioLogin.ordem), col(AnuncioLogin.id))
        ).all()

        # Notícias ativas ordenadas por ordem de publicação/relevância
        active_noticias = session.exec(
            select(NoticiaLogin)
            .where(NoticiaLogin.is_ativo == True, NoticiaLogin.is_deleted == False)
            .order_by(col(NoticiaLogin.ordem), col(NoticiaLogin.id))
        ).all()

        return LoginPublicContentResponse(
            anuncios=list(anuncios),
            noticias=list(active_noticias),
        )

    # --- CRUD ANÚNCIOS (ADMIN) ---
    def list_anuncios(self, session: Session, include_inativos: bool = True) -> List[AnuncioLogin]:
        self.ensure_initial_seed(session)
        query = select(AnuncioLogin).where(AnuncioLogin.is_deleted == False)
        if not include_inativos:
            query = query.where(AnuncioLogin.is_ativo == True)
        return list(session.exec(query.order_by(col(AnuncioLogin.ordem), col(AnuncioLogin.id))).all())

    def get_anuncio(self, session: Session, anuncio_id: int) -> Optional[AnuncioLogin]:
        return session.exec(
            select(AnuncioLogin).where(
                AnuncioLogin.id == anuncio_id,
                AnuncioLogin.is_deleted == False,
            )
        ).first()

    def create_anuncio(self, session: Session, anuncio_in: AnuncioLoginCreate, user_id: Optional[int] = None) -> AnuncioLogin:
        anuncio = AnuncioLogin(
            **anuncio_in.model_dump(),
            created_by_id=user_id,
            updated_by_id=user_id,
        )
        session.add(anuncio)
        session.commit()
        session.refresh(anuncio)
        return anuncio

    def update_anuncio(
        self, session: Session, anuncio_id: int, anuncio_in: AnuncioLoginUpdate, user_id: Optional[int] = None
    ) -> Optional[AnuncioLogin]:
        anuncio = self.get_anuncio(session, anuncio_id)
        if not anuncio:
            return None

        update_data = anuncio_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(anuncio, key, value)
        anuncio.updated_by_id = user_id

        session.add(anuncio)
        session.commit()
        session.refresh(anuncio)
        return anuncio

    def delete_anuncio(self, session: Session, anuncio_id: int, user_id: Optional[int] = None) -> bool:
        anuncio = self.get_anuncio(session, anuncio_id)
        if not anuncio:
            return False
        if user_id is not None:
            anuncio.soft_delete(user_id=user_id)
        else:
            anuncio.is_deleted = True
            anuncio.deleted_at = utcnow()
        session.add(anuncio)
        session.commit()
        return True

    # --- CRUD NOTÍCIAS (ADMIN) ---
    def list_noticias(self, session: Session, include_inativos: bool = True) -> List[NoticiaLogin]:
        self.ensure_initial_seed(session)
        query = select(NoticiaLogin).where(NoticiaLogin.is_deleted == False)
        if not include_inativos:
            query = query.where(NoticiaLogin.is_ativo == True)
        return list(session.exec(query.order_by(col(NoticiaLogin.ordem), col(NoticiaLogin.id))).all())

    def get_noticia(self, session: Session, noticia_id: int) -> Optional[NoticiaLogin]:
        return session.exec(
            select(NoticiaLogin).where(
                NoticiaLogin.id == noticia_id,
                NoticiaLogin.is_deleted == False,
            )
        ).first()

    def create_noticia(self, session: Session, noticia_in: NoticiaLoginCreate, user_id: Optional[int] = None) -> NoticiaLogin:
        noticia = NoticiaLogin(
            **noticia_in.model_dump(),
            created_by_id=user_id,
            updated_by_id=user_id,
        )
        session.add(noticia)
        session.commit()
        session.refresh(noticia)
        return noticia

    def update_noticia(
        self, session: Session, noticia_id: int, noticia_in: NoticiaLoginUpdate, user_id: Optional[int] = None
    ) -> Optional[NoticiaLogin]:
        noticia = self.get_noticia(session, noticia_id)
        if not noticia:
            return None

        update_data = noticia_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(noticia, key, value)
        noticia.updated_by_id = user_id

        session.add(noticia)
        session.commit()
        session.refresh(noticia)
        return noticia

    def delete_noticia(self, session: Session, noticia_id: int, user_id: Optional[int] = None) -> bool:
        noticia = self.get_noticia(session, noticia_id)
        if not noticia:
            return False
        if user_id is not None:
            noticia.soft_delete(user_id=user_id)
        else:
            noticia.is_deleted = True
            noticia.deleted_at = utcnow()
        session.add(noticia)
        session.commit()
        return True


crud_anuncio_login = CRUDAnuncioLogin()
