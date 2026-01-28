import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Layers, PlusCircle, Search, Edit3, Trash2, X, Check, 
  Loader2, Hash, Type, Activity, AlertTriangle 
} from 'lucide-react';

// --- TIPAGENS ---
interface CentroCusto {
  id: number;
  nome: string;
  codigo?: string;
  status: 'ATIVO' | 'INATIVO';
}

interface FormCentro {
  nome: string;
  codigo: string;
  status: string;
}

export function CentroCusto() {
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // States do Modal
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // State do Formulário
  const [form, setForm] = useState<FormCentro>({
    nome: '',
    codigo: '',
    status: 'ATIVO'
  });

  // State para Delete
  const [itemToDelete, setItemToDelete] = useState<CentroCusto | null>(null);

  useEffect(() => {
    carregarDados();
  }, []);

  async function carregarDados() {
    try {
      const res = await api.get('/centro-custo/'); 
      setCentros(res.data);
    } catch (error) {
      console.error("Erro ao listar centros", error);
    } finally {
      setLoading(false);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setForm({ nome: '', codigo: '', status: 'ATIVO' });
    setShowModal(true);
  }

  function handleOpenEdit(item: CentroCusto) {
    setIsEditing(true);
    setEditingId(item.id);
    setForm({
      nome: item.nome,
      codigo: item.codigo || '',
      status: item.status
    });
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    
    try {
      // 1. Sanitização do Payload
      // Enviamos null se o código estiver vazio, para não quebrar validação opcional do backend
      const payload = {
        nome: form.nome,
        codigo: form.codigo ? form.codigo.toUpperCase() : null,
        status: form.status
      };

      if (isEditing && editingId) {
        // CORREÇÃO CRÍTICA: URL limpa, sem ":" antes do ID
        await api.put(`/centro-custo/${editingId}`, payload);
      } else {
        await api.post('/centro-custo/', payload);
      }
      
      setShowModal(false);
      carregarDados();
      // Opcional: Adicionar um Toast aqui no futuro
    } catch (error: any) {
      console.error("Erro ao salvar", error);
      
      // Tratamento inteligente de erro 422 (Validação do Pydantic)
      if (error.response?.status === 422) {
        const detalhes = error.response.data.detail;
        let msg = "Dados inválidos.";
        
        if (Array.isArray(detalhes)) {
           // Formata erro do FastAPI: "Campo 'nome': obrigatório"
           msg = detalhes.map((d: any) => `${d.loc[1]}: ${d.msg}`).join('\n');
        }
        alert(`Erro de validação:\n${msg}`);
      } else {
        alert("Erro ao processar. Verifique se o servidor está rodando.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/centro-custo/${itemToDelete.id}`);
      setItemToDelete(null);
      carregarDados();
    } catch (error) {
      console.error("Erro ao deletar", error);
      alert("Não foi possível excluir este registro. Verifique se existem lançamentos vinculados.");
    }
  }

  // Filtro Local
  const filtered = centros.filter(c => 
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.codigo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="p-8 text-center text-slate-500 animate-pulse flex flex-col items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin mb-2 text-(--color-primary)"/> 
      <p>Carregando departamentos...</p>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Layers className="text-(--color-primary)" /> Centros de Custo
          </h1>
          <p className="text-slate-500 dark:text-slate-400">Gerenciamento de departamentos e projetos.</p>
        </div>
        
          <button 
           onClick={handleOpenCreate}
           className="bg-(--color-primary) hover:opacity-90 text-white px-4 py-2.5 rounded-lg font-bold transition flex items-center gap-2 shadow-md active:scale-95 w-full sm:w-auto justify-center"
        >
          <PlusCircle size={18} /> Novo Centro
        </button>
      </div>

      {/* SEARCH */}
      <div className="relative group">
        <Search className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-(--color-primary) transition-colors" size={20} />
        <input 
          type="text" 
          placeholder="Pesquisar por nome ou código..." 
          className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-(--color-primary) outline-none transition shadow-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* GRID DE CARDS */}
      {filtered.length === 0 ? (
         <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700">
            <div className="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-full mb-4">
               <Layers className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-600 dark:text-slate-400">Nenhum centro encontrado</h3>
            <button onClick={handleOpenCreate} className="text-(--color-primary) font-bold hover:underline mt-2">Criar o primeiro</button>
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(item => {
            const isInactive = item.status === 'INATIVO';
            
            return (
              <div 
                key={item.id} 
                className={`relative bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-(--color-primary) hover:shadow-md hover:shadow-(--color-primary)/10 transition-all duration-300 group overflow-hidden ${isInactive ? 'opacity-70 grayscale-[0.8]' : ''}`}
              >
                <div className="p-6 flex items-start justify-between z-10 relative">
                  <div className="flex gap-4 items-center">
                    {/* Icon Box com cor dinâmica */}
                    <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-(--color-primary) shadow-inner">
                      <Layers size={24} />
                    </div>
                    
                    <div>
                      <h3 className="font-bold text-slate-800 dark:text-white text-lg leading-tight group-hover:text-(--color-primary) transition-colors">
                        {item.nome}
                      </h3>
                      
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center gap-1 text-xs font-mono bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                          <Hash size={12} />
                          {item.codigo || 'S/ CÓDIGO'}
                        </div>
                        {isInactive && (
                          <span className="text-[10px] font-bold text-red-500 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded flex items-center gap-1">
                            INATIVO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Hover */}
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button onClick={() => handleOpenEdit(item)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-(--color-primary) rounded-lg transition" title="Editar">
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => setItemToDelete(item)} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 rounded-lg transition" title="Excluir">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Bottom Bar Gradient */}
                <div className="absolute bottom-0 left-0 h-1 w-full bg-(--color-primary) transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300"></div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- MODAL CREATE/EDIT --- */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setShowModal(false)} />
          
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-scale-in border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                {isEditing ? <Edit3 size={20} className="text-(--color-primary)" /> : <PlusCircle size={20} className="text-(--color-primary)" />}
                {isEditing ? 'Editar Centro' : 'Novo Centro'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-red-500 transition">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar">
              
              {/* LIVE PREVIEW CARD */}
              <div className="mb-8 flex justify-center perspective select-none">
                <div 
                  className="rounded-xl p-6 text-white shadow-xl w-full h-32 flex flex-col justify-between relative overflow-hidden border border-white/10 transition-all"
                  style={{ background: `linear-gradient(135deg, var(--color-primary) 0%, #000 150%)` }}
                >
                  <div className="absolute -right-4 -top-4 bg-white/20 w-24 h-24 rounded-full blur-2xl"></div>
                  
                  <div className="flex justify-between items-start z-10">
                    <div className={`opacity-90 font-mono text-[10px] tracking-widest uppercase border border-white/30 px-2 py-0.5 rounded backdrop-blur-sm ${form.status === 'INATIVO' ? 'bg-red-500/50 border-red-200' : ''}`}>
                      {form.status}
                    </div>
                    <Layers className="w-6 h-6 opacity-80" />
                  </div>

                  <div className="z-10">
                    <div className="text-[10px] uppercase opacity-70 mb-1">Visualização</div>
                    <div className="font-bold text-xl tracking-wide truncate">
                      {form.nome || 'NOVO DEPARTAMENTO'}
                    </div>
                  </div>

                  <div className="flex justify-between items-end z-10">
                    <div className="flex items-center gap-1 opacity-90">
                      <Hash size={12} />
                      <span className="text-xs font-mono">{form.codigo || '---'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* FORM */}
              <form onSubmit={handleSave} className="space-y-5">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Nome do Centro</label>
                  <div className="relative">
                    <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      required
                      type="text" 
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 focus:border-(--color-primary) focus:bg-white dark:focus:bg-slate-800 outline-none transition"
                      placeholder="Ex: Marketing, Obras..."
                      value={form.nome}
                      onChange={e => setForm({...form, nome: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Código</label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input 
                        type="text" 
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 focus:border-(--color-primary) focus:bg-white dark:focus:bg-slate-800 outline-none transition uppercase"
                        placeholder="Ex: MKT-01"
                        value={form.codigo}
                        onChange={e => setForm({...form, codigo: e.target.value})}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Status</label>
                    <div className="relative">
                      <Activity className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <select 
                        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 focus:border-(--color-primary) focus:bg-white dark:focus:bg-slate-800 outline-none transition appearance-none cursor-pointer"
                        value={form.status}
                        onChange={e => setForm({...form, status: e.target.value})}
                      >
                        <option value="ATIVO">ATIVO</option>
                        <option value="INATIVO">INATIVO</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-700 mt-6">
                  <button type="button" onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-lg text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition text-sm">
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    disabled={saving}
                    className="px-6 py-2.5 rounded-lg bg-(--color-primary) text-white font-bold shadow-lg hover:brightness-110 hover:-translate-y-0.5 transition-all text-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="animate-spin w-4 h-4"/> : <Check className="w-4 h-4"/>}
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRM DELETE --- */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setItemToDelete(null)} />
           <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-700 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                 <AlertTriangle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Excluir Centro?</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
                Tem certeza que deseja remover <strong>{itemToDelete.nome}</strong>? <br/>
                Lançamentos vinculados podem perder a referência.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setItemToDelete(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-bold transition">
                  Cancelar
                </button>
                <button onClick={handleConfirmDelete} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition shadow-lg">
                  Confirmar Exclusão
                </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}