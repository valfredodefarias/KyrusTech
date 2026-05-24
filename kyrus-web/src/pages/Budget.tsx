import { Fragment, useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronRight, RotateCcw } from 'lucide-react';
import { AsyncApexChart } from '../components/AsyncApexChart';

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
  oculta?: boolean | null;
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
const EXCLUDED_BUDGET_GROUPS = new Set([
  'NAO_OPERACIONAL',
  'NAO OPERACIONAL',
  'NAO OPERACIONAL / FORA DA DRE',
  'NAO OP.',
  'FORA_DRE',
  'FORA DRE',
  'FORA DA DRE',
]);

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

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
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
    oculta: node.oculta ?? null,
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

function isExcludedDreGroup(value?: string | null): boolean {
  return EXCLUDED_BUDGET_GROUPS.has(normalizeDreGroup(value));
}

function filterBudgetTree(nodes: BudgetNode[]): BudgetNode[] {
  return nodes
    .filter((node) => node.oculta !== true)
    .filter((node) => !isExcludedDreGroup(node.dre_grupo))
    .map((node) => ({
      ...node,
      children: filterBudgetTree(node.children),
    }));
}

function resolveBudgetGroupKey(node: BudgetNode): BudgetDreGroupKey | null {
  const group = normalizeDreGroup(node.dre_grupo);

  if (isExcludedDreGroup(group)) {
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

  const childRowClass =
    tone === 'emerald' ? (isDark ? 'bg-emerald-950/10 text-slate-100' : 'bg-emerald-50/40 text-emerald-900') :
    tone === 'amber' ? (isDark ? 'bg-yellow-950/10 text-slate-100' : 'bg-yellow-50/40 text-yellow-900') :
    tone === 'orange' ? (isDark ? 'bg-orange-950/10 text-slate-100' : 'bg-orange-50/40 text-orange-900') :
    tone === 'rose' ? (isDark ? 'bg-rose-950/10 text-slate-100' : 'bg-rose-50/40 text-rose-900') :
    tone === 'teal' ? (isDark ? 'bg-teal-950/10 text-slate-100' : 'bg-teal-50/40 text-teal-900') :
    (isDark ? 'bg-fuchsia-950/10 text-slate-100' : 'bg-fuchsia-50/40 text-fuchsia-900');

  return { rowTone, parentRowClass, childRowClass };
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


export function Budget() {
  const currentYear = new Date().getFullYear();
  const ano = currentYear;
  const [matrix, setMatrix] = useState<BudgetNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


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

  function handleToggleExpanded(nodeId: number) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }


  const groupedSections = useMemo(() => buildGroupedBudgetSections(matrix, expandedIds), [matrix, expandedIds]);

  // summary removed — KPIs use monthly aggregates instead

  // Monthly totals (visible/filtered matrix)
  const monthlyTotals = useMemo(() => {
    const orcado = Array.from({ length: 12 }, () => 0);
    const realizado = Array.from({ length: 12 }, () => 0);

    matrix.forEach((node) => {
      node.meses.forEach((m) => {
        const idx = Math.max(0, Math.min(11, m.mes - 1));
        orcado[idx] += toNumber(m.valor_orcado);
        realizado[idx] += toNumber(m.valor_realizado);
      });
    });

    return { orcado, realizado };
  }, [matrix]);

  const cumulative = useMemo(() => {
    const cumOrcado: number[] = [];
    const cumRealizado: number[] = [];
    let so = 0;
    let sr = 0;
    for (let i = 0; i < 12; i++) {
      so += monthlyTotals.orcado[i] || 0;
      sr += monthlyTotals.realizado[i] || 0;
      cumOrcado.push(so);
      cumRealizado.push(sr);
    }
    return { cumOrcado, cumRealizado };
  }, [monthlyTotals]);

  const currentMonthIndex = new Date().getMonth();
  const orcadoAcumulado = cumulative.cumOrcado[currentMonthIndex] || 0;
  const realizadoAcumulado = cumulative.cumRealizado[currentMonthIndex] || 0;
  const eficienciaPercentual = orcadoAcumulado !== 0 ? ((realizadoAcumulado - orcadoAcumulado) / orcadoAcumulado) * 100 : 0;
  const eficienciaIsGood = realizadoAcumulado <= orcadoAcumulado; // economizou

  // topLevelVariation removed — handled by KPIs

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
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <span className="font-semibold">Ano</span>
            <span className="w-24 text-right text-sm font-semibold">{ano}</span>
          </div>

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

      <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Orçado Acumulado (até mês atual)</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(orcadoAcumulado)}</p>
            <p className="mt-1 text-xs text-slate-500">Total orçado acumulado até {MONTH_LABELS[currentMonthIndex]}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Realizado Acumulado (até mês atual)</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(realizadoAcumulado)}</p>
            <p className={`mt-1 text-xs font-semibold ${eficienciaIsGood ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
              {eficienciaIsGood ? 'Economizado' : 'Estourado'}: {eficienciaPercentual.toFixed(2)}%
            </p>
          </div>

          <div className={`rounded-2xl border p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 ${eficienciaIsGood ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Eficiência Orçamentária</p>
            <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{eficienciaPercentual.toFixed(2)}%</p>
            <p className="mt-1 text-xs text-slate-500">Comparação entre realizado e orçado (acumulado)</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <p className="mb-2 text-sm font-black uppercase text-slate-400">Curva de Tendência (Acumulado)</p>
            <AsyncApexChart
              type="area"
              height={320}
              series={[
                { name: 'Orçado Acumulado', data: cumulative.cumOrcado.map((v) => Number(v.toFixed(2))) },
                { name: 'Realizado Acumulado', data: cumulative.cumRealizado.map((v) => Number(v.toFixed(2))) },
              ]}
              options={{
                chart: { toolbar: { show: false }, zoom: { enabled: false } },
                stroke: { curve: 'smooth' },
                xaxis: { categories: MONTH_LABELS },
                yaxis: { labels: { formatter: (val: number) => formatMoney(val) } },
                tooltip: { y: { formatter: (val: number) => formatMoney(val) } },
                colors: ['#2563EB', eficienciaIsGood ? '#16A34A' : '#DC2626'],
                legend: { position: 'top' },
                fill: { opacity: [0.25, 0.1] },
              }}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <p className="mb-2 text-sm font-black uppercase text-slate-400">Variação Mensal (Orçado - Realizado)</p>
            <AsyncApexChart
              type="bar"
              height={320}
              series={[{ name: 'Variação', data: monthlyTotals.orcado.map((o, i) => Number((o - monthlyTotals.realizado[i]).toFixed(2))) }]}
              options={{
                chart: { toolbar: { show: false }, zoom: { enabled: false } },
                plotOptions: { bar: { columnWidth: '60%' } },
                xaxis: { categories: MONTH_LABELS },
                yaxis: { labels: { formatter: (val: number) => formatMoney(val) } },
                tooltip: { y: { formatter: (val: number) => formatMoney(val) } },
                colors: monthlyTotals.orcado.map((_, i) => (monthlyTotals.orcado[i] - monthlyTotals.realizado[i] >= 0 ? '#16A34A' : '#DC2626')),
                dataLabels: { enabled: false },
              }}
            />
          </div>
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
                groupedSections
                  .filter((section) => {
                    const groupName = section.label.toLowerCase();
                    return !groupName.includes('fora') && !groupName.includes('opcional') && !groupName.includes('não op') && !groupName.includes('nao op');
                  })
                  .map((section) => {
                  const { rowTone, parentRowClass, childRowClass } = getGroupToneClasses(section.tone, false);

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

                      {section.rows.map(({ node, level, hasChildren }) => {
                        const isLeaf = !hasChildren;
                        const rowClass = hasChildren ? parentRowClass : childRowClass;

                        return (
                          <tr key={`${section.key}-${node.plano_contas_id}`} className={rowClass}>
                            <td className={`sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-2 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.45)] dark:border-slate-800 ${hasChildren ? `border-slate-700 font-black ${parentRowClass}` : childRowClass}`}>
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

                            <td className={`border-b border-r border-slate-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200 ${hasChildren ? parentRowClass : childRowClass}`}>
                              {formatMoney(node.total_orcado)}
                            </td>

                            {node.meses.map((mes) => {
                              const deviationClasses = mes.desvio_percentual < 0 ? 'bg-red-50 text-red-700 font-bold dark:bg-red-950/35 dark:text-red-200' : '';

                              return (
                                <td
                                  key={`${node.plano_contas_id}-${mes.mes}`}
                                  className={`min-w-[100px] w-[100px] border-b border-r border-slate-200 px-2 py-2 text-right dark:border-slate-800 cursor-default last:border-r-0 ${hasChildren ? parentRowClass : childRowClass} ${deviationClasses}`}
                                >
                                  <div className="flex flex-col items-end leading-tight">
                                    <div className="w-full text-right text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                                      {formatMoney(mes.valor_realizado)}
                                    </div>
                                    <div className="mt-1 text-[9px] opacity-80 text-slate-600 dark:text-slate-300">
                                      {formatMoney(mes.desvio_absoluto)} ({mes.desvio_percentual >= 0 ? '+' : ''}{mes.desvio_percentual.toFixed(2)}%)
                                    </div>
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
        <p>Leitura consolidada do orçamento, sem edição inline nesta tela.</p>
        <p>Use a tela de digitação para ajustes.</p>
      </footer>
    </div>
  );
}
