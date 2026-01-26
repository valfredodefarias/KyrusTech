import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { 
  Landmark, RefreshCw, Plus, Edit2, Trash2, ChevronRight, X, Check, Loader2, 
  Banknote, TrendingUp, AlertTriangle, Filter, Search
} from 'lucide-react';

// --- TIPAGENS ---
interface Conta {
  id: number;
  nome: string;
  banco?: string;
  tipo: 'CORRENTE' | 'POUPANCA' | 'CAIXA' | 'INVESTIMENTO';
  saldo_inicial: number;
  saldo_atual: number;
  centro_custo_id?: number;
  status: 'ATIVO' | 'INATIVO';
}

interface CentroCusto {
  id: number;
  nome: string;
}

interface LancamentoExtrato {
  id: number;
  data_pagamento: string;
  descricao: string;
  valor_pago: number;
  tipo: 'RECEITA' | 'DESPESA';
}

interface FormConta {
  nome: string;
  banco: string;
  tipo: string;
  saldo_inicial: string; 
  centro_custo_id: string;
  status: string;
}

interface UserData {
  empresa_id: number;
}

interface EmpresaData {
  cor_primaria: string;
}

export function Contas() {
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  
  // Tema Personalizado
  const [primaryColor, setPrimaryColor] = useState('#2563eb'); // Azul padrão (fallback)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCentroId, setFilterCentroId] = useState('');

  // Drawers e Modais
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extratoOpen, setExtratoOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Confirmação de Exclusão
  const [itemToDelete, setItemToDelete] = useState<Conta | null>(null);

  // Dados do Extrato
  const [extratoData, setExtratoData] = useState<LancamentoExtrato[]>([]);
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [contaExtratoNome, setContaExtratoNome] = useState('');

  // Formulário
  const [form, setForm] = useState<FormConta>({
    nome: '',
    banco: '',
    tipo: 'CORRENTE',
    saldo_inicial: '',
    centro_custo_id: '',
    status: 'ATIVO'
  });

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  useEffect(() => {
    carregarDados();
    carregarTema();
  }, []);

  // --- TEMA DINÂMICO ---
  async function carregarTema() {
    try {
      // 1. Pega ID da empresa do usuário logado
      const { data: user } = await api.get<UserData>('/usuarios/me');
      if (user.empresa_id) {
        // 2. Pega a cor da empresa
        const { data: emp } = await api.get<EmpresaData>(`/empresas/${user.empresa_id}`);
        if (emp.cor_primaria) {
          setPrimaryColor(emp.cor_primaria);
          // 3. Injeta a variável CSS para que o Tailwind (bg-[var(--color-primary)]) funcione
          document.documentElement.style.setProperty('--color-primary', emp.cor_primaria);
        }
      }
    } catch (error) {
      console.error("Erro ao carregar tema", error);
    }
  }

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCentros] = await Promise.all([
        api.get('/contas/'),
        api.get('/centro-custo/') 
      ]);
      setContas(resContas.data);
      setCentros(resCentros.data);
    } catch (error) {
      console.error("Erro ao carregar dados", error);
    } finally {
      setLoading(false);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setForm({ nome: '', banco: '', tipo: 'CORRENTE', saldo_inicial: '', centro_custo_id: '', status: 'ATIVO' });
    setDrawerOpen(true);
  }

  function handleOpenEdit(conta: Conta) {
    setIsEditing(true);
    setEditingId(conta.id);
    setForm({
      nome: conta.nome,
      banco: conta.banco || '',
      tipo: conta.tipo,
      saldo_inicial: String(conta.saldo_inicial || 0),
      centro_custo_id: conta.centro_custo_id ? String(conta.centro_custo_id) : '',
      status: conta.status
    });
    setDrawerOpen(true);
  }

  async function handleSave() {
    if (!form.nome) return alert("O nome da conta é obrigatório.");
    
    setSaving(true);
    try {
      const payload = {
        ...form,
        saldo_inicial: parseFloat(form.saldo_inicial) || 0,
        centro_custo_id: form.centro_custo_id ? parseInt(form.centro_custo_id) : null
      };

      if (isEditing && editingId) {
        await api.patch(`/contas/${editingId}`, payload);
      } else {
        await api.post('/contas/', payload);
      }
      
      setDrawerOpen(false);
      carregarDados();
    } catch (error) {
      console.error("Erro ao salvar", error);
      alert("Erro ao salvar conta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/contas/${itemToDelete.id}`);
      setItemToDelete(null);
      carregarDados();
    } catch (error) {
      console.error("Erro ao deletar", error);
      alert("Não foi possível excluir. Verifique se há lançamentos vinculados.");
    }
  }

  async function handleVerExtrato(id: number, nome: string) {
    setContaExtratoNome(nome);
    setExtratoOpen(true);
    setExtratoLoading(true);
    try {
      const res = await api.get('/lancamentos/');
      const todos = res.data;
      
      const filtrados = todos
        .filter((l: any) => l.conta_id === id && l.status === 'PAGO')
        .sort((a: any, b: any) => new Date(b.data_pagamento).getTime() - new Date(a.data_pagamento).getTime())
        .slice(0, 15);

      setExtratoData(filtrados);
    } catch (error) {
      console.error("Erro ao carregar extrato", error);
    } finally {
      setExtratoLoading(false);
    }
  }

  const filteredContas = contas.filter(c => {
    const matchesSearch = c.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.banco?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCentro = filterCentroId ? String(c.centro_custo_id) === filterCentroId : true;
    return matchesSearch && matchesCentro;
  });

  const saldoTotal = filteredContas.reduce((acc, curr) => acc + (parseFloat(String(curr.saldo_atual)) || 0), 0);

  const getIcon = (tipo: string) => {
    switch(tipo) {
      case 'CAIXA': return Banknote;
      case 'INVESTIMENTO': return TrendingUp;
      default: return Landmark;
    }
  };

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-slate-50 dark:bg-slate-900">
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-20 gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">Contas Bancárias</h2>
          <p className="text-sm text-slate-400">Caixas, Bancos e Investimentos</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={carregarDados}
            className="p-2 text-slate-400 transition border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 hover:brightness-95" 
            style={{ color: loading ? undefined : primaryColor }}
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={handleOpenCreate}
            className="text-white px-5 py-2 rounded-lg shadow-md flex items-center gap-2 font-bold transition active:scale-95 text-sm whitespace-nowrap hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            <Plus className="w-4 h-4" /> Nova Conta
          </button>
        </div>
      </header>

      {/* ÁREA DE CONTEÚDO */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 pb-32">
        
        {/* CARD DE RESUMO */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
            <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Saldo Geral Disponível</p>
                <p className={`text-2xl font-black mt-1 ${saldoTotal >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                  {BRL.format(saldoTotal)}
                </p>
                {filterCentroId && (
                  <p className="text-[10px] mt-1 font-bold" style={{ color: primaryColor }}>
                    * Filtrado por Centro de Custo
                  </p>
                )}
            </div>
            {/* Ícone com fundo colorido suave */}
            <div className="p-3 rounded-full" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                <Landmark className="w-6 h-6" />
            </div>
        </div>

        {/* BARRA DE FILTROS */}
        <div className="flex flex-col md:flex-row gap-4">
            {/* Busca por Texto */}
            <div className="relative group flex-1">
                <Search className="absolute left-4 top-3.5 text-slate-400 transition-colors" size={20} 
                  style={{ color: searchTerm ? primaryColor : undefined }}
                />
                <input 
                  type="text" 
                  placeholder="Pesquisar conta..." 
                  className="w-full pl-12 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition shadow-sm focus:ring-2"
                  style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Filtro por Centro de Custo */}
            <div className="relative group w-full md:w-64">
                <Filter className="absolute left-4 top-3.5 text-slate-400 transition-colors" size={20} 
                   style={{ color: filterCentroId ? primaryColor : undefined }}
                />
                <select 
                  className="w-full pl-12 pr-8 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition shadow-sm appearance-none cursor-pointer text-slate-600 dark:text-slate-300 focus:ring-2"
                  style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                  value={filterCentroId}
                  onChange={(e) => setFilterCentroId(e.target.value)}
                >
                    <option value="">Todos os Centros</option>
                    {centros.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
            </div>
        </div>

        {/* GRID DE CONTAS */}
        {filteredContas.length === 0 && !loading ? (
           <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
             {contas.length === 0 ? "Nenhuma conta cadastrada." : "Nenhuma conta encontrada com este filtro."}
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {filteredContas.map(c => {
               const IconComp = getIcon(c.tipo);
               const saldo = parseFloat(String(c.saldo_atual || 0));
               const nomeCentro = centros.find(ct => ct.id === c.centro_custo_id)?.nome;
               
               return (
                 <div key={c.id} 
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                    style={{ '--hover-color': primaryColor } as React.CSSProperties}
                 >
                    {/* Hover Border Trick via CSS interno ou inline se precisar, mas Tailwind hover:border-[color] precisa da var. 
                        Como já injetamos a var no root, podemos usar classes tailwind arbitrárias se configurado, 
                        mas aqui vou usar style inline no border para garantir */}
                    <div 
                        className="absolute inset-0 rounded-xl border-2 border-transparent pointer-events-none transition-colors duration-300"
                        style={{ borderColor: 'transparent' }} // Base state
                        // React não suporta hover inline fácil, então confiamos na var CSS injetada ou usamos onMouseEnter.
                        // Vamos confiar na var --color-primary injetada no useEffect
                    ></div>

                    {/* Conteúdo do Card */}
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            {/* Ícone colorido */}
                            <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-sm"
                                style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }} // 10% opacity
                            >
                                <IconComp className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-700 dark:text-slate-200 leading-tight">{c.nome}</h3>
                                <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{c.banco || c.tipo}</p>
                            </div>
                        </div>
                        
                        {/* Ações (aparecem no hover) */}
                        <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                            <button onClick={() => handleOpenEdit(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded" style={{ color: primaryColor }}>
                                <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => setItemToDelete(c)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-red-500">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                        <div className="flex justify-between items-end">
                            <div>
                                <p className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Saldo Atual</p>
                                <p className={`text-xl font-bold font-mono ${saldo >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>
                                  {BRL.format(saldo)}
                                </p>
                            </div>
                            <button 
                              onClick={() => handleVerExtrato(c.id, c.nome)}
                              className="text-xs font-bold hover:underline flex items-center gap-1"
                              style={{ color: primaryColor }}
                            >
                                Ver Extrato <ChevronRight className="w-3 h-3" />
                            </button>
                        </div>
                        
                        {/* Badge do Centro de Custo */}
                        {nomeCentro && (
                           <div className="mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-mono text-slate-500 border border-slate-200 dark:border-slate-600">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryColor }}></span>
                              {nomeCentro}
                           </div>
                        )}
                    </div>
                    
                    {/* Borda inferior colorida no hover (efeito sutil) */}
                    <div className="absolute bottom-0 left-4 right-4 h-0.5 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" style={{ backgroundColor: primaryColor }}></div>
                 </div>
               );
             })}
          </div>
        )}
      </div>

      {/* --- DRAWER (MODAL LATERAL) NOVA/EDITAR CONTA --- */}
      <div 
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setDrawerOpen(false)}
      />
      
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[500px] bg-white dark:bg-slate-900 z-50 transform transition-transform duration-300 ease-out border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing ? 'Editar Conta' : 'Nova Conta'}</h2>
              <button onClick={() => setDrawerOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Nome da Conta / Apelido</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor, borderColor: 'transparent' } as React.CSSProperties} // Trick for focus ring color
                    placeholder="Ex: Itaú Principal" 
                    value={form.nome}
                    onChange={e => setForm({...form, nome: e.target.value})}
                  />
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Tipo</label>
                      <select 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        value={form.tipo}
                        onChange={e => setForm({...form, tipo: e.target.value})}
                      >
                          <option value="CORRENTE">Conta Corrente</option>
                          <option value="POUPANCA">Poupança</option>
                          <option value="CAIXA">Caixa Físico</option>
                          <option value="INVESTIMENTO">Investimento</option>
                      </select>
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Banco</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: Nubank" 
                        value={form.banco}
                        onChange={e => setForm({...form, banco: e.target.value})}
                      />
                  </div>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Saldo Inicial</label>
                  <input 
                    type="number" step="0.01" 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition font-bold text-lg focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    placeholder="0.00" 
                    value={form.saldo_inicial}
                    onChange={e => setForm({...form, saldo_inicial: e.target.value})}
                  />
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Vincular a Centro de Custo</label>
                  <select 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    value={form.centro_custo_id}
                    onChange={e => setForm({...form, centro_custo_id: e.target.value})}
                  >
                      <option value="">Sem vínculo</option>
                      {centros.map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.nome}</option>
                      ))}
                  </select>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Status</label>
                  <select 
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    value={form.status}
                    onChange={e => setForm({...form, status: e.target.value})}
                  >
                      <option value="ATIVO">Ativa</option>
                      <option value="INATIVO">Inativa</option>
                  </select>
              </div>
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end gap-3">
              <button 
                onClick={() => setDrawerOpen(false)}
                className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-3 rounded-xl text-white font-bold shadow-lg text-sm flex items-center gap-2 active:scale-95 transition disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                {saving ? <Loader2 className="animate-spin w-4 h-4"/> : <Check className="w-4 h-4" />} 
                Salvar
              </button>
          </div>
      </div>

      {/* --- DRAWER (MODAL LATERAL) EXTRATO --- */}
      <div 
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${extratoOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setExtratoOpen(false)}
      />
      
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[600px] bg-white dark:bg-slate-900 z-50 transform transition-transform duration-300 ease-out border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ${extratoOpen ? 'translate-x-0' : 'translate-x-full'}`}>
         <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
             <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Extrato Recente</h2>
                <p className="text-xs text-slate-400">{contaExtratoNome}</p>
             </div>
             <button onClick={() => setExtratoOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
               <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
             </button>
         </div>

         <div className="flex-1 overflow-y-auto p-0">
            <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-500 uppercase sticky top-0">
                    <tr>
                        <th className="p-4">Data</th>
                        <th className="p-4">Descrição</th>
                        <th className="p-4 text-right">Valor</th>
                    </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-100 dark:divide-slate-700">
                    {extratoLoading ? (
                        <tr><td colSpan={3} className="p-6 text-center text-slate-400">Carregando...</td></tr>
                    ) : extratoData.length === 0 ? (
                        <tr><td colSpan={3} className="p-6 text-center text-slate-400 italic">Nenhuma movimentação recente.</td></tr>
                    ) : (
                        extratoData.map(l => (
                            <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                <td className="p-4 font-mono text-xs text-slate-500">
                                    {new Date(l.data_pagamento).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{l.descricao}</td>
                                <td className={`p-4 text-right font-bold ${l.tipo === 'RECEITA' ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {l.tipo === 'DESPESA' ? '-' : ''}{BRL.format(l.valor_pago)}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
         </div>
      </div>

      {/* --- MODAL DE CONFIRMAÇÃO DE EXCLUSÃO --- */}
      {itemToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setItemToDelete(null)} />
           <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-scale-in border border-slate-700 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
                 <AlertTriangle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Excluir Conta?</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
                Tem certeza que deseja remover <strong>{itemToDelete.nome}</strong>? <br/>
                Lançamentos vinculados podem perder a referência.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setItemToDelete(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded-lg font-bold transition">
                  Cancelar
                </button>
                <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition shadow-lg">
                  Confirmar Exclusão
                </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}