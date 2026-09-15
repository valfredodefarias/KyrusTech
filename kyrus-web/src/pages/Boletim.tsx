import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState, Fragment, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Banknote,
  Building2,
  CalendarDays,
  Landmark,
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
import { exportCellToExcel, exportCellToPdf } from '../services/boletimExportService';

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
  saldo?: number;
  status?: 'ATIVO' | 'INATIVO' | string;
  conta_como_disponibilidade?: boolean;
}

interface BoletimBancoItem {
  id: number;
  nome: string;
  banco?: string | null;
  saldo: number;
  saldo_inicial?: number;
  saldo_atual?: number;
  status: string;
  tipo: string;
  conta_como_disponibilidade: boolean;
  centro_custo_id?: number | null;
  logo_url?: string | null;
}

interface BoletimExecutivoMetrics {
  hoje: number;
  amanha: number;
  atrasadas: number;
  em_aberto: number;
  pagas_mes: number;
  recebidas_mes: number;
  total_mes: number;
}

interface BoletimResultadosMetrics {
  receitas_realizadas?: number;
  receitas_recebidas?: number;
  receitas_pendentes?: number;
  despesas_realizadas?: number;
  despesas_pagas?: number;
  despesas_pendentes?: number;
  resultado_operacional: number;
  resultado_operacional_mes?: number;
  resultado_final: number;
  resultado_final_mes?: number;
  resultado_operacional_monthly: number[];
  resultado_final_monthly: number[];
}

interface BoletimResumoResponse {
  hoje_iso: string;
  ano: number;
  mes: number;
  saldo_disponivel: number;
  saldo_total: number;
  bancos: BoletimBancoItem[];
  pagar: BoletimExecutivoMetrics;
  receber: BoletimExecutivoMetrics;
  resultados: BoletimResultadosMetrics;
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
  cnpj?: string | null;
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
  const [boletimResumo, setBoletimResumo] = useState<BoletimResumoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const empresa = useAuthStore((state) => state.empresa);
  const setEmpresa = useAuthStore((state) => state.setEmpresa);
  const user = useAuthStore((state) => state.user);
  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  const isDark = useIsDarkMode();
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosAvancados, setFiltrosAvancados] = useState<BoletimFiltrosAvancados>({
    categoriaIds: new Set<number>(),
    contaIds: new Set<number>(),
    interessados: new Set<string>(),
    dataInicio: '',
    dataFim: ''
  });
  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);

  const asaasRows = useTransactionStore((state) => state.asaasCache[referenceYear] || EMPTY_ARRAY);
  const asaasLoading = useTransactionStore((state) => state.loadingAsaas[referenceYear] || false);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const fetchAsaasRows = useTransactionStore((state) => state.fetchAsaasRows);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
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
      if (force) {
        setIsRefreshing(true);
      } else if (!initialLoadDoneRef.current) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const [, , , , resumoRes] = await Promise.all([
          fetchContas(force),
          fetchPlanoContas(force),
          fetchEntidadesLookup(force),
          fetchCentrosCusto(force),
          api.get<BoletimResumoResponse>('/lancamentos/boletim-resumo', {
            params: {
              ano: referenceYear,
              mes: selectedMonthIndex !== null ? selectedMonthIndex + 1 : undefined,
              centro_custo_id: selectedCentroCustoId || undefined,
            },
          }),
        ]);

        if (active && resumoRes?.data) {
          setBoletimResumo(resumoRes.data);
        }

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
          setLoadError('Parte dos dados do boletim não pôde ser carregada.');
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
  }, [referenceYear, selectedMonthIndex, selectedCentroCustoId, refreshCount]);

  interface CellContextMenuState {
    x: number;
    y: number;
    metricKey: string;
    cellTitle: string;
    cellSubTitle?: string;
    flowType: 'PAGAR' | 'RECEBER';
  }

  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null);
  const [isExportingCell, setIsExportingCell] = useState<'xlsx' | 'pdf' | 'pdf_paginated' | null>(null);

  useEffect(() => {
    const handleCloseMenu = () => setCellContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleCellContextMenu = (
    e: ReactMouseEvent,
    metricKey: string,
    cellTitle: string,
    cellSubTitle: string | undefined,
    flowType: 'PAGAR' | 'RECEBER'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 290);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    setCellContextMenu({
      x,
      y,
      metricKey,
      cellTitle,
      cellSubTitle,
      flowType,
    });
  };




  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackToday = parseDateOnly(getBusinessTodayIso()) || new Date();
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : fallbackToday;
    const currentYear = now.getFullYear();
    const fallbackMonthIndex = now.getMonth();
    const todayIso = boletimResumo?.hoje_iso || (boletimResumo as any)?.data_hoje || toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = (boletimResumo as any)?.amanha_iso || (boletimResumo as any)?.data_amanha || toIsoDate(tomorrow);
    const effectiveMonthIndex = selectedMonthIndex ?? fallbackMonthIndex;

    const bankBalances: ContaResumo[] = (boletimResumo?.bancos || []).map((b) => ({
      id: b.id,
      nome: b.nome,
      banco: b.banco,
      logo_url: b.logo_url,
      centro_custo_id: b.centro_custo_id,
      tipo: b.tipo,
      saldo_inicial: b.saldo_inicial ?? 0,
      saldo_atual: b.saldo_atual ?? b.saldo,
      saldo: b.saldo,
      status: b.status,
      conta_como_disponibilidade: b.conta_como_disponibilidade,
    }));

    const saldoDisponivel = boletimResumo?.saldo_disponivel ?? bankBalances
      .filter((conta) => conta.conta_como_disponibilidade !== false)
      .reduce((acc, conta) => acc + (conta.saldo_atual ?? conta.saldo_inicial ?? 0), 0);

    const saldoBancario = boletimResumo?.saldo_total ?? bankBalances
      .reduce((acc, conta) => acc + (conta.saldo_atual ?? conta.saldo_inicial ?? 0), 0);

    const pagar = {
      hoje: boletimResumo?.pagar.hoje ?? 0,
      amanha: boletimResumo?.pagar.amanha ?? 0,
      atrasadas: boletimResumo?.pagar.atrasadas ?? 0,
      emAberto: boletimResumo?.pagar.em_aberto ?? 0,
    };
    const pagarPagasNoMes = (boletimResumo?.pagar as any)?.pagas_no_mes ?? boletimResumo?.pagar.pagas_mes ?? 0;
    const pagarNoMes = boletimResumo?.pagar.total_mes ?? 0;

    const receber = {
      hoje: boletimResumo?.receber.hoje ?? 0,
      amanha: boletimResumo?.receber.amanha ?? 0,
      atrasadas: boletimResumo?.receber.atrasadas ?? 0,
      emAberto: boletimResumo?.receber.em_aberto ?? 0,
    };
    const receberRecebidasNoMes = (boletimResumo?.receber as any)?.recebidas_no_mes ?? boletimResumo?.receber.recebidas_mes ?? 0;
    const receberNoMes = boletimResumo?.receber.total_mes ?? 0;

    const resultados = boletimResumo?.resultados;
    const receitasRealizadasMes = resultados?.receitas_realizadas ?? resultados?.receitas_recebidas ?? (boletimResumo?.receber as any)?.recebidas_no_mes ?? boletimResumo?.receber.recebidas_mes ?? 0;
    const receitasPendentesMes = resultados?.receitas_pendentes ?? boletimResumo?.receber.em_aberto ?? 0;
    const despesasRealizadasMes = resultados?.despesas_realizadas ?? resultados?.despesas_pagas ?? (boletimResumo?.pagar as any)?.pagas_no_mes ?? boletimResumo?.pagar.pagas_mes ?? 0;
    const despesasPendentesMes = resultados?.despesas_pendentes ?? boletimResumo?.pagar.em_aberto ?? 0;

    const resultadoOperacionalMes = (boletimResumo?.resultados as any)?.resultado_operacional ?? boletimResumo?.resultados?.resultado_operacional_mes ?? 0;
    const resultadoFinalMes = (boletimResumo?.resultados as any)?.resultado_final ?? boletimResumo?.resultados?.resultado_final_mes ?? 0;
    const resultadoOperacionalMonthly = boletimResumo?.resultados?.resultado_operacional_monthly ?? Array.from({ length: 12 }, () => 0);
    const resultadoFinalMonthly = boletimResumo?.resultados?.resultado_final_monthly ?? Array.from({ length: 12 }, () => 0);

    return {
      now,
      currentYear,
      fallbackMonthIndex,
      effectiveMonthIndex,
      effectiveMonthLabel: buildMonthLabel(effectiveMonthIndex, currentYear),
      monthLabels: MONTH_NAMES.map((label) => `${label}/${String(currentYear).slice(2)}`),
      banks: bankBalances,
      baseRows: [] as NormalizedRow[],
      saldoBancario,
      saldoDisponivel,
      pagar,
      receber,
      pagarNoMes,
      pagarPagasNoMes,
      receberNoMes,
      receberRecebidasNoMes,
      receitasRealizadasMes,
      receitasPendentesMes,
      despesasRealizadasMes,
      despesasPendentesMes,
      resultadoOperacionalMes,
      resultadoFinalMes,
      resultadoOperacionalMonthly,
      resultadoFinalMonthly,
      tableRows: [] as NormalizedRow[],
      situacao: {
        PAGO: 0,
        EM_ABERTO: 0,
        ATRASADO: 0,
        AMANHA: 0,
        HOJE: 0,
      },
      todayIso,
      tomorrowIso,
    };
  }, [boletimResumo, referenceDate, selectedMonthIndex]);

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

  const getMetricDetails = (metricKey: string) => {
    const monthIndex = dashboard.effectiveMonthIndex;
    const year = referenceYear;
    const month = monthIndex + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const todayIso = dashboard.todayIso;
    const tomorrowIso = dashboard.tomorrowIso;
    const monthLabel = dashboard.effectiveMonthLabel;

    let title = '';
    let subtitle = '';
    const queryParams: Record<string, any> = {
      sem_paginacao: true,
      minimized: true,
    };
    if (selectedCentroCustoId) {
      queryParams.centro_custo_id = selectedCentroCustoId;
    }

    if (metricKey === 'pagar_hoje') {
      title = 'Contas a pagar hoje';
      subtitle = `Lançamentos com vencimento hoje (${dashboard.now.toLocaleDateString('pt-BR')}).`;
      queryParams.tipo = 'DESPESA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = todayIso;
      queryParams.data_fim = todayIso;
    } else if (metricKey === 'pagar_amanha') {
      title = 'Contas a pagar amanhã';
      subtitle = 'Lançamentos com vencimento amanhã.';
      queryParams.tipo = 'DESPESA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = tomorrowIso;
      queryParams.data_fim = tomorrowIso;
    } else if (metricKey === 'pagar_atrasadas') {
      title = 'Contas a pagar atrasadas';
      subtitle = 'Lançamentos vencidos e ainda não pagos.';
      queryParams.tipo = 'DESPESA';
      queryParams.status = 'ATRASADO';
    } else if (metricKey === 'pagar_em_aberto') {
      title = 'Contas a pagar em aberto no mês';
      subtitle = `Lançamentos do mês ${monthLabel} ainda em aberto.`;
      queryParams.tipo = 'DESPESA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    } else if (metricKey === 'pagar_pagas_mes') {
      title = 'Pagas no mês';
      subtitle = `Lançamentos de pagamento quitados na competência ${monthLabel}.`;
      queryParams.tipo = 'DESPESA';
      queryParams.somente_pagos = true;
      queryParams.data_modo = 'pagamento';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    } else if (metricKey === 'pagar_mes') {
      title = 'Contas a pagar no mês';
      subtitle = `Competência em ${monthLabel}. Inclui pagos e em aberto.`;
      queryParams.tipo = 'DESPESA';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    } else if (metricKey === 'receber_hoje') {
      title = 'Contas a receber hoje';
      subtitle = `Lançamentos com vencimento hoje (${dashboard.now.toLocaleDateString('pt-BR')}).`;
      queryParams.tipo = 'RECEITA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = todayIso;
      queryParams.data_fim = todayIso;
    } else if (metricKey === 'receber_amanha') {
      title = 'Contas a receber amanhã';
      subtitle = 'Lançamentos com vencimento amanhã.';
      queryParams.tipo = 'RECEITA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = tomorrowIso;
      queryParams.data_fim = tomorrowIso;
    } else if (metricKey === 'receber_atrasadas') {
      title = 'Contas a receber atrasadas';
      subtitle = 'Lançamentos vencidos e ainda não recebidos.';
      queryParams.tipo = 'RECEITA';
      queryParams.status = 'ATRASADO';
    } else if (metricKey === 'receber_em_aberto') {
      title = 'Contas a receber em aberto no mês';
      subtitle = `Lançamentos do mês ${monthLabel} ainda em aberto.`;
      queryParams.tipo = 'RECEITA';
      queryParams.status = 'EM_ABERTO';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    } else if (metricKey === 'receber_recebidas_mes') {
      title = 'Recebidas no mês';
      subtitle = `Lançamentos de recebimento quitados na competência ${monthLabel}.`;
      queryParams.tipo = 'RECEITA';
      queryParams.somente_pagos = true;
      queryParams.data_modo = 'pagamento';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    } else if (metricKey === 'receber_mes') {
      title = 'Contas a receber no mês';
      subtitle = `Competência em ${monthLabel}. Inclui pagos e em aberto.`;
      queryParams.tipo = 'RECEITA';
      queryParams.data_inicio = firstDay;
      queryParams.data_fim = lastDay;
    }

    return { title, subtitle, queryParams };
  };

  const fetchRowsForMetric = async (metricKey: string): Promise<NormalizedRow[]> => {
    if (activeAuditMetricKey === metricKey && auditPanel?.mode === 'LANCAMENTOS' && (auditPanel.rows || []).length > 0) {
      return auditPanel.rows || [];
    }

    const { queryParams } = getMetricDetails(metricKey);
    const todayIso = dashboard.todayIso;
    const tomorrowIso = dashboard.tomorrowIso;

    const { data } = await api.get('/lancamentos/', { params: queryParams });
    const items: LancamentoResumo[] = normalizeListResponse<LancamentoResumo>(data);
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const contaMap = new Map(contas.map((item) => [item.id, item]));
    const catMap = new Map(categorias.map((item) => [item.id, item.nome]));

    const rows: NormalizedRow[] = items.map((item) => {
      const due = parseDateOnly(item.data_vencimento);
      const flowType: FlowFilter = isReceita(item.tipo) ? 'RECEBIMENTO' : 'PAGAMENTO';
      const statusKey = getStatusKey(item, todayIso, tomorrowIso);
      const hasPaidValue = item.valor_pago !== null && item.valor_pago !== undefined && Number(item.valor_pago) > 0;
      const baseValue = Number(statusKey === 'PAGO' && hasPaidValue ? item.valor_pago : item.valor_previsto ?? item.valor_pago ?? 0);
      const signedValue = flowType === 'RECEBIMENTO' ? baseValue : baseValue * -1;
      const rawId = Number(item.id);
      const safeId = Number.isFinite(rawId) ? rawId : -1;

      let bandeira: string | null = (item as any).bandeira || null;
      let tipoPagamento: string | null = item.tipo_pagamento || null;
      if (!tipoPagamento && item.observacao && item.observacao.trim().startsWith('{') && item.observacao.trim().endsWith('}')) {
        try {
          const meta = JSON.parse(item.observacao);
          tipoPagamento = meta.tipo_pagamento || meta.forma_pagamento || null;
          bandeira = bandeira || meta.bandeira || null;
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
        dataPagamento: item.data_pagamento,
        monthIndex: due ? due.getMonth() : -1,
        dayOfMonth: due ? due.getDate() : -1,
        valor: signedValue,
        valorAbsoluto: Math.abs(signedValue),
        interessado: resolveLancamentoInteressado(item, entityMap),
        contaId: item.conta_id,
        contaNome: resolveContaDisplayName(contaMap.get(Number(item.conta_id))),
        categoriaNome: item.plano_contas_id ? catMap.get(Number(item.plano_contas_id)) || null : null,
        centroCustoId: item.centro_custo_id,
        origem: item.origem,
        bandeira,
        tipoPagamento,
      };
    });

    if (queryParams.tipo === 'RECEITA') {
      const matchingAsaas = asaasRows.filter((item) => {
        if (queryParams.data_inicio && item.dataVencimento < queryParams.data_inicio) return false;
        if (queryParams.data_fim && item.dataVencimento > queryParams.data_fim) return false;
        if (queryParams.status === 'ATRASADO' && item.statusKey !== 'ATRASADO') return false;
        if (queryParams.status === 'EM_ABERTO' && item.statusKey !== 'EM_ABERTO') return false;
        return true;
      });
      rows.push(...matchingAsaas);
    }

    return rows;
  };

  const handleExportCell = async (format: 'xlsx' | 'pdf' | 'pdf_paginated') => {
    if (!cellContextMenu) return;
    setIsExportingCell(format);
    try {
      const rows = await fetchRowsForMetric(cellContextMenu.metricKey);
      const selectedCentro = centrosCusto.find((c) => c.id === selectedCentroCustoId);
      const exportOptions = {
        metricKey: cellContextMenu.metricKey,
        cellTitle: cellContextMenu.cellTitle,
        cellSubTitle: cellContextMenu.cellSubTitle,
        flowType: cellContextMenu.flowType,
        rows: rows.map((r) => ({
          id: r.id,
          dataVencimento: r.dataVencimento,
          dataPagamento: r.dataPagamento,
          interessado: r.interessado,
          descricao: r.descricao,
          categoriaNome: r.categoriaNome || null,
          contaNome: r.contaNome,
          valorAbsoluto: r.valorAbsoluto,
          statusLabel: r.statusLabel,
          flowType: r.flowType,
        })),
        companyName,
        companyCnpj: empresa?.cnpj || null,
        companyLogoUrl: companyLogo,
        userName: user?.nome || null,
        userEmail: user?.email || null,
        centroCustoNome: selectedCentro ? selectedCentro.nome : 'Todos os Centros de Custo',
        referenceDateIso: dashboard.todayIso,
        monthLabel: dashboard.effectiveMonthLabel,
      };

      if (format === 'xlsx') {
        await exportCellToExcel(exportOptions);
      } else {
        await exportCellToPdf({
          ...exportOptions,
          pageMode: format === 'pdf_paginated' ? 'paginated' : 'continuous',
        });
      }
      setCellContextMenu(null);
    } catch (err) {
      console.error('Erro ao exportar dados da célula:', err);
    } finally {
      setIsExportingCell(null);
    }
  };

  async function handleKpiAuditClick(metricKey: string) {
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
      return;
    }

    setActiveAuditMetricKey(metricKey);
    const { title, subtitle } = getMetricDetails(metricKey);
    setAuditPanel({ mode: 'LANCAMENTOS', title, subtitle, rows: [] });
    setAuditLoading(true);

    try {
      const rows = await fetchRowsForMetric(metricKey);
      setAuditPanel((curr) => curr ? { ...curr, rows } : null);
    } catch (err) {
      console.error('Erro ao carregar detalhes para auditoria:', err);
    } finally {
      setAuditLoading(false);
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

          {activeFilterTags.length > 0 ? (
            <div className={`mt-4 flex flex-wrap items-center gap-2 border-t pt-4 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
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
                },
                onContextMenu: undefined,
              },
              {
                label: 'A Pagar Atrasado',
                value: dashboard.pagar.atrasadas,
                icon: TrendingDown,
                color: dashboard.pagar.atrasadas > 0
                  ? 'text-rose-500 bg-rose-500/10 border-rose-500/20 dark:text-rose-450'
                  : 'text-slate-500 bg-slate-500/10 border-slate-500/20 dark:text-slate-400',
                onClick: () => handleKpiAuditClick('pagar_atrasadas'),
                onContextMenu: (e: ReactMouseEvent) => handleCellContextMenu(e, 'pagar_atrasadas', 'A Pagar Atrasado', undefined, 'PAGAR'),
                badge: dashboard.pagar.atrasadas > 0 ? 'Atenção' : null
              },
              {
                label: 'A Pagar Hoje',
                value: dashboard.pagar.hoje,
                icon: Clock,
                color: 'text-amber-500 bg-amber-500/10 border-amber-500/20 dark:text-amber-400',
                onClick: () => handleKpiAuditClick('pagar_hoje'),
                onContextMenu: (e: ReactMouseEvent) => handleCellContextMenu(e, 'pagar_hoje', 'A Pagar Hoje', formatDate(dashboard.todayIso), 'PAGAR'),
              },
              {
                label: 'A Receber Atrasado',
                value: dashboard.receber.atrasadas,
                icon: TrendingUp,
                color: dashboard.receber.atrasadas > 0
                  ? 'text-amber-500 bg-amber-500/10 border-amber-500/20 dark:text-amber-450'
                  : 'text-slate-500 bg-slate-500/10 border-slate-500/20 dark:text-slate-400',
                onClick: () => handleKpiAuditClick('receber_atrasadas'),
                onContextMenu: (e: ReactMouseEvent) => handleCellContextMenu(e, 'receber_atrasadas', 'A Receber Atrasado', undefined, 'RECEBER'),
              },
              {
                label: 'A Receber Hoje',
                value: dashboard.receber.hoje,
                icon: CalendarDays,
                color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400',
                onClick: () => handleKpiAuditClick('receber_hoje'),
                onContextMenu: (e: ReactMouseEvent) => handleCellContextMenu(e, 'receber_hoje', 'A Receber Hoje', formatDate(dashboard.todayIso), 'RECEBER'),
              },
              {
                label: 'Resultado Final (Caixa)',
                value: dashboard.resultadoFinalMes,
                icon: Activity,
                color: dashboard.resultadoFinalMes >= 0
                  ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400'
                  : 'text-rose-500 bg-rose-500/10 border-rose-500/20 dark:text-rose-450',
                onClick: () => handleKpiAuditClick('resultado_final'),
                onContextMenu: undefined,
              }
            ].map((badge) => {
              const Icon = badge.icon;
              return (
                <button
                  key={badge.label}
                  type="button"
                  onClick={badge.onClick}
                  onContextMenu={badge.onContextMenu}
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
                    <span className={`text-base font-black ${badge.label === 'Disponível' || badge.label.startsWith('Resultado Final') ? badge.value >= 0 ? 'text-slate-800 dark:text-white' : 'text-rose-500' : badge.color.split(' ')[0]}`}>
                      {badge.value >= 0 && badge.label.startsWith('Resultado Final') ? '+' : ''}{formatCurrency(badge.value)}
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
                        {auditLoading ? (
                          <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center text-sm font-semibold ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
                            <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
                            <span>Carregando lançamentos...</span>
                          </div>
                        ) : (
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
                        )}
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
                      onContextMenu={(e) => handleCellContextMenu(e, row.key, row.label, row.subLabel, 'PAGAR')}
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
                            <span className={getValueTone(Number(conta.saldo ?? 0), isDark)}>
                              {formatCurrency(Number(conta.saldo ?? 0))}
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
                        onContextMenu={(e) => handleCellContextMenu(e, 'receber_hoje', 'Para hoje', formatDate(dashboard.todayIso), 'RECEBER')}
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
                      onContextMenu={(e) => handleCellContextMenu(e, row.key, row.label, row.subLabel, 'RECEBER')}
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
                    <span>Resultados Financeiros (Regime de Caixa)</span>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {[
                    { key: 'receber_recebidas_mes', label: 'Receitas recebidas no mês (Caixa)', value: dashboard.receitasRealizadasMes, tone: 'text-emerald-600 dark:text-emerald-400' },
                    { key: 'receber_em_aberto', label: 'Receitas pendentes no mês', value: dashboard.receitasPendentesMes, tone: 'text-slate-500 dark:text-slate-400 font-medium' },
                    { key: 'pagar_pagas_mes', label: 'Despesas pagas no mês (Caixa)', value: dashboard.despesasRealizadasMes, tone: 'text-rose-600 dark:text-rose-400' },
                    { key: 'pagar_em_aberto', label: 'Despesas pendentes no mês', value: dashboard.despesasPendentesMes, tone: 'text-slate-500 dark:text-slate-400 font-medium' },
                    { key: 'resultado_operacional', label: 'Resultado operacional (Caixa)', value: dashboard.resultadoOperacionalMes, isResult: true },
                    { key: 'resultado_final', label: 'Resultado final (Caixa)', value: dashboard.resultadoFinalMes, isResult: true },
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

        {cellContextMenu && (
          <div
            className="fixed z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 min-w-[260px] animate-in fade-in-50 zoom-in-95 duration-100"
            style={{ top: cellContextMenu.y, left: cellContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
              <div className={`text-[10px] font-black uppercase tracking-wider ${cellContextMenu.flowType === 'PAGAR' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {cellContextMenu.flowType === 'PAGAR' ? 'Contas a Pagar' : 'Contas a Receber'}
              </div>
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                {cellContextMenu.cellTitle} {cellContextMenu.cellSubTitle ? `(${cellContextMenu.cellSubTitle})` : ''}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleExportCell('xlsx')}
              disabled={isExportingCell !== null}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{isExportingCell === 'xlsx' ? 'Gerando Planilha...' : 'Exportar em Excel (.xlsx)'}</span>
              </div>
              {isExportingCell === 'xlsx' && <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />}
            </button>

            <button
              type="button"
              onClick={() => void handleExportCell('pdf')}
              disabled={isExportingCell !== null}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-400 rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <div>
                  <div className="font-semibold">{isExportingCell === 'pdf' ? 'Gerando PDF...' : 'PDF Contínuo (Folha Única)'}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">Sem quebra de página • Inteiro</div>
                </div>
              </div>
              {isExportingCell === 'pdf' && <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />}
            </button>

            <button
              type="button"
              onClick={() => void handleExportCell('pdf_paginated')}
              disabled={isExportingCell !== null}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                <div>
                  <div>{isExportingCell === 'pdf_paginated' ? 'Gerando A4...' : 'PDF Paginado (A4 Dividido)'}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">Para impressão física em folhas A4</div>
                </div>
              </div>
              {isExportingCell === 'pdf_paginated' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />}
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
