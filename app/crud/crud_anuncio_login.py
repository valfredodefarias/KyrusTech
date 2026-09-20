import gzip
import html
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional
from sqlmodel import Session, select, col
from app.models.base_audit import utcnow
from app.models.anuncio_login import AnuncioLogin, NoticiaLogin, FonteNoticiaLogin
from app.schemas.anuncio_login import (
    AnuncioLoginCreate,
    AnuncioLoginUpdate,
    NoticiaLoginCreate,
    NoticiaLoginUpdate,
    FonteNoticiaLoginCreate,
    FonteNoticiaLoginUpdate,
    LoginPublicContentResponse,
)
from loguru import logger

G1_ECONOMIA_RSS_URL = "https://g1.globo.com/rss/g1/economia/"
CNN_BRASIL_RSS_URL = "https://www.cnnbrasil.com.br/feed/"

FALLBACK_IMAGES = [
    "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop&q=80",
    "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80",
]


def _detect_category(title: str, link: str, default_cat: str = "Economia") -> str:
    lower_str = f"{title.lower()} {link.lower()}"
    if any(k in lower_str for k in ["agronegocios", "agro", "safra", "cultura", "produtor", "campo", "jardim"]):
        return "Agronegócio"
    if any(k in lower_str for k in ["carro", "veículo", "automóvel", "montadora", "renault", "fiat", "volkswagen", "frota"]):
        return "Automotivo"
    if any(k in lower_str for k in ["imposto", "tribut", "receita federal", "fiscal", "sped", "reforma tributária"]):
        return "Tributário"
    if any(k in lower_str for k in ["ia", "inteligência artificial", "software", "nuvem", "ciber", "startup", "ti "]):
        return "Tecnologia"
    if any(k in lower_str for k in ["juros", "selic", "banco central", "inflação", "bolsa", "crédito", "dólar", "investimento", "mercado financeiro"]):
        return "Finanças"
    if any(k in lower_str for k in ["carreira", "trabalho", "salário", "emprego", "demissão", "liderança", "chefe"]):
        return "Carreira"
    if any(k in lower_str for k in ["varejo", "vendas", "consumo", "comércio", "loja", "consumidor", "brinquedo", "luxo"]):
        return "Varejo & Consumo"
    return default_cat or "Economia"


DEFAULT_INITIAL_FONTES = [
    {
        "nome": "G1 Economia",
        "tipo": "rss",
        "rss_url": "https://g1.globo.com/rss/g1/economia/",
        "site_url": "https://g1.globo.com/economia/",
        "categoria_padrao": "Economia",
        "badge_texto": "G1",
        "badge_cor": "red",
        "descricao": "Feed oficial de economia, finanças, mercado e negócios do G1 Globo.",
        "ordem": 1,
        "is_ativo": True,
    },
    {
        "nome": "CNN Brasil",
        "tipo": "rss",
        "rss_url": "https://www.cnnbrasil.com.br/feed/",
        "site_url": "https://www.cnnbrasil.com.br/economia/",
        "categoria_padrao": "Economia",
        "badge_texto": "CNN",
        "badge_cor": "rose",
        "descricao": "Notícias em tempo real, mercado financeiro, negócios e conjuntura econômica da CNN Brasil.",
        "ordem": 2,
        "is_ativo": True,
    },
    {
        "nome": "Editorial Kyrus & Avisos",
        "tipo": "manual",
        "rss_url": None,
        "site_url": "https://kyrustech.com.br",
        "categoria_padrao": "Comunicado",
        "badge_texto": "KYRUS",
        "badge_cor": "indigo",
        "descricao": "Canal editorial direto da administração KyrusTECH para novidades, avisos de sistema e releases corporativos.",
        "ordem": 3,
        "is_ativo": True,
    },
    {
        "nome": "Valor Econômico",
        "tipo": "rss",
        "rss_url": "https://pox.globo.com/rss/valor",
        "site_url": "https://valoreconomico.globo.com/",
        "categoria_padrao": "Mercado",
        "badge_texto": "VALOR",
        "badge_cor": "amber",
        "descricao": "Feed de finanças corporativas, macroeconomia e empresas do Valor Econômico.",
        "ordem": 4,
        "is_ativo": False,
    },
    {
        "nome": "InfoMoney",
        "tipo": "rss",
        "rss_url": "https://www.infomoney.com.br/feed/",
        "site_url": "https://www.infomoney.com.br/",
        "categoria_padrao": "Investimentos",
        "badge_texto": "INFOMONEY",
        "badge_cor": "emerald",
        "descricao": "Mercados acionários, investimentos, cripto e finanças pessoais.",
        "ordem": 5,
        "is_ativo": False,
    },
]

DEFAULT_INITIAL_ANUNCIOS = [
    {
        "titulo": "Sua Marca em Destaque no Portal Corporativo",
        "empresa_nome": "Espaço Publicitário KyrusTECH",
        "logo_url": "https://kyrustech.com.br/kyrus.png",
        "descricao": "Anuncie seus produtos e soluções diretamente para centenas de diretores, empresários e gestores diariamente. Conecte sua marca a tomadores de decisão.",
        "cta_texto": "Quero Anunciar Aqui",
        "link_url": "https://www.instagram.com/kyrustech_br/",
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
        "titulo": "Mercado financeiro avalia projeções de inflação e trajetória dos juros futuros",
        "resumo": "Economistas analisam novos índices macroeconômicos e impacto nas decisões de investimentos e captação de recursos.",
        "fonte": "CNN Brasil",
        "categoria": "Finanças",
        "imagem_url": "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80",
        "link_url": "https://www.cnnbrasil.com.br/economia/",
        "data_publicacao": datetime(2026, 9, 20, 7, 0),
        "ordem": 3,
        "is_ativo": True,
    },
]


class CRUDAnuncioLogin:
    # --- SINCRONIZAÇÃO DE FEEDS RSS ---
    def sync_fonte_rss(
        self,
        session: Session,
        fonte: FonteNoticiaLogin,
        max_items: int = 10,
        user_id: Optional[int] = None,
    ) -> List[NoticiaLogin]:
        """
        Sincroniza notícias em tempo real a partir do RSS de uma fonte específica
        (G1, CNN Brasil, ou qualquer feed RSS padrão).
        """
        if not fonte.rss_url:
            logger.info(f"Fonte {fonte.nome} não possui rss_url configurado (canal manual).")
            return []

        try:
            req = urllib.request.Request(
                fonte.rss_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "application/rss+xml, application/xml, text/xml, */*",
                },
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
                if resp.info().get("Content-Encoding") == "gzip" or data[:2] == b"\x1f\x8b":
                    data = gzip.decompress(data)

            root = ET.fromstring(data)
            items = root.findall("./channel/item")
            if not items:
                items = root.findall(".//item")

            parsed_items = []
            is_cnn = "cnnbrasil" in (fonte.rss_url or "").lower() or "cnn" in fonte.nome.lower()
            is_g1 = "g1.globo" in (fonte.rss_url or "").lower() or "g1" in fonte.nome.lower()

            for item in items:
                title_el = item.find("title")
                link_el = item.find("link")
                desc_el = item.find("description")
                pub_el = item.find("pubDate")

                title = (title_el.text or "").strip() if title_el is not None and title_el.text else ""
                link = (link_el.text or "").strip() if link_el is not None and link_el.text else ""
                desc_raw = (desc_el.text or "").strip() if desc_el is not None and desc_el.text else ""
                pub_str = (pub_el.text or "").strip() if pub_el is not None and pub_el.text else ""

                title = html.unescape(title)
                if not title or not link:
                    continue

                lower_title = title.lower()

                # Filtros específicos de qualidade editorial
                if is_g1:
                    # Ignorar sorteios / loterias
                    if any(term in lower_title for term in ["mega-sena", "quina", "lotofácil", "lotomania", "sorteio", "dia de sorte"]):
                        continue

                if is_cnn:
                    # Ignorar reality shows, fofocas, celebridades e pop desnecessários
                    categories = [
                        (c.text or "").lower() for c in item.findall("category") if c.text
                    ]
                    categories_str = " ".join(categories)
                    if any(term in lower_title or term in categories_str for term in [
                        "reality", "a fazenda", "celebridade", "famosos", "cnn pop", "fofoca", "horóscopo", "bbb"
                    ]):
                        continue

                # Extração de Imagem com múltiplos seletores
                img_url = None

                # 1. Tentar content:encoded (padrão CNN Brasil WordPress)
                content_encoded = None
                for child in item:
                    if child.tag.endswith("encoded") and child.text:
                        content_encoded = child.text
                        break

                if content_encoded:
                    img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', content_encoded)
                    if img_match:
                        img_url = img_match.group(1)

                # 2. Tentar enclosure ou media:content
                if not img_url:
                    enclosure = item.find("enclosure")
                    if enclosure is not None and enclosure.get("url"):
                        img_url = enclosure.get("url")

                if not img_url:
                    for child in item:
                        if child.tag.endswith("content") or child.tag.endswith("thumbnail"):
                            if child.get("url"):
                                img_url = child.get("url")
                                break

                # 3. Tentar imagem dentro da descrição HTML
                if not img_url and desc_raw:
                    img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc_raw)
                    if img_match:
                        img_url = img_match.group(1)

                # Limpeza do Resumo HTML
                clean_desc = re.sub(r"<[^>]+>", "", desc_raw).strip()
                clean_desc = html.unescape(clean_desc)
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

                category = _detect_category(title, link, default_cat=fonte.categoria_padrao or "Economia")

                parsed_items.append({
                    "titulo": title,
                    "link_url": link,
                    "resumo": clean_desc[:280] if clean_desc else None,
                    "imagem_url": img_url,
                    "data_publicacao": pub_date,
                    "categoria": category,
                })

                if len(parsed_items) >= max_items:
                    break

            synced_noticias: List[NoticiaLogin] = []
            for idx, item_data in enumerate(parsed_items):
                fallback_img = FALLBACK_IMAGES[(idx + (fonte.id or 0)) % len(FALLBACK_IMAGES)]
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
                    existing.fonte = fonte.nome
                    existing.ordem = (fonte.ordem * 10) + (idx + 1)
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
                        fonte=fonte.nome,
                        categoria=item_data["categoria"],
                        imagem_url=final_img,
                        link_url=item_data["link_url"],
                        data_publicacao=item_data["data_publicacao"],
                        ordem=(fonte.ordem * 10) + (idx + 1),
                        is_ativo=True,
                        created_by_id=user_id,
                        updated_by_id=user_id,
                    )
                    session.add(new_noticia)
                    synced_noticias.append(new_noticia)

            session.commit()
            for sn in synced_noticias:
                session.refresh(sn)

            logger.info(f"Sincronização da fonte '{fonte.nome}' concluída: {len(synced_noticias)} matérias.")
            return synced_noticias
        except Exception as exc:
            logger.error(f"Erro ao sincronizar fonte '{fonte.nome}' (url: {fonte.rss_url}): {exc}")
            session.rollback()
            raise

    def sync_all_active_rss_sources(
        self,
        session: Session,
        max_items_per_fonte: int = 8,
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Sincroniza todos os canais RSS ativos cadastrados na base."""
        self.ensure_initial_seed(session)
        fontes = session.exec(
            select(FonteNoticiaLogin).where(
                FonteNoticiaLogin.is_ativo == True,
                FonteNoticiaLogin.tipo == "rss",
                FonteNoticiaLogin.is_deleted == False,
            ).order_by(col(FonteNoticiaLogin.ordem), col(FonteNoticiaLogin.id))
        ).all()

        results = []
        total_items = 0

        for fonte in fontes:
            try:
                synced = self.sync_fonte_rss(session, fonte, max_items=max_items_per_fonte, user_id=user_id)
                results.append({
                    "fonte_id": fonte.id,
                    "fonte_nome": fonte.nome,
                    "status": "success",
                    "count": len(synced),
                })
                total_items += len(synced)
            except Exception as exc:
                results.append({
                    "fonte_id": fonte.id,
                    "fonte_nome": fonte.nome,
                    "status": "error",
                    "error": str(exc),
                })

        return {
            "total_fontes_processadas": len(fontes),
            "total_noticias_sincronizadas": total_items,
            "detalhes": results,
        }

    def fetch_and_sync_g1_noticias(
        self,
        session: Session,
        max_items: int = 12,
        user_id: Optional[int] = None,
    ) -> List[NoticiaLogin]:
        """Wrapper de compatibilidade para sincronizar G1 Economia."""
        g1_fonte = session.exec(
            select(FonteNoticiaLogin).where(
                FonteNoticiaLogin.nome == "G1 Economia",
                FonteNoticiaLogin.is_deleted == False,
            )
        ).first()
        if not g1_fonte:
            g1_fonte = FonteNoticiaLogin(
                nome="G1 Economia",
                tipo="rss",
                rss_url=G1_ECONOMIA_RSS_URL,
                site_url="https://g1.globo.com/economia/",
                categoria_padrao="Economia",
                badge_texto="G1",
                badge_cor="red",
                is_ativo=True,
            )
            session.add(g1_fonte)
            session.commit()
            session.refresh(g1_fonte)
        return self.sync_fonte_rss(session, g1_fonte, max_items=max_items, user_id=user_id)

    def ensure_initial_seed(self, session: Session) -> None:
        """Inicializa sementes de fontes, anúncios e notícias caso as tabelas estejam vazias."""
        try:
            # Seed de Fontes de Notícias
            existing_fontes = session.exec(
                select(FonteNoticiaLogin).where(FonteNoticiaLogin.is_deleted == False)
            ).all()

            if not existing_fontes:
                logger.info("Criando sementes iniciais de Fontes de Notícias...")
                for item_data in DEFAULT_INITIAL_FONTES:
                    fonte = FonteNoticiaLogin(**item_data)
                    session.add(fonte)
                session.commit()

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

            has_mock_links = any(
                n.link_url in ["https://kyrustech.com.br", "https://valoreconomico.globo.com", "https://exame.com"]
                for n in existing_noticias
            )

            if not existing_noticias or has_mock_links:
                logger.info("Sincronizando fontes de notícias ativas iniciais...")
                try:
                    self.sync_all_active_rss_sources(session, max_items_per_fonte=6)
                except Exception as sync_err:
                    logger.warning(f"Falha ao sincronizar fontes ao vivo no seed: {sync_err}. Usando dados de contingência.")
                    for item_data in DEFAULT_INITIAL_NOTICIAS:
                        existing = session.exec(
                            select(NoticiaLogin).where(NoticiaLogin.link_url == item_data["link_url"])
                        ).first()
                        if not existing:
                            noticia = NoticiaLogin(**item_data)
                            session.add(noticia)
                    session.commit()
        except Exception as exc:
            logger.warning(f"Erro ao inicializar sementes de login: {exc}")
            session.rollback()

    def get_public_content(self, session: Session) -> LoginPublicContentResponse:
        """
        Retorna anúncios ativos, matérias ativas e lista de fontes ativas
        para exibição e rodízio público no portal de Login.
        """
        self.ensure_initial_seed(session)

        anuncios = session.exec(
            select(AnuncioLogin)
            .where(AnuncioLogin.is_ativo == True, AnuncioLogin.is_deleted == False)
            .order_by(col(AnuncioLogin.ordem), col(AnuncioLogin.id))
        ).all()

        active_noticias = session.exec(
            select(NoticiaLogin)
            .where(NoticiaLogin.is_ativo == True, NoticiaLogin.is_deleted == False)
            .order_by(col(NoticiaLogin.ordem), col(NoticiaLogin.id))
        ).all()

        fontes = session.exec(
            select(FonteNoticiaLogin)
            .where(FonteNoticiaLogin.is_ativo == True, FonteNoticiaLogin.is_deleted == False)
            .order_by(col(FonteNoticiaLogin.ordem), col(FonteNoticiaLogin.id))
        ).all()

        return LoginPublicContentResponse(
            anuncios=list(anuncios),
            noticias=list(active_noticias),
            fontes=list(fontes),
        )

    # --- CRUD FONTES DE NOTÍCIAS (ADMIN) ---
    def list_fontes(self, session: Session, include_inativos: bool = True) -> List[FonteNoticiaLogin]:
        self.ensure_initial_seed(session)
        query = select(FonteNoticiaLogin).where(FonteNoticiaLogin.is_deleted == False)
        if not include_inativos:
            query = query.where(FonteNoticiaLogin.is_ativo == True)
        return list(session.exec(query.order_by(col(FonteNoticiaLogin.ordem), col(FonteNoticiaLogin.id))).all())

    def get_fonte(self, session: Session, fonte_id: int) -> Optional[FonteNoticiaLogin]:
        return session.exec(
            select(FonteNoticiaLogin).where(
                FonteNoticiaLogin.id == fonte_id,
                FonteNoticiaLogin.is_deleted == False,
            )
        ).first()

    def create_fonte(
        self, session: Session, fonte_in: FonteNoticiaLoginCreate, user_id: Optional[int] = None
    ) -> FonteNoticiaLogin:
        fonte = FonteNoticiaLogin(
            **fonte_in.model_dump(),
            created_by_id=user_id,
            updated_by_id=user_id,
        )
        session.add(fonte)
        session.commit()
        session.refresh(fonte)
        return fonte

    def update_fonte(
        self, session: Session, fonte_id: int, fonte_in: FonteNoticiaLoginUpdate, user_id: Optional[int] = None
    ) -> Optional[FonteNoticiaLogin]:
        fonte = self.get_fonte(session, fonte_id)
        if not fonte:
            return None

        update_data = fonte_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(fonte, key, value)
        fonte.updated_by_id = user_id

        session.add(fonte)
        session.commit()
        session.refresh(fonte)
        return fonte

    def delete_fonte(self, session: Session, fonte_id: int, user_id: Optional[int] = None) -> bool:
        fonte = self.get_fonte(session, fonte_id)
        if not fonte:
            return False
        if user_id is not None:
            fonte.soft_delete(user_id=user_id)
        else:
            fonte.is_deleted = True
            fonte.deleted_at = utcnow()
        session.add(fonte)
        session.commit()
        return True

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
