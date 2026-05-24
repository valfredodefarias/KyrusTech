import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronRight, RotateCcw, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Chart from 'react-apexcharts';

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
  isExpense: boolean;
  rows: VisibleNode[];
  monthly: BudgetMonth[];
  totalOrcado: number;
  totalRealizado: number;
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

const BUDGET_GROUPS: Array<{ key: BudgetDreGroupKey; label: string; tone: BudgetGroupSection['tone']; isExpense: boolean }> = [
  { key: 'RECEITAS_OPERACIONAIS', label: 'Receitas Operacionais', tone: 'emerald', isExpense: false },
  { key: 'ABATIMENTO_VENDAS', label: 'Abatimento de vendas', tone: 'amber', isExpense: true },
  { key: 'CUSTOS', label: 'Custos Variáveis', tone: 'orange', isExpense: true },
  { key: 'DESPESAS_OPERACIONAIS', label: 'Despesas Operacionais', tone: 'rose', isExpense: true },
  { key: 'RECEITAS_NAO_OPERACIONAIS', label: 'Receitas não operacionais', tone: 'teal', isExpense: false },
  { key: 'DESPESAS_NAO_OPERACIONAIS', label: 'Despesas não operacionais', tone: 'fuchsia', isExpense: true },
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

  if (isExcludedDreGroup(group)) return null;

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
      isExpense: group.isExpense,
      rows: [],
      monthly: MONTH_LABELS.map((_, index) => ({
        mes: index + 1,
        valor_realizado: 0,
        valor_orcado: 0,
        desvio_absoluto: 0,
        desvio_percentual: 0,
      })),
      totalOrcado: 0,
      totalRealizado: 0,
    });
  });

  nodes.forEach((node) => {
    const key = resolveBudgetGroupKey(node);
    if (!key) return;

    const section = sectionsByKey.get(key);
    if (!section) return;

    section.totalOrcado += node.total_orcado;
    section.totalRealizado += node.total_realizado;

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
    tone === 'emerald' ? (isDark ? 'bg-emerald-800/60 text-white' : 'bg-emerald-100 text-emerald-950') :
    tone === 'amber' ? (isDark ? 'bg-yellow-800/60 text-white' : 'bg-yellow-100 text-yellow-950') :
    tone === 'orange' ? (isDark ? 'bg-orange-800/60 text-white' : 'bg-orange-100 text-orange-950') :
    tone === 'rose' ? (isDark ? 'bg-rose-800/60 text-white' : 'bg-rose-100 text-rose-950') :
    tone === 'teal' ? (isDark ? 'bg-teal-800/60 text-white' : 'bg-teal-100 text-teal-950') :
    (isDark ? 'bg-fuchsia-800/60 text-white' : 'bg-fuchsia-100 text-fuchsia-950');

  return { rowTone, parentRowClass };
}

function recalculateNode(node: BudgetNode): BudgetNode {
  const children = node.children.map(recalculateNode);

  if (!children.length) {
    return node;
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
  const [ano, setAno] = useState<number>(currentYear);
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
      setError('Não foi possível carregar o relatório de budget.');
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
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const groupedSections = useMemo(() => buildGroupedBudgetSections(matrix, expandedIds), [matrix, expandedIds]);

  // Lógica de Gráficos e KPIs
  const { summary, chartData } = useMemo(() => {
    let orcado = 0;
    let realizado = 0;
    
    // Arrays para o Chart
    const accOrcadoList: number[] = [];
    const accRealizadoList: number[] = [];
    const varianceList: number[] = [];

    const monthlyTotals = Array.from({ length: 12 }, () => ({ orcado: 0, realizado: 0 }));

    // Calcular apenas despesas (para a variação) e totais consolidados
    matrix.forEach((node) => {
      orcado += node.total_orcado;
      realizado += node.total_realizado;
      
      const isNodeDespesa = isDespesa(node.tipo) || node.dre_grupo === 'CUSTOS_VARIAVEIS';

      node.meses.forEach((mes, idx) => {
        monthlyTotals[idx].orcado += mes.valor_orcado;
        monthlyTotals[idx].realizado += mes.valor_realizado;
      });
    });

    let currentAccOrcado = 0;
    let currentAccRealizado = 0;

    monthlyTotals.forEach((m) => {
      currentAccOrcado += m.orcado;
      currentAccRealizado += m.realizado;
      
      accOrcadoList.push(currentAccOrcado);
      accRealizadoList.push(currentAccRealizado);
      // Variação Absoluta do Mês (Para gráficos de barras)
      varianceList.push(m.realizado - m.orcado);
    });

    return {
      summary: { orcado, realizado },
      chartData: { accOrcadoList, accRealizadoList, varianceList }
    };
  }, [matrix]);

  const topLevelVariation = summary.realizado - summary.orcado;
  const topLevelPercentage = summary.orcado > 0 ? (topLevelVariation / summary.orcado) * 100 : 0;

  // Configurações do ApexCharts
  const areaChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'area', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: ['#3b82f6', '#10b981'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 3 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } },
    xaxis: { categories: MONTH_LABELS, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (val) => `R$ ${(val / 1000).toFixed(0)}k` } },
    legend: { position: 'top', horizontalAlign: 'right' },
    tooltip: { y: { formatter: (val) => formatMoney(val) } }
  };

  const barChartOptions: ApexCharts.ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    colors: [({ value }: { value: number }) => value > 0 ? '#ef4444' : '#10b981'], // Positivo = Vermelho (Estouro), Negativo = Verde (Economia)
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: MONTH_LABELS, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (val) => `R$ ${(val / 1000).toFixed(0)}k` } },
    tooltip: { y: { formatter: (val) => formatMoney(val) } }
  };

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 rounded-none border border-slate-200/80 bg-white/90 p-5 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <TrendingUp className="h-3.5 w-3.5" /> Budget Intelligence
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Matriz de Acompanhamento</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Relatório gerencial de análise de desvios, curvas de tendência e performance financeira orçada vs realizada.
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
            <RotateCcw className="h-4 w-4" /> Recarregar
          </button>
        </div>
      </header>

      {/* DASHBOARD TOP: KPIs */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Orçamento Total Aprovado (YTD)</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.orcado)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Total Realizado (YTD)</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.realizado)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70 flex flex-col justify-center">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400 mb-2">Desvio Global do Período</p>
          <div className="flex items-center gap-3">
            <p className={`text-3xl font-black tracking-tight ${topLevelVariation > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {topLevelPercentage > 0 ? '+' : ''}{topLevelPercentage.toFixed(1)}%
            </p>
            <div className={`flex items-center gap-1 text-sm font-semibold ${topLevelVariation > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {topLevelVariation > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {formatMoney(Math.abs(topLevelVariation))}
            </div>
          </div>
        </div>
      </section>

      {/* DASHBOARD MIDDLE: GRÁFICOS */}
      {!loading && matrix.length > 0 && (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <h3 className="mb-4 text-sm font-bold text-slate-700 dark:text-slate-300">Curva de Tendência Acumulada (S-Curve)</h3>
            <div className="h-[280px]">
              <Chart 
                options={areaChartOptions} 
                series={[
                  { name: 'Orçado Acumulado', data: chartData.accOrcadoList },
                  { name: 'Realizado Acumulado', data: chartData.accRealizadoList }
                ]} 
                type="area" 
                height="100%" 
              />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <h3 className="mb-4 text-sm font-bold text-slate-700 dark:text-slate-300">Variação Mensal de Caixa (Real vs Orçado)</h3>
            <div className="h-[280px]">
              <Chart 
                options={barChartOptions} 
                series={[{ name: 'Variação (R$)', data: chartData.varianceList }]} 
                type="bar" 
                height="100%" 
              />
            </div>
          </div>
        </section>
      )}

      {/* DATA GRID: TABELA DE LEITURA (READ-ONLY) */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md dark:border-slate-800 dark:bg-slate-950/75">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-40 border-b border-r border-slate-800 bg-slate-950/95 px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white backdrop-blur">
                  Classificação / Conta
                </th>
                <th className="sticky top-0 z-30 border-b border-r border-slate-800 bg-slate-950/95 px-3 py-3 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white backdrop-blur">
                  Orçado Total
                </th>
                <th className="sticky top-0 z-30 border-b border-r border-slate-800 bg-slate-950/95 px-3 py-3 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white backdrop-blur">
                  Realizado Total
                </th>
                {MONTH_LABELS.map((label) => (
                  <th key={label} className="sticky top-0 z-30 min-w-[110px] w-[110px] border-b border-r border-slate-800 bg-slate-950/95 px-2 py-3 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white backdrop-blur last:border-r-0">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Calculando S-Curve e montando árvore gerencial...
                  </td>
                </tr>
              ) : groupedSections.length === 0 ? (
                <tr>
                  <td colSpan={3 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum dado financeiro encontrado para {ano}.
                  </td>
                </tr>
              ) : (
                groupedSections
                  .filter((section) => {
                    const groupName = section.label.toLowerCase();
                    return !groupName.includes('fora') && !groupName.includes('opcional') && !groupName.includes('não op') && !groupName.includes('nao op');
                  })
                  .map((section) => {
                  const { rowTone, parentRowClass } = getGroupToneClasses(section.tone, false);
                  const isExpense = section.isExpense;

                  return (
                    <Fragment key={section.key}>
                      <tr>
                        <td className={`sticky left-0 z-20 border-b border-r px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white ${rowTone}`}>
                          {section.label}
                        </td>
                        <td className={`border-b border-r px-4 py-3 text-right font-black text-white ${rowTone}`}>
                          {formatMoney(section.totalOrcado)}
                        </td>
                        <td className={`border-b border-r px-4 py-3 text-right font-black text-white ${rowTone}`}>
                          {formatMoney(section.totalRealizado)}
                        </td>
                        {section.monthly.map((mes, index) => (
                          <td key={`${section.key}-total-${index}`} className={`border-b border-r px-4 py-3 text-right font-bold text-white last:border-r-0 ${rowTone}`}>
                            {formatMoney(mes.valor_realizado)}
                          </td>
                        ))}
                      </tr>

                      {section.rows.map(({ node, level, hasChildren }, rowIndex) => {
                        const bgTone = rowIndex % 2 === 0 ? 'bg-white dark:bg-slate-950/20' : 'bg-slate-50/70 dark:bg-slate-900/30';
                        const isLeaf = !hasChildren;

                        return (
                          <tr key={`${section.key}-${node.plano_contas_id}`} className={`hover:bg-blue-50/50 transition-colors ${bgTone}`}>
                            <td className={`sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-1.5 shadow-[4px_0_10px_-8px_rgba(0,0,0,0.3)] dark:border-slate-800 ${hasChildren ? `border-slate-700 font-black ${parentRowClass}` : bgTone}`}>
                              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                                <button
                                  type="button"
                                  onClick={() => hasChildren && handleToggleExpanded(node.plano_contas_id)}
                                  disabled={!hasChildren}
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 transition ${hasChildren ? 'hover:bg-slate-200 dark:hover:bg-slate-800' : 'opacity-0'}`}
                                >
                                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expandedIds.has(node.plano_contas_id) ? 'rotate-90' : ''}`} />
                                </button>
                                <div className="min-w-0 flex-1">
                                  <p className={`truncate ${isLeaf ? 'text-xs text-slate-600' : 'text-sm text-slate-900'} font-semibold dark:text-slate-100`}>
                                    {node.codigo ? `${node.codigo} - ` : ''}{node.nome}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className={`border-b border-r border-slate-200 px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-500 dark:border-slate-800 dark:text-slate-400 ${hasChildren ? parentRowClass : bgTone}`}>
                              {formatMoney(node.total_orcado)}
                            </td>
                            <td className={`border-b border-r border-slate-200 px-3 py-1.5 text-right text-xs font-bold tabular-nums text-slate-800 dark:border-slate-800 dark:text-slate-200 ${hasChildren ? parentRowClass : bgTone}`}>
                              {formatMoney(node.total_realizado)}
                            </td>

                            {node.meses.map((mes) => {
                              // Lógica de Cores da Célula:
                              // Se for Despesa e gastou mais que o orçado = Ruim (Vermelho)
                              // Se for Receita e ganhou menos que o orçado = Ruim (Vermelho)
                              const isOverBudget = mes.valor_realizado > mes.valor_orcado;
                              const isUnderBudget = mes.valor_realizado < mes.valor_orcado;
                              
                              let statusClass = '';
                              if (mes.valor_orcado > 0 || mes.valor_realizado > 0) {
                                if (isExpense && isOverBudget) statusClass = 'bg-red-50 text-red-700 font-bold dark:bg-red-900/20 dark:text-red-300';
                                else if (!isExpense && isUnderBudget) statusClass = 'bg-red-50 text-red-700 font-bold dark:bg-red-900/20 dark:text-red-300';
                                else statusClass = 'text-slate-700 dark:text-slate-300';
                              } else {
                                statusClass = 'text-slate-400 dark:text-slate-600'; // Meses zerados
                              }

                              return (
                                <td
                                  key={`${node.plano_contas_id}-${mes.mes}`}
                                  title={`Orçado: ${formatMoney(mes.valor_orcado)}\nDesvio Absoluto: ${formatMoney(mes.desvio_absoluto)}`}
                                  className={`border-b border-r border-slate-200 px-2 py-1.5 text-right tabular-nums dark:border-slate-800 last:border-r-0 ${statusClass} ${hasChildren && !statusClass.includes('bg-') ? parentRowClass : ''}`}
                                >
                                  <div className="flex flex-col items-end leading-tight">
                                    <span className="text-xs font-semibold">{formatMoney(mes.valor_realizado)}</span>
                                    {mes.valor_orcado > 0 && (
                                      <span className="text-[9px] font-bold opacity-75">
                                        {mes.desvio_percentual > 0 ? '+' : ''}{mes.desvio_percentual.toFixed(1)}%
                                      </span>
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
    </div>
  );
}