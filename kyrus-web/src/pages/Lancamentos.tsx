import { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, toPublicAssetUrl } from '../services/api';
import { useAssistentePage } from '../components/AssistentePageContext';
import { useLookupStore } from '../store/lookupStore';
import { buildOperationalCategoriaIds } from '../utils/planoContas';
import { BankAvatar } from '../components/BrandAvatar';
import { CurrencyInput } from '../components/CurrencyInput';
import { 
  Plus, Search, Filter, RefreshCw, ChevronLeft, ChevronRight, 
  ArrowRightLeft, Wallet, CreditCard, Layers, Calendar, 
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2, 
  Trash2, Check, X, UploadCloud, FileText, Loader2, 
  CalendarClock, User, ChevronDown, Save, Paperclip, Download,
  Image as ImageIcon, FileSpreadsheet, Presentation, LayoutGrid, CheckSquare, Square,
  Landmark, Info, Copy
} from 'lucide-react';

// --- INTERFACES ---
interface Anexo { id: number; nome_arquivo: string; url: string; tipo: string; }
interface Lancamento {
  id: number; descricao: string; valor_previsto: number; valor_pago: number;
  data_vencimento: string; data_pagamento?: string; tipo: 'RECEITA' | 'DESPESA';
  data_competencia?: string;
  competencia?: string; previsto?: boolean;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO'; ipp: boolean;
  observacao?: string;
  conciliado?: boolean;
  origem?: string;
  plano_contas_id: number; entidade_id?: number; conta_id?: number;
  cartao_id?: number; centro_custo_id?: number; anexos: Anexo[];
  numero_parcela?: number;
  id_parcelamento?: string;
}

interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
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

const formatDateShort = (dateString?: string) => {
  if (!dateString) return '';
  const date = fixDate(dateString);
  return date ? date.toLocaleDateString('pt-BR') : '';
};

const getTodayLocalYmd = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getTomorrowLocalYmd = () => {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLocalYmdDaysAgo = (days: number) => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - days);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isWeekend = (date: Date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const toNextBusinessDay = (ymd: string) => {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return ymd;
  const dt = new Date(year, month - 1, day);
  while (isWeekend(dt)) {
    dt.setDate(dt.getDate() + 1);
  }
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDescricaoParcela = (descricao?: string) => {
  const text = String(descricao || '').trim();
  const match = text.match(/^(.*)\((\d+)\s*\/\s*(\d+)\)\s*$/);
  if (!match) return null;
  const base = String(match[1] || '').trim();
  const numero = Number(match[2] || 0);
  const total = Number(match[3] || 0);
  if (!base || numero <= 0 || total <= 1) return null;
  return { base, numero, total };
};

const isLancamentoAtrasado = (l: Lancamento) => {
  if (String(l.status).toUpperCase() === 'PAGO') return false;
  if (!l.data_vencimento) return false;
  return l.data_vencimento < getTodayLocalYmd();
};

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

interface QuickEntityFormState {
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
}

const initialQuickEntityData: QuickEntityFormState = {
  nome: '',
  tipo: 'AMBOS',
  tipo_pessoa: 'PF',
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

const CurrencyInputDark = ({ label, className = '', value, onValueChange, ...props }: any) => (
  <div className="w-full">
    {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
    <CurrencyInput
      {...props}
      value={value}
      onValueChange={onValueChange}
      className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 ${className}`}
    />
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
        className={`py-3 rounded-lg text-sm font-bold border transition ${value ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-900/20' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`py-3 rounded-lg text-sm font-bold border transition ${!value ? 'bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-900/20' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
      >
        {noLabel}
      </button>
    </div>
  </div>
);

export function Lancamentos() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [, setPrimaryColor] = useState('#2563eb');
  
  // Filtros
  const [filtroTexto, setFiltroTexto] = useState('');
  const [centroCustoFiltro, setCentroCustoFiltro] = useState<string>('');
  
  const [filtrosAvancados, setFiltrosAvancados] = useState({
      tipo: 'TODOS' as 'TODOS'|'RECEITA'|'DESPESA',
      status: [] as string[],
      contaIds: new Set<number>(),
      categoriaIds: new Set<number>(),
      centroCustoPresenca: 'TODOS' as 'TODOS' | 'COM' | 'SEM',
      dataModo: 'VENCIMENTO' as 'VENCIMENTO' | 'PAGAMENTO',
      dataInicio: '',
      dataFim: ''
  });
  const [filtroRapido, setFiltroRapido] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosRailCollapsed, setFiltrosRailCollapsed] = useState(() => localStorage.getItem('lancamentos.filtrosRailCollapsed') === '1');
  // Barra/ações em lote
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [resumoTopoModo, setResumoTopoModo] = useState<'KPIS' | 'BANCOS'>(() => {
    const saved = localStorage.getItem('lancamentos.resumoTopoModo');
    return saved === 'BANCOS' ? 'BANCOS' : 'KPIS';
  });
  const [contaExtratoAtivaId, setContaExtratoAtivaId] = useState<number | null>(null);
  const [bancosRetratilFechado, setBancosRetratilFechado] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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
  const [initialDrawerFormSnapshot, setInitialDrawerFormSnapshot] = useState('');
  const [initialScopedFields, setInitialScopedFields] = useState({ descricao: '', plano_contas_id: '', data_vencimento: '' });
  const [parcelasSerie, setParcelasSerie] = useState<Lancamento[]>([]);
  const [parcelasSerieLoading, setParcelasSerieLoading] = useState(false);
  const [parcelasVencimentosEdit, setParcelasVencimentosEdit] = useState<Record<number, string>>({});
  const [parcelasEscopoEdicao, setParcelasEscopoEdicao] = useState<'ESTA' | 'PROXIMAS' | 'TODAS'>('ESTA');
  const [ajustarParaDiaUtil, setAjustarParaDiaUtil] = useState(false);
  const [showParcelasSeriePanel, setShowParcelasSeriePanel] = useState(false);
  const [newEntityData, setNewEntityData] = useState<QuickEntityFormState>(initialQuickEntityData);
  const [entityCepLoading, setEntityCepLoading] = useState(false);
  const [entityCepFeedback, setEntityCepFeedback] = useState<string | null>(null);

  const [formData, setFormData] = useState<any>({
    id: null, descricao: '', valor_previsto: '', data_vencimento: '',
    tipo: 'DESPESA', plano_contas_id: '', centro_custo_id: '', entidade_id: '',
    conta_id: '', cartao_id: '', status: 'PENDENTE', 
    valor_pago: '', data_pagamento: '', ipp: false, previsto: true, competencia: '', observacao: '',
    is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL', competencia_modo_parcelamento: 'POR_PARCELA', anexos: []
  });

  const [transferData, setTransferData] = useState({
    valor: '', data: new Date().toISOString().split('T')[0], 
    conta_origem_id: '', conta_destino_id: '', observacao: '',
    centro_custo_id: ''
  });

  const auxLoadedRef = useRef(false);
  const lancamentosAbortRef = useRef<AbortController | null>(null);
  const lastLancamentosKeyRef = useRef<string>('');
  const lastEntityCepLookupRef = useRef('');
  const autoPagamentoRef = useRef(true);
  const autoCompetenciaRef = useRef(true);
  const quickOpenNovoHandledRef = useRef(false);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const buildDrawerFormSnapshot = (data: any) => JSON.stringify({
    id: data.id || null,
    descricao: data.descricao || '',
    valor_previsto: String(data.valor_previsto || ''),
    data_vencimento: data.data_vencimento || '',
    tipo: data.tipo || 'DESPESA',
    plano_contas_id: String(data.plano_contas_id || ''),
    centro_custo_id: String(data.centro_custo_id || ''),
    entidade_id: String(data.entidade_id || ''),
    conta_id: String(data.conta_id || ''),
    cartao_id: String(data.cartao_id || ''),
    status: data.status || 'PENDENTE',
    valor_pago: String(data.valor_pago || ''),
    data_pagamento: data.data_pagamento || '',
    previsto: data.previsto ?? true,
    competencia: data.competencia || '',
    observacao: data.observacao || '',
    is_parcelado: Boolean(data.is_parcelado),
    qtd_parcelas: Number(data.qtd_parcelas || 2),
    modo_calculo: data.modo_calculo || 'TOTAL',
    competencia_modo_parcelamento: data.competencia_modo_parcelamento || 'POR_PARCELA',
  });

  const hasUnsavedDrawerChanges = useMemo(() => {
    if (!showDrawer) return false;
    if (!initialDrawerFormSnapshot) return false;
    if (filesToUpload && filesToUpload.length > 0) return true;
    return buildDrawerFormSnapshot(formData) !== initialDrawerFormSnapshot;
  }, [showDrawer, initialDrawerFormSnapshot, formData, filesToUpload]);

  const closeDrawerDirect = () => {
    setShowDrawer(false);
    setInitialDrawerFormSnapshot('');
    setFilesToUpload(null);
    setParcelasSerie([]);
    setParcelasVencimentosEdit({});
    setParcelasEscopoEdicao('ESTA');
    setAjustarParaDiaUtil(false);
    setShowParcelasSeriePanel(false);
    setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
  };

  const sortedParcelasSerie = useMemo(() => {
    return [...parcelasSerie].sort((a, b) => {
      const parcelaA = Number(a.numero_parcela || 0);
      const parcelaB = Number(b.numero_parcela || 0);
      if (parcelaA !== parcelaB) return parcelaA - parcelaB;
      return String(a.data_vencimento || '').localeCompare(String(b.data_vencimento || ''));
    });
  }, [parcelasSerie]);

  const currentParcelaNumber = useMemo(() => {
    if (formData?.numero_parcela) return Number(formData.numero_parcela);
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.numero) return parsed.numero;
    const idx = sortedParcelasSerie.findIndex((p) => Number(p.id) === Number(formData?.id));
    return idx >= 0 ? idx + 1 : 1;
  }, [formData?.id, formData?.numero_parcela, formData?.descricao, sortedParcelasSerie]);

  const currentParcelaTotal = useMemo(() => {
    if (sortedParcelasSerie.length > 1) return sortedParcelasSerie.length;
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.total && parsed.total > 1) return parsed.total;
    if (formData?.qtd_parcelas && Number(formData.qtd_parcelas) > 1) return Number(formData.qtd_parcelas);
    return 1;
  }, [sortedParcelasSerie.length, formData?.descricao, formData?.qtd_parcelas]);

  const isEditingParcelado = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return currentParcelaTotal > 1;
    if (Number(formData?.numero_parcela || 0) > 0 && currentParcelaTotal > 1) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao, currentParcelaTotal]);

  const canOpenParcelasSerie = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return true;
    if (Number(formData?.numero_parcela || 0) > 0) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao]);

  const shouldShowParcelasSerie = isEditingParcelado || showParcelasSeriePanel;

  const loadParcelasSerie = async (parcelamentoId?: string, referencia?: Lancamento) => {
    if (!parcelamentoId) {
      const ref = referencia || (formData as Lancamento | undefined);
      const parsedRef = parseDescricaoParcela(ref?.descricao);
      if (!parsedRef) {
        setParcelasSerie([]);
        setParcelasVencimentosEdit({});
        return;
      }

      const buildSerieFromDataset = (dataset: Lancamento[]) => {
        const similares = (dataset || [])
          .filter((item) => {
            const parsedItem = parseDescricaoParcela(item.descricao);
            if (!parsedItem) return false;
            if (parsedItem.base !== parsedRef.base || parsedItem.total !== parsedRef.total) return false;
            if (String(item.tipo || '') !== String(ref?.tipo || '')) return false;
            if (Number(item.plano_contas_id || 0) !== Number(ref?.plano_contas_id || 0)) return false;

            const contaRef = Number(ref?.conta_id || 0);
            const contaItem = Number(item.conta_id || 0);
            const cartaoRef = Number(ref?.cartao_id || 0);
            const cartaoItem = Number(item.cartao_id || 0);

            if (contaRef && contaItem && contaRef !== contaItem) return false;
            if (cartaoRef && cartaoItem && cartaoRef !== cartaoItem) return false;
            return true;
          })
          .map((item) => {
            const parsedItem = parseDescricaoParcela(item.descricao);
            return {
              ...item,
              numero_parcela: item.numero_parcela || parsedItem?.numero,
            };
          });

        return ref && !similares.some((item) => Number(item.id) === Number(ref.id))
          ? [...similares, { ...ref, numero_parcela: ref.numero_parcela || parsedRef.numero }]
          : similares;
      };

      let withRef = buildSerieFromDataset(lancamentos || []);

      if (withRef.length < parsedRef.total) {
        setParcelasSerieLoading(true);
        try {
          const refYear = Number(String(ref?.data_vencimento || '').slice(0, 4)) || new Date().getFullYear();
          const res = await api.get('/lancamentos/', {
            params: {
              limit: 10000,
              data_inicio: `${refYear - 2}-01-01`,
              data_fim: `${refYear + 2}-12-31`,
            },
          });
          withRef = buildSerieFromDataset(Array.isArray(res.data) ? res.data : []);
        } catch {
          // Mantém a série local se a busca ampla não responder.
        } finally {
          setParcelasSerieLoading(false);
        }
      }

      setParcelasSerie(withRef);
      setParcelasVencimentosEdit(
        withRef.reduce((acc: Record<number, string>, item: Lancamento) => {
          acc[item.id] = item.data_vencimento;
          return acc;
        }, {}),
      );
      return;
    }
    setParcelasSerieLoading(true);
    try {
      const res = await api.get(`/lancamentos/parcelamento/${parcelamentoId}`);
      const serie = Array.isArray(res.data) ? res.data : [];
      setParcelasSerie(serie);
      setParcelasVencimentosEdit(
        serie.reduce((acc: Record<number, string>, item: Lancamento) => {
          acc[item.id] = item.data_vencimento;
          return acc;
        }, {}),
      );
    } catch {
      setParcelasSerie([]);
      setParcelasVencimentosEdit({});
      pushToast('error', 'Não foi possível carregar as parcelas desta série.');
    } finally {
      setParcelasSerieLoading(false);
    }
  };

  const requestCloseDrawer = async () => {
    if (saving) return;
    if (!hasUnsavedDrawerChanges) {
      closeDrawerDirect();
      return;
    }
    const shouldSave = window.confirm('Você alterou informações e ainda não salvou. Você deseja salvar a informação antes de sair?');
    if (shouldSave) {
      await handleSave();
      return;
    }
    closeDrawerDirect();
  };

  const handleVerTodasParcelas = async () => {
    if (!canOpenParcelasSerie) {
      pushToast('info', 'Este lançamento não possui série de parcelamento identificada.');
      return;
    }
    setShowParcelasSeriePanel(true);
    setParcelasEscopoEdicao('TODAS');
    await loadParcelasSerie(formData?.id_parcelamento, formData as Lancamento);
  };

  const handleSelecionarParcelaSerie = (item: Lancamento) => {
    if (Number(item.id) === Number(formData?.id)) return;
    openDrawer(item, { preserveSeriePanel: true });
  };

  useEffect(() => {
    localStorage.setItem('lancamentos.filtrosRailCollapsed', filtrosRailCollapsed ? '1' : '0');
  }, [filtrosRailCollapsed]);

  const pushToast = (type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(prev => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  const documentoInteressadoLabel = newEntityData.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ';
  const nomeInteressadoLabel = newEntityData.tipo_pessoa === 'PF' ? 'Nome completo' : 'Razão social';

  const handleQuickEntityDocumentoChange = (value: string) => {
    const formatted = formatCpfCnpj(value);
    const digits = onlyDigits(formatted);
    setNewEntityData((prev) => ({
      ...prev,
      cpf_cnpj: formatted,
      tipo_pessoa: digits.length > 11 ? 'PJ' : prev.tipo_pessoa === 'PJ' && digits.length > 0 && digits.length <= 11 ? 'PF' : prev.tipo_pessoa,
    }));
  };

  const closeEntityDrawer = () => {
    setShowEntityDrawer(false);
    setEntityCepLoading(false);
    setEntityCepFeedback(null);
    lastEntityCepLookupRef.current = '';
  };

  const openEntityDrawer = () => {
    setNewEntityData(initialQuickEntityData);
    setEntityCepLoading(false);
    setEntityCepFeedback(null);
    lastEntityCepLookupRef.current = '';
    setShowEntityDrawer(true);
  };

  async function handleQuickEntityCepChange(value: string) {
    const formatted = formatCep(value);
    const digits = onlyDigits(formatted);

    setNewEntityData((prev) => ({ ...prev, cep: formatted }));

    if (digits.length < 8) {
      lastEntityCepLookupRef.current = '';
      setEntityCepFeedback(null);
      setEntityCepLoading(false);
      return;
    }

    if (digits === lastEntityCepLookupRef.current) {
      return;
    }

    setEntityCepLoading(true);
    setEntityCepFeedback(null);
    try {
      const address = await fetchCepAddress(digits);
      lastEntityCepLookupRef.current = digits;
      setNewEntityData((prev) => ({
        ...prev,
        cep: formatCep(address.cep),
        logradouro: address.logradouro,
        bairro: address.bairro,
        cidade: address.cidade,
        uf: address.uf,
      }));
      setEntityCepFeedback('Endereço preenchido automaticamente pelo CEP.');
    } catch (error: any) {
      lastEntityCepLookupRef.current = '';
      setEntityCepFeedback(error?.message || 'Não foi possível consultar o CEP.');
    } finally {
      setEntityCepLoading(false);
    }
  }

  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);

  const getContaSaldo = (conta: any) => {
    const saldo = Number(conta?.saldo_atual ?? conta?.saldo ?? conta?.saldo_disponivel ?? conta?.saldo_inicial ?? 0);
    return Number.isFinite(saldo) ? saldo : 0;
  };

  const getTransferContaLabel = (conta: any) => conta?.banco || conta?.nome || 'Conta bancária';

  const renderTransferContaButton = (conta: any, role: 'origem' | 'destino') => {
    const selectedId = role === 'origem' ? transferData.conta_origem_id : transferData.conta_destino_id;
    const isSelected = String(selectedId) === String(conta.id);
    const isBlocked = role === 'origem'
      ? String(transferData.conta_destino_id) === String(conta.id)
      : String(transferData.conta_origem_id) === String(conta.id);
    const logo = getFullLogoUrl(conta.logo_url);

    return (
      <button
        key={`${role}-${conta.id}`}
        type="button"
        disabled={isBlocked}
        onClick={() => setTransferData((prev) => ({
          ...prev,
          [role === 'origem' ? 'conta_origem_id' : 'conta_destino_id']: String(conta.id),
        }))}
        className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-500/10' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800'} ${isBlocked ? 'cursor-not-allowed opacity-45' : ''}`}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={conta.nome} integrationType={conta.tipo_integracao} size="sm" className="h-11 w-11" imageClassName="rounded-2xl" fallbackClassName="rounded-2xl border-0 shadow-none" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-100">{getTransferContaLabel(conta)}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conta.nome || conta.tipo || 'Conta bancária'}</p>
        </div>
        {isSelected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-500" /> : null}
      </button>
    );
  };

  const formatDateYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getVisibleRange = () => {
    if (filtrosAvancados.dataModo === 'VENCIMENTO' && filtrosAvancados.dataInicio && filtrosAvancados.dataFim) {
      return { ini: filtrosAvancados.dataInicio, fim: filtrosAvancados.dataFim };
    }
    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth() + 1;
    return {
      ini: new Date(ano, mes - 1, 1).toISOString().split('T')[0],
      fim: new Date(ano, mes, 0).toISOString().split('T')[0],
    };
  };

  const refreshLancamentosVisiveis = async () => {
    const { ini, fim } = getVisibleRange();
    await loadLancamentos(ini, fim, { force: true, skipFallback: true });
  };

  const refreshContasComSaldo = async () => {
    try {
      const rC = await api.get('/contas/', { params: { include_saldo: true } });
      setContas(rC.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const formatCompetencia = (ymd?: string) => {
    if (!ymd) return '';
    const [y, m] = ymd.split('-');
    if (!y || !m) return '';
    return `${m}-${y}`;
  };

  const isTransferencia = (lancamento?: Pick<Lancamento, 'origem'> | null) => String(lancamento?.origem || '').toUpperCase() === 'TRANSFERENCIA';

  const getCategoriaLabel = (lancamento: Pick<Lancamento, 'origem' | 'plano_contas_id'>) => {
    if (isTransferencia(lancamento)) return 'Transferência interna';
    return categorias.find(c => c.id === lancamento.plano_contas_id)?.nome || '-';
  };

  const isContaAtiva = (conta: any) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO';

  const contasAtivas = useMemo(() => contas.filter((conta) => isContaAtiva(conta)), [contas]);

  const getContasAtivasByCentro = (centroCustoId?: string | number | null) => {
    return contasAtivas.filter((conta) => !centroCustoId || String(conta.centro_custo_id) === String(centroCustoId));
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
    localStorage.setItem('lancamentos.resumoTopoModo', resumoTopoModo);
  }, [resumoTopoModo]);

  useEffect(() => { 
    if (filtrosAvancados.dataModo === 'PAGAMENTO' && (filtrosAvancados.dataInicio || filtrosAvancados.dataFim)) {
      loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
    } else if(!filtrosAvancados.dataInicio && !filtrosAvancados.dataFim) {
        const ano = mesAtual.getFullYear(); const mes = mesAtual.getMonth() + 1;
        const ini = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
        const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
        loadLancamentos(ini, fim);
    } else {
        loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim);
    }
    }, [mesAtual, filtrosAvancados.dataInicio, filtrosAvancados.dataFim, filtrosAvancados.dataModo]);

  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setCentroCustoFiltro(prev => prev || onlyId);
      setFormData((prev: typeof formData) => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
      setTransferData(prev => prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId });
    }
  }, [centros]);

  useEffect(() => {
    if (quickOpenNovoHandledRef.current) return;
    if (searchParams.get('novo') !== '1') return;
    if (!auxLoadedRef.current || contas.length === 0) return;

    openDrawer();
    const contaIdParam = Number(searchParams.get('conta_id') || '');
    if (Number.isFinite(contaIdParam) && contaIdParam > 0) {
      setFormData((prev: any) => ({ ...prev, conta_id: String(contaIdParam), cartao_id: '' }));
    }

    quickOpenNovoHandledRef.current = true;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('novo');
    nextParams.delete('conta_id');
    nextParams.delete('origem');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, contas.length]);

  useEffect(() => {
    const editarIdParam = Number(searchParams.get('editar_id') || '');
    if (!Number.isFinite(editarIdParam) || editarIdParam <= 0) return;
    if (!auxLoadedRef.current) return;

    let cancelled = false;
    const openEditById = async () => {
      try {
        const res = await api.get(`/lancamentos/${editarIdParam}`);
        if (cancelled) return;
        openDrawer(res.data);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          pushToast('error', 'Não foi possível abrir o lançamento para edição.');
        }
      } finally {
        if (cancelled) return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('editar_id');
        nextParams.delete('origem');
        setSearchParams(nextParams, { replace: true });
      }
    };

    void openEditById();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  async function loadAuxData() {
    if (auxLoadedRef.current) return;
    try {
      const [rC, rCt, rCC, rE, rCat] = await Promise.all([
        api.get('/contas/', { params: { include_saldo: true } }),
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
      const [rE, rCat, rC] = await Promise.all([
        fetchEntidadesLookup(true),
        fetchPlanoContas(true),
        api.get('/contas/', { params: { include_saldo: true } })
      ]);
      setEntidades(rE);
      setCategorias(rCat);
      setContas(rC.data || []);
      pushToast('success', 'Cadastros e saldos sincronizados.');
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao sincronizar cadastros.');
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
      pushToast('error', 'Não foi possível marcar/desmarcar IPP.');
    }
  }

  async function handleBulkPay() {
    if (selectedIds.size === 0) return;
    if (!bulkPayData.conta_id) {
      pushToast('info', 'Selecione uma conta para baixar em lote.');
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
      await refreshLancamentosVisiveis();
      await refreshContasComSaldo();
      pushToast('success', 'Baixa em lote concluída.');
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao baixar em lote.');
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
      await refreshLancamentosVisiveis();
      await refreshContasComSaldo();
      pushToast('success', 'Lançamentos apagados com sucesso.');
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao apagar em lote.');
    } finally {
      setSaving(false);
    }
  }

  // --- LOGICA FILTRO ---
  const filteredList = useMemo(() => {
    const termoBusca = filtroTexto.trim().toLowerCase();
    const categoriasPorId = new Map(categorias.map((categoria: any) => [Number(categoria.id), String(categoria.nome || '')]));
    const entidadesPorId = new Map(entidades.map((entidade: any) => [Number(entidade.id), String(entidade.nome || entidade.razao_social || '')]));

    return lancamentos.filter(l => {
      // 1. Texto Global
      if (termoBusca) {
        const categoriaNome = categoriasPorId.get(Number(l.plano_contas_id)) || '';
        const interessadoNome = entidadesPorId.get(Number(l.entidade_id || 0)) || '';
        const blocoBusca = [
          l.descricao,
          categoriaNome,
          interessadoNome,
          l.data_vencimento,
          l.data_pagamento || '',
          formatDateShort(l.data_vencimento),
          formatDateShort(l.data_pagamento),
          formatDateExtenso(l.data_vencimento),
          l.data_pagamento ? formatDateExtenso(l.data_pagamento) : '',
          String(l.valor_previsto || ''),
          String(l.valor_pago || ''),
        ].join(' ').toLowerCase();

        if (!blocoBusca.includes(termoBusca)) return false;
      }
      
      // 2. Centro de Custo (Header)
      if (centroCustoFiltro && String(l.centro_custo_id) !== centroCustoFiltro) return false;

      // 2.5. Extrato por banco selecionado (somente pagos/recebidos)
      if (contaExtratoAtivaId !== null) {
        if (Number(l.conta_id || 0) !== contaExtratoAtivaId) return false;
        if (String(l.status).toUpperCase() !== 'PAGO') return false;
      }

      // 3. Filtros Rápidos
      const hoje = getTodayLocalYmd();
      const amanha = getTomorrowLocalYmd();
      if (filtroRapido === 'HOJE' && l.data_vencimento !== hoje) return false;
      if (filtroRapido === 'AMANHA' && l.data_vencimento !== amanha) return false;
      if (filtroRapido === 'IPP' && !l.ipp) return false;
      if (filtroRapido === 'ATRASADO' && !isLancamentoAtrasado(l)) return false;
      if (filtroRapido === 'EM_ABERTO' && l.status === 'PAGO') return false;

      // 4. Filtros Avançados
      if (filtrosAvancados.tipo !== 'TODOS' && l.tipo !== filtrosAvancados.tipo) return false;
      if (filtrosAvancados.status.length > 0 && !filtrosAvancados.status.includes(l.status)) return false;

      if (filtrosAvancados.centroCustoPresenca === 'COM' && !l.centro_custo_id) return false;
      if (filtrosAvancados.centroCustoPresenca === 'SEM' && !!l.centro_custo_id) return false;

      const dataComparacao = filtrosAvancados.dataModo === 'PAGAMENTO' ? (l.data_pagamento || '') : (l.data_vencimento || '');
      if (filtrosAvancados.dataInicio && (!dataComparacao || dataComparacao < filtrosAvancados.dataInicio)) return false;
      if (filtrosAvancados.dataFim && (!dataComparacao || dataComparacao > filtrosAvancados.dataFim)) return false;
      
      // Filtro de Contas (Multi)
      if (filtrosAvancados.contaIds.size > 0 && (!l.conta_id || !filtrosAvancados.contaIds.has(l.conta_id))) return false;
      // Filtro de Categorias (Multi)
      if (filtrosAvancados.categoriaIds.size > 0 && !filtrosAvancados.categoriaIds.has(l.plano_contas_id)) return false;

      return true;
    });
  }, [lancamentos, filtroTexto, centroCustoFiltro, filtroRapido, filtrosAvancados, contaExtratoAtivaId, categorias, entidades]);

  const contasFiltradas = useMemo(() => {
    return contas.filter(c => !centroCustoFiltro || String(c.centro_custo_id) === String(centroCustoFiltro));
  }, [contas, centroCustoFiltro]);

  useEffect(() => {
    const activeIds = new Set(contasAtivas.map((item) => Number(item.id)));
    setFiltrosAvancados((prev) => {
      if (prev.contaIds.size === 0) return prev;
      const filteredContaIds = new Set(Array.from(prev.contaIds).filter((id) => activeIds.has(Number(id))));
      if (filteredContaIds.size === prev.contaIds.size) return prev;
      return { ...prev, contaIds: filteredContaIds };
    });
  }, [contasAtivas]);

  const saldoContasTotal = useMemo(() => {
    return contasFiltradas.reduce((acc, conta) => acc + getContaSaldo(conta), 0);
  }, [contasFiltradas]);

  useEffect(() => {
    if (bulkPayData.conta_id && !contasFiltradas.some(c => String(c.id) === String(bulkPayData.conta_id))) {
      setBulkPayData(prev => ({ ...prev, conta_id: '' }));
    }
  }, [contasFiltradas, bulkPayData.conta_id]);

  useEffect(() => {
    if (contaExtratoAtivaId !== null && !contasFiltradas.some(c => Number(c.id) === contaExtratoAtivaId)) {
      setContaExtratoAtivaId(null);
    }
  }, [contasFiltradas, contaExtratoAtivaId]);

  // Agrupamento
  const { grouped, kpis } = useMemo(() => {
    const groups: Record<string, Lancamento[]> = {};
    let r = 0, d = 0;
    const categoriasOperacionaisResultado = buildOperationalCategoriaIds(categorias);

    filteredList.forEach(l => {
      if (!groups[l.data_vencimento]) groups[l.data_vencimento] = [];
      groups[l.data_vencimento].push(l);
      const origem = String((l as any).origem || '').toUpperCase();
      const contaNosResultados = categoriasOperacionaisResultado.has(Number(l.plano_contas_id));
      if (origem !== 'TRANSFERENCIA' && contaNosResultados) {
        if (l.tipo === 'RECEITA') r += Number(l.valor_previsto);
        else d += Number(l.valor_previsto);
      }
    });

    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    sortedDates.forEach(date => groups[date].sort((a, b) => b.valor_previsto - a.valor_previsto));

    return { grouped: { groups, sortedDates }, kpis: { r, d, s: r-d } };
  }, [filteredList, categorias]);

  const aiContexto = useMemo(() => {
    return {
      mesReferencia: mesAtual.toISOString().slice(0, 7),
      filtros: {
        texto: filtroTexto,
        centroCusto: centroCustoFiltro || null,
        possuiCentroCusto: filtrosAvancados.centroCustoPresenca,
        filtroRapido,
        tipo: filtrosAvancados.tipo,
        dataModo: filtrosAvancados.dataModo,
        dataInicio: filtrosAvancados.dataInicio || null,
        dataFim: filtrosAvancados.dataFim || null,
        contasSelecionadas: Array.from(filtrosAvancados.contaIds),
        categoriasSelecionadas: Array.from(filtrosAvancados.categoriaIds),
      },
      metricas: {
        totalFiltrado: filteredList.length,
        totalDiasComLancamento: grouped.sortedDates.length,
        receitas: kpis.r,
        despesas: kpis.d,
        saldo: kpis.s,
      },
      lookups: {
        categorias: categorias.slice(0, 200).map((c: any) => ({ id: c.id, nome: c.nome, tipo: c.tipo })),
        contas: contas.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome })),
        centros: centros.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome })),
        entidades: entidades.slice(0, 200).map((e: any) => ({ id: e.id, nome: e.nome })),
        cartoes: cartoes.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome_cartao })),
      },
      extratoContaAtivaId: contaExtratoAtivaId,
    };
  }, [mesAtual, filtroTexto, centroCustoFiltro, filtroRapido, filtrosAvancados, filteredList.length, grouped.sortedDates.length, kpis, categorias, contas, centros, entidades, cartoes, contaExtratoAtivaId]);

  const assistenteConfig = useMemo(() => ({
    tela: 'lancamentos' as const,
    titulo: 'Assistente KyrusTECH',
    contexto: aiContexto,
    lookups: {
      categorias: categorias.slice(0, 200).map((item: any) => ({ id: item.id, nome: item.nome, tipo: item.tipo })),
      contas: contas.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome })),
      centros: centros.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome })),
      entidades: entidades.slice(0, 200).map((item: any) => ({ id: item.id, nome: item.nome })),
      cartoes: cartoes.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome_cartao })),
    },
    sugestoes: [
      'O que os lancamentos desta tela mostram?',
      'Como reduzir pendencias e atrasos?',
      'Leia este comprovante e sugira a classificacao.',
      'Qual filtro usar para investigar melhor o resultado?',
    ],
  }), [aiContexto, categorias, contas, centros, entidades, cartoes]);

  useAssistentePage(assistenteConfig);

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

  useEffect(() => {
    if (!formData?.id || !formData?.data_vencimento || sortedParcelasSerie.length === 0) return;
    setParcelasVencimentosEdit((prev) => ({ ...prev, [formData.id]: formData.data_vencimento }));
  }, [formData?.id, formData?.data_vencimento, sortedParcelasSerie.length]);

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
      if (checked && (!prev.valor_pago || Number(prev.valor_pago) === 0)) {
        next.valor_pago = prev.valor_previsto;
      }
      return next;
    });
  };

  const handleValorPrevistoChange = (value: string) => {
    setFormData((prev: any) => {
      const next = { ...prev, valor_previsto: value };
      const valorPagoAtual = Number(prev.valor_pago || 0);
      const valorPrevistoAnterior = Number(prev.valor_previsto || 0);

      if (
        prev.status === 'PAGO' &&
        (!prev.valor_pago || valorPagoAtual === 0 || valorPagoAtual === valorPrevistoAnterior)
      ) {
        next.valor_pago = value;
      }

      return next;
    });
  };

  const handleValorPagoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, valor_pago: value }));
  };

  const resetFiltros = () => {
    setFiltrosAvancados({ tipo: 'TODOS', status: [], contaIds: new Set(), categoriaIds: new Set(), centroCustoPresenca: 'TODOS', dataModo: 'VENCIMENTO', dataInicio: '', dataFim: '' });
    setFiltroTexto('');
    setCentroCustoFiltro('');
    setFiltroRapido(null);
    setContaExtratoAtivaId(null);
    setMesAtual(new Date());
  };

  const toggleMainSidebar = () => {
    window.dispatchEvent(new CustomEvent('kyrus:sidebar-toggle'));
  };

  const handleDataPagamentoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, data_pagamento: value }));
  };
  
  function openDrawer(l?: Lancamento, options?: { preserveSeriePanel?: boolean }) {
    let nextFormData: any;
    if(l) {
      if (isTransferencia(l)) return;
      setIsEditing(true);
      autoPagamentoRef.current = !l.data_pagamento;
      autoCompetenciaRef.current = !l.competencia;
      nextFormData = {
        ...l, 
        data_vencimento: l.cartao_id ? (l.data_competencia || l.data_vencimento) : l.data_vencimento,
        conta_id: l.conta_id||'', cartao_id: l.cartao_id||'', centro_custo_id: l.centro_custo_id||'', entidade_id: l.entidade_id||'',
        plano_contas_id: l.plano_contas_id, valor_previsto: l.valor_previsto, 
        valor_pago: l.valor_pago||l.valor_previsto, data_pagamento: l.data_pagamento||l.data_vencimento,
        previsto: l.previsto ?? true,
        observacao: l.observacao || '',
        competencia: l.competencia || formatCompetencia(l.data_competencia || l.data_vencimento),
        competencia_modo_parcelamento: 'POR_PARCELA'
      };
      setInitialScopedFields({
        descricao: String(l.descricao || ''),
        plano_contas_id: String(l.plano_contas_id || ''),
        data_vencimento: String(l.data_vencimento || ''),
      });
      setShowParcelasSeriePanel(Boolean(options?.preserveSeriePanel));
      setParcelasEscopoEdicao('ESTA');
      setAjustarParaDiaUtil(false);
      void loadParcelasSerie(l.id_parcelamento, l);
    } else {
      setIsEditing(false);
      autoPagamentoRef.current = true;
      autoCompetenciaRef.current = true;
      nextFormData = {
        id: null, descricao: '', valor_previsto: '', data_vencimento: new Date().toISOString().split('T')[0],
        tipo: 'DESPESA', plano_contas_id: '', 
        centro_custo_id: centroCustoFiltro || '', 
        entidade_id: '', conta_id: '', cartao_id: '',
        status: 'PENDENTE', valor_pago: '', data_pagamento: new Date().toISOString().split('T')[0], ipp: false, previsto: true,
        observacao: '',
        competencia: formatCompetencia(new Date().toISOString().split('T')[0]),
        is_parcelado: false, qtd_parcelas: 2, modo_calculo: 'TOTAL', competencia_modo_parcelamento: 'POR_PARCELA', anexos: []
      };
      setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
      setShowParcelasSeriePanel(false);
      setParcelasSerie([]);
      setParcelasVencimentosEdit({});
      setParcelasEscopoEdicao('ESTA');
      setAjustarParaDiaUtil(false);
    }
    setFormData(nextFormData);
    setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(nextFormData));
    setFilesToUpload(null);
    setShowDrawer(true);
  }

  // --- FUNÇÃO RECUPERADA (FIX) ---
  async function handleCreateEntity() {
    if(!newEntityData.nome) {
      pushToast('info', 'Digite o nome do interessado.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/entidades/', {
          nome: newEntityData.nome.trim(),
          tipo: newEntityData.tipo,
          tipo_pessoa: newEntityData.tipo_pessoa,
          nome_fantasia: nullableValue(newEntityData.nome_fantasia),
          cpf_cnpj: nullableValue(onlyDigits(newEntityData.cpf_cnpj)),
          email: nullableValue(newEntityData.email),
          telefone: nullableValue(onlyDigits(newEntityData.telefone)),
          celular: nullableValue(onlyDigits(newEntityData.celular)),
          contato_nome: nullableValue(newEntityData.contato_nome),
          cep: nullableValue(onlyDigits(newEntityData.cep)),
          logradouro: nullableValue(newEntityData.logradouro),
          numero: nullableValue(newEntityData.numero),
          complemento: nullableValue(newEntityData.complemento),
          bairro: nullableValue(newEntityData.bairro),
          cidade: nullableValue(newEntityData.cidade),
          uf: nullableValue(newEntityData.uf.toUpperCase().slice(0, 2)),
          observacoes: nullableValue(newEntityData.observacoes),
          status: 'ATIVO'
      });
      setEntidades(prev => [...prev, res.data]);
      setFormData((prev:any) => ({...prev, entidade_id: res.data.id}));
      closeEntityDrawer();
      setNewEntityData(initialQuickEntityData);
      pushToast('success', 'Interessado criado com sucesso.');
    } catch(e) {
      pushToast('error', 'Erro ao criar interessado.');
    } finally { setSaving(false); }
  }

  async function handleTransferencia() {
    if(!transferData.valor || !transferData.conta_origem_id || !transferData.conta_destino_id) {
      pushToast('info', 'Preencha os campos obrigatórios da transferência.');
      return;
    }
    setSaving(true);
    try {
        await api.post('/lancamentos/transferir', {
            ...transferData, 
            valor: parseFloat(transferData.valor),
            centro_custo_id: transferData.centro_custo_id ? parseInt(transferData.centro_custo_id) : null
        });
        pushToast('success', 'Transferência realizada com sucesso!');
        setShowTransfer(false);
        await refreshLancamentosVisiveis();
        await refreshContasComSaldo();
    } catch(e) {
      pushToast('error', 'Erro na transferência.');
    } finally { setSaving(false); }
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if(!formData.descricao || !formData.valor_previsto || !formData.plano_contas_id) {
      pushToast('info', 'Preencha os campos obrigatórios.');
      return;
    }
    if(!formData.entidade_id) {
      pushToast('info', 'Interessado é obrigatório.');
      return;
    }

    const isNovoLancamento = !formData.id;
    const dataLimiteRetroativa = getLocalYmdDaysAgo(2);

    if (isNovoLancamento) {
      const dataBaseNovo = formData.status === 'PAGO'
        ? (formData.data_pagamento || formData.data_vencimento)
        : formData.data_vencimento;
      if (dataBaseNovo && dataBaseNovo < dataLimiteRetroativa) {
        const confirmarRetroativo = window.confirm('Este lançamento possui data anterior a 2 dias atrás. Verifique se a data está correta e, se sim, confirme para lançar.');
        if (!confirmarRetroativo) {
          pushToast('info', 'Lançamento cancelado para revisão da data.');
          return;
        }
      }
    }

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
        const idParcelamento = crypto.randomUUID();
        const lista = [];
        const qtd = formData.qtd_parcelas;
        const [ano, mes, dia] = formData.data_vencimento.split('-').map(Number);
        let val = formData.modo_calculo === 'TOTAL' ? payload.valor_previsto/qtd : payload.valor_previsto;
        
        for(let i=0; i<qtd; i++) {
          const dt = new Date(ano, (mes-1)+i, dia);
          const dataParcela = dt.toISOString().split('T')[0];
          const vencimentoParcela = formData.cartao_id
            ? (computeCartaoVencimento(dataParcela, formData.cartao_id) || dataParcela)
            : dataParcela;
          const competenciaBase = formData.competencia_modo_parcelamento === 'MES_COMPRA'
            ? formData.data_vencimento
            : dataParcela;
          lista.push({
            ...payload,
            valor_previsto: val,
            data_vencimento: vencimentoParcela,
            data_competencia: competenciaBase,
            competencia: formatCompetencia(competenciaBase),
            id_parcelamento: idParcelamento,
            descricao: `${payload.descricao} (${i+1}/${qtd})`, numero_parcela: i+1,
            status: (i===0 && payload.status==='PAGO') ? 'PAGO' : 'PENDENTE',
            valor_pago: (i===0 && payload.status==='PAGO') ? payload.valor_pago : 0
          });
        }

        const parcelasRetroativas = lista.filter((item: any) => String(item.data_vencimento || '') < dataLimiteRetroativa).length;
        if (parcelasRetroativas > 0) {
          const confirmarParcelasRetroativas = window.confirm(
            `${parcelasRetroativas} parcela(s) possuem data anterior a 2 dias atrás. Verifique se as datas estão corretas e, se sim, confirme para lançar.`,
          );
          if (!confirmarParcelasRetroativas) {
            pushToast('info', 'Lançamento parcelado cancelado para revisão das datas.');
            setSaving(false);
            return;
          }
        }

        await api.post('/lancamentos/bulk', lista);
      } else {
        if (id && isEditingParcelado) {
          const scopedDescricaoChanged = String(formData.descricao || '') !== String(initialScopedFields.descricao || '');
          const scopedCategoriaChanged = String(formData.plano_contas_id || '') !== String(initialScopedFields.plano_contas_id || '');
          const scopedVencimentoChanged = String(formData.data_vencimento || '') !== String(initialScopedFields.data_vencimento || '');
          const hasScopedChange = scopedDescricaoChanged || scopedCategoriaChanged || scopedVencimentoChanged;

          const serieOrdenada = sortedParcelasSerie.length > 0 ? sortedParcelasSerie : [formData as Lancamento];
          const shouldApplyScoped = hasScopedChange && serieOrdenada.length > 1;

          if (!shouldApplyScoped) {
            await api.put(`/lancamentos/${id}`, payload);
          } else {
            const parcelaAtual = Number(currentParcelaNumber || 1);
            const parcelasAlvo = serieOrdenada.filter((item) => {
              const numero = Number(item.numero_parcela || 0);
              if (parcelasEscopoEdicao === 'TODAS') return true;
              if (parcelasEscopoEdicao === 'PROXIMAS') return numero >= parcelaAtual;
              return Number(item.id) === Number(id);
            });

            const updatePromises = parcelasAlvo.map(async (item) => {
              const rowVencimento = parcelasVencimentosEdit[item.id] || item.data_vencimento;
              const nextVencimento = scopedVencimentoChanged
                ? (ajustarParaDiaUtil ? toNextBusinessDay(rowVencimento) : rowVencimento)
                : item.data_vencimento;

              const rowPayload: any = {
                conta_id: item.conta_id || null,
                centro_custo_id: item.centro_custo_id || null,
                entidade_id: item.entidade_id || null,
                cartao_id: item.cartao_id || null,
                tipo: item.tipo,
                previsto: item.previsto ?? true,
                status: item.status,
                valor_previsto: Number(item.valor_previsto || 0),
                valor_pago: Number(item.valor_pago || 0),
                data_pagamento: item.data_pagamento || null,
                descricao: scopedDescricaoChanged ? payload.descricao : item.descricao,
                plano_contas_id: scopedCategoriaChanged ? payload.plano_contas_id : item.plano_contas_id,
                data_vencimento: nextVencimento,
                competencia: formatCompetencia(nextVencimento),
                data_competencia: nextVencimento,
                observacao: item.observacao || null,
                conciliado: item.conciliado ?? false,
                ipp: item.ipp ?? false,
                id_parcelamento: item.id_parcelamento || formData.id_parcelamento || null,
                numero_parcela: item.numero_parcela || null,
              };

              if (Number(item.id) === Number(id)) {
                rowPayload.status = payload.status;
                rowPayload.valor_pago = payload.valor_pago;
                rowPayload.data_pagamento = payload.data_pagamento;
                rowPayload.conta_id = payload.conta_id;
                rowPayload.cartao_id = payload.cartao_id;
                rowPayload.centro_custo_id = payload.centro_custo_id;
                rowPayload.entidade_id = payload.entidade_id;
                rowPayload.previsto = payload.previsto;
                rowPayload.ipp = payload.ipp;
                rowPayload.observacao = payload.observacao;
              }

              await api.put(`/lancamentos/${item.id}`, rowPayload);
            });

            await Promise.all(updatePromises);
          }
        } else if(id) await api.put(`/lancamentos/${id}`, payload);
        else { const r = await api.post('/lancamentos/', payload); id = r.data.id; }
        
        if(filesToUpload && id) {
          const fd = new FormData();
          for(let i=0; i<filesToUpload.length; i++) fd.append('files', filesToUpload[i]);
          await api.post(`/lancamentos/${id}/anexos`, fd);
        }
      }
      closeDrawerDirect();
      // Recarrega inteligente
      if(filtrosAvancados.dataModo === 'PAGAMENTO' && (filtrosAvancados.dataInicio || filtrosAvancados.dataFim)) loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
      else if(filtrosAvancados.dataInicio) loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
      else { const ano = mesAtual.getFullYear(); const mes = mesAtual.getMonth() + 1; loadLancamentos(new Date(ano, mes-1, 1).toISOString().split('T')[0], new Date(ano, mes, 0).toISOString().split('T')[0], { force: true }); }
      await refreshContasComSaldo();
      pushToast('success', isEditing ? 'Lançamento atualizado com sucesso.' : 'Lançamento salvo com sucesso.');
    } catch(e) {
      pushToast('error', 'Erro ao salvar lançamento.');
    } finally { setSaving(false); }
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
    { label: 'SAIDAS', options: categorias.filter(c=> (c.tipo||'').trim().toUpperCase().startsWith('D')).map(c=>({id:c.id, label:c.nome, tipo: c.tipo, grupo: 'SAIDAS', disabled: c.eh_cabecalho || c.permite_lancamentos === false, eh_cabecalho: c.eh_cabecalho, permite_lancamentos: c.permite_lancamentos})) },
    { label: 'ENTRADAS', options: categorias.filter(c=> (c.tipo||'').trim().toUpperCase().startsWith('R')).map(c=>({id:c.id, label:c.nome, tipo: c.tipo, grupo: 'ENTRADAS', disabled: c.eh_cabecalho || c.permite_lancamentos === false, eh_cabecalho: c.eh_cabecalho, permite_lancamentos: c.permite_lancamentos})) }
  ];

  const entidadeOptions = [
    {
      label: 'Interessados',
      options: [
        { id: '', label: 'Selecione...' },
        ...entidades
          .slice()
          .sort((a: any, b: any) => String(a?.nome || '').localeCompare(String(b?.nome || ''), 'pt-BR'))
          .map((e: any) => ({ id: e.id, label: e.nome || e.razao_social || `Interessado ${e.id}` })),
      ],
    },
  ];

  const quickFilterOptions = [
    {id: null, label: 'Todos'},
    {id: 'HOJE', label: 'Vencem Hoje', icon: CalendarClock},
    {id: 'AMANHA', label: 'Vcto Amanhã', icon: CalendarClock},
    {id: 'ATRASADO', label: 'Atrasados', icon: AlertCircle},
    {id: 'IPP', label: 'IPP', icon: LayoutGrid},
    {id: 'EM_ABERTO', label: 'Em Aberto', icon: Layers}
  ];

  const filtrosAtivosCount = [
    filtroTexto ? 1 : 0,
    centroCustoFiltro ? 1 : 0,
    filtroRapido ? 1 : 0,
    filtrosAvancados.tipo !== 'TODOS' ? 1 : 0,
    filtrosAvancados.centroCustoPresenca !== 'TODOS' ? 1 : 0,
    filtrosAvancados.dataInicio || filtrosAvancados.dataFim ? 1 : 0,
    filtrosAvancados.contaIds.size > 0 ? 1 : 0,
    filtrosAvancados.categoriaIds.size > 0 ? 1 : 0,
    contaExtratoAtivaId !== null ? 1 : 0,
  ].filter(Boolean).length;

  const kpiCards = [
    { label: 'Receitas', value: BRL.format(kpis.r), tone: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 dark:bg-emerald-900/20', icon: TrendingUp },
    { label: 'Despesas', value: BRL.format(kpis.d), tone: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 dark:bg-red-900/20', icon: TrendingDown },
    { label: 'Saldo', value: BRL.format(kpis.s), tone: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10 dark:bg-blue-900/20', icon: Wallet },
  ];

  return (
    <div className="flex h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-hidden relative">
      <aside className={`hidden xl:flex h-full shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/80 backdrop-blur-xl transition-all duration-300 ${filtrosRailCollapsed ? 'w-24' : 'w-90'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 p-3">
          {!filtrosRailCollapsed && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">Console</p>
              <h2 className="text-sm font-black text-slate-800 dark:text-slate-100">Filtros e contexto</h2>
            </div>
          )}
          <div className={`flex items-center gap-2 ${filtrosRailCollapsed ? 'w-full flex-col' : ''}`}>
            <button
              type="button"
              onClick={toggleMainSidebar}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Recolher ou expandir menu principal"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setFiltrosRailCollapsed((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              title={filtrosRailCollapsed ? 'Expandir barra lateral da tela' : 'Retrair barra lateral da tela'}
            >
              {filtrosRailCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {filtrosRailCollapsed ? (
          <div className="flex flex-1 flex-col items-center gap-3 px-3 py-4">
            <button type="button" onClick={() => setResumoTopoModo('KPIS')} className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${resumoTopoModo === 'KPIS' ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`} title="KPIs"><TrendingUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => setResumoTopoModo('BANCOS')} className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${resumoTopoModo === 'BANCOS' ? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`} title="Bancos"><Landmark className="h-4 w-4" /></button>
            <button type="button" onClick={() => setFiltroRapido('ATRASADO')} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" title="Atrasados"><AlertCircle className="h-4 w-4" /></button>
            <div className="mt-2 flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 px-2 py-3 text-center dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Ativos</span>
              <span className="text-lg font-black text-slate-700 dark:text-slate-200">{filtrosAtivosCount}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-4 custom-scrollbar">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <select className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" value={centroCustoFiltro} onChange={e=>setCentroCustoFiltro(e.target.value)}>
                <option value="">Todos os centros de custo</option>
                {centros.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Filtros rápidos</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">{filteredList.length} itens</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {quickFilterOptions.map((f) => (
                  <button key={String(f.id)} onClick={()=>setFiltroRapido(f.id as any)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${filtroRapido===f.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                    {f.icon && <f.icon className="w-3 h-3"/>}
                    {f.label}
                  </button>
                ))}
              </div>
              {contaExtratoAtivaId !== null && (
                <button onClick={() => setContaExtratoAtivaId(null)} className="flex w-full items-center justify-between rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-left text-xs font-bold text-cyan-700 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300">
                  <span>Extrato filtrado: {contas.find(c => Number(c.id) === contaExtratoAtivaId)?.nome || `Conta ${contaExtratoAtivaId}`}</span>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="mb-3 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
                <button onClick={() => setResumoTopoModo('KPIS')} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${resumoTopoModo === 'KPIS' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'}`}>KPIs</button>
                <button onClick={() => setResumoTopoModo('BANCOS')} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${resumoTopoModo === 'BANCOS' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'}`}>Bancos</button>
              </div>

              {resumoTopoModo === 'KPIS' ? (
                <div className="space-y-2.5">
                  {kpiCards.map((card) => (
                    <div key={card.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/80">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{card.label}</p>
                        <p className={`text-lg font-black ${card.tone}`}>{card.value}</p>
                      </div>
                      <div className={`rounded-xl p-2 ${card.bg}`}><card.icon className={`h-4 w-4 ${card.tone}`} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between pb-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Saldos por banco</span>
                    <button onClick={() => setBancosRetratilFechado(prev => !prev)} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" title={bancosRetratilFechado ? 'Expandir' : 'Recolher'}>
                      <ChevronDown className={`h-4 w-4 transition-transform ${bancosRetratilFechado ? '-rotate-90' : ''}`} />
                    </button>
                  </div>
                  {!bancosRetratilFechado && (
                    <>
                      <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${saldoContasTotal >= 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'}`}>
                        Total em bancos: {BRL.format(saldoContasTotal)}
                      </div>
                      <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                        {contasFiltradas.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Nenhuma conta encontrada para os filtros atuais.</div>
                        ) : (
                          contasFiltradas.map((conta) => {
                            const saldo = getContaSaldo(conta);
                            const logo = getFullLogoUrl(conta.logo_url);
                            const ativo = Number(conta.id) === contaExtratoAtivaId;
                            return (
                              <button key={conta.id} type="button" onClick={() => {
                                setContaExtratoAtivaId((prev) => {
                                  if (prev === Number(conta.id)) return null;
                                  setFiltroRapido(null);
                                  return Number(conta.id);
                                });
                              }} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${ativo ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-slate-700'}`}>
                                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                                  <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={conta.nome} integrationType={conta.tipo_integracao} size="sm" className="h-9 w-9" imageClassName="rounded-full" fallbackClassName="rounded-full border-0 shadow-none" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-100">{conta.nome}</p>
                                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{conta.banco || conta.tipo || 'Conta bancária'}</p>
                                </div>
                                <div className={`text-sm font-black ${saldo >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{BRL.format(saldo)}</div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Filtros avançados</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{filtrosAtivosCount} ativo(s)</p>
                </div>
                <button onClick={resetFiltros} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Limpar</button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase text-slate-400">Tipo de lançamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['TODOS','RECEITA','DESPESA'].map(t => (
                      <button key={t} onClick={()=>setFiltrosAvancados(prev=>({...prev, tipo: t as any}))} className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${filtrosAvancados.tipo===t ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{t}</button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className="rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white" value={filtrosAvancados.dataInicio} onChange={e=>setFiltrosAvancados({...filtrosAvancados, dataInicio:e.target.value})} />
                  <input type="date" className="rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-white" value={filtrosAvancados.dataFim} onChange={e=>setFiltrosAvancados({...filtrosAvancados, dataFim:e.target.value})} />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase text-slate-400">Filtrar datas por</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'VENCIMENTO', label: 'Vencimento' },
                      { id: 'PAGAMENTO', label: 'Pagamento' },
                    ].map((modo) => (
                      <button
                        key={modo.id}
                        onClick={() => setFiltrosAvancados(prev => ({ ...prev, dataModo: modo.id as 'VENCIMENTO' | 'PAGAMENTO' }))}
                        className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${filtrosAvancados.dataModo === modo.id ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                      >
                        {modo.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase text-slate-400">Centro de custo no lançamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'TODOS', label: 'Todos' },
                      { id: 'COM', label: 'Com CC' },
                      { id: 'SEM', label: 'Sem CC' },
                    ].map((opcao) => (
                      <button
                        key={opcao.id}
                        onClick={() => setFiltrosAvancados(prev => ({ ...prev, centroCustoPresenca: opcao.id as 'TODOS' | 'COM' | 'SEM' }))}
                        className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${filtrosAvancados.centroCustoPresenca === opcao.id ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                      >
                        {opcao.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase text-slate-400">Contas e bancos</label>
                  <div className="flex flex-wrap gap-2">
                    {contasAtivas.map(c => {
                      const active = filtrosAvancados.contaIds.has(c.id);
                      const logo = getFullLogoUrl(c.logo_url);
                      return (
                        <button key={c.id} onClick={()=>{
                          const newSet = new Set(filtrosAvancados.contaIds);
                          if(active) newSet.delete(c.id); else newSet.add(c.id);
                          setFiltrosAvancados({...filtrosAvancados, contaIds:newSet});
                        }} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition flex items-center gap-1 ${active ? 'border-emerald-600 bg-emerald-600/15 text-emerald-600 dark:text-emerald-400' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                          <BankAvatar logoUrl={logo} bankName={c.banco} accountName={c.nome} integrationType={c.tipo_integracao} size="sm" className="h-4 w-4" imageClassName="rounded-full" fallbackClassName="rounded-full border-0 shadow-none" />
                          {c.nome}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <MultiSelectDropdown label="Categorias" placeholder="Selecione categorias..." options={categorias} selectedIds={filtrosAvancados.categoriaIds} onChange={(s:any)=>setFiltrosAvancados({...filtrosAvancados, categoriaIds:s})} />
              </div>
            </section>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1 flex flex-col h-full overflow-hidden">
      
      {/* 1. TOP HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 z-20 shadow-md">
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 shadow-inner border border-slate-200 dark:border-transparent">
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()-1)))} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"><ChevronLeft className="w-4 h-4"/></button>
            <span className="w-32 text-center text-xs font-bold uppercase pt-1 text-slate-800 dark:text-white">{mesAtual.toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</span>
            <button onClick={()=>setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth()+1)))} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"><ChevronRight className="w-4 h-4"/></button>
          </div>
          <button onClick={()=>loadLancamentos(undefined, undefined, { force: true })} className="p-2 text-slate-500 hover:text-blue-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-blue-500 transition-colors" title="Sincronizar lançamentos"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/></button>
          <button onClick={syncCadastros} className="p-2 text-slate-500 hover:text-emerald-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-emerald-500 transition-colors" title="Sincronizar cadastros"><Layers className="w-4 h-4"/></button>
          </div>
          <div className="relative hidden min-w-0 flex-1 xl:block xl:max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar descrição, data, categoria, interessado ou valor"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              value={filtroTexto}
              onChange={e=>setFiltroTexto(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 w-full flex flex-col sm:flex-row gap-2 sm:items-center xl:hidden">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500"/>
                <input type="text" placeholder="Pesquisar descrição, data, categoria, interessado ou valor" className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none transition" value={filtroTexto} onChange={e=>setFiltroTexto(e.target.value)}/>
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
          <button onClick={() => setFiltrosRailCollapsed((prev) => !prev)} className="hidden xl:flex px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-bold items-center gap-2 transition-all justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"><Filter className="w-4 h-4"/> Painel</button>
          <button onClick={()=>setShowFiltrosSidebar(true)} className={`xl:hidden px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm font-bold flex items-center gap-2 transition-all w-full sm:w-auto justify-center ${showFiltrosSidebar ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'}`}><Filter className="w-4 h-4"/> <span className="hidden lg:inline">Filtros</span></button>
          <button onClick={()=>openDrawer()} className="px-5 py-2 rounded-lg shadow-lg text-white font-bold text-sm flex gap-2 hover:brightness-110 transition bg-blue-600 hover:bg-blue-500 w-full sm:w-auto justify-center"><Plus className="w-4 h-4"/> Novo</button>
        </div>
      </header>

      <div className="px-4 sm:px-6 pt-3 pb-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 xl:hidden">
        <div className="flex gap-2 overflow-x-auto custom-scrollbar">
          {quickFilterOptions.map(f => (
            <button key={String(f.id)} onClick={()=>setFiltroRapido(f.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap
              ${filtroRapido===f.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              {f.icon && <f.icon className="w-3 h-3"/>} {f.label}
            </button>
          ))}
          {contaExtratoAtivaId !== null && (
            <button
              onClick={() => setContaExtratoAtivaId(null)}
              className="px-3 py-1.5 rounded-full text-xs font-bold border border-cyan-300 bg-cyan-50 text-cyan-700 dark:bg-cyan-900/25 dark:border-cyan-700 dark:text-cyan-300 flex items-center gap-1.5 whitespace-nowrap"
            >
              Extrato: {contas.find(c => Number(c.id) === contaExtratoAtivaId)?.nome || `Conta ${contaExtratoAtivaId}`}
              <X className="w-3 h-3"/>
            </button>
          )}
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm self-end lg:self-auto">
          <button
            onClick={() => setResumoTopoModo('KPIS')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${resumoTopoModo === 'KPIS' ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
          >
            KPIs
          </button>
          <button
            onClick={() => setResumoTopoModo('BANCOS')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${resumoTopoModo === 'BANCOS' ? 'bg-emerald-600 text-white' : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
          >
            Bancos e Saldos
          </button>
        </div>
      </div>

      {/* 2. KPI SECTION */}
      <div className="xl:hidden">
      {resumoTopoModo === 'KPIS' ? (
        <div className="px-4 sm:px-6 pt-2 pb-1 grid grid-cols-1 md:grid-cols-3 gap-3">
          {kpiCards.map((card) => (
            <div key={card.label} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex justify-between items-center transition hover:border-slate-300 dark:hover:border-slate-600"><div className={card.tone}><p className="text-[10px] font-bold uppercase mb-0.5 opacity-70">{card.label}</p><p className="text-xl font-black">{card.value}</p></div><div className={`p-1.5 rounded-lg ${card.bg}`}><card.icon className={`w-5 h-5 ${card.tone}`}/></div></div>
          ))}
        </div>
      ) : (
        <div className="px-4 sm:px-6 pt-2 pb-1">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="p-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div>
                <p className="text-[10px] font-bold uppercase opacity-70 text-slate-500 dark:text-slate-400">Bancos</p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Saldos por conta (atualizados)</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`px-2.5 py-1 rounded-full text-xs font-bold border ${saldoContasTotal >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800' : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800'}`}>
                  Total: {BRL.format(saldoContasTotal)}
                </div>
                <button
                  onClick={() => setBancosRetratilFechado(prev => !prev)}
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  title={bancosRetratilFechado ? 'Expandir' : 'Recolher'}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${bancosRetratilFechado ? '-rotate-90' : 'rotate-0'}`} />
                </button>
              </div>
            </div>

            {!bancosRetratilFechado && (
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {contasFiltradas.length === 0 ? (
                  <div className="col-span-full p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <Landmark className="w-4 h-4" />
                    Nenhuma conta bancária encontrada para os filtros atuais.
                  </div>
                ) : (
                  contasFiltradas.map((conta) => {
                    const saldo = getContaSaldo(conta);
                    const logo = getFullLogoUrl(conta.logo_url);
                    const ativo = Number(conta.id) === contaExtratoAtivaId;
                    return (
                      <button
                        type="button"
                        key={conta.id}
                        onClick={() => {
                          setContaExtratoAtivaId((prev) => {
                            if (prev === Number(conta.id)) return null;
                            setFiltroRapido(null);
                            return Number(conta.id);
                          });
                        }}
                        className={`p-3 rounded-xl border text-left transition flex items-center gap-3 ${ativo ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-900/25' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-600'}`}
                        title={ativo ? 'Clique para remover filtro de extrato deste banco' : 'Clique para ver somente lançamentos pagos/recebidos deste banco'}
                      >
                        <div className="w-10 h-10 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center shrink-0">
                          <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={conta.nome} integrationType={conta.tipo_integracao} size="sm" className="w-9 h-9" imageClassName="rounded-full" fallbackClassName="rounded-full border-0 shadow-none" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-bold truncate ${ativo ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-100'}`}>{conta.nome}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{conta.banco || conta.tipo || 'Conta bancária'}</p>
                        </div>
                        <div className={`text-sm font-black ${saldo >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {BRL.format(saldo)}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
              <div key={date} className="mb-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-4 mb-1.5 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 py-1.5 border-b border-slate-200 dark:border-slate-800">
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
                            <th className="p-2.5 w-12 text-center">Sel</th>
                            <th className="p-2.5 w-12 text-center">IPP</th>
                            <th className="p-2.5">Descrição</th>
                            <th className="p-2.5 hidden md:table-cell">Interessado / Categoria</th>
                            <th className="p-2.5 text-right">Valor</th>
                            <th className="p-2.5 text-center w-24">Status</th>
                          </tr>
                        </thead>
                        <tbody className="text-[15px] divide-y divide-slate-200 dark:divide-slate-700">
                          {grouped.groups[date].map(l => {
                                    const atrasado = isLancamentoAtrasado(l);
                                    const pago = String(l.status).toUpperCase() === 'PAGO';
                                    const statusLabel = pago ? 'PAGO' : atrasado ? 'ATRASADO' : l.status;
                                    return (
                                    <tr key={l.id} onClick={() => { if (!isTransferencia(l)) openDrawer(l); }} className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition group ${isTransferencia(l) ? 'cursor-default' : 'cursor-pointer'} ${selectedIds.has(l.id)?'bg-blue-100/80 dark:bg-blue-900/25': pago ? 'bg-emerald-100/70 dark:bg-emerald-900/25' : atrasado ? 'bg-red-200/80 dark:bg-red-900/40' : ''}`}>
                                      <td className="p-2.5 w-12 text-center" onClick={e=>e.stopPropagation()}>
                                        <button
                                          type="button"
                                          aria-label="Selecionar lançamento"
                                          onClick={() => {
                                            const s = new Set(selectedIds);
                                            if (s.has(l.id)) s.delete(l.id); else s.add(l.id);
                                            setSelectedIds(s);
                                          }}
                                          className={`w-7 h-7 rounded border flex items-center justify-center transition pointer-events-auto ${selectedIds.has(l.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-blue-400'}`}
                                        >
                                          <Check className={`w-3 h-3 ${selectedIds.has(l.id) ? 'opacity-100' : 'opacity-0'}`} />
                                        </button>
                                      </td>
                                        <td className="p-2.5 w-12 text-center" onClick={(e)=>e.stopPropagation()} onMouseDown={(e)=>e.stopPropagation()}>
                                          <button
                                            type="button"
                                            onMouseDown={(e)=>e.stopPropagation()}
                                            onClick={(e)=>{e.stopPropagation(); toggleIpp(l);}}
                                            disabled={isTransferencia(l)}
                                            className={`w-7 h-7 rounded border flex items-center justify-center transition pointer-events-auto ${l.ipp?'bg-purple-600 border-purple-600 text-white':'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-purple-400'} ${isTransferencia(l) ? 'cursor-not-allowed opacity-40' : ''}`}
                                            title="Marcar como IPP"
                                            aria-pressed={l.ipp}
                                          >
                                            <Check className="w-3 h-3"/>
                                          </button>
                                        </td>
                                        <td className="p-2.5 font-semibold text-slate-800 dark:text-white">
                                            <div className="flex items-center gap-2">{l.descricao} {l.anexos?.length > 0 && <Paperclip className="w-3 h-3 text-blue-400"/>}</div>
                                            {l.numero_parcela && <span className="text-[10px] text-slate-500">Parcela {l.numero_parcela}</span>}
                                        </td>
                                        <td className="p-2.5 hidden md:table-cell">
                                          <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{entidades.find(e=>e.id===l.entidade_id)?.nome || '-'}</div>
                                          <div className="text-[12px] text-slate-500">{getCategoriaLabel(l)}</div>
                                        </td>
                                        <td className={`p-2.5 text-right font-bold ${l.tipo==='RECEITA'?'text-emerald-400':'text-red-400'}`}>{BRL.format(l.valor_previsto)}</td>
                                        <td className="p-2.5 text-center w-24">
                                          <span className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase border ${pago?'bg-emerald-200/90 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800': atrasado ? 'bg-red-200/90 dark:bg-red-900/35 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>{statusLabel}</span>
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
      <div className={`fixed inset-y-0 right-0 w-80 bg-white dark:bg-slate-800 shadow-2xl z-60 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 xl:hidden ${showFiltrosSidebar?'translate-x-0':'translate-x-full'}`}>
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

           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Filtrar datas por</label>
               <div className="grid grid-cols-2 gap-2">
                   {[
                     { id: 'VENCIMENTO', label: 'Vencimento' },
                     { id: 'PAGAMENTO', label: 'Pagamento' },
                   ].map((modo) => (
                     <button
                       key={modo.id}
                       onClick={() => setFiltrosAvancados(prev => ({ ...prev, dataModo: modo.id as 'VENCIMENTO' | 'PAGAMENTO' }))}
                       className={`py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.dataModo===modo.id ? 'bg-cyan-600 text-white border-cyan-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                     >
                       {modo.label}
                     </button>
                   ))}
               </div>
           </div>

           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Centro de custo no lançamento</label>
               <div className="grid grid-cols-3 gap-2">
                   {[
                     { id: 'TODOS', label: 'Todos' },
                     { id: 'COM', label: 'Com CC' },
                     { id: 'SEM', label: 'Sem CC' },
                   ].map((opcao) => (
                     <button
                       key={opcao.id}
                       onClick={() => setFiltrosAvancados(prev => ({ ...prev, centroCustoPresenca: opcao.id as 'TODOS' | 'COM' | 'SEM' }))}
                       className={`py-2 rounded-lg text-xs font-bold border transition ${filtrosAvancados.centroCustoPresenca===opcao.id ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                     >
                       {opcao.label}
                     </button>
                   ))}
               </div>
           </div>

           {/* Filtro Contas como Botões (Chips) */}
           <div>
               <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">Contas / Bancos</label>
               <div className="flex flex-wrap gap-2">
                 {contasAtivas.map(c => {
                       const active = filtrosAvancados.contaIds.has(c.id);
                   const logo = getFullLogoUrl(c.logo_url);
                       return (
                           <button key={c.id} onClick={()=>{
                               const newSet = new Set(filtrosAvancados.contaIds);
                               if(active) newSet.delete(c.id); else newSet.add(c.id);
                               setFiltrosAvancados({...filtrosAvancados, contaIds:newSet});
                           }} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1 ${active ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-emerald-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                       <BankAvatar logoUrl={logo} bankName={c.banco} accountName={c.nome} integrationType={c.tipo_integracao} size="sm" className="h-4 w-4" imageClassName="rounded-full" fallbackClassName="rounded-full border-0 shadow-none" />
                       {c.nome}
                           </button>
                       );
                   })}
               </div>
           </div>

           <MultiSelectDropdown label="Categorias" placeholder="Selecione categorias..." options={categorias} selectedIds={filtrosAvancados.categoriaIds} onChange={(s:any)=>setFiltrosAvancados({...filtrosAvancados, categoriaIds:s})} />
           
           <button onClick={resetFiltros} className="w-full py-2 border border-slate-300 dark:border-slate-600 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm mt-4">Limpar Filtros</button>
        </div>
      </div>

      {/* --- MODAL TRANSFERÊNCIA (COMPLETO) --- */}
      {showTransfer && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowTransfer(false)}></div>
            <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-700 animate-scale-in">
              <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-blue-500"/> Nova Transferência</h3>
                <div className="space-y-4">
                    <CurrencyInputDark label="Valor (R$)" value={transferData.valor} onValueChange={(value:string)=>setTransferData({...transferData, valor:value})} />
                    <InputDark label="Data" type="date" value={transferData.data} onChange={(e:any)=>setTransferData({...transferData, data:e.target.value})} />
                    
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                        <label className="mb-2 block text-xs font-bold text-slate-400 uppercase">Origem</label>
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {contasAtivas.map((conta) => renderTransferContaButton(conta, 'origem'))}
                        </div>
                        </div>
                        <div>
                        <label className="mb-2 block text-xs font-bold text-slate-400 uppercase">Destino</label>
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {contasAtivas.map((conta) => renderTransferContaButton(conta, 'destino'))}
                        </div>
                        </div>
                    </div>

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

        {/* DRAWER INTERESSADO */}
      <div className={`fixed inset-y-0 right-0 w-full max-w-3xl bg-white dark:bg-slate-800 shadow-2xl z-60 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${showEntityDrawer?'translate-x-0':'translate-x-full'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
          <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><User className="w-4 h-4 text-blue-500"/> Novo Interessado</h3>
            <button onClick={closeEntityDrawer}><X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white"/></button>
        </div>
        <div className="h-[calc(100%-65px)] overflow-y-auto p-6 custom-scrollbar">
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                  <button
                    type="button"
                    onClick={() => setNewEntityData((prev) => ({ ...prev, tipo_pessoa: 'PF' }))}
                    className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${newEntityData.tipo_pessoa === 'PF' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                  >
                    Pessoa Física
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewEntityData((prev) => ({ ...prev, tipo_pessoa: 'PJ' }))}
                    className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${newEntityData.tipo_pessoa === 'PJ' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                  >
                    Pessoa Jurídica
                  </button>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <InputDark label={nomeInteressadoLabel} autoFocus placeholder={newEntityData.tipo_pessoa === 'PF' ? 'Ex: Maria Souza' : 'Ex: Fornecedor ABC Ltda'} value={newEntityData.nome} onChange={(e:any)=>setNewEntityData({...newEntityData, nome:e.target.value})} />
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{documentoInteressadoLabel}</label>
                    <input type="text" className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-mono text-sm placeholder:text-slate-400" value={newEntityData.cpf_cnpj} onChange={(e:any)=>handleQuickEntityDocumentoChange(e.target.value)} placeholder={newEntityData.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <InputDark label="Nome fantasia / apelido" placeholder={newEntityData.tipo_pessoa === 'PF' ? 'Como você identifica essa pessoa' : 'Nome comercial'} value={newEntityData.nome_fantasia} onChange={(e:any)=>setNewEntityData({...newEntityData, nome_fantasia:e.target.value})} />
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Classificação</label>
                    <select className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition" value={newEntityData.tipo} onChange={(e:any)=>setNewEntityData({...newEntityData, tipo:e.target.value})}>
                      <option value="CLIENTE">Cliente</option>
                      <option value="FORNECEDOR">Fornecedor</option>
                      <option value="AMBOS">Ambos</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <InputDark label="Contato responsável" placeholder="Ex: Financeiro / João Silva" value={newEntityData.contato_nome} onChange={(e:any)=>setNewEntityData({...newEntityData, contato_nome:e.target.value})} />
                  <InputDark label="E-mail" type="email" placeholder="contato@empresa.com.br" value={newEntityData.email} onChange={(e:any)=>setNewEntityData({...newEntityData, email:e.target.value})} />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <InputDark label="Telefone" placeholder="(11) 3333-4444" value={newEntityData.telefone} onChange={(e:any)=>setNewEntityData({...newEntityData, telefone: formatPhone(e.target.value)})} />
                  <InputDark label="Celular / WhatsApp" placeholder="(11) 98888-7777" value={newEntityData.celular} onChange={(e:any)=>setNewEntityData({...newEntityData, celular: formatPhone(e.target.value)})} />
                </div>
              </div>

              <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                <div className="grid gap-5 sm:grid-cols-3">
                  <div>
                    <InputDark label="CEP" placeholder="00000-000" value={newEntityData.cep} onChange={(e:any)=>void handleQuickEntityCepChange(e.target.value)} />
                    <p className="mt-1 text-[10px] text-slate-400">{entityCepLoading ? 'Consultando CEP...' : entityCepFeedback || 'Digite o CEP para preencher logradouro, bairro, cidade e UF.'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <InputDark label="Logradouro" placeholder="Rua, avenida, praça" value={newEntityData.logradouro} onChange={(e:any)=>setNewEntityData({...newEntityData, logradouro:e.target.value})} />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <InputDark label="Número" placeholder="123" value={newEntityData.numero} onChange={(e:any)=>setNewEntityData({...newEntityData, numero:e.target.value})} />
                  <div className="sm:col-span-2">
                    <InputDark label="Complemento" placeholder="Sala, bloco, referência" value={newEntityData.complemento} onChange={(e:any)=>setNewEntityData({...newEntityData, complemento:e.target.value})} />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <InputDark label="Bairro" value={newEntityData.bairro} onChange={(e:any)=>setNewEntityData({...newEntityData, bairro:e.target.value})} />
                  <InputDark label="Cidade" value={newEntityData.cidade} onChange={(e:any)=>setNewEntityData({...newEntityData, cidade:e.target.value})} />
                  <InputDark label="UF" maxLength={2} placeholder="SP" value={newEntityData.uf} onChange={(e:any)=>setNewEntityData({...newEntityData, uf:e.target.value.toUpperCase()})} />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Observações</label>
                  <textarea className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-slate-600 dark:bg-slate-800 dark:text-white" value={newEntityData.observacoes} onChange={(e:any)=>setNewEntityData({...newEntityData, observacoes:e.target.value})} placeholder="Condições comerciais, restrições, detalhes operacionais." />
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
              <button onClick={closeEntityDrawer} className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition">Cancelar</button>
              <button onClick={handleCreateEntity} disabled={saving} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-lg flex justify-center gap-2">
                {saving?<Loader2 className="animate-spin w-4 h-4"/>:<Save className="w-4 h-4"/>} Salvar Interessado
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DRAWER NOVO/EDITAR */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => void requestCloseDrawer()}></div>
          <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-700">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing?'Editar':'Novo'} Lançamento</h2>
              <div className="flex items-center gap-1">
                {isEditing && (
                  <button
                    type="button"
                    title="Duplicar este lançamento"
                    onClick={() => {
                      setIsEditing(false);
                      autoPagamentoRef.current = true;
                      autoCompetenciaRef.current = true;
                      setFormData((prev: any) => ({
                        ...prev,
                        id: null,
                        status: 'PENDENTE',
                        data_pagamento: prev.data_vencimento,
                        valor_pago: '',
                        is_parcelado: false,
                        anexos: [],
                      }));
                      setFilesToUpload(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                )}
                {isEditing && canOpenParcelasSerie && (
                  <button
                    type="button"
                    title="Abrir a série completa de parcelas"
                    onClick={() => void handleVerTodasParcelas()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-500/15 border border-amber-300/80 dark:border-amber-700/70 hover:bg-amber-200/80 dark:hover:bg-amber-500/25 transition"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Ver todas as parcelas
                  </button>
                )}
                <button onClick={() => void requestCloseDrawer()} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400"><X className="w-5 h-5"/></button>
              </div>
            </div>

            {shouldShowParcelasSerie && (
              <aside className="absolute left-0 top-20 z-30 hidden w-[360px] -translate-x-[calc(100%+12px)] rounded-2xl border border-amber-300/80 bg-amber-50/95 p-3 shadow-2xl backdrop-blur lg:block dark:border-amber-700/60 dark:bg-slate-900/95">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">Série de Parcelas</p>
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Parcela atual {currentParcelaNumber}/{currentParcelaTotal}</p>
                  </div>
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">Escopo de alterações</span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    { id: 'ESTA', label: 'Só esta' },
                    { id: 'PROXIMAS', label: 'Esta e próximas' },
                    { id: 'TODAS', label: 'Todas' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setParcelasEscopoEdicao(opt.id as 'ESTA' | 'PROXIMAS' | 'TODAS')}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition ${parcelasEscopoEdicao === opt.id ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-300/80 bg-white text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-slate-800 dark:text-amber-200 dark:hover:bg-slate-700'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <label className="mt-2 flex items-center gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                  <input
                    type="checkbox"
                    checked={ajustarParaDiaUtil}
                    onChange={(e) => setAjustarParaDiaUtil(e.target.checked)}
                    className="accent-amber-500"
                  />
                  Ajustar vencimentos para próximo dia útil ao salvar
                </label>

                <div className="mt-3 max-h-[58vh] overflow-y-auto rounded-xl border border-amber-300/80 bg-white/90 dark:border-amber-700/60 dark:bg-slate-950/70">
                  {parcelasSerieLoading ? (
                    <div className="p-3 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Carregando parcelas...
                    </div>
                  ) : sortedParcelasSerie.length === 0 ? (
                    <div className="p-3 text-xs text-amber-700 dark:text-amber-300">Não há outras parcelas identificadas para esta série.</div>
                  ) : (
                    <div className="divide-y divide-amber-200/70 dark:divide-amber-800/50">
                      {sortedParcelasSerie.map((item) => {
                        const isCurrent = Number(item.id) === Number(formData.id);
                        return (
                          <div key={item.id} className={`p-2 ${isCurrent ? 'bg-amber-200/60 dark:bg-amber-800/35' : ''}`}>
                            <button
                              type="button"
                              onClick={() => handleSelecionarParcelaSerie(item)}
                              className="w-full rounded-lg px-2 py-1 text-left hover:bg-amber-100/80 dark:hover:bg-slate-800"
                            >
                              <p className="text-[11px] font-black text-amber-800 dark:text-amber-200">Parcela {item.numero_parcela || '-'}</p>
                              <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{item.descricao || 'Sem descrição'}</p>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300">{BRL.format(Number(item.valor_previsto || 0))}</p>
                            </button>
                            <div className="mt-1 px-2">
                              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Vencimento</label>
                              <input
                                type="date"
                                value={parcelasVencimentosEdit[item.id] || item.data_vencimento || ''}
                                onChange={(e) => setParcelasVencimentosEdit((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>
            )}
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
              
              {/* DESCRIÇÃO E VALORES */}
              <InputDark label="Descrição" autoFocus value={formData.descricao} onChange={(e:any)=>setFormData({...formData, descricao:e.target.value})} placeholder="Ex: Conta de Luz" />
              <div className="grid grid-cols-2 gap-4">
                <InputDark label={formData.cartao_id ? "Data da compra" : "Vencimento"} type="date" value={formData.data_vencimento} onChange={(e:any)=>handleVencimentoChange(e.target.value)} />
                <CurrencyInputDark label="Valor (R$)" className="font-bold text-lg text-blue-400" value={formData.valor_previsto} onValueChange={(value:string)=>handleValorPrevistoChange(value)} />
              </div>

              <div className="space-y-1">
                <InputDark
                  label="Código de barras"
                  value={formData.observacao || ''}
                  onChange={(e:any)=>setFormData({...formData, observacao:e.target.value})}
                  placeholder="Cole aqui o código de barras para facilitar copiar e colar no pagamento"
                />
                {formData.observacao && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(formData.observacao || ''));
                          pushToast('success', 'Código de barras copiado.');
                        } catch {
                          pushToast('error', 'Não foi possível copiar o código de barras.');
                        }
                      }}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Copiar código
                    </button>
                  </div>
                )}
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

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Competência das parcelas</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={()=>setFormData({...formData, competencia_modo_parcelamento: 'POR_PARCELA'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.competencia_modo_parcelamento==='POR_PARCELA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Por parcela
                        </button>
                        <button
                          type="button"
                          onClick={()=>setFormData({...formData, competencia_modo_parcelamento: 'MES_COMPRA'})}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${formData.competencia_modo_parcelamento==='MES_COMPRA' ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Mês da compra
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Por parcela: cada parcela entra no mês correspondente. Mês da compra: todas as parcelas ficam na competência da compra.
                      </p>
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
                    <CurrencyInputDark label="Valor Pago (R$)" className="text-emerald-400 font-bold" value={formData.valor_pago} onValueChange={(value:string)=>handleValorPagoChange(value)} />
                  </div>
                )}
              </div>

              {/* CATEGORIA E INTERESSADO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SearchableSelect label="Categoria" placeholder="Selecione..." options={catOptions} value={formData.plano_contas_id} onChange={(id:any)=>{
                   const cat = categorias.find(c=>String(c.id)===String(id));
                   const tipoCat = String(cat?.tipo || '').trim().toUpperCase();
                   setFormData({...formData, plano_contas_id:id, tipo: tipoCat.startsWith('R') ? 'RECEITA' : 'DESPESA'});
                }} />
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Interessado</label>
                    <button onClick={openEntityDrawer} className="text-[10px] text-blue-400 font-bold hover:text-blue-300 flex items-center gap-1"><Plus className="w-3 h-3"/> Nova</button>
                  </div>
                  <SearchableSelect
                    placeholder="Selecione..."
                    options={entidadeOptions}
                    value={formData.entidade_id}
                    onChange={(id: any) => {
                      const eid = String(id || '');
                      const last = lancamentos.find(l => String(l.entidade_id) === eid);
                      setFormData((prev: any) => {
                        const hasCategoriaSelecionada = Boolean(prev.plano_contas_id);
                        if (!last || hasCategoriaSelecionada) {
                          return { ...prev, entidade_id: eid };
                        }
                        return {
                          ...prev,
                          entidade_id: eid,
                          plano_contas_id: last.plano_contas_id,
                          tipo: last.tipo,
                        };
                      });
                    }}
                  />
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
                  {(() => {
                    const contasAtivasNoCentro = getContasAtivasByCentro(formData.centro_custo_id);
                    return (
                      <>
                  {/* CONTAS */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Wallet className="w-3 h-3"/> Contas Bancárias</p>
                    <div className="grid grid-cols-2 gap-2">
                      {contasAtivasNoCentro.length === 0 && <span className="text-xs text-slate-500 italic col-span-2">Nenhuma conta ativa neste centro.</span>}
                      {contasAtivasNoCentro.map(c=>(
                        <div key={c.id} onClick={()=>toggleConta(c.id)} className={`p-2 rounded border cursor-pointer text-xs font-bold flex gap-2 items-center transition ${formData.conta_id===c.id ? 'bg-blue-600 text-white border-blue-500 shadow-md' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'}`}>
                          <div className={`p-1 rounded ${formData.conta_id===c.id?'bg-white/20':'bg-slate-100 dark:bg-slate-700 text-emerald-500'}`}>
                            <BankAvatar logoUrl={getFullLogoUrl(c.logo_url)} bankName={c.banco} accountName={c.nome} integrationType={c.tipo_integracao} size="sm" className="h-4 w-4" imageClassName="rounded-sm" fallbackClassName="rounded-sm border-0 shadow-none" />
                          </div>
                          {c.nome}
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
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* ANEXOS */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>
                
                {formData.anexos && formData.anexos.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        {formData.anexos.map((anexo: Anexo) => (
                            <div key={anexo.id} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-xs group hover:border-blue-500 transition">
                                {getFileIcon(anexo.nome_arquivo)}
                                <a href={anexo.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-slate-700 dark:text-slate-200 hover:text-blue-400 font-medium">{anexo.nome_arquivo}</a>
                                <a href={anexo.url} download target="_blank" className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-700"><Download className="w-3 h-3"/></a>
                            </div>
                        ))}
                    </div>
                )}

                <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-8 text-center hover:border-blue-500 relative cursor-pointer bg-slate-100 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-800 transition group shadow-sm">
                  <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.ppt,.pptx" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={e=>setFilesToUpload(e.target.files)}/>
                  <UploadCloud className="w-10 h-10 mx-auto text-slate-500 mb-3 group-hover:text-blue-500 transition-colors"/>
                  <p className="text-base font-semibold text-slate-600 dark:text-slate-300">Arraste ou clique para anexar</p>
                  <p className="text-xs text-slate-500 mt-1">PDF, Imagens, Excel, PowerPoint</p>
                  <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-slate-600 dark:bg-slate-700 text-slate-100 text-sm font-bold group-hover:bg-blue-600 transition-colors">
                    Selecionar arquivos
                  </div>
                  {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} novos arquivos</p>}
                </div>
              </div>

            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex justify-end gap-3">
              <button onClick={() => void requestCloseDrawer()} className="px-5 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition">Cancelar</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className={`px-8 py-2.5 rounded-lg font-bold shadow-lg flex items-center gap-2 transition disabled:opacity-50 ${hasUnsavedDrawerChanges ? 'bg-yellow-400 text-slate-950 hover:bg-yellow-300 ring-2 ring-yellow-300/70 animate-pulse' : 'bg-slate-200 text-slate-800 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'}`}
              >
                {saving?<Loader2 className="animate-spin w-4 h-4"/>:<Check className="w-4 h-4"/>} Salvar
              </button>
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
                  {contasAtivas.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
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

      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300' : toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300' : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'}`}
            >
              {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
              <span className="flex-1">{toast.message}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                className="opacity-70 hover:opacity-100"
                aria-label="Fechar notificação"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}