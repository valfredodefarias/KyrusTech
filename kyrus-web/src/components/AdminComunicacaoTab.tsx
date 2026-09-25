import { useState, useEffect, useRef } from 'react';
import { api, toPublicAssetUrl } from '../services/api';
import { 
  Plus, Pencil, Trash2, CheckCircle2, 
  XCircle, ExternalLink, Loader2, Image as ImageIcon, Eye, EyeOff,
  Sparkles, RefreshCw, AlertCircle, Upload, ShieldCheck, Rss, Radio,
  Globe
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

export interface FonteItem {
  id: number;
  nome: string;
  tipo: string; // 'rss' | 'manual'
  rss_url?: string;
  site_url?: string;
  categoria_padrao?: string;
  badge_texto?: string;
  badge_cor?: string;
  descricao?: string;
  ordem: number;
  is_ativo: boolean;
  created_at?: string;
}

export function AdminComunicacaoTab() {
  const [subTab, setSubTab] = useState<'anuncios' | 'noticias'>('anuncios');
  const [anuncios, setAnuncios] = useState<AnuncioItem[]>([]);
  const [noticias, setNoticias] = useState<NoticiaItem[]>([]);
  const [fontes, setFontes] = useState<FonteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload and Sync States
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCapa, setUploadingCapa] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingFonteId, setSyncingFonteId] = useState<number | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const capaFileInputRef = useRef<HTMLInputElement>(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [showFonteModal, setShowFonteModal] = useState(false);
  const [editingAnuncio, setEditingAnuncio] = useState<AnuncioItem | null>(null);
  const [editingNoticia, setEditingNoticia] = useState<NoticiaItem | null>(null);
  const [editingFonte, setEditingFonte] = useState<FonteItem | null>(null);

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

  const [fonteForm, setFonteForm] = useState({
    nome: '',
    tipo: 'rss',
    rss_url: '',
    site_url: '',
    categoria_padrao: 'Economia',
    badge_texto: '',
    badge_cor: 'rose',
    descricao: '',
    ordem: 0,
    is_ativo: true,
  });

  const getDomainFromUrl = (urlStr?: string | null) => {
    if (!urlStr || typeof urlStr !== 'string') return '';
    try {
      const trimmed = urlStr.trim();
      if (!trimmed) return '';
      const formatted = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
      return new URL(formatted).hostname.replace(/^www\./, '');
    } catch {
      return urlStr;
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resAnuncios, resNoticias, resFontes] = await Promise.all([
        api.get<AnuncioItem[]>('/anuncios/admin/anuncios').catch(err => {
          console.error('Erro ao carregar anúncios:', err);
          return { data: [] as AnuncioItem[] };
        }),
        api.get<NoticiaItem[]>('/anuncios/admin/noticias').catch(err => {
          console.error('Erro ao carregar notícias:', err);
          return { data: [] as NoticiaItem[] };
        }),
        api.get<FonteItem[]>('/anuncios/admin/fontes').catch(err => {
          console.error('Erro ao carregar fontes:', err);
          return { data: [] as FonteItem[] };
        }),
      ]);
      setAnuncios(Array.isArray(resAnuncios.data) ? resAnuncios.data : []);
      setNoticias(Array.isArray(resNoticias.data) ? resNoticias.data : []);
      setFontes(Array.isArray(resFontes.data) ? resFontes.data : []);
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

  // --- SINCRONIZAÇÃO DE FONTES ---
  const handleSyncAllFontes = async () => {
    setSyncingAll(true);
    setSyncMessage(null);
    try {
      const res = await api.post<{
        total_fontes_processadas: number;
        total_noticias_sincronizadas: number;
        detalhes: Array<{ fonte_nome: string; status: string; count?: number; error?: string }>;
      }>('/anuncios/admin/noticias/sync-all');
      
      // Recarrega notícias
      const { data: updatedNoticias } = await api.get<NoticiaItem[]>('/anuncios/admin/noticias');
      setNoticias(updatedNoticias || []);

      const nomesFontes = res.data.detalhes
        .filter(d => d.status === 'success')
        .map(d => d.fonte_nome)
        .join(', ');

      setSyncMessage(`Sincronização concluída com sucesso! ${res.data.total_noticias_sincronizadas} matérias atualizadas de [${nomesFontes || 'fontes ativas'}].`);
      setTimeout(() => setSyncMessage(null), 7000);
    } catch (err) {
      console.error('Erro ao sincronizar todas as fontes:', err);
      alert('Não foi possível sincronizar todas as fontes no momento. Verifique a conexão com o servidor.');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSyncSingleFonte = async (fonte: FonteItem) => {
    if (fonte.tipo !== 'rss' || !fonte.rss_url) {
      alert('Esta fonte é um canal manual/editorial e não requer sincronização externa.');
      return;
    }
    setSyncingFonteId(fonte.id);
    setSyncMessage(null);
    try {
      const { data } = await api.post<NoticiaItem[]>(`/anuncios/admin/fontes/${fonte.id}/sync`);
      
      // Recarrega notícias
      const { data: updatedNoticias } = await api.get<NoticiaItem[]>('/anuncios/admin/noticias');
      setNoticias(updatedNoticias || []);

      setSyncMessage(`Fonte '${fonte.nome}' sincronizada com sucesso! ${data.length} matérias processadas.`);
      setTimeout(() => setSyncMessage(null), 6000);
    } catch (err) {
      console.error(`Erro ao sincronizar fonte ${fonte.nome}:`, err);
      alert(`Falha ao sincronizar o feed de '${fonte.nome}'. Verifique se o endereço RSS está ativo e acessível.`);
    } finally {
      setSyncingFonteId(null);
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

  const handleToggleFonte = async (fonte: FonteItem) => {
    try {
      const novoStatus = !fonte.is_ativo;
      await api.patch(`/anuncios/admin/fontes/${fonte.id}`, { is_ativo: novoStatus });
      setFontes(prev => prev.map(f => f.id === fonte.id ? { ...f, is_ativo: novoStatus } : f));
    } catch (err) {
      console.error('Erro ao alternar status da fonte:', err);
      alert('Erro ao atualizar status da fonte de notícia.');
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

  const handleDeleteFonte = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir esta fonte? As notícias existentes serão mantidas, mas novos feeds não serão sincronizados.')) return;
    try {
      await api.delete(`/anuncios/admin/fontes/${id}`);
      setFontes(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      console.error('Erro ao excluir fonte:', err);
      alert('Erro ao excluir fonte de notícia.');
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
      fonte: fontes.find(f => f.tipo === 'manual')?.nome || 'Editorial Kyrus & Avisos',
      categoria: 'Comunicado',
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
      categoria: item.categoria || 'Economia',
      imagem_url: item.imagem_url,
      link_url: item.link_url || '',
      ordem: item.ordem,
      is_ativo: item.is_ativo,
    });
    setShowModal(true);
  };

  const openNewFonteModal = () => {
    setEditingFonte(null);
    setFonteForm({
      nome: '',
      tipo: 'rss',
      rss_url: '',
      site_url: '',
      categoria_padrao: 'Economia',
      badge_texto: '',
      badge_cor: 'rose',
      descricao: '',
      ordem: fontes.length + 1,
      is_ativo: true,
    });
    setShowFonteModal(true);
  };

  const openEditFonteModal = (fonte: FonteItem) => {
    setEditingFonte(fonte);
    setFonteForm({
      nome: fonte.nome,
      tipo: fonte.tipo,
      rss_url: fonte.rss_url || '',
      site_url: fonte.site_url || '',
      categoria_padrao: fonte.categoria_padrao || 'Economia',
      badge_texto: fonte.badge_texto || '',
      badge_cor: fonte.badge_cor || 'rose',
      descricao: fonte.descricao || '',
      ordem: fonte.ordem,
      is_ativo: fonte.is_ativo,
    });
    setShowFonteModal(true);
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

  const handleSaveFonte = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...fonteForm,
        rss_url: fonteForm.rss_url ? fonteForm.rss_url.trim() : null,
        site_url: fonteForm.site_url ? fonteForm.site_url.trim() : null,
        badge_texto: fonteForm.badge_texto ? fonteForm.badge_texto.trim().toUpperCase() : null,
      };

      if (editingFonte) {
        const { data } = await api.patch<FonteItem>(`/anuncios/admin/fontes/${editingFonte.id}`, payload);
        setFontes(prev => prev.map(f => f.id === editingFonte.id ? data : f));
      } else {
        const { data } = await api.post<FonteItem>('/anuncios/admin/fontes', payload);
        setFontes(prev => [...prev, data]);
      }
      setShowFonteModal(false);
    } catch (err) {
      console.error('Erro ao salvar fonte de notícias:', err);
      alert('Erro ao salvar fonte de notícias. Verifique os campos obrigatórios.');
    } finally {
      setSaving(false);
    }
  };

  const getBadgeColorClasses = (cor?: string) => {
    switch (cor) {
      case 'rose':
        return 'bg-rose-600 text-white';
      case 'red':
        return 'bg-red-600 text-white';
      case 'indigo':
        return 'bg-indigo-600 text-white';
      case 'blue':
        return 'bg-blue-600 text-white';
      case 'emerald':
      case 'green':
        return 'bg-emerald-600 text-white';
      case 'amber':
      case 'yellow':
        return 'bg-amber-600 text-white';
      case 'purple':
        return 'bg-purple-600 text-white';
      default:
        return 'bg-slate-700 text-white';
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
            title="Recarregar dados"
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
            <div className="flex items-center gap-2">
              <button
                onClick={openNewFonteModal}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-2xl font-bold text-xs transition"
              >
                <Plus className="w-3.5 h-3.5" /> Nova Fonte / Canal
              </button>
              <button
                onClick={openNewNoticiaModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm shadow-md shadow-blue-600/20 transition transform active:scale-95"
              >
                <Plus className="w-4 h-4" /> Nova Notícia / Comunicado
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Alerta Informativo */}
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-blue-100 bg-blue-50/80 dark:border-blue-900/40 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-300">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <p>
          {subTab === 'anuncios'
            ? 'Os anúncios ativos aparecem em destaque na tela de login corporativo. Você pode enviar a logo diretamente do computador ou colar a URL, definir o link do parceiro e textos sem necessidade de deploy.'
            : 'As notícias ativas participam do rodízio automático de 3 cards na tela de login com links diretos oficiais (CNN Brasil, G1 Economia ou Comunicados Internos Kyrus).'}
        </p>
      </div>

      {/* PAINEL DINÂMICO DE FONTES DE NOTÍCIAS (SOMENTE NA ABA NOTÍCIAS) */}
      {subTab === 'noticias' && (
        <div className="bg-white dark:bg-slate-800/90 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Fontes de Notícias & Canais Conectados ({fontes.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Gerencie provedores de notícias em tempo real (RSS da CNN, G1, etc.) e canais manuais internos.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={openNewFonteModal}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-700/80 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition"
              >
                <Plus className="w-3.5 h-3.5 text-blue-600" />
                Adicionar Fonte
              </button>

              <button
                onClick={handleSyncAllFontes}
                disabled={syncingAll}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 transition active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
                {syncingAll ? 'Sincronizando Todas as Fontes...' : 'Sincronizar Todas as Fontes (CNN + G1)'}
              </button>
            </div>
          </div>

          {syncMessage && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-xl border border-emerald-200 dark:border-emerald-800 animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              {syncMessage}
            </div>
          )}

          {/* GRID DINÂMICO DE FONTES CADASTRADAS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-1">
            {(fontes || []).map((fonte) => {
              const isSyncingThis = syncingFonteId === fonte.id;
              const isRSS = fonte.tipo === 'rss';

              return (
                <div
                  key={fonte.id}
                  className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between space-y-3 ${
                    fonte.is_ativo
                      ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 shadow-2xs'
                      : 'border-dashed border-slate-300 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-900/30 opacity-60'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider uppercase ${getBadgeColorClasses(fonte.badge_cor)}`}>
                        {fonte.badge_texto || fonte.nome}
                      </span>
                      
                      {/* Switch de Ativação Rápida */}
                      <button
                        type="button"
                        onClick={() => handleToggleFonte(fonte)}
                        className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full transition ${
                          fonte.is_ativo
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                        title={fonte.is_ativo ? 'Desativar sincronização' : 'Ativar sincronização'}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${fonte.is_ativo ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {fonte.is_ativo ? (isRSS ? 'RSS Ativo' : 'Canal Ativo') : 'Pausado'}
                      </button>
                    </div>

                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-1">
                      {fonte.nome}
                    </p>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                      {fonte.descricao || (isRSS ? 'Sincronização automática via RSS em tempo real com imagem e links diretos.' : 'Canal editorial gerenciado manualmente pela administração Kyrus.')}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[10px] text-slate-400">
                    <div className="flex items-center gap-1.5 truncate max-w-[140px]">
                      {isRSS ? (
                        <Rss className="w-3 h-3 text-rose-500 shrink-0" />
                      ) : (
                        <Radio className="w-3 h-3 text-indigo-500 shrink-0" />
                      )}
                      <span className="truncate">{fonte.site_url ? getDomainFromUrl(fonte.site_url) : (isRSS ? 'RSS' : 'Manual')}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {isRSS && (
                        <button
                          type="button"
                          onClick={() => handleSyncSingleFonte(fonte)}
                          disabled={isSyncingThis || !fonte.is_ativo}
                          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 transition"
                          title="Sincronizar esta fonte agora"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isSyncingThis ? 'animate-spin text-blue-600' : ''}`} />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditFonteModal(fonte)}
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
                        title="Editar fonte"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteFonte(fonte.id)}
                        className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-500 transition"
                        title="Excluir fonte"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                      className={`p-2 rounded-xl transition ${
                        anuncio.is_ativo
                          ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title={anuncio.is_ativo ? 'Desativar anúncio' : 'Ativar anúncio'}
                    >
                      {anuncio.is_ativo ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                    </button>
                  </div>

                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {anuncio.titulo}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                    {anuncio.descricao}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <a
                    href={anuncio.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 truncate max-w-[200px]"
                  >
                    <span>{anuncio.cta_texto || 'Saiba Mais'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditAnuncioModal(anuncio)}
                      className="p-2 text-slate-400 hover:text-blue-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                      title="Editar anúncio"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteAnuncio(anuncio.id)}
                      className="p-2 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                      title="Excluir anúncio"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LISTA DE NOTÍCIAS */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(noticias || []).map((noticia) => {
            const imgSrc = toPublicAssetUrl(noticia?.imagem_url) || noticia?.imagem_url || undefined;
            const isCNN = (noticia?.fonte || '').toLowerCase().includes('cnn');
            const isG1 = (noticia?.fonte || '').toLowerCase().includes('g1');

            return (
              <div
                key={noticia.id}
                className={`flex flex-col justify-between p-4 rounded-3xl border transition-all duration-200 ${
                  noticia.is_ativo
                    ? 'bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700/60 opacity-60'
                }`}
              >
                <div className="space-y-3">
                  <div className="relative h-36 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 dark:border-slate-700">
                    {imgSrc && (
                      <img
                        src={imgSrc}
                        alt={noticia.titulo || 'Notícia'}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase shadow-xs ${
                        isCNN ? 'bg-rose-600 text-white' : isG1 ? 'bg-red-600 text-white' : 'bg-slate-900/80 text-white'
                      }`}>
                        {noticia.fonte}
                      </span>
                      {noticia.categoria && (
                        <span className="px-2 py-0.5 rounded-md bg-white/90 text-slate-800 text-[10px] font-bold shadow-xs">
                          {noticia.categoria}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug">
                      {noticia.titulo}
                    </h4>
                    {noticia.resumo && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                        {noticia.resumo}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {noticia.link_url && (
                      <a
                        href={noticia.link_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                      >
                        <span>Abrir Link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleNoticia(noticia)}
                      className={`p-1.5 rounded-xl transition ${
                        noticia.is_ativo
                          ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                          : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                      title={noticia.is_ativo ? 'Desativar do rodízio' : 'Ativar no rodízio'}
                    >
                      {noticia.is_ativo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => openEditNoticiaModal(noticia)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                      title="Editar notícia"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteNoticia(noticia.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                      title="Excluir notícia"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL: ANÚNCIO */}
      {showModal && subTab === 'anuncios' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <MegaphoneIcon className="w-5 h-5 text-blue-600" />
                {editingAnuncio ? 'Editar Anúncio Publicitário' : 'Novo Anúncio Publicitário'}
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

                {!anuncioForm.logo_url && (
                  <div>
                    <input
                      type="text"
                      value={anuncioForm.logo_url}
                      onChange={(e) => setAnuncioForm({ ...anuncioForm, logo_url: e.target.value })}
                      className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ou cole uma URL externa (ex: https://...)"
                    />
                  </div>
                )}
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

      {/* MODAL: NOTÍCIA / COMUNICADO */}
      {showModal && subTab === 'noticias' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <NewspaperIcon className="w-5 h-5 text-blue-600" />
                {editingNoticia ? 'Editar Notícia / Comunicado' : 'Nova Notícia / Comunicado Interno'}
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
                  placeholder="Ex: Comunicado sobre a nova versão do ERP Kyrus"
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
                    Fonte / Canal *
                  </label>
                  <select
                    value={noticiaForm.fonte}
                    onChange={(e) => {
                      const val = e.target.value;
                      const selectedFonte = fontes.find(f => f.nome === val);
                      setNoticiaForm({
                        ...noticiaForm,
                        fonte: val,
                        categoria: selectedFonte?.categoria_padrao || noticiaForm.categoria
                      });
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {fontes.map(f => (
                      <option key={f.id} value={f.nome}>
                        {f.nome} ({f.tipo === 'manual' ? 'Editorial' : 'RSS'})
                      </option>
                    ))}
                    {!fontes.some(f => f.nome === noticiaForm.fonte) && (
                      <option value={noticiaForm.fonte}>{noticiaForm.fonte}</option>
                    )}
                  </select>
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
                    placeholder="Ex: Comunicado, Economia, Tecnologia"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Link de Destino / Reportagem (Opcional se interno)
                </label>
                <input
                  type="url"
                  value={noticiaForm.link_url}
                  onChange={(e) => setNoticiaForm({ ...noticiaForm, link_url: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://..."
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

                {!noticiaForm.imagem_url && (
                  <div>
                    <input
                      type="text"
                      required
                      value={noticiaForm.imagem_url}
                      onChange={(e) => setNoticiaForm({ ...noticiaForm, imagem_url: e.target.value })}
                      className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Ou cole a URL da imagem (ex: https://images.unsplash.com/...)"
                    />
                  </div>
                )}
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
                    Ativa no Rodízio da Tela de Login
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

      {/* MODAL: FONTE DE NOTÍCIAS (CANAL RSS OU EDITORIAL MANUAL) */}
      {showFonteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Rss className="w-5 h-5 text-rose-600" />
                {editingFonte ? 'Configurar Fonte de Notícias' : 'Nova Fonte / Canal de Notícias'}
              </h3>
              <button
                onClick={() => setShowFonteModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveFonte} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Nome da Fonte *
                  </label>
                  <input
                    type="text"
                    required
                    value={fonteForm.nome}
                    onChange={(e) => setFonteForm({ ...fonteForm, nome: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: CNN Brasil, Valor Econômico"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Tipo do Canal *
                  </label>
                  <select
                    value={fonteForm.tipo}
                    onChange={(e) => setFonteForm({ ...fonteForm, tipo: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="rss">Feed RSS Automático</option>
                    <option value="manual">Manual / Editorial Interno</option>
                  </select>
                </div>
              </div>

              {fonteForm.tipo === 'rss' && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    URL do Feed RSS *
                  </label>
                  <input
                    type="url"
                    required={fonteForm.tipo === 'rss'}
                    value={fonteForm.rss_url}
                    onChange={(e) => setFonteForm({ ...fonteForm, rss_url: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                    placeholder="https://www.cnnbrasil.com.br/feed/ ou https://g1.globo.com/rss/..."
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Website do Portal / Link Oficial
                </label>
                <input
                  type="url"
                  value={fonteForm.site_url}
                  onChange={(e) => setFonteForm({ ...fonteForm, site_url: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://www.cnnbrasil.com.br/economia/"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Badge Texto
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={fonteForm.badge_texto}
                    onChange={(e) => setFonteForm({ ...fonteForm, badge_texto: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono"
                    placeholder="CNN"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Cor do Badge
                  </label>
                  <select
                    value={fonteForm.badge_cor}
                    onChange={(e) => setFonteForm({ ...fonteForm, badge_cor: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="rose">Rose (CNN)</option>
                    <option value="red">Red (G1)</option>
                    <option value="indigo">Indigo (Kyrus)</option>
                    <option value="blue">Blue (Valor)</option>
                    <option value="emerald">Emerald (InfoMoney)</option>
                    <option value="amber">Amber</option>
                    <option value="purple">Purple</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Categoria Padrão
                  </label>
                  <input
                    type="text"
                    value={fonteForm.categoria_padrao}
                    onChange={(e) => setFonteForm({ ...fonteForm, categoria_padrao: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Economia"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                  Descrição do Canal
                </label>
                <textarea
                  rows={2}
                  value={fonteForm.descricao}
                  onChange={(e) => setFonteForm({ ...fonteForm, descricao: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Objetivo ou cobertura editorial deste canal..."
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fonteForm.is_ativo}
                    onChange={(e) => setFonteForm({ ...fonteForm, is_ativo: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Fonte Ativa para Sincronização
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFonteModal(false)}
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
                    Salvar Fonte
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
