import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState, Fragment, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Banknote,
  Building2,
  CalendarDays,
  Landmark,
  Rows3,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TrendingUp,
  ExternalLink,
  Activity,
  Check,
  Clock,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
import {
  CreditCard, UploadCloud,
  History, Wallet, Search,
  ArrowRight, FileText, AlertCircle, Calendar, Edit2, Archive, Loader2, PlayCircle, Eye, Printer, Layers, RefreshCw, Filter
} from 'lucide-react';
import { ComprasFiltrosSidebar } from '../components/ComprasFiltrosSidebar';
import type { ComprasFiltrosAvancados } from '../components/ComprasFiltrosSidebar';
import { SearchableSelect } from '../components/SearchableSelect';
import ExcelJS from 'exceljs';


import { AsyncApexChart } from '../components/AsyncApexChart';
import { BankAvatar } from '../components/BrandAvatar';
import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';
import axios from 'axios';
import { api, getPublicBaseUrl, normalizeListResponse, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { useKyrusWsListener } from '../hooks/useKyrusWebSocket';
import { useTransactionStore } from '../store/transactionStore';
import type { LancamentoResumo, NormalizedRow, StatusFilter, FlowFilter } from '../store/transactionStore';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
  logo_url?: string | null;
  centro_custo_id?: number | null;
  tipo: string;
  saldo_inicial: number;
  saldo_atual?: number;
  status?: 'ATIVO' | 'INATIVO' | string;
  conta_como_disponibilidade?: boolean;
}



interface PlanoContaResumo {
  id: number;
  nome: string;
  tipo: string;
  conta_pai_id?: number | null;
  eh_operacional?: boolean;
  dre_grupo?: string;
}

interface ContaSaldoMovimento {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  valor_entrada: number;
  valor_saida: number;
  saldo_apos_movimento?: number | null;
  conciliado?: boolean;
}

interface ContaSaldoDetalhe {
  conta_id: number;
  conta_nome: string;
  saldo_atual: number;
  quantidade_movimentos: number;
  movimentos: ContaSaldoMovimento[];
}

interface EntidadeResumo {
  id: number;
  nome: string;
  nome_fantasia?: string | null;
}

interface CentroCustoResumo {
  id: number;
  nome: string;
  codigo?: string | null;
}

interface UserInfo {
  empresa_id?: number | null;
  is_consultor?: boolean;
}

interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  razao_social?: string;
  cor_primaria?: string;
  logo_url?: string | null;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

interface HealthResponse {
  server_date?: string;
  server_datetime?: string;
}

interface IntegracaoBancaria {
  id: number;
  nome: string;
  tipo: string;
  ambiente: string;
  conta_id?: number | null;
  centro_custo_id?: number | null;
  data_inicio_sincronizacao?: string | null;
  token_configurado?: boolean;
}

function resolveCentroCustoId(currentValue: number | null, centros: CentroCustoResumo[]): number | null {
  if (currentValue === null) {
    return null;
  }
  if (centros.some((centro) => centro.id === currentValue)) {
    return currentValue;
  }
  return null;
}

type ViewMode = 'executivo' | 'pay-receive' | 'compras';
type CompraTipoFilter = 'ALL' | 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
type CompraChartMode = 'LINHA_SEPARADA' | 'COLUNA_EMPILHADA';

type AuditPanelMode = 'LANCAMENTOS' | 'EXTRATO_BANCO';

interface AuditPanelState {
  mode: AuditPanelMode;
  title: string;
  subtitle: string;
  rows?: NormalizedRow[];
  conta?: ContaResumo;
  extrato?: ContaSaldoDetalhe;
}



const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function getTodayInTimeZoneIso(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return toIsoDate(new Date());
  }

  return `${year}-${month}-${day}`;
}

function getBusinessTodayIso() {
  return getTodayInTimeZoneIso('America/Sao_Paulo');
}

function extractIsoDate(value?: string | null) {
  const match = String(value || '').trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function buildLancamentoFingerprint(item: Partial<LancamentoResumo>) {
  const idPart = Number(item.id);
  if (Number.isFinite(idPart) && idPart > 0) {
    return `id:${idPart}`;
  }

  const due = extractIsoDate(item.data_vencimento) || '';
  const descricao = normalizeText(item.descricao || '');
  const tipo = normalizeText(item.tipo || '');
  const previsto = Number(item.valor_previsto || 0);
  const pago = Number(item.valor_pago || 0);
  return `fp:${due}|${descricao}|${tipo}|${previsto}|${pago}`;
}

function dedupeLancamentos(items: LancamentoResumo[]) {
  const seen = new Set<string>();
  const unique: LancamentoResumo[] = [];

  items.forEach((item) => {
    const key = buildLancamentoFingerprint(item);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return unique;
}

function formatDate(value?: string | null) {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.toLocaleDateString('pt-BR') : '-';
}

function formatCurrency(value: number) {
  return BRL.format(value).replace(/\s/g, '\u00A0');
}

function formatCurrencyDetailed(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0)).replace(/\s/g, '\u00A0');
}

function formatCurrencyCompact(value: number) {
  const abs = Math.abs(Number(value || 0));
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} bi`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mi`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return `${Math.round(value)}`;
}

function parseDestinoCompra(value?: string | null): 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.includes('encomenda')) return 'ENCOMENDA';
  if (normalized.includes('estoque')) return 'ESTOQUE';
  if (normalized.includes('demonstracao') || normalized.includes('demonstração')) return 'DEMONSTRACAO';
  return null;
}

function extractDestinoCompraFromObservacao(observacao?: string | null): 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | null {
  const match = String(observacao || '').match(/DestinoCompra\s*[:=]?\s*(ENCOMENDA|ESTOQUE|DEMONSTRACAO)/i);
  return parseDestinoCompra(match?.[1] || null);
}

function extractNfeNumeroFromText(text?: string | null) {
  const match = String(text || '').match(/NF-?e\s*[:#]?\s*\(?\s*(\d+)\)?/i);
  return String(match?.[1] || '').trim() || null;
}

function resolveNfeNumeroFromLancamento(item: LancamentoResumo) {
  return (
    extractNfeNumeroFromText(item.descricao)
    || extractNfeNumeroFromText(item.observacao)
    || String(item.id_parcelamento || '').trim().replace(/^NFE-/, '')
    || null
  );
}

function readChartDataPointIndex(config: any) {
  const directIndex = Number(config?.dataPointIndex);
  if (Number.isFinite(directIndex) && directIndex >= 0) return directIndex;

  const globalsIndex = Number(config?.w?.globals?.dataPointIndex);
  if (Number.isFinite(globalsIndex) && globalsIndex >= 0) return globalsIndex;

  const selectedDataPoints = config?.w?.globals?.selectedDataPoints;
  if (Array.isArray(selectedDataPoints)) {
    for (const seriesPoints of selectedDataPoints) {
      if (!Array.isArray(seriesPoints) || seriesPoints.length === 0) continue;
      const idx = Number(seriesPoints[seriesPoints.length - 1]);
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
  }

  return -1;
}

function resolveContaDisplayName(conta?: Pick<ContaResumo, 'nome' | 'banco'> | null) {
  const accountName = String(conta?.nome || '').trim();
  if (accountName) return accountName;
  const bankName = String(conta?.banco || '').trim();
  return bankName || 'Sem banco';
}

function extractAsaasInterestedFromDescricao(descricao?: string | null) {
  const text = String(descricao || '').trim();
  if (!text) return null;

  const patterns = [
    /(?:cliente|customer|pagador)\s*:\s*([^\n|;,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || '').trim().replace(/[\s.]+$/, '');
    if (value) return value;
  }

  return null;
}

function extractAsaasIdFromObservacao(observacao?: string | null) {
  const text = String(observacao || '').trim();
  if (!text) return null;

  const patterns = [
    /asaas\s*id\s*:\s*([A-Za-z0-9_\-]+)/i,
    /\bid\s*:\s*([A-Za-z0-9_\-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || '').trim();
    if (value) return value;
  }

  return null;
}

function resolveLancamentoInteressado(
  item: Pick<LancamentoResumo, 'entidade_id' | 'descricao'>,
  entityMap: Map<number, string>
) {
  const defaultInterested = String(entityMap.get(Number(item.entidade_id)) || '').trim();
  const isGenericAsaas = normalizeText(defaultInterested).includes('asaas');

  if (!defaultInterested || isGenericAsaas) {
    const extracted = extractAsaasInterestedFromDescricao(item.descricao);
    if (extracted) return extracted;
  }

  return defaultInterested || 'Sem interessado';
}

function getValueTone(value: number, isDark: boolean) {
  if (value < 0) return isDark ? 'text-rose-300' : 'text-rose-600';
  if (value > 0) return isDark ? 'text-emerald-300' : 'text-emerald-600';
  return isDark ? 'text-white' : 'text-slate-900';
}

function getStatusLabel(status: StatusFilter) {
  const labels: Record<StatusFilter, string> = {
    TODOS: 'Todos',
    PAGO: 'Pago',
    EM_ABERTO: 'Em aberto',
    ATRASADO: 'Atrasado',
    HOJE: 'Vence hoje',
    AMANHA: 'Vence amanh├ú',
  };
  return labels[status];
}

function normalizeLancamentoTipo(tipo?: string | null) {
  return normalizeText(tipo).replace(/\s+/g, '');
}

function isReceita(tipo?: string | null) {
  const normalized = normalizeLancamentoTipo(tipo);
  if (!normalized) return false;
  return (
    normalized.startsWith('r')
    || normalized.startsWith('receita')
    || normalized.startsWith('recebimento')
    || normalized.startsWith('entrada')
    || normalized.startsWith('credito')
  );
}

function isDespesa(tipo?: string | null) {
  const normalized = normalizeLancamentoTipo(tipo);
  if (!normalized) return false;
  return (
    normalized.startsWith('d')
    || normalized.startsWith('despesa')
    || normalized.startsWith('pagamento')
    || normalized.startsWith('saida')
    || normalized.startsWith('debito')
  );
}

function parseCompetenciaMonthIndex(competencia?: string | null) {
  if (!competencia) return -1;
  const match = String(competencia).trim().match(/^(\d{2})-(\d{4})$/);
  if (!match) return -1;
  const month = Number(match[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month - 1 : -1;
}

function resolveMonthIndex(lancamento: LancamentoResumo, somentePagos = false) {
  if (!somentePagos) {
    const competenciaIndex = parseCompetenciaMonthIndex(lancamento.competencia);
    if (competenciaIndex >= 0) return competenciaIndex;
  }
  const baseDate = somentePagos
    ? (lancamento.data_pagamento || null)
    : (lancamento.data_competencia || lancamento.data_vencimento || null);
  const parsed = parseDateOnly(baseDate);
  return parsed ? parsed.getMonth() : -1;
}

function resolveLancamentoValue(lancamento: LancamentoResumo, somentePagos = false) {
  const valorPago = Number(lancamento.valor_pago || 0);
  if (somentePagos) return valorPago;
  if (lancamento.data_pagamento || valorPago !== 0) {
    return valorPago !== 0 ? valorPago : Number(lancamento.valor_previsto || 0);
  }
  return Number(lancamento.valor_previsto || 0);
}

function isPago(itemOrStatus?: Pick<LancamentoResumo, 'status' | 'data_pagamento' | 'valor_pago'> | string | null) {
  if (typeof itemOrStatus === 'string' || itemOrStatus == null) {
    const s = normalizeText(itemOrStatus);
    return s === 'pago' || s.startsWith('parcial');
  }

  const normalizedStatus = normalizeText(itemOrStatus.status);
  if (
    normalizedStatus === 'pago' ||
    normalizedStatus === 'quitado' ||
    normalizedStatus === 'liquidado' ||
    normalizedStatus.startsWith('parcial')
  ) {
    return true;
  }

  if (Boolean(itemOrStatus.data_pagamento)) {
    return true;
  }

  return Number(itemOrStatus.valor_pago || 0) > 0;
}

function getFullLogoUrl(url?: string | null) {
  return toPublicAssetUrl(url);
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const syncTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', syncTheme);
    return () => window.removeEventListener('theme-change', syncTheme);
  }, []);

  return isDark;
}

function ViewToggle({ current, onChange, isDark }: { current: ViewMode; onChange: (mode: ViewMode) => void; isDark: boolean }) {
  const options: Array<{ id: ViewMode; label: string; icon: typeof Sparkles }> = [
    { id: 'executivo', label: 'Executivo', icon: Sparkles },
    { id: 'pay-receive', label: 'Indicadores', icon: Rows3 },
    { id: 'compras', label: 'Compras', icon: ShoppingCart },
  ];

  return (
    <div className={`inline-flex rounded-full border p-1 ${isDark ? 'border-white/12 bg-white/5' : 'border-slate-200 bg-slate-100/90'}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = current === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${active ? isDark ? 'bg-white text-slate-950 shadow-lg' : 'bg-slate-950 text-white shadow-lg' : isDark ? 'text-white/65 hover:bg-white/8 hover:text-white' : 'text-slate-500 hover:bg-white hover:text-slate-900'}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}



function FilterPill({ active, label, onClick, isDark }: { active: boolean; label: string; onClick: () => void; isDark: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition ${active ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white' : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}
    >
      {label}
    </button>
  );
}

function getStatusKey(item: LancamentoResumo, todayIso: string, tomorrowIso: string): StatusFilter {
  if (isPago(item)) return 'PAGO';
  const due = item.data_vencimento?.slice(0, 10);
  if (due === todayIso) return 'HOJE';
  if (due === tomorrowIso) return 'AMANHA';
  if (due && due < todayIso) return 'ATRASADO';
  return 'EM_ABERTO';
}

function buildMonthLabel(monthIndex: number, year: number) {
  return `${MONTH_NAMES[monthIndex]}/${String(year).slice(2)}`;
}

function applyFilters(
  rows: NormalizedRow[],
  filters: {
    flowType: FlowFilter;
    status: StatusFilter;
    monthIndex: number | null;
    dayOfMonth: number | null;
    fallbackMonthIndex: number;
  },
  options?: {
    ignoreFlow?: boolean;
    ignoreStatus?: boolean;
    ignoreMonth?: boolean;
    ignoreDay?: boolean;
  },
) {
  const effectiveMonth = filters.monthIndex ?? filters.fallbackMonthIndex;
  return rows.filter((row) => {
    if (!options?.ignoreFlow && filters.flowType !== 'ALL' && row.flowType !== filters.flowType) return false;
    if (!options?.ignoreStatus && filters.status !== 'TODOS' && row.statusKey !== filters.status) return false;
    if (!options?.ignoreMonth && filters.monthIndex !== null && row.monthIndex !== filters.monthIndex) return false;
    if (!options?.ignoreDay && filters.dayOfMonth !== null) {
      if (row.monthIndex !== effectiveMonth) return false;
      if (row.dayOfMonth !== filters.dayOfMonth) return false;
    }
    return true;
  });
}

const EMPTY_ARRAY: any[] = [];

export function Compras() {
  const navigate = useNavigate();

  const [referenceDate, setReferenceDate] = useState(() => getBusinessTodayIso());
  const referenceYear = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackDate = parseDateOnly(getBusinessTodayIso()) || new Date();
    return (parsedReference || fallbackDate).getFullYear();
  }, [referenceDate]);

  const [isLancamentoDrawerOpen, setIsLancamentoDrawerOpen] = useState(false);
  const [editingLancamentoId, setEditingLancamentoId] = useState<number | null>(null);
  const refreshCount = useTransactionStore((state) => state.refreshCount);
  const currentEmpresaId = useAuthStore((state) => state.empresa?.id || state.user?.empresa_id);

  // --- WEBSOCKETS ---
  useKyrusWsListener('LANCAMENTO_CREATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_UPDATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_DELETED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_CREATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_UPDATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_DELETED', () => useTransactionStore.getState().invalidateAndRefresh());

  const buildLancamentosDestino = (lancamentoId: number, includeEmbed: boolean) => {
    const params = new URLSearchParams();
    params.set('editar_id', String(lancamentoId));
    params.set('origem', 'boletim');

    if (includeEmbed) {
      params.set('embed_boletim', '1');
    }

    return `/lancamentos?${params.toString()}`;
  };

  const openLancamentoEdicao = (lancamentoId: number, event?: ReactMouseEvent<HTMLElement>) => {
    if (lancamentoId <= 0) return;
    const destino = buildLancamentosDestino(lancamentoId, false);
    if (event?.metaKey || event?.ctrlKey) {
      navigate(destino);
      return;
    }
    setEditingLancamentoId(lancamentoId);
    setIsLancamentoDrawerOpen(true);
  };
  const [loading, setLoading] = useState(() => {
    const initialYear = (parseDateOnly(getBusinessTodayIso()) || new Date()).getFullYear();
    const txCache = useTransactionStore.getState().yearCache[initialYear];
    const hasCachedTransactions = !!txCache && txCache.length > 0;
    const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
    console.log('[Boletim Mount Cache Check]', {
      initialYear,
      hasCachedTransactions,
      hasCachedLookups,
      txCacheSize: txCache?.length,
      contasLoaded: useLookupStore.getState().contasLoaded,
      planoLoaded: useLookupStore.getState().planoLoaded
    });
    return !hasCachedTransactions || !hasCachedLookups;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const empresa = useAuthStore((state) => state.empresa);
  const setEmpresa = useAuthStore((state) => state.setEmpresa);

  const isDark = useIsDarkMode();
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosAvancados, setFiltrosAvancados] = useState<ComprasFiltrosAvancados>({
    fornecedores: new Set<string>(),
    status: new Set<string>(),
    tipos: new Set<string>(),
    centroCustoIds: new Set<number>(),
    dataInicio: '',
    dataFim: ''
  });
  const [comprasLimit, setComprasLimit] = useState(100);
  const [capLimit, setCapLimit] = useState(100);
  const [pedidosData, setPedidosData] = useState<any[]>([]);
  const [pedidosLoading, setPedidosLoading] = useState(false);
  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);

  const lancamentos = useTransactionStore((state) => state.yearCache[referenceYear] || EMPTY_ARRAY);
  const asaasRows = useTransactionStore((state) => state.asaasCache[referenceYear] || EMPTY_ARRAY);
  const asaasLoading = useTransactionStore((state) => state.loadingAsaas[referenceYear] || false);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const fetchYearTransactions = useTransactionStore((state) => state.fetchYearTransactions);
  const fetchAsaasRows = useTransactionStore((state) => state.fetchAsaasRows);
  const viewMode = 'compras';
  const [compraTipoFilter, setCompraTipoFilter] = useState<CompraTipoFilter>('ALL');
  const [selectedCompraMonthIndex, setSelectedCompraMonthIndex] = useState<number | null>(null);
  const [compraChartMode, setCompraChartMode] = useState<CompraChartMode>('COLUNA_EMPILHADA');
  const globalSelectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const setSelectedCentroCustoIdGlobally = useLookupStore((state) => state.setSelectedCentroCustoId);
  const selectedCentroCustoId = useMemo(() => {
    return globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId;
  }, [globalSelectedCentroCustoId]);
  const setSelectedCentroCustoId = useCallback((id: number | null | ((prev: number | null) => number | null)) => {
    const computedVal = typeof id === 'function' ? id(globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId) : id;
    setSelectedCentroCustoIdGlobally(computedVal === null ? 'ALL' : computedVal);
  }, [globalSelectedCentroCustoId, setSelectedCentroCustoIdGlobally]);
  const initialLoadDoneRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    async function syncReferenceDateWithServer() {
      try {
        const response = await api.get<HealthResponse>('/health', { baseURL: getPublicBaseUrl() });
        if (!active) return;
        const serverDate = extractIsoDate(response.data?.server_date || response.data?.server_datetime);
        if (!serverDate) return;

        setReferenceDate((current) => {
          const fallbackToday = getBusinessTodayIso();
          const currentDate = extractIsoDate(current);
          if (!currentDate || currentDate === fallbackToday) {
            return serverDate;
          }
          return current;
        });
      } catch {
        // Mantem fallback local quando nao for possivel consultar a data do servidor.
      }
    }

    void syncReferenceDateWithServer();

    return () => {
      active = false;
    };
  }, []);







  useEffect(() => {
    let active = true;

    async function loadData(force = false) {
      const hasCachedTransactions = !!useTransactionStore.getState().yearCache[referenceYear];
      const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
      const shouldShowLoader = !hasCachedTransactions || !hasCachedLookups;

      if (force) {
        setIsRefreshing(true);
      } else if (shouldShowLoader) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        await Promise.all([
          fetchContas(force),
          fetchPlanoContas(force),
          fetchEntidadesLookup(force),
          fetchCentrosCusto(force),
          fetchYearTransactions(referenceYear, force),
        ]);

        if (active) {
          setSelectedCentroCustoId((currentValue: number | null) =>
            resolveCentroCustoId(currentValue, useLookupStore.getState().centrosCusto)
          );
        }

        void fetchAsaasRows(referenceYear, force).catch((err) => {
          if (!axios.isCancel(err)) {
            console.error('Erro ao carregar cobranças Asaas:', err);
          }
        });
      } catch (err: any) {
        if (axios.isCancel(err)) return;
        console.error('Erro ao carregar dados do boletim:', err);
        if (active) {
          setLoadError('Parte dos dados do boletim nao pôde ser carregada.');
        }
      } finally {
        if (active) {
          setLoading(false);
          setIsRefreshing(false);
          initialLoadDoneRef.current = true;
        }
      }
    }

    void loadData(false);

    return () => {
      active = false;
    };
  }, [referenceYear, refreshCount]);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number; target?: "indicadores" | "pedidos" | "cap" } | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenuPos(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, target?: "pedidos" | "cap") => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY, target });
  };

  const handleExportPedidos = async () => {
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Pedidos');

      worksheet.mergeCells('A1:E1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de Pedidos - ${comprasView.effectiveMonthLabel}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      const headers = ['Data Emissão', 'Emitente', 'Centro de Custo', 'Status', 'Valor Pedido (R$)'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      let totalValor = 0;

      pedidosData.forEach((row) => {
        const cc = Array.isArray(row.itens) && row.itens[0]?.centro_custo_nome ? row.itens[0].centro_custo_nome : '-';
        const v = Number(row.valor_total || row.valor_nf || 0);
        totalValor += v;
        const excelRow = worksheet.addRow([
          formatDate(row.data_emissao),
          row.emitente_nome || '-',
          cc,
          row.status || '-',
          v
        ]);
        excelRow.getCell(5).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      });

      worksheet.addRow([]);
      const totalRow = worksheet.addRow(['', '', '', 'Total de Pedidos:', totalValor]);
      totalRow.getCell(4).font = { bold: true };
      totalRow.getCell(5).font = { bold: true };
      totalRow.getCell(5).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

      worksheet.columns = [
        { width: 15 }, { width: 35 }, { width: 30 }, { width: 15 }, { width: 20 }
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Pedidos_${comprasView.effectiveMonthLabel}.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro na exportação de Pedidos', error);
      alert('Ocorreu um erro ao exportar os pedidos.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportCap = async () => {
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('CAP a Pagar');

      worksheet.mergeCells('A1:D1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de CAP - ${comprasView.effectiveMonthLabel}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      const headers = ['Vencimento', 'Emitente', 'Status', 'Valor (R$)'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      let totalValor = 0;
      const capRows = comprasView.capRows || [];

      capRows.forEach((row) => {
        const emitente = resolveLancamentoInteressado(row, new Map(entidades.map(e => [e.id, e.nome_fantasia || e.nome])));
        let tipoCompra = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
        const v = tipoCompra === 'DEMONSTRACAO' ? 0 : -Math.abs(Number(row.valor_pago || row.valor_previsto || 0));
        totalValor += v;
        const excelRow = worksheet.addRow([
          formatDate(row.data_vencimento),
          emitente || '-',
          tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : (row.status || '-'),
          v
        ]);
        excelRow.getCell(4).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      });

      worksheet.addRow([]);
      const totalRow = worksheet.addRow(['', '', 'Total CAP a Pagar:', totalValor]);
      totalRow.getCell(3).font = { bold: true };
      totalRow.getCell(4).font = { bold: true };
      totalRow.getCell(4).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

      worksheet.columns = [
        { width: 15 }, { width: 35 }, { width: 20 }, { width: 20 }
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `CAP_${comprasView.effectiveMonthLabel}.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro na exportação de CAP', error);
      alert('Ocorreu um erro ao exportar o CAP.');
    } finally {
      setIsExportingExcel(false);
    }
  };




  const dashboardMonthLabels = useMemo(() => [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ], []);

  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackToday = parseDateOnly(getBusinessTodayIso()) || new Date();
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : fallbackToday;
    
    return {
      now,
      currentYear: now.getFullYear(),
      fallbackMonthIndex: now.getMonth(),
      monthLabels: dashboardMonthLabels,
    };
  }, [referenceDate, dashboardMonthLabels]);

  const comprasView = useMemo(() => {
    const fallbackMonth = dashboard.fallbackMonthIndex;
    const effectiveMonth = selectedCompraMonthIndex ?? fallbackMonth;
    const monthLabels = dashboard.monthLabels;

    const entityMap = new Map(entidades.map((e) => [e.id, e.nome_fantasia || e.nome]));
    const nfeRows = lancamentos
      .filter((item) => selectedCentroCustoId === null || Number(item.centro_custo_id) === selectedCentroCustoId)
      .filter((item) => String(item.origem || '').trim().toUpperCase() === 'NFE_XML')
      .filter((item) => {
        if (filtrosAvancados.centroCustoIds.size > 0 && (!item.centro_custo_id || !filtrosAvancados.centroCustoIds.has(Number(item.centro_custo_id)))) return false;
        
        const tipoCompraItem = extractDestinoCompraFromObservacao(item.observacao) || 'DEMONSTRACAO';
        if (filtrosAvancados.tipos.size > 0 && !filtrosAvancados.tipos.has(tipoCompraItem)) return false;

        const mappedStatus = String(item.status || '').toUpperCase() === 'CANCELADO' ? 'CANCELADO' : (item.status === 'PAGO' ? 'ENTREGUE' : 'AGUARDANDO_ENTREGA');
        if (filtrosAvancados.status.size > 0 && !filtrosAvancados.status.has(mappedStatus)) return false;

        if (filtrosAvancados.fornecedores.size > 0) {
          const int = resolveLancamentoInteressado(item, entityMap);
          if (!filtrosAvancados.fornecedores.has(int)) return false;
        }
        
        if (filtrosAvancados.dataInicio && item.data_vencimento < filtrosAvancados.dataInicio) return false;
        if (filtrosAvancados.dataFim && item.data_vencimento > filtrosAvancados.dataFim) return false;
        return true;
      })
      .map((item) => ({
        item,
        numeroNfe: resolveNfeNumeroFromLancamento(item),
      }));

    const parcelasPorNfe = new Map<string, number>();
    nfeRows.forEach(({ item, numeroNfe }) => {
      const key = String(item.id_parcelamento || numeroNfe || '').trim();
      if (!key) return;
      parcelasPorNfe.set(key, (parcelasPorNfe.get(key) || 0) + 1);
    });

    const purchaseRows = nfeRows
      .map((item) => {
        const tipoCompra = extractDestinoCompraFromObservacao(item.item.observacao) || 'DEMONSTRACAO';
        const monthIndex = parseDateOnly(item.item.data_competencia || item.item.data_vencimento)?.getMonth() ?? -1;
        const capMonthIndex = parseDateOnly(item.item.data_vencimento)?.getMonth() ?? -1;
        const valor = Number(item.item.valor_previsto || item.item.valor_pago || 0);
        const nfeGroupKey = String(item.item.id_parcelamento || item.numeroNfe || '').trim();
        const parcelas = Math.max(1, Number(parcelasPorNfe.get(nfeGroupKey) || 0));
        return {
          monthIndex,
          capMonthIndex,
          tipoCompra,
          valor,
          numeroNfe: item.numeroNfe,
          parcelas,
          emitente: resolveLancamentoInteressado(item.item, new Map(entidades.map((e) => [e.id, e.nome_fantasia || e.nome]))),
          vencimento: item.item.data_vencimento,
          status: String(item.item.status || ''),
        };
      })
      .filter((row) => row.monthIndex >= 0 && row.tipoCompra !== null && (row.valor > 0 || row.tipoCompra === 'DEMONSTRACAO'));

    const rowsByTipo = purchaseRows.filter((row) => compraTipoFilter === 'ALL' || row.tipoCompra === compraTipoFilter);
    const mutedColor = isDark ? '#cbd5e1' : '#d1d5db';

    const monthlyPedidos = {
      ENCOMENDA: Array.from({ length: 12 }, () => 0),
      ESTOQUE: Array.from({ length: 12 }, () => 0),
      DEMONSTRACAO: Array.from({ length: 12 }, () => 0),
    };

    rowsByTipo.forEach((row) => {
      if (!row.tipoCompra) return;
      const key = row.tipoCompra as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
      monthlyPedidos[key][row.monthIndex] += row.valor;
    });

    const monthlyCap = {
      ENCOMENDA: Array.from({ length: 12 }, () => 0),
      ESTOQUE: Array.from({ length: 12 }, () => 0),
      DEMONSTRACAO: Array.from({ length: 12 }, () => 0),
    };
    rowsByTipo.forEach((row) => {
      const idx = Number(row.capMonthIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx > 11) return;
      if (!row.tipoCompra) return;
      const key = row.tipoCompra as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
      monthlyCap[key][idx] += row.valor;
    });

    const totalsByTipo = {
      ENCOMENDA: monthlyPedidos.ENCOMENDA.reduce((a, b) => a + b, 0),
      ESTOQUE: monthlyPedidos.ESTOQUE.reduce((a, b) => a + b, 0),
      DEMONSTRACAO: monthlyPedidos.DEMONSTRACAO.reduce((a, b) => a + b, 0),
    };

    const countsByTipo = {
      ENCOMENDA: purchaseRows.filter((r) => r.tipoCompra === 'ENCOMENDA').length,
      ESTOQUE: purchaseRows.filter((r) => r.tipoCompra === 'ESTOQUE').length,
      DEMONSTRACAO: purchaseRows.filter((r) => r.tipoCompra === 'DEMONSTRACAO').length,
    };

    const donutSeries = [totalsByTipo.ENCOMENDA, totalsByTipo.ESTOQUE, totalsByTipo.DEMONSTRACAO];

    const pedidosSeries = [
      {
        name: 'Encomenda',
        data: monthlyPedidos.ENCOMENDA.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#3b82f6',
        })),
      },
      {
        name: 'Estoque',
        data: monthlyPedidos.ESTOQUE.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#14b8a6',
        })),
      },
      {
        name: 'Demonstração',
        data: monthlyPedidos.DEMONSTRACAO.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#a855f7',
        })),
      },
    ];

    const capTotal = monthlyCap.ENCOMENDA.map((value, monthIndex) => value + (monthlyCap.ESTOQUE[monthIndex] || 0));

    const isCapMixedStacked = compraChartMode === 'COLUNA_EMPILHADA';
    const capSeries = [
      {
        name: 'CAP Encomenda',
        ...(isCapMixedStacked ? { type: 'column' } : {}),
        data: monthlyCap.ENCOMENDA.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#3b82f6',
        })),
      },
      {
        name: 'CAP Estoque',
        ...(isCapMixedStacked ? { type: 'column' } : {}),
        data: monthlyCap.ESTOQUE.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#14b8a6',
        })),
      },
      {
        name: 'Total a pagar',
        ...(isCapMixedStacked ? { type: 'line' } : {}),
        data: capTotal.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#f2c94c',
        })),
      },
    ];

    const tableRows = rowsByTipo
      .filter((row) => selectedCompraMonthIndex === null || row.monthIndex === selectedCompraMonthIndex)
      .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)) || b.valor - a.valor)
      .slice(0, 80);

    const chartTheme = isDark ? 'dark' : 'light';
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.16)';

    const onMonthSelect = (_event: any, _ctx: any, config: any) => {
      const monthIndex = readChartDataPointIndex(config);
      if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return;
      setSelectedCompraMonthIndex((prev) => (prev === monthIndex ? null : monthIndex));
    };

    const isLineMode = compraChartMode === 'LINHA_SEPARADA';
    const isStackedColumnMode = compraChartMode === 'COLUNA_EMPILHADA';

    const mainChartType: 'line' | 'bar' = isLineMode ? 'line' : 'bar';

    const sharedChartOptions: any = {
      chart: {
        type: mainChartType,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: { dataPointSelection: onMonthSelect },
        ...(isLineMode
          ? {}
          : {
            stacked: isStackedColumnMode,
            ...(isStackedColumnMode ? { stackType: 'normal' } : {}),
          }),
      },
      theme: { mode: chartTheme },
      stroke: isLineMode ? { show: true, width: 3, curve: 'smooth' } : { show: false },
      markers: isLineMode ? { size: 4, hover: { size: 6 } } : { size: 0 },
      ...(isLineMode ? {} : { plotOptions: { bar: { horizontal: false, borderRadius: 2, columnWidth: '56%' } } }),
      dataLabels: { enabled: false },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      xaxis: { categories: monthLabels, labels: { style: { colors: labelColor, fontSize: '10px' } } },
      yaxis: { labels: { style: { colors: labelColor, fontSize: '10px' }, formatter: (value: number) => formatCurrencyCompact(value) } },
      tooltip: { theme: chartTheme, y: { formatter: (value: number) => formatCurrency(value) } },
      legend: { position: 'top', horizontalAlign: 'left', labels: { colors: labelColor }, itemMargin: { horizontal: 8, vertical: 4 } },
      ...(isLineMode ? { fill: { type: 'solid' } } : {}),
    };

    const donutOptions: any = {
      chart: {
        type: 'donut',
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const idx = Number(config?.dataPointIndex);
            if (!Number.isFinite(idx) || idx < 0) return;
            const nextFilter: CompraTipoFilter = idx === 0 ? 'ENCOMENDA' : idx === 1 ? 'ESTOQUE' : 'DEMONSTRACAO';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
          legendClick: (_ctx: any, seriesIndex: number) => {
            const nextFilter: CompraTipoFilter = Number(seriesIndex) === 0 ? 'ENCOMENDA' : Number(seriesIndex) === 1 ? 'ESTOQUE' : 'DEMONSTRACAO';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
        },
      },
      labels: ['Encomenda', 'Estoque', 'Demonstração'],
      colors: [
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ENCOMENDA' ? (isDark ? '#315ea1' : '#9dbcf1') : '#3b82f6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ESTOQUE' ? (isDark ? '#0f766e' : '#98e0d8') : '#14b8a6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'DEMONSTRACAO' ? (isDark ? '#5b21b6' : '#c084fc') : '#a855f7',
      ],
      dataLabels: { enabled: true, formatter: (value: number) => `${value.toFixed(0)}%` },
      legend: { show: true, position: 'bottom', labels: { colors: labelColor }, itemMargin: { horizontal: 8, vertical: 4 }, onItemClick: { toggleDataSeries: false } },
      plotOptions: { pie: { donut: { size: '62%', labels: { show: false } } } },
      stroke: { width: 2, colors: [isDark ? '#081124' : '#ffffff'] },
      tooltip: { theme: chartTheme, y: { formatter: (value: number) => formatCurrency(value) } },
    };

    const capRows = nfeRows
      .filter(item => {
         const capMonthIndex = parseDateOnly(item.item.data_vencimento)?.getMonth() ?? -1;
         return capMonthIndex === effectiveMonth;
      })
      .map(i => i.item)
      .sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''));

    const pedidosRows = nfeRows
      .filter(item => {
         const monthIndex = parseDateOnly(item.item.data_competencia || item.item.data_vencimento)?.getMonth() ?? -1;
         return monthIndex === effectiveMonth;
      })
      .map(i => i.item)
      .sort((a, b) => (a.data_competencia || '').localeCompare(b.data_competencia || ''));

    return {
      capRows,
      pedidosRows,
      effectiveMonth,
      effectiveMonthLabel: monthLabels[effectiveMonth],
      totalsByTipo,
      donutSeries,
      donutOptions,
      mainChartType,
      pedidosSeries,
      pedidosOptions: { ...sharedChartOptions },
      capSeries,
      capChartType: isCapMixedStacked ? 'line' : mainChartType,
      capOptions: {
        ...sharedChartOptions,
        ...(isCapMixedStacked
          ? {
            chart: {
              ...sharedChartOptions.chart,
              type: 'line',
              stacked: true,
              stackType: 'normal',
            },
            stroke: { width: [0, 0, 0, 3], curve: 'smooth' },
            markers: { size: [0, 0, 0, 4], hover: { size: 6 } },
          }
          : {}),
        legend: { ...sharedChartOptions.legend, show: true },
      },
      tableRows,
      countsByTipo,
    };
  }, [compraChartMode, compraTipoFilter, dashboard.currentYear, dashboard.fallbackMonthIndex, dashboard.monthLabels, entidades, isDark, lancamentos, selectedCentroCustoId, selectedCompraMonthIndex, filtrosAvancados]);

  // Consistência removida para não poluir console



  useEffect(() => {
    setComprasLimit(100);
  }, [comprasView.tableRows]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  if (loading && !initialLoadDoneRef.current) {
    return (
      <div className={`p-8 space-y-6 ${isDark ? 'bg-[#0d1117] text-white' : 'bg-slate-50'}`}>
        {/* Skeleton Header */}
        <div className="flex items-center gap-4 animate-pulse">
          <div className="w-16 h-16 rounded-lg bg-slate-300 dark:bg-slate-700" />
          <div className="space-y-2">
            <div className="w-48 h-6 rounded bg-slate-300 dark:bg-slate-700" />
            <div className="w-32 h-4 rounded bg-slate-300 dark:bg-slate-700" />
          </div>
        </div>
        {/* Skeleton Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-xl bg-slate-300 dark:bg-slate-700 p-4 space-y-3">
              <div className="w-20 h-4 rounded bg-slate-200 dark:bg-slate-600" />
              <div className="w-32 h-8 rounded bg-slate-200 dark:bg-slate-600" />
            </div>
          ))}
        </div>
        {/* Skeleton Main Chart */}
        <div className="h-96 rounded-xl bg-slate-300 dark:bg-slate-700 animate-pulse flex items-center justify-center">
          <div className="text-slate-400 dark:text-slate-500 font-bold">Carregando dados financeiros...</div>
        </div>
      </div>
    );
  }

  const pageClass = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_28%),linear-gradient(180deg,#030712_0%,#0b1220_100%)] text-white'
    : 'bg-white text-slate-900';
  const shellClass = isDark ? 'border-white/12 bg-slate-900/50' : 'border-slate-200 bg-white/94';
  const tableShellClass = isDark ? 'border-white/12 bg-slate-900/50' : 'border-slate-200 bg-white/94';
  const auditPanelShellClass = isDark ? 'border-white/12 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className={`min-h-full ${pageClass}`}>
      <div className="mx-auto w-full space-y-3">
        <header className={`relative z-20 rounded-none border px-4 py-4 ${shellClass}`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border ${isDark ? 'border-white/10 bg-white/95' : 'border-slate-200 bg-slate-100'}`}>
                {companyLogo ? <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" /> : <Building2 className="h-8 w-8 text-slate-400" />}
              </div>
              <div>
                <div className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{companyName}</div>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto xl:justify-end">

              <div className="w-full md:w-72">
                <SearchableSelect
                  value={selectedCentroCustoId === null ? 'TODOS' : String(selectedCentroCustoId)}
                  onChange={(val) => {
                    if (val === 'TODOS') {
                      setSelectedCentroCustoId(null);
                    } else {
                      setSelectedCentroCustoId(Number(val));
                    }
                  }}
                  options={[{
                    label: 'Centro de Custo',
                    options: [
                      { id: 'TODOS', label: 'Todos os centros de custo' },
                      ...centrosCusto.map((centro) => ({
                        id: centro.id,
                        label: `${centro.codigo ? `${centro.codigo} - ` : ''}${centro.nome}`
                      }))
                    ]
                  }]}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowFiltrosSidebar(true)}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${isDark ? 'border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'} transition shadow-sm`}
                title="Filtros avançados"
              >
                <Filter className="h-5 w-5" />
              </button>
            </div>
          </div>

        </header>

        {loadError ? (
          <div className={`rounded-lg border px-5 py-4 text-sm font-semibold ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {loadError}
          </div>
        ) : null}



        
          <section className="space-y-3">
            <div className="grid gap-3 xl:grid-cols-4 xl:items-stretch">
              <section className={`rounded-2xl border px-3 py-3 xl:col-span-1 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Tipo de compra</div>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter('ALL')}
                    className={`text-[10px] font-black uppercase tracking-[0.14em] ${compraTipoFilter === 'ALL' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    Limpar
                  </button>
                </div>
                <AsyncApexChart type="donut" height={220} series={comprasView.donutSeries} options={comprasView.donutOptions} />
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'ENCOMENDA' ? 'ALL' : 'ENCOMENDA'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'ENCOMENDA' ? isDark ? 'border-blue-300/55 bg-blue-300/12' : 'border-blue-300 bg-blue-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total encomenda</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-blue-300' : 'text-blue-600'}`}>{formatCurrency(comprasView.totalsByTipo.ENCOMENDA)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'ESTOQUE' ? 'ALL' : 'ESTOQUE'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'ESTOQUE' ? isDark ? 'border-teal-300/55 bg-teal-300/12' : 'border-teal-300 bg-teal-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total estoque</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-teal-300' : 'text-teal-600'}`}>{formatCurrency(comprasView.totalsByTipo.ESTOQUE)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'DEMONSTRACAO' ? 'ALL' : 'DEMONSTRACAO'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'DEMONSTRACAO' ? isDark ? 'border-purple-300/55 bg-purple-300/12' : 'border-purple-300 bg-purple-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total demonstração</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                      {formatCurrency(comprasView.totalsByTipo.DEMONSTRACAO)}
                      <span className="text-xs font-normal ml-1.5 opacity-70">({comprasView.countsByTipo.DEMONSTRACAO} nota(s))</span>
                    </div>
                  </button>
                </div>
              </section>

              <section className={`rounded-2xl border px-3 py-3 xl:col-span-3 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>QTDE vs VALOR DE PEDIDOS POR MÊS</div>
                  <button
                    type="button"
                    onClick={() => setSelectedCompraMonthIndex(null)}
                    className={`text-[10px] font-black uppercase tracking-[0.14em] ${selectedCompraMonthIndex === null ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    Limpar mês
                  </button>
                </div>
                <AsyncApexChart type={comprasView.mainChartType} height={380} series={comprasView.pedidosSeries} options={comprasView.pedidosOptions} />
              </section>
              <section className={`rounded-2xl border px-3 py-3 xl:col-span-4 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>CAP por mês do faturamento dos pedidos</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{comprasView.effectiveMonthLabel}</div>
                </div>
                <AsyncApexChart type={comprasView.capChartType || comprasView.mainChartType} height={255} series={comprasView.capSeries} options={comprasView.capOptions} />
              </section>
            </div>

            <div className={`rounded-2xl border px-3 py-2 ${tableShellClass}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Modo do gráfico</span>
                <button
                  type="button"
                  onClick={() => setCompraChartMode('LINHA_SEPARADA')}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${compraChartMode === 'LINHA_SEPARADA' ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Linha separada
                </button>
                <button
                  type="button"
                  onClick={() => setCompraChartMode('COLUNA_EMPILHADA')}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${compraChartMode === 'COLUNA_EMPILHADA' ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Coluna empilhada
                </button>
              </div>
            </div>

                          <div className="flex flex-col gap-4">
              <section className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Pedidos feitos no período</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/45' : 'text-slate-400'}`}>{comprasView.pedidosRows.length} item(ns)</div>
                </div>
                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div 
                    onContextMenu={(e) => handleContextMenu(e, "pedidos")}
                    className="min-h-[30vh] max-h-[52vh] overflow-auto custom-scrollbar"
                    onScroll={(e) => {
                      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                      if (scrollHeight - scrollTop <= clientHeight + 200) {
                        setComprasLimit(prev => Math.min(prev + 100, comprasView.pedidosRows.length));
                      }
                    }}
                  >
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                        <tr>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data emissão</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Emitente</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Tipo</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor pedido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comprasView.pedidosRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-sm font-semibold">Nenhum pedido para os filtros atuais.</td>
                          </tr>
                        ) : (
                          <>
                            {comprasView.pedidosRows.slice(0, comprasLimit).map((row, index) => {
                              const emitente = resolveLancamentoInteressado(row, new Map(entidades.map(e => [e.id, e.nome_fantasia || e.nome])));
                              const valor = Math.abs(Number(row.valor_pago || row.valor_previsto || 0));
                              const tipoCompra = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
                              
                              return (
                              <tr key={`pedido-row-${row.id || index}`} onClick={() => { setEditingLancamentoId(row.id); setIsLancamentoDrawerOpen(true); }} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">
                                <td className="px-4 py-2.5 font-medium">{formatDate(row.data_competencia || row.data_vencimento)}</td>
                                <td className="px-4 py-2.5 font-semibold">{emitente || '-'}</td>
                                <td className="px-4 py-2.5">
                                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                    {tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : tipoCompra}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                    {tipoCompra === 'DEMONSTRACAO' ? '-' : (row.status === 'PAGO' ? 'ENTREGUE' : 'AGUARDANDO ENTREGA')}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-black whitespace-nowrap">{formatCurrency(tipoCompra === 'DEMONSTRACAO' ? 0 : valor)}</td>
                              </tr>
                              );
                            })}
                            {comprasView.pedidosRows.length > comprasLimit && (
                              <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                <td colSpan={5} className="px-4 py-4 text-center text-xs font-semibold">
                                  Exibindo {comprasLimit} de {comprasView.pedidosRows.length} pedidos. <br/>
                                  Role a tabela para carregar mais...
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                      <tfoot className={isDark ? 'sticky bottom-0 z-10 bg-slate-800 text-slate-300 border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]' : 'sticky bottom-0 z-10 bg-slate-100 text-slate-800 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]'}>
                        <tr>
                          <td colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Total de Pedidos</td>
                          <td className="px-4 py-3 text-right text-sm font-black">
                            {formatCurrency(comprasView.pedidosRows.reduce((acc, row) => acc + (extractDestinoCompraFromObservacao(row.observacao) === 'DEMONSTRACAO' ? 0 : Math.abs(Number(row.valor_pago || row.valor_previsto || 0))), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </section>

              <section className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>CAP a pagar no período</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/45' : 'text-slate-400'}`}>{comprasView.capRows?.length || 0} item(ns)</div>
                </div>
                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div 
                    onContextMenu={(e) => handleContextMenu(e, "cap")}
                    className="min-h-[30vh] max-h-[52vh] overflow-auto custom-scrollbar"
                    onScroll={(e) => {
                      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                      if (scrollHeight - scrollTop <= clientHeight + 200) {
                        setCapLimit(prev => Math.min(prev + 100, comprasView.capRows?.length || 0));
                      }
                    }}
                  >
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                        <tr>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Emitente</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!comprasView.capRows || comprasView.capRows.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-4 py-12 text-center text-sm font-semibold">Nenhum CAP para os filtros atuais.</td>
                          </tr>
                        ) : (
                          <>
                            {comprasView.capRows.slice(0, capLimit).map((row, index) => {
                              const emitente = resolveLancamentoInteressado(row, new Map(entidades.map(e => [e.id, e.nome_fantasia || e.nome])));
                              let tipoCompra = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
                              return (
                                <tr key={`cap-row-${row.id || index}`} onClick={() => { setEditingLancamentoId(row.id); setIsLancamentoDrawerOpen(true); }} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">
                                  <td className="px-4 py-2.5 font-medium">{formatDate(row.data_vencimento)}</td>
                                  <td className="px-4 py-2.5 font-semibold">{emitente || '-'}</td>
                                  <td className="px-4 py-2.5">
                                    <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                      {tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : (row.status || '-')}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-black whitespace-nowrap">
                                    {formatCurrency(tipoCompra === 'DEMONSTRACAO' ? 0 : -Math.abs(Number(row.valor_pago || row.valor_previsto || 0)))}
                                  </td>
                                </tr>
                              );
                            })}
                            {comprasView.capRows.length > capLimit && (
                              <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                <td colSpan={4} className="px-4 py-4 text-center text-xs font-semibold">
                                  Exibindo {capLimit} de {comprasView.capRows.length} CAPs. <br/>
                                  Role a tabela para carregar mais...
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                      <tfoot className={isDark ? 'sticky bottom-0 z-10 bg-slate-800 text-slate-300 border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]' : 'sticky bottom-0 z-10 bg-slate-100 text-slate-800 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]'}>
                        <tr>
                          <td colSpan={3} className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Total CAP a Pagar</td>
                          <td className="px-4 py-3 text-right text-sm font-black">
                            {formatCurrency((comprasView.capRows || []).reduce((acc, row) => {
                              const tc = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
                              return acc + (tc === 'DEMONSTRACAO' ? 0 : -Math.abs(Number(row.valor_pago || row.valor_previsto || 0)));
                            }, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </section>
              </div>
          </section>
          {contextMenuPos && (
          <div
            className="fixed z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 min-w-[240px]"
            style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setContextMenuPos(null);
                if (contextMenuPos.target === 'pedidos') {
                    void handleExportPedidos();
                } else if (contextMenuPos.target === 'cap') {
                    void handleExportCap();
                }
              }}
              disabled={isExportingExcel}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors text-left"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{isExportingExcel ? 'Gerando Planilha...' : (contextMenuPos.target === 'pedidos' ? 'Exportar Pedidos em Excel (.xlsx)' : 'Exportar CAP em Excel (.xlsx)')}</span>
            </button>
          </div>
        )}
        {(() => {
          const entityMapForSidebar = new Map(entidades.map((e) => [e.id, e.nome_fantasia || e.nome]));
          const setFornecedores = new Set<string>();
          lancamentos.forEach(item => {
            if (String(item.origem || '').trim().toUpperCase() === 'NFE_XML') {
              const int = resolveLancamentoInteressado(item, entityMapForSidebar);
              if (int) setFornecedores.add(int);
            }
          });
          const fornecedoresList = Array.from(setFornecedores).sort();

          return (
            <ComprasFiltrosSidebar
              showFiltrosSidebar={showFiltrosSidebar}
              setShowFiltrosSidebar={setShowFiltrosSidebar}
              filtrosAvancados={filtrosAvancados}
              setFiltrosAvancados={setFiltrosAvancados}
              resetFiltros={() => {
                setFiltrosAvancados({
                  fornecedores: new Set<string>(),
                  status: new Set<string>(),
                  tipos: new Set<string>(),
                  centroCustoIds: new Set<number>(),
                  dataInicio: '',
                  dataFim: ''
                });
              }}
              fornecedoresList={fornecedoresList}
              centrosCusto={centrosCusto.map((c) => ({ id: c.id, nome: `${c.codigo ? `${c.codigo} - ` : ''}${c.nome}` }))}
            />
          );
        })()}
      </div>
    </div>
  );
}


