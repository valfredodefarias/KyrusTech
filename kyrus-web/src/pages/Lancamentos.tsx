import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { 
  Plus, Search, Filter, RefreshCw, ChevronLeft, ChevronRight, 
  ArrowRightLeft, Wallet, CreditCard, Layers, Calendar, 
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2, 
  Trash2, Edit2, Check, X, UploadCloud, FileText, Loader2, 
  CalendarClock, User, ChevronDown, Save
} from 'lucide-react';

// --- COMPONENTES UI REUTILIZÁVEIS ---

// 1. Select Pesquisável (Dark Mode & Parents Disabled)
const SearchableSelect = ({ options, value, onChange, placeholder, label }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Encontra o item selecionado dentro dos grupos
  const selectedOption = options.flatMap((g:any) => g.options).find((o:any) => String(o.id) === String(value));

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Filtra grupos e opções
  const filteredGroups = options.map((group: any) => ({
    ...group,
    options: group.options.filter((opt: any) => opt.label.toLowerCase().includes(search.toLowerCase()))
  })).filter((group: any) => group.options.length > 0);

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 rounded-lg border border-slate-600 bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-[46px] hover:border-blue-500 transition"
      >
        <span className={selectedOption ? 'text-white font-medium' : 'text-slate-500'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400"/>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-60 flex flex-col animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-700 sticky top-0 bg-slate-800 rounded-t-xl">
            <input 
              autoFocus
              type="text" 
              placeholder="Pesquisar..." 
              className="w-full p-2 text-sm bg-slate-900 border border-slate-700 rounded-lg outline-none text-white focus:border-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar p-1">
            {filteredGroups.map((group: any, idx: number) => (
              <div key={idx} className="mb-2">
                {/* CATEGORIA PAI (NÃO CLICÁVEL) */}
                <div className="px-3 py-1.5 text-[10px] font-bold text-blue-400 uppercase tracking-wider bg-slate-700/30 rounded mb-1">
                  {group.label}
                </div>
                {/* FILHOS (CLICÁVEIS) */}
                {group.options.map((opt: any) => (
                  <div 
                    key={opt.id}
                    onClick={() => { onChange(opt.id); setIsOpen(false); setSearch(''); }}
                    className={`px-3 py-2 text-sm rounded cursor-pointer transition flex items-center justify-between ${String(value) === String(opt.id) ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
                  >
                    {opt.label}
                    {String(value) === String(opt.id) && <Check className="w-3 h-3"/>}
                  </div>
                ))}
              </div>
            ))}
            {filteredGroups.length === 0 && <div className="p-4 text-center text-xs text-slate-500">Nada encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// 2. Input Estilizado Dark
const InputDark = (props: any) => (
  <div>
    {props.label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{props.label}</label>}
    <input 
      {...props} 
      className={`w-full p-3 rounded-lg border border-slate-600 bg-slate-800 text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-600 ${props.className || ''}`} 
    />
  </div>
);

export function Lancamentos() {
  // --- DADOS ---
  const [loading, setLoading] = useState(true);
  const [lancamentos, setLancamentos] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [cartoes, setCartoes] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);

  // --- UI STATE ---
  const [mesAtual, setMesAtual] = useState(new Date());
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroRapido, setFiltroRapido] = useState<'TODOS'|'HOJE'|'ATRASADO'|'IPP'>('TODOS');
  const [showFiltros, setShowFiltros] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [primaryColor, setPrimaryColor] = useState('#2563eb');

  // --- MODAIS & DRAWERS ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showEntityDrawer, setShowEntityDrawer] = useState(false); // <--- Drawer Nova Entidade
  const [bulkPayModal, setBulkPayModal] = useState(false);

  // --- FORMS STATES ---
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<FileList | null>(null);
  
  // Nova Entidade Form
  const [newEntityData, setNewEntityData] = useState({ nome: '', tipo: 'AMBOS' });

  const [formData, setFormData] = useState<any>({
    id: null, descricao: '', valor_previsto: '', data_vencimento: '',
    tipo: 'DESPESA', plano_contas_id: '', centro_custo_id: '', entidade_id: '',
    conta_id: '', cartao_id: '', status: 'PENDENTE', 
    valor_pago: '', data_pagamento: '', ipp: false,
    is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL'
  });

  const [transferData, setTransferData] = useState({
    valor: '', data: '', conta_origem: '', conta_destino: '', centro_custo: ''
  });

  const [bulkPayData, setBulkPayData] = useState({ date: '', accountId: '' });

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // --- INIT ---
  useEffect(() => {
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
    if(cor) setPrimaryColor(cor);
    loadAuxData();
  }, []);

  useEffect(() => { loadLancamentos(); }, [mesAtual]);

  async function loadAuxData() {
    try {
      const [rC, rCt, rCC, rE, rCat] = await Promise.all([
        api.get('/contas/'), api.get('/cartoes/'), api.get('/centro-custo/'), api.get('/entidades/'), api.get('/plano-contas/')
      ]);
      setContas(rC.data); setCartoes(rCt.data); setCentros(rCC.data); setEntidades(rE.data); setCategorias(rCat.data);
    } catch(e) { console.error(e); }
  }

  async function loadLancamentos() {
    setLoading(true);
    try {
      const ano = mesAtual.getFullYear(); const mes = mesAtual.getMonth() + 1;
      const ini = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
      const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
      const res = await api.get('/lancamentos/', { params: { data_inicio: ini, data_fim: fim } });
      setLancamentos(res.data);
    } catch(e) { console.error(e); } finally { setLoading(false); }
  }

  // --- FILTROS ---
  const filteredList = useMemo(() => {
    return lancamentos.filter(l => {
      if (filtroTexto && !l.descricao.toLowerCase().includes(filtroTexto.toLowerCase()) && !String(l.valor_previsto).includes(filtroTexto)) return false;
      const hoje = new Date().toISOString().split('T')[0];
      if (filtroRapido === 'HOJE' && l.data_vencimento !== hoje) return false;
      if (filtroRapido === 'IPP' && !l.ipp) return false;
      if (filtroRapido === 'ATRASADO' && (l.status === 'PAGO' || l.data_vencimento >= hoje)) return false;
      return true;
    }).sort((a,b) => a.data_vencimento.localeCompare(b.data_vencimento));
  }, [lancamentos, filtroTexto, filtroRapido]);

  const kpis = useMemo(() => {
    const r = filteredList.filter(l=>l.tipo==='RECEITA').reduce((acc,l)=>acc+Number(l.valor_previsto),0);
    const d = filteredList.filter(l=>l.tipo==='DESPESA').reduce((acc,l)=>acc+Number(l.valor_previsto),0);
    return { r, d, s: r-d };
  }, [filteredList]);

  // --- HANDLERS ---
  
  function openDrawer(l?: any) {
    if(l) {
      setIsEditing(true);
      setFormData({
        ...l, 
        conta_id: l.conta_id||'', cartao_id: l.cartao_id||'', centro_custo_id: l.centro_custo_id||'', entidade_id: l.entidade_id||'',
        plano_contas_id: l.plano_contas_id, valor_previsto: l.valor_previsto, 
        valor_pago: l.valor_pago||l.valor_previsto, data_pagamento: l.data_pagamento||l.data_vencimento
      });
    } else {
      setIsEditing(false);
      setFormData({
        id: null, descricao: '', valor_previsto: '', data_vencimento: new Date().toISOString().split('T')[0],
        tipo: 'DESPESA', plano_contas_id: '', centro_custo_id: '', entidade_id: '', conta_id: '', cartao_id: '',
        status: 'PENDENTE', valor_pago: '', data_pagamento: new Date().toISOString().split('T')[0], ipp: false, is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL'
      });
    }
    setFilesToUpload(null);
    setShowDrawer(true);
  }

  // CRIAÇÃO DE ENTIDADE (Via Drawer)
  async function handleCreateEntity() {
    if(!newEntityData.nome) return alert("Digite o nome");
    setSaving(true);
    try {
      const res = await api.post('/entidades/', newEntityData);
      setEntidades([...entidades, res.data]);
      setFormData({...formData, entidade_id: res.data.id}); // Auto-seleciona
      setShowEntityDrawer(false); 
      setNewEntityData({ nome: '', tipo: 'AMBOS' });
    } catch(e) { alert("Erro ao criar entidade"); } finally { setSaving(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if(!formData.descricao || !formData.valor_previsto || !formData.plano_contas_id) return alert("Preencha campos obrigatórios");
    setSaving(true);
    try {
      const payload = {
        ...formData,
        valor_previsto: parseFloat(formData.valor_previsto),
        plano_contas_id: parseInt(formData.plano_contas_id),
        centro_custo_id: formData.centro_custo_id ? parseInt(formData.centro_custo_id) : null,
        entidade_id: formData.entidade_id ? parseInt(formData.entidade_id) : null,
        conta_id: formData.conta_id ? parseInt(formData.conta_id) : null,
        cartao_id: formData.cartao_id ? parseInt(formData.cartao_id) : null,
        valor_pago: formData.status==='PAGO' ? parseFloat(formData.valor_pago || formData.valor_previsto) : 0,
        data_pagamento: formData.status==='PAGO' ? formData.data_pagamento : null
      };

      let id = formData.id;
      if (formData.is_parcelado && !id) {
        // Parcelamento (Bulk)
        const lista = [];
        const qtd = formData.qtd_parcelas;
        const [ano, mes, dia] = formData.data_vencimento.split('-').map(Number);
        let val = formData.modo_calculo === 'TOTAL' ? payload.valor_previsto/qtd : payload.valor_previsto;
        
        for(let i=0; i<qtd; i++) {
          const dt = new Date(ano, (mes-1)+i, dia);
          lista.push({
            ...payload, valor_previsto: val, data_vencimento: dt.toISOString().split('T')[0],
            descricao: `${payload.descricao} (${i+1}/${qtd})`, numero_parcela: `${i+1}/${qtd}`,
            status: (i===0 && payload.status==='PAGO') ? 'PAGO' : 'PENDENTE',
            valor_pago: (i===0 && payload.status==='PAGO') ? payload.valor_pago : 0
          });
        }
        await api.post('/lancamentos/bulk', lista);
      } else {
        if(id) await api.put(`/lancamentos/${id}`, payload);
        else { const r = await api.post('/lancamentos/', payload); id = r.data.id; }
        
        if(filesToUpload && id) {
          const fd = new FormData();
          for(let i=0; i<filesToUpload.length; i++) fd.append('files', filesToUpload[i]);
          await api.post(`/lancamentos/${id}/anexos`, fd);
        }
      }
      setShowDrawer(false); loadLancamentos();
    } catch(e) { alert("Erro ao salvar"); } finally { setSaving(false); }
  }

  // --- PREPARAÇÃO DE DADOS PARA O SEARCHABLE SELECT (AGRUPADO) ---
  const catOptions = [
    { label: 'DESPESAS', options: categorias.filter(c=>c.tipo==='D').map(c=>({id:c.id, label:c.nome})) },
    { label: 'RECEITAS', options: categorias.filter(c=>c.tipo==='R').map(c=>({id:c.id, label:c.nome})) }
  ];

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden relative">
      
      {/* HEADER */}
      <header className="bg-slate-800 border-b border-slate-700 p-4 flex justify-between items-center z-20 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-700 rounded-lg p-1">
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()-1)))} className="p-1.5 hover:bg-slate-600 rounded-md text-slate-300"><ChevronLeft className="w-4 h-4"/></button>
            <span className="w-32 text-center text-xs font-bold uppercase pt-1 text-white">{mesAtual.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</span>
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()+1)))} className="p-1.5 hover:bg-slate-600 rounded-md text-slate-300"><ChevronRight className="w-4 h-4"/></button>
          </div>
          <button onClick={loadLancamentos} className="p-2 text-slate-400 hover:text-blue-400 border border-slate-600 rounded-lg"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/></button>
        </div>

        <div className="relative w-96">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500"/>
          <input type="text" placeholder="Pesquisar lançamentos..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-600 bg-slate-900 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none transition" value={filtroTexto} onChange={e=>setFiltroTexto(e.target.value)}/>
        </div>

        <div className="flex gap-2">
          <button onClick={()=>setShowTransfer(true)} className="px-4 py-2 border border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-700 flex gap-2 text-slate-300"><ArrowRightLeft className="w-4 h-4"/> Transferir</button>
          <button onClick={()=>setShowFiltros(true)} className="px-4 py-2 border border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-700 flex gap-2 text-slate-300"><Filter className="w-4 h-4"/> Filtros</button>
          <button onClick={()=>openDrawer()} className="px-5 py-2 rounded-lg shadow-lg text-white font-bold text-sm flex gap-2 hover:opacity-90 transition bg-blue-600 hover:bg-blue-500"><Plus className="w-4 h-4"/> Novo</button>
        </div>
      </header>

      {/* FILTROS RÁPIDOS */}
      <div className="px-6 py-3 border-b border-slate-800 flex gap-2 overflow-x-auto bg-slate-900">
        {['TODOS','ATRASADO','HOJE','IPP'].map(t=>(
          <button key={t} onClick={()=>setFiltroRapido(t as any)} className={`px-3 py-1 rounded-full text-xs font-bold border transition flex items-center gap-1 ${filtroRapido===t?'bg-blue-900/30 border-blue-500 text-blue-400':'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
            {t==='ATRASADO'&&<AlertCircle className="w-3 h-3"/>}{t==='HOJE'&&<Calendar className="w-3 h-3"/>}{t}
          </button>
        ))}
      </div>

      {/* KPIS */}
      <div className="p-6 grid grid-cols-3 gap-4">
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm flex justify-between items-center"><div className="text-emerald-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Receitas</p><p className="text-2xl font-black">{BRL.format(kpis.r)}</p></div><div className="p-2 bg-emerald-900/20 rounded-lg"><TrendingUp className="text-emerald-400 w-6 h-6"/></div></div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm flex justify-between items-center"><div className="text-red-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Despesas</p><p className="text-2xl font-black">{BRL.format(kpis.d)}</p></div><div className="p-2 bg-red-900/20 rounded-lg"><TrendingDown className="text-red-400 w-6 h-6"/></div></div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-sm flex justify-between items-center"><div className="text-blue-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Saldo</p><p className="text-2xl font-black">{BRL.format(kpis.s)}</p></div><div className="p-2 bg-blue-900/20 rounded-lg"><Wallet className="text-blue-400 w-6 h-6"/></div></div>
      </div>

      {/* TABELA */}
      <div className="flex-1 px-6 pb-20 overflow-y-auto custom-scrollbar">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase">
              <tr>
                <th className="p-4 w-10 text-center"><input type="checkbox" className="rounded border-slate-600 bg-slate-800 accent-blue-600 cursor-pointer" onChange={e=>{if(e.target.checked) setSelectedIds(new Set(filteredList.map(l=>l.id))); else setSelectedIds(new Set())}} checked={selectedIds.size===filteredList.length && filteredList.length>0}/></th>
                <th className="p-4 w-16 text-center">IPP</th>
                <th className="p-4">Vencimento</th>
                <th className="p-4">Descrição</th>
                <th className="p-4">Entidade / Categoria</th>
                <th className="p-4 text-right">Valor</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-700">
              {filteredList.map(l => (
                <tr key={l.id} className={`hover:bg-slate-700/50 transition group ${selectedIds.has(l.id)?'bg-blue-900/10':''}`}>
                  <td className="p-4 text-center"><input type="checkbox" className="rounded border-slate-600 bg-slate-800 accent-blue-600 cursor-pointer" checked={selectedIds.has(l.id)} onChange={()=>{const s=new Set(selectedIds); if(s.has(l.id)) s.delete(l.id); else s.add(l.id); setSelectedIds(s)}}/></td>
                  <td className="p-4 text-center"><div className={`w-5 h-5 mx-auto rounded border flex items-center justify-center ${l.ipp?'bg-purple-600 border-purple-600 text-white':'border-slate-600 text-transparent'}`}><Check className="w-3 h-3"/></div></td>
                  <td className="p-4 font-mono text-xs text-slate-400">{new Date(l.data_vencimento).toLocaleDateString('pt-BR')}</td>
                  <td className="p-4 font-medium text-white flex gap-2 items-center">{l.descricao} {l.anexos?.length>0 && <FileText className="w-3 h-3 text-blue-400"/>}</td>
                  <td className="p-4 text-xs"><div className="font-bold text-slate-300">{entidades.find(e=>e.id===l.entidade_id)?.nome}</div><div className="text-slate-500">{categorias.find(c=>c.id===l.plano_contas_id)?.nome}</div></td>
                  <td className={`p-4 text-right font-bold ${l.tipo==='RECEITA'?'text-emerald-400':'text-red-400'}`}>{BRL.format(l.valor_previsto)}</td>
                  <td className="p-4 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${l.status==='PAGO'?'bg-emerald-900/30 text-emerald-400':'bg-slate-700 text-slate-400'}`}>{l.status}</span></td>
                  <td className="p-4 text-center"><div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100"><button onClick={()=>openDrawer(l)} className="p-1 text-blue-400 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4"/></button><button className="p-1 text-red-400 hover:bg-slate-700 rounded"><Trash2 className="w-4 h-4"/></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- DRAWERS & MODALS --- */}

      {/* FILTROS (DIREITA) */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-slate-800 shadow-2xl z-50 transform transition-transform duration-300 border-l border-slate-700 ${showFiltros?'translate-x-0':'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-700 flex justify-between items-center"><h3 className="font-bold flex gap-2 text-white"><Filter className="w-4 h-4 text-blue-500"/> Filtros</h3><button onClick={()=>setShowFiltros(false)}><X className="w-5 h-5 text-slate-400 hover:text-white"/></button></div>
        <div className="p-4 space-y-4">
           {/* Conteúdo dos filtros... Simplificado */}
           <div className="p-4 text-center text-slate-500">Implementar filtros avançados aqui</div>
        </div>
      </div>

      {/* DRAWER ENTIDADE (DIREITA - SIDEBAR DE CRIAÇÃO) */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-slate-800 shadow-2xl z-[60] transform transition-transform duration-300 border-l border-slate-700 ${showEntityDrawer?'translate-x-0':'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
            <h3 className="font-bold text-white flex items-center gap-2"><User className="w-4 h-4 text-blue-500"/> Nova Entidade</h3>
            <button onClick={()=>setShowEntityDrawer(false)}><X className="w-5 h-5 text-slate-400 hover:text-white"/></button>
        </div>
        <div className="p-6 space-y-4">
            <InputDark label="Nome da Entidade" autoFocus placeholder="Ex: Fornecedor ABC" value={newEntityData.nome} onChange={(e:any)=>setNewEntityData({...newEntityData, nome:e.target.value})} />
            <div className="pt-4">
                <button onClick={handleCreateEntity} disabled={saving} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-lg flex justify-center gap-2">
                    {saving?<Loader2 className="animate-spin w-4 h-4"/>:<Save className="w-4 h-4"/>} Salvar Entidade
                </button>
            </div>
        </div>
      </div>

      {/* DRAWER NOVO/EDITAR (DIREITA - PRINCIPAL) */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={()=>setShowDrawer(false)}></div>
          <div className="relative w-full max-w-xl bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-700">
            <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
              <h2 className="text-lg font-bold text-white">{isEditing?'Editar':'Novo'} Lançamento</h2>
              <button onClick={()=>setShowDrawer(false)} className="p-2 hover:bg-slate-700 rounded-full text-slate-400"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
              
              {/* DESCRIÇÃO E VALORES */}
              <InputDark label="Descrição" autoFocus value={formData.descricao} onChange={(e:any)=>setFormData({...formData, descricao:e.target.value})} placeholder="Ex: Conta de Luz" />
              <div className="grid grid-cols-2 gap-4">
                <InputDark label="Vencimento" type="date" value={formData.data_vencimento} onChange={(e:any)=>setFormData({...formData, data_vencimento:e.target.value})} />
                <InputDark label="Valor (R$)" type="number" step="0.01" className="font-bold text-lg text-blue-400" value={formData.valor_previsto} onChange={(e:any)=>setFormData({...formData, valor_previsto:e.target.value})} />
              </div>

              {/* PAGAMENTO (CHECKBOX + CAMPOS) */}
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center gap-3 cursor-pointer select-none mb-3">
                  <input type="checkbox" className="w-5 h-5 rounded border-slate-600 bg-slate-800 accent-blue-600" checked={formData.status==='PAGO'} onChange={e=>setFormData({...formData, status:e.target.checked?'PAGO':'PENDENTE'})}/>
                  <span className="text-sm font-bold text-white">Já foi pago/recebido?</span>
                </label>
                {formData.status==='PAGO' && (
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <InputDark label="Data da Baixa" type="date" value={formData.data_pagamento} onChange={(e:any)=>setFormData({...formData, data_pagamento:e.target.value})} />
                    <InputDark label="Valor Pago (R$)" type="number" step="0.01" className="text-emerald-400 font-bold" value={formData.valor_pago} onChange={(e:any)=>setFormData({...formData, valor_pago:e.target.value})} />
                  </div>
                )}
              </div>

              {/* CATEGORIA E ENTIDADE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchableSelect label="Categoria" placeholder="Selecione..." options={catOptions} value={formData.plano_contas_id} onChange={(id:any)=>{
                   const cat = categorias.find(c=>String(c.id)===String(id));
                   setFormData({...formData, plano_contas_id:id, tipo: cat?.tipo==='R'?'RECEITA':'DESPESA'});
                }} />
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Entidade</label>
                    <button onClick={()=>setShowEntityDrawer(true)} className="text-[10px] text-blue-400 font-bold hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3"/> Nova</button>
                  </div>
                  <select className="w-full p-3 rounded-lg border border-slate-600 bg-slate-800 text-white outline-none focus:border-blue-500 text-sm" value={formData.entidade_id} onChange={e=>{
                    const eid = e.target.value;
                    const last = lancamentos.find(l=>String(l.entidade_id)===eid);
                    setFormData(prev => ({...prev, entidade_id:eid, plano_contas_id: last ? last.plano_contas_id : prev.plano_contas_id, tipo: last ? last.tipo : prev.tipo}));
                  }}>
                    <option value="">Selecione...</option>
                    {entidades.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* SELEÇÃO DE ORIGEM (CARDS AZUIS ESCUROS) */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Origem do Recurso</label>
                
                {/* Filtro Centro Custo */}
                <div className="mb-3">
                    <select className="w-full p-2 text-xs rounded border border-slate-600 bg-slate-800 text-slate-300 outline-none" value={formData.centro_custo_id} onChange={e=>setFormData({...formData, centro_custo_id:e.target.value})}>
                        <option value="">Todos os Centros de Custo</option>
                        {centros.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                </div>

                <div className="border border-slate-700 rounded-xl p-3 bg-slate-800/30 space-y-4">
                  {/* CONTAS */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Wallet className="w-3 h-3"/> Contas Bancárias</p>
                    <div className="grid grid-cols-2 gap-2">
                      {contas.filter(c=>!formData.centro_custo_id || String(c.centro_custo_id)===String(formData.centro_custo_id)).map(c=>(
                        <div key={c.id} onClick={()=>setFormData({...formData, conta_id:c.id, cartao_id:''})} className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${formData.conta_id===c.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'}`}>
                          <div className={`p-1 rounded ${formData.conta_id===c.id?'bg-white/20':'bg-slate-700 text-emerald-400'}`}><Wallet className="w-3 h-3"/></div> {c.nome}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* CARTÕES */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><CreditCard className="w-3 h-3"/> Cartões de Crédito</p>
                    <div className="grid grid-cols-2 gap-2">
                      {cartoes.filter(c=>!formData.centro_custo_id || String(c.centro_custo_id)===String(formData.centro_custo_id)).map(c=>(
                        <div key={c.id} onClick={()=>setFormData({...formData, cartao_id:c.id, conta_id:''})} className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${formData.cartao_id===c.id ? 'bg-purple-600 text-white border-purple-500 shadow-md' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'}`}>
                          <div className={`p-1 rounded ${formData.cartao_id===c.id?'bg-white/20':'bg-slate-700 text-purple-400'}`}><CreditCard className="w-3 h-3"/></div> {c.nome_cartao}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ANEXOS */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>
                <div className="border-2 border-dashed border-slate-600 rounded-xl p-6 text-center hover:border-blue-500 relative cursor-pointer bg-slate-800/30 hover:bg-slate-800 transition">
                  <input type="file" multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e=>setFilesToUpload(e.target.files)}/>
                  <UploadCloud className="w-8 h-8 mx-auto text-slate-500 mb-2"/>
                  <p className="text-sm font-medium text-slate-400">Clique para selecionar arquivos</p>
                  {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} arquivos selecionados</p>}
                </div>
              </div>

            </div>
            <div className="p-4 border-t border-slate-700 bg-slate-800 flex justify-end gap-3">
              <button onClick={()=>setShowDrawer(false)} className="px-5 py-2.5 rounded-lg text-slate-400 font-bold hover:bg-slate-700 transition">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="px-8 py-2.5 rounded-lg text-white font-bold shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-50" style={{backgroundColor:primaryColor}}>{saving?<Loader2 className="animate-spin w-4 h-4"/>:<Check className="w-4 h-4"/>} Salvar</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}