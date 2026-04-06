import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  Landmark,
  Rows3,
  Sparkles,
} from 'lucide-react';

import { AsyncApexChart } from '../components/AsyncApexChart';
import { BankAvatar } from '../components/BrandAvatar';
import { Lancamentos } from './Lancamentos';
import { api, fetchLancamentosPaged, normalizeListResponse, toPublicAssetUrl } from '../services/api';
import { buildOperationalCategoriaIds } from '../utils/planoContas';

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

interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia?: string | null;
  competencia?: string | null;
  valor_previsto: number;
  valor_pago?: number | null;
  plano_contas_id?: number | null;
  conta_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
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

type ViewMode = 'executivo' | 'pay-receive';
type StatusFilter = 'TODOS' | 'PAGO' | 'EM_ABERTO' | 'ATRASADO' | 'HOJE' | 'AMANHA';
type FlowFilter = 'ALL' | 'PAGAMENTO' | 'RECEBIMENTO';

interface NormalizedRow {
  id: number;
  descricao: string;
  flowType: FlowFilter;
  statusKey: StatusFilter;
  statusLabel: string;
  dataVencimento: string;
  monthIndex: number;
  dayOfMonth: number;
  valor: number;
  valorAbsoluto: number;
  interessado: string;
  contaId?: number | null;
  contaNome: string;
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

const BOLETIM_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

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

function isReceita(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('R');
}

function isDespesa(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('D');
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

function isPago(status?: string | null) {
  return String(status || '').toUpperCase() === 'PAGO';
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

function SoftMetricGrid({
  title,
  accent,
  metrics,
  isDark,
  onMetricClick,
  activeMetric,
}: {
  title: string;
  accent: 'rose' | 'cyan';
  metrics: Array<{ key: string; label: string; value: number }>;
  isDark: boolean;
  onMetricClick?: (metricKey: string) => void;
  activeMetric?: string | null;
}) {
  const toneClass = accent === 'rose'
    ? isDark ? 'from-rose-500/18 via-rose-500/6 to-transparent border-rose-400/25' : 'from-rose-100 via-white to-white border-rose-200'
    : isDark ? 'from-sky-500/18 via-sky-500/6 to-transparent border-sky-400/25' : 'from-sky-100 via-white to-white border-sky-200';
  const titleClass = accent === 'rose' ? isDark ? 'text-rose-200' : 'text-rose-700' : isDark ? 'text-sky-200' : 'text-sky-700';
  const valueClass = accent === 'rose'
    ? isDark ? 'text-rose-300' : 'text-rose-600'
    : isDark ? 'text-emerald-300' : 'text-emerald-600';

  return (
    <section className={`rounded-xl border bg-linear-to-br px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${toneClass}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={`text-sm font-black uppercase tracking-[0.18em] ${titleClass}`}>{title}</h2>
        <div className={`h-2.5 w-2.5 rounded-full ${accent === 'rose' ? 'bg-rose-400' : 'bg-sky-400'}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const isActive = activeMetric === metric.key;
          return (
          <button
            key={metric.key}
            type="button"
            onClick={() => onMetricClick?.(metric.key)}
            className={`rounded-lg border px-4 py-4 text-left transition ${isActive ? isDark ? 'border-amber-300/55 bg-amber-300/12' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/85'} ${onMetricClick ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className={`text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{metric.label}</div>
            <div className={`mt-2 whitespace-nowrap text-2xl font-black tracking-tight ${valueClass}`}>{formatCurrency(metric.value)}</div>
          </button>
        );
        })}
      </div>
    </section>
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
  if (isPago(item.status)) return 'PAGO';
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

export function Boletim() {
  const navigate = useNavigate();

  const [inlineLancamentoParams, setInlineLancamentoParams] = useState<URLSearchParams | null>(null);

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
    const destino = buildLancamentosDestino(lancamentoId, false);
    if (event?.metaKey || event?.ctrlKey) {
      navigate(destino);
      return;
    }
    const destinoEmbed = buildLancamentosDestino(lancamentoId, true);
    const queryPart = destinoEmbed.split('?')[1] || '';
    setInlineLancamentoParams(new URLSearchParams(queryPart));
  };
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [categorias, setCategorias] = useState<PlanoContaResumo[]>([]);
  const [entidades, setEntidades] = useState<EntidadeResumo[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoResumo[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('executivo');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
  const [referenceDate, setReferenceDate] = useState(() => toIsoDate(new Date()));
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | 'ALL'>('ALL');
  const [auditPanel, setAuditPanel] = useState<AuditPanelState | null>(null);
  const [activeAuditMetricKey, setActiveAuditMetricKey] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPanelWidth, setAuditPanelWidth] = useState(420);
  const auditResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const initialLoadDoneRef = useRef(false);
  const referenceYear = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    return (parsedReference || new Date()).getFullYear();
  }, [referenceDate]);
  const isDark = useIsDarkMode();

  useEffect(() => {
    const initial = Math.round(window.innerWidth / 3);
    setAuditPanelWidth(Math.max(320, Math.min(Math.round(window.innerWidth * 0.7), initial)));
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = auditResizeRef.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      const maxWidth = Math.round(window.innerWidth * 0.7);
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
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function loadData() {
      const isInitialLoad = !initialLoadDoneRef.current;
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setLoadError(null);
      try {
        const yearStart = `${referenceYear}-01-01`;
        const yearEnd = `${referenceYear}-12-31`;

        const userRes = await api.get<UserInfo>('/usuarios/me');

        let empresaAtual: EmpresaInfo | null = null;
        if (userRes.data.empresa_id) {
          try {
            const empresaRes = await api.get<EmpresaInfo>(`/empresas/${userRes.data.empresa_id}`);
            empresaAtual = empresaRes.data;
          } catch {
            empresaAtual = null;
          }
        }

        if (!empresaAtual && userRes.data.is_consultor) {
          const contextoRes = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
          empresaAtual = contextoRes.data.empresa_atual;
        }

        const [contasRes, lancamentosRes, categoriasRes, entidadesRes, centrosCustoRes] = await Promise.allSettled([
          api.get<ContaResumo[]>('/contas/'),
          fetchLancamentosPaged<LancamentoResumo>({ data_inicio: yearStart, data_fim: yearEnd, include_anexos: false }, { pageSize: 1500 }),
          api.get<PlanoContaResumo[]>('/plano-contas/'),
          api.get<EntidadeResumo[]>('/entidades/'),
          api.get<CentroCustoResumo[]>('/centro-custo/'),
        ]);

        if (!active) return;

        setEmpresa(empresaAtual);
        setContas(contasRes.status === 'fulfilled' ? normalizeListResponse<ContaResumo>(contasRes.value.data) : []);
        setLancamentos(lancamentosRes.status === 'fulfilled' ? (Array.isArray(lancamentosRes.value) ? lancamentosRes.value : []) : []);
        setCategorias(categoriasRes.status === 'fulfilled' ? normalizeListResponse<PlanoContaResumo>(categoriasRes.value.data) : []);
        setEntidades(entidadesRes.status === 'fulfilled' ? normalizeListResponse<EntidadeResumo>(entidadesRes.value.data) : []);
        setCentrosCusto(centrosCustoRes.status === 'fulfilled' ? normalizeListResponse<CentroCustoResumo>(centrosCustoRes.value.data) : []);

        const failures = [contasRes, lancamentosRes, categoriasRes, entidadesRes, centrosCustoRes].filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
          setLoadError('Parte dos dados do boletim nao pôde ser carregada. A tela continuou com o que estava disponível.');
        }
      } catch (error) {
        console.error('Erro ao carregar boletim', error);
        if (active) {
          setLoadError('Nao foi possivel carregar o boletim financeiro.');
        }
      } finally {
        if (active) {
          setLoading(false);
          setIsRefreshing(false);
          initialLoadDoneRef.current = true;
        }
      }
    }

    loadData();
    intervalId = setInterval(() => {
      void loadData();
    }, BOLETIM_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [referenceYear]);

  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : new Date();
    const currentYear = now.getFullYear();
    const fallbackMonthIndex = now.getMonth();
    const todayIso = toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const effectiveMonthIndex = selectedMonthIndex ?? fallbackMonthIndex;
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const contaMap = new Map(contas.map((item) => [item.id, item]));
    const contasFiltradasPorCentro = contas.filter((conta) => selectedCentroCustoId === 'ALL' || Number(conta.centro_custo_id) === selectedCentroCustoId);
    const bankBalances = contasFiltradasPorCentro
      .filter((conta) => String(conta.status || 'ATIVO').toUpperCase() !== 'INATIVO')
      .map((conta) => ({ ...conta, saldo: Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0) }))
      .sort((left, right) => right.saldo - left.saldo);
    const saldoDisponivel = bankBalances
      .filter((conta) => conta.conta_como_disponibilidade !== false)
      .reduce((acc, conta) => acc + conta.saldo, 0);

    const baseRows = lancamentos
      .filter((item) => selectedCentroCustoId === 'ALL' || Number(item.centro_custo_id) === selectedCentroCustoId)
      .map((item) => {
        const due = parseDateOnly(item.data_vencimento);
        const flowType: FlowFilter = isReceita(item.tipo) ? 'RECEBIMENTO' : 'PAGAMENTO';
        const statusKey = getStatusKey(item, todayIso, tomorrowIso);
        const hasPaidValue = item.valor_pago !== null && item.valor_pago !== undefined && Number(item.valor_pago) > 0;
        const baseValue = Number(statusKey === 'PAGO' && hasPaidValue ? item.valor_pago : item.valor_previsto ?? item.valor_pago ?? 0);
        const signedValue = flowType === 'RECEBIMENTO' ? baseValue : baseValue * -1;
        return {
          id: item.id,
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
        } satisfies NormalizedRow;
      })
      .filter((item) => item.monthIndex >= 0 && item.dayOfMonth >= 0);

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

    const relevantes = categorias.filter((conta) => isReceita(conta.tipo) || isDespesa(conta.tipo));
    const contaPorId = new Map<number, PlanoContaResumo>();
    relevantes.forEach((conta) => contaPorId.set(conta.id, conta));
    const categoriasOperacionais = buildOperationalCategoriaIds(relevantes);

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
      const conta = contaPorId.get(contaId);
      const grupoNormalizado = String(conta?.dre_grupo || '').trim().toUpperCase();
      if (grupoNormalizado) return grupoNormalizado;
      if (conta && isReceita(conta.tipo)) return 'RECEITA_BRUTA';
      return classificarHeuristicaLegada(contaId);
    };

    const receitaMonthly = Array.from({ length: 12 }, () => 0);
    const deducoesMonthly = Array.from({ length: 12 }, () => 0);
    const custosVariaveisMonthly = Array.from({ length: 12 }, () => 0);
    const despesaOperacionalCoreMonthly = Array.from({ length: 12 }, () => 0);
    const outrasReceitasMonthly = Array.from({ length: 12 }, () => 0);
    const outrasDespesasMonthly = Array.from({ length: 12 }, () => 0);

    lancamentos
      .filter((item) => selectedCentroCustoId === 'ALL' || Number(item.centro_custo_id) === selectedCentroCustoId)
      .forEach((lancamento) => {
        const contaId = Number(lancamento.plano_contas_id);
        if (!contaPorId.has(contaId)) return;
        const monthIndex = resolveMonthIndex(lancamento, true);
        if (monthIndex < 0) return;
        const conta = contaPorId.get(contaId);
        if (!conta) return;
        const dreGrupo = resolverDreGrupo(contaId);
        if (dreGrupo === 'NAO_OPERACIONAL') return;
        const value = resolveLancamentoValue(lancamento, true);

        if (isReceita(conta.tipo)) {
          if (dreGrupo === 'OUTRAS_RECEITAS') outrasReceitasMonthly[monthIndex] += value;
          else receitaMonthly[monthIndex] += value;
        }

        if (isDespesa(conta.tipo)) {
          if (dreGrupo === 'DEDUCOES_RECEITA') deducoesMonthly[monthIndex] += value;
          else if (dreGrupo === 'CUSTOS_VARIAVEIS') custosVariaveisMonthly[monthIndex] += value;
          else if (dreGrupo === 'OUTRAS_DESPESAS') outrasDespesasMonthly[monthIndex] += value;
          else if (categoriasOperacionais.has(contaId)) despesaOperacionalCoreMonthly[monthIndex] += value;
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

    const tableRows = [...activeRows].sort((left, right) => {
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
    };
  }, [categorias, contas, entidades, lancamentos, selectedCentroCustoId, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter, referenceDate]);

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
    if (selectedCentroCustoId !== 'ALL') {
      const centro = centrosCusto.find((item) => item.id === selectedCentroCustoId);
      tags.push({ key: 'cc', label: `Centro: ${centro?.nome || 'Selecionado'}`, onClear: () => setSelectedCentroCustoId('ALL') });
    }
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
  }, [centrosCusto, dashboard.effectiveMonthIndex, dashboard.monthLabels, flowFilter, selectedCentroCustoId, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

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
    const dimStrength = isDark ? 0.45 : 0.4;
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.16)';
    const cardStrokeColor = isDark ? '#081124' : '#ffffff';
    const chartTheme = isDark ? 'dark' : 'light';
    const effectiveMonth = selectedMonthIndex ?? dashboard.fallbackMonthIndex;

    const darkenHexColor = (hexColor: string, intensity: number) => {
      const clean = String(hexColor || '').trim().replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hexColor;

      const factor = Math.max(0, Math.min(1, 1 - intensity));
      const toChannel = (start: number) => Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(start, start + 2), 16) * factor)));
      const r = toChannel(0).toString(16).padStart(2, '0');
      const g = toChannel(2).toString(16).padStart(2, '0');
      const b = toChannel(4).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    };

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
      shouldDimFlow('PAGAMENTO') ? darkenHexColor(pagamentoColor, dimStrength) : pagamentoColor,
      shouldDimFlow('RECEBIMENTO') ? darkenHexColor(recebimentoColor, dimStrength) : recebimentoColor,
    ];

    const monthlySeries = [
      {
        name: 'Pagamento',
        data: monthlyPagamento.map((value, monthIndex) => {
          const shouldDim = shouldDimFlow('PAGAMENTO') || (selectedMonthIndex !== null && selectedMonthIndex !== monthIndex);
          return {
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: shouldDim ? darkenHexColor(resolveFlowColor('PAGAMENTO'), dimStrength) : resolveFlowColor('PAGAMENTO'),
          };
        }),
      },
      {
        name: 'Recebimento',
        data: monthlyRecebimento.map((value, monthIndex) => {
          const shouldDim = shouldDimFlow('RECEBIMENTO') || (selectedMonthIndex !== null && selectedMonthIndex !== monthIndex);
          return {
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: shouldDim ? darkenHexColor(resolveFlowColor('RECEBIMENTO'), dimStrength) : resolveFlowColor('RECEBIMENTO'),
          };
        }),
      },
    ];

    const dailySeries = [
      {
        name: 'Pagamento',
        data: dailyPagamento.map((value, dayIndex) => {
          const day = dayIndex + 1;
          const shouldDim = shouldDimFlow('PAGAMENTO') || (selectedDayOfMonth !== null && selectedDayOfMonth !== day);
          return {
            x: String(day),
            y: value,
            fillColor: shouldDim ? darkenHexColor(resolveFlowColor('PAGAMENTO'), dimStrength) : resolveFlowColor('PAGAMENTO'),
          };
        }),
      },
      {
        name: 'Recebimento',
        data: dailyRecebimento.map((value, dayIndex) => {
          const day = dayIndex + 1;
          const shouldDim = shouldDimFlow('RECEBIMENTO') || (selectedDayOfMonth !== null && selectedDayOfMonth !== day);
          return {
            x: String(day),
            y: value,
            fillColor: shouldDim ? darkenHexColor(resolveFlowColor('RECEBIMENTO'), dimStrength) : resolveFlowColor('RECEBIMENTO'),
          };
        }),
      },
    ];

    const resolveFlowBySeriesIndex = (seriesIndex: number): FlowFilter | null => {
      if (seriesIndex === 0) return 'PAGAMENTO';
      if (seriesIndex === 1) return 'RECEBIMENTO';
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
              show: true,
              total: {
                show: true,
                label: 'Total',
                formatter: () => formatCurrency(flowTotals.pagamento + flowTotals.recebimento),
              },
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
            const monthIndex = Number(config?.dataPointIndex);
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
            const dayIndex = Number(config?.dataPointIndex);
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

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  if (loading && !initialLoadDoneRef.current) {
    return <div className="p-10 text-center text-slate-400">Carregando boletim...</div>;
  }

  const pageClass = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_28%),linear-gradient(180deg,#020617_0%,#081224_45%,#0b1324_100%)] text-white'
    : 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_22%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-900';
  const shellClass = isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/88';
  const tableShellClass = isDark ? 'border-[#f2c94c]/20 bg-black/45' : 'border-amber-200 bg-white/95';
  const auditPanelShellClass = isDark ? 'border-amber-300/35 bg-slate-950 text-white' : 'border-amber-300 bg-white text-slate-900';

  return (
    <div className={`min-h-full ${pageClass}`}>
      <div className="mx-auto w-full space-y-5">
        <header className={`overflow-hidden rounded-none border px-4 py-4 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.95)] ${shellClass}`}>
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
              <div className={`inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-2 ${isDark ? 'border-white/12 bg-white/5 text-white/70' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <CalendarDays className="h-4 w-4" />
                <span className="text-[11px] font-black uppercase tracking-[0.14em]">Data</span>
                <input
                  type="date"
                  value={referenceDate}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setReferenceDate(event.target.value);
                    setSelectedMonthIndex(null);
                    setSelectedDayOfMonth(null);
                  }}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none transition ${isDark ? 'border-white/15 bg-slate-950/50 text-white [color-scheme:dark] focus:border-amber-300/60' : 'border-slate-300 bg-white text-slate-700 focus:border-blue-500'}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const todayIso = toIsoDate(new Date());
                    setReferenceDate(todayIso);
                    setSelectedMonthIndex(null);
                    setSelectedDayOfMonth(null);
                  }}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${isDark ? 'bg-white/10 text-white/80 hover:bg-white/16 hover:text-white' : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                >
                  Hoje
                </button>
                {isRefreshing ? (
                  <span className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-amber-200' : 'text-blue-600'}`}>
                    Atualizando
                  </span>
                ) : null}
              </div>
              <select
                value={selectedCentroCustoId === 'ALL' ? 'ALL' : String(selectedCentroCustoId)}
                onChange={(event) => setSelectedCentroCustoId(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white md:w-72"
              >
                <option value="ALL">Todos os centros de custo</option>
                {centrosCusto.map((centro) => (
                  <option key={centro.id} value={centro.id}>
                    {centro.codigo ? `${centro.codigo} - ` : ''}{centro.nome}
                  </option>
                ))}
              </select>
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
                  setSelectedCentroCustoId('ALL');
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

        {viewMode === 'executivo' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_420px] xl:items-start">
            {auditPanel ? (
              <div className="fixed inset-0 z-50">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-950/55"
                  onClick={() => { setAuditPanel(null); setActiveAuditMetricKey(null); }}
                  aria-label="Fechar auditoria"
                />
                <aside
                  className={`absolute left-0 top-0 z-10 flex h-full flex-col rounded-r-[28px] border-r px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${auditPanelShellClass}`}
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
                          <thead className={isDark ? 'bg-white/5 text-white/60' : 'bg-slate-50 text-slate-500'}>
                            <tr>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                              <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Interessado</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                              <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(auditPanel.rows || []).length === 0 ? (
                              <tr>
                                <td colSpan={5} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Sem itens para esse recorte.</td>
                              </tr>
                            ) : (auditPanel.rows || []).map((row) => (
                              <tr
                                key={`audit-row-${row.id}`}
                                onClick={(event) => openLancamentoEdicao(row.id, event)}
                                className={`${isDark ? 'border-t border-white/8 text-white hover:bg-white/5' : 'border-t border-slate-100 text-slate-800 hover:bg-slate-50'} cursor-pointer transition`}
                                title="Abrir edição do lançamento"
                              >
                                <td className="px-3 py-2.5 font-medium whitespace-nowrap">{formatDate(row.dataVencimento)}</td>
                                <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(row.valor, isDark)}`}>{formatCurrencyDetailed(row.valor)}</td>
                                <td className="px-3 py-2.5">{row.interessado}</td>
                                <td className="max-w-56 truncate px-3 py-2.5" title={row.descricao}>{row.descricao}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${row.statusKey === 'PAGO' ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700' : row.statusKey === 'ATRASADO' ? isDark ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700' : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                    {row.statusLabel}
                                  </span>
                                </td>
                              </tr>
                            ))}
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
                            <thead className={isDark ? 'bg-white/5 text-white/60' : 'bg-slate-50 text-slate-500'}>
                              <tr>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data</th>
                                <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Movimento</th>
                                <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {auditPanel.extrato.movimentos.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Sem movimentos para este banco.</td>
                                </tr>
                              ) : auditPanel.extrato.movimentos.map((movimento) => {
                                const signed = Number(movimento.valor_entrada || 0) > 0 ? Number(movimento.valor_entrada || 0) : Number(movimento.valor_saida || 0) > 0 ? -Number(movimento.valor_saida || 0) : 0;
                                return (
                                  <tr key={`extrato-${movimento.id}`} className={isDark ? 'border-t border-white/8 text-white' : 'border-t border-slate-100 text-slate-800'}>
                                    <td className="px-3 py-2.5">{formatDate(movimento.data_pagamento || movimento.data_vencimento)}</td>
                                    <td className="max-w-50 truncate px-3 py-2.5" title={movimento.descricao}>{movimento.descricao}</td>
                                    <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(signed, isDark)}`}>{formatCurrencyDetailed(signed)}</td>
                                    <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${getValueTone(Number(movimento.saldo_apos_movimento || 0), isDark)}`}>{formatCurrencyDetailed(Number(movimento.saldo_apos_movimento || 0))}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : null}
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            ) : null}

            {inlineLancamentoParams ? (
              <div className="fixed inset-0 z-[60]">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-950/60"
                  onClick={() => setInlineLancamentoParams(null)}
                  aria-label="Fechar editor"
                />
                <aside className="absolute right-0 top-0 h-full w-[clamp(420px,34vw,640px)] max-w-[100vw] border-l border-slate-200 bg-white shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] dark:border-slate-700 dark:bg-slate-950">
                  <div className="h-full w-full overflow-hidden">
                    <Lancamentos
                      key={inlineLancamentoParams.toString()}
                      forcedSearchParams={inlineLancamentoParams}
                      onRequestCloseEmbed={() => setInlineLancamentoParams(null)}
                    />
                  </div>
                </aside>
              </div>
            ) : null}

            <div className="grid gap-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <SoftMetricGrid
                  title="Contas a pagar"
                  accent="rose"
                  isDark={isDark}
                  activeMetric={activeAuditMetricKey?.startsWith('pagar') ? activeAuditMetricKey : null}
                  onMetricClick={handleKpiAuditClick}
                  metrics={[
                    { key: 'pagar_hoje', label: 'Para hoje', value: dashboard.pagar.hoje },
                    { key: 'pagar_amanha', label: 'Para amanhã', value: dashboard.pagar.amanha },
                    { key: 'pagar_atrasadas', label: 'Atrasadas', value: dashboard.pagar.atrasadas },
                    { key: 'pagar_em_aberto', label: 'Em aberto no mês', value: dashboard.pagar.emAberto },
                    { key: 'pagar_mes', label: 'Do mês', value: dashboard.pagarNoMes },
                    { key: 'pagar_pagas_mes', label: 'Pagas no mês', value: dashboard.pagarPagasNoMes },
                  ]}
                />

                <SoftMetricGrid
                  title="Contas a receber"
                  accent="cyan"
                  isDark={isDark}
                  activeMetric={activeAuditMetricKey?.startsWith('receber') ? activeAuditMetricKey : null}
                  onMetricClick={handleKpiAuditClick}
                  metrics={[
                    { key: 'receber_hoje', label: 'Para hoje', value: dashboard.receber.hoje },
                    { key: 'receber_amanha', label: 'Para amanhã', value: dashboard.receber.amanha },
                    { key: 'receber_atrasadas', label: 'Atrasadas', value: dashboard.receber.atrasadas },
                    { key: 'receber_em_aberto', label: 'Em aberto no mês', value: dashboard.receber.emAberto },
                    { key: 'receber_mes', label: 'Do mês', value: dashboard.receberNoMes },
                    { key: 'receber_recebidas_mes', label: 'Recebidas no mês', value: dashboard.receberRecebidasNoMes },
                  ]}
                />
              </div>

              <section className={`rounded-[28px] border px-5 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${shellClass}`}>
                <div className={`mb-3 border-b pb-2 text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'border-white/10 text-white/75' : 'border-slate-200 text-slate-700'}`}>
                  Resultado do mês
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { key: 'resultado_operacional', label: 'Resultado operacional', value: dashboard.resultadoOperacionalMes },
                    { key: 'resultado_final', label: 'Resultado final', value: dashboard.resultadoFinalMes },
                  ].map((metric) => {
                    const isActive = activeAuditMetricKey === metric.key;
                    return (
                      <button
                        key={metric.key}
                        type="button"
                        onClick={() => handleKpiAuditClick(metric.key)}
                        className={`rounded-2xl border px-4 py-4 text-left transition hover:-translate-y-0.5 ${isActive ? isDark ? 'border-amber-300/55 bg-amber-300/12' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/85'}`}
                      >
                        <div className={`text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{metric.label}</div>
                        <div className={`mt-2 whitespace-nowrap text-2xl font-black tracking-tight ${getValueTone(metric.value, isDark)}`}>{formatCurrency(metric.value)}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

            </div>

            <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${shellClass}`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Bancos</div>
                </div>
                <Landmark className={`h-5 w-5 ${isDark ? 'text-amber-200' : 'text-amber-700'}`} />
              </div>

              <div className={`mb-4 rounded-2xl border px-4 py-4 ${isDark ? 'border-amber-300/30 bg-amber-400/10' : 'border-amber-200 bg-amber-50'}`}>
                <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Saldo disponível</div>
                <div className={`mt-2 whitespace-nowrap text-3xl font-black tracking-tight ${getValueTone(dashboard.saldoDisponivel, isDark)}`}>{formatCurrency(dashboard.saldoDisponivel)}</div>
              </div>

              <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <table className="w-full text-left text-sm">
                  <thead className={isDark ? 'bg-white/5 text-white/60' : 'bg-slate-50 text-slate-500'}>
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em]">Banco</th>
                      <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.banks.length === 0 ? (
                      <tr>
                        <td colSpan={2} className={`px-4 py-10 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>
                          Nenhum banco ativo para exibir.
                        </td>
                      </tr>
                    ) : dashboard.banks.slice(0, 6).map((conta) => {
                      const logo = getFullLogoUrl(conta.logo_url || null);
                      const foraDoDisponivel = conta.conta_como_disponibilidade === false;
                      const activeBank = auditPanel?.mode === 'EXTRATO_BANCO' && auditPanel.conta?.id === conta.id;
                      const contaDisplayName = resolveContaDisplayName(conta);
                      return (
                        <tr key={conta.id} className={foraDoDisponivel ? isDark ? 'border-t border-amber-300/12 bg-amber-300/5 text-white' : 'border-t border-amber-100 bg-amber-50/60 text-slate-800' : isDark ? 'border-t border-white/8 text-white' : 'border-t border-slate-100 text-slate-800'}>
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => handleBankAuditClick(conta)} className={`flex w-full items-center gap-2 rounded-xl px-1 py-1 text-left transition ${activeBank ? isDark ? 'bg-amber-300/12' : 'bg-amber-100/70' : ''}`}>
                              <div className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl ${logo ? '' : isDark ? 'bg-white/8 text-white/55' : 'bg-slate-100 text-slate-400'}`}>
                                {logo ? (
                                  <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={contaDisplayName} integrationType={conta.tipo} size="sm" className="h-9 w-9" imageClassName="rounded-2xl" fallbackClassName="rounded-2xl border-0 shadow-none" />
                                ) : (
                                  <Landmark className="h-4 w-4" />
                                )}
                              </div>
                              <div>
                                <div>{contaDisplayName}</div>
                                {foraDoDisponivel ? (
                                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Nao soma no saldo disponivel</div>
                                ) : null}
                              </div>
                            </button>
                          </td>
                          <td className={`px-4 py-3 text-right font-semibold ${getValueTone(Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0), isDark)} whitespace-nowrap`}>{formatCurrency(Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

          </section>
        ) : (
          <section className="space-y-5">
            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1180px] gap-4 xl:grid-cols-[230px_minmax(0,1fr)_minmax(0,1fr)]">
                <section className={`rounded-[24px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
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

                <section className={`rounded-[24px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
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

                <section className={`rounded-[24px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A pagar vs receber por dia (vcto)</div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{payReceiveCharts.effectiveMonthLabel}</div>
                  </div>
                  <AsyncApexChart type="bar" height={235} series={payReceiveCharts.dailySeries} options={payReceiveCharts.dailyOptions} />
                </section>
              </div>
            </div>

            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1180px] gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Indicadores</div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Grade rolável para não estourar a tela.</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <FilterPill active={statusFilter === 'TODOS'} label="Todos" onClick={() => setStatusFilter('TODOS')} isDark={isDark} />
                      <FilterPill active={statusFilter === 'PAGO'} label="Pago" onClick={() => setStatusFilter('PAGO')} isDark={isDark} />
                      <FilterPill active={statusFilter === 'EM_ABERTO'} label="Em aberto" onClick={() => setStatusFilter('EM_ABERTO')} isDark={isDark} />
                      <FilterPill active={statusFilter === 'ATRASADO'} label="Atrasado" onClick={() => setStatusFilter('ATRASADO')} isDark={isDark} />
                      <FilterPill active={statusFilter === 'AMANHA'} label="Vcto amanha" onClick={() => setStatusFilter('AMANHA')} isDark={isDark} />
                      <FilterPill active={statusFilter === 'HOJE'} label="Vcto hoje" onClick={() => setStatusFilter('HOJE')} isDark={isDark} />
                    </div>
                  </div>

                  <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                    <div className="max-h-[62vh] overflow-auto custom-scrollbar">
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
                          ) : dashboard.tableRows.map((row) => (
                            <tr key={row.id} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/4' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                              <td className="px-4 py-2.5 font-medium">{formatDate(row.dataVencimento)}</td>
                              <td className="px-4 py-2.5 font-semibold">{row.interessado}</td>
                              <td className="max-w-85 truncate px-4 py-2.5" title={row.descricao}>{row.descricao}</td>
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
                          <tr className={isDark ? 'border-t border-white/10 bg-black/25 text-white' : 'border-t border-slate-200 bg-slate-50 text-slate-900'}>
                            <td colSpan={5} className="px-4 py-3 text-right font-black uppercase tracking-[0.14em]">Total geral</td>
                            <td className={`px-4 py-3 text-right font-black whitespace-nowrap ${getValueTone(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0), isDark)}`}>{formatCurrency(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section className={`rounded-[28px] border px-4 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
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
        )}
      </div>
    </div>
  );
}
