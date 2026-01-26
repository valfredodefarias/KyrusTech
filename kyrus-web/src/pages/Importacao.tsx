import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { 
  UploadCloud, ArrowRight, CheckCircle, AlertTriangle, 
  FileSpreadsheet, Database, Save, ArrowLeft, Loader2, Download,
  Plus, Check, X, Wallet, Users, Layers, Tag, Eye, EyeOff, 
  TrendingUp, TrendingDown, Edit2, Trash2, Search, ChevronDown
} from 'lucide-react';

// --- INTERFACES ---
interface ItemSistema { id: number; nome: string; tipo?: string; codigo?: string; } 

interface SistemaData {
  contas: ItemSistema[];
  categorias: ItemSistema[];
  centros: ItemSistema[];
  entidades: ItemSistema[];
}

interface Conflitos {
  contas: string[];
  categorias: string[];
  centros: string[];
  entidades: string[];
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
  details?: string[];
}

// --- COMPONENTES UI ---

const StepBadge = ({ num, current, label }: { num: number, current: number, label: string }) => {
    const active = num === current;
    const done = num < current;
    return (
        <div className={`flex items-center gap-2 ${active ? 'text-white' : done ? 'text-emerald-500' : 'text-slate-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${active ? 'border-blue-500 bg-blue-500 text-white' : done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-600 bg-slate-800'}`}>
                {done ? <Check className="w-4 h-4"/> : num}
            </div>
            <span className="text-sm font-bold hidden sm:block">{label}</span>
            {num < 4 && <div className={`h-0.5 w-8 ${done ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>}
        </div>
    );
};

// --- NOVO COMPONENTE: SELECT PESQUISÁVEL ---
const SearchableSelect = ({ value, options, onChange, placeholder = "Selecione..." }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Encontra o item selecionado para exibir o nome
    const selectedItem = options.find((opt: any) => String(opt.id) === String(value));

    // Fecha ao clicar fora
    useEffect(() => {
        function handleClickOutside(event: any) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                // Se fechou e não selecionou nada, limpa a busca ou reseta para o selecionado
                if (!value) setSearch(''); 
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [value]);

    // Ao abrir, foca e limpa busca se quiser, ou mantém. 
    // Aqui optamos por: se tem valor, a busca inicial é o nome dele.
    useEffect(() => {
        if (selectedItem) setSearch(selectedItem.nome);
        else setSearch('');
    }, [selectedItem, isOpen]);

    const filteredOptions = options.filter((opt: any) => 
        (opt.nome || '').toLowerCase().includes(search.toLowerCase()) ||
        (opt.codigo || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div 
                className={`flex items-center justify-between w-full p-3 rounded-lg border bg-slate-800 text-white text-sm cursor-pointer transition
                ${isOpen ? 'ring-2 ring-blue-500 border-transparent' : !value ? 'border-red-500/30' : 'border-slate-600 hover:border-slate-500'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? (
                    <input 
                        autoFocus
                        className="bg-transparent outline-none w-full text-white placeholder-slate-500"
                        placeholder="Digite para buscar..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()} // Evita fechar ao clicar no input
                    />
                ) : (
                    <span className={`truncate ${!selectedItem ? 'text-slate-500' : ''}`}>
                        {selectedItem ? (selectedItem.codigo ? `${selectedItem.codigo} - ${selectedItem.nome}` : selectedItem.nome) : placeholder}
                    </span>
                )}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}/>
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95">
                    {filteredOptions.length === 0 ? (
                        <div className="p-3 text-slate-500 text-center text-xs italic">Nenhum item encontrado.</div>
                    ) : (
                        filteredOptions.map((opt: any) => (
                            <div 
                                key={opt.id}
                                className={`p-3 text-sm cursor-pointer hover:bg-blue-600 hover:text-white transition flex justify-between items-center
                                    ${String(opt.id) === String(value) ? 'bg-blue-500/20 text-blue-200' : 'text-slate-300'}`}
                                onClick={() => {
                                    onChange(opt.id);
                                    setIsOpen(false);
                                    setSearch(opt.nome);
                                }}
                            >
                                <span>{opt.codigo ? <span className="font-mono opacity-70 mr-2">{opt.codigo}</span> : ''}{opt.nome}</span>
                                {String(opt.id) === String(value) && <Check className="w-4 h-4"/>}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

// --- GERENCIADOR DE PLANO DE CONTAS (CRUD) ---
const PlanoContasManager = ({ categorias, onRefresh }: { categorias: ItemSistema[], onRefresh: () => void }) => {
    const [isOpen, setIsOpen] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [loadingParams, setLoadingParams] = useState(false);
    const [formData, setFormData] = useState({ id: 0, nome: '', codigo: '', tipo: 'D' });

    // Filtros e Ordenação
    const isReceita = (c: ItemSistema) => {
        const tipo = c.tipo ? c.tipo.toUpperCase().trim() : '';
        const codigo = c.codigo ? c.codigo.toString().trim() : '';
        const nome = c.nome ? c.nome.trim() : '';
        return tipo === 'R' || tipo === 'RECEITA' || codigo.startsWith('1') || nome.startsWith('1.');
    };

    const isDespesa = (c: ItemSistema) => {
        const tipo = c.tipo ? c.tipo.toUpperCase().trim() : '';
        const codigo = c.codigo ? c.codigo.toString().trim() : '';
        const nome = c.nome ? c.nome.trim() : '';
        return tipo === 'D' || tipo === 'DESPESA' || codigo.startsWith('2') || nome.startsWith('2.');
    };

    const sorter = (a: ItemSistema, b: ItemSistema) => {
        if (a.codigo && b.codigo) return a.codigo.localeCompare(b.codigo, undefined, { numeric: true });
        return a.nome.localeCompare(b.nome);
    };

    const receitas = categorias.filter(isReceita).sort(sorter);
    const despesas = categorias.filter(isDespesa).sort(sorter);

    function handleOpenCreate(tipo: 'R' | 'D') {
        setIsEditing(false);
        setFormData({ id: 0, nome: '', codigo: tipo === 'R' ? '1.' : '2.', tipo });
        setModalOpen(true);
    }

    function handleOpenEdit(item: ItemSistema) {
        setIsEditing(true);
        let tipo = item.tipo || 'D';
        if (!item.tipo && item.codigo?.startsWith('1')) tipo = 'R';
        setFormData({ id: item.id, nome: item.nome, codigo: item.codigo || '', tipo: tipo });
        setModalOpen(true);
    }

    async function handleSave() {
        if (!formData.nome) return alert("O nome é obrigatório");
        setLoadingParams(true);
        try {
            if (isEditing) {
                await api.patch(`/plano-contas/${formData.id}`, { nome: formData.nome, codigo: formData.codigo, tipo: formData.tipo });
            } else {
                await api.post('/plano-contas/', { nome: formData.nome, codigo: formData.codigo, tipo: formData.tipo, permite_lancamentos: true });
            }
            setModalOpen(false);
            onRefresh();
        } catch (error) { console.error(error); alert("Erro ao salvar categoria."); } finally { setLoadingParams(false); }
    }

    async function handleDelete(id: number, nome: string) {
        if (!confirm(`Tem certeza que deseja excluir "${nome}"?`)) return;
        try { await api.delete(`/plano-contas/${id}`); onRefresh(); } catch (error) { alert("Erro ao excluir."); }
    }

    const renderItem = (item: ItemSistema, colorClass: string) => (
        <div key={item.id} className="group text-xs text-slate-300 bg-slate-800 px-3 py-2 rounded border border-slate-700/50 flex justify-between items-center hover:border-slate-500 transition-colors">
            <span className="font-medium flex gap-2 overflow-hidden text-ellipsis whitespace-nowrap items-center">
                {item.codigo && <span className={`font-mono font-bold ${colorClass}`}>{item.codigo}</span>}
                {item.nome}
            </span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleOpenEdit(item)} className="p-1 hover:bg-blue-500/20 rounded text-blue-400"><Edit2 className="w-3 h-3"/></button>
                <button onClick={() => handleDelete(item.id, item.nome)} className="p-1 hover:bg-red-500/20 rounded text-red-400"><Trash2 className="w-3 h-3"/></button>
            </div>
        </div>
    );

    return (
        <div className="border border-slate-700 rounded-xl bg-slate-800 overflow-hidden mb-8 shadow-md">
            <div className="flex justify-between items-center bg-slate-800 p-4 border-b border-slate-700">
                <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-3 text-left outline-none flex-1 hover:opacity-80 transition">
                    <div className="p-2 bg-slate-700 rounded-lg text-blue-400"><Database className="w-5 h-5"/></div>
                    <div><span className="font-bold text-slate-200 block text-sm">Gerenciar Plano de Contas</span><span className="text-xs text-slate-500">{categorias.length} categorias cadastradas</span></div>
                </button>
                <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? <EyeOff className="w-5 h-5 text-slate-500"/> : <Eye className="w-5 h-5 text-slate-500"/>}</button>
            </div>
            {isOpen && (
                <div className="p-5 bg-slate-900/50 grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-top-2">
                    <div>
                        <div className="flex justify-between items-center mb-3 border-b border-slate-700 pb-2"><h4 className="text-xs font-bold text-emerald-400 uppercase flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Receitas ({receitas.length})</h4><button onClick={() => handleOpenCreate('R')} className="text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 px-2 py-1 rounded font-bold flex items-center gap-1 transition"><Plus className="w-3 h-3"/> Nova</button></div>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1 pr-2">{receitas.length === 0 && <p className="text-slate-500 text-xs italic">Nenhuma receita encontrada.</p>}{receitas.map(r => renderItem(r, 'text-emerald-500'))}</div>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-3 border-b border-slate-700 pb-2"><h4 className="text-xs font-bold text-red-400 uppercase flex items-center gap-2"><TrendingDown className="w-4 h-4"/> Despesas ({despesas.length})</h4><button onClick={() => handleOpenCreate('D')} className="text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20 px-2 py-1 rounded font-bold flex items-center gap-1 transition"><Plus className="w-3 h-3"/> Nova</button></div>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1 pr-2">{despesas.length === 0 && <p className="text-slate-500 text-xs italic">Nenhuma despesa encontrada.</p>}{despesas.map(d => renderItem(d, 'text-red-500'))}</div>
                    </div>
                </div>
            )}
            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in">
                        <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-white flex items-center gap-2">{isEditing ? <Edit2 className="w-5 h-5 text-blue-500"/> : <Plus className="w-5 h-5 text-emerald-500"/>}{isEditing ? 'Editar Categoria' : 'Nova Categoria'}</h3><button onClick={() => setModalOpen(false)}><X className="w-5 h-5 text-slate-500 hover:text-white"/></button></div>
                        <div className="space-y-4">
                            <div><label className="text-xs font-bold text-slate-400 uppercase">Nome</label><input autoFocus type="text" className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white mt-1 outline-none focus:border-blue-500 transition" value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="text-xs font-bold text-slate-400 uppercase">Código</label><input type="text" placeholder="Ex: 1.01" className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white mt-1 outline-none focus:border-blue-500 transition font-mono" value={formData.codigo} onChange={e => setFormData({...formData, codigo: e.target.value})} /></div>
                                <div><label className="text-xs font-bold text-slate-400 uppercase">Tipo</label><select className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white mt-1 outline-none focus:border-blue-500" value={formData.tipo} onChange={e => setFormData({...formData, tipo: e.target.value})}><option value="R">Receita</option><option value="D">Despesa</option></select></div>
                            </div>
                            <div className="flex gap-2 justify-end mt-4 pt-4 border-t border-slate-700"><button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition">Cancelar</button><button onClick={handleSave} disabled={loadingParams} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex gap-2 items-center transition shadow-lg">{loadingParams ? <Loader2 className="animate-spin w-4 h-4"/> : <Save className="w-4 h-4"/>} Salvar</button></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- MAPPING ROW ATUALIZADO ---
const MappingRow = ({ label, original, value, options, onChange, onCreate, typeLabel, icon: Icon }: any) => (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center animate-in fade-in group hover:border-slate-600 transition">
        <div className="flex-1 w-full min-w-0">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1 group-hover:text-slate-400 transition">
                <FileSpreadsheet className="w-3 h-3"/> No Arquivo
            </p>
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-mono text-sm truncate" title={original}>
                {original}
            </div>
        </div>
        <ArrowRight className="text-slate-600 hidden md:block w-5 h-5 shrink-0" />
        <div className="flex-1 w-full min-w-0">
            <div className="flex justify-between items-center mb-1">
                <p className="text-[10px] text-blue-500 uppercase font-bold flex items-center gap-1 group-hover:text-blue-400 transition">
                    <Icon className="w-3 h-3"/> No Sistema
                </p>
                <button onClick={onCreate} className="text-[10px] bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-400 px-2 py-0.5 rounded font-bold flex items-center gap-1 transition">
                    <Plus className="w-3 h-3"/> Criar {typeLabel}
                </button>
            </div>
            {/* NOVO SEARCHABLE SELECT AQUI */}
            <SearchableSelect 
                value={value} 
                options={options} 
                onChange={onChange} 
                placeholder={`Selecione ou Crie ${typeLabel}`}
            />
        </div>
    </div>
);

// --- PÁGINA PRINCIPAL ---

export function Importacao() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sistemaData, setSistemaData] = useState<SistemaData>({ contas: [], categorias: [], centros: [], entidades: [] });
  const [conflitos, setConflitos] = useState<Conflitos>({ contas: [], categorias: [], centros: [], entidades: [] });
  const [mapCategorias, setMapCategorias] = useState<Record<string, string>>({});
  const [mapContas, setMapContas] = useState<Record<string, string>>({});
  const [mapCentros, setMapCentros] = useState<Record<string, string>>({});
  const [mapEntidades, setMapEntidades] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'CATEGORIA'|'ENTIDADE'|'CONTA'|'CENTRO' | null>(null);
  const [modalValue, setModalValue] = useState('');
  const [modalPendingKey, setModalPendingKey] = useState(''); 
  const [primaryColor, setPrimaryColor] = useState('#2563eb'); 

  useEffect(() => {
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
    if(cor) setPrimaryColor(cor);
    carregarDadosIniciais();
  }, []);

  async function carregarDadosIniciais() {
    try {
      const [rContas, rCats, rCentros, rEnt] = await Promise.all([
          api.get('/contas/'), api.get('/plano-contas/'), api.get('/centro-custo/'), api.get('/entidades/')
      ]);
      setSistemaData({ contas: rContas.data || [], categorias: rCats.data || [], centros: rCentros.data || [], entidades: rEnt.data || [] });
    } catch (error) { console.error("Erro dados iniciais", error); setFeedback({ type: 'error', message: 'Falha ao carregar dados.' }); }
  }

  async function handleDownloadModelo() {
    try {
        const response = await api.get('/lancamentos/importar/modelo', { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url; link.setAttribute('download', 'modelo_kyrus.xlsx');
        document.body.appendChild(link); link.click(); link.parentNode?.removeChild(link); window.URL.revokeObjectURL(url);
    } catch (error) { setFeedback({ type: 'error', message: 'Erro ao baixar o modelo.' }); }
  }

  async function handleAnalise() {
    if (!file) return;
    setLoading(true); setFeedback(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post('/lancamentos/importar/analisar', fd);
      setConflitos({ ...data.conflitos, entidades: data.conflitos.entidades || [] });
      if (data.sistema) setSistemaData(prev => ({...prev, ...data.sistema}));
      setStep(2);
    } catch (e: any) { setFeedback({ type: 'error', message: e.response?.data?.detail || "Erro ao analisar arquivo." }); } finally { setLoading(false); }
  }

  async function handleQuickCreate() {
      if(!modalValue) return;
      setLoading(true);
      try {
          let res; let newItem;
          if(modalType === 'CATEGORIA') {
              const tipo = modalValue.startsWith('1') ? 'R' : 'D';
              res = await api.post('/plano-contas/', { nome: modalValue, tipo: tipo }); 
              newItem = res.data;
              setSistemaData(prev => ({...prev, categorias: [...prev.categorias, newItem]}));
              setMapCategorias(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'ENTIDADE') {
              res = await api.post('/entidades/', { nome: modalValue, tipo: 'AMBOS' });
              newItem = res.data;
              setSistemaData(prev => ({...prev, entidades: [...prev.entidades, newItem]}));
              setMapEntidades(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'CONTA') {
              res = await api.post('/contas/', { nome: modalValue, tipo: 'CORRENTE' });
              newItem = res.data;
              setSistemaData(prev => ({...prev, contas: [...prev.contas, newItem]}));
              setMapContas(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'CENTRO') {
              res = await api.post('/centro-custo/', { nome: modalValue });
              newItem = res.data;
              setSistemaData(prev => ({...prev, centros: [...prev.centros, newItem]}));
              setMapCentros(prev => ({...prev, [modalPendingKey]: newItem.id}));
          }
          setModalOpen(false); setModalValue('');
      } catch(e) { alert("Erro ao criar item."); } finally { setLoading(false); }
  }

  function openCreateModal(type: any, excelKey: string) {
      setModalType(type); setModalPendingKey(excelKey); setModalValue(excelKey); setModalOpen(true);
  }

  async function handleExecutar() {
      setLoading(true);
      const fd = new FormData(); fd.append('file', file!);
      fd.append('mapeamento_json', JSON.stringify({ map_categorias: mapCategorias, map_contas: mapContas, map_centros: mapCentros, map_entidades: mapEntidades }));
      try {
          const res = await api.post('/lancamentos/importar/executar', fd);
          setFeedback({ type: 'success', message: `${res.data.importados} lançamentos importados com sucesso!`, details: res.data.erros });
          setStep(1); setFile(null);
      } catch(e: any) { setFeedback({ type: 'error', message: e.response?.data?.detail || "Erro na importação." }); } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-y-auto custom-scrollbar p-6 pb-32">
      <div className="max-w-5xl mx-auto w-full mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
            <div><h1 className="text-2xl font-bold flex items-center gap-2 text-white"><UploadCloud className="w-8 h-8 text-blue-500" />Importação Inteligente</h1><p className="text-slate-400 mt-1">Concilie dados externos com seu sistema.</p></div>
            <div className="flex items-center gap-2 bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
                <StepBadge num={1} current={step} label="Upload" /><StepBadge num={2} current={step} label="Classificação" /><StepBadge num={3} current={step} label="Origem" /><StepBadge num={4} current={step} label="Conclusão" />
            </div>
        </div>
        {feedback && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 mb-6 animate-in slide-in-from-top-2 ${feedback.type === 'success' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300' : 'bg-red-900/20 border-red-800 text-red-300'}`}>
                {feedback.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0"/> : <AlertTriangle className="w-5 h-5 shrink-0"/>}
                <div className="flex-1"><strong className="block text-sm">{feedback.message}</strong>{feedback.details && <ul className="mt-2 list-disc list-inside text-xs opacity-80 max-h-32 overflow-y-auto custom-scrollbar">{feedback.details.map((d,i)=><li key={i}>{d}</li>)}</ul>}</div><button onClick={()=>setFeedback(null)}><X className="w-4 h-4 hover:text-white"/></button>
            </div>
        )}
        {step === 1 && (
            <div className="bg-slate-800 p-10 rounded-2xl border border-slate-700 flex flex-col items-center justify-center min-h-[400px] border-dashed relative hover:border-blue-500/50 transition-colors">
                <input type="file" accept=".xlsx,.xls" onChange={e=>setFile(e.target.files?.[0]||null)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
                <div className="text-center space-y-4 pointer-events-none">
                    <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse-slow"><FileSpreadsheet className="w-12 h-12 text-blue-500"/></div>
                    {file ? (<div className="animate-in fade-in zoom-in-95"><h3 className="text-2xl font-bold text-white mb-1">{file.name}</h3><p className="text-emerald-400 font-mono text-sm">{(file.size/1024).toFixed(1)} KB • Pronto para envio</p></div>) : (<div><h3 className="text-2xl font-bold text-white mb-2">Arraste ou clique para selecionar</h3><p className="text-slate-400">Suporta arquivos Excel (.xlsx, .xls)</p></div>)}
                </div>
                <div className="mt-10 z-20 flex gap-4">
                    <button onClick={handleDownloadModelo} className="px-5 py-2.5 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-700 hover:text-white font-bold flex gap-2 items-center transition"><Download className="w-4 h-4"/> Baixar Modelo</button>
                    <button onClick={handleAnalise} disabled={!file||loading} className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 flex gap-2 items-center disabled:opacity-50 disabled:cursor-not-allowed transition hover:scale-105 active:scale-95">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : <ArrowRight className="w-5 h-5"/>} Continuar</button>
                </div>
            </div>
        )}
        {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                <PlanoContasManager categorias={sistemaData.categorias} onRefresh={carregarDadosIniciais} />
                <div><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Tag className="text-blue-500"/> Categorias Encontradas ({conflitos.categorias.length})</h3>{conflitos.categorias.length === 0 && <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo! Todas as categorias do arquivo já existem.</div>}<div className="space-y-3">{conflitos.categorias.map(k => (<MappingRow key={k} original={k} value={mapCategorias[k]} options={sistemaData.categorias} onChange={(v:string)=>setMapCategorias(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CATEGORIA', k)} typeLabel="Categoria" icon={Tag} />))}</div></div>
                {conflitos.entidades && conflitos.entidades.length > 0 && (<div><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Users className="text-purple-500"/> Entidades Encontradas ({conflitos.entidades.length})</h3><div className="space-y-3">{conflitos.entidades.map(k => (<MappingRow key={k} original={k} value={mapEntidades[k]} options={sistemaData.entidades} onChange={(v:string)=>setMapEntidades(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('ENTIDADE', k)} typeLabel="Entidade" icon={Users} />))}</div></div>)}
                <div className="flex justify-between pt-6 border-t border-slate-800"><button onClick={()=>setStep(1)} className="px-6 py-3 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={()=>setStep(3)} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition">Próximo <ArrowRight className="w-4 h-4"/></button></div>
            </div>
        )}
        {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                <div><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Wallet className="text-emerald-500"/> Contas Bancárias ({conflitos.contas.length})</h3>{conflitos.contas.length === 0 && <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo com as contas.</div>}<div className="space-y-3">{conflitos.contas.map(k => (<MappingRow key={k} original={k} value={mapContas[k]} options={sistemaData.contas} onChange={(v:string)=>setMapContas(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CONTA', k)} typeLabel="Conta" icon={Wallet} />))}</div></div>
                <div><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Layers className="text-orange-500"/> Centros de Custo ({conflitos.centros.length})</h3><div className="space-y-3">{conflitos.centros.map(k => (<MappingRow key={k} original={k} value={mapCentros[k]} options={sistemaData.centros} onChange={(v:string)=>setMapCentros(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CENTRO', k)} typeLabel="Centro" icon={Layers} />))}</div></div>
                <div className="flex justify-between pt-6 border-t border-slate-800"><button onClick={()=>setStep(2)} className="px-6 py-3 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={handleExecutar} disabled={loading} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition disabled:opacity-50">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : <CheckCircle className="w-5 h-5"/>} Confirmar Importação</button></div>
            </div>
        )}
      </div>
      {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-blue-500"/> Criar {modalType}</h3>
                  <div className="space-y-4">
                      <div><label className="text-xs font-bold text-slate-400 uppercase">Nome</label><input autoFocus type="text" className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white mt-1 outline-none focus:border-blue-500 transition" value={modalValue} onChange={e=>setModalValue(e.target.value)} /></div>
                      <div className="flex gap-2 justify-end mt-4"><button onClick={()=>setModalOpen(false)} className="px-4 py-2 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition">Cancelar</button><button onClick={handleQuickCreate} disabled={loading} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex gap-2 items-center transition shadow-lg">{loading ? <Loader2 className="animate-spin w-4 h-4"/> : 'Criar'}</button></div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}