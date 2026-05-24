import { useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronRight, RotateCcw } from 'lucide-react';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

import { api, normalizeListResponse } from '../services/api';

interface BudgetMonth {
  mes: number;
  valor_realizado: number;
  valor_orcado: number;
  desvio_absoluto: number;
  desvio_percentual: number;
}

interface BudgetNode {
  plano_contas_id: number;
  conta_pai_id?: number | null;
  nome: string;
  codigo?: string | null;
  tipo: string;
  dre_grupo?: string | null;
  meses: BudgetMonth[];
  total_realizado: number;
  total_orcado: number;
  total_desvio_absoluto: number;
  total_desvio_percentual: number;
  children: BudgetNode[];
}

interface VisibleNode {
  node: BudgetNode;
  level: number;
  hasChildren: boolean;
}

type BudgetDreGroupKey =
  | 'RECEITAS_OPERACIONAIS'
  | 'ABATIMENTO_VENDAS'
  | 'CUSTOS'
  | 'DESPESAS_OPERACIONAIS'
  | 'RECEITAS_NAO_OPERACIONAIS'
  | 'DESPESAS_NAO_OPERACIONAIS';

interface BudgetGroupSection {
  key: BudgetDreGroupKey;
  label: string;
  tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'teal' | 'fuchsia';
  rows: VisibleNode[];
  monthly: BudgetMonth[];
  totalOrcado: number;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const EXCLUDED_BUDGET_GROUPS = new Set(['NÃO OPERACIONAL / FORA DA DRE', 'NAO OPERACIONAL / FORA DA DRE', 'NÃO OP.', 'NAO OP.']);

const BUDGET_GROUPS: Array<{ key: BudgetDreGroupKey; label: string; tone: BudgetGroupSection['tone'] }> = [
  { key: 'RECEITAS_OPERACIONAIS', label: 'Receitas Operacionais', tone: 'emerald' },
  { key: 'ABATIMENTO_VENDAS', label: 'Abatimento de vendas', tone: 'amber' },
  { key: 'CUSTOS', label: 'Custos', tone: 'orange' },
  { key: 'DESPESAS_OPERACIONAIS', label: 'Despesas Operacionais', tone: 'rose' },
  { key: 'RECEITAS_NAO_OPERACIONAIS', label: 'Receitas não operacionais', tone: 'teal' },
  { key: 'DESPESAS_NAO_OPERACIONAIS', label: 'Despesas não operacionais', tone: 'fuchsia' },
];

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const compactMoneyFormatter = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function formatCompactMoney(value: number) {
  return `R$ ${compactMoneyFormatter.format(Number.isFinite(value) ? value : 0)}`;
}

function isReceita(tipo?: string | null) {
  return String(tipo || '').trim().toUpperCase().startsWith('R');
}

function isDespesa(tipo?: string | null) {
  return String(tipo || '').trim().toUpperCase().startsWith('D');
}

function normalizeNode(node: BudgetNode): BudgetNode {
  const children = Array.isArray(node.children) ? node.children.map(normalizeNode) : [];
  const meses = Array.isArray(node.meses)
    ? node.meses.map((mes) => ({
        mes: toNumber(mes.mes),
        valor_realizado: toNumber(mes.valor_realizado),
        valor_orcado: toNumber(mes.valor_orcado),
        desvio_absoluto: toNumber(mes.desvio_absoluto),
        desvio_percentual: toNumber(mes.desvio_percentual),
      }))
    : [];

  return {
    ...node,
    plano_contas_id: toNumber(node.plano_contas_id),
    conta_pai_id: node.conta_pai_id === null || node.conta_pai_id === undefined ? null : toNumber(node.conta_pai_id),
    dre_grupo: node.dre_grupo ?? null,
    total_realizado: toNumber(node.total_realizado),
    total_orcado: toNumber(node.total_orcado),
    total_desvio_absoluto: toNumber(node.total_desvio_absoluto),
    total_desvio_percentual: toNumber(node.total_desvio_percentual),
    meses,
    children,
  };
}

function normalizeDreGroup(value?: string | null): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function filterBudgetTree(nodes: BudgetNode[]): BudgetNode[] {
  return nodes
    .filter((node) => !EXCLUDED_BUDGET_GROUPS.has(normalizeDreGroup(node.dre_grupo)))
    .map((node) => ({
      ...node,
      children: filterBudgetTree(node.children),
    }));
}

function resolveBudgetGroupKey(node: BudgetNode): BudgetDreGroupKey | null {
  const group = normalizeDreGroup(node.dre_grupo);

  if (EXCLUDED_BUDGET_GROUPS.has(group) || group === 'NAO_OPERACIONAL') {
    return null;
  }

  if (group === 'DEDUCOES_RECEITA') return 'ABATIMENTO_VENDAS';
  if (group === 'CUSTOS_VARIAVEIS') return 'CUSTOS';
  if (group === 'DESPESAS_OPERACIONAIS') return 'DESPESAS_OPERACIONAIS';
  if (group === 'OUTRAS_RECEITAS') return 'RECEITAS_NAO_OPERACIONAIS';
  if (group === 'OUTRAS_DESPESAS') return 'DESPESAS_NAO_OPERACIONAIS';

  if (isReceita(node.tipo)) return 'RECEITAS_OPERACIONAIS';
  if (isDespesa(node.tipo)) return 'DESPESAS_OPERACIONAIS';
  return null;
}

function buildGroupedBudgetSections(nodes: BudgetNode[], expandedIds: Set<number>): BudgetGroupSection[] {
  const sectionsByKey = new Map<BudgetDreGroupKey, BudgetGroupSection>();

  BUDGET_GROUPS.forEach((group) => {
    sectionsByKey.set(group.key, {
      key: group.key,
      label: group.label,
      tone: group.tone,
      rows: [],
      monthly: MONTH_LABELS.map((_, index) => ({
        mes: index + 1,
        valor_realizado: 0,
        valor_orcado: 0,
        desvio_absoluto: 0,
        desvio_percentual: 0,
      })),
      totalOrcado: 0,
    });
  });

  nodes.forEach((node) => {
    const key = resolveBudgetGroupKey(node);
    if (!key) return;

    const section = sectionsByKey.get(key);
    if (!section) return;

    section.totalOrcado += node.total_orcado;
    node.meses.forEach((mes, index) => {
      section.monthly[index].valor_realizado += mes.valor_realizado;
      section.monthly[index].valor_orcado += mes.valor_orcado;
    });
    section.rows.push(...flattenVisibleNodes([node], expandedIds));
  });

  return BUDGET_GROUPS.map((group) => sectionsByKey.get(group.key)!)
    .map((section) => {
      section.monthly.forEach((mes) => {
        mes.desvio_absoluto = mes.valor_realizado - mes.valor_orcado;
        mes.desvio_percentual = mes.valor_orcado !== 0 ? (mes.desvio_absoluto / mes.valor_orcado) * 100 : 0;
      });
      return section;
    })
    .filter((section) => section.rows.length > 0);
}

function getGroupToneClasses(tone: BudgetGroupSection['tone'], isDark: boolean) {
  const rowTone =
    tone === 'emerald' ? (isDark ? 'border-emerald-300/60 bg-emerald-700' : 'border-emerald-300 bg-emerald-700') :
    tone === 'amber' ? (isDark ? 'border-yellow-300/60 bg-yellow-600' : 'border-yellow-300 bg-yellow-600') :
    tone === 'orange' ? (isDark ? 'border-orange-300/60 bg-orange-700' : 'border-orange-300 bg-orange-700') :
    tone === 'rose' ? (isDark ? 'border-rose-300/60 bg-rose-700' : 'border-rose-300 bg-rose-700') :
    tone === 'teal' ? (isDark ? 'border-teal-300/60 bg-teal-700' : 'border-teal-300 bg-teal-700') :
    (isDark ? 'border-fuchsia-300/60 bg-fuchsia-700' : 'border-fuchsia-300 bg-fuchsia-700');

  const parentRowClass =
    tone === 'emerald' ? (isDark ? 'bg-emerald-800/60 text-white' : 'bg-emerald-200 text-emerald-950') :
    tone === 'amber' ? (isDark ? 'bg-yellow-800/60 text-white' : 'bg-yellow-200 text-yellow-950') :
    tone === 'orange' ? (isDark ? 'bg-orange-800/60 text-white' : 'bg-orange-200 text-orange-950') :
    tone === 'rose' ? (isDark ? 'bg-rose-800/60 text-white' : 'bg-rose-200 text-rose-950') :
    tone === 'teal' ? (isDark ? 'bg-teal-800/60 text-white' : 'bg-teal-200 text-teal-950') :
    (isDark ? 'bg-fuchsia-800/60 text-white' : 'bg-fuchsia-200 text-fuchsia-950');

  return { rowTone, parentRowClass };
}

function collectLeafMonthlyValues(
  nodes: BudgetNode[],
  predicate: (node: BudgetNode) => boolean,
  field: keyof Pick<BudgetMonth, 'valor_realizado' | 'valor_orcado'>,
) {
  const totals = MONTH_LABELS.map(() => 0);

  const visit = (current: BudgetNode) => {
    if (current.children.length > 0) {
      current.children.forEach(visit);
      return;
    }

    if (!predicate(current)) {
      return;
    }

    current.meses.forEach((mes, index) => {
      totals[index] += toNumber(mes[field]);
    });
  };

  nodes.forEach(visit);
  return totals;
}

function buildCumulativeSeries(values: number[]) {
  return values.reduce<number[]>((accumulator, value) => {
    const previous = accumulator.length > 0 ? accumulator[accumulator.length - 1] : 0;
    accumulator.push(previous + value);
    return accumulator;
  }, []);
}

function buildTreeMetrics(nodes: BudgetNode[]) {
  const receitaOrcadaMensal = collectLeafMonthlyValues(nodes, (node) => isReceita(node.tipo), 'valor_orcado');
  const receitaRealMensal = collectLeafMonthlyValues(nodes, (node) => isReceita(node.tipo), 'valor_realizado');
  const custoOrcadoMensal = collectLeafMonthlyValues(nodes, (node) => !isReceita(node.tipo), 'valor_orcado');
  const custoRealMensal = collectLeafMonthlyValues(nodes, (node) => !isReceita(node.tipo), 'valor_realizado');

  return {
    receitaOrcadaMensal,
    receitaRealMensal,
    custoOrcadoMensal,
    custoRealMensal,
    receitaOrcadaAcumulada: buildCumulativeSeries(receitaOrcadaMensal),
    receitaRealAcumulada: buildCumulativeSeries(receitaRealMensal),
    variacaoCustosMensal: custoRealMensal.map((valor, index) => valor - custoOrcadoMensal[index]),
  };
}

function recalculateNode(node: BudgetNode): BudgetNode {
  const children = node.children.map(recalculateNode);

  if (!children.length) {
    const meses = node.meses.map((mes) => {
      const desvioAbsoluto = mes.valor_realizado - mes.valor_orcado;
      return {
        ...mes,
        desvio_absoluto: desvioAbsoluto,
        desvio_percentual: mes.valor_orcado !== 0 ? (desvioAbsoluto / mes.valor_orcado) * 100 : 0,
      };
    });

    const totalRealizado = meses.reduce((acc, mes) => acc + mes.valor_realizado, 0);
    const totalOrcado = meses.reduce((acc, mes) => acc + mes.valor_orcado, 0);
    const totalDesvioAbsoluto = totalRealizado - totalOrcado;

    return {
      ...node,
      children,
      meses,
      total_realizado: totalRealizado,
      total_orcado: totalOrcado,
      total_desvio_absoluto: totalDesvioAbsoluto,
      total_desvio_percentual: totalOrcado !== 0 ? (totalDesvioAbsoluto / totalOrcado) * 100 : 0,
    };
  }

  const meses = node.meses.map((mes, index) => {
    const valores = children.reduce(
      (acc, child) => {
        const childMes = child.meses[index];
        acc.realizado += toNumber(childMes?.valor_realizado);
        acc.orcado += toNumber(childMes?.valor_orcado);
        return acc;
      },
      { realizado: 0, orcado: 0 },
    );

    const desvioAbsoluto = valores.realizado - valores.orcado;

    return {
      ...mes,
      valor_realizado: valores.realizado,
      valor_orcado: valores.orcado,
      desvio_absoluto: desvioAbsoluto,
      desvio_percentual: valores.orcado !== 0 ? (desvioAbsoluto / valores.orcado) * 100 : 0,
    };
  });

  const totalRealizado = meses.reduce((acc, mes) => acc + mes.valor_realizado, 0);
  const totalOrcado = meses.reduce((acc, mes) => acc + mes.valor_orcado, 0);
  const totalDesvioAbsoluto = totalRealizado - totalOrcado;

  return {
    ...node,
    children,
    meses,
    total_realizado: totalRealizado,
    total_orcado: totalOrcado,
    total_desvio_absoluto: totalDesvioAbsoluto,
    total_desvio_percentual: totalOrcado !== 0 ? (totalDesvioAbsoluto / totalOrcado) * 100 : 0,
  };
}

function recalculateTree(nodes: BudgetNode[]) {
  return nodes.map(recalculateNode);
}

function flattenVisibleNodes(nodes: BudgetNode[], expandedIds: Set<number>, level = 0): VisibleNode[] {
  const rows: VisibleNode[] = [];

  nodes.forEach((node) => {
    const hasChildren = node.children.length > 0;
    rows.push({ node, level, hasChildren });

    if (hasChildren && expandedIds.has(node.plano_contas_id)) {
      rows.push(...flattenVisibleNodes(node.children, expandedIds, level + 1));
    }
  });

  return rows;
}

function getDeviationBadgeClass(tipo: string, desvioAbsoluto: number) {
  const favorable = isReceita(tipo) ? desvioAbsoluto >= 0 : desvioAbsoluto <= 0;
  if (desvioAbsoluto === 0) {
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-200';
  }
  return favorable
    ? 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
    : 'bg-rose-500/10 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
}

export function Budget() {
  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number>(currentYear);
  const [matrix, setMatrix] = useState<BudgetNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const analytics = useMemo(() => buildTreeMetrics(matrix), [matrix]);

  const revenueChartSeries = useMemo(
    () => [
      { name: 'Orçado Acumulado', data: analytics.receitaOrcadaAcumulada },
      { name: 'Realizado Acumulado', data: analytics.receitaRealAcumulada },
    ],
    [analytics.receitaOrcadaAcumulada, analytics.receitaRealAcumulada],
  );

  const variationChartSeries = useMemo(
    () => [
      {
        name: 'Real - Orçado',
        data: analytics.variacaoCustosMensal,
      },
    ],
    [analytics.variacaoCustosMensal],
  );

  const revenueChartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'area',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'easeinout', speed: 450 },
        background: 'transparent',
      },
      colors: ['#16a34a', '#dc2626'],
      dataLabels: { enabled: false },
      stroke: {
        curve: 'smooth',
        width: [3, 3],
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 0.18,
          opacityFrom: 0.24,
          opacityTo: 0.04,
          stops: [0, 90, 100],
        },
      },
      grid: {
        borderColor: '#e2e8f0',
        strokeDashArray: 4,
      },
      legend: {
        position: 'top',
        horizontalAlign: 'right',
        markers: {
          size: 10,
          strokeWidth: 0,
          fillColors: ['#16a34a', '#dc2626'],
          shape: 'circle',
        },
      },
      markers: {
        size: 4,
        strokeWidth: 0,
        hover: { size: 6 },
      },
      xaxis: {
        categories: MONTH_LABELS,
        axisBorder: { color: '#cbd5e1' },
        axisTicks: { color: '#cbd5e1' },
        labels: {
          style: { colors: '#64748b', fontSize: '12px' },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactMoney(value),
          style: { colors: '#64748b', fontSize: '12px' },
        },
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (value) => formatMoney(value),
        },
      },
      theme: {
        mode: 'light',
      },
    }),
    [],
  );

  const variationChartOptions = useMemo<ApexOptions>(
    () => ({
      chart: {
        type: 'bar',
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
      },
      colors: ['#0f172a'],
      dataLabels: { enabled: false },
      plotOptions: {
        bar: {
          borderRadius: 6,
          columnWidth: '52%',
          colors: {
            ranges: [
              { from: -999999999999, to: 0, color: '#16a34a' },
              { from: 0.0000001, to: 999999999999, color: '#dc2626' },
            ],
          },
        },
      },
      grid: {
        borderColor: '#e2e8f0',
        strokeDashArray: 4,
      },
      xaxis: {
        categories: MONTH_LABELS,
        axisBorder: { color: '#cbd5e1' },
        axisTicks: { color: '#cbd5e1' },
        labels: {
          style: { colors: '#64748b', fontSize: '12px' },
        },
      },
      yaxis: {
        labels: {
          formatter: (value) => formatCompactMoney(value),
          style: { colors: '#64748b', fontSize: '12px' },
        },
      },
      tooltip: {
        y: {
          formatter: (value) => formatMoney(value),
        },
      },
      legend: { show: false },
      theme: {
        mode: 'light',
      },
    }),
    [],
  );

  const loadMatrix = async (selectedYear: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<BudgetNode[]>(`/orcamentos/matriz/${selectedYear}`);
      const nodes = recalculateTree(filterBudgetTree(normalizeListResponse<BudgetNode>(response.data).map(normalizeNode)));
      setMatrix(nodes);
      setExpandedIds(new Set(nodes.filter((node) => node.children.length).map((node) => node.plano_contas_id)));
    } catch (loadError) {
      console.error('Erro ao carregar matriz orçamentária:', loadError);
      setError('Não foi possível carregar a matriz orçamentária.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMatrix(ano);
  }, [ano]);

  const groupedSections = useMemo(() => buildGroupedBudgetSections(matrix, expandedIds), [matrix, expandedIds]);

  const summary = useMemo(() => {
    return matrix.reduce(
      (acc, node) => {
        acc.orcado += node.total_orcado;
        acc.realizado += node.total_realizado;
        return acc;
      },
      { orcado: 0, realizado: 0 },
    );
  }, [matrix]);

  const topLevelVariation = summary.realizado - summary.orcado;

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 rounded-none border border-slate-200/80 bg-white/90 p-5 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <Calculator className="h-3.5 w-3.5" /> Relatório Gerencial
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Budget</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Visão consolidada do orçado versus realizado, organizada em árvore e pronta para leitura rápida.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <span className="font-semibold">Ano</span>
            <input
              type="number"
              min={2000}
              max={2100}
              value={ano}
              onChange={(event) => setAno(Number(event.target.value) || currentYear)}
              className="w-24 border-0 bg-transparent p-0 text-right text-sm font-semibold outline-none focus:ring-0"
            />
          </label>

          <button
            type="button"
            onClick={() => void loadMatrix(ano)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <RotateCcw className="h-4 w-4" />
            Recarregar
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Orçado total</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.orcado)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Realizado total</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.realizado)}</p>
          <p className={`mt-1 text-xs font-semibold ${topLevelVariation >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
            Variação: {formatMoney(topLevelVariation)}
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-none border border-slate-200 bg-white shadow-[0_25px_90px_-65px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950/75">
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 border-b border-r border-slate-800 bg-slate-950/95 px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white backdrop-blur">
                  Conta
                </th>
                <th className="sticky top-0 z-30 border-b border-r border-slate-800 bg-slate-950/95 px-3 py-2 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white backdrop-blur">
                  Orçado total
                </th>
                {MONTH_LABELS.map((label) => (
                  <th
                    key={label}
                    className="sticky top-0 z-30 min-w-[100px] w-[100px] border-b border-r border-slate-800 bg-slate-950/95 px-2 py-2 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white backdrop-blur last:border-r-0"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Carregando relatório gerencial...
                  </td>
                </tr>
              ) : groupedSections.length === 0 ? (
                <tr>
                  <td colSpan={2 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum dado encontrado para este ano.
                  </td>
                </tr>
              ) : (
                groupedSections.map((section) => {
                  const { rowTone, parentRowClass } = getGroupToneClasses(section.tone, false);

                  return (
                    <Fragment key={section.key}>
                      <tr>
                        <td className={`sticky left-0 z-20 border-b border-r px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white ${rowTone}`}>
                          {section.label}
                        </td>
                        <td className={`border-b border-r px-4 py-3 text-right font-black text-white ${rowTone}`}>
                          {formatMoney(section.totalOrcado)}
                        </td>
                        {section.monthly.map((mes, index) => (
                          <td key={`${section.key}-total-${index}`} className={`border-b border-r px-4 py-3 text-right font-bold text-white last:border-r-0 ${rowTone}`}>
                            {formatMoney(mes.valor_orcado)}
                          </td>
                        ))}
                      </tr>

                      {section.rows.map(({ node, level, hasChildren }, rowIndex) => {
                        const rowTone = rowIndex % 2 === 0 ? 'bg-white dark:bg-slate-950/20' : 'bg-slate-50/70 dark:bg-slate-900/30';
                        const isLeaf = !hasChildren;

                        return (
                          <tr key={`${section.key}-${node.plano_contas_id}`} className={rowTone}>
                            <td className={`sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-2 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.45)] dark:border-slate-800 ${hasChildren ? `border-slate-700 font-black ${parentRowClass}` : rowTone}`}>
                              <div className="flex items-start gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                                <button
                                  type="button"
                                  onClick={() => hasChildren && handleToggleExpanded(node.plano_contas_id)}
                                  disabled={!hasChildren}
                                  className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 transition ${hasChildren ? 'hover:bg-slate-100 dark:hover:bg-slate-800' : 'opacity-30'}`}
                                  aria-label={hasChildren ? 'Expandir ou recolher conta' : 'Conta folha'}
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expandedIds.has(node.plano_contas_id) ? 'rotate-90' : ''}`} />
                                </button>

                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {node.codigo ? `${node.codigo} - ` : ''}
                                    {node.nome}
                                  </p>
                                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                                    {isLeaf ? ' · Nível folha' : ' · Conta agregadora'}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className={`border-b border-r border-slate-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200 ${hasChildren ? parentRowClass : rowTone}`}>
                              {formatMoney(node.total_orcado)}
                            </td>

                            {node.meses.map((mes) => {
                              const cellKey = getCellKey(node.plano_contas_id, mes.mes);
                              const isCellEditing = editingCell !== null && getCellKey(editingCell.planoContaId, editingCell.mes) === cellKey;
                              const deviationClasses = mes.desvio_percentual < 0 ? 'bg-red-50 text-red-700 font-bold dark:bg-red-950/35 dark:text-red-200' : '';

                              return (
                                <td
                                  key={`${node.plano_contas_id}-${mes.mes}`}
                                  onDoubleClick={() => {
                                    if (isLeaf) {
                                      beginCellEdit(node.plano_contas_id, mes.mes, mes.valor_orcado);
                                    }
                                  }}
                                  className={`min-w-[100px] w-[100px] border-b border-r border-slate-200 px-2 py-2 text-right dark:border-slate-800 ${isLeaf ? 'cursor-text' : 'cursor-default'} last:border-r-0 ${deviationClasses}`}
                                >
                                  <div className="flex items-center justify-end leading-tight">
                                    {isCellEditing ? (
                                      <input
                                        type="number"
                                        step="0.01"
                                        autoFocus
                                        value={editingValue}
                                        onChange={(event) => setEditingValue(event.target.value)}
                                        onBlur={commitEditingCell}
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                            commitEditingCell();
                                          }
                                          if (event.key === 'Escape') {
                                            event.preventDefault();
                                            cancelEditingCell();
                                          }
                                        }}
                                        className="w-full appearance-none bg-transparent px-0 py-0 text-right outline-none border-b-2 border-blue-500 text-slate-900 dark:text-slate-100 [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                      />
                                    ) : (
                                      <div className="w-full text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                                        {formatMoney(mes.valor_orcado)}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
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
      </section>

      <footer className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>Duplo clique em uma célula de mês (conta folha) para editar inline.</p>
        <p>{hasPendingChanges ? `${dirtyPayloads.length} alteração(ões) pendente(s)` : 'Nenhuma alteração pendente'}</p>
      </footer>
    </div>
  );
}
