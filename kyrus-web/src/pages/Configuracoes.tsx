import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { 
  Building2, UploadCloud, Layers, Save, Loader2, 
  Palette, Check, AlertCircle, Camera, RefreshCw 
} from 'lucide-react';

// Importa os componentes do arquivo de Importação
// ATENÇÃO: Certifique-se de que eles estão exportados no arquivo de origem!
import { Importacao, PlanoContasManager } from './Importacao'; 

// --- INTERFACES ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  cor_primaria?: string;
  logo_url?: string;
}

interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
}

// --- SUB-COMPONENTE: DADOS DA EMPRESA ---
const DadosEmpresa = () => {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cor, setCor] = useState('#2563eb');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [userPhotoFile, setUserPhotoFile] = useState<File | null>(null);
  const [userPhotoPreview, setUserPhotoPreview] = useState<string | null>(null);

  useEffect(() => { loadEmpresa(); }, []);

  // Cria preview local imediato quando o usuário seleciona um arquivo
  useEffect(() => {
    if (logoFile) {
        const url = URL.createObjectURL(logoFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url); // Limpa memória ao desmontar
    }
  }, [logoFile]);

  useEffect(() => {
    if (userPhotoFile) {
      const url = URL.createObjectURL(userPhotoFile);
      setUserPhotoPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [userPhotoFile]);

  async function loadEmpresa() {
    try {
      const { data: userData } = await api.get<UserInfo & { empresa_id?: number }>('/usuarios/me');
      setUser(userData);
      if (userData.foto_url) {
        const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
        setUserPhotoPreview(userData.foto_url.startsWith('http') ? userData.foto_url : `${baseURL}${userData.foto_url}`);
      }
      if (userData.empresa_id) {
        const { data: emp } = await api.get(`/empresas/${userData.empresa_id}`);
        setEmpresa(emp);
        if (emp.cor_primaria) setCor(emp.cor_primaria);
        
        // Ajusta URL da logo se for relativa (vem do backend)
        if (emp.logo_url) {
            const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
            // Se já tiver http (S3/Cloud) usa direto, senão concatena base
            setPreviewUrl(emp.logo_url.startsWith('http') ? emp.logo_url : `${baseURL}${emp.logo_url}`);
        }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setLogoFile(e.target.files[0]);
    }
  };

  const handleUserPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUserPhotoFile(e.target.files[0]);
    }
  };

  async function handleRemoveUserPhoto() {
    try {
      await api.delete('/usuarios/me/foto');
      setUserPhotoFile(null);
      setUserPhotoPreview(null);
      setUser(prev => prev ? { ...prev, foto_url: null } : prev);
    } catch (e) {
      console.error(e);
      alert('Erro ao remover foto.');
    }
  }

  async function handleSave() {
    if (!empresa) return;
    setSaving(true);
    try {
       if (userPhotoFile) {
         const fdUser = new FormData();
         fdUser.append('file', userPhotoFile);
         const { data } = await api.post('/usuarios/me/foto', fdUser);
         setUser(data);
       }
        // 1. Upload da Logo (se houve alteração)
        if (logoFile) {
             const fdLogo = new FormData();
             fdLogo.append('file', logoFile); // Campo 'file' deve bater com o backend
             await api.post(`/empresas/${empresa.id}/logo`, fdLogo);
        }
        
        // 2. Atualiza Cor e Dados da Empresa
        await api.patch(`/empresas/${empresa.id}`, { cor_primaria: cor });
        
        // Aplica visualmente na hora (sem precisar de refresh para ver a cor)
        document.documentElement.style.setProperty('--color-primary', cor);
        
        alert("Configurações salvas com sucesso!");
        
        // Reload suave para propagar a logo nova para o Sidebar
        window.location.reload(); 
        
    } catch (e) { 
        console.error(e);
        alert("Erro ao salvar configurações."); 
    } finally { 
        setSaving(false); 
    }
  }

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8"/></div>;
  if (!empresa) return <div className="p-10 text-center text-slate-500">Empresa não encontrada.</div>;

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 sm:p-8 shadow-xl">
        
        {/* CABEÇALHO COM LOGO (CROPADA/REDONDA) */}
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 mb-10 pb-10 border-b border-slate-200 dark:border-slate-700">
          
          {/* Container da Logo */}
          <div className="relative group">
            {/* A classe overflow-hidden corta o que passar da borda redonda */}
            <div className="w-32 h-32 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border-4 border-slate-200 dark:border-slate-700 shadow-xl group-hover:border-blue-500 transition-colors">
                {previewUrl ? (
                    // object-cover: A imagem dá zoom para preencher tudo (sem bordas brancas quadradas)
                    <img 
                        src={previewUrl} 
                        className="w-full h-full object-cover" 
                        alt="Logo da Empresa"
                    />
                ) : (
                    // Fallback se não tiver logo: Iniciais
                    <span className="text-4xl font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 w-full h-full flex items-center justify-center">
                        {empresa.nome_fantasia.substring(0,2).toUpperCase()}
                    </span>
                )}
            </div>
            
            {/* Botão Flutuante de Upload */}
            <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 border-4 border-white dark:border-slate-800 z-10">
                <Camera className="w-5 h-5"/>
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange}/>
            </label>
          </div>
          
          <div className="text-center md:text-left">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">{empresa.nome_fantasia}</h2>
            <div className="flex flex-col md:flex-row gap-3 items-center">
                <p className="text-slate-400 font-mono bg-slate-900/50 px-3 py-1 rounded-lg inline-block border border-slate-700">
                    {empresa.cnpj}
                </p>
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold rounded-full border border-emerald-500/20 flex items-center gap-1">
                    <Check className="w-3 h-3"/> CONTA ATIVA
                </span>
            </div>
          </div>
        </div>

        {/* FOTO DO USUÁRIO */}
        <div className="mb-10">
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Camera className="w-4 h-4 text-blue-500"/> Minha Foto
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-6">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden border-4 border-slate-200 dark:border-slate-700 shadow-xl">
                {userPhotoPreview ? (
                  <img src={userPhotoPreview} className="w-full h-full object-cover" alt="Foto do usuário" />
                ) : (
                  <span className="text-xl font-bold text-slate-400 bg-slate-200 dark:bg-slate-800 w-full h-full flex items-center justify-center">
                    {(user?.nome || user?.email || 'U').substring(0,2).toUpperCase()}
                  </span>
                )}
              </div>
              <label className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 border-4 border-white dark:border-slate-800">
                <Camera className="w-4 h-4"/>
                <input type="file" accept="image/*" className="hidden" onChange={handleUserPhotoChange}/>
              </label>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-slate-900 dark:text-white font-bold mb-1">{user?.nome || user?.email}</p>
              <p className="text-sm text-slate-400">Sua foto aparece na sidebar e nos dashboards.</p>
            </div>
            {userPhotoPreview && (
              <button
                type="button"
                onClick={handleRemoveUserPhoto}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Remover
              </button>
            )}
          </div>
        </div>

        {/* FORMULÁRIO (DADOS FISCAIS) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Razão Social</label>
            <input disabled value={empresa.razao_social} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-medium cursor-not-allowed opacity-70" />
            <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Dados fiscais são protegidos.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">CNPJ</label>
            <input disabled value={empresa.cnpj} className="w-full p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 font-mono cursor-not-allowed opacity-70" />
          </div>
        </div>

        {/* PERSONALIZAÇÃO VISUAL */}
        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-white uppercase mb-4 flex items-center gap-2">
            <Palette className="w-4 h-4 text-blue-500"/> Identidade Visual
          </label>
          <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-6">
            <div className="relative group cursor-pointer">
                <input 
                  type="color" 
                  value={cor} 
                  onChange={e => setCor(e.target.value)}
                  className="w-20 h-20 rounded-xl cursor-pointer bg-transparent border-0 p-0 overflow-hidden" 
                />
                {/* Overlay visual para indicar clique */}
                <div className="absolute inset-0 pointer-events-none rounded-xl border border-slate-300 dark:border-slate-600 shadow-inner group-hover:border-slate-600 dark:group-hover:border-white/50 transition-colors"></div>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-slate-900 dark:text-white font-bold mb-1">Cor Primária</p>
              <p className="text-sm text-slate-400 mb-2">Esta cor define a "alma" do seu ERP (botões, menus e destaques).</p>
              <p className="text-xs font-mono text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded inline-block">{cor.toUpperCase()}</p>
            </div>
            {/* Botão de Demonstração */}
            <button className="px-6 py-3 rounded-xl text-white font-bold text-sm shadow-lg transition-transform hover:scale-105 active:scale-95" style={{ backgroundColor: cor }}>
              Botão Exemplo
            </button>
          </div>
        </div>

        {/* BOTÃO SALVAR */}
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-700 flex justify-end">
          <button 
            onClick={handleSave} 
            disabled={saving} 
            className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-xl shadow-blue-900/20 flex items-center gap-3 transition-all hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0" 
            style={{ backgroundColor: cor }}
          >
            {saving ? <Loader2 className="animate-spin w-5 h-5"/> : <Save className="w-5 h-5"/>} 
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTE: PLANO DE CONTAS (Wrapper) ---
const GestaoPlanoContas = () => {
  const [categorias, setCategorias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const setPlanoContasCache = useLookupStore((state) => state.setPlanoContas);

  // Reutiliza a lógica de carregar categorias
  async function loadCats(force = false) {
    setLoading(true);
    try {
      const data = await fetchPlanoContas(force);
      setCategorias(data);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { loadCats(); }, []);

  // Callback para atualizar lista localmente após drag & drop
  const handleUpdate = (newCats: any[]) => {
    setCategorias(newCats);
    setPlanoContasCache(newCats);
  };

  if(loading) return <div className="p-20 text-center"><Loader2 className="animate-spin w-10 h-10 text-blue-500 mx-auto"/></div>;

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in">
        <div className="mb-8 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Plano de Contas</h2>
                <p className="text-slate-400 mt-1">Estruture suas receitas e despesas hierarquicamente.</p>
            </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadCats(true)}
              className="text-xs bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Sincronizar
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-500"/>
              Arraste para organizar • Solte sobre outro para criar subgrupo
            </div>
          </div>
        </div>
        
        {/* Renderiza o componente importado de Importacao.tsx */}
        <PlanoContasManager categorias={categorias} onUpdateList={handleUpdate} />
    </div>
  );
};

// --- PÁGINA PRINCIPAL ---
export function Configuracoes() {
  const [activeTab, setActiveTab] = useState<'EMPRESA' | 'PLANO' | 'IMPORTACAO'>('EMPRESA');

  // Classe utilitária para as abas (Estilo Sênior)
  const getTabClass = (tab: string) => `
    flex-1 py-4 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-2 cursor-pointer select-none
    ${activeTab === tab 
      ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-slate-100 dark:bg-slate-800/50' 
      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/30'}
  `;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-y-auto custom-scrollbar">
      
      {/* HEADER FIXO COM TABS */}
      <div className="sticky top-0 z-30 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700 px-6 pt-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-6">Configurações</h1>
        
        {/* TAB NAVIGATION */}
        <div className="flex w-full max-w-4xl border-b border-slate-200 dark:border-slate-800">
            <button onClick={() => setActiveTab('EMPRESA')} className={getTabClass('EMPRESA')}>
                <Building2 className="w-4 h-4"/> Minha Empresa
            </button>
            <button onClick={() => setActiveTab('PLANO')} className={getTabClass('PLANO')}>
                <Layers className="w-4 h-4"/> Plano de Contas
            </button>
            <button onClick={() => setActiveTab('IMPORTACAO')} className={getTabClass('IMPORTACAO')}>
                <UploadCloud className="w-4 h-4"/> Importação de Dados
            </button>
        </div>
      </div>

      {/* ÁREA DE CONTEÚDO */}
      <div className="p-6 pb-20">
        {activeTab === 'EMPRESA' && <DadosEmpresa />}
        {activeTab === 'PLANO' && <GestaoPlanoContas />}
        {activeTab === 'IMPORTACAO' && (
            <div className="animate-in fade-in slide-in-from-right-4">
                {/* Importação Completa */}
                <Importacao /> 
            </div>
        )}
      </div>
    </div>
  );
}