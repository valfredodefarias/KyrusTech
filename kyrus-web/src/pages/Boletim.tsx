import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  Landmark,
  PieChart,
  Rows3,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { AsyncApexChart } from '../components/AsyncApexChart';
import { BankAvatar } from '../components/BrandAvatar';
import { api, toPublicAssetUrl } from '../services/api';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
  logo_url?: string | null;
  tipo: string;
  saldo_inicial: number;
  saldo_atual?: number;
}

interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  data_vencimento: string;
  data_pagamento?: string | null;
  valor_previsto: number;
  valor_pago?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
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
  dataVencimento: string;
  monthIndex: number;
  dayOfMonth: number;
  valor: number;
  valorAbsoluto: number;
  interessado: string;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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

function isReceita(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('R');
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
    { id: 'pay-receive', label: 'A Pagar e a Receber', icon: Rows3 },
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
}: {
  title: string;
  accent: 'rose' | 'cyan';
  metrics: Array<{ label: string; value: number }>;
  isDark: boolean;
}) {
  const toneClass = accent === 'rose'
    ? isDark ? 'from-rose-500/18 via-rose-500/6 to-transparent border-rose-400/25' : 'from-rose-100 via-white to-white border-rose-200'
    : isDark ? 'from-sky-500/18 via-sky-500/6 to-transparent border-sky-400/25' : 'from-sky-100 via-white to-white border-sky-200';
  const titleClass = accent === 'rose' ? isDark ? 'text-rose-200' : 'text-rose-700' : isDark ? 'text-sky-200' : 'text-sky-700';

  return (
    <section className={`rounded-[28px] border bg-gradient-to-br px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${toneClass}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className={`text-sm font-black uppercase tracking-[0.18em] ${titleClass}`}>{title}</h2>
        <div className={`h-2.5 w-2.5 rounded-full ${accent === 'rose' ? 'bg-rose-400' : 'bg-sky-400'}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className={`rounded-2xl border px-4 py-4 transition hover:-translate-y-0.5 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/85'}`}>
            <div className={`text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{metric.label}</div>
            <div className={`mt-2 text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(metric.value)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultCard({ label, value, emphasis, isDark }: { label: string; value: number; emphasis?: boolean; isDark: boolean }) {
  return (
    <div className={`rounded-2xl border px-4 py-4 transition hover:-translate-y-0.5 ${emphasis ? isDark ? 'border-amber-300/30 bg-amber-400/10' : 'border-amber-200 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/85'}`}>
      <div className={`text-[11px] font-black uppercase tracking-[0.16em] ${emphasis ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/55' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-2 text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(value)}</div>
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
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [entidades, setEntidades] = useState<EntidadeResumo[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoResumo[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('executivo');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | 'ALL'>('ALL');
  const isDark = useIsDarkMode();

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      try {
        const today = new Date();
        const yearStart = `${today.getFullYear()}-01-01`;
        const yearEnd = `${today.getFullYear()}-12-31`;

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

        const [contasRes, lancamentosRes, entidadesRes, centrosCustoRes] = await Promise.all([
          api.get<ContaResumo[]>('/contas/'),
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 10000, data_inicio: yearStart, data_fim: yearEnd } }),
          api.get<EntidadeResumo[]>('/entidades/'),
          api.get<CentroCustoResumo[]>('/centro-custo/'),
        ]);

        if (!active) return;

        setEmpresa(empresaAtual);
        setContas(contasRes.data || []);
        setLancamentos(lancamentosRes.data || []);
        setEntidades(entidadesRes.data || []);
        setCentrosCusto(centrosCustoRes.data || []);
      } catch (error) {
        console.error('Erro ao carregar boletim', error);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();
    return () => {
      active = false;
    };
  }, []);

  const dashboard = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fallbackMonthIndex = now.getMonth();
    const todayIso = toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const effectiveMonthIndex = selectedMonthIndex ?? fallbackMonthIndex;
    const daysInEffectiveMonth = new Date(currentYear, effectiveMonthIndex + 1, 0).getDate();
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const bankBalances = contas
      .map((conta) => ({ ...conta, saldo: Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0) }))
      .sort((left, right) => right.saldo - left.saldo);

    const baseRows = lancamentos
      .filter((item) => selectedCentroCustoId === 'ALL' || Number(item.centro_custo_id) === selectedCentroCustoId)
      .map((item) => {
        const due = parseDateOnly(item.data_vencimento);
        const flowType: FlowFilter = isReceita(item.tipo) ? 'RECEBIMENTO' : 'PAGAMENTO';
        const baseValue = Number(item.valor_pago ?? item.valor_previsto ?? 0);
        const signedValue = flowType === 'RECEBIMENTO' ? baseValue : baseValue * -1;
        return {
          id: item.id,
          descricao: item.descricao,
          flowType,
          statusKey: getStatusKey(item, todayIso, tomorrowIso),
          dataVencimento: item.data_vencimento,
          monthIndex: due ? due.getMonth() : -1,
          dayOfMonth: due ? due.getDate() : -1,
          valor: signedValue,
          valorAbsoluto: Math.abs(signedValue),
          interessado: entityMap.get(Number(item.entidade_id)) || 'Sem interessado',
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

    const payables = activeRows.filter((item) => item.flowType === 'PAGAMENTO');
    const receivables = activeRows.filter((item) => item.flowType === 'RECEBIMENTO');
    const sumValues = (rows: NormalizedRow[]) => rows.reduce((acc, item) => acc + item.valorAbsoluto, 0);

    const pagar = {
      hoje: sumValues(payables.filter((item) => item.statusKey === 'HOJE')),
      amanha: sumValues(payables.filter((item) => item.statusKey === 'AMANHA')),
      atrasadas: sumValues(payables.filter((item) => item.statusKey === 'ATRASADO')),
      totalMes: sumValues(payables.filter((item) => item.monthIndex === effectiveMonthIndex)),
      realizadas: sumValues(payables.filter((item) => item.statusKey === 'PAGO')),
      emAberto: sumValues(payables.filter((item) => item.statusKey !== 'PAGO')),
    };

    const receber = {
      hoje: sumValues(receivables.filter((item) => item.statusKey === 'HOJE')),
      amanha: sumValues(receivables.filter((item) => item.statusKey === 'AMANHA')),
      atrasadas: sumValues(receivables.filter((item) => item.statusKey === 'ATRASADO')),
      totalMes: sumValues(receivables.filter((item) => item.monthIndex === effectiveMonthIndex)),
      realizadas: sumValues(receivables.filter((item) => item.statusKey === 'PAGO')),
      emAberto: sumValues(receivables.filter((item) => item.statusKey !== 'PAGO')),
    };

    const monthlyRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    }, { ignoreMonth: true, ignoreDay: true });

    const monthlyPagar = Array.from({ length: 12 }, () => 0);
    const monthlyReceber = Array.from({ length: 12 }, () => 0);
    monthlyRows.forEach((item) => {
      if (item.flowType === 'PAGAMENTO') monthlyPagar[item.monthIndex] += item.valorAbsoluto;
      else monthlyReceber[item.monthIndex] += item.valorAbsoluto;
    });

    const dailyRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    }, { ignoreMonth: true, ignoreDay: true }).filter((item) => item.monthIndex === effectiveMonthIndex);

    const dailyPagar = Array.from({ length: daysInEffectiveMonth }, () => 0);
    const dailyReceber = Array.from({ length: daysInEffectiveMonth }, () => 0);
    dailyRows.forEach((item) => {
      if (item.flowType === 'PAGAMENTO') dailyPagar[item.dayOfMonth - 1] += item.valorAbsoluto;
      else dailyReceber[item.dayOfMonth - 1] += item.valorAbsoluto;
    });

    const donutRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    }, { ignoreFlow: true });

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
      dayLabels: Array.from({ length: daysInEffectiveMonth }, (_, index) => String(index + 1)),
      monthLabels: MONTH_NAMES.map((label) => `${label}/${String(currentYear).slice(2)}`),
      banks: bankBalances,
      saldoBancario: bankBalances.reduce((acc, conta) => acc + conta.saldo, 0),
      operacional: receber.totalMes - pagar.totalMes,
      final: receber.realizadas - pagar.realizadas,
      endividamento: pagar.emAberto,
      aReceberAberto: receber.emAberto,
      pagar,
      receber,
      tableRows,
      monthlyPagar,
      monthlyReceber,
      dailyPagar,
      dailyReceber,
      donutSeries: [
        sumValues(donutRows.filter((item) => item.flowType === 'PAGAMENTO')),
        sumValues(donutRows.filter((item) => item.flowType === 'RECEBIMENTO')),
      ],
      situacao,
    };
  }, [contas, entidades, lancamentos, selectedCentroCustoId, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

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

  const monthlyChartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      foreColor: isDark ? '#cbd5e1' : '#475569',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      events: {
        dataPointSelection: (_: unknown, __: unknown, opts: { seriesIndex?: number; dataPointIndex?: number }) => {
          const monthIndex = opts.dataPointIndex ?? -1;
          if (monthIndex < 0) return;
          const flowType: FlowFilter = opts.seriesIndex === 0 ? 'PAGAMENTO' : 'RECEBIMENTO';
          setFlowFilter(flowType);
          setSelectedMonthIndex(monthIndex);
          setSelectedDayOfMonth(null);
        },
      },
    },
    plotOptions: { bar: { columnWidth: '48%', borderRadius: 10, borderRadiusApplication: 'end' } },
    dataLabels: { enabled: false },
    colors: ['#ff5a47', '#4d8cf3'],
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      labels: { colors: isDark ? '#e2e8f0' : '#334155' },
    },
    grid: { borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.18)', strokeDashArray: 3 },
    xaxis: {
      categories: dashboard.monthLabels,
      labels: { style: { colors: Array.from({ length: dashboard.monthLabels.length }, () => isDark ? '#cbd5e1' : '#334155') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: [isDark ? '#cbd5e1' : '#334155'] },
      },
    },
    tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (value: number) => BRL.format(value) } },
  }), [dashboard.monthLabels, isDark]);

  const dailyChartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      foreColor: isDark ? '#cbd5e1' : '#475569',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      events: {
        dataPointSelection: (_: unknown, __: unknown, opts: { seriesIndex?: number; dataPointIndex?: number }) => {
          const dayIndex = opts.dataPointIndex ?? -1;
          if (dayIndex < 0) return;
          const flowType: FlowFilter = opts.seriesIndex === 0 ? 'PAGAMENTO' : 'RECEBIMENTO';
          setFlowFilter(flowType);
          setSelectedDayOfMonth(dayIndex + 1);
        },
      },
    },
    plotOptions: { bar: { columnWidth: '58%', borderRadius: 6, borderRadiusApplication: 'end' } },
    dataLabels: { enabled: false },
    colors: ['#ff5a47', '#4d8cf3'],
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      labels: { colors: isDark ? '#e2e8f0' : '#334155' },
    },
    grid: { borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.18)', strokeDashArray: 3 },
    xaxis: {
      categories: dashboard.dayLabels,
      labels: { style: { colors: Array.from({ length: dashboard.dayLabels.length }, () => isDark ? '#cbd5e1' : '#334155') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: [isDark ? '#cbd5e1' : '#334155'] },
      },
    },
    tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (value: number) => BRL.format(value) } },
  }), [dashboard.dayLabels, isDark]);

  const donutChartOptions = useMemo<any>(() => ({
    chart: {
      background: 'transparent',
      toolbar: { show: false },
      events: {
        dataPointSelection: (_: unknown, __: unknown, opts: { dataPointIndex?: number }) => {
          const flowType: FlowFilter = opts.dataPointIndex === 0 ? 'PAGAMENTO' : 'RECEBIMENTO';
          setFlowFilter((current) => current === flowType ? 'ALL' : flowType);
        },
      },
    },
    labels: ['Pagamento', 'Recebimento'],
    colors: ['#ff5a47', '#4d8cf3'],
    stroke: { width: 0 },
    legend: {
      position: 'bottom',
      labels: { colors: isDark ? '#e2e8f0' : '#334155' },
      markers: { radius: 12 },
    },
    dataLabels: { enabled: false },
    tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (value: number) => BRL.format(value) } },
    plotOptions: {
      pie: {
        donut: {
          size: '68%',
          labels: {
            show: true,
            name: { color: isDark ? '#94a3b8' : '#64748b' },
            value: { color: isDark ? '#f8fafc' : '#0f172a', formatter: (value: string) => BRL.format(Number(value)) },
            total: {
              show: true,
              label: 'Total',
              color: isDark ? '#cbd5e1' : '#334155',
              formatter: () => BRL.format(dashboard.donutSeries.reduce((sum: number, item: number) => sum + item, 0)),
            },
          },
        },
      },
    },
  }), [dashboard.donutSeries, isDark]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  if (loading) {
    return <div className="p-10 text-center text-slate-400">Carregando boletim...</div>;
  }

  const pageClass = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_28%),linear-gradient(180deg,#020617_0%,#081224_45%,#0b1324_100%)] text-white'
    : 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_22%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-900';
  const shellClass = isDark ? 'border-white/10 bg-white/[0.035]' : 'border-slate-200 bg-white/88';
  const tableShellClass = isDark ? 'border-[#f2c94c]/20 bg-black/45' : 'border-amber-200 bg-white/95';

  return (
    <div className={`min-h-full px-3 py-6 sm:px-4 lg:px-6 ${pageClass}`}>
      <div className="mx-auto w-full space-y-5">
        <header className={`overflow-hidden rounded-[32px] border px-6 py-5 shadow-[0_35px_100px_-70px_rgba(15,23,42,0.95)] ${shellClass}`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border ${isDark ? 'border-white/10 bg-white/95' : 'border-slate-200 bg-slate-100'}`}>
                {companyLogo ? <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" /> : <Building2 className="h-8 w-8 text-slate-400" />}
              </div>
              <div>
                <div className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{companyName}</div>
                <div className={`mt-1 text-[11px] font-black uppercase tracking-[0.24em] ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Boletim financeiro interativo</div>
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <ViewToggle current={viewMode} onChange={setViewMode} isDark={isDark} />
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] ${isDark ? 'border-white/12 bg-white/5 text-white/70' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  <CalendarDays className="h-4 w-4" />
                  Data base {dashboard.now.toLocaleDateString('pt-BR')}
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

        {viewMode === 'executivo' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_420px]">
            <SoftMetricGrid
              title="Contas a pagar"
              accent="rose"
              isDark={isDark}
              metrics={[
                { label: 'Para hoje', value: dashboard.pagar.hoje },
                { label: 'Para amanhã', value: dashboard.pagar.amanha },
                { label: 'Atrasadas', value: dashboard.pagar.atrasadas },
                { label: `Total ${dashboard.effectiveMonthLabel}`, value: dashboard.pagar.totalMes },
                { label: 'Realizadas', value: dashboard.pagar.realizadas },
                { label: 'Em aberto', value: dashboard.pagar.emAberto },
              ]}
            />

            <SoftMetricGrid
              title="Contas a receber"
              accent="cyan"
              isDark={isDark}
              metrics={[
                { label: 'Para hoje', value: dashboard.receber.hoje },
                { label: 'Para amanhã', value: dashboard.receber.amanha },
                { label: 'Atrasadas', value: dashboard.receber.atrasadas },
                { label: `Total ${dashboard.effectiveMonthLabel}`, value: dashboard.receber.totalMes },
                { label: 'Realizadas', value: dashboard.receber.realizadas },
                { label: 'Em aberto', value: dashboard.receber.emAberto },
              ]}
            />

            <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${shellClass}`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Resultados e bancos</div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Os totais acompanham o centro de custo e os filtros ativos.</div>
                </div>
                <Landmark className={`h-5 w-5 ${isDark ? 'text-amber-200' : 'text-amber-700'}`} />
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
                    {dashboard.banks.slice(0, 6).map((conta) => {
                      const logo = getFullLogoUrl(conta.logo_url || null);
                      return (
                        <tr key={conta.id} className={isDark ? 'border-t border-white/8 text-white' : 'border-t border-slate-100 text-slate-800'}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <BankAvatar logoUrl={logo} bankName={conta.banco} accountName={conta.nome} integrationType={conta.tipo} size="sm" className="h-9 w-9" imageClassName="rounded-2xl" fallbackClassName="rounded-2xl border-0 shadow-none" />
                              <span>{conta.banco || conta.nome}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{BRL.format(Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <ResultCard label="Operacional" value={dashboard.operacional} emphasis isDark={isDark} />
                <ResultCard label="Final" value={dashboard.final} emphasis isDark={isDark} />
                <ResultCard label="A receber" value={dashboard.aReceberAberto} isDark={isDark} />
                <ResultCard label="Endividamento" value={dashboard.endividamento} isDark={isDark} />
              </div>
            </section>

            <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] xl:col-span-3 ${shellClass}`}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>Histórico mensal</div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Clique numa barra para combinar tipo e mês no restante do boletim.</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[#ff5a47]"><TrendingDown className="h-4 w-4" />Pagamento</span>
                  <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.12em] text-[#4d8cf3]"><TrendingUp className="h-4 w-4" />Recebimento</span>
                </div>
              </div>
              <AsyncApexChart
                type="bar"
                height={340}
                series={[
                  { name: 'Pagamento', data: dashboard.monthlyPagar },
                  { name: 'Recebimento', data: dashboard.monthlyReceber },
                ]}
                options={monthlyChartOptions}
              />
            </section>
          </section>
        ) : (
          <section className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_minmax(0,1.35fr)]">
              <section className={`rounded-[28px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Filtro</div>
                  <PieChart className={`h-4 w-4 ${isDark ? 'text-amber-200' : 'text-amber-700'}`} />
                </div>
                <div className={`mb-3 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Clique no donut para alternar entre pagamentos e recebimentos.</div>
                <AsyncApexChart type="donut" height={265} series={dashboard.donutSeries} options={donutChartOptions} />
              </section>

              <section className={`rounded-[28px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>A pagar vs a receber por mês</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Clique na barra para aplicar mês e tipo.</div>
                  </div>
                  <BarChart3 className={`h-4 w-4 ${isDark ? 'text-white/60' : 'text-slate-500'}`} />
                </div>
                <AsyncApexChart
                  type="bar"
                  height={260}
                  series={[
                    { name: 'Pagamento', data: dashboard.monthlyPagar },
                    { name: 'Recebimento', data: dashboard.monthlyReceber },
                  ]}
                  options={monthlyChartOptions}
                />
              </section>

              <section className={`rounded-[28px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>A pagar vs a receber por dia</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Mostrando {dashboard.effectiveMonthLabel}. Clique para combinar o dia.</div>
                  </div>
                  <Rows3 className={`h-4 w-4 ${isDark ? 'text-white/60' : 'text-slate-500'}`} />
                </div>
                <AsyncApexChart
                  type="bar"
                  height={260}
                  series={[
                    { name: 'Pagamento', data: dashboard.dailyPagar },
                    { name: 'Recebimento', data: dashboard.dailyReceber },
                  ]}
                  options={dailyChartOptions}
                />
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
              <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A Pagar e a Receber</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>A tabela combina centro de custo, tipo, mês, dia e situação.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterPill active={statusFilter === 'TODOS'} label="Todos" onClick={() => setStatusFilter('TODOS')} isDark={isDark} />
                    <FilterPill active={statusFilter === 'PAGO'} label="Pago" onClick={() => setStatusFilter('PAGO')} isDark={isDark} />
                    <FilterPill active={statusFilter === 'EM_ABERTO'} label="Em aberto" onClick={() => setStatusFilter('EM_ABERTO')} isDark={isDark} />
                    <FilterPill active={statusFilter === 'ATRASADO'} label="Atrasado" onClick={() => setStatusFilter('ATRASADO')} isDark={isDark} />
                    <FilterPill active={statusFilter === 'AMANHA'} label="Vcto amanhã" onClick={() => setStatusFilter('AMANHA')} isDark={isDark} />
                    <FilterPill active={statusFilter === 'HOJE'} label="Vcto hoje" onClick={() => setStatusFilter('HOJE')} isDark={isDark} />
                  </div>
                </div>

                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead className={isDark ? 'bg-[#f2c94c] text-slate-950' : 'bg-amber-300 text-slate-950'}>
                        <tr>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em]">Data Vcto</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em]">Nome Interessado</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em]">Descrição</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em]">Tipo</th>
                          <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em]">Valor Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.tableRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className={`px-4 py-12 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Nenhum lançamento para os filtros atuais.</td>
                          </tr>
                        ) : dashboard.tableRows.map((row) => (
                          <tr key={row.id} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/[0.04]' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                            <td className="px-4 py-3 font-medium">{formatDate(row.dataVencimento)}</td>
                            <td className="px-4 py-3 font-semibold">{row.interessado}</td>
                            <td className="px-4 py-3 max-w-[340px] truncate" title={row.descricao}>{row.descricao}</td>
                            <td className={`px-4 py-3 font-semibold ${row.flowType === 'RECEBIMENTO' ? 'text-[#4d8cf3]' : 'text-[#ff5a47]'}`}>{row.flowType === 'RECEBIMENTO' ? 'Recebimento' : 'Pagamento'}</td>
                            <td className={`px-4 py-3 text-right font-black ${row.valor >= 0 ? 'text-[#4d8cf3]' : 'text-[#ff5a47]'}`}>{BRL.format(row.valor)}</td>
                          </tr>
                        ))}
                        <tr className={isDark ? 'border-t border-white/10 bg-black/25 text-white' : 'border-t border-slate-200 bg-slate-50 text-slate-900'}>
                          <td colSpan={4} className="px-4 py-3 text-right font-black uppercase tracking-[0.14em]">Total geral</td>
                          <td className="px-4 py-3 text-right font-black">{BRL.format(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0))}</td>
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
                <div className={`mb-4 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Os cards usam os outros filtros ativos e aplicam a situação na tabela.</div>
                <div className="space-y-2.5">
                  {situacaoCards.map((item) => {
                    const active = statusFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setStatusFilter((current) => current === item.key ? 'TODOS' : item.key)}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? isDark ? 'border-amber-300/50 bg-amber-300/10' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035] hover:bg-white/[0.06]' : 'border-slate-200 bg-white/85 hover:bg-slate-50'}`}
                      >
                        <span className={`font-black ${isDark ? 'text-white/85' : 'text-slate-800'}`}>{item.label}</span>
                        <span className={`font-black ${active ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(item.value)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
