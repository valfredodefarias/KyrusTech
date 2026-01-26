import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Building2, Search, UserPlus, ArrowRightLeft, Briefcase, Upload, X, Loader2, Pencil, Users, Shield, Plus, Trash2, ChevronDown, ChevronUp
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

interface Consultor {
  id: number;
  nome: string;
  email: string;
  consultor_role: string;
}

interface ConsultorEmpresa {
  empresa_id: number;
  empresa_nome: string;
  ativo: boolean;
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
        className="w-14 h-14 rounded-lg shrink-0 flex items-center justify-center font-bold text-lg shadow-sm text-white"
        style={{ backgroundColor: cor }}
      >
        {iniciais}
      </div>
    );
  }

  return (
    <div className="w-14 h-14 rounded-lg shrink-0 bg-white flex items-center justify-center border border-slate-200 overflow-hidden shadow-sm">
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
  const [consultores, setConsultores] = useState<Consultor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSuperConsultor, setIsSuperConsultor] = useState(false);
  
  // Modais
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showTrocaModal, setShowTrocaModal] = useState(false);
  const [targetEmpresa, setTargetEmpresa] = useState<Empresa | null>(null);

  // Super-Consultor Management
  const [selectedConsultor, setSelectedConsultor] = useState<Consultor | null>(null);
  const [consultorEmpresas, setConsultorEmpresas] = useState<ConsultorEmpresa[]>([]);
  const [loadingConsultorEmpresas, setLoadingConsultorEmpresas] = useState(false);
  const [expandedConsultorId, setExpandedConsultorId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'empresas' | 'consultores'>('empresas');

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
    verificarSuperConsultor();
  }, []);

  async function verificarSuperConsultor() {
    try {
      const res = await api.get('/usuarios/me');
      setIsSuperConsultor(res.data.consultor_role === 'SUPER_CONSULTOR');
      if (res.data.consultor_role === 'SUPER_CONSULTOR') {
        carregarConsultores();
      }
    } catch (error) {
      console.error("Erro ao verificar role do usuário", error);
    }
  }

  async function carregarConsultores() {
    try {
      const res = await api.get('/consultor/super/consultores');
      // Backend retorna { id, nome, email, consultor_role }
      const formatted = res.data.map((c: any) => ({
        id: c.id,
        nome: c.nome || c.email,  // Usar nome real, fallback para email
        email: c.email,
        consultor_role: c.consultor_role
      }));
      setConsultores(formatted);
    } catch (error) {
      console.error("Erro ao listar consultores", error);
    }
  }

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
      // Se for consultor, não envia empresa_id (será null/0)
      const payload = {
        ...newUser,
        empresa_id: newUser.is_consultor ? null : (newUser.empresa_id || null)
      };
      await api.post('/usuarios/', payload);
      setShowUserModal(false);
      setNewUser({ nome: '', email: '', password: '', empresa_id: 0, is_consultor: false });
      // Recarregar consultores se for super-consultor
      if (isSuperConsultor) {
        carregarConsultores();
      }
    } catch (error) {
      console.error(error);
      alert('Erro ao criar usuário');
    }
  }

  async function abrirConsultorModal(consultor: Consultor) {
    setSelectedConsultor(consultor);
    setLoadingConsultorEmpresas(true);
    setExpandedConsultorId(consultor.id);
    
    try {
      const res = await api.get(`/consultor/super/consultores/${consultor.id}/empresas`);
      // Backend retorna array de { acesso_id, empresa_id, nome_fantasia, ativo }
      const formatted = res.data.map((ce: any) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao listar empresas do consultor", error);
    } finally {
      setLoadingConsultorEmpresas(false);
    }
  }

  async function adicionarEmpresaAoConsultor(consultorId: number, empresaId: number) {
    try {
      await api.post(`/consultor/super/consultores/${consultorId}/empresas/${empresaId}/adicionar`);
      // Recarregar empresas do consultor
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = res.data.map((ce: any) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao adicionar empresa", error);
    }
  }

  async function removerEmpresaDoConsultor(consultorId: number, empresaId: number) {
    try {
      await api.post(`/consultor/super/consultores/${consultorId}/empresas/${empresaId}/revogar`);
      // Recarregar empresas do consultor
      const res = await api.get(`/consultor/super/consultores/${consultorId}/empresas`);
      const formatted = res.data.map((ce: any) => ({
        empresa_id: ce.empresa_id,
        empresa_nome: ce.nome_fantasia || ce.empresa_nome,
        ativo: ce.ativo
      }));
      setConsultorEmpresas(formatted);
    } catch (error) {
      console.error("Erro ao remover empresa", error);
    }
  }

  async function mudarRoleConsultor(consultorId: number) {
    try {
      const consultor = consultores.find(c => c.id === consultorId);
      if (!consultor) return;
      
      // Alternar role: CONSULTOR <-> SUPER_CONSULTOR
      const novoRole = consultor.consultor_role === 'SUPER_CONSULTOR' ? 'CONSULTOR' : 'SUPER_CONSULTOR';
      
      await api.post(`/consultor/super/consultores/${consultorId}/role`, { role: novoRole });
      // Recarregar lista de consultores
      carregarConsultores();
      if (selectedConsultor?.id === consultorId) {
        const updated = consultores.find(c => c.id === consultorId);
        if (updated) setSelectedConsultor({ ...updated, consultor_role: novoRole });
      }
    } catch (error) {
      console.error("Erro ao mudar role", error);
    }
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

  // --- LÓGICA DE TROCA DE CONTEXTO ---
  function solicitarTroca(emp: Empresa) {
    setTargetEmpresa(emp);
    setShowTrocaModal(true);
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

      {/* TABS (mostrar se super-consultor) */}
      {isSuperConsultor && (
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 rounded-t-xl">
          <button 
            onClick={() => setActiveTab('empresas')}
            className={`px-4 py-2 font-bold transition ${activeTab === 'empresas' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <Building2 size={18} className="inline mr-2" /> Minhas Empresas
          </button>
          <button 
            onClick={() => setActiveTab('consultores')}
            className={`px-4 py-2 font-bold transition ${activeTab === 'consultores' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <Users size={18} className="inline mr-2" /> Gerenciar Consultores
          </button>
        </div>
      )}

      {/* SEARCH */}
      {activeTab === 'empresas' && (
      <div className="relative group">
        <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
        <input 
          type="text" placeholder="Pesquisar por nome ou razão social..." 
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition shadow-sm"
          value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      )}

      {/* ABA EMPRESAS */}
      {activeTab === 'empresas' && (
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
      )}

      {/* ABA GERENCIAR CONSULTORES (SUPER-CONSULTOR ONLY) */}
      {activeTab === 'consultores' && isSuperConsultor && (
      <div className="space-y-4">
        {consultores.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
            <Users size={32} className="mx-auto mb-2 text-slate-400" />
            <p className="text-slate-500 dark:text-slate-400">Nenhum consultor encontrado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {consultores.map(consultor => (
              <div key={consultor.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <button 
                  onClick={() => abrirConsultorModal(consultor)}
                  className="w-full text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 p-2 rounded transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
                      {consultor.nome.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 dark:text-white">{consultor.nome}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{consultor.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                      consultor.consultor_role === 'SUPER_CONSULTOR' 
                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' 
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    }`}>
                      {consultor.consultor_role === 'SUPER_CONSULTOR' ? '👑 Super' : '📊 Consultor'}
                    </span>
                    {expandedConsultorId === consultor.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                </button>

                {/* Expandir detalhes */}
                {expandedConsultorId === consultor.id && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    {/* Empresas do Consultor */}
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Empresas Vinculadas:</p>
                      {loadingConsultorEmpresas ? (
                        <p className="text-xs text-slate-500">Carregando...</p>
                      ) : consultorEmpresas.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma empresa vinculada</p>
                      ) : (
                        <div className="space-y-2">
                          {consultorEmpresas.map(ce => (
                            <div key={ce.empresa_id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700/50 p-2 rounded text-sm">
                              <span className="text-slate-700 dark:text-slate-300">{ce.empresa_nome}</span>
                              <button 
                                onClick={() => removerEmpresaDoConsultor(consultor.id, ce.empresa_id)}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 transition"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Adicionar Empresa */}
                    <div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Adicionar Empresa:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {empresas.map(emp => {
                          const jaTemAcesso = consultorEmpresas.some(ce => ce.empresa_id === emp.id);
                          return (
                            <button 
                              key={emp.id}
                              onClick={() => adicionarEmpresaAoConsultor(consultor.id, emp.id)}
                              disabled={jaTemAcesso}
                              className={`px-3 py-2 rounded text-xs font-bold flex items-center gap-1 transition ${
                                jaTemAcesso 
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed' 
                                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200'
                              }`}
                            >
                              <Plus size={14} /> {emp.nome_fantasia.substring(0, 12)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Mudar Role */}
                    <div>
                      <button 
                        onClick={() => mudarRoleConsultor(consultor.id)}
                        className="w-full px-3 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded font-bold text-sm hover:bg-amber-200 transition flex items-center justify-center gap-2"
                      >
                        <Shield size={16} /> 
                        {consultor.consultor_role === 'CONSULTOR' ? 'Promover para Super-Consultor' : 'Rebaixar para Consultor'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

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
                  <div className="flex h-10.5 border border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden">
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
                <select className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white" value={newUser.empresa_id} onChange={e => setNewUser({...newUser, empresa_id: Number(e.target.value)})} disabled={newUser.is_consultor}>
                  <option value={0}>{newUser.is_consultor ? '-- Consultores acessam múltiplas empresas --' : '-- Selecione --'}</option>
                  {!newUser.is_consultor && empresas.map(emp => (<option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>))}
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