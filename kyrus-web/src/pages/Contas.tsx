import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, toPublicAssetUrl } from '../services/api';
import { BankAvatar } from '../components/BrandAvatar';
import { CurrencyInput } from '../components/CurrencyInput';
import { useBankPresetStore } from '../store/bankPresetStore';
import { 
  Landmark, RefreshCw, Plus, Edit2, Trash2, ChevronRight, X, Check, Loader2, ChevronDown,
  Banknote, TrendingUp, AlertTriangle, Filter, Search, Settings
} from 'lucide-react';

// --- TIPAGENS ---
interface Conta {
  id: number;
  nome: string;
  banco?: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  logo_url?: string | null;
  tipo: 'CORRENTE' | 'POUPANCA' | 'CAIXA' | 'INVESTIMENTO';
  saldo_inicial: number;
  saldo_atual: number;
  centro_custo_id?: number;
  status: 'ATIVO' | 'INATIVO';
  conta_como_disponibilidade?: boolean;
  tipo_integracao?: string | null;
}

interface CentroCusto {
  id: number;
  nome: string;
}

interface PlanoContas {
  id: number;
  nome: string;
  tipo: string;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
}

interface LancamentoItem {
  id: number;
  descricao: string;
  tipo: 'RECEITA' | 'DESPESA' | string;
  status: string;
  origem?: string;
  conciliado?: boolean;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia?: string | null;
  valor_previsto: number;
  valor_pago: number;
  valor_entrada?: number;
  valor_saida?: number;
  saldo_apos_movimento?: number;
  numero_parcela?: number | null;
  plano_contas_id?: number;
  conta_id?: number | null;
  centro_custo_id?: number | null;
  cartao_id?: number | null;
  cartao_nome?: string | null;
}

interface ExtratoGrupoFatura {
  key: string;
  cartaoNome: string;
  competencia: string;
  totalSaida: number;
  saldoApos: number;
  dataBase: string;
  itens: LancamentoItem[];
}

function getExtratoBaseDate(item: Pick<LancamentoItem, 'data_pagamento' | 'data_vencimento'>) {
  return item.data_pagamento || item.data_vencimento;
}

function parseDateLike(value?: string | null) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  }

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed.slice(0, 10))
    ? `${trimmed.slice(0, 10)}T00:00:00`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDateTimestamp(value?: string | null) {
  return parseDateLike(value)?.getTime() || 0;
}

function formatDateLike(value?: string | null) {
  return parseDateLike(value)?.toLocaleDateString('pt-BR') || '-';
}

function getExtratoSignedValue(entrada?: number | null, saida?: number | null) {
  const valorEntrada = Number(entrada || 0);
  const valorSaida = Number(saida || 0);
  if (valorEntrada > 0) return valorEntrada;
  if (valorSaida > 0) return -valorSaida;
  return 0;
}

function isTransferencia(item?: Pick<LancamentoItem, 'origem'> | null) {
  return String(item?.origem || '').toUpperCase() === 'TRANSFERENCIA';
}

interface ContaSaldoDetalhe {
  conta_id: number;
  conta_nome: string;
  saldo_inicial: number;
  total_entradas: number;
  total_saidas: number;
  saldo_atual: number;
  quantidade_movimentos: number;
  movimentos: LancamentoItem[];
}

interface FormConta {
  nome: string;
  banco: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  tipo: string;
  saldo_inicial: string; 
  centro_custo_id: string;
  status: string;
  conta_como_disponibilidade: boolean;
  logo_url?: string | null;
  tipo_integracao?: string | null;
}

interface UserData {
  empresa_id: number;
}

interface EmpresaData {
  cor_primaria: string;
}

interface FormErrors {
  nome?: string;
  banco?: string;
}

interface Notice {
  type: 'success' | 'error';
  message: string;
  details?: string[];
}

type ExtratoTipoFiltro = 'TODOS' | 'ENTRADAS' | 'SAIDAS';
type ExtratoPeriodoFiltro = 'DIA' | 'SEMANA' | 'MES' | 'ANO' | 'PERSONALIZADO';

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const weekDay = next.getDay();
  const diff = weekDay === 0 ? -6 : 1 - weekDay;
  next.setDate(next.getDate() + diff);
  return next;
}

function endOfWeek(date: Date) {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return endOfDay(next);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function getDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const SearchableSelect = ({ options, value, onChange, placeholder, label }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.flatMap((g: any) => g.options).find((o: any) => String(o.id) === String(value));

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
      {label && <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer flex justify-between items-center text-sm min-h-11.5 hover:border-blue-500 transition shadow-sm"
      >
        <span className={selectedOption ? 'text-slate-800 dark:text-white font-medium' : 'text-slate-500'}>
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

export function Contas() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bankPresets = useBankPresetStore((state) => state.presets);
  const bankPresetsLoaded = useBankPresetStore((state) => state.loaded);
  const fetchBankPresets = useBankPresetStore((state) => state.fetchPresets);
  const bancosEspeciais = [
    {
      id: 'ASAAS',
      label: 'Asaas',
      value: 'ASAAS',
      logo: '/asaas-acelerados.png'
    }
  ];
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [categorias, setCategorias] = useState<PlanoContas[]>([]);
  
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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  
  // Confirmação de Exclusão
  const [itemToDelete, setItemToDelete] = useState<Conta | null>(null);

  // Dados do Extrato
  const [extratoLoading, setExtratoLoading] = useState(false);
  const [contaExtratoNome, setContaExtratoNome] = useState('');
  const [extratoContaId, setExtratoContaId] = useState<number | null>(null);
  const [extratoConta, setExtratoConta] = useState<Conta | null>(null);
  const [extratoLancamentos, setExtratoLancamentos] = useState<LancamentoItem[]>([]);
  const [extratoSaldoDetalhe, setExtratoSaldoDetalhe] = useState<ContaSaldoDetalhe | null>(null);
  const [extratoTipoFiltro, setExtratoTipoFiltro] = useState<ExtratoTipoFiltro>('TODOS');
  const [extratoPeriodoFiltro, setExtratoPeriodoFiltro] = useState<ExtratoPeriodoFiltro>('MES');
  const [extratoPeriodoInicio, setExtratoPeriodoInicio] = useState<string>('');
  const [extratoPeriodoFim, setExtratoPeriodoFim] = useState<string>('');
  const [extratoSelecionados, setExtratoSelecionados] = useState<number[]>([]);
  const [extratoFaturasExpandidas, setExtratoFaturasExpandidas] = useState<Record<string, boolean>>({});
  const [excluindoSelecionados, setExcluindoSelecionados] = useState(false);
  const [lancamentoModalOpen, setLancamentoModalOpen] = useState(false);
  const [lancamentoSaving, setLancamentoSaving] = useState(false);
  const [lancamentoEditing, setLancamentoEditing] = useState<LancamentoItem | null>(null);
  const [lancamentoForm, setLancamentoForm] = useState({
    descricao: '',
    tipo: 'RECEITA',
    status: 'EM ABERTO',
    data_vencimento: '',
    data_pagamento: '',
    valor_previsto: '',
    valor_pago: '',
    plano_contas_id: '',
    centro_custo_id: ''
  });

  // Formulário
  const [form, setForm] = useState<FormConta>({
    nome: '',
    banco: '',
    agencia: '',
    conta_numero: '',
    conta_digito: '',
    tipo: 'CORRENTE',
    saldo_inicial: '',
    centro_custo_id: '',
    status: 'ATIVO',
    conta_como_disponibilidade: true,
    tipo_integracao: 'MANUAL'
  });

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  function formatSignedCurrency(value: number) {
    const numericValue = Number(value || 0);
    const absoluteCurrency = BRL.format(Math.abs(numericValue)).replace('-', '');
    return numericValue < 0 ? `-${absoluteCurrency}` : absoluteCurrency;
  }

  const bancosComuns = useMemo(
    () => bankPresets.map((preset) => ({
      id: preset.key,
      label: preset.label,
      banco: preset.bank_name,
      logo_url: preset.logo_url || null,
    })),
    [bankPresets],
  );

  function getFullLogoUrl(url?: string | null) {
    return toPublicAssetUrl(url);
  }

  function getApiErrorMessage(error: any, fallback: string) {
    const detail = error?.response?.data?.detail;
    const message = error?.response?.data?.message;

    if (Array.isArray(detail)) {
      const parsed = detail
        .map((item) => item?.msg || item?.message || String(item))
        .filter(Boolean)
        .join(' ')
        .trim();
      return parsed || fallback;
    }

    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    if (typeof message === 'string' && message.trim()) return message.trim();
    return fallback;
  }

  function getSingleCentroId(list: CentroCusto[]) {
    return list.length === 1 ? String(list[0].id) : '';
  }

  function isUploadedContaLogo(url?: string | null) {
    return String(url || '').includes('/static/uploads/contas/');
  }

  function getFieldClass(hasError: boolean) {
    return `w-full px-4 py-3 rounded-lg border bg-white dark:bg-slate-800 outline-none transition focus:ring-1 ${hasError ? 'border-rose-400 bg-rose-50/60 dark:border-rose-500 dark:bg-rose-950/20' : 'border-slate-200 dark:border-slate-700'}`;
  }

  function getLabelClass(hasError: boolean) {
    return `block text-xs font-bold uppercase mb-1 ${hasError ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500'}`;
  }

  function renderCurrencyInput(value: string, onValueChange: (value: string) => void, className: string, placeholder?: string) {
    return (
      <CurrencyInput
        value={value}
        onValueChange={onValueChange}
        allowNegative
        className={className}
        placeholder={placeholder}
      />
    );
  }

  function validateContaForm(currentForm: FormConta) {
    const nextErrors: FormErrors = {};

    if (!currentForm.nome.trim()) {
      nextErrors.nome = 'Informe o nome da conta.';
    }

    const requiresBank = currentForm.tipo !== 'CAIXA' && (currentForm.tipo_integracao || 'MANUAL') === 'MANUAL';
    if (requiresBank && !currentForm.banco.trim()) {
      nextErrors.banco = 'Informe o banco da conta.';
    }

    return nextErrors;
  }

  useEffect(() => {
    carregarDados();
    carregarTema();
  }, []);

  useEffect(() => {
    if (!bankPresetsLoaded) {
      void fetchBankPresets();
    }
  }, [bankPresetsLoaded, fetchBankPresets]);

  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setFilterCentroId(prev => prev || onlyId);
    }
  }, [centros]);

  useEffect(() => {
    const contaParam = searchParams.get('extrato_conta_id');
    if (!contaParam || loading || extratoOpen || contas.length === 0) return;

    const contaIdParam = Number(contaParam);
    const clearParam = () => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('extrato_conta_id');
      setSearchParams(nextParams, { replace: true });
    };

    if (!Number.isFinite(contaIdParam) || contaIdParam <= 0) {
      clearParam();
      return;
    }

    const contaTarget = contas.find((conta) => conta.id === contaIdParam);
    if (!contaTarget) return;

    void handleVerExtrato(contaTarget).finally(clearParam);
  }, [searchParams, setSearchParams, loading, extratoOpen, contas]);

  useEffect(() => {
    const onlyId = getSingleCentroId(centros);
    const selectedStillExists = !form.centro_custo_id || centros.some((centro) => String(centro.id) === String(form.centro_custo_id));

    if (!selectedStillExists) {
      setForm((prev) => ({ ...prev, centro_custo_id: onlyId || '' }));
    }
  }, [centros, form.centro_custo_id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
      return resContas.data as Conta[];
    } catch (error) {
      console.error("Erro ao carregar dados", error);
      return [] as Conta[];
    } finally {
      setLoading(false);
    }
  }

  async function carregarCategorias() {
    try {
      const { data } = await api.get('/plano-contas/');
      setCategorias(data || []);
    } catch (error) {
      console.error("Erro ao carregar categorias", error);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setForm({ nome: '', banco: '', agencia: '', conta_numero: '', conta_digito: '', tipo: 'CORRENTE', saldo_inicial: '', centro_custo_id: getSingleCentroId(centros), status: 'ATIVO', conta_como_disponibilidade: true, logo_url: null, tipo_integracao: 'MANUAL' });
    setLogoFile(null);
    setLogoPreview('');
    setLogoRemoved(false);
    setFormErrors({});
    setDrawerOpen(true);
  }

  const hasCustomLogo = Boolean(logoPreview || form.logo_url) && !logoRemoved;

  function handleOpenEdit(conta: Conta) {
    setIsEditing(true);
    setEditingId(conta.id);
    setForm({
      nome: conta.nome,
      banco: conta.banco || '',
      agencia: conta.agencia || '',
      conta_numero: conta.conta_numero || '',
      conta_digito: conta.conta_digito || '',
      tipo: conta.tipo,
      saldo_inicial: String(conta.saldo_inicial || 0),
      centro_custo_id: conta.centro_custo_id ? String(conta.centro_custo_id) : '',
      status: conta.status,
      conta_como_disponibilidade: conta.conta_como_disponibilidade !== false,
      logo_url: conta.logo_url || null,
      tipo_integracao: conta.tipo_integracao || 'MANUAL'
    });
    setLogoPreview(conta.logo_url || '');
    setLogoFile(null);
    setLogoRemoved(false);
    setFormErrors({});
    setDrawerOpen(true);
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLogoFile(file || null);
    setLogoRemoved(false);
    if (file) {
      const preview = URL.createObjectURL(file);
      setLogoPreview(preview);
    }
  }

  function handleClearLogo() {
    setLogoFile(null);
    setLogoPreview('');
    setLogoRemoved(true);
    setForm(prev => ({ ...prev, logo_url: null }));
  }

  async function handleSave() {
    const nextErrors = validateContaForm(form);
    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setNotice({
        type: 'error',
        message: 'Faltou preencher informacoes obrigatorias da conta.',
        details: Object.values(nextErrors),
      });
      return;
    }
    
    setSaving(true);
    try {
      const payload = {
        ...form,
        saldo_inicial: parseFloat(form.saldo_inicial) || 0,
        centro_custo_id: form.centro_custo_id ? parseInt(form.centro_custo_id) : null,
        ...(logoRemoved ? { logo_url: null } : {})
      };

      let response;
      if (isEditing && editingId) {
        response = await api.patch(`/contas/${editingId}`, payload);
      } else {
        response = await api.post('/contas/', payload);
      }

      const contaId = isEditing && editingId ? editingId : response?.data?.id;
      if (logoFile && contaId) {
        const fd = new FormData();
        fd.append('file', logoFile);
        await api.post(`/contas/${contaId}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      
      setDrawerOpen(false);
      setFormErrors({});
      setNotice({ type: 'success', message: isEditing ? 'Conta atualizada com sucesso.' : 'Conta criada com sucesso.' });
      carregarDados();
    } catch (error) {
      console.error("Erro ao salvar", error);
      setNotice({ type: 'error', message: getApiErrorMessage(error, 'Erro ao salvar conta.') });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/contas/${itemToDelete.id}`);
      setItemToDelete(null);
      setNotice({ type: 'success', message: 'Conta removida com sucesso.' });
      carregarDados();
    } catch (error) {
      console.error("Erro ao deletar", error);
      setNotice({ type: 'error', message: getApiErrorMessage(error, 'Nao foi possivel excluir a conta. Verifique se ha lancamentos vinculados.') });
    }
  }

  async function fetchLancamentosConta(contaId: number) {
    setExtratoLoading(true);
    try {
      const { data } = await api.get<ContaSaldoDetalhe>(`/contas/${contaId}/saldo-detalhe`);
      const items = (data?.movimentos || []) as LancamentoItem[];
      setExtratoSaldoDetalhe(data);
      setExtratoLancamentos(items);
      setExtratoSelecionados([]);
      setExtratoFaturasExpandidas({});
    } catch (error) {
      console.error("Erro ao carregar extrato", error);
      setExtratoSaldoDetalhe(null);
      setExtratoLancamentos([]);
      setExtratoSelecionados([]);
      setExtratoFaturasExpandidas({});
    } finally {
      setExtratoLoading(false);
    }
  }

  function resetLancamentoForm(conta?: Conta) {
    setLancamentoForm({
      descricao: '',
      tipo: 'RECEITA',
      status: 'EM ABERTO',
      data_vencimento: '',
      data_pagamento: '',
      valor_previsto: '',
      valor_pago: '',
      plano_contas_id: '',
      centro_custo_id: conta?.centro_custo_id ? String(conta.centro_custo_id) : ''
    });
  }

  async function handleVerExtrato(conta: Conta) {
    setContaExtratoNome(conta.nome);
    setExtratoContaId(conta.id);
    setExtratoConta(conta);
    setExtratoOpen(true);
    setExtratoTipoFiltro('TODOS');
    setExtratoPeriodoFiltro('MES');
    setExtratoPeriodoInicio('');
    setExtratoPeriodoFim('');
    setExtratoLancamentos([]);
    if (categorias.length === 0) {
      await carregarCategorias();
    }
    await fetchLancamentosConta(conta.id);
  }

  function handleVoltarExtrato() {
    setExtratoOpen(false);
    setExtratoLancamentos([]);
    setExtratoSaldoDetalhe(null);
    setExtratoTipoFiltro('TODOS');
    setExtratoPeriodoFiltro('MES');
    setExtratoPeriodoInicio('');
    setExtratoPeriodoFim('');
    setExtratoSelecionados([]);
    setExtratoFaturasExpandidas({});
    setExtratoConta(null);
    setExtratoContaId(null);
    setContaExtratoNome('');
  }

  function toggleExtratoSelecionado(id: number) {
    setExtratoSelecionados((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function toggleExtratoFatura(key: string) {
    setExtratoFaturasExpandidas((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleExcluirSelecionadosExtrato() {
    if (extratoSelecionados.length === 0 || !extratoContaId) return;
    if (!window.confirm(`Deseja excluir ${extratoSelecionados.length} lançamento(s) que influenciam o saldo desta conta?`)) return;

    setExcluindoSelecionados(true);
    try {
      await api.post('/lancamentos/bulk-delete', { ids: extratoSelecionados });
      await fetchLancamentosConta(extratoContaId);
      const contasAtualizadas = await carregarDados();
      const contaAtualizada = contasAtualizadas.find((conta) => conta.id === extratoContaId) || null;
      setExtratoConta(contaAtualizada);
      if (contaAtualizada) {
        setContaExtratoNome(contaAtualizada.nome);
      }
    } catch (error) {
      console.error('Erro ao excluir lançamentos selecionados', error);
      alert('Erro ao excluir lançamentos selecionados.');
    } finally {
      setExcluindoSelecionados(false);
    }
  }

  function handleAbrirLancamentoModal(lancamento?: LancamentoItem) {
    if (lancamento && isTransferencia(lancamento)) {
      return;
    }
    if (lancamento) {
      setLancamentoEditing(lancamento);
      setLancamentoForm({
        descricao: lancamento.descricao || '',
        tipo: lancamento.tipo as string,
        status: lancamento.status || 'EM ABERTO',
        data_vencimento: lancamento.data_vencimento?.slice(0, 10) || '',
        data_pagamento: lancamento.data_pagamento ? lancamento.data_pagamento.slice(0, 10) : '',
        valor_previsto: String(lancamento.valor_previsto || 0),
        valor_pago: String(lancamento.valor_pago || 0),
        plano_contas_id: lancamento.plano_contas_id ? String(lancamento.plano_contas_id) : '',
        centro_custo_id: lancamento.centro_custo_id ? String(lancamento.centro_custo_id) : (extratoConta?.centro_custo_id ? String(extratoConta.centro_custo_id) : '')
      });
    } else {
      setLancamentoEditing(null);
      resetLancamentoForm(extratoConta || undefined);
    }
    setLancamentoModalOpen(true);
  }

  async function handleSalvarLancamento() {
    if (!extratoContaId) return;
    if (!lancamentoForm.descricao || !lancamentoForm.data_vencimento || !lancamentoForm.valor_previsto || !lancamentoForm.plano_contas_id) {
      alert('Preencha descrição, data, valor e categoria.');
      return;
    }
    setLancamentoSaving(true);
    try {
      const statusPago = lancamentoForm.status === 'PAGO';
      const payloadBase: any = {
        descricao: lancamentoForm.descricao,
        tipo: lancamentoForm.tipo,
        valor_previsto: Number(lancamentoForm.valor_previsto || 0),
        valor_pago: statusPago ? Number(lancamentoForm.valor_pago || lancamentoForm.valor_previsto || 0) : 0,
        data_vencimento: lancamentoForm.data_vencimento,
        data_pagamento: statusPago ? (lancamentoForm.data_pagamento || lancamentoForm.data_vencimento) : null,
        plano_contas_id: Number(lancamentoForm.plano_contas_id),
        conta_id: extratoContaId,
        centro_custo_id: lancamentoForm.centro_custo_id ? Number(lancamentoForm.centro_custo_id) : null
      };

      if (lancamentoEditing) {
        await api.put(`/lancamentos/${lancamentoEditing.id}`, {
          ...payloadBase,
          status: lancamentoForm.status
        });
      } else {
        await api.post('/lancamentos/', payloadBase);
      }
      setLancamentoModalOpen(false);
      setLancamentoEditing(null);
      resetLancamentoForm(extratoConta || undefined);
      await fetchLancamentosConta(extratoContaId);
      const contasAtualizadas = await carregarDados();
      const contaAtualizada = contasAtualizadas.find((conta) => conta.id === extratoContaId) || null;
      setExtratoConta(contaAtualizada);
      if (contaAtualizada) {
        setContaExtratoNome(contaAtualizada.nome);
      }
    } catch (error) {
      console.error('Erro ao salvar lançamento', error);
      alert('Erro ao salvar lançamento.');
    } finally {
      setLancamentoSaving(false);
    }
  }

  async function handleExcluirLancamento(id: number) {
    if (!window.confirm('Deseja excluir este lançamento?')) return;
    try {
      await api.delete(`/lancamentos/${id}`);
      if (extratoContaId) {
        await fetchLancamentosConta(extratoContaId);
        const contasAtualizadas = await carregarDados();
        const contaAtualizada = contasAtualizadas.find((conta) => conta.id === extratoContaId) || null;
        setExtratoConta(contaAtualizada);
        if (contaAtualizada) {
          setContaExtratoNome(contaAtualizada.nome);
        }
      }
    } catch (error) {
      console.error('Erro ao excluir lançamento', error);
      alert('Erro ao excluir lançamento.');
    }
  }

  const filteredContas = contas.filter(c => {
    const matchesSearch = c.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          c.banco?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCentro = filterCentroId ? String(c.centro_custo_id) === filterCentroId : true;
    return matchesSearch && matchesCentro;
  });

  const contasAtivasDisponiveis = filteredContas.filter(
    (conta) => conta.status === 'ATIVO' && conta.conta_como_disponibilidade !== false,
  );
  const contasAtivasNaoDisponiveis = filteredContas.filter(
    (conta) => conta.status === 'ATIVO' && conta.conta_como_disponibilidade === false,
  );
  const contasInativas = filteredContas.filter((conta) => conta.status === 'INATIVO');

  const saldoTotal = filteredContas
    .filter((conta) => conta.status === 'ATIVO' && conta.conta_como_disponibilidade !== false)
    .reduce((acc, curr) => acc + (parseFloat(String(curr.saldo_atual)) || 0), 0);

  const extratoLancamentosFiltrados = useMemo(() => {
    const now = new Date();

    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    if (extratoPeriodoFiltro === 'DIA') {
      rangeStart = startOfDay(now);
      rangeEnd = endOfDay(now);
    } else if (extratoPeriodoFiltro === 'SEMANA') {
      rangeStart = startOfWeek(now);
      rangeEnd = endOfWeek(now);
    } else if (extratoPeriodoFiltro === 'MES') {
      rangeStart = startOfMonth(now);
      rangeEnd = endOfMonth(now);
    } else if (extratoPeriodoFiltro === 'ANO') {
      rangeStart = startOfYear(now);
      rangeEnd = endOfYear(now);
    } else if (extratoPeriodoFiltro === 'PERSONALIZADO') {
      rangeStart = extratoPeriodoInicio ? startOfDay(parseDateInput(extratoPeriodoInicio) || now) : null;
      rangeEnd = extratoPeriodoFim ? endOfDay(parseDateInput(extratoPeriodoFim) || now) : null;
    }

    return extratoLancamentos.filter((item) => {
      const isEntrada = Number(item.valor_entrada || 0) > 0;
      const isSaida = Number(item.valor_saida || 0) > 0;

      if (extratoTipoFiltro === 'ENTRADAS' && !isEntrada) return false;
      if (extratoTipoFiltro === 'SAIDAS' && !isSaida) return false;

      const movementDate = parseDateLike(getExtratoBaseDate(item));
      if (!movementDate) return false;
      if (rangeStart && movementDate < rangeStart) return false;
      if (rangeEnd && movementDate > rangeEnd) return false;
      return true;
    });
  }, [extratoLancamentos, extratoPeriodoFim, extratoPeriodoFiltro, extratoPeriodoInicio, extratoTipoFiltro]);

  const extratoResumoFiltrado = useMemo(() => {
    return extratoLancamentosFiltrados.reduce(
      (acc, item) => {
        acc.entradas += Number(item.valor_entrada || 0);
        acc.saidas += Number(item.valor_saida || 0);
        acc.quantidade += 1;
        return acc;
      },
      { entradas: 0, saidas: 0, quantidade: 0 },
    );
  }, [extratoLancamentosFiltrados]);

  useEffect(() => {
    const visibleIds = new Set(extratoLancamentosFiltrados.map((item) => item.id));
    setExtratoSelecionados((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [extratoLancamentosFiltrados]);

  const extratoAgrupado = useMemo(() => {
    const singleRows: Array<{ type: 'single'; item: LancamentoItem }> = [];
    const grouped = new Map<string, ExtratoGrupoFatura>();

    extratoLancamentosFiltrados.forEach((item) => {
      const isCardMovement = Number(item.cartao_id || 0) > 0;
      if (!isCardMovement) {
        singleRows.push({ type: 'single', item });
        return;
      }

      const competenciaBase = (item.data_vencimento || item.data_competencia || '').slice(0, 7);
      if (!competenciaBase) {
        singleRows.push({ type: 'single', item });
        return;
      }

      const key = `${item.cartao_id}-${competenciaBase}`;
      const current = grouped.get(key) || {
        key,
        cartaoNome: item.cartao_nome || `Cartão ${item.cartao_id}`,
        competencia: competenciaBase,
        totalSaida: 0,
        saldoApos: Number(item.saldo_apos_movimento || 0),
        dataBase: getExtratoBaseDate(item),
        itens: [],
      };

      current.totalSaida += Number(item.valor_saida || item.valor_pago || item.valor_previsto || 0);
      current.saldoApos = Number(item.saldo_apos_movimento || current.saldoApos || 0);
      current.dataBase = current.dataBase || getExtratoBaseDate(item);
      current.itens.push(item);
      grouped.set(key, current);
    });

    grouped.forEach((group) => {
      group.itens.sort((left, right) => getDateTimestamp(getExtratoBaseDate(right)) - getDateTimestamp(getExtratoBaseDate(left)));
      group.dataBase = getExtratoBaseDate(group.itens[0] || { data_pagamento: group.dataBase, data_vencimento: group.dataBase });
      group.saldoApos = Number(group.itens[0]?.saldo_apos_movimento || group.saldoApos || 0);
    });

    const invoiceRows = Array.from(grouped.values()).sort((left, right) => getDateTimestamp(right.dataBase) - getDateTimestamp(left.dataBase));
    const singles = [...singleRows].sort((left, right) => getDateTimestamp(getExtratoBaseDate(right.item)) - getDateTimestamp(getExtratoBaseDate(left.item)));

    return [...invoiceRows.map((group) => ({ type: 'invoice' as const, group })), ...singles].sort((left, right) => {
      const leftDate = left.type === 'invoice' ? left.group.dataBase : getExtratoBaseDate(left.item);
      const rightDate = right.type === 'invoice' ? right.group.dataBase : getExtratoBaseDate(right.item);
      return getDateTimestamp(rightDate) - getDateTimestamp(leftDate);
    });
  }, [extratoLancamentosFiltrados]);

  const catOptions = [
    {
      label: 'SAIDAS',
      options: categorias
        .filter(c => (c.tipo || '').trim().toUpperCase().startsWith('D'))
        .map(c => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
          disabled: c.eh_cabecalho || c.permite_lancamentos === false
        }))
    },
    {
      label: 'ENTRADAS',
      options: categorias
        .filter(c => (c.tipo || '').trim().toUpperCase().startsWith('R'))
        .map(c => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
          disabled: c.eh_cabecalho || c.permite_lancamentos === false
        }))
    }
  ];

  const getIcon = (tipo: string) => {
    switch(tipo) {
      case 'CAIXA': return Banknote;
      case 'INVESTIMENTO': return TrendingUp;
      default: return Landmark;
    }
  };

  const getCategoriaLabel = (lancamento: LancamentoItem) => {
    if (isTransferencia(lancamento)) return 'Transferência interna';
    return categorias.find(c => c.id === lancamento.plano_contas_id)?.nome || '-';
  };

  const extratoSaldoBanco = Number(extratoConta?.saldo_atual ?? extratoSaldoDetalhe?.saldo_atual ?? 0);

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-slate-50 dark:bg-slate-900">
      {notice && (
        <div className="fixed right-6 top-6 z-120 max-w-md rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${notice.type === 'success' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300'}`}>
              {notice.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{notice.message}</p>
              {notice.details && notice.details.length > 0 && (
                <div className="mt-1 space-y-1">
                  {notice.details.map((detail, index) => (
                    <p key={`${detail}-${index}`} className="text-xs text-slate-500 dark:text-slate-300">{detail}</p>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setNotice(null)} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm z-20 gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">Contas Bancárias</h2>
          <p className="text-sm text-slate-400">Caixas, Bancos e Investimentos</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
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
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6 pb-32">
        
        {extratoOpen ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-white">Extrato - {contaExtratoNome}</h3>
                <p className="text-xs text-slate-400">Movimentos que realmente entram no cálculo do saldo desta conta.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleVoltarExtrato}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold"
                >
                  Voltar
                </button>
                {extratoContaId && (
                  <button
                    onClick={() => navigate(`/importacao_ofx?conta_id=${extratoContaId}`)}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-sm"
                  >
                    Importar OFX
                  </button>
                )}
                <button
                  onClick={() => handleAbrirLancamentoModal()}
                  className="px-4 py-2 rounded-lg text-white font-bold text-sm flex items-center gap-2"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Plus className="w-4 h-4" /> Novo lançamento
                </button>
                <button
                  onClick={() => extratoContaId && fetchLancamentosConta(extratoContaId)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${extratoLoading ? 'animate-spin' : ''}`} /> Atualizar
                </button>
              </div>
            </div>

            {extratoSaldoDetalhe && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Saldo do banco</p>
                    <p className={`mt-2 text-xl font-black ${extratoSaldoBanco >= 0 ? 'text-slate-800 dark:text-white' : 'text-rose-600 dark:text-rose-300'}`}>{BRL.format(extratoSaldoBanco)}</p>
                    <p className="mt-1 text-[11px] text-slate-400">Esse valor nao muda com os filtros.</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-900 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Entradas filtradas</p>
                    <p className="mt-2 text-xl font-black text-emerald-600 dark:text-emerald-300">{BRL.format(Number(extratoResumoFiltrado.entradas || 0))}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm dark:border-rose-900 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Saidas filtradas</p>
                    <p className="mt-2 text-xl font-black text-rose-600 dark:text-rose-300">{BRL.format(Number(extratoResumoFiltrado.saidas || 0))}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Movimentos no filtro</p>
                    <p className="mt-2 text-xl font-black text-slate-800 dark:text-white">{extratoResumoFiltrado.quantidade}</p>
                    <p className="mt-1 text-[11px] text-slate-400">De {extratoSaldoDetalhe.quantidade_movimentos} movimento(s) que influenciam o saldo.</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">Tudo abaixo entra no saldo atual desta conta.</p>
                    <p className="text-xs text-slate-400">Os filtros mudam apenas a visualizacao das entradas e saidas. O saldo do banco permanece o saldo real da conta.</p>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { id: 'TODOS', label: 'Tudo' },
                        { id: 'ENTRADAS', label: 'Entradas' },
                        { id: 'SAIDAS', label: 'Saidas' },
                      ] as Array<{ id: ExtratoTipoFiltro; label: string }>).map((option) => {
                        const active = extratoTipoFiltro === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setExtratoTipoFiltro(option.id)}
                            className={`rounded-xl px-3 py-2 text-sm font-bold transition ${active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                            style={active ? { backgroundColor: primaryColor } : undefined}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { id: 'DIA', label: 'Dia' },
                        { id: 'SEMANA', label: 'Semana' },
                        { id: 'MES', label: 'Mes' },
                        { id: 'ANO', label: 'Ano' },
                        { id: 'PERSONALIZADO', label: 'Periodo' },
                      ] as Array<{ id: ExtratoPeriodoFiltro; label: string }>).map((option) => {
                        const active = extratoPeriodoFiltro === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setExtratoPeriodoFiltro(option.id)}
                            className={`rounded-xl px-3 py-2 text-sm font-bold transition ${active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                            style={active ? { backgroundColor: primaryColor } : undefined}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {extratoPeriodoFiltro === 'PERSONALIZADO' && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          type="date"
                          value={extratoPeriodoInicio}
                          onChange={(event) => setExtratoPeriodoInicio(event.target.value)}
                          max={extratoPeriodoFim || undefined}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:ring-1 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                          placeholder={getDateInputValue(new Date())}
                        />
                        <input
                          type="date"
                          value={extratoPeriodoFim}
                          onChange={(event) => setExtratoPeriodoFim(event.target.value)}
                          min={extratoPeriodoInicio || undefined}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:ring-1 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                          placeholder={getDateInputValue(new Date())}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleExcluirSelecionadosExtrato}
                      disabled={extratoSelecionados.length === 0 || excluindoSelecionados}
                      className="px-4 py-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2"
                    >
                      {excluindoSelecionados ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Apagar selecionados ({extratoSelecionados.length})
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="p-4 w-12">Sel.</th>
                      <th className="p-4">Data base</th>
                      <th className="p-4">Descrição</th>
                      <th className="p-4">Categoria</th>
                      <th className="p-4">Origem</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Entrada/Saída</th>
                      <th className="p-4 text-right">Saldo após</th>
                      <th className="p-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100 dark:divide-slate-700">
                    {extratoLoading ? (
                      <tr><td colSpan={9} className="p-6 text-center text-slate-400">Carregando...</td></tr>
                    ) : extratoAgrupado.length === 0 ? (
                      <tr><td colSpan={9} className="p-6 text-center text-slate-400 italic">Nenhum movimento encontrado para os filtros selecionados.</td></tr>
                    ) : (
                      extratoAgrupado.map((row) => {
                        if (row.type === 'invoice') {
                          const isExpanded = !!extratoFaturasExpandidas[row.group.key];
                          const competenciaLabel = row.group.competencia
                            ? new Date(`${row.group.competencia}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                            : '-';

                          return (
                            <React.Fragment key={row.group.key}>
                              <tr className="bg-slate-50/80 dark:bg-slate-800/60">
                                <td className="p-4 align-top">
                                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                    {row.group.itens.length}
                                  </span>
                                </td>
                                <td className="p-4 font-mono text-xs text-slate-500 align-top">
                                  {formatDateLike(row.group.dataBase)}
                                </td>
                                <td className="p-4 align-top">
                                  <button
                                    onClick={() => toggleExtratoFatura(row.group.key)}
                                    className="flex items-start gap-3 text-left"
                                  >
                                    <ChevronDown className={`mt-0.5 h-4 w-4 text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                                    <div>
                                      <div className="font-semibold text-slate-800 dark:text-slate-100">Fatura {row.group.cartaoNome}</div>
                                      <div className="text-xs text-slate-500">{row.group.itens.length} lançamento(s) • {competenciaLabel}</div>
                                    </div>
                                  </button>
                                </td>
                                <td className="p-4 text-slate-500 align-top">Cartão de crédito</td>
                                <td className="p-4 text-slate-500 align-top">FATURA</td>
                                <td className="p-4 align-top">
                                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    AGRUPADO
                                  </span>
                                </td>
                                <td className="p-4 text-right font-bold text-rose-600 align-top whitespace-nowrap">{formatSignedCurrency(-Math.abs(row.group.totalSaida))}</td>
                                <td className={`p-4 text-right font-bold align-top whitespace-nowrap ${row.group.saldoApos >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{formatSignedCurrency(row.group.saldoApos)}</td>
                                <td className="p-4" />
                              </tr>

                              {isExpanded && row.group.itens.map((l) => (
                                <tr key={l.id} className="bg-white dark:bg-slate-800/20 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                  <td className="p-4 pl-10">
                                    <input
                                      type="checkbox"
                                      checked={extratoSelecionados.includes(l.id)}
                                      onChange={() => toggleExtratoSelecionado(l.id)}
                                      className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                    />
                                  </td>
                                  <td className="p-4 font-mono text-xs text-slate-500">
                                    {formatDateLike(l.data_pagamento || l.data_vencimento)}
                                  </td>
                                  <td className="p-4 font-medium text-slate-700 dark:text-slate-200">
                                    <div>{l.descricao}</div>
                                    <div className="text-xs text-slate-400">{l.numero_parcela ? `${l.numero_parcela}a parcela` : 'À vista'}</div>
                                  </td>
                                  <td className="p-4 text-slate-500">{getCategoriaLabel(l)}</td>
                                  <td className="p-4 text-slate-500">{l.origem || '-'}</td>
                                  <td className="p-4">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                      {l.status}
                                    </span>
                                  </td>
                                  <td className={`p-4 text-right font-bold whitespace-nowrap ${getExtratoSignedValue(l.valor_entrada, l.valor_saida) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatSignedCurrency(getExtratoSignedValue(l.valor_entrada, l.valor_saida))}</td>
                                  <td className={`p-4 text-right font-bold whitespace-nowrap ${Number(l.saldo_apos_movimento || 0) >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{formatSignedCurrency(Number(l.saldo_apos_movimento || 0))}</td>
                                  <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      {!isTransferencia(l) && (
                                        <button
                                          onClick={() => handleAbrirLancamentoModal(l)}
                                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleExcluirLancamento(l.id)}
                                        className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        }

                        const l = row.item;
                        return (
                          <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                            <td className="p-4">
                              <input
                                type="checkbox"
                                checked={extratoSelecionados.includes(l.id)}
                                onChange={() => toggleExtratoSelecionado(l.id)}
                                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                              />
                            </td>
                            <td className="p-4 font-mono text-xs text-slate-500">
                              {formatDateLike(l.data_pagamento || l.data_vencimento)}
                            </td>
                            <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{l.descricao}</td>
                            <td className="p-4 text-slate-500">{getCategoriaLabel(l)}</td>
                            <td className="p-4 text-slate-500">{l.origem || '-'}</td>
                            <td className="p-4">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {l.status}
                              </span>
                            </td>
                            <td className={`p-4 text-right font-bold whitespace-nowrap ${getExtratoSignedValue(l.valor_entrada, l.valor_saida) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatSignedCurrency(getExtratoSignedValue(l.valor_entrada, l.valor_saida))}</td>
                            <td className={`p-4 text-right font-bold whitespace-nowrap ${Number(l.saldo_apos_movimento || 0) >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{formatSignedCurrency(Number(l.saldo_apos_movimento || 0))}</td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {!isTransferencia(l) && (
                                  <button
                                    onClick={() => handleAbrirLancamentoModal(l)}
                                    className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleExcluirLancamento(l.id)}
                                  className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <>
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
                <div className="p-3 rounded-full" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                    <Landmark className="w-6 h-6" />
                </div>
            </div>

            {/* BARRA DE FILTROS */}
            <div className="flex flex-col md:flex-row gap-4">
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
              <div className="space-y-6">
                {[
                  {
                    key: 'ativas-disponiveis',
                    title: '1. Contas ativas que contam como saldo disponível',
                    description: 'Essas contas entram no saldo geral disponível.',
                    contas: contasAtivasDisponiveis,
                    emptyLabel: 'Nenhuma conta ativa marcando saldo disponível para os filtros aplicados.',
                  },
                  {
                    key: 'ativas-nao-disponiveis',
                    title: '2. Contas ativas que não contam como saldo disponível',
                    description: 'Essas contas continuam ativas, mas não entram no saldo disponível.',
                    contas: contasAtivasNaoDisponiveis,
                    emptyLabel: 'Nenhuma conta ativa fora do saldo disponível para os filtros aplicados.',
                  },
                  {
                    key: 'inativas',
                    title: '3. Contas inativas',
                    description: 'Contas desativadas, fora do saldo geral disponível.',
                    contas: contasInativas,
                    emptyLabel: 'Nenhuma conta inativa para os filtros aplicados.',
                  },
                ].map((secao) => (
                  <section key={secao.key} className="space-y-3">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-200">{secao.title}</h3>
                      <p className="mt-1 text-xs text-slate-400">{secao.description}</p>
                    </div>

                    {secao.contas.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                        {secao.emptyLabel}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {secao.contas.map((c) => {
                          const IconComp = getIcon(c.tipo);
                          const saldo = parseFloat(String(c.saldo_atual || 0));
                          const nomeCentro = centros.find(ct => ct.id === c.centro_custo_id)?.nome;

                          return (
                            <div key={c.id}
                              className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                              style={{ '--hover-color': primaryColor } as React.CSSProperties}
                            >
                              <div
                                className="absolute inset-0 rounded-xl border-2 border-transparent pointer-events-none transition-colors duration-300"
                                style={{ borderColor: 'transparent' }}
                              ></div>

                              <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shadow-sm overflow-hidden"
                                    style={{ backgroundColor: `${primaryColor}10`, color: primaryColor }}
                                  >
                                    {c.tipo === 'CAIXA' ? <IconComp className="w-5 h-5" /> : c.logo_url ? <BankAvatar logoUrl={c.logo_url} bankName={c.banco} accountName={c.nome} integrationType={c.tipo_integracao} size="sm" className="h-10 w-10" imageClassName="rounded-lg" fallbackClassName="rounded-lg border-0 shadow-none" /> : <Banknote className="w-5 h-5" />}
                                  </div>
                                  <div>
                                    <h3 className="font-bold text-slate-700 dark:text-slate-200 leading-tight">{c.nome}</h3>
                                    <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">{c.banco || c.tipo}</p>
                                    {c.conta_como_disponibilidade === false && (
                                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-300">Fora do saldo disponivel</p>
                                    )}
                                    {c.status === 'INATIVO' && (
                                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-300">Conta inativa</p>
                                    )}
                                  </div>
                                </div>

                                <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                                  {c.tipo_integracao === 'ASAAS' && (
                                    <button
                                      onClick={() => navigate(`/integracoes/asaas?conta_id=${c.id}`)}
                                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-slate-500"
                                      title="Configurar integração Asaas"
                                    >
                                      <Settings className="w-4 h-4" />
                                    </button>
                                  )}
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
                                    onClick={() => handleVerExtrato(c)}
                                    className="text-xs font-bold hover:underline flex items-center gap-1"
                                    style={{ color: primaryColor }}
                                  >
                                    Ver Extrato <ChevronRight className="w-3 h-3" />
                                  </button>
                                </div>

                                {nomeCentro && (
                                  <div className="mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-mono text-slate-500 border border-slate-200 dark:border-slate-600">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryColor }}></span>
                                    {nomeCentro}
                                  </div>
                                )}
                              </div>

                              <div className="absolute bottom-0 left-4 right-4 h-0.5 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" style={{ backgroundColor: primaryColor }}></div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* --- DRAWER (MODAL LATERAL) NOVA/EDITAR CONTA --- */}
      <div 
        className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setDrawerOpen(false)}
      />
      
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[min(50vw,58rem)] bg-white dark:bg-slate-900 z-50 transform transition-transform duration-300 ease-out border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing ? 'Editar Conta' : 'Nova Conta'}</h2>
              <button onClick={() => setDrawerOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                  <label className={getLabelClass(Boolean(formErrors.nome))}>Nome da Conta / Apelido</label>
                  <input 
                    type="text" 
                    className={getFieldClass(Boolean(formErrors.nome))}
                    style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    placeholder="Ex: Itaú Principal" 
                    value={form.nome}
                    onChange={e => {
                      setForm({...form, nome: e.target.value});
                      setFormErrors((prev) => ({ ...prev, nome: undefined }));
                    }}
                  />
                  {formErrors.nome && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-300">{formErrors.nome}</p>}
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
                      <label className={getLabelClass(Boolean(formErrors.banco))}>Banco</label>
                      <input 
                        type="text" 
                        className={getFieldClass(Boolean(formErrors.banco))}
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: Nubank" 
                        value={form.banco}
                        onChange={e => {
                          setForm((prev) => ({
                            ...prev,
                            banco: e.target.value,
                            logo_url: logoFile || isUploadedContaLogo(prev.logo_url) ? prev.logo_url : null,
                          }));
                          setFormErrors((prev) => ({ ...prev, banco: undefined }));
                        }}
                      />
                      {formErrors.banco && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-300">{formErrors.banco}</p>}
                  </div>
              </div>

              <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Bancos comuns</label>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                        {bancosComuns.map((banco) => {
                          const selected = form.tipo_integracao === 'MANUAL' && String(form.banco || '').trim().toLowerCase() === banco.banco.toLowerCase();
                          return (
                            <button
                              key={banco.id}
                              type="button"
                              onClick={() => {
                                setForm({ ...form, banco: banco.banco, tipo_integracao: 'MANUAL', logo_url: banco.logo_url || null });
                                setLogoRemoved(false);
                                setFormErrors((prev) => ({ ...prev, banco: undefined }));
                              }}
                              className={`rounded-2xl border px-3 py-3 text-left transition flex flex-col gap-3 ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                            >
                              <div className="flex items-center gap-3">
                                <BankAvatar logoUrl={banco.logo_url} bankName={banco.banco} accountName={banco.label} size="md" className="h-14 w-14 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900" imageClassName="rounded-xl bg-white p-1 dark:bg-slate-900" fallbackClassName="rounded-2xl border-0 shadow-none" imageFit="contain" />
                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{banco.label}</div>
                              </div>
                              <div className={`text-[10px] uppercase font-bold ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400'}`}>
                                {selected ? 'Selecionado' : 'Usar logo padrão'}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Essa lista vem do painel do consultor. Se nenhuma foto for enviada, o sistema usa a imagem configurada para o banco.</p>
                  </div>

                  <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Bancos especiais</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {bancosEspeciais.map(banco => {
                        const selected = (form.tipo_integracao || 'MANUAL') === banco.value;
                        return (
                          <button
                            key={banco.id}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, banco: banco.label, tipo_integracao: banco.value, logo_url: banco.logo });
                              setLogoRemoved(false);
                              setFormErrors((prev) => ({ ...prev, banco: undefined }));
                            }}
                            className={`rounded-2xl border px-3 py-3 text-left transition flex flex-col gap-3 ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                          >
                            <div className="flex items-center gap-3">
                              <BankAvatar logoUrl={banco.logo} bankName={banco.label} accountName={banco.label} integrationType={banco.value} size="lg" className="h-16 w-16 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900" imageClassName="rounded-xl bg-white p-1 dark:bg-slate-900" fallbackClassName="rounded-2xl border-0 shadow-none" imageFit="contain" />
                              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{banco.label}</div>
                            </div>
                            <div className={`text-[10px] uppercase font-bold ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-slate-400'}`}>
                              {selected ? 'Selecionado' : 'Selecionar'}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Use especial apenas para integrações. Hoje só o Asaas permanece aqui.</p>
                  </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Agência</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 1234" 
                        value={form.agencia || ''}
                        onChange={e => setForm({...form, agencia: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 56789" 
                        value={form.conta_numero || ''}
                        onChange={e => setForm({...form, conta_numero: e.target.value})}
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Dígito</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition focus:ring-1"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        placeholder="Ex: 0" 
                        value={form.conta_digito || ''}
                        onChange={e => setForm({...form, conta_digito: e.target.value})}
                      />
                  </div>
              </div>

              <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-slate-500">Logo / Foto do Banco</label>
                  <div className="flex items-center gap-3">
                      <div className="w-18 h-18 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 overflow-hidden flex items-center justify-center text-[10px] text-slate-400 shadow-sm">
                          {hasCustomLogo ? (
                            <img src={getFullLogoUrl(logoPreview || form.logo_url || '') || ''} alt="Logo" className="w-full h-full object-contain bg-white p-2 dark:bg-slate-900" />
                          ) : form.tipo !== 'CAIXA' ? (
                            <div className="flex h-full w-full items-center justify-center bg-white text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                              <Banknote className="h-8 w-8" />
                            </div>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-white text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                              <Landmark className="h-8 w-8" />
                            </div>
                          )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                          <label className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                              Selecionar arquivo
                              <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                          </label>
                          {hasCustomLogo && (
                            <button type="button" onClick={handleClearLogo} className="px-3 py-2 rounded-lg bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 dark:bg-red-900/30 dark:text-red-200">
                                Remover
                            </button>
                          )}
                      </div>
                  </div>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Saldo Inicial</label>
                  {renderCurrencyInput(
                    form.saldo_inicial,
                    (value) => setForm({ ...form, saldo_inicial: value }),
                    'w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition font-bold text-lg focus:ring-1',
                    '0,00',
                  )}
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Vincular a Centro de Custo</label>
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, centro_custo_id: '' })}
                      className={`rounded-xl px-3 py-2 text-sm font-bold transition ${!form.centro_custo_id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                    >
                      Sem vínculo
                    </button>
                    {centros.map((cc) => {
                      const selected = String(form.centro_custo_id) === String(cc.id);
                      return (
                        <button
                          key={cc.id}
                          type="button"
                          onClick={() => setForm({ ...form, centro_custo_id: String(cc.id) })}
                          className={`rounded-xl px-3 py-2 text-sm font-bold transition ${selected ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                          style={selected ? { backgroundColor: primaryColor } : undefined}
                        >
                          {cc.nome}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Se existir apenas um centro disponível, ele é preenchido automaticamente na nova conta.</p>
              </div>

              <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta como disponibilidade</label>
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, conta_como_disponibilidade: true })}
                      className={`rounded-xl px-3 py-2 text-sm font-bold transition ${form.conta_como_disponibilidade ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                      style={form.conta_como_disponibilidade ? { backgroundColor: primaryColor } : undefined}
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, conta_como_disponibilidade: false })}
                      className={`rounded-xl px-3 py-2 text-sm font-bold transition ${!form.conta_como_disponibilidade ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/70 dark:text-slate-200 dark:hover:bg-slate-700'}`}
                    >
                      Não
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Quando marcada como não, a conta continua disponível em extratos e lançamentos, mas sai do saldo geral disponível.</p>
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

      {/* --- MODAL DE LANÇAMENTO (CRIAR/EDITAR) --- */}
      {lancamentoModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setLancamentoModalOpen(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">{lancamentoEditing ? 'Editar lançamento' : 'Novo lançamento'}</h2>
              <button onClick={() => setLancamentoModalOpen(false)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
                <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Descrição</label>
                <input
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.descricao}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Tipo</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.tipo}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, tipo: e.target.value }))}
                >
                  <option value="RECEITA">Receita</option>
                  <option value="DESPESA">Despesa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Status</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.status}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="EM ABERTO">Em aberto</option>
                  <option value="PAGO">Pago</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Data vencimento</label>
                <input
                  type="date"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.data_vencimento}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, data_vencimento: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Data pagamento</label>
                <input
                  type="date"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.data_pagamento}
                  onChange={e => setLancamentoForm(prev => ({ ...prev, data_pagamento: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Valor previsto</label>
                <CurrencyInput
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.valor_previsto}
                  onValueChange={(value) => setLancamentoForm(prev => ({ ...prev, valor_previsto: value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Valor pago</label>
                <CurrencyInput
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  value={lancamentoForm.valor_pago}
                  onValueChange={(value) => setLancamentoForm(prev => ({ ...prev, valor_pago: value }))}
                />
              </div>
              <div className="md:col-span-2">
                <SearchableSelect
                  label="Categoria"
                  options={catOptions}
                  value={lancamentoForm.plano_contas_id}
                  placeholder="Selecione..."
                  onChange={(id: number) => setLancamentoForm(prev => ({ ...prev, plano_contas_id: String(id) }))}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setLancamentoModalOpen(false)}
                className="px-5 py-3 rounded-xl text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSalvarLancamento}
                disabled={lancamentoSaving}
                className="px-6 py-3 rounded-xl text-white font-bold flex items-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {lancamentoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMAÇÃO DE EXCLUSÃO --- */}
      {itemToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
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