import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { 
  Plus, Search, Filter, RefreshCw, ChevronLeft, ChevronRight, 
  ArrowRightLeft, Wallet, CreditCard, Layers, Calendar, 
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2, 
  Trash2, Check, X, UploadCloud, FileText, Loader2, 
  CalendarClock, User, ChevronDown, Save, Paperclip, Download,
  Image as ImageIcon, FileSpreadsheet, Presentation, LayoutGrid, CheckSquare, Square
} from 'lucide-react';

// --- INTERFACES ---
interface Anexo { id: number; nome_arquivo: string; url: string; tipo: string; }
interface Lancamento {
  id: number; descricao: string; valor_previsto: number; valor_pago: number;
  data_vencimento: string; data_pagamento?: string; tipo: 'RECEITA' | 'DESPESA';
  competencia?: string; previsto?: boolean;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO'; ipp: boolean;
  plano_contas_id: number; entidade_id?: number; conta_id?: number;
  cartao_id?: number; centro_custo_id?: number; anexos: Anexo[];
  numero_parcela?: number;
}

// --- UTILS (CORREÇÃO DE DATA) ---
const fixDate = (dateString: string) => {
  if (!dateString) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDateExtenso = (dateString: string) => {
    if (!dateString) return '-';
    const date = fixDate(dateString);
  if (!date) return '-';
    return date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'long' });
};

const getTodayLocalYmd = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isLancamentoAtrasado = (l: Lancamento) => {
  if (String(l.status).toUpperCase() === 'PAGO') return false;
  if (!l.data_vencimento) return false;
  return l.data_vencimento < getTodayLocalYmd();
};

// --- COMPONENTES UI REUTILIZÁVEIS ---

// 1. MultiSelect Dropdown
const MultiSelectDropdown = ({ options, selectedIds, onChange, label, placeholder }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: any) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const toggleOption = (id: number) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        onChange(newSet);
    };

    const selectedLabel = selectedIds.size > 0 ? `${selectedIds.size} selecionados` : placeholder;

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>
            <div onClick={() => setIsOpen(!isOpen)} className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 cursor-pointer flex justify-between items-center text-sm hover:border-blue-500 transition shadow-sm">
                <span className={selectedIds.size > 0 ? 'text-blue-400 font-bold' : 'text-slate-500'}>{selectedLabel}</span>
                <ChevronDown className="w-4 h-4 text-slate-400"/>
            </div>
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl shadow-2xl max-h-96 overflow-y-auto custom-scrollbar p-1 animate-in fade-in zoom-in-95">
                    {options.map((opt: any) => {
                      const isDisabled = opt.disabled || opt.eh_cabecalho || opt.permite_lancamentos === false;
                      const tipo = String(opt.tipo || opt.grupo || opt.label || opt.nome || '').toUpperCase();
                      const colorClass = tipo.startsWith('D') ? 'text-red-400' : tipo.startsWith('R') ? 'text-emerald-400' : '';
                      const isSelected = selectedIds.has(opt.id);
                      return (
                        <div
                          key={opt.id}
                          onClick={() => { if (!isDisabled) toggleOption(opt.id); }}
                          className={`px-3 py-2 text-sm rounded transition flex items-center justify-between ${isSelected ? 'bg-blue-600/20 text-blue-600 dark:text-blue-300' : `text-slate-600 dark:text-slate-300 ${colorClass}`} ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          <span>{opt.nome || opt.label}</span>
                          {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400"/> : <Square className="w-4 h-4 text-slate-600"/>}
                        </div>
                      );
                    })}
                </div>
            )}
        </div>
    );
};

const SearchableSelect = ({ options, value, onChange, placeholder, label }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.flatMap((g:any) => g.options).find((o:any) => String(o.id) === String(value));
  const selectedTipo = String(selectedOption?.tipo || selectedOption?.grupo || '').toUpperCase();
  const selectedColorClass = !selectedOption
    ? 'text-slate-500'
    : selectedTipo.startsWith('D')
      ? 'text-red-600 dark:text-red-400 font-medium'
      : selectedTipo.startsWith('R')
        ? 'text-emerald-600 dark:text-emerald-400 font-medium'
        : 'text-slate-800 dark:text-white font-medium';

  useEffect(() => {
    function handleClickOutside(event: any) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredGroups = options.map((group: any) => ({
    ...group,
    options: group.options.filter((opt: any) => opt.label.toLowerCase().includes(search.toLowerCase()))
  })).filter((group: any) => group.options.length > 0);

  return (
    <div className="relative" ref={wrapperRef}>
      {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-11.5 hover:border-blue-500 transition shadow-sm"
      >
        <span className={selectedColorClass}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400"/>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl shadow-2xl max-h-96 flex flex-col animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 rounded-t-xl">
            <input 
              autoFocus
              type="text" 
              placeholder="Pesquisar..." 
              className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none text-slate-700 dark:text-white focus:border-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-y-auto custom-scrollbar p-1">
            {filteredGroups.map((group: any, idx: number) => (
              <div key={idx} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] font-bold text-blue-300 uppercase tracking-wider bg-slate-700/30 rounded mb-1 pointer-events-none select-none">
                  {group.label}
                </div>
                {group.options.map((opt: any) => (
                  (() => {
                    const isDisabled = opt.disabled || opt.eh_cabecalho || opt.permite_lancamentos === false;
                    const tipo = String(opt.tipo || opt.grupo || opt.label || '').toUpperCase();
                    const colorClass = tipo.startsWith('D') ? 'text-red-400' : tipo.startsWith('R') ? 'text-emerald-400' : '';
                    return (
                  <div 
                    key={opt.id}
                    onClick={() => { if (!isDisabled) { onChange(opt.id); setIsOpen(false); setSearch(''); } }}
                    className={`px-3 py-2 text-sm rounded transition flex items-center justify-between ${String(value) === String(opt.id) ? 'bg-blue-600 text-white' : `text-slate-600 dark:text-slate-300 ${colorClass}`} ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                  >
                    {opt.label}
                    {String(value) === String(opt.id) && <Check className="w-3 h-3"/>}
                  </div>
                    );
                  })()
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

const InputDark = (props: any) => (
  <div className="w-full">
    {props.label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{props.label}</label>}
    <input {...props} className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed ${props.className || ''}`} />
  </div>
);

const ToggleSimNao = ({
  label,
  value,
  onChange,
  yesLabel = 'Sim',
  noLabel = 'Não'
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">{label}</label>
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`py-2.5 rounded-lg text-sm font-bold border transition ${value ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`py-2.5 rounded-lg text-sm font-bold border transition ${!value ? 'bg-slate-700 dark:bg-slate-600 text-white border-slate-700 dark:border-slate-600 shadow' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
      >
        {noLabel}
      </button>
    </div>
  </div>
);

const buildExcludedCategoriaIds = (categorias: any[]) => {
  const filhosPorPai = new Map<number, number[]>();
  const excluidas = new Set<number>();

  categorias.forEach((cat: any) => {
    const catId = Number(cat.id);
    const parentId = Number(cat.conta_pai_id);
    if (Number.isFinite(parentId) && parentId > 0) {
      const filhos = filhosPorPai.get(parentId) || [];
      filhos.push(catId);
      filhosPorPai.set(parentId, filhos);
    }
    if (cat.considerar_nos_resultados === false) {
      excluidas.add(catId);
    }
  });

  const fila = Array.from(excluidas);
  while (fila.length > 0) {
    const atual = fila.shift()!;
    const filhos = filhosPorPai.get(atual) || [];
    filhos.forEach((filhoId) => {
      if (!excluidas.has(filhoId)) {
        excluidas.add(filhoId);
        fila.push(filhoId);
      }
    });
  }

  return excluidas;
};

export function Lancamentos() {
  // --- DADOS ---
  const [loading, setLoading] = useState(true);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [cartoes, setCartoes] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);

  // --- UI STATE ---
  const [mesAtual, setMesAtual] = useState(new Date());
  const [primaryColor, setPrimaryColor] = useState('#2563eb');
  
  // Filtros
  const [filtroTexto, setFiltroTexto] = useState('');
  const [centroCustoFiltro, setCentroCustoFiltro] = useState<string>('');
  
  const [filtrosAvancados, setFiltrosAvancados] = useState({
      tipo: 'TODOS' as 'TODOS'|'RECEITA'|'DESPESA',
      status: [] as string[],
      contaIds: new Set<number>(),
      categoriaIds: new Set<number>(),
      dataInicio: '',
      dataFim: ''
  });
  const [filtroRapido, setFiltroRapido] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [didFallbackAll, setDidFallbackAll] = useState(false);

  // Barra/ações em lote
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const todayISO = new Date().toISOString().split('T')[0];
  const yesterdayISO = new Date(Date.now() - 24*60*60*1000).toISOString().split('T')[0];
  const [bulkPayData, setBulkPayData] = useState({ conta_id: '', modoData: 'HOJE', data: todayISO });

  // --- MODAIS ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showEntityDrawer, setShowEntityDrawer] = useState(false); 
  
  // --- FORMS ---
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<FileList | null>(null);
  const [newEntityData, setNewEntityData] = useState({ nome: '', tipo: 'AMBOS' });

  const [formData, setFormData] = useState<any>({
    id: null, descricao: '', valor_previsto: '', data_vencimento: '',
    tipo: 'DESPESA', plano_contas_id: '', centro_custo_id: '', entidade_id: '',
    conta_id: '', cartao_id: '', status: 'PENDENTE', 
    valor_pago: '', data_pagamento: '', ipp: false, previsto: true, competencia: '',
    is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL', anexos: []
  });

  const [transferData, setTransferData] = useState({
    valor: '', data: new Date().toISOString().split('T')[0], 
    conta_origem_id: '', conta_destino_id: '', observacao: '',
    plano_contas_id: '', centro_custo_id: ''
  });

  const auxLoadedRef = useRef(false);
  const lancamentosAbortRef = useRef<AbortController | null>(null);
  const lastLancamentosKeyRef = useRef<string>('');
  const autoPagamentoRef = useRef(true);
  const autoCompetenciaRef = useRef(true);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const formatDateYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const formatCompetencia = (ymd?: string) => {
    if (!ymd) return '';
    const [y, m] = ymd.split('-');
    if (!y || !m) return '';
    return `${m}-${y}`;
  };

  const computeCartaoVencimento = (purchaseDate?: string, cartaoId?: string) => {
    if (!purchaseDate || !cartaoId) return null;
    const cartao = cartoes.find(c => String(c.id) === String(cartaoId));
    if (!cartao) return null;
    const [y, m, d] = purchaseDate.split('-').map(Number);
    if (!y || !m || !d) return null;

    const fechamento = Number(cartao.dia_fechamento || 1);
    const venc = Number(cartao.dia_vencimento || 10);
    const statementOffset = d > fechamento ? 1 : 0;
    const dueOffset = statementOffset + (venc <= fechamento ? 1 : 0);
    const monthIndex = (m - 1) + dueOffset;
    const daysInMonth = new Date(y, monthIndex + 1, 0).getDate();
    const day = Math.min(venc, daysInMonth);
    return formatDateYMD(new Date(y, monthIndex, day));
  };

  // --- INIT ---
  useEffect(() => {
    const cor = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
    if(cor) setPrimaryColor(cor);
    loadAuxData();
  }, []);

  useEffect(() => { 
    if(!filtrosAvancados.dataInicio && !filtrosAvancados.dataFim) {
        const ano = mesAtual.getFullYear(); const mes = mesAtual.getMonth() + 1;
        const ini = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
        const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
        loadLancamentos(ini, fim);
    } else {
        loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim);
    }
  }, [mesAtual, filtrosAvancados.dataInicio, filtrosAvancados.dataFim]);

  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setCentroCustoFiltro(prev => prev || onlyId);
      setFormData((prev: typeof formData) => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
      setTransferData(prev => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
    }
  }, [centros]);

  async function loadAuxData() {
    if (auxLoadedRef.current) return;
    try {
      const [rC, rCt, rCC, rE, rCat] = await Promise.all([
        api.get('/contas/', { params: { include_saldo: false } }),
        api.get('/cartoes/'),
        api.get('/centro-custo/'),
        fetchEntidadesLookup(),
        fetchPlanoContas()
      ]);
      setContas(rC.data); setCartoes(rCt.data); setCentros(rCC.data); setEntidades(rE); setCategorias(rCat);
      auxLoadedRef.current = true;
    } catch(e) { console.error(e); }
  }

  async function syncCadastros() {
    try {
      const [rE, rCat] = await Promise.all([
        fetchEntidadesLookup(true),
        fetchPlanoContas(true)
      ]);
      setEntidades(rE);
      setCategorias(rCat);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadLancamentos(ini?: string, fim?: string, opts?: { force?: boolean; skipFallback?: boolean }) {
    const key = `${ini || ''}|${fim || ''}`;
    if (!opts?.force && key === lastLancamentosKeyRef.current && lancamentos.length > 0) return;
    lastLancamentosKeyRef.current = key;

    if (lancamentosAbortRef.current) {
      lancamentosAbortRef.current.abort();
    }
    const controller = new AbortController();
    lancamentosAbortRef.current = controller;

    setLoading(true);
    try {
      const params: any = { limit: 5000 }; 
      if(ini) params.data_inicio = ini;
      if(fim) params.data_fim = fim;
      const res = await api.get('/lancamentos/', { params, signal: controller.signal });
      setLancamentos(res.data);

      const isEmpty = !res.data || res.data.length === 0;
      if (!opts?.skipFallback && !opts?.force && isEmpty && ini && fim && !didFallbackAll && !filtroTexto && !filtroRapido && !centroCustoFiltro && filtrosAvancados.status.length === 0 && filtrosAvancados.contaIds.size === 0 && filtrosAvancados.categoriaIds.size === 0) {
        setDidFallbackAll(true);
        await loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
      }
    } catch(e: any) {
      if (e?.code === 'ERR_CANCELED') return;
      console.error(e);
    } finally {
      if (lancamentosAbortRef.current === controller) {
        lancamentosAbortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function toggleIpp(l: Lancamento) {
    const next = !l.ipp;
    // Otimista: atualiza na hora
    setLancamentos(prev => prev.map(item => item.id === l.id ? { ...item, ipp: next } : item));
    try {
      await api.put(`/lancamentos/${l.id}`, { ipp: next });
    } catch (e) {
      console.error(e);
      // Reverte se falhar
      setLancamentos(prev => prev.map(item => item.id === l.id ? { ...item, ipp: l.ipp } : item));
      alert('Não foi possível marcar/desmarcar IPP');
    }
  }

  async function handleBulkPay() {
    if (selectedIds.size === 0) return;
    if (!bulkPayData.conta_id) {
      alert('Selecione uma conta para baixar em lote');
      return;
    }
    setSaving(true);
    try {
      const payDate = bulkPayData.modoData === 'HOJE' ? todayISO : bulkPayData.modoData === 'ONTEM' ? yesterdayISO : bulkPayData.data;
      await api.post('/lancamentos/bulk-pay', {
        ids: Array.from(selectedIds),
        data_pagamento: payDate,
        conta_id: bulkPayData.conta_id ? parseInt(bulkPayData.conta_id) : null,
      });
      setShowBulkPay(false);
      setSelectedIds(new Set());
      loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao baixar em lote');
    } finally {
      setSaving(false);
    }
  }

  function openBulkDelete() {
    setDeleteStep(1);
    setDeletePhrase('');
    setDeleteReason('');
    setShowBulkDelete(true);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    try {
      await api.post('/lancamentos/bulk-delete', { ids: Array.from(selectedIds) });
      setShowBulkDelete(false);
      setSelectedIds(new Set());
      loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
    } catch (e) {
      console.error(e);
      alert('Erro ao apagar em lote');
    } finally {
      setSaving(false);
    }
  }

  // --- LOGICA FILTRO ---
  const filteredList = useMemo(() => {
    return lancamentos.filter(l => {
      // 1. Texto Global
      if (filtroTexto && !l.descricao.toLowerCase().includes(filtroTexto.toLowerCase()) && !String(l.valor_previsto).includes(filtroTexto)) return false;
      
      // 2. Centro de Custo (Header)
      if (centroCustoFiltro && String(l.centro_custo_id) !== centroCustoFiltro) return false;

      // 3. Filtros Rápidos
      const hoje = getTodayLocalYmd();
      if (filtroRapido === 'HOJE' && l.data_vencimento !== hoje) return false;
      if (filtroRapido === 'IPP' && !l.ipp) return false;
      if (filtroRapido === 'ATRASADO' && !isLancamentoAtrasado(l)) return false;
      if (filtroRapido === 'EM_ABERTO' && l.status === 'PAGO') return false;

      // 4. Filtros Avançados
      if (filtrosAvancados.tipo !== 'TODOS' && l.tipo !== filtrosAvancados.tipo) return false;
      if (filtrosAvancados.status.length > 0 && !filtrosAvancados.status.includes(l.status)) return false;
      
      // Filtro de Contas (Multi)
      if (filtrosAvancados.contaIds.size > 0 && (!l.conta_id || !filtrosAvancados.contaIds.has(l.conta_id))) return false;
      // Filtro de Categorias (Multi)
      if (filtrosAvancados.categoriaIds.size > 0 && !filtrosAvancados.categoriaIds.has(l.plano_contas_id)) return false;

      return true;
    });
  }, [lancamentos, filtroTexto, centroCustoFiltro, filtroRapido, filtrosAvancados]);

  const contasFiltradas = useMemo(() => {
    return contas.filter(c => !centroCustoFiltro || String(c.centro_custo_id) === String(centroCustoFiltro));
  }, [contas, centroCustoFiltro]);

  useEffect(() => {
    if (bulkPayData.conta_id && !contasFiltradas.some(c => String(c.id) === String(bulkPayData.conta_id))) {
      setBulkPayData(prev => ({ ...prev, conta_id: '' }));
    }
  }, [contasFiltradas, bulkPayData.conta_id]);

  // Agrupamento
  const { grouped, kpis } = useMemo(() => {
    const groups: Record<string, Lancamento[]> = {};
    let r = 0, d = 0;
    const categoriasExcluidasResultado = buildExcludedCategoriaIds(categorias);

    filteredList.forEach(l => {
      if (!groups[l.data_vencimento]) groups[l.data_vencimento] = [];
      groups[l.data_vencimento].push(l);
      const origem = String((l as any).origem || '').toUpperCase();
      const contaNosResultados = !categoriasExcluidasResultado.has(Number(l.plano_contas_id));
      if (origem !== 'TRANSFERENCIA' && contaNosResultados) {
        if (l.tipo === 'RECEITA') r += Number(l.valor_previsto);
        else d += Number(l.valor_previsto);
      }
    });

    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    sortedDates.forEach(date => groups[date].sort((a, b) => b.valor_previsto - a.valor_previsto));

    return { grouped: { groups, sortedDates }, kpis: { r, d, s: r-d } };
  }, [filteredList, categorias]);

  // --- ACTIONS ---

  const toggleConta = (id: number) => {
    setFormData((prev: any) => ({ ...prev, conta_id: prev.conta_id === id ? '' : id, cartao_id: '' }));
  };

  const toggleCartao = (id: number) => {
    setFormData((prev: any) => ({ ...prev, cartao_id: prev.cartao_id === id ? '' : id, conta_id: '' }));
  };

  const handleVencimentoChange = (value: string) => {
    setFormData((prev: any) => {
      const next = { ...prev, data_vencimento: value };
      const prevCompetencia = formatCompetencia(prev.data_vencimento);
      const nextCompetencia = formatCompetencia(value);
      if (autoCompetenciaRef.current || !prev.competencia || prev.competencia === prevCompetencia) {
        next.competencia = nextCompetencia;
        autoCompetenciaRef.current = true;
      }
      if (prev.status === 'PAGO' && (autoPagamentoRef.current || !prev.data_pagamento || prev.data_pagamento === prev.data_vencimento)) {
        next.data_pagamento = value;
        autoPagamentoRef.current = true;
      }
      return next;
    });
  };

  const handleCompetenciaChange = (value: string) => {
    autoCompetenciaRef.current = false;
    setFormData((prev: any) => ({ ...prev, competencia: value }));
  };

  const handleStatusPagoChange = (checked: boolean) => {
    setFormData((prev: any) => {
      const next = { ...prev, status: checked ? 'PAGO' : 'PENDENTE' };
      if (checked && (autoPagamentoRef.current || !prev.data_pagamento)) {
        next.data_pagamento = prev.data_vencimento;
        autoPagamentoRef.current = true;
      }
      return next;
    });
  };

  const handleDataPagamentoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, data_pagamento: value }));
  };
  
  function openDrawer(l?: Lancamento) {
    if(l) {
      setIsEditing(true);
      autoPagamentoRef.current = !l.data_pagamento;
      autoCompetenciaRef.current = !l.competencia;
      setFormData({
        ...l, 
        conta_id: l.conta_id||'', cartao_id: l.cartao_id||'', centro_custo_id: l.centro_custo_id||'', entidade_id: l.entidade_id||'',
        plano_contas_id: l.plano_contas_id, valor_previsto: l.valor_previsto, 
        valor_pago: l.valor_pago||l.valor_previsto, data_pagamento: l.data_pagamento||l.data_vencimento,
        previsto: l.previsto ?? true,
        competencia: l.competencia || formatCompetencia(l.data_vencimento)
      });
    } else {
      setIsEditing(false);
      autoPagamentoRef.current = true;
      autoCompetenciaRef.current = true;
      setFormData({
        id: null, descricao: '', valor_previsto: '', data_vencimento: new Date().toISOString().split('T')[0],
        tipo: 'DESPESA', plano_contas_id: '', 
        centro_custo_id: centroCustoFiltro || '', 
        entidade_id: '', conta_id: '', cartao_id: '',
        status: 'PENDENTE', valor_pago: '', data_pagamento: new Date().toISOString().split('T')[0], ipp: false, previsto: true,
        competencia: formatCompetencia(new Date().toISOString().split('T')[0]),
        is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL', anexos: []
      });
    }
    setFilesToUpload(null);
    setShowDrawer(true);
  }

  // --- FUNÇÃO RECUPERADA (FIX) ---
  async function handleCreateEntity() {
    if(!newEntityData.nome) return alert("Digite o nome");
    setSaving(true);
    try {
      const res = await api.post('/entidades/', {
          ...newEntityData,
          status: 'ATIVO'
      });
      setEntidades(prev => [...prev, res.data]);
      setFormData((prev:any) => ({...prev, entidade_id: res.data.id}));
      setShowEntityDrawer(false); 
      setNewEntityData({ nome: '', tipo: 'AMBOS' });
    } catch(e) { alert("Erro ao criar entidade"); } finally { setSaving(false); }
  }

  async function handleTransferencia() {
    if(!transferData.valor || !transferData.conta_origem_id || !transferData.conta_destino_id) return alert("Preencha campos obrigatórios.");
    setSaving(true);
    try {
        await api.post('/lancamentos/transferir', {
            ...transferData, 
            valor: parseFloat(transferData.valor),
            plano_contas_id: transferData.plano_contas_id ? parseInt(transferData.plano_contas_id) : null,
            centro_custo_id: transferData.centro_custo_id ? parseInt(transferData.centro_custo_id) : null
        });
        alert("Transferência realizada!");
        setShowTransfer(false);
        loadLancamentos(undefined, undefined, { force: true });
    } catch(e) { alert("Erro na transferência."); } finally { setSaving(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if(!formData.descricao || !formData.valor_previsto || !formData.plano_contas_id) return alert("Preencha campos obrigatórios");
    setSaving(true);
    try {
      const computedCardDue = formData.cartao_id ? computeCartaoVencimento(formData.data_vencimento, formData.cartao_id) : null;
      const dataCompetencia = formData.cartao_id ? formData.data_vencimento : undefined;
      const dataVencimento = computedCardDue || formData.data_vencimento;
      const payload = {
        ...formData,
        valor_previsto: parseFloat(formData.valor_previsto),
        plano_contas_id: parseInt(formData.plano_contas_id),
        centro_custo_id: formData.centro_custo_id ? parseInt(formData.centro_custo_id) : null,
        entidade_id: formData.entidade_id ? parseInt(formData.entidade_id) : null,
        conta_id: formData.conta_id ? parseInt(formData.conta_id) : null,
        cartao_id: formData.cartao_id ? parseInt(formData.cartao_id) : null,
        valor_pago: formData.status==='PAGO' ? parseFloat(formData.valor_pago || formData.valor_previsto) : 0,
        data_pagamento: formData.status==='PAGO' ? formData.data_pagamento : null,
        data_competencia: dataCompetencia,
        data_vencimento: dataVencimento,
        competencia: formData.competencia || formatCompetencia(dataVencimento),
        previsto: formData.previsto ?? true
      };

      let id = formData.id;
      if (formData.is_parcelado && !id) {
        const lista = [];
        const qtd = formData.qtd_parcelas;
        const [ano, mes, dia] = formData.data_vencimento.split('-').map(Number);
        let val = formData.modo_calculo === 'TOTAL' ? payload.valor_previsto/qtd : payload.valor_previsto;
        
        for(let i=0; i<qtd; i++) {
          const dt = new Date(ano, (mes-1)+i, dia);
          lista.push({
            ...payload, valor_previsto: val, data_vencimento: dt.toISOString().split('T')[0],
            competencia: formatCompetencia(dt.toISOString().split('T')[0]),
            descricao: `${payload.descricao} (${i+1}/${qtd})`, numero_parcela: i+1,
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
      setShowDrawer(false); 
      // Recarrega inteligente
      if(filtrosAvancados.dataInicio) loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
      else { const ano = mesAtual.getFullYear(); const mes = mesAtual.getMonth() + 1; loadLancamentos(new Date(ano, mes-1, 1).toISOString().split('T')[0], new Date(ano, mes, 0).toISOString().split('T')[0], { force: true }); }
    } catch(e) { alert("Erro ao salvar"); } finally { setSaving(false); }
  }

  // --- RENDER HELPERS ---
  const getFileIcon = (nome: string) => {
      const ext = nome.split('.').pop()?.toLowerCase();
      if(['jpg','jpeg','png'].includes(ext||'')) return <ImageIcon className="w-4 h-4 text-purple-400"/>;
      if(['xls','xlsx','csv'].includes(ext||'')) return <FileSpreadsheet className="w-4 h-4 text-emerald-400"/>;
      if(['ppt','pptx'].includes(ext||'')) return <Presentation className="w-4 h-4 text-orange-400"/>;
      return <FileText className="w-4 h-4 text-blue-400"/>;
  };

  // Normaliza o tipo da categoria para primeira letra (R/D) para lidar com dados "Receita/Despesa"
  const catOptions = [
    { label: 'DESPESAS', options: categorias.filter(c=> (c.tipo||'').trim().toUpperCase().startsWith('D')).map(c=>({id:c.id, label:c.nome, tipo: c.tipo, grupo: 'DESPESAS', disabled: c.eh_cabecalho || c.permite_lancamentos === false, eh_cabecalho: c.eh_cabecalho, permite_lancamentos: c.permite_lancamentos})) },
    { label: 'RECEITAS', options: categorias.filter(c=> (c.tipo||'').trim().toUpperCase().startsWith('R')).map(c=>({id:c.id, label:c.nome, tipo: c.tipo, grupo: 'RECEITAS', disabled: c.eh_cabecalho || c.permite_lancamentos === false, eh_cabecalho: c.eh_cabecalho, permite_lancamentos: c.permite_lancamentos})) }
  ];

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-hidden relative">
      
      {/* 1. TOP HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 z-20 shadow-md">
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 shadow-inner border border-slate-200 dark:border-transparent">
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()-1)))} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"><ChevronLeft className="w-4 h-4"/></button>
            <span className="w-32 text-center text-xs font-bold uppercase pt-1 text-slate-800 dark:text-white">{mesAtual.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</span>
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()+1)))} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"><ChevronRight className="w-4 h-4"/></button>
          </div>
          <button onClick={()=>loadLancamentos(undefined, undefined, { force: true })} className="p-2 text-slate-500 hover:text-blue-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-blue-500 transition-colors" title="Sincronizar lançamentos"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/></button>
          <button onClick={syncCadastros} className="p-2 text-slate-500 hover:text-emerald-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-emerald-500 transition-colors" title="Sincronizar cadastros"><Layers className="w-4 h-4"/></button>
        </div>

        <div className="flex-1 w-full flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500"/>
                <input type="text" placeholder="Pesquisar..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none transition" value={filtroTexto} onChange={e=>setFiltroTexto(e.target.value)}/>
            </div>
            <div className="w-full sm:w-48">
                <select className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white outline-none focus:border-blue-500" value={centroCustoFiltro} onChange={e=>setCentroCustoFiltro(e.target.value)}>
                    <option value="">Todos Centros</option>
                    {centros.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
            </div>
        </div>

        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
          <button onClick={()=>setShowTransfer(true)} className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-600 dark:text-slate-300 transition-all w-full sm:w-auto justify-center"><ArrowRightLeft className="w-4 h-4"/> <span className="hidden lg:inline">Transf.</span></button>
          <button onClick={()=>setShowFiltrosSidebar(true)} className={`px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-bold flex items-center gap-2 transition-all w-full sm:w-auto justify-center ${showFiltrosSidebar ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}><Filter className="w-4 h-4"/> <span className="hidden lg:inline">Filtros</span></button>
          <button onClick={()=>openDrawer()} className="px-5 py-2 rounded-lg shadow-lg text-white font-bold text-sm flex gap-2 hover:brightness-110 transition bg-blue-600 hover:bg-blue-500 w-full sm:w-auto justify-center"><Plus className="w-4 h-4"/> Novo</button>
        </div>
      </header>

      {/* 2. KPI SECTION */}
      <div className="px-4 sm:px-6 pt-6 pb-2 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition hover:border-slate-300 dark:hover:border-slate-600"><div className="text-emerald-600 dark:text-emerald-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Receitas</p><p className="text-2xl font-black">{BRL.format(kpis.r)}</p></div><div className="p-2 bg-emerald-500/10 dark:bg-emerald-900/20 rounded-lg"><TrendingUp className="text-emerald-600 dark:text-emerald-400 w-6 h-6"/></div></div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition hover:border-slate-300 dark:hover:border-slate-600"><div className="text-red-600 dark:text-red-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Despesas</p><p className="text-2xl font-black">{BRL.format(kpis.d)}</p></div><div className="p-2 bg-red-500/10 dark:bg-red-900/20 rounded-lg"><TrendingDown className="text-red-600 dark:text-red-400 w-6 h-6"/></div></div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition hover:border-slate-300 dark:hover:border-slate-600"><div className="text-blue-600 dark:text-blue-400"><p className="text-[10px] font-bold uppercase mb-1 opacity-70">Saldo</p><p className="text-2xl font-black">{BRL.format(kpis.s)}</p></div><div className="p-2 bg-blue-500/10 dark:bg-blue-900/20 rounded-lg"><Wallet className="text-blue-600 dark:text-blue-400 w-6 h-6"/></div></div>
      </div>

      {/* 3. FILTROS RÁPIDOS */}
      <div className="px-4 sm:px-6 py-2 flex gap-2 overflow-x-auto custom-scrollbar pb-4">
         {[
             {id: null, label: 'Todos'}, 
             {id: 'HOJE', label: 'Vencem Hoje', icon: CalendarClock},
             {id: 'ATRASADO', label: 'Atrasados', icon: AlertCircle},
             {id: 'IPP', label: 'IPP', icon: LayoutGrid},
             {id: 'EM_ABERTO', label: 'Em Aberto', icon: Layers}
         ].map(f => (
             <button key={String(f.id)} onClick={()=>setFiltroRapido(f.id as any)} 
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap 
                ${filtroRapido===f.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                {f.icon && <f.icon className="w-3 h-3"/>} {f.label}
             </button>
         ))}
      </div>

      {/* 4. LISTA AGRUPADA (COM DATA FIXA) */}
      <div className="flex-1 px-4 sm:px-6 pb-20 overflow-y-auto custom-scrollbar">
        {grouped.sortedDates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 opacity-60">
                <Search className="w-12 h-12 mb-2"/>
                <p>Nenhum lançamento encontrado.</p>
            </div>
        ) : (
            grouped.sortedDates.map(date => (
                <div key={date} className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div className="flex items-center gap-4 mb-2 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 py-2 border-b border-slate-200 dark:border-slate-800">
                      <div className="px-3 py-1 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 shadow-sm">
                            <Calendar className="w-4 h-4 text-blue-500"/>
                            {formatDateExtenso(date)}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase font-bold text-slate-500">
                          <tr>
                            <th className="p-3 w-14 text-center">Sel</th>
                            <th className="p-3 w-12 text-center">IPP</th>
                            <th className="p-3">Descrição</th>
                            <th className="p-3 hidden md:table-cell">Entidade / Categoria</th>
                            <th className="p-3 text-right">Valor</th>
                            <th className="p-3 text-center w-24">Status</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-slate-200 dark:divide-slate-700">
                          {grouped.groups[date].map(l => {
                                    const atrasado = isLancamentoAtrasado(l);
                                    const pago = String(l.status).toUpperCase() === 'PAGO';
                                    const statusLabel = pago ? 'PAGO' : atrasado ? 'ATRASADO' : l.status;
                                    return (
                                    <tr key={l.id} onClick={() => openDrawer(l)} className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer group ${selectedIds.has(l.id)?'bg-blue-100/70 dark:bg-blue-900/20': pago ? 'bg-emerald-100/60 dark:bg-emerald-900/20' : atrasado ? 'bg-red-100/75 dark:bg-red-900/30' : ''}`}>
                                      <td className="p-4 w-14 text-center" onClick={e=>e.stopPropagation()}>
                                        <button
                                          type="button"
                                          aria-label="Selecionar lançamento"
                                          onClick={() => {
                                            const s = new Set(selectedIds);
                                            if (s.has(l.id)) s.delete(l.id); else s.add(l.id);
                                            setSelectedIds(s);
                                          }}
                                          className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all ${selectedIds.has(l.id) ? 'bg-blue-600 border-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-400 hover:border-blue-500 hover:text-blue-500'}`}
                                        >
                                          <Check className={`w-4 h-4 ${selectedIds.has(l.id) ? 'opacity-100' : 'opacity-0'}`} />
                                        </button>
                                      </td>
                                        <td className="p-4 w-12 text-center" onClick={(e)=>e.stopPropagation()} onMouseDown={(e)=>e.stopPropagation()}>
                                          <button
                                            type="button"
                                            onMouseDown={(e)=>e.stopPropagation()}
                                            onClick={(e)=>{e.stopPropagation(); toggleIpp(l);}}
                                            className={`w-7 h-7 rounded border flex items-center justify-center transition pointer-events-auto ${l.ipp?'bg-purple-600 border-purple-600 text-white':'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-purple-400'}`}
                                            title="Marcar como IPP"
                                            aria-pressed={l.ipp}
                                          >
                                            <Check className="w-3 h-3"/>
                                          </button>
                                        </td>
                                        <td className="p-4 font-medium text-slate-800 dark:text-white">
                                            <div className="flex items-center gap-2">{l.descricao} {l.anexos?.length > 0 && <Paperclip className="w-3 h-3 text-blue-400"/>}</div>
                                            {l.numero_parcela && <span className="text-[10px] text-slate-500">Parcela {l.numero_parcela}</span>}
                                        </td>
                                        <td className="p-4 text-xs hidden md:table-cell">
                                          <div className="font-bold text-slate-700 dark:text-slate-300">{entidades.find(e=>e.id===l.entidade_id)?.nome || '-'}</div>
                                          <div className="text-slate-500">{categorias.find(c=>c.id===l.plano_contas_id)?.nome}</div>
                                        </td>
                                        <td className={`p-4 text-right font-bold ${l.tipo==='RECEITA'?'text-emerald-400':'text-red-400'}`}>{BRL.format(l.valor_previsto)}</td>
                                        <td className="p-4 text-center w-24">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${pago?'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900': atrasado ? 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>{statusLabel}</span>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                          </table>
                      </div>
                    </div>
                </div>
            ))
        )}
      </div>

      {/* Barra flutuante de ações em lote */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full border border-slate-200 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl">
            <div className="px-3 py-1 rounded-full bg-blue-600/20 text-blue-600 dark:text-blue-300 text-xs font-bold border border-blue-500/30">
              {selectedIds.size} selecionado(s)
            </div>
            <button onClick={()=>setShowBulkPay(true)} className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5"/> Baixar
            </button>
            <button onClick={openBulkDelete} className="px-3 py-1.5 rounded-full bg-red-600 text-white text-xs font-bold hover:bg-red-500 shadow flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5"/> Apagar
            </button>
            <button onClick={()=>setSelectedIds(new Set())} className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5">
              <X className="w-3.5 h-3.5"/> Limpar
            </button>
          </div>
        </div>
      )}

      {/* --- SIDEBAR FILTROS (MULTI-SELECT + BOTOES CONTAS) --- */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-slate-800 shadow-2xl z-60 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${showFiltrosSidebar?'translate-x-0':'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center"><h3 className="font-bold flex gap-2 text-slate-800 dark:text-white"><Filter className="w-4 h-4 text-blue-500"/> Filtros Avançados</h3><button onClick={()=>setShowFiltrosSidebar(false)}><X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white"/></button></div>
        <div className="p-4 space-y-6 overflow-y-auto h-[calc(100vh-60px)] custom-scrollbar">
           
           {/* Filtro Tipo */}
           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Tipo de Lançamento</label>
               <div className="flex gap-2">
                   {['TODOS','RECEITA','DESPESA'].map(t => (
                       <button key={t} onClick={()=>setFiltrosAvancados(prev=>({...prev, tipo: t as any}))} 
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.tipo===t ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                        {t}
                       </button>
                   ))}
               </div>
           </div>

           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Período Personalizado</label>
               <div className="grid grid-cols-2 gap-2">
                   <input type="date" className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white" value={filtrosAvancados.dataInicio} onChange={e=>setFiltrosAvancados({...filtrosAvancados, dataInicio:e.target.value})} />
                   <input type="date" className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-2 text-xs text-slate-700 dark:text-white" value={filtrosAvancados.dataFim} onChange={e=>setFiltrosAvancados({...filtrosAvancados, dataFim:e.target.value})} />
               </div>
           </div>

           {/* Filtro Contas como Botões (Chips) */}
           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Contas / Bancos</label>
               <div className="flex flex-wrap gap-2">
                   {contas.map(c => {
                       const active = filtrosAvancados.contaIds.has(c.id);
                       return (
                           <button key={c.id} onClick={()=>{
                               const newSet = new Set(filtrosAvancados.contaIds);
                               if(active) newSet.delete(c.id); else newSet.add(c.id);
                               setFiltrosAvancados({...filtrosAvancados, contaIds:newSet});
                           }} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1 ${active ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                               <Wallet className="w-3 h-3"/> {c.nome}
                           </button>
                       );
                   })}
               </div>
           </div>

           <MultiSelectDropdown label="Categorias" placeholder="Selecione categorias..." options={categorias} selectedIds={filtrosAvancados.categoriaIds} onChange={(s:any)=>setFiltrosAvancados({...filtrosAvancados, categoriaIds:s})} />
           
           <button onClick={()=>{setFiltrosAvancados({tipo:'TODOS', status:[], contaIds:new Set(), categoriaIds:new Set(), dataInicio:'', dataFim:''}); setMesAtual(new Date());}} className="w-full py-2 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm mt-4">Limpar Filtros</button>
        </div>
      </div>

      {/* --- MODAL TRANSFERÊNCIA (COMPLETO) --- */}
      {showTransfer && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowTransfer(false)}></div>
            <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-700 animate-scale-in">
              <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-blue-500"/> Nova Transferência</h3>
                <div className="space-y-4">
                    <InputDark label="Valor (R$)" type="number" step="0.01" value={transferData.valor} onChange={(e:any)=>setTransferData({...transferData, valor:e.target.value})} />
                    <InputDark label="Data" type="date" value={transferData.data} onChange={(e:any)=>setTransferData({...transferData, data:e.target.value})} />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase">De (Origem)</label>
                            <select className="w-full p-2 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-white text-sm" value={transferData.conta_origem_id} onChange={e=>setTransferData({...transferData, conta_origem_id:e.target.value})}>
                                <option value="">Selecione...</option>
                                {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase">Para (Destino)</label>
                            <select className="w-full p-2 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-white text-sm" value={transferData.conta_destino_id} onChange={e=>setTransferData({...transferData, conta_destino_id:e.target.value})}>
                                <option value="">Selecione...</option>
                                {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                        </div>
                    </div>

                    <SearchableSelect label="Categoria (Classificação)" placeholder="Selecione..." options={catOptions} value={transferData.plano_contas_id} onChange={(id:any)=>setTransferData({...transferData, plano_contas_id:id})} />
                    
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1">Centro de Custo</label>
                        <select className="w-full p-2 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-white text-sm" value={transferData.centro_custo_id} onChange={e=>setTransferData({...transferData, centro_custo_id:e.target.value})}>
                            <option value="">Opcional</option>
                            {centros.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                    </div>

                    <InputDark label="Observação" value={transferData.observacao} onChange={(e:any)=>setTransferData({...transferData, observacao:e.target.value})} />
                </div>
                <div className="flex gap-2 mt-6">
                    <button onClick={() => setShowTransfer(false)} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">Cancelar</button>
                    <button onClick={handleTransferencia} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition">{saving?'Enviando...':'Confirmar'}</button>
                </div>
            </div>
        </div>
      )}

      {/* DRAWER ENTIDADE */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-slate-800 shadow-2xl z-60 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${showEntityDrawer?'translate-x-0':'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><User className="w-4 h-4 text-blue-500"/> Nova Entidade</h3>
            <button onClick={()=>setShowEntityDrawer(false)}><X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white"/></button>
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

      {/* DRAWER NOVO/EDITAR */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=>setShowDrawer(false)}></div>
          <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing?'Editar':'Novo'} Lançamento</h2>
              <button onClick={()=>setShowDrawer(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400"><X className="w-5 h-5"/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
              
              {/* DESCRIÇÃO E VALORES */}
              <InputDark label="Descrição" autoFocus value={formData.descricao} onChange={(e:any)=>setFormData({...formData, descricao:e.target.value})} placeholder="Ex: Conta de Luz" />
              <div className="grid grid-cols-2 gap-4">
                <InputDark label={formData.cartao_id ? "Data da compra" : "Vencimento"} type="date" value={formData.data_vencimento} onChange={(e:any)=>handleVencimentoChange(e.target.value)} />
                <InputDark label="Valor (R$)" type="number" step="0.01" className="font-bold text-lg text-blue-400" value={formData.valor_previsto} onChange={(e:any)=>setFormData({...formData, valor_previsto:e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputDark label="Competência (MM-AAAA)" placeholder="02-2026" value={formData.competencia} onChange={(e:any)=>handleCompetenciaChange(e.target.value)} />
                <ToggleSimNao label="Previsto" value={!!formData.previsto} onChange={(next)=>setFormData({...formData, previsto: next})} />
              </div>

              {formData.cartao_id && formData.data_vencimento && (
                <div className="text-xs text-slate-400">
                  Vencimento da fatura: <strong className="text-blue-300">{computeCartaoVencimento(formData.data_vencimento, formData.cartao_id) || '—'}</strong>
                </div>
              )}

              {/* PARCELAMENTO */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao
                  label="Lançamento parcelado"
                  value={!!formData.is_parcelado}
                  onChange={(next)=>setFormData({...formData, is_parcelado: next})}
                />

                {formData.is_parcelado && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <InputDark
                        label="Qtd. de parcelas"
                        type="number"
                        min={2}
                        value={formData.qtd_parcelas}
                        onChange={(e:any)=>setFormData({...formData, qtd_parcelas: Math.max(2, Number(e.target.value) || 2)})}
                      />
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={()=>setFormData({...formData, modo_calculo: 'TOTAL'})}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${formData.modo_calculo==='TOTAL' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                          >
                            Total
                          </button>
                          <button
                            type="button"
                            onClick={()=>setFormData({...formData, modo_calculo: 'PARCELA'})}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${formData.modo_calculo==='PARCELA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                          >
                            Por parcela
                          </button>
                        </div>
                      </div>
                    </div>

                    {formData.valor_previsto && formData.qtd_parcelas && (
                      <div className="text-xs text-slate-400">
                        {formData.modo_calculo === 'TOTAL' ? (
                          <>{formData.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(formData.valor_previsto) / Number(formData.qtd_parcelas || 1))}</strong></>
                        ) : (
                          <>{formData.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(formData.valor_previsto))}</strong> • Total {BRL.format(Number(formData.valor_previsto) * Number(formData.qtd_parcelas || 1))}</>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PAGAMENTO */}
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao
                  label="Já foi pago/recebido?"
                  value={formData.status==='PAGO'}
                  onChange={handleStatusPagoChange}
                />
                {formData.status==='PAGO' && (
                  <div className="grid grid-cols-2 gap-4 mt-3 animate-in fade-in slide-in-from-top-2">
                    <InputDark label="Data da Baixa" type="date" value={formData.data_pagamento} onChange={(e:any)=>handleDataPagamentoChange(e.target.value)} />
                    <InputDark label="Valor Pago (R$)" type="number" step="0.01" className="text-emerald-400 font-bold" value={formData.valor_pago} onChange={(e:any)=>setFormData({...formData, valor_pago:e.target.value})} />
                  </div>
                )}
              </div>

              {/* CATEGORIA E ENTIDADE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchableSelect label="Categoria" placeholder="Selecione..." options={catOptions} value={formData.plano_contas_id} onChange={(id:any)=>{
                   const cat = categorias.find(c=>String(c.id)===String(id));
                   const tipoCat = String(cat?.tipo || '').trim().toUpperCase();
                   setFormData({...formData, plano_contas_id:id, tipo: tipoCat.startsWith('R') ? 'RECEITA' : 'DESPESA'});
                }} />
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Entidade</label>
                    <button onClick={()=>setShowEntityDrawer(true)} className="text-[10px] text-blue-400 font-bold hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3"/> Nova</button>
                  </div>
                  <select className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-white outline-none focus:border-blue-500 text-sm" value={formData.entidade_id} onChange={e=>{
                    const eid = e.target.value;
                    const last = lancamentos.find(l=>String(l.entidade_id)===eid);
                    setFormData((prev: any) => ({...prev, entidade_id:eid, plano_contas_id: last ? last.plano_contas_id : prev.plano_contas_id, tipo: last ? last.tipo : prev.tipo}));
                  }}>
                    <option value="">Selecione...</option>
                    {entidades.map(e=><option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
              </div>

              {/* ORIGEM DO RECURSO (COM FILTRAGEM INTELIGENTE) */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Origem do Recurso</label>
                <div className="mb-3">
                    <select className="w-full p-2 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 outline-none" value={formData.centro_custo_id} onChange={e=>setFormData({...formData, centro_custo_id:e.target.value, conta_id: '', cartao_id: ''})}>
                        <option value="">Todos os Centros de Custo</option>
                        {centros.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-800/30 space-y-4">
                  {/* CONTAS */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Wallet className="w-3 h-3"/> Contas Bancárias</p>
                    <div className="grid grid-cols-2 gap-2">
                      {contas.filter(c => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)).length === 0 && <span className="text-xs text-slate-500 italic col-span-2">Nenhuma conta neste centro.</span>}
                      {contas.filter(c => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)).map(c=>(
                        <div key={c.id} onClick={()=>toggleConta(c.id)} className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${formData.conta_id===c.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'}`}>
                          <div className={`p-1 rounded ${formData.conta_id===c.id?'bg-white/20':'bg-slate-100 dark:bg-slate-700 text-emerald-500'}`}><Wallet className="w-3 h-3"/></div> {c.nome}
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* CARTÕES */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><CreditCard className="w-3 h-3"/> Cartões de Crédito</p>
                    <div className="grid grid-cols-2 gap-2">
                      {cartoes.filter(c => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)).length === 0 && <span className="text-xs text-slate-500 italic col-span-2">Nenhum cartão neste centro.</span>}
                      {cartoes.filter(c => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)).map(c=>(
                        <div key={c.id} onClick={()=>toggleCartao(c.id)} className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${formData.cartao_id===c.id ? 'bg-purple-600 text-white border-purple-500 shadow-md' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'}`}>
                          <div className={`p-1 rounded ${formData.cartao_id===c.id?'bg-white/20':'bg-slate-100 dark:bg-slate-700 text-purple-500'}`}><CreditCard className="w-3 h-3"/></div> {c.nome_cartao}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* ANEXOS */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>
                
                {formData.anexos && formData.anexos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        {formData.anexos.map((anexo: Anexo) => (
                            <div key={anexo.id} className="flex items-center gap-2 p-2 bg-slate-800 border border-slate-600 rounded-lg text-xs group hover:border-blue-500 transition">
                                {getFileIcon(anexo.nome_arquivo)}
                                <a href={anexo.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:text-blue-400 font-medium">{anexo.nome_arquivo}</a>
                                <a href={anexo.url} download target="_blank" className="p-1 text-slate-500 hover:text-white rounded hover:bg-slate-700"><Download className="w-3 h-3"/></a>
                            </div>
                        ))}
                    </div>
                )}

                <div className="border-2 border-dashed border-slate-600 rounded-2xl p-8 text-center hover:border-blue-500 relative cursor-pointer bg-slate-800/40 hover:bg-slate-800 transition group shadow-sm">
                  <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.ppt,.pptx" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e=>setFilesToUpload(e.target.files)}/>
                  <UploadCloud className="w-10 h-10 mx-auto text-slate-500 mb-3 group-hover:text-blue-500 transition-colors"/>
                  <p className="text-base font-semibold text-slate-300">Arraste ou clique para anexar</p>
                  <p className="text-xs text-slate-500 mt-1">PDF, Imagens, Excel, PowerPoint</p>
                  <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-slate-700 text-slate-100 text-sm font-bold group-hover:bg-blue-600 transition-colors">
                    Selecionar arquivos
                  </div>
                  {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} novos arquivos</p>}
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

      {/* MODAL BAIXA EM LOTE */}
      {showBulkPay && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={()=>setShowBulkPay(false)}></div>
          <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-700">
            <h3 className="font-bold text-lg mb-4 text-white">Baixar selecionados</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">Conta de pagamento</p>
                <select className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white" value={bulkPayData.conta_id} onChange={e=>setBulkPayData({...bulkPayData, conta_id: e.target.value})}>
                  <option value="">Selecionar...</option>
                  {contas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">Data de pagamento</p>
                <div className="flex flex-col gap-2 text-sm text-white">
                  {[
                    {id:'HOJE', label:'Hoje'},
                    {id:'ONTEM', label:'Ontem'},
                    {id:'OUTRO', label:'Outro dia'},
                  ].map(opt=>(
                    <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="bulk-date" checked={bulkPayData.modoData===opt.id} onChange={()=>setBulkPayData({...bulkPayData, modoData: opt.id})} className="accent-blue-500" />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                  {bulkPayData.modoData==='OUTRO' && (
                    <input type="date" className="mt-1 p-2 rounded border border-slate-600 bg-slate-900 text-white" value={bulkPayData.data} onChange={e=>setBulkPayData({...bulkPayData, data:e.target.value})}/>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={()=>setShowBulkPay(false)} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg transition">Cancelar</button>
              <button onClick={handleBulkPay} disabled={saving} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition">{saving?'Enviando...':'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL APAGAR EM LOTE (3 ETAPAS) */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={()=>setShowBulkDelete(false)}></div>
          <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-white flex items-center gap-2"><Trash2 className="w-5 h-5 text-red-400"/> Apagar selecionados</h3>
              <div className="text-[11px] text-slate-400">Etapa {deleteStep} de 3</div>
            </div>

            {deleteStep === 1 && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">
                  Você está prestes a apagar <strong>{selectedIds.size}</strong> lançamento(s). Esta ação é irreversível.
                </div>
                <div className="text-xs text-slate-400">
                  Confirme que deseja continuar.
                </div>
              </div>
            )}

            {deleteStep === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Motivo</label>
                  <select className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white" value={deleteReason} onChange={e=>setDeleteReason(e.target.value)}>
                    <option value="">Selecionar...</option>
                    <option value="DUPLICADO">Duplicado</option>
                    <option value="LANCAMENTO_INCORRETO">Lançamento incorreto</option>
                    <option value="CANCELADO">Cancelado</option>
                    <option value="OUTRO">Outro</option>
                  </select>
                </div>
                <div className="text-xs text-slate-400">Selecione um motivo para prosseguir.</div>
              </div>
            )}

            {deleteStep === 3 && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">
                  Digite <strong>APAGAR</strong> para confirmar a exclusão.
                </div>
                <input
                  type="text"
                  value={deletePhrase}
                  onChange={e=>setDeletePhrase(e.target.value)}
                  placeholder="Digite APAGAR"
                  className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white"
                />
                <div className="text-xs text-slate-400">Motivo: {deleteReason || '—'}</div>
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button onClick={()=>setShowBulkDelete(false)} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg transition">Cancelar</button>
              {deleteStep > 1 && (
                <button onClick={()=>setDeleteStep(prev=>Math.max(1, prev-1))} className="flex-1 py-3 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-600 transition">Voltar</button>
              )}
              {deleteStep < 3 && (
                <button
                  onClick={()=>setDeleteStep(prev=>Math.min(3, prev+1))}
                  disabled={deleteStep === 2 && !deleteReason}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition disabled:opacity-50"
                >
                  Continuar
                </button>
              )}
              {deleteStep === 3 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={deletePhrase.trim() !== 'APAGAR' || saving}
                  className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 shadow-lg transition disabled:opacity-50"
                >
                  {saving ? 'Apagando...' : 'Apagar agora'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}