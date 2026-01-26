import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Building2, Search, UserPlus, ArrowRightLeft, Briefcase, Upload, X, Loader2, Pencil
} from 'lucide-react';

// --- TIPAGENS ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  logo_url?: string;
  cor_primaria?: string;
}

interface NovoUsuario {
  nome: string;
  email: string;
  password: string;
  empresa_id: number;
  is_consultor: boolean;
}

// Interface unificada para Criar ou Editar
interface FormEmpresa {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  cor_primaria: string;
  logo_url: string; 
}

// --- COMPONENTE AVATAR ---
const AvatarEmpresa = ({ nome, src, cor }: { nome: string, src?: string, cor: string }) => {
  const [error, setError] = useState(false);
  const iniciais = nome.substring(0, 2).toUpperCase();

  let fullSrc = src;
  if (src && src.startsWith('/static')) {
    const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
    fullSrc = `${baseURL}${src}`;
  }

  if (!src || error) {
    return (
      <div 
        className="w-14 h-14 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-lg shadow-sm text-white"
        style={{ backgroundColor: cor }}
      >
        {iniciais}
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-lg flex-shrink-0 bg-white flex items-center justify-center border border-slate-200 overflow-hidden shadow-sm">
      <img 
        src={fullSrc} 
        alt={nome} 
        className="w-full h-full object-contain p-1" 
        onError={() => setError(true)}
      />
    </div>
  );
};

export function Consultor() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modais
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showTrocaModal, setShowTrocaModal] = useState(false);
  const [targetEmpresa, setTargetEmpresa] = useState<Empresa | null>(null);

  // States Formulários
  const [newUser, setNewUser] = useState<NovoUsuario>({
    nome: '', email: '', password: '', empresa_id: 0, is_consultor: false
  });
  
  const [formEmpresa, setFormEmpresa] = useState<FormEmpresa>({
    nome_fantasia: '', razao_social: '', cnpj: '', cor_primaria: '#2563eb', logo_url: ''
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    carregarEmpresas();
  }, []);

  async function carregarEmpresas() {
    try {
      const res = await api.get('/empresas/'); 
      setEmpresas(res.data);
    } catch (error) {
      console.error("Erro ao listar empresas", error);
    } finally {
      setLoading(false);
    }
  }

  // --- ABRIR MODAL (CRIAR OU EDITAR) ---
  function handleOpenEdit(emp: Empresa) {
    setIsEditing(true);
    setEditingId(emp.id);
    setFormEmpresa({
      nome_fantasia: emp.nome_fantasia,
      razao_social: emp.razao_social || '',
      cnpj: emp.cnpj || '',
      cor_primaria: emp.cor_primaria || '#2563eb',
      logo_url: emp.logo_url || ''
    });

    if (emp.logo_url) {
      const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
      const fullUrl = emp.logo_url.startsWith('/static') ? `${baseURL}${emp.logo_url}` : emp.logo_url;
      setPreviewUrl(fullUrl);
    } else {
      setPreviewUrl(null);
    }
    setShowEmpresaModal(true);
  }

  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setFormEmpresa({ nome_fantasia: '', razao_social: '', cnpj: '', cor_primaria: '#2563eb', logo_url: '' });
    setPreviewUrl(null);
    setShowEmpresaModal(true);
  }

  // --- UPLOAD LOGO ---
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post('/anexos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const serverUrl = res.data.url;
      setFormEmpresa({ ...formEmpresa, logo_url: serverUrl });
      const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
      setPreviewUrl(`${baseURL}${serverUrl}`);
    } catch (error) {
      console.error("Erro upload", error);
    } finally {
      setUploading(false);
    }
  };

  // --- SUBMIT EMPRESA ---
  async function handleSubmitEmpresa(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (isEditing && editingId) {
        await api.patch(`/empresas/${editingId}`, formEmpresa);
      } else {
        await api.post('/empresas/', formEmpresa);
      }
      setShowEmpresaModal(false);
      carregarEmpresas();
    } catch (error) {
      console.error(error);
    }
  }

  // --- SUBMIT USUÁRIO ---
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/usuarios/', newUser);
      setShowUserModal(false);
      setNewUser({ nome: '', email: '', password: '', empresa_id: 0, is_consultor: false });
    } catch (error) {
      console.error(error);
    }
  }

  // --- LÓGICA DE TROCA DE CONTEXTO ---
  function solicitarTroca(emp: Empresa) {
    setTargetEmpresa(emp);
    setShowTrocaModal(true);
  }

  async function confirmarTroca() {
    if (!targetEmpresa) return;
    try {
      // 1. Chama a API real (seu arquivo consultor.py)
      await api.post('/consultor/trocar-empresa', { empresa_id: targetEmpresa.id });
      
      // 2. Força recarregamento para atualizar Sidebar e Dashboard
      window.location.href = '/home'; 
    } catch (error) {
      console.error("Erro ao trocar empresa", error);
      setShowTrocaModal(false);
    }
  }

  const empresasFiltradas = empresas.filter(emp => 
    emp.nome_fantasia.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.razao_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.cnpj?.includes(searchTerm)
  );

  if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse">Carregando...</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Briefcase className="text-blue-600" /> Área do Consultor
          </h1>
          <p className="text-slate-500 dark:text-slate-400">Gerenciamento global de multi-empresas.</p>
        </div>
        
        <div className="flex gap-3">
          <button onClick={handleOpenCreate} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-green-700 transition flex items-center gap-2 shadow-md active:scale-95">
            <Building2 size={18} /> Nova Empresa
          </button>
          <button onClick={() => setShowUserModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition flex items-center gap-2 shadow-md active:scale-95">
            <UserPlus size={18} /> Novo Usuário
          </button>
        </div>
      </div>

      {/* SEARCH */}
      <div className="relative group">
        <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
        <input 
          type="text" placeholder="Pesquisar por nome ou razão social..." 
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition shadow-sm"
          value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* GRID LIMPO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {empresasFiltradas.map(emp => {
          const cor = emp.cor_primaria || '#2563eb';
          return (
            <div key={emp.id} className="relative rounded-xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 group border flex flex-col justify-between"
              style={{ background: `linear-gradient(145deg, ${cor}08 0%, ${cor}15 100%)`, borderColor: `${cor}30` }}>
              
              {/* Botão de Editar */}
              <button onClick={() => handleOpenEdit(emp)} className="absolute top-3 right-3 p-2 rounded-full hover:bg-white/50 dark:hover:bg-black/20 text-slate-400 hover:text-blue-600 transition" title="Editar">
                <Pencil size={16} />
              </button>

              <div className="flex items-center gap-4 mb-6">
                <AvatarEmpresa nome={emp.nome_fantasia} src={emp.logo_url} cor={cor} />
                <div className="min-w-0 flex-1">
                  {/* Nome com Truncate para não vazar */}
                  <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight truncate" title={emp.nome_fantasia}>
                    {emp.nome_fantasia}
                  </h3>
                  <p className="text-xs font-mono opacity-60 dark:text-slate-300 mt-0.5">ID: {emp.id}</p>
                </div>
              </div>

              {/* Botão Acessar - Abre Modal de Confirmação */}
              <button 
                onClick={() => solicitarTroca(emp)}
                className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm mt-auto active:scale-95"
                style={{ backgroundColor: cor, color: '#fff' }}
              >
                <ArrowRightLeft size={16} /> Acessar Painel
              </button>
            </div>
          );
        })}
      </div>

      {/* --- MODAL CONFIRMAÇÃO DE TROCA --- */}
      {showTrocaModal && targetEmpresa && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-700 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
               <ArrowRightLeft size={32} className="text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Acessar Empresa?</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              Você será redirecionado para o painel de:<br/>
              <strong className="text-slate-800 dark:text-white text-lg">{targetEmpresa.nome_fantasia}</strong>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowTrocaModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-bold transition">
                Cancelar
              </button>
              <button onClick={confirmarTroca} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition shadow-lg">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE EMPRESA (CREATE & EDIT) --- */}
      {showEmpresaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Building2 className={isEditing ? "text-blue-500" : "text-green-500"} /> 
                {isEditing ? "Editar Empresa" : "Nova Empresa"}
              </h2>
              <button onClick={() => setShowEmpresaModal(false)} className="text-slate-400 hover:text-red-500 transition"><X size={24} /></button>
            </div>

            <form onSubmit={handleSubmitEmpresa} className="space-y-4">
              <div className="flex justify-center mb-4">
                <label className="relative cursor-pointer group">
                  <div className={`w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-700 border-2 border-dashed ${uploading ? 'border-blue-500' : 'border-slate-300 dark:border-slate-500'} flex items-center justify-center overflow-hidden hover:border-blue-500 transition`}>
                    {uploading ? <div className="text-blue-500 animate-spin"><Loader2 size={24} /></div> : previewUrl ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" /> : <div className="text-center text-slate-400"><Upload size={24} className="mx-auto mb-1" /><span className="text-[10px]">Logo</span></div>}
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} disabled={uploading} />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Fantasia</label>
                  <input required type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.nome_fantasia} onChange={e => setFormEmpresa({...formEmpresa, nome_fantasia: e.target.value})} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Razão Social</label>
                  <input type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.razao_social} onChange={e => setFormEmpresa({...formEmpresa, razao_social: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">CNPJ</label>
                  <input type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:border-blue-500 outline-none" value={formEmpresa.cnpj} onChange={e => setFormEmpresa({...formEmpresa, cnpj: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Cor da Marca</label>
                  <div className="flex h-[42px] border border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden">
                      <input type="color" className="h-full w-12 cursor-pointer border-none p-0" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                      <input type="text" className="flex-1 bg-transparent px-2 text-sm uppercase dark:text-white outline-none" value={formEmpresa.cor_primaria} onChange={e => setFormEmpresa({...formEmpresa, cor_primaria: e.target.value})} />
                  </div>
                </div>
              </div>

              <button type="submit" disabled={uploading} className={`w-full py-3 text-white font-bold rounded-xl transition shadow-lg mt-4 disabled:opacity-50 ${isEditing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {uploading ? 'Enviando...' : (isEditing ? 'Salvar' : 'Cadastrar')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL NOVO USUÁRIO (MANTIDO) --- */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in border border-slate-700">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <UserPlus className="text-blue-500" /> Novo Usuário
              </h2>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-red-500 transition"><X size={24} /></button>
            </div>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome Completo</label>
                <input required type="text" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.nome} onChange={e => setNewUser({...newUser, nome: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">E-mail</label>
                <input required type="email" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Senha</label>
                <input required type="password" className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Vincular Empresa</label>
                <select className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.empresa_id} onChange={e => setNewUser({...newUser, empresa_id: Number(e.target.value)})}>
                  <option value={0}>-- Selecione --</option>
                  {empresas.map(emp => (<option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-2 bg-slate-50 dark:bg-slate-700/50 p-2 rounded">
                <input type="checkbox" id="isConsultorCheck" checked={newUser.is_consultor} onChange={e => setNewUser({...newUser, is_consultor: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
                <label htmlFor="isConsultorCheck" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer select-none">Dar permissão de <strong>Consultor</strong>?</label>
              </div>
              <button type="submit" className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg mt-4">Criar Usuário</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}