import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useLookupStore } from '../store/lookupStore';
import { useTabStore } from '../store/tabStore';
import { api, normalizeListResponse, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { BankAvatar } from '../components/BrandAvatar';
import { CurrencyInput } from '../components/CurrencyInput';
import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';
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
  has_lote_card?: boolean;
  id_parcelamento?: string | null;
  import_hash?: string | null;
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

interface ExtratoGrupoSplit {
  key: string;
  descricao: string;
  totalEntrada: number;
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

function isCompensadoOuPago(item?: Pick<LancamentoItem, 'status' | 'data_pagamento' | 'conciliado'> | null) {
  const statusPago = String(item?.status || '').toUpperCase() === 'PAGO';
  return Boolean(statusPago || item?.data_pagamento || item?.conciliado);
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
  allowed_user_ids?: number[];
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

function parseDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function Contas() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ofxInputRef = useRef<HTMLInputElement | null>(null);
  const [ofxUploading, setOfxUploading] = useState(false);
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
  const [extratoSilentSyncing, setExtratoSilentSyncing] = useState(false);
  const [contas, setContas] = useState<Conta[]>([]);
  
  // Lookups do Zustand
  const centros = useLookupStore((state) => state.centrosCusto);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const categorias = useLookupStore((state) => state.planoContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  
  // Tema Personalizado
  const empresa = useAuthStore((state) => state.empresa);
  const primaryColor = empresa?.cor_primaria || '#2563eb';

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCentroId, setFilterCentroId] = useState('');
  const [extratoSearchTerm, setExtratoSearchTerm] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');

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
  const [extratoContaId, setExtratoContaId] = useState<number | null>(null);
  const [extratoConta, setExtratoConta] = useState<Conta | null>(null);
  const [extratoLancamentos, setExtratoLancamentos] = useState<LancamentoItem[]>([]);
  const [extratoSaldoDetalhe, setExtratoSaldoDetalhe] = useState<ContaSaldoDetalhe | null>(null);
  const [extratoTipoFiltro, setExtratoTipoFiltro] = useState<ExtratoTipoFiltro>('TODOS');
  const [extratoPeriodoFiltro, setExtratoPeriodoFiltro] = useState<ExtratoPeriodoFiltro>('MES');
  const [extratoPeriodoInicio, setExtratoPeriodoInicio] = useState<string>('');
  const [extratoPeriodoFim, setExtratoPeriodoFim] = useState<string>('');
  const [localPeriodoInicio, setLocalPeriodoInicio] = useState<string>('');
  const [localPeriodoFim, setLocalPeriodoFim] = useState<string>('');
  const [extratoSelecionados, setExtratoSelecionados] = useState<number[]>([]);

  useEffect(() => {
    if (extratoPeriodoFiltro !== 'PERSONALIZADO') {
      setExtratoPeriodoInicio('');
      setExtratoPeriodoFim('');
      setLocalPeriodoInicio('');
      setLocalPeriodoFim('');
    }
  }, [extratoPeriodoFiltro]);

  function handleBuscarPeriodo() {
    setExtratoPeriodoInicio(localPeriodoInicio);
    setExtratoPeriodoFim(localPeriodoFim);
  }
  const [extratoFaturasExpandidas, setExtratoFaturasExpandidas] = useState<Record<string, boolean>>({});
  const [excluindoSelecionados, setExcluindoSelecionados] = useState(false);
  const [extratoDeleteModalOpen, setExtratoDeleteModalOpen] = useState(false);
  const [extratoDeleteStep, setExtratoDeleteStep] = useState(1);
  const [extratoDeletePhrase, setExtratoDeletePhrase] = useState('');
  const [extratoDeletePaidPhrase, setExtratoDeletePaidPhrase] = useState('');
  const [extratoDeleteIds, setExtratoDeleteIds] = useState<number[]>([]);
  const [isLancamentoDrawerOpen, setIsLancamentoDrawerOpen] = useState(false);
  const [editingLancamentoId, setEditingLancamentoId] = useState<number | null>(null);
  const [expandedLotes, setExpandedLotes] = useState<Record<number, any>>({});
  const [lotesLoading, setLotesLoading] = useState<Record<number, boolean>>({});
  const [loteVisivel, setLoteVisivel] = useState<Record<number, boolean>>({});

  // Formulário
  const [usuarios, setUsuarios] = useState<any[]>([]);
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
    tipo_integracao: 'MANUAL',
    allowed_user_ids: []
  });

  async function handleOfxFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !extratoContaId) return;

    setOfxUploading(true);
    setNotice(null);

    try {
      const fd = new FormData();
      fd.append('arquivo', file);
      
      const { data } = await api.post(
        '/importacao/ofx/upload',
        fd,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          params: { conta_id: Number(extratoContaId) },
        }
      );

      navigate('/importacao_ofx', {
        state: {
          preLoadedResult: data,
          preSelectedContaId: Number(extratoContaId),
          directFlow: true,
        },
      });
    } catch (error: any) {
      console.error('Erro ao processar arquivo OFX', error);
      setNotice({
        type: 'error',
        message: getApiErrorMessage(error, 'Erro ao processar arquivo OFX.'),
      });
    } finally {
      setOfxUploading(false);
      if (ofxInputRef.current) {
        ofxInputRef.current.value = '';
      }
    }
  }

  async function carregarUsuarios() {
    try {
      const { data } = await api.get('/rbac/users');
      setUsuarios(normalizeListResponse<any>(data));
    } catch (error) {
      console.error("Erro ao carregar usuários para controle de acesso", error);
    }
  }

  function toggleUserAccess(userId: number) {
    setForm((prev) => {
      const current = prev.allowed_user_ids || [];
      const next = current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId];
      return { ...prev, allowed_user_ids: next };
    });
  }

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
    carregarUsuarios();
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



  async function carregarDados(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [resContas] = await Promise.all([
        api.get('/contas/'),
        fetchCentrosCusto()
      ]);
      const contasNormalizadas = normalizeListResponse<Conta>(resContas.data);
      setContas(contasNormalizadas);
      return contasNormalizadas;
    } catch (error) {
      console.error("Erro ao carregar dados", error);
      return [] as Conta[];
    } finally {
      setLoading(false);
    }
  }

  async function carregarCategorias() {
    try {
      await fetchPlanoContas();
    } catch (error) {
      console.error("Erro ao carregar categorias", error);
    }
  }

  // --- ACTIONS ---
  function handleOpenCreate() {
    setIsEditing(false);
    setEditingId(null);
    setForm({
      nome: '',
      banco: '',
      agencia: '',
      conta_numero: '',
      conta_digito: '',
      tipo: 'CORRENTE',
      saldo_inicial: '',
      centro_custo_id: getSingleCentroId(centros),
      status: 'ATIVO',
      conta_como_disponibilidade: true,
      logo_url: null,
      tipo_integracao: 'MANUAL',
      allowed_user_ids: []
    });
    setLogoFile(null);
    setLogoPreview('');
    setLogoRemoved(false);
    setFormErrors({});
    setUserSearchTerm('');
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
      tipo_integracao: conta.tipo_integracao || 'MANUAL',
      allowed_user_ids: (conta as any).allowed_user_ids || []
    });
    setLogoPreview(conta.logo_url || '');
    setLogoFile(null);
    setLogoRemoved(false);
    setFormErrors({});
    setUserSearchTerm('');
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
      
      handleCloseDrawer();
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

  async function fetchLancamentosConta(contaId: number, silent = false) {
    if (!silent) setExtratoLoading(true);
    else setExtratoSilentSyncing(true);
    try {
      const { data } = await api.get<ContaSaldoDetalhe>(`/contas/${contaId}/saldo-detalhe`);
      const items = (data?.movimentos || []) as LancamentoItem[];
      setExtratoSaldoDetalhe(data);
      setExtratoLancamentos(items);
      setExtratoSelecionados([]);
      setExtratoFaturasExpandidas({});
      setExpandedLotes({});
      setLotesLoading({});
      setLoteVisivel({});
    } catch (error) {
      console.error("Erro ao carregar extrato", error);
      setExtratoSaldoDetalhe(null);
      setExtratoLancamentos([]);
      setExtratoSelecionados([]);
      setExtratoFaturasExpandidas({});
      setExpandedLotes({});
      setLotesLoading({});
      setLoteVisivel({});
    } finally {
      setExtratoLoading(false);
      setExtratoSilentSyncing(false);
    }
  }

  async function refreshExtratoContaContext(contaId: number, silent = false) {
    await fetchLancamentosConta(contaId, silent);
    const contasAtualizadas = await carregarDados(silent);
    const contaAtualizada = contasAtualizadas.find((conta) => conta.id === contaId) || null;
    setExtratoConta(contaAtualizada);
  }

  function handleCloseDrawer() {
    setDrawerOpen(false);
    useTabStore.getState().setTabDirty(location.pathname, false);
  }

  async function handleVerExtrato(conta: Conta) {
    setExtratoContaId(conta.id);
    setExtratoConta(conta);
    setExtratoOpen(true);
    setExtratoTipoFiltro('TODOS');
    setExtratoPeriodoFiltro('MES');
    setExtratoPeriodoInicio('');
    setExtratoPeriodoFim('');
    setLocalPeriodoInicio('');
    setLocalPeriodoFim('');
    setExtratoSearchTerm('');
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
    setLocalPeriodoInicio('');
    setLocalPeriodoFim('');
    setExtratoSearchTerm('');
    setExtratoSelecionados([]);
    setExtratoFaturasExpandidas({});
    setExpandedLotes({});
    setLotesLoading({});
    setLoteVisivel({});
    setExtratoConta(null);
    setExtratoContaId(null);
  }

  function toggleExtratoSelecionado(id: number) {
    setExtratoSelecionados((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function toggleExtratoFatura(key: string) {
    setExtratoFaturasExpandidas((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function toggleLoteExpand(depositoId: number) {
    if (loteVisivel[depositoId]) {
      setLoteVisivel((prev) => ({ ...prev, [depositoId]: false }));
      return;
    }

    if (expandedLotes[depositoId] !== undefined) {
      setLoteVisivel((prev) => ({ ...prev, [depositoId]: true }));
      return;
    }

    setLotesLoading((prev) => ({ ...prev, [depositoId]: true }));
    try {
      const response = await api.get(`/pdv/conciliacao/lotes/deposito/${depositoId}`);
      if (response.data && response.data.id) {
        setExpandedLotes((prev) => ({ ...prev, [depositoId]: response.data }));
        setLoteVisivel((prev) => ({ ...prev, [depositoId]: true }));
      } else {
        setExpandedLotes((prev) => ({ ...prev, [depositoId]: null }));
      }
    } catch (error) {
      console.error('Erro ao buscar lote de cartão para o depósito:', error);
      setExpandedLotes((prev) => ({ ...prev, [depositoId]: null }));
    } finally {
      setLotesLoading((prev) => ({ ...prev, [depositoId]: false }));
    }
  }

  function resetExtratoDeleteFlow() {
    setExtratoDeleteModalOpen(false);
    setExtratoDeleteStep(1);
    setExtratoDeletePhrase('');
    setExtratoDeletePaidPhrase('');
    setExtratoDeleteIds([]);
  }

  function openExtratoDeleteFlow(ids: number[]) {
    const sanitizedIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
    if (sanitizedIds.length === 0) return;

    setExtratoDeleteIds(sanitizedIds);
    setExtratoDeleteStep(1);
    setExtratoDeletePhrase('');
    setExtratoDeletePaidPhrase('');
    setExtratoDeleteModalOpen(true);
  }

  async function handleExcluirSelecionadosExtrato() {
    if (extratoSelecionados.length === 0 || !extratoContaId) return;
    openExtratoDeleteFlow(extratoSelecionados);
  }

  function handleAbrirLancamentoModal(lancamento?: LancamentoItem) {
    if (lancamento && isTransferencia(lancamento)) {
      return;
    }
    setEditingLancamentoId(lancamento?.id || null);
    setIsLancamentoDrawerOpen(true);
  }

  async function handleFecharLancamentoDrawer() {
    setIsLancamentoDrawerOpen(false);
    setEditingLancamentoId(null);
    if (!extratoContaId) return;

    try {
      await refreshExtratoContaContext(extratoContaId, true);
    } catch (error) {
      console.error('Erro ao atualizar extrato apos fechar o formulario de lancamento', error);
    }
  }

  async function handleExcluirLancamento(id: number) {
    openExtratoDeleteFlow([id]);
  }

  async function handleConfirmarExcluirExtrato() {
    if (extratoDeleteIds.length === 0 || !extratoContaId) return;

    const ids = [...extratoDeleteIds];
    const confirmarExclusaoPagos = extratoDeleteHasCompensados;

    setExcluindoSelecionados(true);
    try {
      if (ids.length === 1) {
        await api.delete(`/lancamentos/${ids[0]}`, {
          params: {
            confirmar_exclusao_pagos: confirmarExclusaoPagos,
          },
        });
      } else {
        await api.post('/lancamentos/bulk-delete', {
          ids,
          confirmar_exclusao_pagos: confirmarExclusaoPagos,
        });
      }

      resetExtratoDeleteFlow();
      await refreshExtratoContaContext(extratoContaId, true);
      setNotice({
        type: 'success',
        message: ids.length === 1 ? 'Lancamento apagado com sucesso.' : 'Lancamentos apagados com sucesso.',
      });
    } catch (error) {
      console.error('Erro ao excluir lancamento(s) do extrato', error);
      setNotice({
        type: 'error',
        message: getApiErrorMessage(error, 'Erro ao excluir lancamento(s).'),
      });
    } finally {
      setExcluindoSelecionados(false);
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
      if (!extratoPeriodoInicio && !extratoPeriodoFim) {
        return [];
      }
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

      if (extratoSearchTerm) {
        const term = extratoSearchTerm.toLowerCase();
        const descMatch = String(item.descricao || '').toLowerCase().includes(term);
        const interessadoMatch = getInteressadoLabel(item).toLowerCase().includes(term);
        
        const valEntrada = Number(item.valor_entrada || 0);
        const valSaida = Number(item.valor_saida || 0);
        const formatBRL = (val: number) => {
          if (!val) return '';
          return BRL.format(val).toLowerCase();
        };
        const formatBRLClean = (val: number) => {
          if (!val) return '';
          return BRL.format(val).replace('R$', '').trim().toLowerCase();
        };
        const valEntradaStr = String(item.valor_entrada || '');
        const valSaidaStr = String(item.valor_saida || '');

        const valorMatch = valEntradaStr.includes(term) ||
                           valSaidaStr.includes(term) ||
                           formatBRL(valEntrada).includes(term) ||
                           formatBRL(valSaida).includes(term) ||
                           formatBRLClean(valEntrada).includes(term) ||
                           formatBRLClean(valSaida).includes(term);

        if (!descMatch && !interessadoMatch && !valorMatch) return false;
      }

      return true;
    });
  }, [extratoLancamentos, extratoPeriodoFim, extratoPeriodoFiltro, extratoPeriodoInicio, extratoTipoFiltro, extratoSearchTerm]);

  const allSelected = useMemo(() => {
    return (
      extratoLancamentosFiltrados.length > 0 &&
      extratoLancamentosFiltrados.every((item) => extratoSelecionados.includes(item.id))
    );
  }, [extratoLancamentosFiltrados, extratoSelecionados]);

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

  const isFiltered = Boolean(extratoSearchTerm.trim() || extratoTipoFiltro !== 'TODOS');

  useEffect(() => {
    const visibleIds = new Set(extratoLancamentosFiltrados.map((item) => item.id));
    setExtratoSelecionados((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [extratoLancamentosFiltrados]);

  const extratoDeleteItems = useMemo(() => {
    if (extratoDeleteIds.length === 0) return [];
    const deleteSet = new Set(extratoDeleteIds);
    return extratoLancamentos.filter((item) => deleteSet.has(item.id));
  }, [extratoDeleteIds, extratoLancamentos]);

  const extratoDeleteCompensadosCount = useMemo(
    () => extratoDeleteItems.filter((item) => isCompensadoOuPago(item)).length,
    [extratoDeleteItems],
  );

  const extratoDeleteHasCompensados = extratoDeleteCompensadosCount > 0;

  const extratoAgrupado = useMemo(() => {
    const singleRows: Array<{ type: 'single'; item: LancamentoItem }> = [];
    const grouped = new Map<string, ExtratoGrupoFatura>();
    const groupedSplits = new Map<string, ExtratoGrupoSplit>();

    // Count non-card occurrences of id_parcelamento
    const splitCounts = new Map<string, number>();
    extratoLancamentosFiltrados.forEach((item) => {
      const isCardMovement = Number(item.cartao_id || 0) > 0;
      if (!isCardMovement && item.id_parcelamento) {
        const key = item.id_parcelamento.trim();
        if (key) {
          splitCounts.set(key, (splitCounts.get(key) || 0) + 1);
        }
      }
    });

    // Count non-card occurrences of import_hash
    const hashCounts = new Map<string, number>();
    extratoLancamentosFiltrados.forEach((item) => {
      const isCardMovement = Number(item.cartao_id || 0) > 0;
      if (!isCardMovement && item.import_hash) {
        const key = item.import_hash.trim();
        if (key) {
          hashCounts.set(key, (hashCounts.get(key) || 0) + 1);
        }
      }
    });

    extratoLancamentosFiltrados.forEach((item) => {
      const isCardMovement = Number(item.cartao_id || 0) > 0;
      if (isCardMovement) {
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
        return;
      }

      let splitKey = '';
      if (item.import_hash && (hashCounts.get(item.import_hash.trim()) || 0) > 1) {
        splitKey = `hash-${item.import_hash.trim()}`;
      } else if (item.id_parcelamento && (splitCounts.get(item.id_parcelamento.trim()) || 0) > 1) {
        splitKey = item.id_parcelamento.trim();
      }

      if (splitKey) {
        const currentSplit: ExtratoGrupoSplit = groupedSplits.get(splitKey) || {
          key: splitKey,
          descricao: item.descricao || "Lançamento Rateado",
          totalEntrada: 0,
          totalSaida: 0,
          saldoApos: Number(item.saldo_apos_movimento || 0),
          dataBase: getExtratoBaseDate(item),
          itens: [] as LancamentoItem[],
        };

        currentSplit.totalEntrada += Number(item.valor_entrada || 0);
        currentSplit.totalSaida += Number(item.valor_saida || 0);
        currentSplit.saldoApos = Number(item.saldo_apos_movimento || currentSplit.saldoApos || 0);
        currentSplit.dataBase = currentSplit.dataBase || getExtratoBaseDate(item);
        currentSplit.itens.push(item);
        groupedSplits.set(splitKey, currentSplit);
        return;
      }

      singleRows.push({ type: 'single', item });
    });

    grouped.forEach((group) => {
      group.itens.sort((left, right) => getDateTimestamp(getExtratoBaseDate(right)) - getDateTimestamp(getExtratoBaseDate(left)));
      group.dataBase = getExtratoBaseDate(group.itens[0] || { data_pagamento: group.dataBase, data_vencimento: group.dataBase });
      group.saldoApos = Number(group.itens[0]?.saldo_apos_movimento || group.saldoApos || 0);
    });

    groupedSplits.forEach((group) => {
      group.itens.sort((left, right) => getDateTimestamp(getExtratoBaseDate(right)) - getDateTimestamp(getExtratoBaseDate(left)));
      group.dataBase = getExtratoBaseDate(group.itens[0] || { data_pagamento: group.dataBase, data_vencimento: group.dataBase });
      group.saldoApos = Number(group.itens[0]?.saldo_apos_movimento || group.saldoApos || 0);
      
      if (group.key.startsWith("split-previsto-")) {
        const firstWithDesc = group.itens.find(i => i.descricao);
        if (firstWithDesc) {
          group.descricao = `${firstWithDesc.descricao} (Rateado)`;
        }
      } else if (group.key.startsWith("hash-")) {
        let mainItem = group.itens[0];
        let maxVal = -1;
        group.itens.forEach((i) => {
          const val = Math.abs(getExtratoSignedValue(i.valor_entrada, i.valor_saida));
          if (val > maxVal) {
            maxVal = val;
            mainItem = i;
          }
        });
        if (mainItem && mainItem.descricao) {
          group.descricao = `${mainItem.descricao} (Agrupado)`;
        } else {
          group.descricao = "Lançamento Agrupado";
        }
      }
    });

    const invoiceRows = Array.from(grouped.values()).sort((left, right) => getDateTimestamp(right.dataBase) - getDateTimestamp(left.dataBase));
    const splitRows = Array.from(groupedSplits.values()).sort((left, right) => getDateTimestamp(right.dataBase) - getDateTimestamp(left.dataBase));
    const singles = [...singleRows].sort((left, right) => getDateTimestamp(getExtratoBaseDate(right.item)) - getDateTimestamp(getExtratoBaseDate(left.item)));

    return [
      ...invoiceRows.map((group) => ({ type: 'invoice' as const, group })),
      ...splitRows.map((group) => ({ type: 'split' as const, group })),
      ...singles
    ].sort((left, right) => {
      const leftDate = left.type === 'invoice' ? left.group.dataBase : left.type === 'split' ? left.group.dataBase : getExtratoBaseDate(left.item);
      const rightDate = right.type === 'invoice' ? right.group.dataBase : right.type === 'split' ? right.group.dataBase : getExtratoBaseDate(right.item);
      return getDateTimestamp(rightDate) - getDateTimestamp(leftDate);
    });
  }, [extratoLancamentosFiltrados]);

  const extratoAgrupadoPorDia = useMemo(() => {
    const groups: { [dateStr: string]: typeof extratoAgrupado } = {};
    extratoAgrupado.forEach((row) => {
      const dateStr = row.type === 'invoice' 
        ? row.group.dataBase 
        : row.type === 'split' 
          ? row.group.dataBase 
          : getExtratoBaseDate(row.item);
      const key = dateStr || 'Sem data';
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return { groups, sortedDates };
  }, [extratoAgrupado]);

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

  const getInteressadoLabel = (lancamento: LancamentoItem) => {
    const raw = (lancamento as any).interessado_nome
      || (lancamento as any).entidade_nome
      || (lancamento as any).interessado
      || (lancamento as any).nome_entidade
      || (lancamento as any).entidade?.nome
      || '';
    const value = String(raw || '').trim();
    return value || '-';
  };

  const extratoSaldoBanco = Number(extratoConta?.saldo_atual ?? extratoSaldoDetalhe?.saldo_atual ?? 0);

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-slate-50 dark:bg-slate-900">
      <input
        type="file"
        ref={ofxInputRef}
        accept=".ofx,.qfx"
        className="hidden"
        onChange={handleOfxFileChange}
      />
      {ofxUploading && (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <div className="rounded-3xl bg-white dark:bg-slate-900 p-8 shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center max-w-sm text-center">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-500 mb-4" />
            <p className="text-base font-bold text-slate-900 dark:text-white">Processando Extrato OFX</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Lendo transações, identificando duplicatas e buscando sugestões no financeiro...</p>
          </div>
        </div>
      )}
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
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">
              {(() => {
                if (!extratoOpen || !extratoConta) return 'Contas Bancárias';
                const accName = extratoConta.nome;
                const bankName = extratoConta.banco || '';
                if (bankName && !accName.toLowerCase().includes(bankName.toLowerCase())) {
                  return `Contas Bancárias | ${accName} (${bankName})`;
                }
                return `Contas Bancárias | ${accName}`;
              })()}
            </h2>
            {!extratoOpen ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
                <Landmark className="h-4 w-4 text-slate-500 dark:text-slate-300" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Saldo disponível</span>
                <span className={`text-sm font-black ${saldoTotal >= 0 ? 'text-slate-800 dark:text-white' : 'text-rose-500'}`}>{BRL.format(saldoTotal)}</span>
              </div>
            ) : null}
          </div>
          <p className="text-sm text-slate-400">
            {extratoOpen && extratoConta ? 'Movimentos conciliados e fluxo financeiro da conta' : 'Caixas, Bancos e Investimentos'}
          </p>
          {!extratoOpen && filterCentroId ? (
            <p className="text-[10px] font-bold" style={{ color: primaryColor }}>* Filtrado por Centro de Custo</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          {extratoOpen && (
            <button
              onClick={handleVoltarExtrato}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold"
            >
              Voltar
            </button>
          )}
          <button 
            onClick={() => {
              if (extratoOpen && extratoContaId) {
                void refreshExtratoContaContext(extratoContaId, true);
                return;
              }
              void carregarDados(true);
            }}
            className="p-2 text-slate-400 transition border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 hover:brightness-95 relative" 
            style={{ color: loading || extratoLoading || extratoSilentSyncing ? undefined : primaryColor }}
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${loading || extratoLoading || extratoSilentSyncing ? 'animate-spin' : ''}`} />
            {extratoSilentSyncing && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            )}
          </button>
          <button
            onClick={() => {
              if (extratoOpen && extratoContaId) {
                ofxInputRef.current?.click();
              } else {
                navigate('/importacao_ofx');
              }
            }}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-sm whitespace-nowrap"
          >
            Importar OFX
          </button>
          {extratoOpen && extratoContaId && (
            <button
              onClick={() => handleAbrirLancamentoModal()}
              className="px-4 py-2 rounded-lg text-white font-bold text-sm flex items-center gap-2"
              style={{ backgroundColor: primaryColor }}
            >
              <Plus className="w-4 h-4" /> Novo lancamento
            </button>
          )}
          {!extratoOpen ? (
            <button 
              onClick={handleOpenCreate}
              className="text-white px-5 py-2 rounded-lg shadow-md flex items-center gap-2 font-bold transition active:scale-95 text-sm whitespace-nowrap hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              <Plus className="w-4 h-4" /> Nova Conta
            </button>
          ) : null}
        </div>
      </header>

      {/* ÁREA DE CONTEÚDO */}
      <div className={`flex-1 overflow-y-auto custom-scrollbar ${extratoOpen ? 'p-3 sm:p-4 space-y-3.5 pb-24' : 'p-4 sm:p-6 space-y-6 pb-32'}`}>
        
        {extratoOpen ? (
          <div className="space-y-3.5">
            {extratoSaldoDetalhe && (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Saldo do banco</p>
                    <p className={`mt-1.5 text-lg font-black ${extratoSaldoBanco >= 0 ? 'text-slate-800 dark:text-white' : 'text-rose-600 dark:text-rose-300'}`}>{BRL.format(extratoSaldoBanco)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-white p-3 shadow-sm dark:border-emerald-950 dark:bg-slate-800">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Entradas filtradas</p>
                    <p className="mt-1.5 text-lg font-black text-emerald-600 dark:text-emerald-300">{BRL.format(Number(extratoResumoFiltrado.entradas || 0))}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-white p-3 shadow-sm dark:border-rose-950 dark:bg-slate-800">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Saídas filtradas</p>
                    <p className="mt-1.5 text-lg font-black text-rose-600 dark:text-rose-300">{BRL.format(Number(extratoResumoFiltrado.saidas || 0))}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Movimentos no filtro</p>
                    <p className="mt-1.5 text-lg font-black text-slate-800 dark:text-white">
                      {extratoResumoFiltrado.quantidade} <span className="text-[11px] font-normal text-slate-400">/ {extratoSaldoDetalhe.quantidade_movimentos}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Barra de Pesquisa do Extrato */}
                    <div className="relative group">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16}
                        style={{ color: extratoSearchTerm ? primaryColor : undefined }}
                      />
                      <input
                        type="text"
                        placeholder="Pesquisar extrato..."
                        value={extratoSearchTerm}
                        onChange={(e) => setExtratoSearchTerm(e.target.value)}
                        className="pl-9 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none text-xs w-48 sm:w-60 focus:ring-1 transition"
                        style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      />
                      {extratoSearchTerm && (
                        <button
                          type="button"
                          onClick={() => setExtratoSearchTerm('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 transition"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {/* Filtro de Tipo */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-xl">
                      {([
                        { id: 'TODOS', label: 'Tudo' },
                        { id: 'ENTRADAS', label: 'Entradas' },
                        { id: 'SAIDAS', label: 'Saídas' },
                      ] as Array<{ id: ExtratoTipoFiltro; label: string }>).map((option) => {
                        const active = extratoTipoFiltro === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setExtratoTipoFiltro(option.id)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${active ? 'text-white shadow-sm' : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white'}`}
                            style={active ? { backgroundColor: primaryColor } : undefined}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Filtro de Período */}
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/50 p-1 rounded-xl">
                      {([
                        { id: 'DIA', label: 'Dia' },
                        { id: 'SEMANA', label: 'Semana' },
                        { id: 'MES', label: 'Mês' },
                        { id: 'ANO', label: 'Ano' },
                        { id: 'PERSONALIZADO', label: 'Período' },
                      ] as Array<{ id: ExtratoPeriodoFiltro; label: string }>).map((option) => {
                        const active = extratoPeriodoFiltro === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setExtratoPeriodoFiltro(option.id)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${active ? 'text-white shadow-sm' : 'text-slate-600 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white'}`}
                            style={active ? { backgroundColor: primaryColor } : undefined}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Inputs de Data Personalizada */}
                    {extratoPeriodoFiltro === 'PERSONALIZADO' && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={localPeriodoInicio}
                          onChange={(event) => setLocalPeriodoInicio(event.target.value)}
                          max={localPeriodoFim || undefined}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:ring-1 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        />
                        <span className="text-slate-400 text-xs">até</span>
                        <input
                          type="date"
                          value={localPeriodoFim}
                          onChange={(event) => setLocalPeriodoFim(event.target.value)}
                          min={localPeriodoInicio || undefined}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:ring-1 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        />
                        <button
                          type="button"
                          onClick={handleBuscarPeriodo}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition hover:brightness-95 active:scale-95 shadow-sm"
                          style={{ backgroundColor: primaryColor }}
                        >
                          Buscar
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Ações / Apagar selecionados */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExcluirSelecionadosExtrato}
                      disabled={extratoSelecionados.length === 0 || excluindoSelecionados}
                      className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-1.5 transition"
                    >
                      {excluindoSelecionados ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Apagar selecionados ({extratoSelecionados.length})
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="p-3 w-12">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => {
                            if (allSelected) {
                              setExtratoSelecionados([]);
                            } else {
                              setExtratoSelecionados(extratoLancamentosFiltrados.map((item) => item.id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                        />
                      </th>
                      <th className="p-3">Data base</th>
                      <th className="p-3">Descrição</th>
                      <th className="p-3">Interessado</th>
                      <th className="p-3">Categoria</th>
                      <th className="p-3">Origem</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Entrada/Saída</th>
                      <th className="p-3 text-right">Saldo após</th>
                      <th className="p-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] divide-y divide-slate-100 dark:divide-slate-700">
                    {extratoLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className="p-3"><div className="h-4 w-4 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-12 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3"><div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" /></td>
                          <td className="p-3 text-right"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded inline-block" /></td>
                          <td className="p-3 text-right"><div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded inline-block" /></td>
                          <td className="p-3 text-right"><div className="h-8 w-16 bg-slate-200 dark:bg-slate-700 rounded inline-block" /></td>
                        </tr>
                      ))
                    ) : extratoAgrupado.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-6 text-center text-slate-400 italic">
                          {extratoPeriodoFiltro === 'PERSONALIZADO' && !extratoPeriodoInicio && !extratoPeriodoFim
                            ? 'Selecione um período acima e clique em "Buscar" para filtrar os lançamentos.'
                            : 'Nenhum movimento encontrado para os filtros selecionados.'}
                        </td>
                      </tr>
                    ) : (
                      extratoAgrupadoPorDia.sortedDates.map((dateStr) => {
                        const groupRows = extratoAgrupadoPorDia.groups[dateStr];
                        const dayTotal = groupRows.reduce((sum, row) => {
                          if (row.type === 'invoice') {
                            return sum - Math.abs(row.group.totalSaida);
                          } else if (row.type === 'split') {
                            return sum + (row.group.totalEntrada - row.group.totalSaida);
                          } else {
                            const val = getExtratoSignedValue(row.item.valor_entrada, row.item.valor_saida);
                            return sum + val;
                          }
                        }, 0);

                        return (
                          <React.Fragment key={dateStr}>
                            <tr className="bg-slate-100/70 dark:bg-slate-800/60 select-none">
                              <td colSpan={10} className="px-3 py-1.5 border-t border-b border-slate-200/50 dark:border-slate-800/80">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                  <span>Dia {formatDateLike(dateStr)}</span>
                                  <span>Movimentação do Dia: <span className={dayTotal >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{formatSignedCurrency(dayTotal)}</span></span>
                                </div>
                              </td>
                            </tr>
                            {groupRows.map((row) => {
                              if (row.type === 'invoice') {
                                const isExpanded = !!extratoFaturasExpandidas[row.group.key];
                                const competenciaLabel = row.group.competencia
                                  ? new Date(`${row.group.competencia}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
                                  : '-';

                                return (
                                  <React.Fragment key={row.group.key}>
                                    <tr className="bg-slate-50/80 dark:bg-slate-800/60">
                                      <td className="p-3 align-top">
                                        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                          {row.group.itens.length}
                                        </span>
                                      </td>
                                      <td className="p-3 font-mono text-xs text-slate-400/50 align-top">—</td>
                                      <td className="p-3 align-top">
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
                                      <td className="p-3 text-slate-400 align-top">-</td>
                                      <td className="p-3 text-slate-500 align-top">Cartão de crédito</td>
                                      <td className="p-3 text-slate-500 align-top">FATURA</td>
                                      <td className="p-3 align-top">
                                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                          AGRUPADO
                                        </span>
                                      </td>
                                      <td className="p-3 text-right font-bold text-rose-600 align-top whitespace-nowrap">{formatSignedCurrency(-Math.abs(row.group.totalSaida))}</td>
                                      <td className={`p-3 text-right font-bold align-top whitespace-nowrap ${row.group.saldoApos >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{isFiltered ? '—' : formatSignedCurrency(row.group.saldoApos)}</td>
                                      <td className="p-3" />
                                    </tr>

                                    {isExpanded && row.group.itens.map((l) => (
                                      <tr key={l.id} className="bg-amber-50/20 dark:bg-amber-950/10 border-l-[3px] border-amber-500 hover:bg-amber-50/30 dark:hover:bg-amber-950/20 transition-colors">
                                        <td className="p-3 pl-10">
                                          <input
                                            type="checkbox"
                                            checked={extratoSelecionados.includes(l.id)}
                                            onChange={() => toggleExtratoSelecionado(l.id)}
                                            className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                          />
                                        </td>
                                        <td className="p-3 font-mono text-xs text-slate-400/50 align-top">—</td>
                                        <td className="p-3 font-medium text-slate-700 dark:text-slate-200 pl-4">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-amber-500 font-mono text-xs select-none">↳</span>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span>{l.descricao}</span>
                                              {l.conciliado && (
                                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50 select-none shrink-0" title="Lançamento Conciliado com o Banco">
                                                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                                                  Conciliado
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="text-[10px] text-slate-400 pl-3.5 font-normal">{l.numero_parcela ? `${l.numero_parcela}ª parcela` : 'À vista'}</div>
                                        </td>
                                        <td className="p-3 text-slate-500">{getInteressadoLabel(l)}</td>
                                        <td className="p-3 text-slate-500">{getCategoriaLabel(l)}</td>
                                        <td className="p-3 text-slate-500">{l.origem || '-'}</td>
                                        <td className="p-3">
                                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {l.status}
                                          </span>
                                        </td>
                                        <td className={`p-3 text-right font-bold whitespace-nowrap ${getExtratoSignedValue(l.valor_entrada, l.valor_saida) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatSignedCurrency(getExtratoSignedValue(l.valor_entrada, l.valor_saida))}</td>
                                        <td className={`p-3 text-right font-bold whitespace-nowrap ${Number(l.saldo_apos_movimento || 0) >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{isFiltered ? '—' : formatSignedCurrency(Number(l.saldo_apos_movimento || 0))}</td>
                                        <td className="p-3 text-right">
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

                              if (row.type === 'split') {
                                const isExpanded = !!extratoFaturasExpandidas[row.group.key];
                                const totalMovimento = row.group.totalEntrada - row.group.totalSaida;

                                return (
                                  <React.Fragment key={row.group.key}>
                                    <tr className="bg-slate-50/80 dark:bg-slate-800/60">
                                      <td className="p-3 align-top">
                                        <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                          {row.group.itens.length}
                                        </span>
                                      </td>
                                      <td className="p-3 font-mono text-xs text-slate-400/50 align-top">—</td>
                                      <td className="p-3 align-top" colSpan={4}>
                                        <button
                                          onClick={() => toggleExtratoFatura(row.group.key)}
                                          className="flex items-start gap-3 text-left"
                                        >
                                          <ChevronDown className={`mt-0.5 h-4 w-4 text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                                          <div>
                                            <div className="font-semibold text-slate-800 dark:text-slate-100">{row.group.descricao}</div>
                                            <div className="text-xs text-slate-500">
                                              {row.group.itens.length} lançamento(s) {row.group.key.startsWith('hash-') ? 'agrupado(s)' : 'rateado(s)'}
                                            </div>
                                          </div>
                                        </button>
                                      </td>
                                      <td className="p-3 align-top">
                                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                          {row.group.key.startsWith('hash-') ? 'AGRUPADO' : 'RATEADO'}
                                        </span>
                                      </td>
                                      <td className={`p-3 text-right font-bold align-top whitespace-nowrap ${totalMovimento >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {formatSignedCurrency(totalMovimento)}
                                      </td>
                                      <td className={`p-3 text-right font-bold align-top whitespace-nowrap ${row.group.saldoApos >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{isFiltered ? '—' : formatSignedCurrency(row.group.saldoApos)}</td>
                                      <td className="p-3" />
                                    </tr>

                                    {isExpanded && row.group.itens.map((l) => (
                                      <tr key={l.id} className="bg-indigo-50/20 dark:bg-indigo-950/10 border-l-[3px] border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 transition-colors">
                                        <td className="p-3 pl-10">
                                          <input
                                            type="checkbox"
                                            checked={extratoSelecionados.includes(l.id)}
                                            onChange={() => toggleExtratoSelecionado(l.id)}
                                            className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                          />
                                        </td>
                                        <td className="p-3 font-mono text-xs text-slate-400/50 align-top">—</td>
                                        <td className="p-3 font-medium text-slate-700 dark:text-slate-200 pl-4">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-indigo-500 font-mono text-xs select-none">↳</span>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span>{l.descricao}</span>
                                              {l.conciliado && (
                                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50 select-none shrink-0" title="Lançamento Conciliado com o Banco">
                                                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                                                  Conciliado
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                        <td className="p-3 text-slate-500">{getInteressadoLabel(l)}</td>
                                        <td className="p-3 text-slate-500">{getCategoriaLabel(l)}</td>
                                        <td className="p-3 text-slate-500">{l.origem || '-'}</td>
                                        <td className="p-3">
                                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {l.status}
                                          </span>
                                        </td>
                                        <td className={`p-3 text-right font-bold whitespace-nowrap ${getExtratoSignedValue(l.valor_entrada, l.valor_saida) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatSignedCurrency(getExtratoSignedValue(l.valor_entrada, l.valor_saida))}</td>
                                        <td className={`p-3 text-right font-bold whitespace-nowrap ${Number(l.saldo_apos_movimento || 0) >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{isFiltered ? '—' : formatSignedCurrency(Number(l.saldo_apos_movimento || 0))}</td>
                                        <td className="p-3 text-right">
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
                              const hasLoteDetails = !!l.has_lote_card;
                              return (
                                <React.Fragment key={l.id}>
                                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="p-3">
                                      <input
                                        type="checkbox"
                                        checked={extratoSelecionados.includes(l.id)}
                                        onChange={() => toggleExtratoSelecionado(l.id)}
                                        className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                                      />
                                    </td>
                                    <td className="p-3 font-mono text-xs text-slate-400/50 align-top">—</td>
                                    <td className="p-3 font-medium text-slate-700 dark:text-slate-200">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {hasLoteDetails && (
                                          <button
                                            onClick={() => toggleLoteExpand(l.id)}
                                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition"
                                            title="Ver detalhes das vendas conciliadas neste repasse"
                                          >
                                            {lotesLoading[l.id] ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                                            ) : (
                                              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${loteVisivel[l.id] ? 'rotate-180' : ''}`} />
                                            )}
                                          </button>
                                        )}
                                        <span>{l.descricao}</span>
                                        {l.conciliado && (
                                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50 select-none shrink-0" title="Lançamento Conciliado com o Banco">
                                            <Check className="h-2.5 w-2.5 stroke-[3]" />
                                            Conciliado
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3 text-slate-500">{getInteressadoLabel(l)}</td>
                                    <td className="p-3 text-slate-500">{getCategoriaLabel(l)}</td>
                                    <td className="p-3 text-slate-500">{l.origem || '-'}</td>
                                    <td className="p-3">
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${l.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {l.status}
                                      </span>
                                    </td>
                                    <td className={`p-3 text-right font-bold whitespace-nowrap ${getExtratoSignedValue(l.valor_entrada, l.valor_saida) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatSignedCurrency(getExtratoSignedValue(l.valor_entrada, l.valor_saida))}</td>
                                    <td className={`p-3 text-right font-bold whitespace-nowrap ${Number(l.saldo_apos_movimento || 0) >= 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600'}`}>{isFiltered ? '—' : formatSignedCurrency(Number(l.saldo_apos_movimento || 0))}</td>
                                    <td className="p-3 text-right">
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
                                  {loteVisivel[l.id] && expandedLotes[l.id] && (
                                    <>
                                      <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        <td className="p-2 pl-12" colSpan={3}>Vendas Conciliadas</td>
                                        <td className="p-2 text-right">Valor Bruto</td>
                                        <td className="p-2 text-right">Taxa</td>
                                        <td className="p-2 text-right">Valor Líquido</td>
                                        <td className="p-2" colSpan={4}></td>
                                      </tr>
                                      {expandedLotes[l.id].itens?.map((item: any) => (
                                        <tr key={item.id} className="bg-slate-50/20 dark:bg-slate-800/10 text-xs text-slate-600 dark:text-slate-450 border-l-2 border-blue-500">
                                          <td className="p-2"></td>
                                          <td className="p-2 font-mono text-slate-400 dark:text-slate-500">{item.data_venda ? new Date(item.data_venda + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</td>
                                          <td className="p-2 font-medium">{item.descricao_venda || 'Venda de Cartão'}</td>
                                          <td className="p-2 text-right font-mono">{BRL.format(Number(item.valor_bruto))}</td>
                                          <td className="p-2 text-right font-mono text-rose-500">-{BRL.format(Number(item.valor_taxa))}</td>
                                          <td className="p-2 text-right font-mono text-emerald-600 font-bold">{BRL.format(Number(item.valor_liquido))}</td>
                                          <td className="p-2" colSpan={4}></td>
                                        </tr>
                                      ))}
                                      <tr className="bg-slate-50/40 dark:bg-slate-800/20 text-xs font-bold text-slate-700 dark:text-slate-350 border-b border-slate-200 dark:border-slate-700 border-l-2 border-blue-500">
                                        <td className="p-2 pl-12" colSpan={3}>Total do Lote</td>
                                        <td className="p-2 text-right font-mono">{BRL.format(Number(expandedLotes[l.id].valor_bruto))}</td>
                                        <td className="p-2 text-right font-mono text-rose-500">-{BRL.format(Number(expandedLotes[l.id].valor_taxa))}</td>
                                        <td className="p-2 text-right font-mono text-emerald-600">{BRL.format(Number(expandedLotes[l.id].valor_liquido))}</td>
                                        <td className="p-2" colSpan={4}></td>
                                      </tr>
                                    </>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
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
            {/* BARRA DE FILTROS */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative group flex-1">
                    <Search className="absolute left-4 top-3.5 text-slate-400 transition-colors" size={20} 
                      style={{ color: searchTerm ? primaryColor : undefined }}
                    />
                    <input 
                      type="text" 
                      placeholder="Pesquisar conta..." 
                      className="w-full pl-12 pr-10 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none transition shadow-sm focus:ring-2"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                      >
                        <X size={18} />
                      </button>
                    )}
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
            {loading ? (
              <div className="space-y-6">
                <section className="space-y-3">
                  <div>
                    <div className="h-4 bg-slate-200 dark:bg-slate-700 w-48 rounded animate-pulse" />
                    <div className="h-3 bg-slate-200 dark:bg-slate-700 w-64 rounded mt-2 animate-pulse" />
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4 animate-pulse">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 w-2/3 rounded" />
                            <div className="h-3 bg-slate-200 dark:bg-slate-700 w-1/3 rounded" />
                          </div>
                        </div>
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2">
                          <div className="h-3 bg-slate-200 dark:bg-slate-700 w-1/4 rounded" />
                          <div className="h-6 bg-slate-200 dark:bg-slate-700 w-1/2 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : filteredContas.length === 0 ? (
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
                            <div
                              key={c.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                void handleVerExtrato(c);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  void handleVerExtrato(c);
                                }
                              }}
                              className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 relative group cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${c.status === 'INATIVO' ? 'opacity-65 grayscale-[35%] bg-slate-50/50 dark:bg-slate-800/40' : ''}`}
                              style={{ '--hover-color': primaryColor } as React.CSSProperties}
                              aria-label={`Abrir extrato da conta ${c.nome}`}
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

                                <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition flex gap-1">
                                  {c.tipo !== 'CAIXA' && (c.tipo_integracao === 'ASAAS' || c.banco?.toUpperCase() === 'ASAAS') && (
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        navigate(`/integracoes/asaas?conta_id=${c.id}`);
                                      }}
                                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded text-slate-500"
                                      title={c.tipo_integracao === 'ASAAS' ? 'Gerenciar integração Asaas' : 'Conectar Asaas nesta conta'}
                                    >
                                      <Settings className="w-4 h-4" />
                                    </button>
                                  )}
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleOpenEdit(c);
                                    }}
                                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-600 rounded"
                                    style={{ color: primaryColor }}
                                    title="Editar conta"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setItemToDelete(c);
                                    }}
                                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/20 rounded text-red-500"
                                    title="Excluir conta"
                                  >
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
                                  <span
                                    className="text-xs font-bold flex items-center gap-1"
                                    style={{ color: primaryColor }}
                                  >
                                    Ver Extrato <ChevronRight className="w-3 h-3" />
                                  </span>
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
        onClick={handleCloseDrawer}
      />
      
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[min(50vw,58rem)] bg-white dark:bg-slate-900 z-50 transform transition-transform duration-300 ease-out border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
              <h2 className="text-lg font-bold text-slate-850 dark:text-white">{isEditing ? 'Editar Conta' : 'Nova Conta'}</h2>
              <button onClick={handleCloseDrawer} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full hover:opacity-80 transition">
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

              {form.tipo !== 'CAIXA' && (!form.agencia?.trim() || !form.conta_numero?.trim()) && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 px-3 py-2 rounded-lg leading-snug">
                  💡 <strong>Recomendação:</strong> Informe a Agência e Conta para garantir que a conciliação automática de arquivos OFX funcione corretamente para este banco.
                </p>
              )}

              <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase text-slate-500">Logo / Foto do Banco</label>
                  <div className="flex items-center gap-3">
                      <div className="w-18 h-18 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 overflow-hidden flex items-center justify-center text-[10px] text-slate-400 shadow-sm">
                          {hasCustomLogo ? (
                            <img src={getFullLogoUrl(logoPreview || form.logo_url || '') || ''} alt="Logo" className="w-full h-full object-contain bg-white p-2 dark:bg-slate-900" />
                          ) : form.tipo === 'CAIXA' ? (
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

              {form.tipo === 'CAIXA' && (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500">Operadores autorizados a acessar este Caixa</label>
                    <p className="mt-1 text-[11px] text-slate-400 leading-normal">Marque os operadores de caixa que terão acesso a esta conta na página de Caixa e PDV. Se nenhum for selecionado, apenas administradores poderão acessar.</p>
                  </div>
                  {usuarios.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Nenhum operador/usuário encontrado para vincular.</p>
                  ) : (
                    <>
                      <div className="relative group mb-2">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={14}
                          style={{ color: userSearchTerm ? primaryColor : undefined }}
                        />
                        <input
                          type="text"
                          placeholder="Pesquisar operadores..."
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none text-xs focus:ring-1 transition"
                          style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                        />
                        {userSearchTerm && (
                          <button
                            type="button"
                            onClick={() => setUserSearchTerm('')}
                            className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1 pt-1">
                        {(() => {
                          const filtered = usuarios.filter((u) => {
                            const name = String(u.nome || '').toLowerCase();
                            const email = String(u.email || '').toLowerCase();
                            const term = userSearchTerm.toLowerCase();
                            return name.includes(term) || email.includes(term);
                          });
                          if (filtered.length === 0) {
                            return <p className="text-xs text-slate-400 italic p-2 text-center">Nenhum operador encontrado com este termo.</p>;
                          }
                          return filtered.map((u) => {
                            const isChecked = (form.allowed_user_ids || []).includes(u.id);
                            return (
                              <button
                                key={u.id}
                                type="button"
                                onClick={() => toggleUserAccess(u.id)}
                                className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${isChecked ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500 uppercase shrink-0">
                                    {u.nome?.slice(0, 2).toUpperCase() || 'OP'}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-tight">{u.nome}</p>
                                    <p className="text-xs text-slate-400 truncate mt-0.5">{u.email}</p>
                                  </div>
                                </div>
                                <div className={`h-5 w-5 rounded border flex items-center justify-center transition ${isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                                  {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                                </div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                    </>
                  )}
                </div>
              )}

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

          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
              {isEditing && editingId ? (
                <button
                  type="button"
                  onClick={() => {
                    const currentConta = contas.find(c => c.id === editingId);
                    if (currentConta) {
                      setItemToDelete(currentConta);
                      handleCloseDrawer();
                    }
                  }}
                  className="px-4 py-3 rounded-xl text-red-600 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-red-950/20 text-sm transition flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" /> Excluir Conta
                </button>
              ) : <div />}
              <div className="flex gap-3">
                  <button 
                    onClick={handleCloseDrawer}
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
      </div>

      <LancamentoFormDrawer
        showDrawer={isLancamentoDrawerOpen}
        editarId={editingLancamentoId}
        contaId={extratoContaId}
        onClose={handleFecharLancamentoDrawer}
        onSaveSuccess={handleFecharLancamentoDrawer}
        categorias={categorias}
        contas={contas}
        centros={centros}
      />

      {extratoDeleteModalOpen && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => {
              if (!excluindoSelecionados) resetExtratoDeleteFlow();
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">Apagar lancamentos do extrato</h3>
              <span className="text-[11px] font-bold text-slate-400">Etapa {extratoDeleteStep} de 2</span>
            </div>

            {extratoDeleteStep === 1 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700/70 dark:bg-rose-900/20 dark:text-rose-200">
                  Voce esta prestes a apagar <strong>{extratoDeleteIds.length}</strong> lancamento(s) que influenciam o saldo desta conta. Esta acao e irreversivel.
                </div>
                {extratoDeleteHasCompensados && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-200">
                    Atencao: <strong>{extratoDeleteCompensadosCount}</strong> item(ns) pago(s)/compensado(s) exigem confirmacao adicional.
                  </div>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-300">Revise os itens e avance para confirmar a exclusao.</p>
              </div>
            )}

            {extratoDeleteStep === 2 && (
              <div className="space-y-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700/70 dark:bg-rose-900/20 dark:text-rose-200">
                  Digite <strong>APAGAR</strong> para confirmar.
                </div>
                <input
                  type="text"
                  value={extratoDeletePhrase}
                  onChange={(event) => setExtratoDeletePhrase(event.target.value)}
                  placeholder="Digite APAGAR"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:ring-1 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                />

                {extratoDeleteHasCompensados && (
                  <>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-200">
                      Como ha itens pagos/compensados, digite <strong>EXCLUIR PAGOS</strong>.
                    </div>
                    <input
                      type="text"
                      value={extratoDeletePaidPhrase}
                      onChange={(event) => setExtratoDeletePaidPhrase(event.target.value)}
                      placeholder="Digite EXCLUIR PAGOS"
                      className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:ring-1 dark:border-amber-700 dark:bg-slate-900 dark:text-white"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                    />
                  </>
                )}
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={resetExtratoDeleteFlow}
                disabled={excluindoSelecionados}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              {extratoDeleteStep > 1 && (
                <button
                  type="button"
                  onClick={() => setExtratoDeleteStep((prev) => Math.max(1, prev - 1))}
                  disabled={excluindoSelecionados}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Voltar
                </button>
              )}
              {extratoDeleteStep < 2 ? (
                <button
                  type="button"
                  onClick={() => setExtratoDeleteStep(2)}
                  disabled={excluindoSelecionados}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: primaryColor }}
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleConfirmarExcluirExtrato();
                  }}
                  disabled={
                    excluindoSelecionados
                    || extratoDeletePhrase.trim() !== 'APAGAR'
                    || (extratoDeleteHasCompensados && extratoDeletePaidPhrase.trim().toUpperCase() !== 'EXCLUIR PAGOS')
                  }
                  className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {excluindoSelecionados ? 'Apagando...' : 'Apagar agora'}
                </button>
              )}
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