import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react';
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
import { BoletimFiltrosSidebar } from '../components/BoletimFiltrosSidebar';
import type { BoletimFiltrosAvancados } from '../components/BoletimFiltrosSidebar';
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
type CompraTipoFilter = 'ALL' | 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | 'A_CLASSIFICAR';
type CompraChartMode = 'LINHA_SEPARADA' | 'COLUNA_EMPILHADA' | 'COLUNA_SEPARADA';

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

export function Boletim() {
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

    if (auditPanel?.mode === 'LANCAMENTOS' && (auditPanel.rows || []).length > 0) {
      const idsUnicos = Array.from(new Set((auditPanel.rows || []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)));
      if (idsUnicos.length > 0) {
        params.set('boletim_ids', idsUnicos.join(','));
      }
    }

    if (activeAuditMetricKey) {
      params.set('boletim_metric', activeAuditMetricKey);
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

  const { isDark } = useLookupStore();
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosAvancados, setFiltrosAvancados] = useState<BoletimFiltrosAvancados>({
    categoriaIds: new Set<number>(),
    contaIds: new Set<number>(),
    interessados: new Set<string>(),
    dataInicio: '',
    dataFim: ''
  });
  const [indicadoresLimit, setIndicadoresLimit] = useState(100);
  const [comprasLimit, setComprasLimit] = useState(100);
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
  const [viewMode, setViewMode] = useState<ViewMode>('executivo');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
  const [compraTipoFilter, setCompraTipoFilter] = useState<CompraTipoFilter>('ALL');
  const [selectedCompraMonthIndex, setSelectedCompraMonthIndex] = useState<number | null>(null);
  const [compraChartMode, setCompraChartMode] = useState<CompraChartMode>('LINHA_SEPARADA');
  const globalSelectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const setSelectedCentroCustoIdGlobally = useLookupStore((state) => state.setSelectedCentroCustoId);
  const selectedCentroCustoId = useMemo(() => {
    return globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId;
  }, [globalSelectedCentroCustoId]);
  const setSelectedCentroCustoId = useCallback((id: number | null | ((prev: number | null) => number | null)) => {
    const computedVal = typeof id === 'function' ? id(globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId) : id;
    setSelectedCentroCustoIdGlobally(computedVal === null ? 'ALL' : computedVal);
  }, [globalSelectedCentroCustoId, setSelectedCentroCustoIdGlobally]);
  const [auditPanel, setAuditPanel] = useState<AuditPanelState | null>(null);
  const [activeAuditMetricKey, setActiveAuditMetricKey] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPanelWidth, setAuditPanelWidth] = useState(() => Math.round(window.innerWidth * 0.75));
  const auditResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
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
    const initial = Math.round(window.innerWidth * 0.75);
    setAuditPanelWidth(Math.max(320, Math.min(Math.round(window.innerWidth * 0.9), initial)));
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = auditResizeRef.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      const maxWidth = Math.round(window.innerWidth * 0.9);
      const nextWidth = Math.max(320, Math.min(maxWidth, state.startWidth + delta));
      setAuditPanelWidth(nextWidth);
    };

    const onMouseUp = () => {
      if (!auditResizeRef.current) return;
      auditResizeRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startAuditResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    auditResizeRef.current = { startX: event.clientX, startWidth: auditPanelWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

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

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenuPos(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleExportExcel = async (customRows?: NormalizedRow[], prefix?: string) => {
    setIsExportingExcel(true);
    try {
      const rowsToExport = customRows || dashboard.tableRows;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Indicadores');

      // Title Row
      worksheet.mergeCells('A1:H1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de Indicadores - ${dashboard.effectiveMonthLabel}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      // Header Row
      const headers = ['Data Vencimento', 'Interessado / Entidade', 'Descrição', 'Valor (R$)', 'Operação', 'Categoria', 'Banco / Conta', 'Status'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const catMap = new Map(categorias.map((c) => [c.id, c.nome]));
      const contaMap = new Map(contas.map((c) => [c.id, c.nome]));

      // Data Rows
      rowsToExport.forEach((row) => {
        const catNome = row.contaId ? catMap.get(Number(row.contaId)) || '-' : '-';
        const contaNome = row.contaNome || (row.contaId ? contaMap.get(Number(row.contaId)) || '-' : '-');

        const addedRow = worksheet.addRow([
          formatDate(row.dataVencimento),
          row.interessado || '-',
          row.descricao || '-',
          Number(row.valorAbsoluto || 0),
          row.flowType === 'RECEBIMENTO' ? 'Receita' : 'Despesa',
          catNome,
          contaNome,
          row.statusLabel || '-',
        ]);

        addedRow.height = 20;

        const valCell = addedRow.getCell(4);
        valCell.numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
        valCell.alignment = { horizontal: 'right', vertical: 'middle' };

        addedRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Auto width
      worksheet.columns.forEach((column) => {
        let maxLen = 14;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const len = cell.value ? String(cell.value).length : 10;
          if (len > maxLen) maxLen = len;
        });
        column.width = Math.min(maxLen + 4, 45);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = `${prefix || 'Indicadores_Boletim'}_${dashboard.effectiveMonthLabel.replace('/', '_')}.xlsx`;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar planilha de Indicadores:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };




  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackToday = parseDateOnly(getBusinessTodayIso()) || new Date();
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : fallbackToday;
    const currentYear = now.getFullYear();
    const fallbackMonthIndex = now.getMonth();
    const todayIso = toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const effectiveMonthIndex = selectedMonthIndex ?? fallbackMonthIndex;
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const contaMap = new Map(contas.map((item) => [item.id, item]));
    const contasFiltradasPorCentro = contas.filter((conta) => selectedCentroCustoId === null || Number(conta.centro_custo_id) === selectedCentroCustoId);
    const bankBalances = contasFiltradasPorCentro
      .filter((conta) => String(conta.status || 'ATIVO').toUpperCase() !== 'INATIVO')
      .map((conta) => ({ ...conta, saldo: Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0) }))
      .sort((left, right) => right.saldo - left.saldo);
    const saldoDisponivel = bankBalances
      .filter((conta) => conta.conta_como_disponibilidade !== false)
      .reduce((acc, conta) => acc + conta.saldo, 0);
    const relevantes = categorias.filter((conta) => isReceita(conta.tipo) || isDespesa(conta.tipo));
    const contaPorId = new Map<number, PlanoContaResumo>();
    relevantes.forEach((conta) => contaPorId.set(conta.id, conta));

    const resolvedDreGroupsCache: Record<number, string> = {};

    const classificarHeuristicaLegada = (contaId: number): 'DEDUCOES_RECEITA' | 'CUSTOS_VARIAVEIS' | 'DESPESAS_OPERACIONAIS' => {
      const partes: string[] = [];
      const visitados = new Set<number>();
      let atual = contaPorId.get(contaId);

      while (atual && !visitados.has(Number(atual.id))) {
        visitados.add(Number(atual.id));
        partes.push(normalizeText(atual.nome));
        const parentId = atual.conta_pai_id ? Number(atual.conta_pai_id) : 0;
        atual = parentId > 0 ? contaPorId.get(parentId) : undefined;
      }

      const trilha = partes.join(' ');
      if (/(abatimento|deducao|deducoes|devolucao|devolucoes|imposto sobre faturamento|impostos de faturamento)/.test(trilha)) {
        return 'DEDUCOES_RECEITA';
      }
      if (/(custos|custo|cmv|cpv|custo dos produtos|custo dos servicos|fornecedores|materia prima|mercadoria vendida)/.test(trilha)) {
        return 'CUSTOS_VARIAVEIS';
      }
      return 'DESPESAS_OPERACIONAIS';
    };

    const resolverDreGrupo = (contaId: number): string => {
      if (contaId in resolvedDreGroupsCache) {
        return resolvedDreGroupsCache[contaId];
      }
      const conta = contaPorId.get(contaId);
      const grupoNormalizado = String(conta?.dre_grupo || '').trim().toUpperCase();
      let res = grupoNormalizado;
      if (!res) {
        if (conta && isReceita(conta.tipo)) {
          res = 'RECEITA_BRUTA';
        } else {
          res = classificarHeuristicaLegada(contaId);
        }
      }
      resolvedDreGroupsCache[contaId] = res;
      return res;
    };

    const EXCLUDED_BOLETIM_DRE_GROUPS = new Set([
      'FORA_DRE',
      'FORA DRE',
      'FORA DA DRE',
      'NAO_OPERACIONAL',
      'NÃO_OPERACIONAL',
      'NAO OPERACIONAL',
      'NÃO OPERACIONAL',
      'NAO OPERACIONAL / FORA DA DRE',
      'NAO OP.',
      'NAO_DRE',
      'NÃO_DRE',
    ]);

    const isForaDre = (contaId: number): boolean => {
      if (!contaId || contaId <= 0) return false;
      const conta = contaPorId.get(contaId);
      if (conta) {
        if (conta.eh_operacional === false) return true;
        if ((conta as any).considerar_nos_resultados === false) return true;
        const grupoNormalizado = String(conta.dre_grupo || '').trim().toUpperCase();
        if (EXCLUDED_BOLETIM_DRE_GROUPS.has(grupoNormalizado)) return true;
      }
      const dreGrupo = resolverDreGrupo(contaId);
      if (EXCLUDED_BOLETIM_DRE_GROUPS.has(dreGrupo)) return true;
      return false;
    };

    const dbAsaasIds = new Set<string>();

    const baseRows = [
      ...lancamentos
        .filter((item) => selectedCentroCustoId === null || Number(item.centro_custo_id) === selectedCentroCustoId)
        .filter((item) => {
          const isPaid = getStatusKey(item, todayIso, tomorrowIso) === 'PAGO' || Boolean(item.data_pagamento) || Number(item.valor_pago || 0) > 0;
          const bankId = Number(item.conta_id || (item as any).conta_bancaria_id || 0);
          if (isPaid && bankId <= 0) return false;
          const contaId = Number(item.plano_contas_id);
          if (contaId > 0 && isForaDre(contaId)) return false;
          return true;
        })
        .map((item) => {
          const due = parseDateOnly(item.data_vencimento);
          const flowType: FlowFilter = isReceita(item.tipo) ? 'RECEBIMENTO' : 'PAGAMENTO';
          const statusKey = getStatusKey(item, todayIso, tomorrowIso);
          const hasPaidValue = item.valor_pago !== null && item.valor_pago !== undefined && Number(item.valor_pago) > 0;
          const baseValue = Number(statusKey === 'PAGO' && hasPaidValue ? item.valor_pago : item.valor_previsto ?? item.valor_pago ?? 0);
          const signedValue = flowType === 'RECEBIMENTO' ? baseValue : baseValue * -1;
          const rawId = Number(item.id);
          const safeId = Number.isFinite(rawId) ? rawId : -1;

          const asaasId = extractAsaasIdFromObservacao(item.observacao);
          if (asaasId) {
            dbAsaasIds.add(asaasId);
          }

          let bandeira: string | null = null;
          let tipoPagamento: string | null = null;
          if (item.observacao && item.observacao.trim().startsWith('{') && item.observacao.trim().endsWith('}')) {
            try {
              const meta = JSON.parse(item.observacao);
              tipoPagamento = meta.tipo_pagamento || meta.forma_pagamento || null;
              bandeira = meta.bandeira || null;
            } catch { /* não é JSON */ }
          }

          return {
            rowKey: `${buildLancamentoFingerprint(item)}|cc:${Number(item.centro_custo_id || 0)}|conta:${Number(item.conta_id || 0)}`,
            id: safeId,
            descricao: item.descricao,
            flowType,
            statusKey,
            statusLabel: getStatusLabel(statusKey),
            dataVencimento: item.data_vencimento,
            monthIndex: due ? due.getMonth() : -1,
            dayOfMonth: due ? due.getDate() : -1,
            valor: signedValue,
            valorAbsoluto: Math.abs(signedValue),
            interessado: resolveLancamentoInteressado(item, entityMap),
            contaId: item.conta_id,
            contaNome: resolveContaDisplayName(contaMap.get(Number(item.conta_id))),
            centroCustoId: item.centro_custo_id,
            origem: item.origem,
            bandeira,
            tipoPagamento,
          } satisfies NormalizedRow;
        })
        .filter((item) => item.monthIndex >= 0 && item.dayOfMonth >= 0),
      ...asaasRows
        .filter((item) => {
          const parsed = parseDateOnly(item.dataVencimento);
          return parsed !== null && parsed.getFullYear() === currentYear;
        })
        .filter((item) => selectedCentroCustoId === null || Number(item.centroCustoId) === selectedCentroCustoId)
        .filter((item) => {
          const asaasId = item.rowKey.replace('asaas-charge-', '');
          return !dbAsaasIds.has(asaasId);
        })
        .map((item) => {
          let statusKey = 'EM_ABERTO' as StatusFilter;
          let statusLabel = 'A vencer';

          if (item.isAtrasada || (item.dataVencimento && item.dataVencimento < todayIso)) {
            statusKey = 'ATRASADO';
            statusLabel = 'Atrasado';
          } else if (item.dataVencimento === todayIso) {
            statusKey = 'HOJE';
            statusLabel = 'Hoje';
          } else if (item.dataVencimento === tomorrowIso) {
            statusKey = 'AMANHA';
            statusLabel = 'Amanhã';
          }

          return {
            ...item,
            statusKey,
            statusLabel,
          };
        })
    ];

    const activeRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    });

    const payableRows = baseRows.filter((item) => item.flowType === 'PAGAMENTO');
    const receivableRows = baseRows.filter((item) => item.flowType === 'RECEBIMENTO');
    const sumValues = (rows: NormalizedRow[]) => rows.reduce((acc, item) => acc + item.valorAbsoluto, 0);

    const buildExecutiveMetrics = (rows: NormalizedRow[]) => ({
      hoje: sumValues(rows.filter((item) => item.statusKey === 'HOJE' && item.monthIndex === effectiveMonthIndex)),
      amanha: sumValues(rows.filter((item) => item.statusKey === 'AMANHA')),
      atrasadas: sumValues(rows.filter((item) => item.statusKey === 'ATRASADO')),
      emAberto: sumValues(rows.filter((item) => item.statusKey === 'EM_ABERTO' && item.monthIndex === effectiveMonthIndex)),
    });

    const pagar = buildExecutiveMetrics(payableRows);
    const receber = buildExecutiveMetrics(receivableRows);
    const pagarNoMes = sumValues(payableRows.filter((item) => item.monthIndex === effectiveMonthIndex));
    const receberNoMes = sumValues(receivableRows.filter((item) => item.monthIndex === effectiveMonthIndex));
    const pagarPagasNoMes = sumValues(payableRows.filter((item) => item.monthIndex === effectiveMonthIndex && item.statusKey === 'PAGO'));
    const receberRecebidasNoMes = sumValues(receivableRows.filter((item) => item.monthIndex === effectiveMonthIndex && item.statusKey === 'PAGO'));



    const receitaMonthly = Array.from({ length: 12 }, () => 0);
    const deducoesMonthly = Array.from({ length: 12 }, () => 0);
    const custosVariaveisMonthly = Array.from({ length: 12 }, () => 0);
    const despesaOperacionalCoreMonthly = Array.from({ length: 12 }, () => 0);
    const outrasReceitasMonthly = Array.from({ length: 12 }, () => 0);
    const outrasDespesasMonthly = Array.from({ length: 12 }, () => 0);

    lancamentos
      .filter((item) => selectedCentroCustoId === null || Number(item.centro_custo_id) === selectedCentroCustoId)
      .forEach((lancamento) => {
        const contaId = Number(lancamento.plano_contas_id);
        if (!contaPorId.has(contaId)) return;
        const monthIndex = resolveMonthIndex(lancamento, true);
        if (monthIndex < 0) return;
        const conta = contaPorId.get(contaId);
        if (!conta) return;
        const dreGrupo = resolverDreGrupo(contaId);
        if (isForaDre(contaId)) return;
        const value = resolveLancamentoValue(lancamento, true);

        if (isReceita(conta.tipo)) {
          if (dreGrupo === 'OUTRAS_RECEITAS') outrasReceitasMonthly[monthIndex] += value;
          else receitaMonthly[monthIndex] += value;
        }

        if (isDespesa(conta.tipo)) {
          if (dreGrupo === 'DEDUCOES_RECEITA') deducoesMonthly[monthIndex] += value;
          else if (dreGrupo === 'CUSTOS_VARIAVEIS') custosVariaveisMonthly[monthIndex] += value;
          else if (dreGrupo === 'OUTRAS_DESPESAS') outrasDespesasMonthly[monthIndex] += value;
          else despesaOperacionalCoreMonthly[monthIndex] += value;
        }
      });

    const receitaLiquidaMonthly = receitaMonthly.map((value, index) => value - deducoesMonthly[index]);
    const margemContribuicaoMonthly = receitaLiquidaMonthly.map((value, index) => value - custosVariaveisMonthly[index]);
    const resultadoOperacionalMonthly = margemContribuicaoMonthly.map((value, index) => value - despesaOperacionalCoreMonthly[index]);
    const resultadoFinalMonthly = resultadoOperacionalMonthly.map((value, index) => value + outrasReceitasMonthly[index] - outrasDespesasMonthly[index]);
    const resultadoOperacionalMes = resultadoOperacionalMonthly[effectiveMonthIndex] || 0;
    const resultadoFinalMes = resultadoFinalMonthly[effectiveMonthIndex] || 0;

    const situacaoRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    }, { ignoreStatus: true });

    const situacao = {
      PAGO: sumValues(situacaoRows.filter((item) => item.statusKey === 'PAGO')),
      EM_ABERTO: sumValues(situacaoRows.filter((item) => item.statusKey === 'EM_ABERTO')),
      ATRASADO: sumValues(situacaoRows.filter((item) => item.statusKey === 'ATRASADO')),
      AMANHA: sumValues(situacaoRows.filter((item) => item.statusKey === 'AMANHA')),
      HOJE: sumValues(situacaoRows.filter((item) => item.statusKey === 'HOJE')),
    };

    const tableRows = [...activeRows]
      .filter((row) => {
        if (!searchTerm) return true;
        const term = normalizeText(searchTerm);
        return (
          normalizeText(row.descricao).includes(term) ||
          normalizeText(row.interessado).includes(term) ||
          String(row.valorAbsoluto).includes(term)
        );
      })
      .sort((left, right) => {
        if (left.dataVencimento !== right.dataVencimento) return String(left.dataVencimento).localeCompare(String(right.dataVencimento));
        return right.valorAbsoluto - left.valorAbsoluto;
      });

    return {
      now,
      currentYear,
      fallbackMonthIndex,
      effectiveMonthIndex,
      effectiveMonthLabel: buildMonthLabel(effectiveMonthIndex, currentYear),
      monthLabels: MONTH_NAMES.map((label) => `${label}/${String(currentYear).slice(2)}`),
      banks: bankBalances,
      baseRows,
      saldoBancario: bankBalances.reduce((acc, conta) => acc + conta.saldo, 0),
      saldoDisponivel,
      pagar,
      receber,
      pagarNoMes,
      pagarPagasNoMes,
      receberNoMes,
      receberRecebidasNoMes,
      resultadoOperacionalMes,
      resultadoFinalMes,
      resultadoOperacionalMonthly,
      resultadoFinalMonthly,
      tableRows,
      situacao,
      todayIso,
      tomorrowIso,
    };
  }, [categorias, contas, entidades, lancamentos, selectedCentroCustoId, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter, referenceDate, asaasRows, searchTerm]);

  const groupedRows = useMemo(() => {
    if (auditPanel?.mode !== 'LANCAMENTOS' || !auditPanel.rows) return { groups: {}, sortedDates: [] };
    const groups: { [date: string]: any[] } = {};
    auditPanel.rows.forEach((row) => {
      const dateStr = row.dataVencimento || 'Sem data';
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(row);
    });

    // Summarize card transactions inside each date group
    Object.keys(groups).forEach((dateStr) => {
      const rows = groups[dateStr];
      const nonCardRows: any[] = [];
      const cardGroups: Record<
        string,
        { label: string; value: number; isDebito: boolean; ids: number[]; rows: NormalizedRow[] }
      > = {};

      rows.forEach((row) => {
        const tp = row.tipoPagamento || '';
        if (row.flowType === 'RECEBIMENTO' && tp.startsWith('cartao_')) {
          const brand = (row.bandeira || 'OUTROS').toUpperCase();
          const isDebito = tp === 'cartao_debito';
          const mod = isDebito ? 'DÉBITO' : 'CRÉDITO';
          const key = `${brand} ${mod}`;
          if (!cardGroups[key]) {
            cardGroups[key] = { label: `${brand} ${mod}`, value: 0, isDebito, ids: [], rows: [] };
          }
          cardGroups[key].value += row.valorAbsoluto;
          if (row.id > 0) {
            cardGroups[key].ids.push(row.id);
          }
          cardGroups[key].rows.push(row);
        } else {
          nonCardRows.push(row);
        }
      });

      const summarizedCardRows = Object.entries(cardGroups).map(([key, g]) => {
        const firstRow = g.rows[0];
        const count = g.rows.length;
        const countLabel = count === 1 ? '1 transação' : `${count} transações`;
        return {
          rowKey: `card-summary-${dateStr}-${key}`,
          id: 0,
          isCardSummary: true,
          boletimIds: g.ids,
          descricao: `${g.label} (${countLabel})`,
          flowType: 'RECEBIMENTO' as FlowFilter,
          statusKey: firstRow.statusKey,
          statusLabel: firstRow.statusLabel,
          dataVencimento: dateStr,
          valor: g.value,
          valorAbsoluto: g.value,
          interessado: 'Operadoras de Cartão',
          bandeira: firstRow.bandeira,
          tipoPagamento: firstRow.tipoPagamento,
        };
      });

      groups[dateStr] = [...nonCardRows, ...summarizedCardRows];
    });

    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    return { groups, sortedDates };
  }, [auditPanel?.mode, auditPanel?.rows]);

  const groupedMovimentos = useMemo(() => {
    if (auditPanel?.mode !== 'EXTRATO_BANCO' || !auditPanel.extrato?.movimentos) return { groups: {}, sortedDates: [] };
    const groups: { [date: string]: ContaSaldoMovimento[] } = {};
    auditPanel.extrato.movimentos.forEach((m) => {
      const dateStr = m.data_pagamento || m.data_vencimento || 'Sem data';
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(m);
    });
    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    return { groups, sortedDates };
  }, [auditPanel?.mode, auditPanel?.extrato?.movimentos]);

  function openAuditRows(title: string, subtitle: string, rows: NormalizedRow[]) {
    setAuditPanel({ mode: 'LANCAMENTOS', title, subtitle, rows });
  }

  function handleKpiAuditClick(metricKey: string) {
    const monthLabel = dashboard.effectiveMonthLabel;
    if (metricKey === 'pagar_hoje') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a pagar hoje', `Lançamentos com vencimento hoje (${dashboard.now.toLocaleDateString('pt-BR')}).`, dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.statusKey === 'HOJE'));
      return;
    }
    if (metricKey === 'pagar_amanha') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a pagar amanhã', 'Lançamentos com vencimento amanhã.', dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.statusKey === 'AMANHA'));
      return;
    }
    if (metricKey === 'pagar_atrasadas') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a pagar atrasadas', 'Lançamentos vencidos e ainda não pagos.', dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.statusKey === 'ATRASADO'));
      return;
    }
    if (metricKey === 'pagar_em_aberto') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a pagar em aberto no mês', `Lançamentos do mês ${monthLabel} ainda em aberto.`, dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.statusKey === 'EM_ABERTO' && item.monthIndex === dashboard.effectiveMonthIndex));
      return;
    }
    if (metricKey === 'receber_hoje') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a receber hoje', `Lançamentos com vencimento hoje (${dashboard.now.toLocaleDateString('pt-BR')}).`, dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.statusKey === 'HOJE'));
      return;
    }
    if (metricKey === 'receber_amanha') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a receber amanhã', 'Lançamentos com vencimento amanhã.', dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.statusKey === 'AMANHA'));
      return;
    }
    if (metricKey === 'receber_atrasadas') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a receber atrasadas', 'Lançamentos vencidos e ainda não recebidos.', dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.statusKey === 'ATRASADO'));
      return;
    }
    if (metricKey === 'receber_em_aberto') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a receber em aberto no mês', `Lançamentos do mês ${monthLabel} ainda em aberto.`, dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.statusKey === 'EM_ABERTO' && item.monthIndex === dashboard.effectiveMonthIndex));
      return;
    }
    if (metricKey === 'pagar_mes') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a pagar no mês', `Competência em ${monthLabel}. Inclui pagos e em aberto.`, dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.monthIndex === dashboard.effectiveMonthIndex));
      return;
    }
    if (metricKey === 'pagar_pagas_mes') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Pagas no mês', `Lançamentos de pagamento quitados na competência ${monthLabel}.`, dashboard.baseRows.filter((item) => item.flowType === 'PAGAMENTO' && item.monthIndex === dashboard.effectiveMonthIndex && item.statusKey === 'PAGO'));
      return;
    }
    if (metricKey === 'receber_mes') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Contas a receber no mês', `Competência em ${monthLabel}. Inclui pagos e em aberto.`, dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.monthIndex === dashboard.effectiveMonthIndex));
      return;
    }
    if (metricKey === 'receber_recebidas_mes') {
      setActiveAuditMetricKey(metricKey);
      openAuditRows('Recebidas no mês', `Lançamentos de recebimento quitados na competência ${monthLabel}.`, dashboard.baseRows.filter((item) => item.flowType === 'RECEBIMENTO' && item.monthIndex === dashboard.effectiveMonthIndex && item.statusKey === 'PAGO'));
      return;
    }
    if (metricKey === 'resultado_operacional') {
      setActiveAuditMetricKey(metricKey);
      const params = new URLSearchParams();
      params.set('focus_kpi', 'resultado_operacional');
      params.set('mes', String(dashboard.effectiveMonthIndex));
      navigate(`/dre?${params.toString()}`);
      return;
    }
    if (metricKey === 'resultado_final') {
      setActiveAuditMetricKey(metricKey);
      const params = new URLSearchParams();
      params.set('focus_kpi', 'resultado_final');
      params.set('mes', String(dashboard.effectiveMonthIndex));
      navigate(`/dre?${params.toString()}`);
    }
  }

  async function handleBankAuditClick(conta: ContaResumo) {
    setActiveAuditMetricKey(null);
    setAuditLoading(true);
    setAuditPanel({
      mode: 'EXTRATO_BANCO',
      title: `Extrato do banco ${resolveContaDisplayName(conta)}`,
      subtitle: 'Mostrando lançamentos que influenciam o saldo atual da conta.',
      conta,
    });
    try {
      const { data } = await api.get<ContaSaldoDetalhe>(`/contas/${conta.id}/saldo-detalhe`);
      setAuditPanel((current) => current ? { ...current, extrato: data } : current);
    } catch (error) {
      console.error('Erro ao carregar extrato do banco no boletim', error);
      setAuditPanel((current) => current ? { ...current, subtitle: 'Não foi possível carregar o extrato desta conta agora.' } : current);
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    const daysInSelectedMonth = new Date(dashboard.currentYear, dashboard.effectiveMonthIndex + 1, 0).getDate();
    if (selectedDayOfMonth && selectedDayOfMonth > daysInSelectedMonth) {
      setSelectedDayOfMonth(null);
    }
  }, [dashboard.currentYear, dashboard.effectiveMonthIndex, selectedDayOfMonth]);

  const activeFilterTags = useMemo(() => {
    const tags: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (flowFilter !== 'ALL') {
      tags.push({ key: 'flow', label: flowFilter === 'PAGAMENTO' ? 'Tipo: Pagamento' : 'Tipo: Recebimento', onClear: () => setFlowFilter('ALL') });
    }
    if (selectedMonthIndex !== null) {
      tags.push({ key: 'month', label: `Mês: ${dashboard.monthLabels[selectedMonthIndex]}`, onClear: () => { setSelectedMonthIndex(null); setSelectedDayOfMonth(null); } });
    }
    if (selectedDayOfMonth !== null) {
      tags.push({ key: 'day', label: `Dia: ${String(selectedDayOfMonth).padStart(2, '0')}/${String(dashboard.effectiveMonthIndex + 1).padStart(2, '0')}`, onClear: () => setSelectedDayOfMonth(null) });
    }
    if (statusFilter !== 'TODOS') {
      const labels: Record<StatusFilter, string> = {
        TODOS: 'Todos',
        PAGO: 'Pago',
        EM_ABERTO: 'Em aberto',
        ATRASADO: 'Atrasado',
        HOJE: 'Vence hoje',
        AMANHA: 'Vence amanhã',
      };
      tags.push({ key: 'status', label: `Situação: ${labels[statusFilter]}`, onClear: () => setStatusFilter('TODOS') });
    }
    return tags;
  }, [dashboard.effectiveMonthIndex, dashboard.monthLabels, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

  const situacaoCards: Array<{ label: string; key: StatusFilter; value: number }> = [
    { label: 'Pago', key: 'PAGO', value: dashboard.situacao.PAGO },
    { label: 'Em Aberto', key: 'EM_ABERTO', value: dashboard.situacao.EM_ABERTO },
    { label: 'Atrasado', key: 'ATRASADO', value: dashboard.situacao.ATRASADO },
    { label: 'Vcto Amanhã', key: 'AMANHA', value: dashboard.situacao.AMANHA },
    { label: 'Vcto Hoje', key: 'HOJE', value: dashboard.situacao.HOJE },
  ];

  const payReceiveCharts = useMemo(() => {
    const pagamentoColor = '#ff4d4f';
    const recebimentoColor = '#4d8cf3';
    const destaqueColor = '#f2c94c';
    const mutedColor = isDark ? '#cbd5e1' : '#d1d5db';
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.16)';
    const cardStrokeColor = isDark ? '#081124' : '#ffffff';
    const chartTheme = isDark ? 'dark' : 'light';
    const effectiveMonth = selectedMonthIndex ?? dashboard.fallbackMonthIndex;

    const resolveFlowColor = (flow: FlowFilter) => flow === 'PAGAMENTO' ? pagamentoColor : recebimentoColor;
    const shouldDimFlow = (flow: FlowFilter) => flowFilter !== 'ALL' && flowFilter !== flow;

    const rowsForFlow = applyFilters(dashboard.baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex: dashboard.fallbackMonthIndex,
    }, {
      ignoreFlow: true,
    });

    const flowTotals = rowsForFlow.reduce((acc, row) => {
      if (row.flowType === 'PAGAMENTO') acc.pagamento += row.valorAbsoluto;
      if (row.flowType === 'RECEBIMENTO') acc.recebimento += row.valorAbsoluto;
      return acc;
    }, { pagamento: 0, recebimento: 0 });

    const rowsForTimeline = applyFilters(dashboard.baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex: dashboard.fallbackMonthIndex,
    }, {
      ignoreFlow: true,
      ignoreMonth: true,
      ignoreDay: true,
    });

    const monthlyPagamento = Array.from({ length: 12 }, () => 0);
    const monthlyRecebimento = Array.from({ length: 12 }, () => 0);

    rowsForTimeline.forEach((row) => {
      if (row.monthIndex < 0 || row.monthIndex > 11) return;
      if (row.flowType === 'PAGAMENTO') monthlyPagamento[row.monthIndex] += row.valorAbsoluto;
      if (row.flowType === 'RECEBIMENTO') monthlyRecebimento[row.monthIndex] += row.valorAbsoluto;
    });

    const daysInMonth = new Date(dashboard.currentYear, effectiveMonth + 1, 0).getDate();
    const dailyPagamento = Array.from({ length: daysInMonth }, () => 0);
    const dailyRecebimento = Array.from({ length: daysInMonth }, () => 0);

    rowsForTimeline
      .filter((row) => row.monthIndex === effectiveMonth)
      .forEach((row) => {
        const dayIndex = Number(row.dayOfMonth || 0) - 1;
        if (dayIndex < 0 || dayIndex >= daysInMonth) return;
        if (row.flowType === 'PAGAMENTO') dailyPagamento[dayIndex] += row.valorAbsoluto;
        if (row.flowType === 'RECEBIMENTO') dailyRecebimento[dayIndex] += row.valorAbsoluto;
      });

    const donutSeries = [flowTotals.pagamento, flowTotals.recebimento];
    const donutColors = [
      shouldDimFlow('PAGAMENTO') ? mutedColor : pagamentoColor,
      shouldDimFlow('RECEBIMENTO') ? mutedColor : recebimentoColor,
    ];

    const monthlySeries = flowFilter === 'ALL'
      ? [
        {
          name: 'Pagamento',
          data: monthlyPagamento.map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: resolveFlowColor('PAGAMENTO'),
          })),
        },
        {
          name: 'Recebimento',
          data: monthlyRecebimento.map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ]
      : [
        {
          name: flowFilter === 'PAGAMENTO' ? 'Pagamento' : 'Recebimento',
          data: (flowFilter === 'PAGAMENTO' ? monthlyPagamento : monthlyRecebimento).map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: flowFilter === 'PAGAMENTO' ? resolveFlowColor('PAGAMENTO') : resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ];

    const dailySeries = flowFilter === 'ALL'
      ? [
        {
          name: 'Pagamento',
          data: dailyPagamento.map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: resolveFlowColor('PAGAMENTO'),
          })),
        },
        {
          name: 'Recebimento',
          data: dailyRecebimento.map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ]
      : [
        {
          name: flowFilter === 'PAGAMENTO' ? 'Pagamento' : 'Recebimento',
          data: (flowFilter === 'PAGAMENTO' ? dailyPagamento : dailyRecebimento).map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: flowFilter === 'PAGAMENTO' ? resolveFlowColor('PAGAMENTO') : resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ];

    const resolveFlowBySeriesIndex = (seriesIndex: number): FlowFilter | null => {
      if (flowFilter === 'ALL') {
        if (seriesIndex === 0) return 'PAGAMENTO';
        if (seriesIndex === 1) return 'RECEBIMENTO';
      } else {
        return flowFilter;
      }
      return null;
    };

    const donutOptions: any = {
      chart: {
        type: 'donut',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const idx = Number(config?.dataPointIndex);
            if (idx < 0) return;
            const nextFlow: FlowFilter = idx === 0 ? 'PAGAMENTO' : 'RECEBIMENTO';
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
        },
      },
      noData: { text: 'Sem dados' },
      labels: ['Pagamento', 'Recebimento'],
      colors: donutColors,
      stroke: { width: 2, colors: [cardStrokeColor] },
      states: {
        hover: { filter: { type: 'none', value: 0 } },
        active: { filter: { type: 'none', value: 0 } },
      },
      theme: { mode: chartTheme },
      dataLabels: {
        enabled: true,
        formatter: (value: number) => `${value.toFixed(0)}%`,
      },
      legend: {
        show: true,
        position: 'bottom',
        fontSize: '11px',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: false,
            },
          },
        },
      },
      tooltip: {
        theme: chartTheme,
        y: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
    };

    const monthlyOptions: any = {
      chart: {
        type: 'bar',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const monthIndex = readChartDataPointIndex(config);
            const nextFlow = resolveFlowBySeriesIndex(Number(config?.seriesIndex));
            if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return;

            setSelectedDayOfMonth(null);

            if (nextFlow) {
              const sameSelection = selectedMonthIndex === monthIndex && flowFilter === nextFlow;
              if (sameSelection) {
                setSelectedMonthIndex(null);
                setFlowFilter('ALL');
                return;
              }
              setSelectedMonthIndex(monthIndex);
              setFlowFilter(nextFlow);
              return;
            }

            setSelectedMonthIndex((prev) => (prev === monthIndex ? null : monthIndex));
          },
        },
      },
      noData: { text: 'Sem dados' },
      theme: { mode: chartTheme },
      colors: [pagamentoColor, recebimentoColor, destaqueColor],
      plotOptions: {
        bar: {
          horizontal: false,
          borderRadius: 2,
          columnWidth: '58%',
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      states: {
        hover: { filter: { type: 'lighten', value: 0.08 } },
        active: { filter: { type: 'lighten', value: 0.18 } },
      },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      xaxis: {
        categories: dashboard.monthLabels,
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
          formatter: (value: number) => formatCurrencyCompact(value),
        },
      },
      tooltip: {
        theme: chartTheme,
        y: { formatter: (value: number) => formatCurrency(value) },
      },
    };

    const dailyOptions: any = {
      chart: {
        type: 'bar',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const dayIndex = readChartDataPointIndex(config);
            const nextFlow = resolveFlowBySeriesIndex(Number(config?.seriesIndex));
            if (!Number.isFinite(dayIndex) || dayIndex < 0) return;

            const day = dayIndex + 1;

            if (nextFlow) {
              const sameSelection = selectedMonthIndex === effectiveMonth && selectedDayOfMonth === day && flowFilter === nextFlow;
              if (sameSelection) {
                setSelectedDayOfMonth(null);
                setFlowFilter('ALL');
                return;
              }
              setSelectedMonthIndex(effectiveMonth);
              setSelectedDayOfMonth(day);
              setFlowFilter(nextFlow);
              return;
            }

            setSelectedMonthIndex(effectiveMonth);
            setSelectedDayOfMonth((prev) => (prev === day ? null : day));
          },
        },
      },
      noData: { text: 'Sem dados' },
      theme: { mode: chartTheme },
      colors: [pagamentoColor, recebimentoColor],
      plotOptions: {
        bar: {
          horizontal: false,
          borderRadius: 2,
          columnWidth: '66%',
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      states: {
        hover: { filter: { type: 'lighten', value: 0.08 } },
        active: { filter: { type: 'lighten', value: 0.18 } },
      },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      xaxis: {
        categories: Array.from({ length: daysInMonth }, (_, index) => String(index + 1)),
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
          formatter: (value: number) => formatCurrencyCompact(value),
        },
      },
      tooltip: {
        theme: chartTheme,
        y: { formatter: (value: number) => formatCurrency(value) },
      },
    };

    return {
      donutSeries,
      donutOptions,
      monthlySeries,
      monthlyOptions,
      dailySeries,
      dailyOptions,
      effectiveMonthLabel: dashboard.monthLabels[effectiveMonth],
    };
  }, [dashboard.baseRows, dashboard.currentYear, dashboard.fallbackMonthIndex, dashboard.monthLabels, flowFilter, isDark, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

  const comprasView = useMemo(() => {
    const fallbackMonth = dashboard.fallbackMonthIndex;
    const effectiveMonth = selectedCompraMonthIndex ?? fallbackMonth;
    const monthLabels = dashboard.monthLabels;

    const nfeRows = lancamentos
      .filter((item) => selectedCentroCustoId === null || Number(item.centro_custo_id) === selectedCentroCustoId)
      .filter((item) => String(item.origem || '').trim().toUpperCase() === 'NFE_XML')
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
        const tipoCompra = extractDestinoCompraFromObservacao(item.item.observacao) || 'A_CLASSIFICAR';
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
      A_CLASSIFICAR: Array.from({ length: 12 }, () => 0),
    };

    rowsByTipo.forEach((row) => {
      if (!row.tipoCompra) return;
      const key = row.tipoCompra as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | 'A_CLASSIFICAR';
      monthlyPedidos[key][row.monthIndex] += row.valor;
    });

    const monthlyCap = {
      ENCOMENDA: Array.from({ length: 12 }, () => 0),
      ESTOQUE: Array.from({ length: 12 }, () => 0),
      DEMONSTRACAO: Array.from({ length: 12 }, () => 0),
      A_CLASSIFICAR: Array.from({ length: 12 }, () => 0),
    };
    rowsByTipo.forEach((row) => {
      const idx = Number(row.capMonthIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx > 11) return;
      if (!row.tipoCompra) return;
      const key = row.tipoCompra as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | 'A_CLASSIFICAR';
      monthlyCap[key][idx] += row.valor;
    });

    const totalsByTipo = {
      ENCOMENDA: monthlyPedidos.ENCOMENDA.reduce((a, b) => a + b, 0),
      ESTOQUE: monthlyPedidos.ESTOQUE.reduce((a, b) => a + b, 0),
      DEMONSTRACAO: monthlyPedidos.DEMONSTRACAO.reduce((a, b) => a + b, 0),
      A_CLASSIFICAR: monthlyPedidos.A_CLASSIFICAR.reduce((a, b) => a + b, 0),
    };

    const countsByTipo = {
      ENCOMENDA: purchaseRows.filter((r) => r.tipoCompra === 'ENCOMENDA').length,
      ESTOQUE: purchaseRows.filter((r) => r.tipoCompra === 'ESTOQUE').length,
      DEMONSTRACAO: purchaseRows.filter((r) => r.tipoCompra === 'DEMONSTRACAO').length,
      A_CLASSIFICAR: purchaseRows.filter((r) => r.tipoCompra === 'A_CLASSIFICAR').length,
    };

    const donutSeries = [totalsByTipo.ENCOMENDA, totalsByTipo.ESTOQUE, totalsByTipo.DEMONSTRACAO, totalsByTipo.A_CLASSIFICAR];

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
      {
        name: 'A Classificar',
        data: monthlyPedidos.A_CLASSIFICAR.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#64748b',
        })),
      },
    ];

    const capTotal = monthlyCap.ENCOMENDA.map((value, monthIndex) => value + (monthlyCap.ESTOQUE[monthIndex] || 0) + (monthlyCap.A_CLASSIFICAR[monthIndex] || 0));

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
        name: 'CAP A Classificar',
        ...(isCapMixedStacked ? { type: 'column' } : {}),
        data: monthlyCap.A_CLASSIFICAR.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#64748b',
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
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const idx = Number(config?.dataPointIndex);
            if (!Number.isFinite(idx) || idx < 0) return;
            const nextFilter: CompraTipoFilter = idx === 0 ? 'ENCOMENDA' : idx === 1 ? 'ESTOQUE' : idx === 2 ? 'DEMONSTRACAO' : 'A_CLASSIFICAR';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
          legendClick: (_ctx: any, seriesIndex: number) => {
            const nextFilter: CompraTipoFilter = Number(seriesIndex) === 0 ? 'ENCOMENDA' : Number(seriesIndex) === 1 ? 'ESTOQUE' : Number(seriesIndex) === 2 ? 'DEMONSTRACAO' : 'A_CLASSIFICAR';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
        },
      },
      labels: ['Encomenda', 'Estoque', 'Demonstração', 'A Classificar'],
      colors: [
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ENCOMENDA' ? (isDark ? '#315ea1' : '#9dbcf1') : '#3b82f6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ESTOQUE' ? (isDark ? '#0f766e' : '#98e0d8') : '#14b8a6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'DEMONSTRACAO' ? (isDark ? '#5b21b6' : '#c084fc') : '#a855f7',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'A_CLASSIFICAR' ? (isDark ? '#475569' : '#cbd5e1') : '#64748b',
      ],
      dataLabels: { enabled: true, formatter: (value: number) => `${value.toFixed(0)}%` },
      legend: { show: true, position: 'bottom', labels: { colors: labelColor }, itemMargin: { horizontal: 8, vertical: 4 }, onItemClick: { toggleDataSeries: false } },
      plotOptions: { pie: { donut: { size: '62%', labels: { show: false } } } },
      stroke: { width: 2, colors: [isDark ? '#081124' : '#ffffff'] },
      tooltip: { theme: chartTheme, y: { formatter: (value: number) => formatCurrency(value) } },
    };

    return {
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
  }, [compraChartMode, compraTipoFilter, dashboard.currentYear, dashboard.fallbackMonthIndex, dashboard.monthLabels, entidades, isDark, lancamentos, selectedCentroCustoId, selectedCompraMonthIndex]);

  const consistencyChecks = useMemo(() => {
    const currentMonth = selectedMonthIndex ?? dashboard.fallbackMonthIndex;

    const rowMatchesCurrentScope = (row: NormalizedRow) => {
      if (statusFilter !== 'TODOS' && row.statusKey !== statusFilter) return false;
      if (selectedDayOfMonth !== null) {
        return row.monthIndex === currentMonth && row.dayOfMonth === selectedDayOfMonth;
      }
      if (selectedMonthIndex !== null) {
        return row.monthIndex === selectedMonthIndex;
      }
      return true;
    };

    const scopedRows = dashboard.baseRows.filter(rowMatchesCurrentScope);

    const sumByFlow = (flow: FlowFilter) => scopedRows
      .filter((row) => row.flowType === flow)
      .reduce((acc, row) => acc + row.valorAbsoluto, 0);

    const scopedPagamento = sumByFlow('PAGAMENTO');
    const scopedRecebimento = sumByFlow('RECEBIMENTO');

    const donutPagamento = Number(payReceiveCharts.donutSeries?.[0] || 0);
    const donutRecebimento = Number(payReceiveCharts.donutSeries?.[1] || 0);

    const monthlyPagamento = Number(
      ((payReceiveCharts.monthlySeries?.[0]?.data || [])[currentMonth] as any)?.y
      || 0
    );
    const monthlyRecebimento = Number(
      ((payReceiveCharts.monthlySeries?.[1]?.data || [])[currentMonth] as any)?.y
      || 0
    );

    const selectedDayIndex = selectedDayOfMonth !== null ? selectedDayOfMonth - 1 : -1;
    const dailyPagamento = selectedDayIndex >= 0
      ? Number(((payReceiveCharts.dailySeries?.[0]?.data || [])[selectedDayIndex] as any)?.y || 0)
      : null;
    const dailyRecebimento = selectedDayIndex >= 0
      ? Number(((payReceiveCharts.dailySeries?.[1]?.data || [])[selectedDayIndex] as any)?.y || 0)
      : null;

    const tolerance = 0.01;
    const approxEqual = (a: number, b: number) => Math.abs(a - b) <= tolerance;

    return {
      currentMonth,
      scopedPagamento,
      scopedRecebimento,
      donutMatches: approxEqual(scopedPagamento, donutPagamento) && approxEqual(scopedRecebimento, donutRecebimento),
      monthlyMatches: approxEqual(scopedPagamento, monthlyPagamento) && approxEqual(scopedRecebimento, monthlyRecebimento),
      dailyMatches: selectedDayIndex >= 0
        ? approxEqual(scopedPagamento, Number(dailyPagamento || 0)) && approxEqual(scopedRecebimento, Number(dailyRecebimento || 0))
        : true,
    };
  }, [dashboard.baseRows, dashboard.fallbackMonthIndex, payReceiveCharts.dailySeries, payReceiveCharts.donutSeries, payReceiveCharts.monthlySeries, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (consistencyChecks.donutMatches && consistencyChecks.monthlyMatches && consistencyChecks.dailyMatches) return;

    console.warn('[Boletim] Divergência de consistência detectada', {
      monthIndex: consistencyChecks.currentMonth,
      scopedPagamento: consistencyChecks.scopedPagamento,
      scopedRecebimento: consistencyChecks.scopedRecebimento,
      donutMatches: consistencyChecks.donutMatches,
      monthlyMatches: consistencyChecks.monthlyMatches,
      dailyMatches: consistencyChecks.dailyMatches,
      selectedMonthIndex,
      selectedDayOfMonth,
      statusFilter,
      flowFilter,
    });
  }, [consistencyChecks, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter]);


  useEffect(() => {
    setIndicadoresLimit(100);
  }, [dashboard.tableRows]);

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
    <div className={`min-h-full ${pageClass}`} onContextMenu={handleContextMenu}>
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
              <ViewToggle current={viewMode} onChange={setViewMode} isDark={isDark} />
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
            </div>
          </div>

          {activeFilterTags.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeFilterTags.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  onClick={tag.onClear}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`}
                >
                  {tag.label} x
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFlowFilter('ALL');
                  setStatusFilter('TODOS');
                  setSelectedMonthIndex(null);
                  setSelectedDayOfMonth(null);
                }}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-amber-200 hover:text-amber-100' : 'text-amber-700 hover:text-amber-800'}`}
              >
                Limpar tudo
              </button>
            </div>
          ) : null}
        </header>

        {loadError ? (
          <div className={`rounded-lg border px-5 py-4 text-sm font-semibold ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {loadError}
          </div>
        ) : null}

        {/* TOP BAR OF INTERACTIVE SUMMARY BADGES */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 px-4">
          {[
            {
              label: 'Disponível',
              value: dashboard.saldoDisponivel,
              icon: Landmark,
              color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 dark:text-blue-400',
              onClick: () => {
                if (dashboard.banks.length > 0) {
                  handleBankAuditClick(dashboard.banks[0]);
                }
              }
            },
            {
              label: 'A Pagar Atrasado',
              value: dashboard.pagar.atrasadas,
              icon: TrendingDown,
              color: dashboard.pagar.atrasadas > 0
                ? 'text-rose-500 bg-rose-500/10 border-rose-500/20 dark:text-rose-450'
                : 'text-slate-500 bg-slate-500/10 border-slate-500/20 dark:text-slate-400',
              onClick: () => handleKpiAuditClick('pagar_atrasadas'),
              badge: dashboard.pagar.atrasadas > 0 ? 'Atenção' : null
            },
            {
              label: 'A Pagar Hoje',
              value: dashboard.pagar.hoje,
              icon: Clock,
              color: 'text-amber-500 bg-amber-500/10 border-amber-500/20 dark:text-amber-400',
              onClick: () => handleKpiAuditClick('pagar_hoje')
            },
            {
              label: 'A Receber Atrasado',
              value: dashboard.receber.atrasadas,
              icon: TrendingUp,
              color: dashboard.receber.atrasadas > 0
                ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 dark:text-amber-450'
                : 'text-slate-500 bg-slate-500/10 border-slate-500/20 dark:text-slate-400',
              onClick: () => handleKpiAuditClick('receber_atrasadas')
            },
            {
              label: 'A Receber Hoje',
              value: dashboard.receber.hoje,
              icon: CalendarDays,
              color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400',
              onClick: () => handleKpiAuditClick('receber_hoje')
            },
            {
              label: 'Resultado Final',
              value: dashboard.resultadoFinalMes,
              icon: Activity,
              color: dashboard.resultadoFinalMes >= 0
                ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400'
                : 'text-rose-500 bg-rose-500/10 border-rose-500/20 dark:text-rose-450',
              onClick: () => handleKpiAuditClick('resultado_final')
            }
          ].map((badge) => {
            const Icon = badge.icon;
            return (
              <button
                key={badge.label}
                type="button"
                onClick={badge.onClick}
                className={`flex flex-col items-start gap-1 p-3 rounded-2xl border text-left transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer hover:shadow-md ${isDark ? 'border-white/10 bg-slate-900/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-450 dark:text-slate-500">
                    {badge.label}
                  </span>
                  <div className={`p-1.5 rounded-lg border ${badge.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className={`text-base font-black ${badge.label === 'Disponível' || badge.label === 'Resultado Final' ? badge.value >= 0 ? 'text-slate-800 dark:text-white' : 'text-rose-500' : badge.color.split(' ')[0]}`}>
                    {formatCurrency(badge.value)}
                  </span>
                  {badge.badge && (
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-rose-500 text-white px-1.5 py-0.5 rounded-full animate-pulse">
                      {badge.badge}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {viewMode === 'executivo' ? (
          <section className="grid gap-4 xl:grid-cols-2 xl:items-start">
            {auditPanel ? createPortal(
              <div className="fixed inset-0 z-[9999]">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-950/55"
                  onClick={() => { setAuditPanel(null); setActiveAuditMetricKey(null); }}
                  aria-label="Fechar auditoria"
                />
                <aside
                  className={`absolute left-0 top-0 z-10 flex h-full flex-col rounded-r-[28px] border-r px-4 py-4 ${auditPanelShellClass}`}
                  style={{ width: `${auditPanelWidth}px` }}
                >
                  <div
                    className={`absolute right-0 top-0 h-full w-2 cursor-ew-resize ${isDark ? 'hover:bg-white/10' : 'hover:bg-slate-300/35'}`}
                    onMouseDown={startAuditResize}
                    title="Arraste para redimensionar"
                  />
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className={`text-sm font-black uppercase tracking-[0.16em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>{auditPanel.title}</div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>{auditPanel.subtitle}</div>
                    </div>
                    <button type="button" onClick={() => { setAuditPanel(null); setActiveAuditMetricKey(null); }} className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'bg-white/6 text-white/70 hover:bg-white/12' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Fechar</button>
                  </div>

                  {auditPanel.mode === 'LANCAMENTOS' ? (
                    <div className={`min-h-0 flex-1 overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                      <div className="h-full overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className={`sticky top-0 z-10 ${isDark ? 'bg-white/5 text-white/60' : 'bg-slate-50 text-slate-500'}`}>
                            <tr>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Interessado</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupedRows.sortedDates.length === 0 ? (
                              <tr>
                                <td colSpan={5} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Sem itens para esse recorte.</td>
                              </tr>
                            ) : (
                              groupedRows.sortedDates.map((dateStr) => {
                                const groupRows = groupedRows.groups[dateStr];
                                const dayTotal = groupRows.reduce((sum, r) => sum + r.valor, 0);
                                return (
                                  <Fragment key={dateStr}>
                                    <tr className="bg-slate-100/70 dark:bg-slate-800/60 select-none">
                                      <td colSpan={5} className="px-3 py-2 border-t border-b border-slate-200/50 dark:border-slate-800">
                                        <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                          <span>Dia {formatDate(dateStr)}</span>
                                          <span>Total do Dia: <span className={getValueTone(dayTotal, isDark)}>{formatCurrencyDetailed(dayTotal)}</span></span>
                                        </div>
                                      </td>
                                    </tr>
                                    {groupRows.map((row) => {
                                      const isClickable = row.id > 0 || row.isCardSummary;
                                      return (
                                        <tr
                                          key={`audit-row-${row.rowKey}`}
                                          onClick={(event) => {
                                            if (row.isCardSummary) {
                                              setAuditPanel(null);
                                              setActiveAuditMetricKey(null);
                                              navigate(`/lancamentos?boletim_ids=${row.boletimIds.join(',')}`);
                                            } else if (row.id > 0) {
                                              openLancamentoEdicao(row.id, event);
                                            }
                                          }}
                                          className={`${isDark ? 'border-t border-white/8 text-white hover:bg-white/5' : 'border-t border-slate-100 text-slate-800 hover:bg-slate-50'} ${isClickable ? 'cursor-pointer' : 'cursor-default'} transition`}
                                          title={row.isCardSummary ? "Ver lançamentos na listagem" : row.id > 0 ? "Abrir edição do lançamento" : undefined}
                                        >
                                          <td className="px-3 py-2.5 font-medium whitespace-nowrap text-slate-400 dark:text-slate-500"></td>
                                          <td className="px-3 py-2.5">{row.interessado}</td>
                                          <td className="max-w-56 truncate px-3 py-2.5" title={row.descricao}>
                                            <div className="flex items-center gap-1.5">
                                              <span className="truncate">{row.descricao}</span>
                                              {(row.id <= 0 && !row.isCardSummary || row.origem === 'ASAAS') && (
                                                <span className="shrink-0 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20">
                                                  Asaas
                                                </span>
                                              )}
                                              {row.isCardSummary && (
                                                <span className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${row.tipoPagamento === 'cartao_debito'
                                                    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                                                    : 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800'
                                                  }`}>
                                                  Cartão
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(row.valor, isDark)}`}>{formatCurrencyDetailed(row.valor)}</td>
                                          <td className="px-3 py-2.5">
                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${row.statusKey === 'PAGO' ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700' : row.statusKey === 'ATRASADO' ? isDark ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700' : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                              {row.statusLabel}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className={`min-h-0 flex-1 overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                      <div className="h-full overflow-y-auto">
                        {auditLoading ? (
                          <div className={`px-4 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Carregando extrato...</div>
                        ) : null}
                        {!auditLoading && auditPanel.extrato ? (
                          <table className="w-full text-sm">
                            <thead className={`sticky top-0 z-10 ${isDark ? 'bg-white/5 text-white/60' : 'bg-slate-50 text-slate-500'}`}>
                              <tr>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Movimento</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupedMovimentos.sortedDates.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Sem movimentos para este banco.</td>
                                </tr>
                              ) : (
                                groupedMovimentos.sortedDates.map((dateStr) => {
                                  const groupMovs = groupedMovimentos.groups[dateStr];
                                  const dayNet = groupMovs.reduce((sum, m) => sum + (Number(m.valor_entrada || 0) > 0 ? Number(m.valor_entrada || 0) : -Number(m.valor_saida || 0)), 0);
                                  return (
                                    <Fragment key={dateStr}>
                                      <tr className="bg-slate-100/70 dark:bg-slate-800/60 select-none">
                                        <td colSpan={4} className="px-3 py-2 border-t border-b border-slate-200/50 dark:border-slate-800">
                                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                            <span>Dia {formatDate(dateStr)}</span>
                                            <span>Movimentação do Dia: <span className={getValueTone(dayNet, isDark)}>{dayNet > 0 ? '+' : ''}{formatCurrencyDetailed(dayNet)}</span></span>
                                          </div>
                                        </td>
                                      </tr>
                                      {groupMovs.map((movimento) => {
                                        const signed = Number(movimento.valor_entrada || 0) > 0 ? Number(movimento.valor_entrada || 0) : Number(movimento.valor_saida || 0) > 0 ? -Number(movimento.valor_saida || 0) : 0;
                                        return (
                                          <tr key={`extrato-${movimento.id}`} className={isDark ? 'border-t border-white/8 text-white' : 'border-t border-slate-100 text-slate-800'}>
                                            <td className="px-3 py-2.5 text-slate-400 dark:text-slate-500"></td>
                                            <td className="max-w-50 px-3 py-2.5">
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="truncate" title={movimento.descricao}>{movimento.descricao}</span>
                                                {movimento.conciliado && (
                                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900/50 select-none shrink-0" title="Lançamento Conciliado com o Banco">
                                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                                    Conciliado
                                                  </span>
                                                )}
                                              </div>
                                            </td>
                                            <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(signed, isDark)}`}>{formatCurrencyDetailed(signed)}</td>
                                            <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(Number(movimento.saldo_apos_movimento || 0), isDark)}`}>{formatCurrencyDetailed(Number(movimento.saldo_apos_movimento || 0))}</td>
                                          </tr>
                                        );
                                      })}
                                    </Fragment>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        ) : null}
                      </div>
                    </div>
                  )}
                </aside>
              </div>,
              document.body
            ) : null}

            <LancamentoFormDrawer
              showDrawer={isLancamentoDrawerOpen}
              editarId={editingLancamentoId}
              onClose={() => {
                setIsLancamentoDrawerOpen(false);
                setEditingLancamentoId(null);
              }}
              onSaveSuccess={async () => {
                setIsLancamentoDrawerOpen(false);
                setEditingLancamentoId(null);
                useTransactionStore.getState().incrementRefreshCount();
              }}
              categorias={categorias}
              entidades={entidades}
              contas={contas}
              centros={centrosCusto}
            />

            {/* Coluna 1 */}
            <div className="space-y-4">
              {/* Card Contas a Pagar */}
              <div className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-xs overflow-hidden ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-rose-50/10 dark:bg-rose-500/5">
                  <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    <TrendingDown className="h-4 w-4" />
                    <span>Contas a Pagar</span>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[
                    { key: 'pagar_hoje', label: 'Para hoje', subLabel: formatDate(dashboard.todayIso), value: dashboard.pagar.hoje },
                    { key: 'pagar_amanha', label: 'Para amanhã', subLabel: formatDate(dashboard.tomorrowIso), value: dashboard.pagar.amanha },
                    { key: 'pagar_em_aberto', label: 'A vencer no mês', value: dashboard.pagar.emAberto },
                    { key: 'pagar_pagas_mes', label: 'Pagas no mês', value: dashboard.pagarPagasNoMes },
                    { key: 'pagar_mes', label: 'Total com vencto no mês', value: dashboard.pagarNoMes },
                    { key: 'pagar_atrasadas', label: 'Atrasadas', value: dashboard.pagar.atrasadas, isAlert: dashboard.pagar.atrasadas > 0 },
                  ].map((row) => (
                    <div
                      key={row.key}
                      onClick={() => handleKpiAuditClick(row.key)}
                      className="px-4 py-3.5 flex justify-between items-center text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition duration-150 cursor-pointer group"
                    >
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {row.label}
                        {row.subLabel && (
                          <span className="text-slate-400 dark:text-slate-500 text-xs ml-2 font-normal">
                            {row.subLabel}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5 font-semibold">
                        <span className={row.isAlert ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-200'}>
                          {formatCurrency(row.value)}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card Saldo de Contas Bancárias */}
              <div className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-xs overflow-hidden ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-blue-50/10 dark:bg-blue-500/5">
                  <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    <Landmark className="h-4 w-4" />
                    <span>Saldo de Contas Bancárias</span>
                  </div>
                  <div className={`font-black text-sm ${getValueTone(dashboard.saldoDisponivel, isDark)}`}>
                    {formatCurrency(dashboard.saldoDisponivel)}
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboard.banks.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm font-semibold text-slate-400 dark:text-slate-500">
                      Nenhuma conta bancária ativa encontrada.
                    </div>
                  ) : (
                    dashboard.banks.map((conta) => {
                      const logo = getFullLogoUrl(conta.logo_url || null);
                      const foraDoDisponivel = conta.conta_como_disponibilidade === false;
                      const activeBank = auditPanel?.mode === 'EXTRATO_BANCO' && auditPanel.conta?.id === conta.id;
                      const contaDisplayName = resolveContaDisplayName(conta);
                      return (
                        <div
                          key={conta.id}
                          onClick={() => handleBankAuditClick(conta)}
                          className={`px-4 py-3 flex justify-between items-center text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition duration-150 cursor-pointer group ${activeBank ? 'bg-blue-50/30 dark:bg-blue-950/10' : ''}`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-100 dark:border-slate-800 ${logo ? '' : conta.tipo === 'CAIXA' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-white/55'}`}>
                              {logo ? (
                                <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={contaDisplayName} integrationType={conta.tipo} size="sm" className="h-8 w-8" imageClassName="rounded-lg" fallbackClassName="rounded-lg border-0 shadow-none" />
                              ) : conta.tipo === 'CAIXA' ? (
                                <Banknote className="h-4 w-4" />
                              ) : (
                                <Landmark className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{contaDisplayName}</div>
                              {foraDoDisponivel && (
                                <div className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mt-0.5">Não soma no disponível</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span className={getValueTone(conta.saldo, isDark)}>
                              {formatCurrency(conta.saldo)}
                            </span>
                            <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Coluna 2 */}
            <div className="space-y-4">
              {/* Card Contas a Receber */}
              <div className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-xs overflow-hidden ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-emerald-50/10 dark:bg-emerald-500/5">
                  <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-wider text-emerald-600 dark:emerald-400">
                    <TrendingUp className="h-4 w-4" />
                    <span>Contas a Receber</span>
                    {asaasLoading && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-blue-500 animate-pulse lowercase tracking-normal normal-case">
                        (sincronizando Asaas...)
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {/* Para hoje — sem breakdown de cartões na tela principal */}
                  {(() => {
                    return (
                      <div
                        onClick={() => handleKpiAuditClick('receber_hoje')}
                        className="px-4 py-3.5 flex justify-between items-center text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition duration-150 cursor-pointer group"
                      >
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          Para hoje
                          <span className="text-slate-400 dark:text-slate-500 text-xs ml-2 font-normal">
                            {formatDate(dashboard.todayIso)}
                          </span>
                        </span>
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span className="text-slate-700 dark:text-slate-200">{formatCurrency(dashboard.receber.hoje)}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition" />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Demais linhas do CAR */}
                  {[
                    { key: 'receber_amanha', label: 'Para amanhã', subLabel: formatDate(dashboard.tomorrowIso), value: dashboard.receber.amanha },
                    { key: 'receber_em_aberto', label: 'A vencer no mês', value: dashboard.receber.emAberto },
                    { key: 'receber_recebidas_mes', label: 'Recebidas no mês', value: dashboard.receberRecebidasNoMes },
                    { key: 'receber_mes', label: 'Total com vencto no mês', value: dashboard.receberNoMes },
                    { key: 'receber_atrasadas', label: 'Atrasadas', value: dashboard.receber.atrasadas, isAlert: dashboard.receber.atrasadas > 0 },
                  ].map((row) => (
                    <div
                      key={row.key}
                      onClick={() => handleKpiAuditClick(row.key)}
                      className="px-4 py-3.5 flex justify-between items-center text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition duration-150 cursor-pointer group"
                    >
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {row.label}
                        {row.subLabel && (
                          <span className="text-slate-400 dark:text-slate-500 text-xs ml-2 font-normal">
                            {row.subLabel}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5 font-semibold">
                        <span className={row.isAlert ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-200'}>
                          {formatCurrency(row.value)}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card Resultados Financeiros */}
              <div className={`rounded-2xl border bg-white dark:bg-slate-900 shadow-xs overflow-hidden ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-violet-50/10 dark:bg-violet-500/5">
                  <div className="flex items-center gap-2 font-bold text-sm uppercase tracking-wider text-violet-600 dark:text-violet-400">
                    <Activity className="h-4 w-4" />
                    <span>Resultados Financeiros</span>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[
                    { key: 'receber_recebidas_mes', label: 'Receitas recebidas no mês', value: dashboard.receberRecebidasNoMes, tone: 'text-emerald-600 dark:text-emerald-400' },
                    { key: 'receber_em_aberto', label: 'Receitas pendentes', value: Math.max(0, dashboard.receberNoMes - dashboard.receberRecebidasNoMes), tone: 'text-slate-500 dark:text-slate-400 font-medium' },
                    { key: 'pagar_pagas_mes', label: 'Despesas pagas no mês', value: dashboard.pagarPagasNoMes, tone: 'text-rose-600 dark:text-rose-400' },
                    { key: 'pagar_em_aberto', label: 'Despesas pendentes', value: Math.max(0, dashboard.pagarNoMes - dashboard.pagarPagasNoMes), tone: 'text-slate-500 dark:text-slate-400 font-medium' },
                    { key: 'resultado_operacional', label: 'Resultado operacional', value: dashboard.resultadoOperacionalMes, isResult: true },
                    { key: 'resultado_final', label: 'Resultado final', value: dashboard.resultadoFinalMes, isResult: true },
                  ].map((row) => {
                    const valTone = row.isResult
                      ? row.value >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-400 font-black'
                      : row.tone;
                    return (
                      <div
                        key={row.key}
                        onClick={() => handleKpiAuditClick(row.key)}
                        className="px-4 py-3.5 flex justify-between items-center text-sm hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition duration-150 cursor-pointer group"
                      >
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {row.label}
                        </span>
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span className={valTone}>
                            {row.value >= 0 && row.isResult ? '+' : ''}{formatCurrency(row.value)}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 group-hover:text-slate-400 dark:group-hover:text-slate-500 transition" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : viewMode === 'pay-receive' ? (
          <section className="space-y-3">
            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1040px] gap-3 xl:grid-cols-[250px_minmax(0,1fr)_minmax(0,1fr)]">
                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Filtro</div>
                    <button
                      type="button"
                      onClick={() => setFlowFilter('ALL')}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${flowFilter === 'ALL' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Limpar
                    </button>
                  </div>
                  <AsyncApexChart type="donut" height={235} series={payReceiveCharts.donutSeries} options={payReceiveCharts.donutOptions} />
                  <div className={`mt-1 text-[10px] ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Clique na rosca para filtrar por pagamento ou recebimento.</div>
                </section>

                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A pagar vs receber por mês (vcto)</div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMonthIndex(null);
                        setSelectedDayOfMonth(null);
                      }}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${selectedMonthIndex === null ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Limpar mês
                    </button>
                  </div>
                  <AsyncApexChart type="bar" height={235} series={payReceiveCharts.monthlySeries} options={payReceiveCharts.monthlyOptions} />
                </section>

                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A pagar vs receber por dia (vcto)</div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{payReceiveCharts.effectiveMonthLabel}</div>
                  </div>
                  <AsyncApexChart type="bar" height={235} series={payReceiveCharts.dailySeries} options={payReceiveCharts.dailyOptions} />
                </section>
              </div>
            </div>

            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1040px] gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                <section className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Indicadores</div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Grade rolável para não estourar a tela.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        placeholder="Pesquisar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs outline-none transition w-full sm:w-60 ${isDark ? 'border-white/15 bg-slate-950/50 text-white focus:border-amber-300/60' : 'border-slate-300 bg-white text-slate-700 focus:border-blue-500'}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <FilterPill active={statusFilter === 'TODOS'} label="Todos" onClick={() => setStatusFilter('TODOS')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'PAGO'} label="Pago" onClick={() => setStatusFilter('PAGO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'EM_ABERTO'} label="Em aberto" onClick={() => setStatusFilter('EM_ABERTO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'ATRASADO'} label="Atrasado" onClick={() => setStatusFilter('ATRASADO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'AMANHA'} label="Vcto amanha" onClick={() => setStatusFilter('AMANHA')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'HOJE'} label="Vcto hoje" onClick={() => setStatusFilter('HOJE')} isDark={isDark} />
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col min-h-0 relative">
                      <div 
                        className="max-h-[52vh] overflow-auto custom-scrollbar"
                        onScroll={(e) => {
                          const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                          if (scrollHeight - scrollTop <= clientHeight + 200) {
                            setIndicadoresLimit(prev => Math.min(prev + 100, dashboard.tableRows.length));
                          }
                        }}
                      >
                        <table className="w-full min-w-[980px] text-[13px]">
                        <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                          <tr>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data Vcto</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Nome Interessado</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Tipo</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.tableRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className={`px-4 py-12 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Nenhum lançamento para os filtros atuais.</td>
                            </tr>
                          ) : (
                            <>
                              {dashboard.tableRows.slice(0, indicadoresLimit).map((row) => (
                                <tr key={row.rowKey} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/4' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                                  <td className="px-4 py-2.5 font-medium">{formatDate(row.dataVencimento)}</td>
                                  <td className="px-4 py-2.5 font-semibold">{row.interessado}</td>
                                  <td className="max-w-85 truncate px-4 py-2.5" title={row.descricao}>
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate">{row.descricao}</span>
                                      {(row.id <= 0 || row.origem === 'ASAAS') && (
                                        <span className="shrink-0 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20">
                                          Asaas
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span
                                      title={row.flowType === 'RECEBIMENTO' ? 'Recebimento' : 'Pagamento'}
                                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${row.flowType === 'RECEBIMENTO' ? isDark ? 'border border-blue-400/35 bg-blue-500/20 text-blue-300' : 'border border-blue-200 bg-blue-100 text-blue-700' : isDark ? 'border border-rose-400/35 bg-rose-500/20 text-rose-300' : 'border border-rose-200 bg-rose-100 text-rose-700'}`}
                                    >
                                      {row.flowType === 'RECEBIMENTO' ? 'R' : 'P'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${row.statusKey === 'PAGO' ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700' : row.statusKey === 'ATRASADO' ? isDark ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700' : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                      {row.statusLabel}
                                    </span>
                                  </td>
                                  <td className={`px-4 py-2.5 text-right font-black whitespace-nowrap ${getValueTone(row.valor, isDark)}`}>{formatCurrency(row.valor)}</td>
                                </tr>
                              ))}
                              {dashboard.tableRows.length > indicadoresLimit && (
                                <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                  <td colSpan={6} className="px-4 py-4 text-center text-xs font-semibold">
                                    Exibindo {indicadoresLimit} de {dashboard.tableRows.length} lançamentos. <br/>
                                    Role a tabela para carregar mais ou clique no botão "Exportar" para baixar todos.
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                          <tr className={isDark ? 'border-t border-white/10 bg-black/25 text-white' : 'border-t border-slate-200 bg-slate-50 text-slate-900'}>
                            <td colSpan={5} className="px-4 py-3 text-right font-black uppercase tracking-[0.14em]">Total geral</td>
                            <td className={`px-4 py-3 text-right font-black whitespace-nowrap ${getValueTone(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0), isDark)}`}>{formatCurrency(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section className={`rounded-2xl border px-3 py-4 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Situação</div>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('TODOS')}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${statusFilter === 'TODOS' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Mostrar tudo
                    </button>
                  </div>
                  <div className="space-y-2.5 max-h-[62vh] overflow-y-auto custom-scrollbar pr-1">
                    {situacaoCards.map((item) => {
                      const active = statusFilter === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setStatusFilter((current) => current === item.key ? 'TODOS' : item.key)}
                          className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? isDark ? 'border-amber-300/50 bg-amber-300/10' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035] hover:bg-white/6' : 'border-slate-200 bg-white/85 hover:bg-slate-50'}`}
                        >
                          <span className={`font-black ${isDark ? 'text-white/85' : 'text-slate-800'}`}>{item.label}</span>
                          <span className={`font-black whitespace-nowrap ${active ? isDark ? 'text-amber-200' : 'text-amber-700' : getValueTone(item.value, isDark)}`}>{formatCurrency(item.value)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="grid gap-3 xl:grid-cols-3 xl:items-stretch">
              <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
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

              <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
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
                <AsyncApexChart type={comprasView.mainChartType} height={255} series={comprasView.pedidosSeries} options={comprasView.pedidosOptions} />
              </section>
              <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
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
                <button
                  type="button"
                  onClick={() => setCompraChartMode('COLUNA_SEPARADA')}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${compraChartMode === 'COLUNA_SEPARADA' ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Coluna separada
                </button>
              </div>
            </div>

            <section className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Pedidos (visão compras)</div>
                <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{comprasView.tableRows.length} item(ns)</div>
              </div>
              <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div 
                  className="max-h-[52vh] overflow-auto custom-scrollbar"
                  onScroll={(e) => {
                    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                    if (scrollHeight - scrollTop <= clientHeight + 200) {
                      setComprasLimit(prev => Math.min(prev + 100, comprasView.tableRows.length));
                    }
                  }}
                >
                  <table className="w-full min-w-[940px] text-[13px]">
                    <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                      <tr>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Emitente</th>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">NF-e</th>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Tipo compra</th>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comprasView.tableRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className={`px-4 py-12 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Nenhum pedido para os filtros atuais.</td>
                        </tr>
                      ) : (
                        <>
                          {comprasView.tableRows.slice(0, comprasLimit).map((row, index) => (
                            <tr key={`compra-row-${index}-${row.numeroNfe || 'sem-nf'}`} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/4' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                              <td className="px-4 py-2.5 font-medium">{formatDate(row.vencimento)}</td>
                              <td className="px-4 py-2.5 font-semibold">{row.emitente || '-'}</td>
                              <td className="px-4 py-2.5 font-medium text-slate-500">{row.numeroNfe || '-'}</td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${row.tipoCompra === 'ENCOMENDA'
                                    ? isDark ? 'border-blue-400/35 bg-blue-500/20 text-blue-300' : 'border-blue-200 bg-blue-100 text-blue-700'
                                    : row.tipoCompra === 'ESTOQUE'
                                      ? isDark ? 'border-teal-400/35 bg-teal-500/20 text-teal-300' : 'border-teal-200 bg-teal-100 text-teal-700'
                                      : isDark ? 'border-purple-400/35 bg-purple-500/20 text-purple-300' : 'border-purple-200 bg-purple-100 text-purple-700'
                                  }`}>
                                  {row.tipoCompra === 'ENCOMENDA' ? 'Encomenda' : row.tipoCompra === 'ESTOQUE' ? 'Estoque' : 'Demonstração'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${row.tipoCompra === 'DEMONSTRACAO'
                                    ? isDark ? 'border-purple-400/30 bg-purple-400/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700'
                                    : normalizeText(row.status).includes('pago')
                                      ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'
                                  }`}>
                                  {row.tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : String(row.status || '-').toUpperCase()}
                                </span>
                              </td>
                              <td className={`px-4 py-2.5 text-right font-black whitespace-nowrap ${row.tipoCompra === 'DEMONSTRACAO'
                                  ? isDark ? 'text-purple-300' : 'text-purple-600'
                                  : isDark ? 'text-rose-300' : 'text-rose-600'
                                }`}>{formatCurrency(row.tipoCompra === 'DEMONSTRACAO' ? 0 : -Math.abs(row.valor))}</td>
                            </tr>
                          ))}
                          {comprasView.tableRows.length > comprasLimit && (
                            <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                              <td colSpan={6} className="px-4 py-4 text-center text-xs font-semibold">
                                Exibindo {comprasLimit} de {comprasView.tableRows.length} pedidos. <br/>
                                Role a tabela para carregar mais...
                              </td>
                            </tr>
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>
        )}
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
                void handleExportExcel();
              }}
              disabled={isExportingExcel}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors text-left"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{isExportingExcel ? 'Gerando Planilha...' : 'Exportar Indicadores em Excel (.xlsx)'}</span>
            </button>
          </div>
        )}
        <BoletimFiltrosSidebar
          showFiltrosSidebar={showFiltrosSidebar}
          setShowFiltrosSidebar={setShowFiltrosSidebar}
          filtrosAvancados={filtrosAvancados}
          setFiltrosAvancados={setFiltrosAvancados}
          resetFiltros={() => {
            setFiltrosAvancados({
              categoriaIds: new Set<number>(),
              contaIds: new Set<number>(),
              interessados: new Set<string>(),
              dataInicio: '',
              dataFim: ''
            });
          }}
          categorias={categorias}
          contas={contas}
          interessadosList={Array.from(new Set(entidades.map(e => e.nome)))}
        />
      </div>
    </div>
  );
}
