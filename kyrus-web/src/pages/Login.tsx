import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { getFirstAllowedPath } from '../utils/routeRegistry';

import { 
  ArrowRight, Loader2, Eye, EyeOff, Sparkles, ExternalLink,
  ShieldCheck, ArrowUpRight, Lock, Mail,
  Globe, Linkedin, Instagram, CheckCircle2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { PasswordResetModal } from '../components/PasswordResetModal';

const MegaphoneIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 11 18-5v12L3 13v-2z"/>
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
  </svg>
);

const NewspaperIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
    <path d="M18 14h-8"/>
    <path d="M15 18h-5"/>
    <path d="M10 6h8v4h-8V6Z"/>
  </svg>
);

interface AnuncioPublic {
  id: number;
  titulo: string;
  empresa_nome: string;
  logo_url?: string;
  descricao: string;
  cta_texto?: string;
  link_url: string;
  ordem: number;
  is_homologado?: boolean;
  tem_beneficios_exclusivos?: boolean;
}

interface NoticiaPublic {
  id: number;
  titulo: string;
  resumo?: string;
  fonte: string;
  categoria?: string;
  imagem_url: string;
  link_url?: string;
  data_publicacao?: string;
  ordem: number;
}

interface LoginPublicData {
  anuncios: AnuncioPublic[];
  noticias: NoticiaPublic[];
}

const FALLBACK_ANUNCIOS: AnuncioPublic[] = [
  {
    id: 1,
    empresa_nome: "Espaço Publicitário KyrusTECH",
    titulo: "Sua Marca em Destaque no Portal Corporativo",
    logo_url: "https://kyrustech.com.br/kyrus.png",
    descricao: "Anuncie seus produtos e soluções diretamente para centenas de diretores, empresários e gestores diariamente. Conecte sua marca a tomadores de decisão.",
    cta_texto: "Quero Anunciar Aqui",
    link_url: "https://www.instagram.com/kyrustech_br/",
    ordem: 1,
    is_homologado: true,
    tem_beneficios_exclusivos: true,
  },
  {
    id: 2,
    empresa_nome: "Apex Consultoria Empresarial",
    titulo: "Governança Tributária & Redução de Riscos Fiscais",
    logo_url: "https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=120&auto=format&fit=crop&q=80",
    descricao: "Especialistas em conformidade SPED, auditoria fiscal preventiva e otimização de crédito tributário para empresas em expansão.",
    cta_texto: "Falar com Consultor",
    link_url: "https://kyrustech.com.br",
    ordem: 2,
    is_homologado: true,
    tem_beneficios_exclusivos: false,
  }
];

const FALLBACK_NOTICIAS: NoticiaPublic[] = [
  {
    id: 1,
    titulo: "Taxa de juros e o impacto no planejamento de capital de giro corporativo",
    resumo: "Empresas revisam estratégias de fluxo de caixa e prazos médios frente ao novo cenário macroeconômico.",
    fonte: "Valor Econômico",
    categoria: "Finanças",
    imagem_url: "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&auto=format&fit=crop&q=80",
    link_url: "https://valoreconomico.globo.com",
    ordem: 1,
  },
  {
    id: 2,
    titulo: "Reforma Tributária e automação fiscal: como antecipar os impactos no ERP",
    resumo: "A integração de dados e o compliance em tempo real tornam-se requisitos críticos para evitar autuações fiscais.",
    fonte: "Kyrus Insights",
    categoria: "Tributário",
    imagem_url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&auto=format&fit=crop&q=80",
    link_url: "https://kyrustech.com.br",
    ordem: 2,
  },
  {
    id: 3,
    titulo: "Automação com IA reduz em até 40% tempo gasto em conciliações financeiras",
    resumo: "Plataformas integradas consolidam extratos bancários, adquirentes e ERP eliminando divergências operacionais diárias.",
    fonte: "Bloomberg Línea",
    categoria: "Tecnologia",
    imagem_url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80",
    link_url: "https://bloomberglinea.com.br",
    ordem: 3,
  }
];

const CACHE_KEY = 'kyrus_public_content_v5';

function getInitialPublicData(): {
  content: LoginPublicData;
  initialAdIndex: number;
  initialNewsOffset: number;
} {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.anuncios) && parsed.anuncios.length > 0 && Array.isArray(parsed?.noticias) && parsed.noticias.length > 0) {
        const adsLen = parsed.anuncios.length;
        const newsLen = parsed.noticias.length;
        const adIdx = Math.floor(Math.random() * adsLen);
        const maxNewsTrios = Math.max(1, Math.floor(newsLen / 3));
        const newsOff = Math.floor(Math.random() * maxNewsTrios) * 3;
        return {
          content: parsed,
          initialAdIndex: adIdx,
          initialNewsOffset: newsOff,
        };
      }
    }
  } catch (e) {
    // ignore
  }
  return {
    content: { anuncios: FALLBACK_ANUNCIOS, noticias: FALLBACK_NOTICIAS },
    initialAdIndex: Math.floor(Math.random() * FALLBACK_ANUNCIOS.length),
    initialNewsOffset: 0,
  };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Anúncios e Notícias com cache persistente e sorteio imediato (elimina piscar/troca abrupta)
  const [publicDataConfig] = useState(getInitialPublicData);
  const [publicContent, setPublicContent] = useState<LoginPublicData>(publicDataConfig.content);
  const [selectedAdIndex, setSelectedAdIndex] = useState(publicDataConfig.initialAdIndex);
  const [newsOffset, setNewsOffset] = useState(publicDataConfig.initialNewsOffset);
  const [adFade, setAdFade] = useState(true);
  const [newsFade, setNewsFade] = useState(true);

  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);
  const authenticated = useAuthStore((state) => state.authenticated);
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const otherDeviceConnected = useAuthStore((state) => state.otherDeviceConnected);
  const setOtherDeviceConnected = useAuthStore((state) => state.setOtherDeviceConnected);
  const navigate = useNavigate();

  type LoginSessionResponse = {
    expires_in_minutes: number;
    expires_at: string;
  };

  useEffect(() => {
    if (initialized && authenticated) {
      navigate(getFirstAllowedPath(user, empresa), { replace: true });
    }
  }, [authenticated, initialized, navigate, user, empresa]);

  // Carregar dados públicos de anúncios e notícias em segundo plano sem pular a tela
  useEffect(() => {
    let isMounted = true;
    const fetchPublicContent = async () => {
      try {
        const { data } = await api.get<LoginPublicData>('/anuncios/public');
        if (isMounted && data && Array.isArray(data.anuncios) && Array.isArray(data.noticias)) {
          const ads = data.anuncios.length > 0 ? data.anuncios : FALLBACK_ANUNCIOS;
          const news = data.noticias.length > 0 ? data.noticias : FALLBACK_NOTICIAS;
          const payload = { anuncios: ads, noticias: news };
          localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
          setPublicContent(payload);
          // Apenas ajusta limites se os índices atuais ficarem fora de faixa
          setSelectedAdIndex((curr) => (curr >= ads.length ? 0 : curr));
          setNewsOffset((curr) => (curr >= news.length ? 0 : curr));
        }
      } catch (err) {
        console.info('Usando conteúdos informativos locais para tela de login.');
      }
    };
    fetchPublicContent();
    return () => { isMounted = false; };
  }, []);

  // Rotação automática suave dos anúncios a cada 10 segundos com transição fade
  useEffect(() => {
    if (publicContent.anuncios.length <= 1) return;
    const interval = setInterval(() => {
      setAdFade(false);
      setTimeout(() => {
        setSelectedAdIndex((prev) => (prev + 1) % publicContent.anuncios.length);
        setAdFade(true);
      }, 300);
    }, 10000);
    return () => clearInterval(interval);
  }, [publicContent.anuncios.length]);

  // Rotação automática suave das notícias a cada 12 segundos com transição fade
  useEffect(() => {
    if (publicContent.noticias.length <= 3) return;
    const interval = setInterval(() => {
      setNewsFade(false);
      setTimeout(() => {
        setNewsOffset((prev) => (prev + 3) % publicContent.noticias.length);
        setNewsFade(true);
      }, 300);
    }, 12000);
    return () => clearInterval(interval);
  }, [publicContent.noticias.length]);


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOtherDeviceConnected(false);

    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const { data: session } = await api.post<LoginSessionResponse>('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { data: user } = await api.get('/usuarios/me');

      setAuthenticated(true);
      setUser(user);
      setSessionExpiresAt(session.expires_at);
      setInitialized(true);
      navigate(getFirstAllowedPath(user, empresa));

    } catch (err) {
      console.error(err);
      setAuthenticated(false);
      setUser(null);
      setSessionExpiresAt(null);
      setError('E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError('');
    setOtherDeviceConnected(false);

    try {
      const { data: session } = await api.post<LoginSessionResponse>('/auth/demo-login');
      const { data: user } = await api.get('/usuarios/me');

      setAuthenticated(true);
      setUser(user);
      setSessionExpiresAt(session.expires_at);
      setInitialized(true);
      navigate(getFirstAllowedPath(user, empresa));

    } catch (err) {
      console.error(err);
      setAuthenticated(false);
      setUser(null);
      setSessionExpiresAt(null);
      setError('Não foi possível iniciar o ambiente de demonstração.');
    } finally {
      setLoading(false);
    }
  };

  const currentAd = publicContent.anuncios[selectedAdIndex % (publicContent.anuncios.length || 1)];

  const totalNews = publicContent.noticias.length;
  const visibleNews: NoticiaPublic[] = [];
  if (totalNews > 0) {
    for (let i = 0; i < Math.min(3, totalNews); i++) {
      visibleNews.push(publicContent.noticias[(newsOffset + i) % totalNews]);
    }
  }
  const totalNewsPages = Math.max(1, Math.ceil(totalNews / 3));
  const currentNewsPage = Math.min(totalNewsPages, Math.floor((newsOffset % (totalNews || 1)) / 3) + 1);

  return (
    <div className="h-screen w-full flex flex-col lg:flex-row bg-slate-50 text-slate-800 font-sans selection:bg-blue-600 selection:text-white overflow-hidden">
      
      {/* ========================================================= */}
      {/* LADO ESQUERDO: AMBIENTE CORPORATIVO, ANÚNCIOS & NOTÍCIAS */}
      {/* ========================================================= */}
      <div 
        className="login-left-pane hidden lg:flex flex-1 min-w-0 h-full flex-col justify-between p-5 sm:p-7 lg:p-8 xl:p-9 relative overflow-hidden bg-white border-b lg:border-b-0 lg:border-r border-slate-200/80"
        style={{ flex: '1 1 0%', minWidth: 0 }}
      >
        
        {/* Blueprint Grid Lines Decorativo de Fundo */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.035,
            backgroundImage: `
              linear-gradient(to right, #0284c7 1px, transparent 1px),
              linear-gradient(to bottom, #0284c7 1px, transparent 1px)
            `,
            backgroundSize: '36px 36px',
          }}
        />

        {/* Glows Decorativos Sutis */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-500/5 blur-[90px] pointer-events-none" />
        <div className="absolute top-1/2 -right-32 w-96 h-96 rounded-full bg-sky-400/5 blur-[90px] pointer-events-none" />

        <div className="relative z-10 flex-1 flex flex-col justify-between space-y-3 sm:space-y-4 min-h-0">
          
          {/* TOPO: LOGO KYRUS CLEAN (SEM QUADRADO AO LADO) */}
          <div className="flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black tracking-tight text-slate-950">
                  Kyrus<span className="text-blue-600">TECH</span>
                </span>
                <span className="px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md bg-blue-50 text-blue-700 border border-blue-200/60">
                  Enterprise
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-400 mt-0.5">
                Plataforma de Gestão Corporativa Inteligente
              </p>
            </div>

            {/* Links / Siga-nos no Topo */}
            <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-slate-400 mr-1 text-[11px] uppercase tracking-wider">Siga-nos:</span>
              <a
                href="https://kyrustech.com.br"
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition"
                title="Website Oficial"
              >
                <Globe className="w-4 h-4" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition"
                title="LinkedIn"
              >
                <Linkedin className="w-4 h-4" />
              </a>
              <a
                href="https://www.instagram.com/kyrustech_br/"
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition"
                title="Instagram @kyrustech_br"
              >
                <Instagram className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* ========================================================= */}
          {/* SEÇÃO: ESPAÇO PUBLICITÁRIO / PATROCINADOR (ALTURA DUPLICADA) */}
          {/* ========================================================= */}
          {currentAd && (
            <div className="h-[250px] sm:h-[270px] rounded-3xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/70 to-blue-50/30 p-5 sm:p-6 shadow-xs relative overflow-hidden shrink-0 flex flex-col justify-between transition-all duration-300 group">
              <div className="absolute -right-20 -bottom-20 w-64 h-64 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />

              {/* TOPO DO ANÚNCIO: BADGE DE PATROCÍNIO + CONTROLES DO CARROSSEL */}
              <div className="relative z-10 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-blue-700 bg-blue-100/80 px-2.5 py-1 rounded-lg border border-blue-200/50 shadow-xs">
                    <MegaphoneIcon className="w-3.5 h-3.5 text-blue-600" />
                    Patrocinador
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-slate-700">
                    {currentAd.empresa_nome}
                  </span>
                  {currentAd.is_homologado && (
                    <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg shadow-2xs">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Homologação Técnica Verificada</span>
                    </span>
                  )}
                </div>

                {/* Controles de Slides / Rotação 10s */}
                {publicContent.anuncios.length > 1 && (
                  <div className="flex items-center gap-2 bg-white/80 backdrop-blur-xs px-2.5 py-1 rounded-full border border-slate-200/70 shadow-xs">
                    <span className="text-[10px] font-semibold text-slate-400 hidden sm:inline">
                      Alterna a cada 10s
                    </span>
                    <div className="flex items-center gap-1.5">
                      {publicContent.anuncios.map((_, idx) => {
                        const isCurrent = idx === (selectedAdIndex % publicContent.anuncios.length);
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setAdFade(false);
                              setTimeout(() => {
                                setSelectedAdIndex(idx);
                                setAdFade(true);
                              }, 200);
                            }}
                            className={`h-2 rounded-full transition-all duration-300 ${
                              isCurrent ? 'bg-blue-600 w-6' : 'bg-slate-300 hover:bg-slate-400 w-2'
                            }`}
                            title={`Ver parceiro ${idx + 1}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* CORPO DO ANÚNCIO COM TRANSIÇÃO FADE SUAVE */}
              <div className={`relative z-10 my-auto flex items-start gap-4 sm:gap-6 transition-opacity duration-300 ${adFade ? 'opacity-100' : 'opacity-0'}`}>
                {currentAd.logo_url ? (
                  <img
                    src={toPublicAssetUrl(currentAd.logo_url) ?? undefined}
                    alt={currentAd.empresa_nome}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-contain bg-white border border-slate-200/90 shrink-0 shadow-sm p-2 group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-black text-2xl sm:text-3xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20 group-hover:scale-105 transition-transform duration-300">
                    {currentAd.empresa_nome.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="space-y-1.5 min-w-0 flex-1">
                  <h3 className="text-base sm:text-xl font-black text-slate-900 leading-snug line-clamp-2">
                    {currentAd.titulo}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed line-clamp-3 sm:line-clamp-4 max-w-3xl">
                    {currentAd.descricao}
                  </p>
                </div>
              </div>

              {/* RODAPÉ DO ANÚNCIO: BOTÃO DE AÇÃO + BENEFÍCIOS */}
              <div className="relative z-10 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
                <a
                  href={currentAd.link_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/20 transition transform hover:scale-[1.02] active:scale-95"
                >
                  {currentAd.cta_texto || 'Conhecer Soluções'}
                  <ArrowUpRight className="w-4 h-4" />
                </a>

                {currentAd.tem_beneficios_exclusivos ? (
                  <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-amber-700 bg-amber-50/90 border border-amber-200/80 px-2.5 py-1 rounded-xl shadow-2xs">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse shrink-0" />
                    <span className="truncate">Parceria com benefícios exclusivos para usuários KyrusTECH</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
                    Espaço publicitário para empresas parceiras
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SEÇÃO: NOTÍCIAS COM ROTAÇÃO CONTÍNUA DO G1 (12 MATÉRIAS) */}
          {/* ========================================================= */}
          <div className="space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <NewspaperIcon className="w-4 h-4 text-blue-600" />
                <h2 className="text-[11px] sm:text-xs font-extrabold uppercase tracking-widest text-slate-500">
                  Notícias & Tendências Corporativas
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 hidden sm:inline">
                  Atualização contínua (G1 Economia)
                </span>

                {/* Controles de Navegação das Notícias */}
                {publicContent.noticias.length > 3 && (
                  <div className="flex items-center gap-1 bg-slate-100/90 px-2 py-0.5 rounded-lg border border-slate-200/70 text-xs shadow-xs">
                    <button
                      onClick={() => {
                        setNewsFade(false);
                        setTimeout(() => {
                          setNewsOffset((prev) => (prev - 3 + publicContent.noticias.length) % publicContent.noticias.length);
                          setNewsFade(true);
                        }, 200);
                      }}
                      className="p-0.5 rounded hover:bg-white text-slate-500 hover:text-blue-600 transition"
                      title="Notícias anteriores"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-bold text-slate-500 px-1">
                      {currentNewsPage}/{totalNewsPages}
                    </span>
                    <button
                      onClick={() => {
                        setNewsFade(false);
                        setTimeout(() => {
                          setNewsOffset((prev) => (prev + 3) % publicContent.noticias.length);
                          setNewsFade(true);
                        }, 200);
                      }}
                      className="p-0.5 rounded hover:bg-white text-slate-500 hover:text-blue-600 transition"
                      title="Próximas notícias"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Grid dos 3 Cards Compactos em Layout Horizontal com Fade Suave */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 transition-opacity duration-300 ${newsFade ? 'opacity-100' : 'opacity-0'}`}>
              {visibleNews.map((noticia) => {
                const CardWrapper = noticia.link_url ? 'a' : 'div';
                const cardProps = noticia.link_url ? {
                  href: noticia.link_url,
                  target: '_blank',
                  rel: 'noreferrer',
                } : {};
                const imgSrc = toPublicAssetUrl(noticia.imagem_url) || noticia.imagem_url;
                const isG1 = (noticia.fonte || '').toLowerCase().includes('g1');
                const isCNN = (noticia.fonte || '').toLowerCase().includes('cnn');
                const isKyrus = (noticia.fonte || '').toLowerCase().includes('kyrus');

                return (
                  <CardWrapper
                    key={`${noticia.id}-${noticia.titulo}`}
                    {...cardProps}
                    className="group h-[92px] sm:h-[96px] p-2.5 rounded-2xl border border-slate-200/90 bg-white hover:border-blue-300 hover:shadow-md hover:shadow-blue-900/5 transition-all duration-300 cursor-pointer overflow-hidden flex items-center gap-3"
                  >
                    {/* Thumbnail Compacta com Efeito Monocromático -> Cor no Hover */}
                    <div className="w-20 h-full rounded-xl overflow-hidden bg-slate-100 shrink-0 relative">
                      <img
                        src={imgSrc}
                        alt={noticia.titulo}
                        className="w-full h-full object-cover filter grayscale contrast-110 opacity-90 transition-all duration-500 ease-out group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                      {isG1 && (
                        <span className="absolute bottom-1 left-1 px-1 py-0.2 text-[8px] font-black uppercase rounded bg-red-600 text-white shadow-xs font-mono">
                          G1
                        </span>
                      )}
                      {isCNN && (
                        <span className="absolute bottom-1 left-1 px-1 py-0.2 text-[8px] font-black uppercase rounded bg-rose-600 text-white shadow-xs font-mono">
                          CNN
                        </span>
                      )}
                      {isKyrus && (
                        <span className="absolute bottom-1 left-1 px-1 py-0.2 text-[8px] font-black uppercase rounded bg-indigo-600 text-white shadow-xs font-mono">
                          KYRUS
                        </span>
                      )}
                    </div>

                    {/* Conteúdo Compacto: Fonte, Categoria e Título */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-0.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
                        <span className="truncate flex items-center gap-1 text-slate-600 text-[10px]">
                          {isG1 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block shrink-0" />}
                          {isCNN && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shrink-0" />}
                          {isKyrus && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block shrink-0" />}
                          {noticia.categoria || noticia.fonte}
                        </span>
                        {noticia.link_url && (
                          <ExternalLink className="w-3 h-3 text-slate-300 group-hover:text-blue-600 transition shrink-0" />
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600 line-clamp-2 leading-snug transition-colors">
                        {noticia.titulo}
                      </h4>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                        <span className="text-[10px] font-medium text-blue-600 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                          {isG1 ? 'Ler no G1' : isCNN ? 'Ler na CNN' : isKyrus ? 'Ver Comunicado' : 'Ver matéria'} <ArrowRight className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    </div>
                  </CardWrapper>
                );
              })}
            </div>
          </div>

        </div>

        {/* RODAPÉ INFERIOR ESQUERDO */}
        <div className="relative z-10 pt-3 mt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
          <p>© {new Date().getFullYear()} KyrusTECH Soluções Corporativas. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> Servidores Operacionais
            </span>
            <span>Versão 2.4 Enterprise</span>
          </div>
        </div>

      </div>

      {/* ========================================================= */}
      {/* LADO DIREITO: CARD DE LOGIN CORPORATIVO ELEVADO */}
      {/* ========================================================= */}
      <div 
        className="login-right-pane w-full shrink-0 h-full flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-slate-50/70 border-l border-slate-200/80 overflow-y-auto"
        style={{ width: '100%', maxWidth: 'min(450px, 100%)', flexShrink: 0 }}
      >
        
        <div className="w-full max-w-sm sm:max-w-md bg-white rounded-3xl p-6 sm:p-7 shadow-xl shadow-slate-200/70 border border-slate-200/90 relative space-y-4 sm:space-y-5">

          
          {/* Header do Card de Login */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-xs border border-blue-100">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                Acesso Corporativo
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Informe suas credenciais para gerenciar sua empresa
              </p>
            </div>
          </div>

          {/* Alerta de Outro Dispositivo Conectado */}
          {otherDeviceConnected && (
            <div className="p-3.5 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs space-y-1 animate-in slide-in-from-top-2 duration-200">
              <p className="font-bold flex items-center gap-1.5 text-amber-800">
                ⚠️ Nova sessão detectada
              </p>
              <p>Outro dispositivo se autenticou em sua conta. Por segurança, efetue login novamente.</p>
            </div>
          )}

          {/* FORMULÁRIO DE LOGIN */}
          <form onSubmit={handleLogin} className="space-y-4">
            
            {/* Campo E-mail */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com.br"
                  className="w-full pl-10 pr-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition"
                />
              </div>
            </div>

            {/* Campo Senha */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Senha de Acesso
                </label>
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 font-bold hover:underline transition"
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-3 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Lembrar-me */}
            <div className="flex items-center justify-between pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-600">
                  Lembrar meu e-mail neste navegador
                </span>
              </label>
            </div>

            {/* Mensagem de Erro */}
            {error && (
              <div className="text-center text-xs text-rose-600 font-bold bg-rose-50 p-2.5 rounded-xl border border-rose-200/80 animate-in fade-in duration-200">
                {error}
              </div>
            )}

            {/* Botão Entrar */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm rounded-xl shadow-lg shadow-blue-600/25 transition transform active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Autenticando...
                </>
              ) : (
                <>
                  Entrar na Plataforma <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Divisor Visual */}
          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink mx-3 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
              ou explore os recursos
            </span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          {/* Botão Modo Demonstração */}
          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={loading}
            className="w-full py-3 px-4 bg-white hover:bg-emerald-50/50 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-300/80 shadow-xs hover:border-emerald-400 transition transform active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer group"
          >
            <Sparkles className="w-4 h-4 text-emerald-600 group-hover:scale-125 transition-transform" />
            Acessar Ambiente de Demonstração (Demo)
          </button>

          <p className="text-[10px] text-center text-slate-400 leading-relaxed">
            Ambiente seguro e criptografado com certificação SSL/TLS.
            <br />Suporte aos navegadores modernos.
          </p>

        </div>
      </div>

      {/* Modal de Recuperação de Senha */}
      <PasswordResetModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        initialEmail={email}
        onSuccessReset={(newEmail) => {
          setEmail(newEmail);
          setPassword('');
        }}
      />
    </div>
  );
}