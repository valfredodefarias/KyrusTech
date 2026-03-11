import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { 
  Plus, Search, Edit2, Trash2, X, Check, Users, Truck, Briefcase, Loader2, AlertCircle
} from 'lucide-react';

// --- INTERFACES ---
interface Entidade {
  id: number;
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  tipo_pessoa: 'PF' | 'PJ';
  nome_fantasia?: string | null;
  cpf_cnpj?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  contato_nome?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  observacoes?: string | null;
  status: 'ATIVO' | 'INATIVO';
}

interface UserInfo {
  id: number;
  email: string;
  empresa_id: number;
}

interface EmpresaInfo {
  cor_primaria: string;
}

interface EntidadeFormState {
  id: number | null;
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  tipo_pessoa: 'PF' | 'PJ';
  nome_fantasia: string;
  cpf_cnpj: string;
  email: string;
  telefone: string;
  celular: string;
  contato_nome: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  observacoes: string;
  status: 'ATIVO' | 'INATIVO';
}

interface EntidadePageResponse {
  items: Entidade[];
  total: number;
  skip: number;
  limit: number;
}

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const formatCpfCnpj = (value: string) => {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

const formatPhone = (value: string) => {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
};

const formatCep = (value: string) => onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

const fetchCepAddress = async (cep: string) => {
  const digits = String(cep || '').replace(/\D/g, '');
  if (digits.length !== 8) {
    throw new Error('CEP inválido');
  }

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) {
    throw new Error('Falha ao consultar CEP');
  }

  const data = await response.json();
  if (data?.erro) {
    throw new Error('CEP não encontrado');
  }

  return {
    cep: digits,
    logradouro: String(data.logradouro || '').trim(),
    bairro: String(data.bairro || '').trim(),
    cidade: String(data.localidade || '').trim(),
    uf: String(data.uf || '').trim().toUpperCase().slice(0, 2),
  };
};

const nullableValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export function Entidades() {
  // --- ESTADOS GERAIS ---
  const [loading, setLoading] = useState(true);
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  
  // Dados de Contexto (Empresa/Usuário)
  const [empresaId, setEmpresaId] = useState<number>(0);
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  
  // Modal & Form
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepFeedback, setCepFeedback] = useState<string | null>(null);
  const lastCepLookupRef = useRef('');
  
  // Estado inicial do formulário
  const initialFormState: EntidadeFormState = {
    id: null,
    nome: '',
    tipo: 'CLIENTE',
    tipo_pessoa: 'PJ',
    nome_fantasia: '',
    cpf_cnpj: '',
    email: '',
    telefone: '',
    celular: '',
    contato_nome: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    observacoes: '',
    status: 'ATIVO'
  };

  const [form, setForm] = useState<EntidadeFormState>(initialFormState);

  const invalidateEntidades = useLookupStore((state) => state.invalidateEntidades);
  const invalidateEntidadesLookup = useLookupStore((state) => state.invalidateEntidadesLookup);

  // --- INICIALIZAÇÃO ---
  useEffect(() => {
    carregarContexto();
  }, []);

  // Carrega tudo que é necessário ao iniciar
  async function carregarContexto() {
    setLoading(true);
    try {
      // 1. Identificar Usuário e Empresa
      const { data: user } = await api.get<UserInfo>('/usuarios/me');
      setEmpresaId(user.empresa_id);

      if (user.empresa_id) {
        // 2. Aplicar Tema da Empresa
        const { data: emp } = await api.get<EmpresaInfo>(`/empresas/${user.empresa_id}`);
        if (emp.cor_primaria) {
          setPrimaryColor(emp.cor_primaria);
          // Injeta variável CSS para uso no Tailwind (ex: focus rings)
          document.documentElement.style.setProperty('--tw-ring-color', emp.cor_primaria);
        }
      }
      
      // 3. Carregar Lista de Entidades
      await carregarLista(0, pageSize, searchTerm);
      
    } catch (e) { 
      console.error("Falha na inicialização:", e);
    } finally { 
      setLoading(false); 
    }
  }

  async function carregarLista(nextPage = page, nextPageSize = pageSize, nextSearch = searchTerm) {
    try {
      const skip = nextPage * nextPageSize;
      const { data } = await api.get<EntidadePageResponse>('/entidades/paged', {
        params: {
          skip,
          limit: nextPageSize,
          q: nextSearch.trim() || undefined,
        },
      });
      setEntidades(data.items || []);
      setTotal(data.total || 0);
      setPage(Math.max(0, Math.floor((data.skip || 0) / (data.limit || nextPageSize || 1))));
    } catch (error) {
      console.error("Erro ao carregar lista:", error);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void carregarLista(page, pageSize, searchTerm);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [page, pageSize, searchTerm]);

  // --- ACTIONS ---
  function handleOpenCreate() {
    setForm(initialFormState);
    setCepFeedback(null);
    lastCepLookupRef.current = '';
    setIsEditing(false);
    setShowModal(true);
  }

  function handleOpenEdit(e: Entidade) {
    setForm({
      id: e.id,
      nome: e.nome,
      tipo: e.tipo,
      tipo_pessoa: e.tipo_pessoa || 'PJ',
      nome_fantasia: e.nome_fantasia || '',
      // Garante string vazia para o input controlar corretamente (null quebra input value)
      cpf_cnpj: e.cpf_cnpj || '', 
      email: e.email || '',
      telefone: e.telefone || '',
      celular: e.celular || '',
      contato_nome: e.contato_nome || '',
      cep: e.cep || '',
      logradouro: e.logradouro || '',
      numero: e.numero || '',
      complemento: e.complemento || '',
      bairro: e.bairro || '',
      cidade: e.cidade || '',
      uf: e.uf || '',
      observacoes: e.observacoes || '',
      status: e.status
    });
    setCepFeedback(null);
    lastCepLookupRef.current = onlyDigits(e.cep || '');
    setIsEditing(true);
    setShowModal(true);
  }

  // --- SAVE CORE (CRÍTICO) ---
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return alert("O nome é obrigatório.");
    
    setSaving(true);
    try {
      // SÊNIOR: Construção do Payload Seguro
      // 1. Removemos string vazia do CPF (envia null)
      // 2. Injetamos empresa_id (Obrigatório pelo Schema do Backend)
      const payload = {
        nome: form.nome.trim(),
        tipo: form.tipo,
        tipo_pessoa: form.tipo_pessoa,
        nome_fantasia: nullableValue(form.nome_fantasia),
        status: form.status,
        cpf_cnpj: nullableValue(onlyDigits(form.cpf_cnpj)),
        email: nullableValue(form.email),
        telefone: nullableValue(onlyDigits(form.telefone)),
        celular: nullableValue(onlyDigits(form.celular)),
        contato_nome: nullableValue(form.contato_nome),
        cep: nullableValue(onlyDigits(form.cep)),
        logradouro: nullableValue(form.logradouro),
        numero: nullableValue(form.numero),
        complemento: nullableValue(form.complemento),
        bairro: nullableValue(form.bairro),
        cidade: nullableValue(form.cidade),
        uf: nullableValue(form.uf.toUpperCase().slice(0, 2)),
        observacoes: nullableValue(form.observacoes),
        empresa_id: empresaId // <--- AQUI ESTAVA FALTANDO PARA O SCHEMA BASE
      };

      if (isEditing && form.id) {
        await api.put(`/entidades/${form.id}`, payload);
      } else {
        await api.post('/entidades/', payload);
      }

      setShowModal(false);
      invalidateEntidades();
      invalidateEntidadesLookup();
      await carregarLista(page, pageSize, searchTerm);
      
    } catch (error: any) {
      console.error(error);
      // Tratamento de erro detalhado do FastAPI/Pydantic
      let errorMsg = "Ocorreu um erro ao salvar.";
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (Array.isArray(detail)) {
            // Erro de validação de campos (422)
            errorMsg = detail.map((d: any) => `${d.loc[1]}: ${d.msg}`).join('\n');
        } else {
            // Erro genérico
            errorMsg = detail;
        }
      }
      alert(`Falha na operação:\n${errorMsg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Deseja realmente excluir este registro?")) return;
    try {
      await api.delete(`/entidades/${id}`);
      invalidateEntidades();
      invalidateEntidadesLookup();
      const nextTotal = Math.max(0, total - 1);
      const totalPagesAfterDelete = Math.max(1, Math.ceil(nextTotal / pageSize));
      const nextPage = Math.min(page, totalPagesAfterDelete - 1);
      await carregarLista(nextPage, pageSize, searchTerm);
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || "Erro ao excluir. Verifique se há vínculos.";
      alert(errorMsg);
    }
  }

  // --- UI HELPERS ---
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(total, page * pageSize + entidades.length);

  const documentoLabel = form.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ';
  const nomePrincipalLabel = form.tipo_pessoa === 'PF' ? 'Nome Completo' : 'Razão Social';

  function handleDocumentoChange(value: string) {
    const formatted = formatCpfCnpj(value);
    const digits = onlyDigits(formatted);
    setForm((prev) => ({
      ...prev,
      cpf_cnpj: formatted,
      tipo_pessoa: digits.length > 11 ? 'PJ' : prev.tipo_pessoa === 'PJ' && digits.length > 0 && digits.length <= 11 ? 'PF' : prev.tipo_pessoa,
    }));
  }

  async function handleCepChange(value: string) {
    const formatted = formatCep(value);
    const digits = onlyDigits(formatted);
    setForm((prev) => ({ ...prev, cep: formatted }));

    if (digits.length < 8) {
      lastCepLookupRef.current = '';
      setCepFeedback(null);
      return;
    }

    if (digits === lastCepLookupRef.current) {
      return;
    }

    setCepLoading(true);
    setCepFeedback(null);
    try {
      const address = await fetchCepAddress(digits);
      lastCepLookupRef.current = digits;
      setForm((prev) => ({
        ...prev,
        cep: formatCep(address.cep),
        logradouro: address.logradouro,
        bairro: address.bairro,
        cidade: address.cidade,
        uf: address.uf,
      }));
      setCepFeedback('Endereço preenchido automaticamente pelo CEP.');
    } catch (error: any) {
      lastCepLookupRef.current = '';
      setCepFeedback(error?.message || 'Não foi possível consultar o CEP.');
    } finally {
      setCepLoading(false);
    }
  }

  const getBadge = (tipo: string) => {
    const badges = {
      'CLIENTE': { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200', icon: Users },
      'FORNECEDOR': { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', icon: Truck },
      'AMBOS': { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200', icon: Briefcase }
    };
    const style = badges[tipo as keyof typeof badges] || badges['AMBOS'];
    const Icon = style.icon;

    return (
      <span className={`px-2.5 py-1 rounded text-[10px] font-bold border flex items-center gap-1.5 w-fit uppercase tracking-wide ${style.bg} ${style.text} ${style.border}`}>
        <Icon className="w-3 h-3"/> {tipo}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-8 py-5 flex flex-col lg:flex-row lg:items-center justify-between shadow-sm z-10 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white flex items-center gap-2">
            Interessados <span className="text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{total}</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestão de clientes, fornecedores e demais interessados</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
          <div className="relative flex-1 sm:flex-none group">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar..." 
              className="w-full sm:w-64 pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 focus:outline-none focus:ring-2 transition-all text-sm text-slate-700 dark:text-slate-200 shadow-sm"
              // Aplica a cor primária no anel de foco via style inline para garantir prioridade
              style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={handleOpenCreate}
            className="text-white px-5 py-2 rounded-xl shadow-lg flex items-center gap-2 font-bold transition-all active:scale-95 text-sm whitespace-nowrap hover:brightness-110"
            style={{ backgroundColor: primaryColor }}
          >
            <Plus className="w-4 h-4" /> Novo Cadastro
          </button>
        </div>
      </header>

      {/* LISTA */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Interessado</th>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Classificação</th>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Documento</th>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Status</th>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto mb-2" />
                    <span className="text-slate-500">Carregando registros...</span>
                  </td>
                </tr>
              ) : entidades.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <Search className="w-10 h-10 mb-3 opacity-20" />
                      <p>Nenhum registro encontrado.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                entidades.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                    <td className="p-4">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 block">{e.nome}</span>
                      <span className="text-xs text-slate-400 block mt-1">{e.nome_fantasia || e.contato_nome || (e.email || 'Sem contato principal')}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-2">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-bold border w-fit uppercase tracking-wide ${e.tipo_pessoa === 'PF' ? 'bg-violet-100 text-violet-700 border-violet-200' : 'bg-sky-100 text-sky-700 border-sky-200'}`}>
                          {e.tipo_pessoa === 'PF' ? 'Pessoa Fisica' : 'Pessoa Juridica'}
                        </span>
                        {getBadge(e.tipo)}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-slate-500 dark:text-slate-400 tracking-tight">
                      {formatCpfCnpj(e.cpf_cnpj || '') || '---'}
                    </td>
                    <td className="p-4">
                      <div className={`flex items-center gap-1.5 text-xs font-bold ${e.status === 'ATIVO' ? 'text-emerald-600' : 'text-slate-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${e.status === 'ATIVO' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></div>
                        {e.status}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleOpenEdit(e)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition" title="Editar">
                          <Edit2 className="w-4 h-4"/>
                        </button>
                        <button onClick={() => handleDelete(e.id)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition" title="Excluir">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-slate-500 dark:text-slate-400">
              {total === 0 ? 'Nenhum registro' : `Mostrando ${pageStart}-${pageEnd} de ${total}`}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <span>Por página</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value) || 50;
                    setPage(0);
                    setPageSize(next);
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(0, prev - 1))}
                  disabled={page === 0 || loading}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Anterior
                </button>
                <span className="min-w-20 text-center text-slate-500 dark:text-slate-400">{page + 1} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
                  disabled={page + 1 >= totalPages || loading}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Próxima
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200" onClick={() => setShowModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-700 max-h-[92vh] flex flex-col">
            
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800">
              <div>
                <h3 className="font-bold text-xl text-slate-800 dark:text-white flex items-center gap-2">
                  {isEditing ? <Edit2 className="w-5 h-5 text-blue-500"/> : <Plus className="w-5 h-5 text-emerald-500"/>}
                  {isEditing ? 'Editar Interessado' : 'Novo Interessado'}
                </h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-red-500 transition"><X className="w-5 h-5"/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid gap-4 lg:grid-cols-4">
                <button type="button" onClick={() => setForm({ ...form, tipo_pessoa: 'PF' })} className={`rounded-2xl border px-4 py-4 text-left transition ${form.tipo_pessoa === 'PF' ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                  <div className="text-xs font-black uppercase tracking-[0.22em]">PF</div>
                  <div className="mt-2 text-sm font-semibold">Pessoa Física</div>
                  <div className="mt-1 text-xs opacity-70">Cadastro por CPF, nome e contato direto.</div>
                </button>
                <button type="button" onClick={() => setForm({ ...form, tipo_pessoa: 'PJ' })} className={`rounded-2xl border px-4 py-4 text-left transition ${form.tipo_pessoa === 'PJ' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                  <div className="text-xs font-black uppercase tracking-[0.22em]">PJ</div>
                  <div className="mt-2 text-sm font-semibold">Pessoa Jurídica</div>
                  <div className="mt-1 text-xs opacity-70">Cadastro por CNPJ, razão social e contato responsável.</div>
                </button>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900 lg:col-span-2">
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Relacionamento</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white" value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value as any})}>
                      <option value="CLIENTE">Cliente</option>
                      <option value="FORNECEDOR">Fornecedor</option>
                      <option value="AMBOS">Cliente e fornecedor</option>
                    </select>
                    <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white" value={form.status} onChange={e => setForm({...form, status: e.target.value as any})}>
                      <option value="ATIVO">Ativo</option>
                      <option value="INATIVO">Inativo</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">{nomePrincipalLabel} <span className="text-red-500">*</span></label>
                    <input autoFocus type="text" required className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all placeholder:text-slate-400" style={{ caretColor: primaryColor }} value={form.nome} onChange={e => setForm({...form, nome: e.target.value})} placeholder={form.tipo_pessoa === 'PF' ? 'Ex: Maria Aparecida Souza' : 'Ex: Kyrus Tecnologia Ltda'} />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">{documentoLabel}</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all font-mono text-sm placeholder:text-slate-400" value={form.cpf_cnpj} onChange={e => handleDocumentoChange(e.target.value)} placeholder={form.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} />
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> O tipo PF/PJ ajusta automaticamente quando o documento estiver completo.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Nome Fantasia / Apelido</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.nome_fantasia} onChange={e => setForm({...form, nome_fantasia: e.target.value})} placeholder={form.tipo_pessoa === 'PF' ? 'Como você identifica essa pessoa' : 'Nome comercial'} />
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Contato responsável</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.contato_nome} onChange={e => setForm({...form, contato_nome: e.target.value})} placeholder="Ex: Financeiro / João Silva" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">E-mail</label>
                      <input type="email" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="contato@empresa.com.br" />
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Telefone</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.telefone} onChange={e => setForm({...form, telefone: formatPhone(e.target.value)})} placeholder="(11) 3333-4444" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Celular / WhatsApp</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.celular} onChange={e => setForm({...form, celular: formatPhone(e.target.value)})} placeholder="(11) 98888-7777" />
                    </div>
                  </div>
                </div>

                <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                  <div className="grid gap-5 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">CEP</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.cep} onChange={e => void handleCepChange(e.target.value)} placeholder="00000-000" />
                      <p className="mt-1 text-[10px] text-slate-400">{cepLoading ? 'Consultando CEP...' : cepFeedback || 'Digite o CEP para preencher logradouro, bairro, cidade e UF.'}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Logradouro</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.logradouro} onChange={e => setForm({...form, logradouro: e.target.value})} placeholder="Rua, avenida, praça" />
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Número</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.numero} onChange={e => setForm({...form, numero: e.target.value})} placeholder="123" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Complemento</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.complemento} onChange={e => setForm({...form, complemento: e.target.value})} placeholder="Sala, bloco, referência" />
                    </div>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Bairro</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.bairro} onChange={e => setForm({...form, bairro: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Cidade</label>
                      <input type="text" className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all" value={form.cidade} onChange={e => setForm({...form, cidade: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">UF</label>
                      <input type="text" maxLength={2} className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 uppercase dark:text-white outline-none transition-all" value={form.uf} onChange={e => setForm({...form, uf: e.target.value.toUpperCase()})} placeholder="SP" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Observações</label>
                    <textarea className="min-h-32 w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white" value={form.observacoes} onChange={e => setForm({...form, observacoes: e.target.value})} placeholder="Condições comerciais, restrições, detalhes operacionais." />
                  </div>
                </div>
              </div>

              <div className="pt-6 flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700 mt-2">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)} 
                  className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-xl text-sm transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-8 py-2.5 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all transform active:scale-95 text-sm flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{ backgroundColor: primaryColor }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                  {saving ? 'Salvando...' : 'Salvar Registro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}