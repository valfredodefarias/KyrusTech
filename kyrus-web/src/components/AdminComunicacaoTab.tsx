import { useState, useEffect, useRef } from 'react';
import { api, toPublicAssetUrl } from '../services/api';
import { 
  Plus, Pencil, Trash2, CheckCircle2, 
  XCircle, ExternalLink, Loader2, Image as ImageIcon, Eye, EyeOff,
  Sparkles, RefreshCw, AlertCircle, Upload, ShieldCheck
} from 'lucide-react';

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

export interface AnuncioItem {
  id: number;
  titulo: string;
  empresa_nome: string;
  logo_url?: string;
  descricao: string;
  cta_texto?: string;
  link_url: string;
  ordem: number;
  is_ativo: boolean;
  is_homologado?: boolean;
  tem_beneficios_exclusivos?: boolean;
  created_at?: string;
}

export interface NoticiaItem {
  id: number;
  titulo: string;
  resumo?: string;
  fonte: string;
  categoria?: string;
  imagem_url: string;
  link_url?: string;
  data_publicacao?: string;
  ordem: number;
  is_ativo: boolean;
  created_at?: string;
}

export function AdminComunicacaoTab() {
  const [subTab, setSubTab] = useState<'anuncios' | 'noticias'>('anuncios');
  const [anuncios, setAnuncios] = useState<AnuncioItem[]>([]);
  const [noticias, setNoticias] = useState<NoticiaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload and Sync States
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [syncingG1, setSyncingG1] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const capaFileInputRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingAnuncio, setEditingAnuncio] = useState<AnuncioItem | null>(null);
  const [editingNoticia, setEditingNoticia] = useState<NoticiaItem | null>(null);

  // Form states
  const [anuncioForm, setAnuncioForm] = useState({
    empresa_nome: '',
    titulo: '',
    descricao: '',
    cta_texto: 'Saiba Mais',
    link_url: '',
    logo_url: '',
    ordem: 0,
    is_ativo: true,
    is_homologado: false,
    tem_beneficios_exclusivos: false,
  });

  const [noticiaForm, setNoticiaForm] = useState({
    titulo: '',
    resumo: '',
    fonte: 'G1 Economia',
    categoria: 'Economia',
    imagem_url: '',
    link_url: '',
    ordem: 0,
    is_ativo: true,
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resAnuncios, resNoticias] = await Promise.all([
        api.get<AnuncioItem[]>('/anuncios/admin/anuncios'),
        api.get<NoticiaItem[]>('/anuncios/admin/noticias'),
      ]);
      setAnuncios(resAnuncios.data || []);
      setNoticias(resNoticias.data || []);
    } catch (err) {
      console.error('Erro ao carregar dados de comunicação:', err);
      setError('Não foi possível carregar anúncios e notícias. Verifique suas permissões.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- SINCRONIZAÇÃO G1 ---
  const handleSyncG1 = async () => {
    setSyncingG1(true);
    setSyncMessage(null);
    try {
      const { data } = await api.post<NoticiaItem[]>('/anuncios/admin/noticias/sync-g1');
      setNoticias(data);
      setSyncMessage('Notícias atualizadas com sucesso diretamente do G1 Economia com links diretos!');
      setTimeout(() => setSyncMessage(null), 6000);
    } catch (err) {
      console.error('Erro ao sincronizar G1:', err);
      alert('Não foi possível sincronizar o feed do G1 no momento. Verifique a conexão do servidor.');
    } finally {
      setSyncingG1(false);
    }
  };

  // --- UPLOAD HANDLERS ---
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/anexos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.url) {
        setAnuncioForm((prev) => ({ ...prev, logo_url: res.data.url }));
      }
    } catch (err) {
      console.error('Erro ao enviar logo:', err);
      alert('Erro ao enviar logo. Verifique se é uma imagem válida (JPG, PNG, WEBP) de até 2MB.');
    } finally {
      setUploadingLogo(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleCapaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingCapa(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/anexos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data?.url) {
        setNoticiaForm((prev) => ({ ...prev, imagem_url: res.data.url }));
      }
    } catch (err) {
      console.error('Erro ao enviar imagem de capa:', err);
      alert('Erro ao enviar imagem. Verifique o formato e tamanho.');
    } finally {
      setUploadingCapa(false);
      if (e.target) e.target.value = '';
    }
  };


  // --- TOGGLE ATIVO ---
  const handleToggleAnuncio = async (anuncio: AnuncioItem) => {
    try {
      const novoStatus = !anuncio.is_ativo;
      await api.patch(`/anuncios/admin/anuncios/${anuncio.id}`, { is_ativo: novoStatus });
      setAnuncios(prev => prev.map(a => a.id === anuncio.id ? { ...a, is_ativo: novoStatus } : a));
    } catch (err) {
      console.error('Erro ao alternar status do anúncio:', err);
      alert('Erro ao atualizar status do anúncio.');
    }
  };

  const handleToggleNoticia = async (noticia: NoticiaItem) => {
    try {
      const novoStatus = !noticia.is_ativo;
      await api.patch(`/anuncios/admin/noticias/${noticia.id}`, { is_ativo: novoStatus });
      setNoticias(prev => prev.map(n => n.id === noticia.id ? { ...n, is_ativo: novoStatus } : n));
    } catch (err) {
      console.error('Erro ao alternar status da notícia:', err);
      alert('Erro ao atualizar status da notícia.');
    }
  };

  // --- DELETE ---
  const handleDeleteAnuncio = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este anúncio publicitário?')) return;
    try {
      await api.delete(`/anuncios/admin/anuncios/${id}`);
      setAnuncios(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Erro ao excluir anúncio:', err);
      alert('Erro ao excluir anúncio.');
    }
  };

  const handleDeleteNoticia = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja remover esta notícia do rodízio?')) return;
    try {
      await api.delete(`/anuncios/admin/noticias/${id}`);
      setNoticias(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error('Erro ao excluir notícia:', err);
      alert('Erro ao excluir notícia.');
    }
  };

  // --- MODAIS ---
  const openNewAnuncioModal = () => {
    setEditingAnuncio(null);
    setAnuncioForm({
      empresa_nome: '',
      titulo: '',
      descricao: '',
      cta_texto: 'Saiba Mais',
      link_url: '',
      logo_url: '',
      ordem: anuncios.length + 1,
      is_ativo: true,
      is_homologado: false,
      tem_beneficios_exclusivos: false,
    });
    setShowModal(true);
  };

  const openEditAnuncioModal = (item: AnuncioItem) => {
    setEditingAnuncio(item);
    setAnuncioForm({
      empresa_nome: item.empresa_nome,
      titulo: item.titulo,
      descricao: item.descricao,
      cta_texto: item.cta_texto || 'Saiba Mais',
      link_url: item.link_url,
      logo_url: item.logo_url || '',
      ordem: item.ordem,
      is_ativo: item.is_ativo,
      is_homologado: Boolean(item.is_homologado),
      tem_beneficios_exclusivos: Boolean(item.tem_beneficios_exclusivos),
    });
    setShowModal(true);
  };

  const openNewNoticiaModal = () => {
    setEditingNoticia(null);
    setNoticiaForm({
      titulo: '',
      resumo: '',
      fonte: '',
      categoria: 'Mercado',
      imagem_url: '',
      link_url: '',
      ordem: noticias.length + 1,
      is_ativo: true,
    });
    setShowModal(true);
  };

  const openEditNoticiaModal = (item: NoticiaItem) => {
    setEditingNoticia(item);
    setNoticiaForm({
      titulo: item.titulo,
      resumo: item.resumo || '',
      fonte: item.fonte,
      categoria: item.categoria || 'Mercado',
      imagem_url: item.imagem_url,
      link_url: item.link_url || '',
      ordem: item.ordem,
      is_ativo: item.is_ativo,
    });
    setShowModal(true);
  };

  const handleSaveAnuncio = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingAnuncio) {
        const { data } = await api.patch<AnuncioItem>(`/anuncios/admin/anuncios/${editingAnuncio.id}`, anuncioForm);
        setAnuncios(prev => prev.map(a => a.id === editingAnuncio.id ? data : a));
      } else {
        const { data } = await api.post<AnuncioItem>('/anuncios/admin/anuncios', anuncioForm);
        setAnuncios(prev => [...prev, data]);
      }
      setShowModal(false);
    } catch (err) {
      console.error('Erro ao salvar anúncio:', err);
      alert('Erro ao salvar anúncio. Verifique os campos.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNoticia = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingNoticia) {
        const { data } = await api.patch<NoticiaItem>(`/anuncios/admin/noticias/${editingNoticia.id}`, noticiaForm);
        setNoticias(prev => prev.map(n => n.id === editingNoticia.id ? data : n));
      } else {
        const { data } = await api.post<NoticiaItem>('/anuncios/admin/noticias', noticiaForm);
        setNoticias(prev => [...prev, data]);
      }
      setShowModal(false);
    } catch (err) {
      console.error('Erro ao salvar notícia:', err);
      alert('Erro ao salvar notícia. Verifique os campos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header com Sub-Tabs e Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800/90 p-5 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab('anuncios')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition ${
              subTab === 'anuncios'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <MegaphoneIcon className="w-4 h-4" />
            Anúncios Patrocinados
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-white/20">
              {anuncios.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab('noticias')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition ${
              subTab === 'noticias'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            <NewspaperIcon className="w-4 h-4" />
            Feed de Notícias & Fontes
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-white/20">
              {noticias.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            title="Recarregar"
            className="p-2.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {subTab === 'anuncios' ? (
            <button
              onClick={openNewAnuncioModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-blue-600/20 transition transform active:scale-95"
            >
              <Plus className="w-4 h-4" /> Novo Anúncio
            </button>
          ) : (
            <button
              onClick={openNewNoticiaModal}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-blue-600/20 transition transform active:scale-95"
            >
              <Plus className="w-4 h-4" /> Nova Notícia
            </button>
          )}
        </div>
      </div>

      {/* Alerta Informativo */}
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-blue-100 bg-blue-50/80 dark:border-blue-900/40 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-300">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <p>
          {subTab === 'anuncios'
            ? 'Os anúncios ativos aparecem em destaque na tela de login corporativo. Você pode enviar a logo diretamente do computador ou colar a URL, definir o link do parceiro e textos sem necessidade de deploy.'
            : 'As notícias ativas participam do rodízio diário automático de 3 cards na tela de login. Todas as matérias contam com links diretos (.ghtml) que levam à reportagem original.'}
        </p>
      </div>

      {/* PAINEL DE FONTES DE NOTÍCIAS CONECTADAS (SOMENTE NA ABA NOTÍCIAS) */}
      {subTab === 'noticias' && (
        <div className="bg-white dark:bg-slate-800/90 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Fontes de Notícias Conectadas ao Feed
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Portais integrados que fornecem reportagens recentes com links diretos para cada artigo.
              </p>
            </div>

            <button
              onClick={handleSyncG1}
              disabled={syncingG1}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl text-xs font-bold shadow-md shadow-rose-600/20 transition active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingG1 ? 'animate-spin' : ''}`} />
              {syncingG1 ? 'Sincronizando do G1...' : 'Sincronizar Notícias do G1 Agora'}
            </button>
          </div>

          {syncMessage && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl border border-emerald-200 dark:border-emerald-800 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {syncMessage}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {/* Card G1 Economia */}
            <div className="p-4 rounded-2xl border border-rose-200/80 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/10 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black tracking-wider uppercase">
                    G1 Economia
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> RSS Ativo
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  G1 Globo - Economia & Mercados
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Feed em tempo real com link direto (.ghtml) para a reportagem completa e imagem oficial de capa.
                </p>
              </div>
              <div className="pt-2 border-t border-rose-100 dark:border-rose-900/30 flex items-center justify-between text-[10px] text-slate-400">
                <span>g1.globo.com/economia</span>
                <span className="font-bold text-rose-600">Principal</span>
              </div>
            </div>

            {/* Card Valor Econômico */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-blue-700 text-white text-[10px] font-black tracking-wider uppercase">
                    Valor Econômico
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">Homologado</span>
                </div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  Valor - Macroeconomia & Finanças
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Balanços de empresas, políticas fiscais e mercado de capitais para gestores C-Level.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                <span>valoreconomico.globo.com</span>
                <span className="font-semibold text-slate-500">Curadoria</span>
              </div>
            </div>

            {/* Card InfoMoney */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-black tracking-wider uppercase">
                    InfoMoney
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">Homologado</span>
                </div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  InfoMoney - Empresas & Negócios
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Expansão empresarial, tecnologia B2B, gestão tributária e investimentos.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                <span>infomoney.com.br</span>
                <span className="font-semibold text-slate-500">Curadoria</span>
              </div>
            </div>

            {/* Card Kyrus Insights */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-black tracking-wider uppercase">
                    Kyrus Insights
                  </span>
                  <span className="text-[10px] font-bold text-indigo-500">Canal Interno</span>
                </div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  Editorial Kyrus & Avisos
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Comunicados aos clientes, dicas de uso de ERP e comunicados da consultoria.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                <span>kyrustech.com.br</span>
                <span className="font-semibold text-indigo-600">Manual</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Carregando conteúdos...</p>
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      ) : subTab === 'anuncios' ? (
        /* LISTA DE ANÚNCIOS */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {anuncios.map((anuncio) => {
            const logoSrc = toPublicAssetUrl(anuncio.logo_url);
            return (
              <div
                key={anuncio.id}
                className={`flex flex-col justify-between p-5 rounded-3xl border transition-all duration-200 ${
                  anuncio.is_ativo
                    ? 'bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700/60 opacity-60'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {logoSrc ? (
                        <img
                          src={logoSrc}
                          alt={anuncio.empresa_nome}
                          className="w-10 h-10 rounded-xl object-contain bg-white border border-slate-200 dark:border-slate-700 p-0.5"
                          onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-black text-sm">
                          {anuncio.empresa_nome.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          {anuncio.empresa_nome}
                        </h4>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Ordem: #{anuncio.ordem}
                          </span>
                          {anuncio.is_homologado && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40 px-1.5 py-0.5 rounded">
                              <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                              Homologado
                            </span>
                          )}
                          {anuncio.tem_beneficios_exclusivos && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 px-1.5 py-0.5 rounded">
                              <Sparkles className="w-2.5 h-2.5 text-amber-500" />
                              Benefícios Exclusivos
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Toggle Ativo Switch */}
                    <button
                      onClick={() => handleToggleAnuncio(anuncio)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition ${
                        anuncio.is_ativo
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/40'
                          : 'bg-slate-200 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                      }`}
                    >
                      {anuncio.is_ativo ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Ativo
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-slate-400" />
                          Inativo
                        </>
                      )}
                    </button>
                  </div>

                  <div>
                    <h5 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {anuncio.titulo}
                    </h5>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                      {anuncio.descricao}
                    </p>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                  <a
                    href={anuncio.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline truncate max-w-[200px]"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    {anuncio.cta_texto || 'Acessar Link'}
                  </a>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditAnuncioModal(anuncio)}
                      className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title="Editar anúncio"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteAnuncio(anuncio.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      title="Excluir anúncio"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {anuncios.length === 0 && (
            <div className="col-span-full p-8 text-center bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700">
              <MegaphoneIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum anúncio cadastrado</p>
              <p className="text-xs text-slate-400 mt-1">Clique em "Novo Anúncio" para cadastrar o primeiro parceiro.</p>
            </div>
          )}
        </div>
      ) : (
        /* LISTA DE NOTÍCIAS */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {noticias.map((noticia) => {
            const imgSrc = toPublicAssetUrl(noticia.imagem_url) || noticia.imagem_url;
            const isG1 = (noticia.fonte || '').toLowerCase().includes('g1');
            return (
              <div
                key={noticia.id}
                className={`flex flex-col justify-between overflow-hidden rounded-3xl border transition-all duration-200 ${
                  noticia.is_ativo
                    ? 'bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700/60 opacity-60'
                }`}
              >
                {/* Imagem Preview */}
                <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-900 overflow-hidden group">
                  <img
                    src={imgSrc}
                    alt={noticia.titulo}
                    className="w-full h-full object-cover filter grayscale contrast-110 group-hover:grayscale-0 transition-all duration-300"
                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                  />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider bg-white/95 dark:bg-slate-900/90 text-blue-700 dark:text-blue-400 rounded-lg shadow-xs backdrop-blur">
                      {noticia.categoria || 'Economia'}
                    </span>
                    {isG1 && (
                      <span className="px-2 py-1 text-[9px] font-black uppercase tracking-wider bg-rose-600 text-white rounded-lg shadow-xs">
                        G1
                      </span>
                    )}
                  </div>
                  <div className="absolute top-2.5 right-2.5">
                    <button
                      onClick={() => handleToggleNoticia(noticia)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold shadow-xs backdrop-blur transition flex items-center gap-1 ${
                        noticia.is_ativo
                          ? 'bg-emerald-500/90 text-white'
                          : 'bg-slate-800/80 text-slate-300'
                      }`}
                    >
                      {noticia.is_ativo ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {noticia.is_ativo ? 'Ativo no Rodízio' : 'Oculto'}
                    </button>
                  </div>
                </div>

                {/* Informações */}
                <div className="p-4 space-y-2 flex-grow flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
                      <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        {isG1 && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />}
                        {noticia.fonte}
                      </span>
                      <span>Ordem: #{noticia.ordem}</span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                      {noticia.titulo}
                    </h4>
                    {noticia.resumo && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                        {noticia.resumo}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
                    {noticia.link_url ? (
                      <a
                        href={noticia.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline flex items-center gap-1 truncate max-w-[190px]"
                        title={noticia.link_url}
                      >
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        Ler reportagem completa
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">Sem link direto</span>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditNoticiaModal(noticia)}
                        className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        title="Editar notícia"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteNoticia(noticia.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        title="Excluir notícia"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {noticias.length === 0 && (
            <div className="col-span-full p-8 text-center bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700">
              <NewspaperIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhuma notícia cadastrada</p>
              <p className="text-xs text-slate-400 mt-1">Clique em "Sincronizar Notícias do G1 Agora" para puxar as reportagens do dia.</p>
            </div>
          )}
        </div>
      )}

      {/* MODAL: ANÚNCIO */}
      {showModal && subTab === 'anuncios' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <MegaphoneIcon className="w-5 h-5 text-blue-600" />
                {editingAnuncio ? 'Editar Anúncio Patrocinado' : 'Novo Anúncio Patrocinado'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAnuncio} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Nome da Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    value={anuncioForm.empresa_nome}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, empresa_nome: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Nexus Cloud"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Texto do Botão / CTA
                  </label>
                  <input
                    type="text"
                    value={anuncioForm.cta_texto}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, cta_texto: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Saiba Mais"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Título / Chamada do Anúncio *
                </label>
                <input
                  type="text"
                  required
                  value={anuncioForm.titulo}
                  onChange={(e) => setAnuncioForm({ ...anuncioForm, titulo: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Infraestrutura Cloud & IA para Alta Performance"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Descrição Publicitária *
                </label>
                <textarea
                  required
                  rows={3}
                  value={anuncioForm.descricao}
                  onChange={(e) => setAnuncioForm({ ...anuncioForm, descricao: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Explique os benefícios, diferenciais e valor do parceiro..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Link de Destino do Parceiro *
                </label>
                <input
                  type="url"
                  required
                  value={anuncioForm.link_url}
                  onChange={(e) => setAnuncioForm({ ...anuncioForm, link_url: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://..."
                />
              </div>

              {/* UPLOAD DE LOGO DO ANÚNCIO */}
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-200 dark:border-slate-600">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                  Logo do Anunciante
                </label>

                {anuncioForm.logo_url && (
                  <div className="flex items-center gap-3 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600">
                    <img
                      src={toPublicAssetUrl(anuncioForm.logo_url) ?? undefined}
                      alt="Preview Logo"
                      className="w-12 h-12 rounded-lg object-contain bg-slate-50 p-1 border border-slate-200"
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {anuncioForm.logo_url}
                      </p>
                      <span className="text-[10px] text-emerald-600 font-bold">Logo configurada</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAnuncioForm(prev => ({ ...prev, logo_url: '' }))}
                      className="text-slate-400 hover:text-rose-500 p-1.5 transition"
                      title="Remover logo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => logoFileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold rounded-xl border border-blue-200 dark:border-blue-800 transition"
                  >
                    {uploadingLogo ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Enviando arquivo...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-blue-600" />
                        <span>Fazer Upload de Logo do Computador</span>
                      </>
                    )}
                  </button>
                </div>

                <div>
                  <input
                    type="url"
                    value={anuncioForm.logo_url}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, logo_url: e.target.value })}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ou informe uma URL externa (ex: https://...)"
                  />
                </div>
              </div>

              {/* SELOS E VANTAGENS CONFIGURÁVEIS DO PARCEIRO */}
              <div className="p-3.5 bg-blue-50/60 dark:bg-slate-700/30 rounded-2xl border border-blue-100 dark:border-slate-600 space-y-2.5">
                <span className="block text-xs font-extrabold text-blue-950 dark:text-blue-300 uppercase tracking-wide">
                  Selos & Vantagens Configuráveis
                </span>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={anuncioForm.is_homologado}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, is_homologado: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                      Homologação Técnica Verificada
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Exibe o selo de homologação técnica verificada junto ao parceiro no anúncio.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={anuncioForm.tem_beneficios_exclusivos}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, tem_beneficios_exclusivos: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Parceria com benefícios exclusivos para usuários KyrusTECH
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Exibe a tag de benefícios e vantagens exclusivas aos usuários Kyrus.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={anuncioForm.is_ativo}
                    onChange={(e) => setAnuncioForm({ ...anuncioForm, is_ativo: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Anúncio Ativo na Tela de Login
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition flex items-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Salvar Anúncio
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOTÍCIA */}
      {showModal && subTab === 'noticias' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <NewspaperIcon className="w-5 h-5 text-blue-600" />
                {editingNoticia ? 'Editar Notícia do Feed' : 'Nova Notícia para o Feed'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNoticia} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Título / Manchete *
                </label>
                <input
                  type="text"
                  required
                  value={noticiaForm.titulo}
                  onChange={(e) => setNoticiaForm({ ...noticiaForm, titulo: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Reforma Tributária e automação contábil"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Resumo / Linha Fina (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={noticiaForm.resumo}
                  onChange={(e) => setNoticiaForm({ ...noticiaForm, resumo: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Breve explicação para aguçar o interesse..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Fonte / Veículo *
                  </label>
                  <input
                    type="text"
                    required
                    value={noticiaForm.fonte}
                    onChange={(e) => setNoticiaForm({ ...noticiaForm, fonte: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: G1 Economia, Valor Econômico"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Categoria
                  </label>
                  <input
                    type="text"
                    value={noticiaForm.categoria}
                    onChange={(e) => setNoticiaForm({ ...noticiaForm, categoria: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: Economia, Tributário, Agronegócio"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Link Direto da Reportagem *
                </label>
                <input
                  type="url"
                  required
                  value={noticiaForm.link_url}
                  onChange={(e) => setNoticiaForm({ ...noticiaForm, link_url: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://g1.globo.com/economia/noticia/...ghtml"
                />
              </div>

              {/* UPLOAD DE IMAGEM DA NOTÍCIA */}
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-200 dark:border-slate-600">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                  Imagem de Capa da Notícia *
                </label>

                {noticiaForm.imagem_url && (
                  <div className="flex items-center gap-3 p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600">
                    <img
                      src={toPublicAssetUrl(noticiaForm.imagem_url) ?? undefined}
                      alt="Preview Notícia"
                      className="w-16 h-10 rounded-lg object-cover bg-slate-100 border border-slate-200"
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {noticiaForm.imagem_url}
                      </p>
                      <span className="text-[10px] text-emerald-600 font-bold">Imagem selecionada</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNoticiaForm(prev => ({ ...prev, imagem_url: '' }))}
                      className="text-slate-400 hover:text-rose-500 p-1.5 transition"
                      title="Remover imagem"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={capaFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleCapaUpload}
                  />
                  <button
                    type="button"
                    disabled={uploadingCapa}
                    onClick={() => capaFileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold rounded-xl border border-blue-200 dark:border-blue-800 transition"
                  >
                    {uploadingCapa ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Enviando capa...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-blue-600" />
                        <span>Fazer Upload de Imagem do Computador</span>
                      </>
                    )}
                  </button>
                </div>

                <div>
                  <input
                    type="url"
                    required
                    value={noticiaForm.imagem_url}
                    onChange={(e) => setNoticiaForm({ ...noticiaForm, imagem_url: e.target.value })}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ou informe a URL da imagem (ex: https://images.unsplash.com/...)"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noticiaForm.is_ativo}
                    onChange={(e) => setNoticiaForm({ ...noticiaForm, is_ativo: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Ativa no Rodízio Diário
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md transition flex items-center gap-2"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Salvar Notícia
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

