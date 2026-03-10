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
import { BrandAvatar, inferBankBrand } from '../components/BrandAvatar';
import { api } from '../services/api';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
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
type TableFilter = 'TODOS' | 'PAGO' | 'EM_ABERTO' | 'ATRASADO' | 'HOJE' | 'AMANHA';

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
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.startsWith('/static')) {
    const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
    return `${baseURL}${url}`;
  }
  return url;
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

export function Boletim() {
  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<ContaResumo[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [entidades, setEntidades] = useState<EntidadeResumo[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoResumo[]>([]);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('executivo');
  const [tableFilter, setTableFilter] = useState<TableFilter>('TODOS');
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

  const boletim = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const monthLabels = MONTH_NAMES.map((label) => `${label}/${String(currentYear).slice(2)}`);
    const todayIso = toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const lancamentosFiltrados = selectedCentroCustoId === 'ALL'
      ? lancamentos
      : lancamentos.filter((item) => Number(item.centro_custo_id) === selectedCentroCustoId);

    const payables = lancamentosFiltrados.filter((item) => !isReceita(item.tipo));
    const receivables = lancamentosFiltrados.filter((item) => isReceita(item.tipo));

    const makeBlock = (items: LancamentoResumo[]) => {
      const hoje = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === todayIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const amanha = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) === tomorrowIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const atrasadas = items.filter((item) => !isPago(item.status) && item.data_vencimento?.slice(0, 10) < todayIso).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const totalMes = items.filter((item) => {
        const due = parseDateOnly(item.data_vencimento);
        return due && due >= monthStart && due <= monthEnd;
      }).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      const realizadas = items.filter((item) => isPago(item.status)).reduce((acc, item) => acc + Number(item.valor_pago ?? item.valor_previsto ?? 0), 0);
      const emAberto = items.filter((item) => !isPago(item.status)).reduce((acc, item) => acc + Number(item.valor_previsto || 0), 0);
      return { hoje, amanha, atrasadas, totalMes, realizadas, emAberto };
    };

    const pagar = makeBlock(payables);
    const receber = makeBlock(receivables);
    const bancos = [...contas]
      .map((conta) => ({ ...conta, saldo: Number(conta.saldo_atual ?? conta.saldo_inicial ?? 0) }))
      .sort((left, right) => right.saldo - left.saldo);

    const saldoBancario = bancos.reduce((acc, conta) => acc + conta.saldo, 0);
    const operacional = receber.totalMes - pagar.totalMes;
    const final = receber.realizadas - pagar.realizadas;
    const endividamento = pagar.emAberto;
    const aReceberAberto = receber.emAberto;

    const monthlyReceber = Array.from({ length: 12 }, () => 0);
    const monthlyPagar = Array.from({ length: 12 }, () => 0);
    const dailyReceber = Array.from({ length: daysInMonth }, () => 0);
    const dailyPagar = Array.from({ length: daysInMonth }, () => 0);

    const rows = lancamentosFiltrados.map((item) => {
      const due = parseDateOnly(item.data_vencimento);
      const baseValue = Number(item.valor_pago ?? item.valor_previsto ?? 0);
      const signedValue = isReceita(item.tipo) ? baseValue : baseValue * -1;
      const statusKey: TableFilter = isPago(item.status)
        ? 'PAGO'
        : item.data_vencimento?.slice(0, 10) === todayIso
          ? 'HOJE'
          : item.data_vencimento?.slice(0, 10) === tomorrowIso
            ? 'AMANHA'
            : item.data_vencimento?.slice(0, 10) < todayIso
              ? 'ATRASADO'
              : 'EM_ABERTO';

      if (due) {
        const monthIndex = due.getMonth();
        if (isReceita(item.tipo)) {
          monthlyReceber[monthIndex] += Number(item.valor_previsto || 0);
          if (due.getMonth() === now.getMonth()) dailyReceber[due.getDate() - 1] += Number(item.valor_previsto || 0);
        } else {
          monthlyPagar[monthIndex] += Number(item.valor_previsto || 0);
          if (due.getMonth() === now.getMonth()) dailyPagar[due.getDate() - 1] += Number(item.valor_previsto || 0);
        }
      }

      return {
        id: item.id,
        descricao: item.descricao,
        tipoLabel: isReceita(item.tipo) ? 'Recebimento' : 'Pagamento',
        dataVencimento: item.data_vencimento,
        statusKey,
        valor: signedValue,
        valorAbsoluto: Math.abs(signedValue),
        interessado: entityMap.get(Number(item.entidade_id)) || 'Sem interessado',
      };
    });

    const tableRowsAll = [...rows].sort((left, right) => {
      if (right.valorAbsoluto !== left.valorAbsoluto) return right.valorAbsoluto - left.valorAbsoluto;
      return String(left.dataVencimento).localeCompare(String(right.dataVencimento));
    });

    const situacao = {
      PAGO: lancamentosFiltrados.filter((item) => isPago(item.status)).reduce((acc, item) => acc + Math.abs(Number(item.valor_pago ?? item.valor_previsto ?? 0)), 0),
      EM_ABERTO: rows.filter((item) => item.statusKey === 'EM_ABERTO').reduce((acc, item) => acc + item.valorAbsoluto, 0),
      ATRASADO: rows.filter((item) => item.statusKey === 'ATRASADO').reduce((acc, item) => acc + item.valorAbsoluto, 0),
      AMANHA: rows.filter((item) => item.statusKey === 'AMANHA').reduce((acc, item) => acc + item.valorAbsoluto, 0),
      HOJE: rows.filter((item) => item.statusKey === 'HOJE').reduce((acc, item) => acc + item.valorAbsoluto, 0),
    };

    return {
      monthLabels,
      dayLabels: Array.from({ length: daysInMonth }, (_, index) => String(index + 1)),
      pagar,
      receber,
      bancos,
      saldoBancario,
      operacional,
      final,
      endividamento,
      aReceberAberto,
      monthlyReceber,
      monthlyPagar,
      dailyReceber,
      dailyPagar,
      donutSeries: [pagar.emAberto, receber.emAberto],
      tableRowsAll,
      situacao,
    };
  }, [contas, entidades, lancamentos, selectedCentroCustoId]);

  const filteredTableRows = useMemo(() => {
    if (tableFilter === 'TODOS') return boletim.tableRowsAll.slice(0, 14);
    return boletim.tableRowsAll.filter((item) => item.statusKey === tableFilter).slice(0, 14);
  }, [boletim.tableRowsAll, tableFilter]);

  const situacaoCards: Array<{ label: string; key: TableFilter; value: number }> = [
    { label: 'Pago', key: 'PAGO', value: boletim.situacao.PAGO },
    { label: 'Em Aberto', key: 'EM_ABERTO', value: boletim.situacao.EM_ABERTO },
    { label: 'Atrasado', key: 'ATRASADO', value: boletim.situacao.ATRASADO },
    { label: 'Vcto Amanhã', key: 'AMANHA', value: boletim.situacao.AMANHA },
    { label: 'Vcto Hoje', key: 'HOJE', value: boletim.situacao.HOJE },
  ];

  const monthlyChartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      foreColor: isDark ? '#cbd5e1' : '#475569',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
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
      categories: boletim.monthLabels,
      labels: { style: { colors: Array.from({ length: boletim.monthLabels.length }, () => isDark ? '#cbd5e1' : '#334155') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: [isDark ? '#cbd5e1' : '#334155'] },
      },
    },
    tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (value: number) => BRL.format(value) } },
  }), [boletim.monthLabels, isDark]);

  const dailyChartOptions = useMemo<any>(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      foreColor: isDark ? '#cbd5e1' : '#475569',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
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
      categories: boletim.dayLabels,
      labels: { style: { colors: Array.from({ length: boletim.dayLabels.length }, () => isDark ? '#cbd5e1' : '#334155') } },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => BRL.format(value),
        style: { colors: [isDark ? '#cbd5e1' : '#334155'] },
      },
    },
    tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (value: number) => BRL.format(value) } },
  }), [boletim.dayLabels, isDark]);

  const donutChartOptions = useMemo<any>(() => ({
    chart: { background: 'transparent', toolbar: { show: false } },
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
              formatter: () => BRL.format(boletim.donutSeries.reduce((sum: number, item: number) => sum + item, 0)),
            },
          },
        },
      },
    },
  }), [boletim.donutSeries, isDark]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';
  const now = new Date();

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

            <div className="flex flex-col gap-3 xl:items-center">
              <ViewToggle current={viewMode} onChange={setViewMode} isDark={isDark} />
              <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] ${isDark ? 'border-white/12 bg-white/5 text-white/70' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <CalendarDays className="h-4 w-4" />
                Data base {now.toLocaleDateString('pt-BR')}
              </div>
            </div>
          </div>
        </header>

        {viewMode === 'executivo' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_420px]">
            <SoftMetricGrid
              title="Contas a pagar"
              accent="rose"
              isDark={isDark}
              metrics={[
                { label: 'Para hoje', value: boletim.pagar.hoje },
                { label: 'Para amanhã', value: boletim.pagar.amanha },
                { label: 'Atrasadas', value: boletim.pagar.atrasadas },
                { label: 'Total do mês', value: boletim.pagar.totalMes },
                { label: 'Realizadas', value: boletim.pagar.realizadas },
                { label: 'Em aberto', value: boletim.pagar.emAberto },
              ]}
            />

            <SoftMetricGrid
              title="Contas a receber"
              accent="cyan"
              isDark={isDark}
              metrics={[
                { label: 'Para hoje', value: boletim.receber.hoje },
                { label: 'Para amanhã', value: boletim.receber.amanha },
                { label: 'Atrasadas', value: boletim.receber.atrasadas },
                { label: 'Total do mês', value: boletim.receber.totalMes },
                { label: 'Realizadas', value: boletim.receber.realizadas },
                { label: 'Em aberto', value: boletim.receber.emAberto },
              ]}
            />

            <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${shellClass}`}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Resultados e bancos</div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Mesmo arranjo, com leitura mais suave.</div>
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
                    {boletim.bancos.slice(0, 6).map((conta) => {
                      const bankBrand = inferBankBrand(conta.banco, conta.nome, conta.tipo);
                      return (
                        <tr key={conta.id} className={isDark ? 'border-t border-white/8 text-white' : 'border-t border-slate-100 text-slate-800'}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <BrandAvatar visual={bankBrand} size="sm" />
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
                <ResultCard label="Operacional" value={boletim.operacional} emphasis isDark={isDark} />
                <ResultCard label="Final" value={boletim.final} emphasis isDark={isDark} />
                <ResultCard label="A receber" value={boletim.aReceberAberto} isDark={isDark} />
                <ResultCard label="Endividamento" value={boletim.endividamento} isDark={isDark} />
              </div>
            </section>

            <section className={`rounded-[28px] border px-5 py-5 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] xl:col-span-3 ${shellClass}`}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>Histórico mensal</div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-white/50' : 'text-slate-500'}`}>Pagamentos versus recebimentos por mês de vencimento.</div>
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
                  { name: 'Pagamento', data: boletim.monthlyPagar },
                  { name: 'Recebimento', data: boletim.monthlyReceber },
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
                <div className="mb-4">
                  <label className={`mb-2 block text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>
                    Centro de custo
                  </label>
                  <select
                    value={selectedCentroCustoId === 'ALL' ? 'ALL' : String(selectedCentroCustoId)}
                    onChange={(event) => setSelectedCentroCustoId(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value))}
                    className={`w-full rounded-2xl border px-3 py-3 text-sm font-semibold outline-none transition ${isDark ? 'border-white/10 bg-white/5 text-white focus:border-amber-300/50' : 'border-slate-200 bg-white text-slate-900 focus:border-slate-400'}`}
                  >
                    <option value="ALL">Todos os centros de custo</option>
                    {centrosCusto.map((centro) => (
                      <option key={centro.id} value={centro.id}>
                        {centro.codigo ? `${centro.codigo} - ` : ''}{centro.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <AsyncApexChart type="donut" height={265} series={boletim.donutSeries} options={donutChartOptions} />
              </section>

              <section className={`rounded-[28px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>A pagar vs a receber por mês</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Vencimento mensal consolidado.</div>
                  </div>
                  <BarChart3 className={`h-4 w-4 ${isDark ? 'text-white/60' : 'text-slate-500'}`} />
                </div>
                <AsyncApexChart
                  type="bar"
                  height={260}
                  series={[
                    { name: 'Pagamento', data: boletim.monthlyPagar },
                    { name: 'Recebimento', data: boletim.monthlyReceber },
                  ]}
                  options={monthlyChartOptions}
                />
              </section>

              <section className={`rounded-[28px] border px-4 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.85)] ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-white/75' : 'text-slate-700'}`}>A pagar vs a receber por dia</div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Distribuição diária do mês atual.</div>
                  </div>
                  <Rows3 className={`h-4 w-4 ${isDark ? 'text-white/60' : 'text-slate-500'}`} />
                </div>
                <AsyncApexChart
                  type="bar"
                  height={260}
                  series={[
                    { name: 'Pagamento', data: boletim.dailyPagar },
                    { name: 'Recebimento', data: boletim.dailyReceber },
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
                    <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Estrutura da referência, mas com leitura mais suave e interação por filtro.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterPill active={tableFilter === 'TODOS'} label="Todos" onClick={() => setTableFilter('TODOS')} isDark={isDark} />
                    <FilterPill active={tableFilter === 'PAGO'} label="Pago" onClick={() => setTableFilter('PAGO')} isDark={isDark} />
                    <FilterPill active={tableFilter === 'EM_ABERTO'} label="Em aberto" onClick={() => setTableFilter('EM_ABERTO')} isDark={isDark} />
                    <FilterPill active={tableFilter === 'ATRASADO'} label="Atrasado" onClick={() => setTableFilter('ATRASADO')} isDark={isDark} />
                    <FilterPill active={tableFilter === 'AMANHA'} label="Vcto amanhã" onClick={() => setTableFilter('AMANHA')} isDark={isDark} />
                    <FilterPill active={tableFilter === 'HOJE'} label="Vcto hoje" onClick={() => setTableFilter('HOJE')} isDark={isDark} />
                  </div>
                </div>

                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div className="overflow-x-auto max-h-96">
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
                        {filteredTableRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className={`px-4 py-12 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Nenhum lançamento para esse filtro.</td>
                          </tr>
                        ) : filteredTableRows.map((row) => (
                          <tr key={row.id} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/[0.04]' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                            <td className="px-4 py-3 font-medium">{formatDate(row.dataVencimento)}</td>
                            <td className="px-4 py-3 font-semibold">{row.interessado}</td>
                            <td className="px-4 py-3 max-w-[340px] truncate" title={row.descricao}>{row.descricao}</td>
                            <td className={`px-4 py-3 font-semibold ${row.tipoLabel === 'Recebimento' ? 'text-[#4d8cf3]' : 'text-[#ff5a47]'}`}>{row.tipoLabel}</td>
                            <td className={`px-4 py-3 text-right font-black ${row.valor >= 0 ? 'text-[#4d8cf3]' : 'text-[#ff5a47]'}`}>{BRL.format(row.valor)}</td>
                          </tr>
                        ))}
                        <tr className={isDark ? 'border-t border-white/10 bg-black/25 text-white' : 'border-t border-slate-200 bg-slate-50 text-slate-900'}>
                          <td colSpan={4} className="px-4 py-3 text-right font-black uppercase tracking-[0.14em]">Total geral</td>
                          <td className="px-4 py-3 text-right font-black">{BRL.format(filteredTableRows.reduce((sum, row) => sum + row.valor, 0))}</td>
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
                    onClick={() => setTableFilter('TODOS')}
                    className={`text-[10px] font-black uppercase tracking-[0.14em] ${tableFilter === 'TODOS' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    Mostrar tudo
                  </button>
                </div>
                <div className={`mb-4 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Clique em um bloco para filtrar a tabela abaixo.</div>
                <div className="space-y-2.5">
                  {situacaoCards.map((item) => {
                    const active = tableFilter === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTableFilter((current) => current === item.key ? 'TODOS' : item.key)}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? isDark ? 'border-amber-300/50 bg-amber-300/10' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035] hover:bg-white/[0.06]' : 'border-slate-200 bg-white/85 hover:bg-slate-50'}`}
                      >
                        <span className={`font-black ${isDark ? 'text-white/85' : 'text-slate-800'}`}>{item.label}</span>
                        <span className={`font-black ${active ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white' : 'text-slate-900'}`}>{BRL.format(Number(item.value))}</span>
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