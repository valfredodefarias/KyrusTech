import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Plus, Search, Edit2, Trash2, X, Check, Users, Truck, Briefcase
} from 'lucide-react';

// --- INTERFACES ---
interface Entidade {
  id: number;
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  cpf_cnpj?: string;
  status: 'ATIVO' | 'INATIVO';
}

interface UserInfo {
  empresa_id: number;
}

interface EmpresaInfo {
  cor_primaria: string;
}

export function Entidades() {
  // --- ESTADOS ---
  const [loading, setLoading] = useState(true);
  const [entidades, setEntidades] = useState<Entidade[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [form, setForm] = useState({
    id: null as number | null,
    nome: '',
    tipo: 'CLIENTE',
    cpf_cnpj: '',
    status: 'ATIVO'
  });

  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  // --- INIT ---
  useEffect(() => {
    carregarTema();
    carregarDados();
  }, []);

  async function carregarTema() {
    try {
      const { data: user } = await api.get<UserInfo>('/usuarios/me');
      if (user.empresa_id) {
        const { data: emp } = await api.get<EmpresaInfo>(`/empresas/${user.empresa_id}`);
        if (emp.cor_primaria) {
          setPrimaryColor(emp.cor_primaria);
          document.documentElement.style.setProperty('--color-primary', emp.cor_primaria);
        }
      }
    } catch (e) { console.error("Erro tema", e); }
  }

  async function carregarDados() {
    setLoading(true);
    try {
      const res = await api.get('/entidades/');
      setEntidades(res.data);
    } catch (error) {
      console.error("Erro ao carregar entidades", error);
    } finally {
      setLoading(false);
    }
  }

  // --- FILTRO ---
  const filteredData = entidades.filter(e => 
    e.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    e.cpf_cnpj?.includes(searchTerm)
  );

  // --- ACTIONS ---
  function handleOpenCreate() {
    setForm({ id: null, nome: '', tipo: 'CLIENTE', cpf_cnpj: '', status: 'ATIVO' });
    setIsEditing(false);
    setShowModal(true);
  }

  function handleOpenEdit(e: Entidade) {
    setForm({
      id: e.id,
      nome: e.nome,
      tipo: e.tipo,
      cpf_cnpj: e.cpf_cnpj || '',
      status: e.status
    });
    setIsEditing(true);
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome) return alert("O nome é obrigatório.");
    
    setSaving(true);
    try {
      if (isEditing && form.id) {
        await api.put(`/entidades/${form.id}`, form);
      } else {
        await api.post('/entidades/', form);
      }
      setShowModal(false);
      carregarDados();
    } catch (error) {
      console.error(error);
      alert("Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Tem certeza que deseja excluir esta entidade?")) return;
    try {
      await api.delete(`/entidades/${id}`);
      carregarDados();
    } catch (error) {
      alert("Erro ao excluir. Verifique se há lançamentos vinculados.");
    }
  }

  // --- UI HELPERS ---
  const getBadge = (tipo: string) => {
    switch (tipo) {
      case 'CLIENTE': return <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold border border-emerald-200 flex items-center gap-1 w-fit"><Users className="w-3 h-3"/> CLIENTE</span>;
      case 'FORNECEDOR': return <span className="px-2 py-1 rounded bg-orange-100 text-orange-700 text-[10px] font-bold border border-orange-200 flex items-center gap-1 w-fit"><Truck className="w-3 h-3"/> FORNECEDOR</span>;
      default: return <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200 flex items-center gap-1 w-fit"><Briefcase className="w-3 h-3"/> AMBOS</span>;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-10 gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Entidades</h2>
          <p className="text-sm text-slate-400">Clientes, Fornecedores e Parceiros</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou documento..." 
              className="w-full sm:w-64 pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 focus:ring-2 outline-none transition text-sm text-slate-700 dark:text-slate-200"
              style={{ '--tw-ring-color': primaryColor } as any}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={handleOpenCreate}
            className="text-white px-5 py-2 rounded-lg shadow-md flex items-center gap-2 font-bold transition active:scale-95 text-sm whitespace-nowrap hover:brightness-90"
            style={{ backgroundColor: primaryColor }}
          >
            <Plus className="w-4 h-4" /> Nova
          </button>
        </div>
      </header>

      {/* LISTA */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase">Nome / Razão Social</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase">Tipo</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase">Documento</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="p-4 text-xs font-bold text-slate-500 uppercase text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 text-sm">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">Carregando...</td></tr>
              ) : filteredData.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Nenhuma entidade encontrada.</td></tr>
              ) : (
                filteredData.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition group">
                    <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{e.nome}</td>
                    <td className="p-4">{getBadge(e.tipo)}</td>
                    <td className="p-4 font-mono text-slate-500 dark:text-slate-400">{e.cpf_cnpj || '-'}</td>
                    <td className="p-4">
                      <span className={`text-xs font-bold ${e.status === 'ATIVO' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => handleOpenEdit(e)} className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition"><Edit2 className="w-4 h-4"/></button>
                        <button onClick={() => handleDelete(e.id)} className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"><Trash2 className="w-4 h-4"/></button>
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
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setShowModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white">{isEditing ? 'Editar Entidade' : 'Nova Entidade'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-red-500 transition"><X className="w-5 h-5"/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome *</label>
                <input 
                  autoFocus
                  type="text" 
                  required
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 transition text-sm"
                  style={{ '--tw-ring-color': primaryColor } as any}
                  value={form.nome}
                  onChange={e => setForm({...form, nome: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                  <select 
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 transition text-sm"
                    style={{ '--tw-ring-color': primaryColor } as any}
                    value={form.tipo}
                    onChange={e => setForm({...form, tipo: e.target.value as any})}
                  >
                    <option value="CLIENTE">Cliente</option>
                    <option value="FORNECEDOR">Fornecedor</option>
                    <option value="AMBOS">Ambos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                  <select 
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 transition text-sm"
                    style={{ '--tw-ring-color': primaryColor } as any}
                    value={form.status}
                    onChange={e => setForm({...form, status: e.target.value as any})}
                  >
                    <option value="ATIVO">Ativo</option>
                    <option value="INATIVO">Inativo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CPF / CNPJ</label>
                <input 
                  type="text" 
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white outline-none focus:ring-2 transition text-sm font-mono"
                  style={{ '--tw-ring-color': primaryColor } as any}
                  value={form.cpf_cnpj}
                  onChange={e => setForm({...form, cpf_cnpj: e.target.value})}
                />
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-sm transition">Cancelar</button>
                <button type="submit" disabled={saving} className="px-6 py-2 text-white font-bold rounded-lg shadow-md hover:brightness-90 transition text-sm flex items-center gap-2" style={{ backgroundColor: primaryColor }}>
                  {saving ? 'Salvando...' : <><Check className="w-4 h-4"/> Salvar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}