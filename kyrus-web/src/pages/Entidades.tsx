import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Plus, Search, Edit2, Trash2, X, Check, Users, Truck, Briefcase, Loader2, AlertCircle
} from 'lucide-react';

// --- INTERFACES ---
interface Entidade {
  id: number;
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  cpf_cnpj?: string | null;
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

export function Entidades() {
  // --- ESTADOS GERAIS ---
  const [loading, setLoading] = useState(true);
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Dados de Contexto (Empresa/Usuário)
  const [empresaId, setEmpresaId] = useState<number>(0);
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  
  // Modal & Form
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Estado inicial do formulário
  const initialFormState = {
    id: null as number | null,
    nome: '',
    tipo: 'CLIENTE' as const,
    cpf_cnpj: '',
    status: 'ATIVO' as const
  };

  const [form, setForm] = useState(initialFormState);

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
      await carregarLista();
      
    } catch (e) { 
      console.error("Falha na inicialização:", e);
    } finally { 
      setLoading(false); 
    }
  }

  async function carregarLista() {
    try {
      const res = await api.get('/entidades/');
      setEntidades(res.data);
    } catch (error) {
      console.error("Erro ao carregar lista:", error);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setForm(initialFormState);
    setIsEditing(false);
    setShowModal(true);
  }

  function handleOpenEdit(e: Entidade) {
    setForm({
      id: e.id,
      nome: e.nome,
      tipo: e.tipo,
      // Garante string vazia para o input controlar corretamente (null quebra input value)
      cpf_cnpj: e.cpf_cnpj || '', 
      status: e.status
    });
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
        nome: form.nome,
        tipo: form.tipo,
        status: form.status,
        cpf_cnpj: form.cpf_cnpj?.trim() ? form.cpf_cnpj.trim() : null,
        empresa_id: empresaId // <--- AQUI ESTAVA FALTANDO PARA O SCHEMA BASE
      };

      if (isEditing && form.id) {
        await api.put(`/entidades/${form.id}`, payload);
      } else {
        await api.post('/entidades/', payload);
      }

      setShowModal(false);
      await carregarLista(); // Refresh silencioso
      
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
      // Atualização otimista (remove da tela instantaneamente)
      setEntidades(prev => prev.filter(e => e.id !== id)); 
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || "Erro ao excluir. Verifique se há vínculos.";
      alert(errorMsg);
    }
  }

  // --- UI HELPERS ---
  const filteredData = entidades.filter(e => 
    e.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (e.cpf_cnpj && e.cpf_cnpj.includes(searchTerm))
  );

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
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-10 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white flex items-center gap-2">
            Entidades <span className="text-sm font-normal text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{entidades.length}</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestão de Clientes e Fornecedores</p>
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
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
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Entidade</th>
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
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <Search className="w-10 h-10 mb-3 opacity-20" />
                      <p>Nenhum registro encontrado.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                    <td className="p-4">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 block">{e.nome}</span>
                    </td>
                    <td className="p-4">{getBadge(e.tipo)}</td>
                    <td className="p-4 font-mono text-slate-500 dark:text-slate-400 tracking-tight">{e.cpf_cnpj || '---'}</td>
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
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200" onClick={() => setShowModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-700">
            
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800">
              <div>
                <h3 className="font-bold text-xl text-slate-800 dark:text-white flex items-center gap-2">
                  {isEditing ? <Edit2 className="w-5 h-5 text-blue-500"/> : <Plus className="w-5 h-5 text-emerald-500"/>}
                  {isEditing ? 'Editar Entidade' : 'Novo Cadastro'}
                </h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-red-500 transition"><X className="w-5 h-5"/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5">
              
              {/* Campo Nome */}
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Nome Completo / Razão Social <span className="text-red-500">*</span></label>
                <input 
                  autoFocus
                  type="text" 
                  required
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all placeholder:text-slate-400"
                  // Cor de foco dinâmica
                  style={{ caretColor: primaryColor }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = primaryColor;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${primaryColor}20`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                  value={form.nome}
                  onChange={e => setForm({...form, nome: e.target.value})}
                  placeholder="Ex: Kyrus Tecnologia Ltda"
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                {/* Campo Tipo */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Tipo de Relacionamento</label>
                  <select 
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all cursor-pointer appearance-none"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primaryColor; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
                    value={form.tipo}
                    onChange={e => setForm({...form, tipo: e.target.value as any})}
                  >
                    <option value="CLIENTE">Cliente</option>
                    <option value="FORNECEDOR">Fornecedor</option>
                    <option value="AMBOS">Ambos</option>
                  </select>
                </div>

                {/* Campo Status */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">Status Atual</label>
                  <select 
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all cursor-pointer"
                    onFocus={(e) => { e.currentTarget.style.borderColor = primaryColor; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ''; }}
                    value={form.status}
                    onChange={e => setForm({...form, status: e.target.value as any})}
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="INATIVO">Inativo</option>
                  </select>
                </div>
              </div>

              {/* Campo CPF/CNPJ */}
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 tracking-wide">CPF / CNPJ (Opcional)</label>
                <input 
                  type="text" 
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none transition-all font-mono text-sm placeholder:text-slate-400"
                  style={{ caretColor: primaryColor }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = primaryColor;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${primaryColor}20`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '';
                    e.currentTarget.style.boxShadow = '';
                  }}
                  value={form.cpf_cnpj}
                  onChange={e => setForm({...form, cpf_cnpj: e.target.value})}
                  placeholder="000.000.000-00"
                />
                <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3"/> Deixe em branco se não souber.
                </p>
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