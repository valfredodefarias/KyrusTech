import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Building2, Search, UserPlus, ArrowRightLeft, Briefcase, Upload, X, Loader2, Pencil, Users, Shield, Plus, Trash2, ChevronDown, ChevronUp,
  ClipboardList, CheckCircle2, Circle, KeyRound
} from 'lucide-react';

// --- TIPAGENS ---
interface Empresa {
  id: number;
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  logo_url?: string;
  cor_primaria?: string;
  is_active?: boolean;
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

interface UsuarioItem {
  id: number;
  nome?: string | null;
  email: string;
  is_active: boolean;
  is_consultor: boolean;
  consultor_role: string;
  empresa_id?: number | null;
  empresa_nome?: string | null;
}

interface TodoItem {
  id: number;
  titulo: string;
  descricao?: string | null;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | string;
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA' | string;
  due_date?: string | null;
  periodicidade?: 'UNICA' | 'DIARIA' | 'SEMANAL' | string;
  dias_semana?: string | null;
  inclui_sabado?: boolean;
  tipo_alvo: 'EMPRESA' | 'CONSULTOR' | string;
  empresa_id?: number | null;
  consultor_id?: number | null;
  last_started_at?: string | null;
  finished_at?: string | null;
  total_seconds?: number;
}

interface TodoForm {
  titulo: string;
  descricao: string;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO';
  prioridade: 'BAIXA' | 'MEDIA' | 'ALTA';
  due_date: string;
  end_date: string;
  periodicidade: 'UNICA' | 'DIARIA' | 'SEMANAL';
  dias_semana: string[];
  inclui_sabado: boolean;
  tipo_alvo: 'EMPRESA' | 'CONSULTOR';
  empresa_id: number;
  consultor_id: number;
}

// Interface unificada para Criar ou Editar
interface FormEmpresa {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  tipo_pessoa: 'PF' | 'PJ';
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
  const [activeTab, setActiveTab] = useState<'empresas' | 'consultores' | 'usuarios' | 'tarefas'>('empresas');

  // Usuários
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(false);

  // Tarefas
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loadingTodos, setLoadingTodos] = useState(false);
  const [todoResumo, setTodoResumo] = useState({
    amanha: 0,
    semana: 0,
    futuras: 0,
    atrasadas: 0,
    concluidas_atraso: 0
  });
  const [todoForm, setTodoForm] = useState<TodoForm>({
    titulo: '',
    descricao: '',
    status: 'PENDENTE',
    prioridade: 'MEDIA',
    due_date: '',
    end_date: '',
    periodicidade: 'UNICA',
    dias_semana: [],
    inclui_sabado: false,
    tipo_alvo: 'EMPRESA',
    empresa_id: 0,
    consultor_id: 0
  });

  const [showTodoForm, setShowTodoForm] = useState(false);

  const [currentUser, setCurrentUser] = useState<{ id: number; email: string; consultor_role: string } | null>(null);

  // States Formulários
  const [newUser, setNewUser] = useState<NovoUsuario>({
    nome: '', email: '', password: '', empresa_id: 0, is_consultor: false
  });
  
  const [formEmpresa, setFormEmpresa] = useState<FormEmpresa>({
    nome_fantasia: '', razao_social: '', cnpj: '', tipo_pessoa: 'PJ', cor_primaria: '#2563eb', logo_url: ''
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
      const isSuper = res.data.consultor_role === 'SUPER_CONSULTOR';
      setCurrentUser({ id: res.data.id, email: res.data.email, consultor_role: res.data.consultor_role });
      setIsSuperConsultor(isSuper);
      if (isSuper) {
        carregarConsultores();
        carregarUsuarios();
      }
      carregarTodos();
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

  async function carregarUsuarios() {
    try {
      setLoadingUsuarios(true);
      const res = await api.get('/consultor/super/usuarios');
      setUsuarios(res.data);
    } catch (error) {
      console.error("Erro ao listar usuários", error);
    } finally {
      setLoadingUsuarios(false);
    }
  }

  async function carregarTodos() {
    try {
      setLoadingTodos(true);
      const res = await api.get('/consultor/todos');
      setTodos(res.data);
      const resumo = await api.get('/consultor/todos/resumo');
      setTodoResumo(resumo.data);
    } catch (error) {
      console.error("Erro ao listar tarefas", error);
    } finally {
      setLoadingTodos(false);
    }
  }

  async function desativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/desativar`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao desativar empresa", error);
    }
  }

  async function ativarEmpresa(empresaId: number) {
    try {
      await api.post(`/consultor/super/empresas/${empresaId}/ativar`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao ativar empresa", error);
    }
  }

  async function deletarEmpresa(empresaId: number) {
    try {
      if (!window.confirm('Deseja realmente deletar esta empresa?')) return;
      await api.delete(`/consultor/super/empresas/${empresaId}`);
      carregarEmpresas();
    } catch (error) {
      console.error("Erro ao deletar empresa", error);
    }
  }

  async function desativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/desativar`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao desativar usuário", error);
    }
  }

  async function ativarUsuario(userId: number) {
    try {
      await api.post(`/consultor/super/usuarios/${userId}/ativar`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao ativar usuário", error);
    }
  }

  async function resetarSenhaUsuario(userId: number) {
    const novaSenha = window.prompt('Digite a nova senha:');
    if (!novaSenha) return;
    try {
      await api.post(`/consultor/super/usuarios/${userId}/reset-senha`, { new_password: novaSenha });
      alert('Senha redefinida com sucesso');
    } catch (error) {
      console.error("Erro ao redefinir senha", error);
      alert('Erro ao redefinir senha');
    }
  }

  async function deletarUsuario(userId: number) {
    try {
      if (!window.confirm('Deseja realmente deletar este usuário?')) return;
      await api.delete(`/consultor/super/usuarios/${userId}`);
      carregarUsuarios();
    } catch (error) {
      console.error("Erro ao deletar usuário", error);
    }
  }

  async function criarTodo(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload: any = {
        titulo: todoForm.titulo,
        descricao: todoForm.descricao || null,
        status: 'PENDENTE',
        prioridade: todoForm.prioridade,
        due_date: todoForm.due_date || null,
        end_date: todoForm.periodicidade === 'UNICA' ? null : (todoForm.end_date || null),
        periodicidade: todoForm.periodicidade,
        dias_semana: todoForm.dias_semana.length ? todoForm.dias_semana.join(',') : null,
        inclui_sabado: todoForm.inclui_sabado,
        tipo_alvo: todoForm.tipo_alvo,
        empresa_id: todoForm.tipo_alvo === 'EMPRESA' ? (todoForm.empresa_id || null) : null,
        consultor_id: todoForm.tipo_alvo === 'CONSULTOR' ? (todoForm.consultor_id || (currentUser?.id ?? null)) : null
      };
      await api.post('/consultor/todos', payload);
      setTodoForm({
        titulo: '',
        descricao: '',
        status: 'PENDENTE',
        prioridade: 'MEDIA',
        due_date: '',
        end_date: '',
        periodicidade: 'UNICA',
        dias_semana: [],
        inclui_sabado: false,
        tipo_alvo: 'EMPRESA',
        empresa_id: 0,
        consultor_id: 0
      });
      carregarTodos();
    } catch (error) {
      console.error("Erro ao criar tarefa", error);
    }
  }

  async function iniciarTodo(todoId: number) {
    try {
      await api.post(`/consultor/todos/${todoId}/iniciar`);
      carregarTodos();
    } catch (error) {
      console.error("Erro ao iniciar tarefa", error);
    }
  }

  async function finalizarTodo(todoId: number) {
    try {
      await api.post(`/consultor/todos/${todoId}/finalizar`);
      carregarTodos();
    } catch (error) {
      console.error("Erro ao finalizar tarefa", error);
    }
  }

  async function deletarTodo(todoId: number) {
    try {
      await api.delete(`/consultor/todos/${todoId}`);
      carregarTodos();
    } catch (error) {
      console.error("Erro ao deletar tarefa", error);
    }
  }

  function formatDuration(totalSeconds?: number) {
    const secs = Math.max(0, totalSeconds || 0);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m}m ${s}s`;
  }

  function parseDateOnly(value?: string | null) {
    if (!value) return null;
    const datePart = value.slice(0, 10);
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function isOverdue(todo: TodoItem) {
    const due = parseDateOnly(todo.due_date);
    if (!due) return false;
    const today = new Date();
    due.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return todo.status !== 'CONCLUIDO' && due < today;
  }

  function isCompletedLate(todo: TodoItem) {
    const due = parseDateOnly(todo.due_date);
    const finished = parseDateOnly(todo.finished_at);
    if (!due || !finished) return false;
    due.setHours(0, 0, 0, 0);
    finished.setHours(0, 0, 0, 0);
    return todo.status === 'CONCLUIDO' && finished > due;
  }

  // --- ABRIR MODAL (CRIAR OU EDITAR) ---
  function handleOpenEdit(emp: Empresa) {
    setIsEditing(true);
    setEditingId(emp.id);
    setFormEmpresa({
      nome_fantasia: emp.nome_fantasia,
      razao_social: emp.razao_social || '',
      cnpj: emp.cnpj || '',
      tipo_pessoa: (emp as any).tipo_pessoa || 'PJ',
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
    setFormEmpresa({ nome_fantasia: '', razao_social: '', cnpj: '', tipo_pessoa: 'PJ', cor_primaria: '#2563eb', logo_url: '' });
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
        carregarUsuarios();
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

  const canCreateTodo = (() => {
    if (!todoForm.titulo.trim()) return false;
    if (!todoForm.due_date) return false;
    if (todoForm.periodicidade !== 'UNICA' && !todoForm.end_date) return false;
    if (todoForm.periodicidade === 'SEMANAL' && todoForm.dias_semana.length === 0) return false;
    if (todoForm.tipo_alvo === 'EMPRESA' && !todoForm.empresa_id) return false;
    if (todoForm.tipo_alvo === 'CONSULTOR' && !(todoForm.consultor_id || currentUser?.id)) return false;
    return true;
  })();

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

      {/* TABS */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 rounded-t-xl">
        <button 
          onClick={() => setActiveTab('empresas')}
          className={`px-4 py-2 font-bold transition ${activeTab === 'empresas' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
        >
          <Building2 size={18} className="inline mr-2" /> Minhas Empresas
        </button>
        {isSuperConsultor && (
          <button 
            onClick={() => setActiveTab('consultores')}
            className={`px-4 py-2 font-bold transition ${activeTab === 'consultores' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <Users size={18} className="inline mr-2" /> Gerenciar Consultores
          </button>
        )}
        {isSuperConsultor && (
          <button 
            onClick={() => setActiveTab('usuarios')}
            className={`px-4 py-2 font-bold transition ${activeTab === 'usuarios' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
          >
            <Users size={18} className="inline mr-2" /> Usuários
          </button>
        )}
        <button 
          onClick={() => setActiveTab('tarefas')}
          className={`px-4 py-2 font-bold transition ${activeTab === 'tarefas' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
        >
          <ClipboardList size={18} className="inline mr-2" /> To-do
        </button>
      </div>

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
          const isActive = emp.is_active !== false;
          return (
            <div key={emp.id} className="relative rounded-xl p-5 shadow-sm hover:shadow-xl transition-all duration-300 group border flex flex-col justify-between"
              style={{ background: `linear-gradient(145deg, ${cor}08 0%, ${cor}15 100%)`, borderColor: `${cor}30` }}>
              
              {/* Botão de Editar */}
              <button onClick={() => handleOpenEdit(emp)} className="absolute top-3 right-3 p-2 rounded-full hover:bg-white/50 dark:hover:bg-black/20 text-slate-400 hover:text-blue-600 transition" title="Editar">
                <Pencil size={16} />
              </button>

              <span className={`absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {isActive ? 'ATIVA' : 'INATIVA'}
              </span>

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

              <div className="flex gap-2 mt-auto">
                <button 
                  onClick={() => solicitarTroca(emp)}
                  disabled={!isActive}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ backgroundColor: cor, color: '#fff' }}
                >
                  <ArrowRightLeft size={16} /> Acessar
                </button>
                {isSuperConsultor && (
                  <button
                    onClick={() => (isActive ? desativarEmpresa(emp.id) : ativarEmpresa(emp.id))}
                    className={`px-3 py-2.5 rounded-lg text-xs font-bold border transition ${
                      isActive ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {isActive ? 'Desativar' : 'Ativar'}
                  </button>
                )}
              </div>

              {isSuperConsultor && (
                <button
                  onClick={() => deletarEmpresa(emp.id)}
                  className="mt-2 w-full py-2 text-xs font-bold rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-1"
                >
                  <Trash2 size={14} /> Deletar
                </button>
              )}
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

      {/* ABA USUÁRIOS (SUPER-CONSULTOR ONLY) */}
      {activeTab === 'usuarios' && isSuperConsultor && (
        <div className="space-y-4">
          {loadingUsuarios ? (
            <div className="p-6 text-center text-slate-500">Carregando usuários...</div>
          ) : usuarios.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-700/30 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
              <Users size={32} className="mx-auto mb-2 text-slate-400" />
              <p className="text-slate-500 dark:text-slate-400">Nenhum usuário encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {usuarios.map(user => {
                const isSelf = currentUser?.id === user.id;
                return (
                  <div key={user.id} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white">{user.nome || user.email}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                        <p className="text-xs text-slate-400">Empresa: {user.empresa_nome || '—'}</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${user.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {user.is_active ? 'ATIVO' : 'INATIVO'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => user.is_active ? desativarUsuario(user.id) : ativarUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${user.is_active ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'} ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {user.is_active ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => resetarSenhaUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition flex items-center gap-1 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <KeyRound size={14} /> Redefinir Senha
                      </button>
                      <button
                        onClick={() => deletarUsuario(user.id)}
                        disabled={isSelf}
                        className={`px-3 py-2 rounded-lg text-xs font-bold border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center gap-1 ${isSelf ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        <Trash2 size={14} /> Deletar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA TAREFAS */}
      {activeTab === 'tarefas' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Amanhã</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.amanha}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Na semana</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.semana}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Futuras</p>
              <p className="text-xl font-bold text-slate-800 dark:text-white">{todoResumo.futuras}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Atrasadas</p>
              <p className="text-xl font-bold text-red-600">{todoResumo.atrasadas}</p>
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-center">
              <p className="text-[11px] text-slate-500">Concl. em atraso</p>
              <p className="text-xl font-bold text-amber-600">{todoResumo.concluidas_atraso}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setShowTodoForm(prev => !prev)}
              className="px-4 py-2 rounded-lg font-bold text-sm bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
            >
              <Plus size={16} /> {showTodoForm ? 'Ocultar formulário' : 'Nova Tarefa'}
            </button>
          </div>

          {showTodoForm && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
              <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                <ClipboardList size={18} /> Nova Tarefa
              </h3>
              <form onSubmit={criarTodo} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Título</label>
                  <input
                    required
                    type="text"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.titulo}
                    onChange={e => setTodoForm({ ...todoForm, titulo: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Descrição</label>
                  <textarea
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.descricao}
                    onChange={e => setTodoForm({ ...todoForm, descricao: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tipo de Alvo</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.tipo_alvo}
                    onChange={e => setTodoForm({ ...todoForm, tipo_alvo: e.target.value as TodoForm['tipo_alvo'] })}
                  >
                    <option value="EMPRESA">Empresa</option>
                    <option value="CONSULTOR">Consultor</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prioridade</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.prioridade}
                    onChange={e => setTodoForm({ ...todoForm, prioridade: e.target.value as TodoForm['prioridade'] })}
                  >
                    <option value="BAIXA">Baixa</option>
                    <option value="MEDIA">Média</option>
                    <option value="ALTA">Alta</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Periodicidade</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={todoForm.periodicidade}
                    onChange={e => setTodoForm({ ...todoForm, periodicidade: e.target.value as TodoForm['periodicidade'] })}
                  >
                    <option value="UNICA">Única</option>
                    <option value="DIARIA">Todo dia</option>
                    <option value="SEMANAL">Semanal</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={todoForm.inclui_sabado}
                    onChange={e => setTodoForm({ ...todoForm, inclui_sabado: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  />
                  <label className="text-sm text-slate-600 dark:text-slate-300">Inclui sábado?</label>
                </div>
                {todoForm.periodicidade === 'SEMANAL' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-2 block">Dias da semana</label>
                    <div className="flex flex-wrap gap-2">
                      {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map(dia => (
                        <label key={dia} className={`px-3 py-1 rounded-full text-xs font-bold border cursor-pointer ${todoForm.dias_semana.includes(dia) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={todoForm.dias_semana.includes(dia)}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...todoForm.dias_semana, dia]
                                : todoForm.dias_semana.filter(d => d !== dia);
                              setTodoForm({ ...todoForm, dias_semana: next });
                            }}
                          />
                          {dia}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {todoForm.tipo_alvo === 'EMPRESA' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Empresa</label>
                    <select
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      value={todoForm.empresa_id}
                      onChange={e => setTodoForm({ ...todoForm, empresa_id: Number(e.target.value) })}
                    >
                      <option value={0}>-- Selecione --</option>
                      {empresas.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nome_fantasia}</option>
                      ))}
                    </select>
                  </div>
                )}
                {todoForm.tipo_alvo === 'CONSULTOR' && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Consultor</label>
                    <select
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      value={todoForm.consultor_id || currentUser?.id || 0}
                      onChange={e => setTodoForm({ ...todoForm, consultor_id: Number(e.target.value) })}
                      disabled={!isSuperConsultor}
                    >
                      <option value={currentUser?.id || 0}>{currentUser?.email || 'Eu'}</option>
                      {isSuperConsultor && consultores.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Prazo</label>
                  <input
                    type="date"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                    value={todoForm.due_date}
                    onChange={e => setTodoForm({ ...todoForm, due_date: e.target.value })}
                  />
                </div>
                {todoForm.periodicidade !== 'UNICA' && (
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Data Fim</label>
                    <input
                      type="date"
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white"
                      value={todoForm.end_date}
                      onChange={e => setTodoForm({ ...todoForm, end_date: e.target.value })}
                    />
                  </div>
                )}
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={!canCreateTodo}
                    className={`w-full py-3 font-bold rounded-xl transition ${canCreateTodo ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-400 text-white cursor-not-allowed'}`}
                  >
                    Criar Tarefa
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Lista de Tarefas</h3>
            {loadingTodos ? (
              <div className="text-center text-slate-500">Carregando tarefas...</div>
            ) : todos.length === 0 ? (
              <div className="text-center text-slate-500">Nenhuma tarefa encontrada</div>
            ) : (
              <div className="space-y-6">
                {(["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO"] as const).map(status => (
                  <div key={status}>
                    <p className="text-xs font-bold uppercase text-slate-500 mb-2">
                      {status === 'PENDENTE' && 'Pendentes'}
                      {status === 'EM_ANDAMENTO' && 'Em andamento'}
                      {status === 'CONCLUIDO' && 'Concluídas'}
                    </p>
                    <div className="space-y-3">
                      {todos.filter(t => t.status === status).length === 0 ? (
                        <div className="text-xs text-slate-400">Nenhuma tarefa</div>
                      ) : (
                        todos.filter(t => t.status === status).map(todo => {
                          const empresaNome = empresas.find(e => e.id === todo.empresa_id)?.nome_fantasia;
                          const consultorNome = consultores.find(c => c.id === todo.consultor_id)?.nome || (todo.consultor_id === currentUser?.id ? 'Eu' : undefined);
                          const atrasada = isOverdue(todo);
                          const concluidaAtraso = isCompletedLate(todo);
                          return (
                            <div key={todo.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  {todo.status === 'CONCLUIDO' ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-slate-400" />}
                                  <p className="font-bold text-slate-800 dark:text-white">{todo.titulo}</p>
                                  {atrasada && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">ATRASADA</span>}
                                  {concluidaAtraso && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">CONCLUÍDA EM ATRASO</span>}
                                </div>
                                {todo.descricao && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{todo.descricao}</p>}
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {todo.tipo_alvo === 'EMPRESA'
                                    ? `Empresa: ${empresaNome || `ID ${todo.empresa_id}`}`
                                    : `Consultor: ${consultorNome || `ID ${todo.consultor_id}`}`}
                                  {todo.due_date ? ` • Prazo: ${todo.due_date.slice(0, 10)}` : ''}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                  {todo.periodicidade === 'DIARIA' && 'Periodicidade: todo dia'}
                                  {todo.periodicidade === 'SEMANAL' && `Periodicidade: semanal (${todo.dias_semana || '-'})`}
                                  {(!todo.periodicidade || todo.periodicidade === 'UNICA') && 'Periodicidade: única'}
                                  {todo.inclui_sabado ? ' • Inclui sábado' : ''}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                  Tempo: {formatDuration(todo.total_seconds)}
                                  {todo.last_started_at && todo.status !== 'CONCLUIDO' ? ' • Em andamento' : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {todo.status === 'PENDENTE' && (
                                  <button
                                    onClick={() => iniciarTodo(todo.id)}
                                    className="px-3 py-2 rounded-lg text-xs font-bold border border-blue-300 text-blue-600 hover:bg-blue-50 transition"
                                  >
                                    Iniciar
                                  </button>
                                )}
                                {todo.status === 'EM_ANDAMENTO' && (
                                  <button
                                    onClick={() => finalizarTodo(todo.id)}
                                    className="px-3 py-2 rounded-lg text-xs font-bold border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition"
                                  >
                                    Finalizar
                                  </button>
                                )}
                                <button
                                  onClick={() => deletarTodo(todo.id)}
                                  className="px-3 py-2 rounded-lg text-xs font-bold border border-red-300 text-red-600 hover:bg-red-50 transition flex items-center gap-1"
                                >
                                  <Trash2 size={14} /> Excluir
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tipo</label>
                  <select
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    value={formEmpresa.tipo_pessoa}
                    onChange={e => setFormEmpresa({ ...formEmpresa, tipo_pessoa: e.target.value as 'PF' | 'PJ' })}
                  >
                    <option value="PF">Pessoa Física</option>
                    <option value="PJ">Pessoa Jurídica</option>
                  </select>
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
                <select className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" value={newUser.empresa_id} onChange={e => setNewUser({...newUser, empresa_id: Number(e.target.value)})} disabled={newUser.is_consultor}>
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