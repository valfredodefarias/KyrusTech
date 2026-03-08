import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { api } from '../services/api';
import { useAssistentePage } from '../components/AssistentePageContext';
import { AsyncApexChart } from '../components/AsyncApexChart';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, Filter,
  CalendarRange, Layers, Building2, X, Landmark,
  Sparkles, Download, Search, Activity, Settings2,
  LayoutGrid, Plus, Pencil, Trash2, Eye, EyeOff, GripVertical
} from 'lucide-react';

interface Lancamento {
  id: number;
  descricao: string;
  valor_previsto: number;
  valor_pago: number;
  data_vencimento: string;
  data_pagamento?: string;
  competencia?: string;
  previsto?: boolean;
  origem?: string;
  tipo: 'RECEITA' | 'DESPESA' | string;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO' | string;
  plano_contas_id?: number;
  centro_custo_id?: number;
}

interface Categoria {
  id: number;
  nome: string;
  tipo: string;
  considerar_nos_resultados?: boolean;
}

interface CentroCusto {
  id: number;
  nome: string;
}

interface Conta {
  id: number;
  nome: string;
  banco?: string | null;
  saldo_atual?: number;
}

interface TodoItem {
  id: number;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO' | string;
}

type FinanceDrilldown =
  | 'PAGAR_HOJE'
  | 'PAGAR_AMANHA'
  | 'PAGAR_ATRASADAS'
  | 'PAGAR_REALIZADAS'
  | 'PAGAR_ABERTO'
  | 'PAGAR_TOTAL'
  | 'RECEBER_HOJE'
  | 'RECEBER_AMANHA'
  | 'RECEBER_ATRASADAS'
  | 'RECEBER_REALIZADAS'
  | 'RECEBER_ABERTO'
  | 'RECEBER_TOTAL'
  | null;

type DashboardHelpKey =
  | 'RECEITAS'
  | 'DESPESAS'
  | 'SALDO'
  | 'PAGOS'
  | 'MARGEM_CORRENTE'
  | 'TICKET_MEDIO'
  | 'COBERTURA_FINANCEIRA'
  | 'MAIOR_PRESSAO'
  | 'MAIOR_MOTOR_RECEITA'
  | 'FLUXO_CAIXA'
  | 'DESPESAS_CATEGORIA'
  | 'RECEITAS_CATEGORIA'
  | 'ACUMULADO_REC_DESP'
  | 'RESULTADO_OPERACIONAL'
  | 'RESUMO_OPERACIONAL'
  | 'RECEITAS_DESPESAS_ANO'
  | 'MARGEM_OPERACIONAL_PAINEL'
  | 'COMPARATIVO_ANO'
  | 'SAZONALIDADE'
  | 'CENARIOS'
  | 'RESULTADO_ACUMULADO'
  | 'PULSO_ACUMULADO'
  | 'FECHAMENTO_ACUMULADO'
  | 'PICO_ACUMULADO'
  | 'VALE_ACUMULADO'
  | 'AMPLITUDE_ACUMULADO'
  | 'STATUS_DISTRIB'
  | 'PRODUTIVIDADE'
  | 'DESPESAS_CENTRO'
  | 'ULTIMOS_LANCAMENTOS';

type KpiTooltipState = {
  key: DashboardHelpKey;
};

type DashboardBuiltInWidgetId =
  | 'heatmap_calendar'
  | 'executive_readings'
  | 'productivity'
  | 'contas_pagar'
  | 'contas_receber'
  | 'lancamentos_pagar'
  | 'lancamentos_receber'
  | 'fluxo'
  | 'despesas_categoria'
  | 'receitas_categoria'
  | 'acumulado_rec_desp'
  | 'resultado_operacional'
  | 'resumo_operacional'
  | 'receitas_despesas_ano'
  | 'margem_operacional'
  | 'comparativo_ano'
  | 'sazonalidade'
  | 'cenarios'
  | 'resultado_acumulado'
  | 'pulso_acumulado'
  | 'status'
  | 'despesas_centro'
  | 'ultimos_lancamentos'
  | 'gastos_categoria_lista'
  | 'lancamentos_categoria'
  | 'base_analitica'
  | 'lancamentos_dia';

type DashboardWidgetId = string;

type DashboardCustomWidgetKind = 'kpi' | 'chart';
type DashboardCustomAggregation = 'sum' | 'avg' | 'count';
type DashboardCustomMetricField = 'valor_previsto' | 'valor_pago' | 'count';
type DashboardCustomChartType = 'bar' | 'line' | 'donut';
type DashboardCustomGroupBy = 'categoria' | 'centro_custo' | 'conta' | 'status' | 'tipo' | 'competencia' | 'mes' | 'dia';
type DashboardCustomScope = 'todos' | 'receitas' | 'despesas';
type DashboardCustomFormulaId = 'saldo' | 'margem_percentual' | 'cobertura_pagamentos' | 'ticket_medio';

interface DashboardCustomWidgetDefinition {
  kind: DashboardCustomWidgetKind;
  title: string;
  description?: string;
  metricField: DashboardCustomMetricField;
  aggregation: DashboardCustomAggregation;
  scope: DashboardCustomScope;
  chartType?: DashboardCustomChartType;
  groupBy?: DashboardCustomGroupBy;
  limit?: number;
  color?: string;
  formula?: DashboardCustomFormulaId | null;
}

interface DashboardCustomWidgetTemplate {
  id: string;
  label: string;
  description: string;
  definition: DashboardCustomWidgetDefinition;
}

type DashboardWidgetSize = 'sm' | 'md' | 'lg' | 'full';
type DashboardResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DashboardGridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  isResizable?: boolean;
  resizeHandles?: DashboardResizeHandle[];
}

type DashboardGridLayout = DashboardGridItem[];

interface DashboardWidgetConfig {
  id: DashboardWidgetId;
  visible: boolean;
  size: DashboardWidgetSize;
  autoWidth?: boolean;
  autoHeight?: boolean;
  customDefinition?: DashboardCustomWidgetDefinition | null;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

interface DashboardView {
  id: string;
  name: string;
  widgets: DashboardWidgetConfig[];
  isDefault?: boolean;
  source?: 'global' | 'empresa';
}

interface DashboardViewsApiResponse {
  empresa_id: number;
  default_view?: DashboardView | null;
  views: DashboardView[];
  can_manage_default: boolean;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INTERACTIVE_PANEL_CLASS = 'group relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.1),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))] dark:hover:shadow-black/20';
const DASHBOARD_SECTION_CLASS = 'group relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.96))] p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.12),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))] dark:hover:shadow-black/20';
const DASHBOARD_ACTIVE_VIEW_STORAGE_KEY_PREFIX = 'kyrus-dashboard-active-view-v1';
const DASHBOARD_VIEWS_CACHE_KEY_PREFIX = 'kyrus-dashboard-views-cache-v1';
const DASHBOARD_GRID_COLUMNS = 12;
const DASHBOARD_GRID_ROW_HEIGHT = 92;
const DASHBOARD_GRID_MARGIN = 24;
const DEFAULT_DASHBOARD_VIEW_ID = 'default';

type DashboardCustomWidgetKpiDataset = { total: number; count: number };
type DashboardCustomWidgetChartDataset = Array<{ label: string; value: number }>;
type DashboardCustomWidgetDataset = DashboardCustomWidgetKpiDataset | DashboardCustomWidgetChartDataset;

const DEFAULT_CUSTOM_WIDGET_DEFINITION: DashboardCustomWidgetDefinition = {
  kind: 'kpi',
  title: 'Novo KPI',
  description: '',
  metricField: 'valor_previsto',
  aggregation: 'sum',
  scope: 'todos',
  chartType: 'bar',
  groupBy: 'categoria',
  limit: 8,
  color: '#0ea5e9',
  formula: null,
};

const DASHBOARD_CUSTOM_FORMULA_LABELS: Record<DashboardCustomFormulaId, string> = {
  saldo: 'Saldo',
  margem_percentual: 'Margem %',
  cobertura_pagamentos: 'Cobertura de pagamentos %',
  ticket_medio: 'Ticket médio',
};

const DASHBOARD_CUSTOM_METRIC_LABELS: Record<DashboardCustomMetricField, string> = {
  valor_previsto: 'Valor previsto',
  valor_pago: 'Valor pago',
  count: 'Quantidade de lançamentos',
};

const DASHBOARD_CUSTOM_WIDGET_TEMPLATES: DashboardCustomWidgetTemplate[] = [
  {
    id: 'saldo-geral',
    label: 'Saldo geral',
    description: 'Receitas menos despesas no recorte atual.',
    definition: {
      ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
      kind: 'kpi',
      title: 'Saldo geral',
      description: 'Resultado do recorte filtrado.',
      scope: 'todos',
      color: '#0f766e',
      formula: 'saldo',
    },
  },
  {
    id: 'margem-centro',
    label: 'Margem por centro',
    description: 'Margem percentual por centro de custo.',
    definition: {
      ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
      kind: 'chart',
      title: 'Margem por centro',
      description: 'Margem percentual agrupada por centro de custo.',
      chartType: 'bar',
      groupBy: 'centro_custo',
      color: '#7c3aed',
      formula: 'margem_percentual',
    },
  },
  {
    id: 'receita-categoria',
    label: 'Receita por categoria',
    description: 'Top categorias de receita.',
    definition: {
      ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
      kind: 'chart',
      title: 'Receita por categoria',
      description: 'Soma do valor previsto por categoria.',
      scope: 'receitas',
      chartType: 'donut',
      groupBy: 'categoria',
      color: '#16a34a',
      formula: null,
    },
  },
  {
    id: 'ticket-medio-mes',
    label: 'Ticket médio por mês',
    description: 'Valor médio por lançamento ao longo do tempo.',
    definition: {
      ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
      kind: 'chart',
      title: 'Ticket médio por mês',
      description: 'Média por lançamento agrupada por mês.',
      chartType: 'line',
      groupBy: 'mes',
      color: '#ea580c',
      formula: 'ticket_medio',
    },
  },
];

const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetConfig[] = [
  { id: 'heatmap_calendar', visible: true, size: 'lg', x: 0, y: 0, w: 8, h: 6 },
  { id: 'executive_readings', visible: true, size: 'sm', x: 8, y: 0, w: 4, h: 6 },
  { id: 'productivity', visible: true, size: 'full', x: 0, y: 6, w: 12, h: 6 },
  { id: 'lancamentos_dia', visible: true, size: 'full', x: 0, y: 12, w: 12, h: 4, autoHeight: true, autoWidth: false },
  { id: 'contas_pagar', visible: true, size: 'md', x: 0, y: 16, w: 6, h: 4 },
  { id: 'contas_receber', visible: true, size: 'md', x: 6, y: 16, w: 6, h: 4 },
  { id: 'lancamentos_pagar', visible: true, size: 'md', x: 0, y: 20, w: 6, h: 6, autoHeight: true, autoWidth: false },
  { id: 'lancamentos_receber', visible: true, size: 'md', x: 6, y: 20, w: 6, h: 6, autoHeight: true, autoWidth: false },
  { id: 'fluxo', visible: true, size: 'full', x: 0, y: 26, w: 12, h: 6 },
  { id: 'despesas_categoria', visible: true, size: 'lg', x: 0, y: 32, w: 8, h: 7 },
  { id: 'receitas_categoria', visible: true, size: 'sm', x: 8, y: 32, w: 4, h: 7 },
  { id: 'resultado_operacional', visible: true, size: 'lg', x: 0, y: 39, w: 8, h: 5 },
  { id: 'resumo_operacional', visible: true, size: 'sm', x: 8, y: 39, w: 4, h: 5 },
  { id: 'receitas_despesas_ano', visible: true, size: 'lg', x: 0, y: 44, w: 8, h: 5 },
  { id: 'margem_operacional', visible: true, size: 'sm', x: 8, y: 44, w: 4, h: 5 },
  { id: 'comparativo_ano', visible: true, size: 'lg', x: 0, y: 49, w: 8, h: 5 },
  { id: 'sazonalidade', visible: true, size: 'sm', x: 8, y: 49, w: 4, h: 5 },
  { id: 'resultado_acumulado', visible: true, size: 'lg', x: 0, y: 54, w: 8, h: 5 },
  { id: 'cenarios', visible: true, size: 'sm', x: 8, y: 54, w: 4, h: 5 },
  { id: 'acumulado_rec_desp', visible: true, size: 'lg', x: 0, y: 59, w: 8, h: 5 },
  { id: 'pulso_acumulado', visible: true, size: 'sm', x: 8, y: 59, w: 4, h: 6 },
  { id: 'despesas_centro', visible: true, size: 'md', x: 0, y: 65, w: 6, h: 6 },
  { id: 'status', visible: true, size: 'md', x: 6, y: 65, w: 6, h: 4 },
  { id: 'gastos_categoria_lista', visible: true, size: 'sm', x: 0, y: 71, w: 4, h: 5, autoHeight: true },
  { id: 'ultimos_lancamentos', visible: true, size: 'lg', x: 4, y: 71, w: 8, h: 6, autoHeight: true, autoWidth: false },
  { id: 'lancamentos_categoria', visible: true, size: 'full', x: 0, y: 77, w: 12, h: 6, autoHeight: true, autoWidth: false },
  { id: 'base_analitica', visible: true, size: 'full', x: 0, y: 83, w: 12, h: 10, autoHeight: true, autoWidth: false },
];

const DASHBOARD_WIDGET_HEIGHTS: Record<string, number> = {
  heatmap_calendar: 6,
  executive_readings: 6,
  productivity: 6,
  contas_pagar: 3,
  contas_receber: 3,
  lancamentos_pagar: 6,
  lancamentos_receber: 6,
  fluxo: 4,
  despesas_categoria: 5,
  receitas_categoria: 7,
  acumulado_rec_desp: 4,
  resultado_operacional: 4,
  resumo_operacional: 5,
  receitas_despesas_ano: 4,
  margem_operacional: 4,
  comparativo_ano: 4,
  sazonalidade: 4,
  cenarios: 4,
  resultado_acumulado: 4,
  pulso_acumulado: 6,
  status: 4,
  despesas_centro: 6,
  ultimos_lancamentos: 6,
  gastos_categoria_lista: 4,
  lancamentos_categoria: 6,
  base_analitica: 10,
  lancamentos_dia: 4,
};

const DASHBOARD_WIDGET_LABELS: Record<string, string> = {
  heatmap_calendar: 'Heatmap por dia',
  executive_readings: 'Leituras executivas',
  productivity: 'Produtividade',
  contas_pagar: 'Contas a pagar',
  contas_receber: 'Contas a receber',
  lancamentos_pagar: 'Lancamentos a pagar',
  lancamentos_receber: 'Lancamentos a receber',
  fluxo: 'Fluxo de caixa',
  despesas_categoria: 'Despesas por categoria',
  receitas_categoria: 'Receitas por categoria',
  acumulado_rec_desp: 'Acumulado receitas x despesas',
  resultado_operacional: 'Resultado operacional',
  resumo_operacional: 'Resumo operacional',
  receitas_despesas_ano: 'Receitas x despesas do ano',
  margem_operacional: 'Margem operacional',
  comparativo_ano: 'Comparativo ano a ano',
  sazonalidade: 'Sazonalidade',
  cenarios: 'Cenarios',
  resultado_acumulado: 'Resultado acumulado',
  pulso_acumulado: 'Pulso do acumulado',
  status: 'Distribuicao por status',
  despesas_centro: 'Despesas por centro',
  ultimos_lancamentos: 'Ultimos lancamentos',
  gastos_categoria_lista: 'Lista de gastos por categoria',
  lancamentos_categoria: 'Lancamentos da categoria',
  base_analitica: 'Base analitica final',
  lancamentos_dia: 'Lancamentos do dia selecionado',
};

function createDefaultDashboardView(): DashboardView {
  return {
    id: DEFAULT_DASHBOARD_VIEW_ID,
    name: 'Padrao',
    widgets: normalizeDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS),
    isDefault: true,
    source: 'global',
  };
}

function cloneDashboardView(view: DashboardView, patch?: Partial<DashboardView>): DashboardView {
  return {
    ...view,
    ...patch,
    widgets: normalizeDashboardWidgets((patch?.widgets || view.widgets).map((widget) => ({ ...widget }))),
  };
}

function normalizeCustomWidgetDefinition(definition?: DashboardCustomWidgetDefinition | null): DashboardCustomWidgetDefinition | null {
  if (!definition) return null;

  return {
    ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
    ...definition,
    title: String(definition.title || DEFAULT_CUSTOM_WIDGET_DEFINITION.title),
    description: String(definition.description || ''),
    limit: Math.max(3, Math.min(20, Number(definition.limit || DEFAULT_CUSTOM_WIDGET_DEFINITION.limit || 8))),
    formula: definition.formula ?? DEFAULT_CUSTOM_WIDGET_DEFINITION.formula,
  };
}

function getCustomWidgetFormulaLabel(formula?: DashboardCustomFormulaId | null) {
  return formula ? DASHBOARD_CUSTOM_FORMULA_LABELS[formula] : null;
}

function getCustomMetricLabel(definition: DashboardCustomWidgetDefinition) {
  return getCustomWidgetFormulaLabel(definition.formula) || DASHBOARD_CUSTOM_METRIC_LABELS[definition.metricField];
}

function resolveCustomWidgetTitle(kind: DashboardCustomWidgetKind) {
  return kind === 'kpi' ? 'Novo KPI' : 'Novo gráfico';
}

function getWidgetDefaultHeight(widget: DashboardWidgetConfig) {
  if (widget.customDefinition?.kind === 'kpi') return 4;
  if (widget.customDefinition?.kind === 'chart') return 6;
  return DASHBOARD_WIDGET_HEIGHTS[widget.id as DashboardBuiltInWidgetId] ?? 4;
}

function getWidgetLabel(widget: DashboardWidgetConfig) {
  return widget.customDefinition?.title || DASHBOARD_WIDGET_LABELS[widget.id as DashboardBuiltInWidgetId] || widget.id;
}

function getWidgetWidthFromSize(size: DashboardWidgetSize) {
  if (size === 'full') return 12;
  if (size === 'lg') return 8;
  if (size === 'md') return 6;
  return 4;
}

function getWidgetSizeFromWidth(width: number): DashboardWidgetSize {
  if (width >= 12) return 'full';
  if (width >= 8) return 'lg';
  if (width >= 6) return 'md';
  return 'sm';
}

function buildSequentialWidgetLayout(widgets: DashboardWidgetConfig[]) {
  let x = 0;
  let y = 0;
  let currentRowHeight = 0;

  return widgets.map((widget) => {
    const width = Math.min(DASHBOARD_GRID_COLUMNS, widget.w ?? getWidgetWidthFromSize(widget.size));
    const height = Math.max(3, widget.h ?? getWidgetDefaultHeight(widget));

    if (x + width > DASHBOARD_GRID_COLUMNS) {
      x = 0;
      y += currentRowHeight;
      currentRowHeight = 0;
    }

    const normalized = {
      ...widget,
      x: widget.x ?? x,
      y: widget.y ?? y,
      w: width,
      h: height,
    };

    x += width;
    currentRowHeight = Math.max(currentRowHeight, height);

    if (x >= DASHBOARD_GRID_COLUMNS) {
      x = 0;
      y += currentRowHeight;
      currentRowHeight = 0;
    }

    return normalized;
  });
}

function normalizeDashboardWidgets(widgets?: DashboardWidgetConfig[]) {
  const incoming = new Map((widgets || []).map((widget) => [widget.id, widget] as const));
  const normalizedDefaults = DEFAULT_DASHBOARD_WIDGETS.map((widget) => {
    const current = incoming.get(widget.id);
    return current
      ? {
        ...widget,
        visible: current.visible,
        size: current.size,
        autoWidth: current.autoWidth,
        autoHeight: current.autoHeight,
        customDefinition: normalizeCustomWidgetDefinition(current.customDefinition),
        x: current.x,
        y: current.y,
        w: current.w,
        h: current.h,
      }
      : { ...widget };
  });

  const normalizedCustom = (widgets || [])
    .filter((widget) => !DEFAULT_DASHBOARD_WIDGETS.some((defaultWidget) => defaultWidget.id === widget.id))
    .map((widget) => ({
      ...widget,
      visible: widget.visible !== false,
      size: widget.size || 'lg',
      autoWidth: widget.autoWidth ?? (widget.customDefinition?.kind === 'chart'),
      autoHeight: widget.autoHeight ?? true,
      customDefinition: normalizeCustomWidgetDefinition(widget.customDefinition),
    }));

  const combined = [...normalizedDefaults, ...normalizedCustom];
  const hasSavedLayout = combined.some((widget) => widget.x !== undefined || widget.y !== undefined || widget.w !== undefined || widget.h !== undefined);
  return hasSavedLayout ? combined.map((widget) => ({
    ...widget,
    w: Math.min(DASHBOARD_GRID_COLUMNS, widget.w ?? getWidgetWidthFromSize(widget.size)),
    h: Math.max(3, widget.h ?? getWidgetDefaultHeight(widget)),
  })) : buildSequentialWidgetLayout(combined);
}

function normalizeDashboardViews(views?: DashboardView[]) {
  if (!Array.isArray(views) || views.length === 0) return [];

  return views.map((view, index) => ({
    id: String(view.id || `view-${Date.now()}-${index}`),
    name: String(view.name || `Vista ${index + 1}`),
    widgets: normalizeDashboardWidgets(view.widgets),
    isDefault: false,
    source: 'empresa' as const,
  }));
}

function normalizeDefaultDashboardView(view?: DashboardView | null) {
  if (!view) return createDefaultDashboardView();

  return cloneDashboardView(view, {
    id: DEFAULT_DASHBOARD_VIEW_ID,
    name: String(view.name || 'Padrao'),
    isDefault: true,
    source: 'global',
  });
}

function getDashboardActiveViewStorageKey(empresaId?: number | null) {
  return `${DASHBOARD_ACTIVE_VIEW_STORAGE_KEY_PREFIX}-${empresaId || 'unknown'}`;
}

function getDashboardViewsCacheKey(empresaId?: number | null) {
  return `${DASHBOARD_VIEWS_CACHE_KEY_PREFIX}-${empresaId || 'unknown'}`;
}

function getRowsForPixelHeight(pixels: number) {
  return Math.max(3, Math.ceil((pixels + DASHBOARD_GRID_MARGIN) / (DASHBOARD_GRID_ROW_HEIGHT + DASHBOARD_GRID_MARGIN)));
}

function optimizeVisibleLayout(layout: readonly DashboardGridItem[]) {
  const sorted = [...layout].sort((left, right) => {
    if (left.y !== right.y) return left.y - right.y;
    if (left.x !== right.x) return left.x - right.x;
    return left.i.localeCompare(right.i);
  });

  const positioned: DashboardGridLayout = [];
  const occupied = new Set<string>();

  const canPlace = (x: number, y: number, w: number, h: number) => {
    if (x + w > DASHBOARD_GRID_COLUMNS) return false;
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (occupied.has(`${col}:${row}`)) return false;
      }
    }
    return true;
  };

  const occupy = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        occupied.add(`${col}:${row}`);
      }
    }
  };

  sorted.forEach((item) => {
    const width = Math.max(2, Math.min(DASHBOARD_GRID_COLUMNS, item.w));
    const height = Math.max(3, item.h);
    let nextY = 0;
    let placed = false;

    while (!placed) {
      for (let nextX = 0; nextX <= DASHBOARD_GRID_COLUMNS - width; nextX += 1) {
        if (!canPlace(nextX, nextY, width, height)) continue;
        const positionedItem = { ...item, x: nextX, y: nextY, w: width, h: height };
        positioned.push(positionedItem);
        occupy(nextX, nextY, width, height);
        placed = true;
        break;
      }
      if (!placed) nextY += 1;
    }
  });

  const rows = new Map<number, DashboardGridLayout>();
  positioned.forEach((item) => {
    const rowItems = rows.get(item.y) || [];
    rowItems.push(item);
    rows.set(item.y, rowItems);
  });

  rows.forEach((rowItems) => {
    rowItems.sort((left, right) => left.x - right.x);
    const usedWidth = rowItems.reduce((sum, item) => sum + item.w, 0);
    const freeWidth = DASHBOARD_GRID_COLUMNS - usedWidth;
    if (freeWidth <= 0 || rowItems.length === 0) return;
    const candidate = [...rowItems].reverse().find((item) => item.w >= 4) || rowItems[rowItems.length - 1];
    candidate.w = Math.min(DASHBOARD_GRID_COLUMNS - candidate.x, candidate.w + freeWidth);
  });

  return positioned;
}

const FINANCE_DRILLDOWN_LABELS: Record<Exclude<FinanceDrilldown, null>, string> = {
  PAGAR_HOJE: 'Contas a pagar hoje',
  PAGAR_AMANHA: 'Contas a pagar amanha',
  PAGAR_ATRASADAS: 'Contas a pagar atrasadas',
  PAGAR_REALIZADAS: 'Contas a pagar realizadas',
  PAGAR_ABERTO: 'Contas a pagar em aberto',
  PAGAR_TOTAL: 'Total contas a pagar',
  RECEBER_HOJE: 'Contas a receber hoje',
  RECEBER_AMANHA: 'Contas a receber amanha',
  RECEBER_ATRASADAS: 'Contas a receber atrasadas',
  RECEBER_REALIZADAS: 'Contas a receber realizadas',
  RECEBER_ABERTO: 'Contas a receber em aberto',
  RECEBER_TOTAL: 'Total contas a receber',
};

const DASHBOARD_HELP: Record<DashboardHelpKey, { titulo: string; significado: string; calculo: string; utilidade: string }> = {
  RECEITAS: {
    titulo: 'Receitas',
    significado: 'Soma de todas as entradas filtradas no recorte atual.',
    calculo: 'Soma de valor_previsto de todos os lançamentos classificados como receita após aplicar período, conta, centro, categoria e demais filtros.',
    utilidade: 'Mostra o tamanho da geração de caixa e permite comparar rapidamente contra despesas e saldo.'
  },
  DESPESAS: {
    titulo: 'Despesas',
    significado: 'Soma de todas as saídas filtradas no recorte atual.',
    calculo: 'Soma de valor_previsto de todos os lançamentos classificados como despesa dentro do recorte ativo.',
    utilidade: 'Ajuda a localizar pressão de custo e entender quanto da operação está consumindo caixa.'
  },
  SALDO: {
    titulo: 'Saldo',
    significado: 'Diferença entre receitas e despesas dentro do recorte analisado.',
    calculo: 'Receitas menos despesas no recorte filtrado.',
    utilidade: 'Resume se o período está gerando ou destruindo caixa após todos os filtros aplicados.'
  },
  PAGOS: {
    titulo: 'Pagos',
    significado: 'Total financeiro já executado com status pago.',
    calculo: 'Soma dos lançamentos com status PAGO dentro do recorte atual.',
    utilidade: 'Mede o quanto do planejamento virou execução real e ajuda a comparar previsto contra realizado.'
  },
  MARGEM_CORRENTE: {
    titulo: 'Margem corrente',
    significado: 'Percentual do saldo sobre a receita no período filtrado.',
    calculo: 'Saldo dividido por receitas, multiplicado por 100.',
    utilidade: 'Indica se a operação está preservando resultado depois de absorver as despesas.'
  },
  TICKET_MEDIO: {
    titulo: 'Ticket médio',
    significado: 'Valor médio por lançamento dentro do recorte atual.',
    calculo: 'Soma de receitas e despesas dividida pela quantidade de lançamentos filtrados.',
    utilidade: 'Ajuda a distinguir volume operacional de concentração em poucos lançamentos grandes.'
  },
  COBERTURA_FINANCEIRA: {
    titulo: 'Cobertura financeira',
    significado: 'Percentual das despesas do recorte que já encontra cobertura no valor executado/pago.',
    calculo: 'Pagos divididos pelas despesas, multiplicado por 100.',
    utilidade: 'Mostra quão protegido o caixa está para sustentar as saídas já mapeadas. Se cair, o risco operacional sobe.'
  },
  MAIOR_PRESSAO: {
    titulo: 'Maior pressão',
    significado: 'Categoria de despesa mais pesada no recorte atual.',
    calculo: 'Maior total agregado entre as categorias de despesa filtradas.',
    utilidade: 'Aponta onde vale agir primeiro para renegociar, cortar ou redistribuir esforço financeiro.'
  },
  MAIOR_MOTOR_RECEITA: {
    titulo: 'Maior motor de receita',
    significado: 'Categoria que mais impulsiona entradas no recorte atual.',
    calculo: 'Maior total agregado entre as categorias de receita filtradas.',
    utilidade: 'Mostra a alavanca comercial ou operacional mais relevante para proteger crescimento.'
  },
  FLUXO_CAIXA: {
    titulo: 'Fluxo de caixa',
    significado: 'Compara entradas e saídas ao longo do tempo no período selecionado.',
    calculo: 'Agrupa receitas e despesas por dia ou mês e plota as duas curvas lado a lado.',
    utilidade: 'Ajuda a localizar quando o caixa aperta, onde há concentração e em quais datas vale agir primeiro.'
  },
  DESPESAS_CATEGORIA: {
    titulo: 'Despesas por categoria',
    significado: 'Ranking das categorias que mais consomem caixa.',
    calculo: 'Soma das despesas por plano de contas, ordenadas do maior para o menor valor.',
    utilidade: 'Mostra onde cortar, renegociar ou acompanhar com mais disciplina.'
  },
  RECEITAS_CATEGORIA: {
    titulo: 'Receitas por categoria',
    significado: 'Ranking das categorias que mais geram entrada.',
    calculo: 'Soma das receitas por plano de contas, ordenadas do maior para o menor valor.',
    utilidade: 'Mostra de onde vem a força da operação e o que deve ser protegido para manter crescimento.'
  },
  ACUMULADO_REC_DESP: {
    titulo: 'Acumulado de receitas x despesas',
    significado: 'Evolução acumulada das entradas e saídas no período.',
    calculo: 'Faz a soma corrida de receitas e de despesas separadamente ao longo do tempo.',
    utilidade: 'Ajuda a ver se a operação compensa a saída ao longo do período ou apenas em pontos isolados.'
  },
  RESULTADO_OPERACIONAL: {
    titulo: 'Resultado operacional',
    significado: 'Saldo mensal ou anual após confrontar receitas e despesas.',
    calculo: 'Para cada mês, calcula receitas menos despesas.',
    utilidade: 'Mostra quais meses sustentam o resultado e quais meses drenam margem.'
  },
  RESUMO_OPERACIONAL: {
    titulo: 'Resumo operacional',
    significado: 'Resumo rápido da média, melhor e pior desempenho do recorte.',
    calculo: 'Usa a série de resultado operacional para extrair média, máximo e mínimo.',
    utilidade: 'Dá uma leitura executiva sem precisar percorrer todo o gráfico principal.'
  },
  RECEITAS_DESPESAS_ANO: {
    titulo: 'Receitas x despesas do ano',
    significado: 'Comparação mensal da composição do resultado.',
    calculo: 'Empilha receitas e despesas por mês dentro do ano selecionado.',
    utilidade: 'Mostra se o problema é falta de venda, excesso de custo ou os dois.'
  },
  MARGEM_OPERACIONAL_PAINEL: {
    titulo: 'Margem operacional',
    significado: 'Percentual de sobra operacional em cada mês.',
    calculo: 'Para cada mês: (receita - despesa) dividido por receita, em percentual.',
    utilidade: 'Mostra a qualidade do resultado, não só o tamanho absoluto dele.'
  },
  COMPARATIVO_ANO: {
    titulo: 'Comparativo ano a ano',
    significado: 'Confronta o comportamento do ano atual com o anterior.',
    calculo: 'Plota as duas séries anuais de resultado operacional na mesma linha do tempo.',
    utilidade: 'Ajuda a separar piora estrutural de variação pontual.'
  },
  SAZONALIDADE: {
    titulo: 'Sazonalidade',
    significado: 'Índice de quanto cada mês fica acima ou abaixo da média de atividade.',
    calculo: 'Compara o volume total do mês com a média anual e converte em índice percentual.',
    utilidade: 'Ajuda a planejar caixa, estoque, equipe e cobrança com antecedência.'
  },
  CENARIOS: {
    titulo: 'Cenários',
    significado: 'Faixa estimada de resultado considerando a volatilidade histórica do período.',
    calculo: 'Parte do saldo atual e soma ou subtrai o desvio padrão da série de resultados mensais para formar pessimista, realista e otimista.',
    utilidade: 'Serve para planejamento e proteção de caixa, mostrando um intervalo plausível em vez de um único número.'
  },
  RESULTADO_ACUMULADO: {
    titulo: 'Resultado acumulado',
    significado: 'Curva do saldo acumulado ao longo do período.',
    calculo: 'Soma progressiva dos resultados parciais de cada ponto temporal.',
    utilidade: 'Mostra quando a empresa entrou em tração ou quando começou a perder fôlego.'
  },
  PULSO_ACUMULADO: {
    titulo: 'Pulso do acumulado',
    significado: 'Snapshot executivo da curva acumulada em quatro leituras.',
    calculo: 'Extrai o fechamento final, o maior pico, o menor vale e a amplitude da série acumulada.',
    utilidade: 'Ajuda a explicar rapidamente estabilidade, stress e volatilidade do caixa sem ler o gráfico inteiro.'
  },
  FECHAMENTO_ACUMULADO: {
    titulo: 'Fechamento',
    significado: 'Valor final da curva acumulada no período.',
    calculo: 'Último ponto do resultado acumulado.',
    utilidade: 'Resume como o caixa terminou o recorte.'
  },
  PICO_ACUMULADO: {
    titulo: 'Pico',
    significado: 'Maior nível atingido pela curva acumulada.',
    calculo: 'Maior valor observado na série de resultado acumulado.',
    utilidade: 'Mostra o melhor momento de folga do caixa.'
  },
  VALE_ACUMULADO: {
    titulo: 'Vale',
    significado: 'Menor nível atingido pela curva acumulada.',
    calculo: 'Menor valor observado na série de resultado acumulado.',
    utilidade: 'Mostra o ponto de maior aperto ou risco de caixa.'
  },
  AMPLITUDE_ACUMULADO: {
    titulo: 'Amplitude',
    significado: 'Distância entre o pico e o vale do acumulado.',
    calculo: 'Pico menos vale.',
    utilidade: 'Mede a oscilação do caixa e ajuda a dimensionar a volatilidade operacional.'
  },
  STATUS_DISTRIB: {
    titulo: 'Distribuição por status',
    significado: 'Divide o valor entre o que já foi pago e o que continua pendente.',
    calculo: 'Separa o valor total dos lançamentos em dois blocos: pagos e pendentes.',
    utilidade: 'Ajuda a medir execução versus fila financeira pendente.'
  },
  PRODUTIVIDADE: {
    titulo: 'Produtividade',
    significado: 'Painel de execução financeira e carga operacional.',
    calculo: 'Combina percentual executado, tarefas pendentes e resultado do período.',
    utilidade: 'Mostra se a operação está performando, atrasando ou entregando resultado com eficiência.'
  },
  DESPESAS_CENTRO: {
    titulo: 'Despesas por centro',
    significado: 'Ranking dos centros de custo mais pesados.',
    calculo: 'Soma as despesas por centro de custo e ordena do maior para o menor.',
    utilidade: 'Permite cobrar dono, meta e retorno por área ou unidade operacional.'
  },
  ULTIMOS_LANCAMENTOS: {
    titulo: 'Últimos lançamentos',
    significado: 'Lista analítica do recorte já filtrado.',
    calculo: 'Ordena os lançamentos por data mais recente e exibe os primeiros itens.',
    utilidade: 'Serve para validar o que está explicando os gráficos e exportar o recorte final.'
  }
};

const toDateOnly = (d: Date) => d.toISOString().split('T')[0];
const toDateOnlyStr = (s?: string) => (s ? s.split('T')[0] : '');
const toCompetencia = (s?: string) => {
  if (!s) return '';
  const [y, m] = s.split('-');
  if (!y || !m) return '';
  return `${m}-${y}`;
};
const parseDateLocal = (s?: string) => {
  const raw = toDateOnlyStr(s);
  if (!raw) return null;
  const [y, m, d] = raw.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const formatMonthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const isReceita = (tipo?: string) => (tipo || '').toUpperCase().startsWith('R');
const isDespesa = (tipo?: string) => (tipo || '').toUpperCase().startsWith('D');
const isPago = (status?: string) => (status || '').toUpperCase() === 'PAGO';

const getHeatCellClass = (ratio: number, tone: 'receita' | 'despesa') => {
  if (ratio <= 0) {
    return 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500';
  }

  if (tone === 'receita') {
    if (ratio > 0.75) return 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20';
    if (ratio > 0.5) return 'border-emerald-300 bg-emerald-200 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-500/40 dark:text-emerald-100';
    if (ratio > 0.25) return 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
    return 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';
  }

  if (ratio > 0.75) return 'border-rose-500 bg-rose-500 text-white shadow-lg shadow-rose-500/20';
  if (ratio > 0.5) return 'border-rose-300 bg-rose-200 text-rose-900 dark:border-rose-500 dark:bg-rose-500/40 dark:text-rose-100';
  if (ratio > 0.25) return 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return 'border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-500/10 dark:text-rose-300';
};

const buildExcludedCategoriaIds = (categorias: Categoria[]) => {
  const filhosPorPai = new Map<number, number[]>();
  const excluidas = new Set<number>();

  categorias.forEach((cat) => {
    const catId = Number(cat.id);
    const parentId = Number((cat as any).conta_pai_id);
    if (Number.isFinite(parentId) && parentId > 0) {
      const filhos = filhosPorPai.get(parentId) || [];
      filhos.push(catId);
      filhosPorPai.set(parentId, filhos);
    }
    if (cat.considerar_nos_resultados === false) {
      excluidas.add(catId);
    }
  });

  const fila = Array.from(excluidas);
  while (fila.length > 0) {
    const atual = fila.shift()!;
    const filhos = filhosPorPai.get(atual) || [];
    filhos.forEach((filhoId) => {
      if (!excluidas.has(filhoId)) {
        excluidas.add(filhoId);
        fila.push(filhoId);
      }
    });
  }

  return excluidas;
};

const formatTreemapLabel = (label: string, value: number, total: number) => {
  if (!label || total <= 0) return '';
  const ratio = value / total;
  const percent = `${(ratio * 100).toFixed(1)}%`;
  if (ratio >= 0.1) {
    const displayLabel = label.length > 20 ? `${label.slice(0, 20)}...` : label;
    return `${displayLabel}\n${percent}`;
  }
  if (ratio >= 0.045) return label.length > 16 ? `${label.slice(0, 16)}...` : label;
  if (ratio >= 0.025) return label.length > 10 ? `${label.slice(0, 10)}...` : label;
  return '';
};

function getMonthRange(yyyymm: string) {
  const [yearStr, monthStr] = yyyymm.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const toISO = (d: Date) => d.toISOString().split('T')[0];
  return { start: toISO(start), end: toISO(end), days: end.getDate() };
}

function getYearRange(year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const toISO = (d: Date) => d.toISOString().split('T')[0];
  return { start: toISO(start), end: toISO(end) };
}

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [lancamentosAno, setLancamentosAno] = useState<Lancamento[]>([]);
  const [lancamentosAnoAnterior, setLancamentosAnoAnterior] = useState<Lancamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [periodoTipo, setPeriodoTipo] = useState<'MES' | 'ANO' | 'PERSONALIZADO'>('MES');
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [periodoIni, setPeriodoIni] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedCategorias, setSelectedCategorias] = useState<Set<number>>(new Set());
  const [includeNaoOperacionaisCategorias, setIncludeNaoOperacionaisCategorias] = useState(false);
  const [selectedCentro, setSelectedCentro] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<'TODOS' | 'PAGO' | 'PENDENTE' | 'ATRASADO'>('TODOS');
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | 'RECEITA' | 'DESPESA'>('TODOS');
  const [previstoFiltro, setPrevistoFiltro] = useState<'TODOS' | 'SIM' | 'NAO'>('TODOS');
  const [competenciaFiltro, setCompetenciaFiltro] = useState('');
  const [filtroHojeAtivo, setFiltroHojeAtivo] = useState(false);
  const [selectedConta, setSelectedConta] = useState<number | null>(null);
  const [analysisQuery, setAnalysisQuery] = useState('');
  const [financeDrilldown, setFinanceDrilldown] = useState<FinanceDrilldown>(null);
  const [visibleKpiMeaning, setVisibleKpiMeaning] = useState<KpiTooltipState | null>(null);
  const [showDashboardFiltersSidebar, setShowDashboardFiltersSidebar] = useState(false);
  const [dashboardFiltersRailCollapsed, setDashboardFiltersRailCollapsed] = useState(false);
  const [defaultDashboardView, setDefaultDashboardView] = useState<DashboardView>(createDefaultDashboardView());
  const [dashboardViews, setDashboardViews] = useState<DashboardView[]>([]);
  const [dashboardViewsEmpresaId, setDashboardViewsEmpresaId] = useState<number | null>(null);
  const [canManageGlobalDefault, setCanManageGlobalDefault] = useState(false);
  const [activeDashboardViewId, setActiveDashboardViewId] = useState(DEFAULT_DASHBOARD_VIEW_ID);
  const [dashboardEditMode, setDashboardEditMode] = useState(false);
  const [dashboardGridWidth, setDashboardGridWidth] = useState(1200);
  const [customWidgetDraft, setCustomWidgetDraft] = useState<DashboardCustomWidgetDefinition>(DEFAULT_CUSTOM_WIDGET_DEFINITION);
  const [customWidgetModalOpen, setCustomWidgetModalOpen] = useState(false);
  const [editingCustomWidgetId, setEditingCustomWidgetId] = useState<DashboardWidgetId | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const dashboardViewsLoadedRef = useRef(false);
  const dashboardViewsSaveTimerRef = useRef<number | null>(null);
  const dashboardGridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', handler);
    return () => window.removeEventListener('theme-change', handler);
  }, []);

  useEffect(() => {
    const updateWidth = () => {
      if (dashboardGridRef.current) {
        setDashboardGridWidth(Math.max(320, Math.round(dashboardGridRef.current.offsetWidth - 16)));
      }
    };

    updateWidth();
    const resizeObserver = typeof ResizeObserver !== 'undefined' && dashboardGridRef.current
      ? new ResizeObserver(() => updateWidth())
      : null;
    if (resizeObserver && dashboardGridRef.current) {
      resizeObserver.observe(dashboardGridRef.current);
    }
    window.addEventListener('resize', updateWidth);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
      if (dashboardViewsSaveTimerRef.current) {
        window.clearTimeout(dashboardViewsSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadDashboardViewsFromApi = async () => {
      try {
        const { data } = await api.get<DashboardViewsApiResponse>('/dashboard-views/');
        if (!isMounted) return;
        const cacheKey = getDashboardViewsCacheKey(data.empresa_id);
        const cachedViewsRaw = localStorage.getItem(cacheKey);
        let cachedViews: DashboardView[] | null = null;
        if (cachedViewsRaw) {
          try {
            cachedViews = normalizeDashboardViews(JSON.parse(cachedViewsRaw) as DashboardView[]);
          } catch {
            localStorage.removeItem(cacheKey);
          }
        }
        const normalizedViews = cachedViews && cachedViews.length > 0 ? cachedViews : normalizeDashboardViews(data.views);
        const normalizedDefaultView = normalizeDefaultDashboardView(data.default_view);
        const storageKey = getDashboardActiveViewStorageKey(data.empresa_id);
        const storedActiveViewId = localStorage.getItem(storageKey);
        const availableViews = [normalizedDefaultView, ...normalizedViews];
        const nextActiveViewId = availableViews.some((view) => view.id === storedActiveViewId)
          ? String(storedActiveViewId)
          : normalizedDefaultView.id;

        setDefaultDashboardView(normalizedDefaultView);
        setDashboardViews(normalizedViews);
        setDashboardViewsEmpresaId(data.empresa_id);
        setCanManageGlobalDefault(Boolean(data.can_manage_default));
        setActiveDashboardViewId(nextActiveViewId);
      } catch {
        if (!isMounted) return;
        setDefaultDashboardView(createDefaultDashboardView());
        setDashboardViews([]);
        setCanManageGlobalDefault(false);
        setActiveDashboardViewId(DEFAULT_DASHBOARD_VIEW_ID);
      } finally {
        if (isMounted) {
          dashboardViewsLoadedRef.current = true;
        }
      }
    };

    loadDashboardViewsFromApi();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!dashboardViewsEmpresaId) return;
    localStorage.setItem(getDashboardActiveViewStorageKey(dashboardViewsEmpresaId), activeDashboardViewId);
  }, [activeDashboardViewId, dashboardViewsEmpresaId]);

  useEffect(() => {
    if (!dashboardViewsLoadedRef.current || !dashboardViewsEmpresaId) return;
    localStorage.setItem(getDashboardViewsCacheKey(dashboardViewsEmpresaId), JSON.stringify(dashboardViews));
    if (dashboardViewsSaveTimerRef.current) {
      window.clearTimeout(dashboardViewsSaveTimerRef.current);
    }

    dashboardViewsSaveTimerRef.current = window.setTimeout(() => {
      api.put('/dashboard-views/', { views: dashboardViews }).catch(() => {
        // Fallback silencioso: mantemos o estado local ativo mesmo se a sync falhar.
      });
    }, 350);
  }, [dashboardViews, dashboardViewsEmpresaId]);

  const allDashboardViews = useMemo(() => [defaultDashboardView, ...dashboardViews], [dashboardViews, defaultDashboardView]);

  const activeDashboardView = useMemo(() => {
    return allDashboardViews.find((view) => view.id === activeDashboardViewId) || defaultDashboardView;
  }, [activeDashboardViewId, allDashboardViews, defaultDashboardView]);

  const activeDashboardViewIsDefault = activeDashboardView?.id === DEFAULT_DASHBOARD_VIEW_ID;

  const activeDashboardWidgets = activeDashboardView?.widgets || DEFAULT_DASHBOARD_WIDGETS;

  const createEditableDashboardView = (sourceView?: DashboardView, name?: string): DashboardView => {
    const baseView = sourceView || activeDashboardView || defaultDashboardView;
    return cloneDashboardView(baseView, {
      id: `view-${Date.now()}`,
      name: name?.trim() || `Vista ${dashboardViews.length + 1}`,
      isDefault: false,
      source: 'empresa',
    });
  };

  const updateActiveDashboardView = (updater: (view: DashboardView) => DashboardView) => {
    if (activeDashboardViewIsDefault) {
      const nextView = cloneDashboardView(updater(createEditableDashboardView(activeDashboardView)), {
        isDefault: false,
        source: 'empresa',
      });
      setDashboardViews((prev) => [...prev, nextView]);
      setActiveDashboardViewId(nextView.id);
      return;
    }

    setDashboardViews((prev) => {
      const current = prev.find((view) => view.id === activeDashboardViewId) || createEditableDashboardView();
      const next = updater({ ...current, widgets: normalizeDashboardWidgets(current.widgets).map((widget) => ({ ...widget })) });
      const exists = prev.some((view) => view.id === next.id);
      if (!exists) return [...prev, { ...next, widgets: normalizeDashboardWidgets(next.widgets) }];
      return prev.map((view) => view.id === next.id ? { ...next, widgets: normalizeDashboardWidgets(next.widgets) } : view);
    });
  };

  const updateActiveWidget = (widgetId: DashboardWidgetId, patch: Partial<DashboardWidgetConfig>) => {
    updateActiveDashboardView((view) => ({
      ...view,
      widgets: view.widgets.map((widget) => {
        if (widget.id !== widgetId) return widget;
        const nextWidget = { ...widget, ...patch };
        if (patch.size) {
          nextWidget.w = getWidgetWidthFromSize(patch.size);
        }
        return nextWidget;
      }),
    }));
  };

  const updateActiveWidgetLayout = (layout: readonly DashboardGridItem[]) => {
    const optimizedLayout = optimizeVisibleLayout([...layout]);
    updateActiveDashboardView((view) => {
      const layoutMap = new Map(optimizedLayout.map((item) => [item.i, item] as const));
      return {
        ...view,
        widgets: view.widgets.map((widget) => {
          const nextLayout = layoutMap.get(widget.id);
          if (!nextLayout) return widget;
          const manuallyMoved = widget.x !== nextLayout.x || widget.y !== nextLayout.y;
          const manuallyResized = widget.w !== nextLayout.w || widget.h !== nextLayout.h;
          return {
            ...widget,
            x: nextLayout.x,
            y: nextLayout.y,
            w: nextLayout.w,
            h: nextLayout.h,
            size: getWidgetSizeFromWidth(nextLayout.w),
            autoWidth: widget.autoWidth && (manuallyMoved || manuallyResized) ? false : widget.autoWidth,
            autoHeight: widget.autoHeight && manuallyResized ? false : widget.autoHeight,
          };
        }),
      };
    });
  };

  const flushDashboardViewsSave = () => {
    if (!dashboardViewsEmpresaId) return;
    localStorage.setItem(getDashboardViewsCacheKey(dashboardViewsEmpresaId), JSON.stringify(dashboardViews));
    api.put('/dashboard-views/', { views: dashboardViews }).catch(() => {
      // Mantemos cache local como fallback se o backend não responder.
    });
  };

  const toggleDashboardEditMode = () => {
    setDashboardEditMode((prev) => {
      const next = !prev;
      if (prev && !next) {
        if (dashboardViewsSaveTimerRef.current) {
          window.clearTimeout(dashboardViewsSaveTimerRef.current);
          dashboardViewsSaveTimerRef.current = null;
        }
        window.setTimeout(() => flushDashboardViewsSave(), 0);
      }
      return next;
    });
  };

  const createDashboardViewFromCurrent = () => {
    const nextView = createEditableDashboardView(activeDashboardView);
    setDashboardViews((prev) => [...prev, nextView]);
    setActiveDashboardViewId(nextView.id);
    setDashboardEditMode(true);
  };

  const publishCurrentViewAsGlobalDefault = async () => {
    if (!canManageGlobalDefault || !dashboardViewsEmpresaId || !activeDashboardView) return;
    const normalizedDefaultView = cloneDashboardView(activeDashboardView, {
      id: DEFAULT_DASHBOARD_VIEW_ID,
      name: 'Padrao',
      isDefault: true,
      source: 'global',
    });
    setDefaultDashboardView(normalizedDefaultView);
    try {
      await api.put('/dashboard-views/', {
        views: dashboardViews,
        default_view: normalizedDefaultView,
        update_default: true,
      });
    } catch {
      // O estado local permanece para evitar perder o trabalho do super consultor.
    }
  };

  const openCreateCustomWidgetModal = (template?: DashboardCustomWidgetTemplate) => {
    setEditingCustomWidgetId(null);
    setCustomWidgetDraft(normalizeCustomWidgetDefinition(template?.definition) || {
      ...DEFAULT_CUSTOM_WIDGET_DEFINITION,
      title: resolveCustomWidgetTitle(DEFAULT_CUSTOM_WIDGET_DEFINITION.kind),
    });
    setCustomWidgetModalOpen(true);
  };

  const openEditCustomWidgetModal = (widget: DashboardWidgetConfig) => {
    if (!widget.customDefinition) return;
    setEditingCustomWidgetId(widget.id);
    setCustomWidgetDraft(normalizeCustomWidgetDefinition(widget.customDefinition) || DEFAULT_CUSTOM_WIDGET_DEFINITION);
    setCustomWidgetModalOpen(true);
  };

  const closeCustomWidgetModal = () => {
    setCustomWidgetModalOpen(false);
    setEditingCustomWidgetId(null);
    setCustomWidgetDraft(DEFAULT_CUSTOM_WIDGET_DEFINITION);
  };

  const applyCustomWidgetTemplate = (template: DashboardCustomWidgetTemplate) => {
    setCustomWidgetDraft(normalizeCustomWidgetDefinition(template.definition) || DEFAULT_CUSTOM_WIDGET_DEFINITION);
  };

  const createCustomDashboardWidget = () => {
    const definition = normalizeCustomWidgetDefinition(customWidgetDraft);
    if (!definition || !definition.title.trim()) return;

    if (editingCustomWidgetId) {
      updateActiveDashboardView((view) => ({
        ...view,
        widgets: view.widgets.map((widget) => {
          if (widget.id !== editingCustomWidgetId) return widget;
          return {
            ...widget,
            size: definition.kind === 'kpi' ? 'sm' : widget.size,
            autoWidth: definition.kind === 'chart',
            autoHeight: true,
            customDefinition: definition,
          };
        }),
      }));
    } else {
      const widgetId = `custom_${Date.now()}`;
      const nextWidget: DashboardWidgetConfig = {
        id: widgetId,
        visible: true,
        size: definition.kind === 'kpi' ? 'sm' : 'lg',
        autoWidth: definition.kind === 'chart',
        autoHeight: true,
        customDefinition: definition,
      };

      updateActiveDashboardView((view) => ({
        ...view,
        widgets: [...view.widgets, nextWidget],
      }));
    }

    closeCustomWidgetModal();
    setDashboardEditMode(true);
  };

  const deleteCustomDashboardWidget = (widgetId: DashboardWidgetId) => {
    updateActiveDashboardView((view) => ({
      ...view,
      widgets: view.widgets.filter((widget) => widget.id !== widgetId),
    }));
  };

  const resetActiveDashboardView = () => {
    if (activeDashboardViewIsDefault) {
      setActiveDashboardViewId(DEFAULT_DASHBOARD_VIEW_ID);
      return;
    }
    updateActiveDashboardView((view) => ({
      ...view,
      widgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
    }));
  };

  const deleteActiveDashboardView = () => {
    if (activeDashboardViewIsDefault) {
      return;
    }
    setDashboardViews((prev) => {
      const filtered = prev.filter((view) => view.id !== activeDashboardViewId);
      return filtered;
    });
    setActiveDashboardViewId(DEFAULT_DASHBOARD_VIEW_ID);
  };

  const visibleDashboardWidgets = useMemo(
    () => activeDashboardWidgets.filter((widget) => widget.visible),
    [activeDashboardWidgets]
  );

  const hiddenDashboardWidgets = useMemo(
    () => activeDashboardWidgets.filter((widget) => !widget.visible),
    [activeDashboardWidgets]
  );

  const dashboardGridCols = useMemo(() => {
    if (dashboardGridWidth < 480) return 1;
    if (dashboardGridWidth < 768) return 2;
    if (dashboardGridWidth < 996) return 4;
    if (dashboardGridWidth < 1200) return 8;
    return 12;
  }, [dashboardGridWidth]);

  const categoriasExcluidasResultado = useMemo(() => buildExcludedCategoriaIds(categorias), [categorias]);

  const matchesDashboardFilters = (l: Lancamento, includeOperational = false) => {
    const hoje = toDateOnly(new Date());
    if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
    if (includeOperational && categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
    if (filtroHojeAtivo && toDateOnlyStr(l.data_vencimento) !== hoje) return false;
    const isPrevisto = l.previsto !== false;
    if (previstoFiltro === 'SIM' && !isPrevisto) return false;
    if (previstoFiltro === 'NAO' && isPrevisto) return false;
    if (competenciaFiltro) {
      const comp = l.competencia || toCompetencia(l.data_vencimento);
      if (comp !== competenciaFiltro) return false;
    }
    if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
    if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
    if (selectedConta && Number((l as any).conta_id) !== Number(selectedConta)) return false;
    if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
    if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
    if (statusFiltro === 'ATRASADO' && (isPago(l.status) || toDateOnlyStr(l.data_vencimento) >= hoje)) return false;
    if (statusFiltro === 'PENDENTE' && (isPago(l.status) || toDateOnlyStr(l.data_vencimento) < hoje)) return false;
    if (statusFiltro === 'PAGO' && String(l.status).toUpperCase() !== 'PAGO') return false;
    if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
    if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
    return true;
  };

  const matchesDashboardFiltersNoDate = (l: Lancamento, includeOperational = false) => {
    const hoje = toDateOnly(new Date());
    if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
    if (includeOperational && categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
    if (filtroHojeAtivo && toDateOnlyStr(l.data_vencimento) !== hoje) return false;
    const isPrevisto = l.previsto !== false;
    if (previstoFiltro === 'SIM' && !isPrevisto) return false;
    if (previstoFiltro === 'NAO' && isPrevisto) return false;
    if (competenciaFiltro) {
      const comp = l.competencia || toCompetencia(l.data_vencimento);
      if (comp !== competenciaFiltro) return false;
    }
    if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
    if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
    if (selectedConta && Number((l as any).conta_id) !== Number(selectedConta)) return false;
    if (statusFiltro === 'ATRASADO' && (isPago(l.status) || toDateOnlyStr(l.data_vencimento) >= hoje)) return false;
    if (statusFiltro === 'PENDENTE' && (isPago(l.status) || toDateOnlyStr(l.data_vencimento) < hoje)) return false;
    if (statusFiltro === 'PAGO' && String(l.status).toUpperCase() !== 'PAGO') return false;
    if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
    if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
    return true;
  };

  useEffect(() => {
    loadDashboard();
  }, [mes, ano, periodoIni, periodoFim, periodoTipo]);

  useEffect(() => {
    setSelectedDate(null);
    setSelectedMonth(null);
    setFinanceDrilldown(null);
  }, [mes, ano, periodoIni, periodoFim, periodoTipo]);

  async function loadDashboard() {
    setLoading(true);
    try {
      let start: string;
      let end: string;
      let yearBase: number;
      if (periodoTipo === 'ANO') {
        ({ start, end } = getYearRange(ano));
        yearBase = ano;
      } else if (periodoTipo === 'PERSONALIZADO') {
        start = periodoIni;
        end = periodoFim;
        yearBase = new Date(periodoIni).getFullYear();
      } else {
        ({ start, end } = getMonthRange(mes));
        yearBase = Number(mes.slice(0, 4));
      }
      const { start: startYear, end: endYear } = getYearRange(yearBase);
      const { start: startPrev, end: endPrev } = getYearRange(yearBase - 1);
      const [rLanc, rCats, rCentros, rTodos, rContas] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 5000, data_inicio: start, data_fim: end } }),
        api.get('/plano-contas/'),
        api.get('/centro-custo/'),
        api.get('/todos/me'),
        api.get('/contas/', { params: { include_saldo: false } })
      ]);
      const [rLancAno, rLancAnoAnterior] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 10000, data_inicio: startYear, data_fim: endYear } }),
        api.get('/lancamentos/', { params: { limit: 10000, data_inicio: startPrev, data_fim: endPrev } })
      ]);
      setLancamentos(rLanc.data || []);
      setLancamentosAno(rLancAno.data || []);
      setLancamentosAnoAnterior(rLancAnoAnterior.data || []);
      setCategorias(rCats.data || []);
      setCentros(rCentros.data || []);
      setContas(rContas.data || []);
      setTodos(rTodos.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await loadDashboard();
    } finally {
      setSyncing(false);
    }
  }

  const hojeIso = toDateOnly(new Date());
  const amanhaIso = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const toggleFinanceDrilldown = (next: Exclude<FinanceDrilldown, null>) => {
    setFinanceDrilldown((prev) => prev === next ? null : next);
  };

  const scheduleKpiMeaning = (key: DashboardHelpKey, ...args: [HTMLElement?, number?]) => {
    const delay = typeof args[1] === 'number' ? args[1] : 650;
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setVisibleKpiMeaning({ key });
    }, delay);
  };

  const hideKpiMeaning = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setVisibleKpiMeaning(null);
  };

  const matchesFinanceDrilldown = (lancamento: Lancamento, scope: 'PAGAR' | 'RECEBER') => {
    if (scope === 'PAGAR' && !isDespesa(lancamento.tipo)) return false;
    if (scope === 'RECEBER' && !isReceita(lancamento.tipo)) return false;
    if (!financeDrilldown || !financeDrilldown.startsWith(scope)) return true;

    const vencimento = toDateOnlyStr(lancamento.data_vencimento);
    const pago = isPago(lancamento.status);

    switch (financeDrilldown) {
      case 'PAGAR_HOJE':
      case 'RECEBER_HOJE':
        return !pago && vencimento === hojeIso;
      case 'PAGAR_AMANHA':
      case 'RECEBER_AMANHA':
        return !pago && vencimento === amanhaIso;
      case 'PAGAR_ATRASADAS':
      case 'RECEBER_ATRASADAS':
        return !pago && vencimento < hojeIso;
      case 'PAGAR_REALIZADAS':
      case 'RECEBER_REALIZADAS':
        return pago;
      case 'PAGAR_ABERTO':
      case 'RECEBER_ABERTO':
        return !pago;
      case 'PAGAR_TOTAL':
      case 'RECEBER_TOTAL':
      default:
        return true;
    }
  };

  const filteredLancamentos = useMemo(() => {
    return lancamentos.filter((l) => matchesDashboardFilters(l, false));
  }, [lancamentos, selectedCategorias, selectedCentro, selectedConta, selectedDate, selectedMonth, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalFilteredLancamentos = useMemo(() => {
    return lancamentos.filter((l) => matchesDashboardFilters(l, true));
  }, [lancamentos, selectedCategorias, selectedCentro, selectedConta, selectedDate, selectedMonth, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalBaseFilteredNoDate = useMemo(() => {
    return lancamentosAno.filter((l) => matchesDashboardFiltersNoDate(l, true));
  }, [lancamentosAno, selectedCategorias, selectedCentro, selectedConta, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalBaseFilteredAnoAnterior = useMemo(() => {
    return lancamentosAnoAnterior.filter((l) => matchesDashboardFiltersNoDate(l, true));
  }, [lancamentosAnoAnterior, selectedCategorias, selectedCentro, selectedConta, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const kpis = useMemo(() => {
    let receitas = 0; let despesas = 0; let pagos = 0; let pendentes = 0;
    filteredLancamentos.forEach(l => {
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) receitas += val;
      else despesas += val;
      if (isPago(l.status)) pagos += val; else pendentes += val;
    });
    return { receitas, despesas, saldo: receitas - despesas, pagos, pendentes };
  }, [filteredLancamentos]);

  const operationalKpis = useMemo(() => {
    let receitas = 0; let despesas = 0; let pagos = 0; let pendentes = 0;
    operationalFilteredLancamentos.forEach(l => {
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) receitas += val;
      else despesas += val;
      if (isPago(l.status)) pagos += val; else pendentes += val;
    });
    return { receitas, despesas, saldo: receitas - despesas, pagos, pendentes };
  }, [operationalFilteredLancamentos]);

  const categoriaPorId = useMemo(() => new Map(categorias.map((categoria) => [Number(categoria.id), categoria.nome])), [categorias]);
  const centroPorId = useMemo(() => new Map(centros.map((centro) => [Number(centro.id), centro.nome])), [centros]);
  const contaPorId = useMemo(() => new Map(contas.map((conta) => [Number(conta.id), conta])), [contas]);

  const aiContexto = useMemo(() => {
    return {
      periodo: { tipo: periodoTipo, mes, ano, inicio: periodoIni, fim: periodoFim },
      filtros: {
        status: statusFiltro,
        tipo: tipoFiltro,
        previsto: previstoFiltro,
        competencia: competenciaFiltro,
        hoje: filtroHojeAtivo,
        categoriasSelecionadas: Array.from(selectedCategorias),
        centroCustoSelecionado: selectedCentro,
        contaSelecionada: selectedConta,
        drilldownFinanceiro: financeDrilldown,
      },
      metricas: {
        totalLancamentosFiltrados: filteredLancamentos.length,
        receitas: kpis.receitas,
        despesas: kpis.despesas,
        saldo: kpis.saldo,
        pagos: kpis.pagos,
        pendentes: kpis.pendentes,
      },
      metricas_operacionais: {
        totalLancamentosOperacionais: operationalFilteredLancamentos.length,
        receitas: operationalKpis.receitas,
        despesas: operationalKpis.despesas,
        saldo: operationalKpis.saldo,
        pagos: operationalKpis.pagos,
        pendentes: operationalKpis.pendentes,
      },
    };
  }, [periodoTipo, mes, ano, periodoIni, periodoFim, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, selectedCategorias, selectedCentro, selectedConta, financeDrilldown, filteredLancamentos.length, kpis, operationalFilteredLancamentos.length, operationalKpis]);

  const fluxoDiario = useMemo(() => {
    if (periodoTipo === 'ANO') {
      const rec: number[] = Array(12).fill(0);
      const desp: number[] = Array(12).fill(0);
      operationalFilteredLancamentos.forEach(l => {
        const d = parseDateLocal(l.data_vencimento);
        if (!d) return;
        const idx = d.getMonth();
        const val = Number(l.valor_previsto || 0);
        if (isReceita(l.tipo)) rec[idx] += val;
        else desp[idx] += val;
      });
      const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const indexToDate = labels.map((_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
      return { labels, rec, desp, indexToDate, mode: 'MONTH' as const };
    }

    let dates: string[] = [];
    if (periodoTipo === 'PERSONALIZADO') {
      const start = new Date(periodoIni);
      const end = new Date(periodoFim);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(toDateOnly(new Date(d)));
      }
    } else {
      const { days } = getMonthRange(mes);
      dates = Array.from({ length: days }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
    }

    const rec: number[] = Array(dates.length).fill(0);
    const desp: number[] = Array(dates.length).fill(0);
    const idxMap = new Map(dates.map((d, i) => [d, i] as const));

    filteredLancamentos.forEach(l => {
      const date = toDateOnlyStr(l.data_vencimento);
      const idx = idxMap.get(date);
      if (idx === undefined) return;
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val;
      else desp[idx] += val;
    });

    const labels = dates.map(d => d.split('-')[2]);
    return { labels, rec, desp, indexToDate: dates, mode: 'DAY' as const };
  }, [operationalFilteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo]);

  const resultadoMensal = useMemo(() => {
    const map = new Map<string, { rec: number; desp: number }>();
    operationalFilteredLancamentos.forEach(l => {
      const date = toDateOnlyStr(l.data_vencimento);
      if (!date) return;
      const key = date.slice(0, 7);
      if (!map.has(key)) map.set(key, { rec: 0, desp: 0 });
      const val = Number(l.valor_previsto || 0);
      const bucket = map.get(key)!;
      if (isReceita(l.tipo)) bucket.rec += val;
      else bucket.desp += val;
    });
    const keys = Array.from(map.keys()).sort();
    const values = keys.map(k => {
      const v = map.get(k)!;
      return v.rec - v.desp;
    });
    return { keys, labels: keys.map(formatMonthLabel), values };
  }, [operationalFilteredLancamentos]);

  const resultadoMensalAno = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() : Number(mes.slice(0, 4)));

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    operationalBaseFilteredNoDate.forEach(l => {
      const d = parseDateLocal(l.data_vencimento);
      if (!d || d.getFullYear() !== yearBase) return;
      const idx = d.getMonth();
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val; else desp[idx] += val;
    });

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const values = rec.map((r, i) => r - desp[i]);
    const margem = rec.map((r, i) => r > 0 ? Math.round(((r - desp[i]) / r) * 100) : 0);
    return { year: yearBase, labels, rec, desp, values, margem };
  }, [operationalBaseFilteredNoDate, periodoTipo, ano, periodoIni, mes]);

  const resultadoMensalAnoAnterior = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano - 1
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() - 1 : Number(mes.slice(0, 4)) - 1);

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    operationalBaseFilteredAnoAnterior.forEach(l => {
      const d = parseDateLocal(l.data_vencimento);
      if (!d || d.getFullYear() !== yearBase) return;
      const idx = d.getMonth();
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val; else desp[idx] += val;
    });

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const values = rec.map((r, i) => r - desp[i]);
    return { year: yearBase, labels, values };
  }, [operationalBaseFilteredAnoAnterior, periodoTipo, ano, periodoIni, mes]);

  const sazonalidadeIndice = useMemo(() => {
    const totalMes = resultadoMensalAno.rec.map((r, i) => r + resultadoMensalAno.desp[i]);
    const avg = totalMes.reduce((acc, v) => acc + v, 0) / (totalMes.length || 1);
    const values = totalMes.map(v => avg > 0 ? Math.round((v / avg) * 100) : 0);
    return { labels: resultadoMensalAno.labels, values };
  }, [resultadoMensalAno]);

  const resultadoAcumulado = useMemo(() => {
    const values = fluxoDiario.rec.map((rec, idx) => rec - (fluxoDiario.desp[idx] || 0));
    const acum: number[] = [];
    values.reduce((acc, v) => {
      const next = acc + v;
      acum.push(next);
      return next;
    }, 0);
    return { labels: fluxoDiario.labels, values: acum };
  }, [fluxoDiario]);

  const acumuladoRecDesp = useMemo(() => {
    const rec: number[] = [];
    const desp: number[] = [];
    fluxoDiario.rec.reduce((acc, v) => {
      const next = acc + v;
      rec.push(next);
      return next;
    }, 0);
    fluxoDiario.desp.reduce((acc, v) => {
      const next = acc + v;
      desp.push(next);
      return next;
    }, 0);
    return { labels: fluxoDiario.labels, rec, desp };
  }, [fluxoDiario]);

  const statusDistrib = useMemo(() => {
    const atrasados = operationalFilteredLancamentos
      .filter(l => !isPago(l.status) && toDateOnlyStr(l.data_vencimento) < hojeIso)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const pagos = operationalFilteredLancamentos.filter(l => isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const pendentes = operationalFilteredLancamentos
      .filter(l => !isPago(l.status) && toDateOnlyStr(l.data_vencimento) >= hojeIso)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    return { pagos, pendentes, atrasados };
  }, [hojeIso, operationalFilteredLancamentos]);

  const categoryChartLancamentos = useMemo(() => {
    return includeNaoOperacionaisCategorias ? filteredLancamentos : operationalFilteredLancamentos;
  }, [filteredLancamentos, includeNaoOperacionaisCategorias, operationalFilteredLancamentos]);

  const despesasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    categoryChartLancamentos.forEach(l => {
      if (!isDespesa(l.tipo)) return;
      const catId = Number(l.plano_contas_id);
      if (!catId) return;
      map.set(catId, (map.get(catId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cat = categorias.find(c => Number(c.id) === Number(id));
      return { id, label: cat?.nome || `Categoria ${id}`, total };
    }).sort((a, b) => b.total - a.total);

    const top = rows.slice(0, 12);
    const others = rows.slice(12).reduce((acc, r) => acc + r.total, 0);
    if (others > 0) top.push({ id: -1, label: 'Outros', total: others });
    return top;
  }, [categoryChartLancamentos, categorias]);

  const receitasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    categoryChartLancamentos.forEach(l => {
      if (!isReceita(l.tipo)) return;
      const catId = Number(l.plano_contas_id);
      if (!catId) return;
      map.set(catId, (map.get(catId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cat = categorias.find(c => Number(c.id) === Number(id));
      return { id, label: cat?.nome || `Categoria ${id}`, total };
    }).sort((a, b) => b.total - a.total);

    const top = rows.slice(0, 8);
    const others = rows.slice(8).reduce((acc, r) => acc + r.total, 0);
    if (others > 0) top.push({ id: -1, label: 'Outros', total: others });
    return top;
  }, [categoryChartLancamentos, categorias]);

  const despesasTreemapData = useMemo(() => despesasPorCategoria.map(r => ({ x: r.label, y: r.total })), [despesasPorCategoria]);
  const receitasTreemapData = useMemo(() => receitasPorCategoria.map(r => ({ x: r.label, y: r.total })), [receitasPorCategoria]);
  const totalDespesasTreemap = useMemo(() => despesasTreemapData.reduce((acc, item) => acc + item.y, 0), [despesasTreemapData]);
  const totalReceitasTreemap = useMemo(() => receitasTreemapData.reduce((acc, item) => acc + item.y, 0), [receitasTreemapData]);
  const despesasCategoriaResumo = useMemo(() => despesasPorCategoria.map((item) => ({
    ...item,
    percentual: totalDespesasTreemap > 0 ? (item.total / totalDespesasTreemap) * 100 : 0,
  })), [despesasPorCategoria, totalDespesasTreemap]);
  const receitasCategoriaResumo = useMemo(() => receitasPorCategoria.map((item) => ({
    ...item,
    percentual: totalReceitasTreemap > 0 ? (item.total / totalReceitasTreemap) * 100 : 0,
  })), [receitasPorCategoria, totalReceitasTreemap]);

  const despesasPorCentro = useMemo(() => {
    const map = new Map<number, number>();
    operationalFilteredLancamentos.forEach(l => {
      if (!isDespesa(l.tipo)) return;
      const ccId = Number(l.centro_custo_id);
      if (!ccId) return;
      map.set(ccId, (map.get(ccId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cc = centros.find(c => Number(c.id) === Number(id));
      return { id, label: cc?.nome || `Centro ${id}`, total };
    }).sort((a, b) => b.total - a.total);
    return rows.slice(0, 8);
  }, [operationalFilteredLancamentos, centros]);

  const contasHoje = useMemo(() => {
    const hoje = toDateOnly(new Date());
    const amanha = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));
    let start: string;
    let end: string;
    if (periodoTipo === 'ANO') {
      ({ start, end } = getYearRange(ano));
    } else if (periodoTipo === 'PERSONALIZADO') {
      start = periodoIni;
      end = periodoFim;
    } else {
      ({ start, end } = getMonthRange(mes));
    }

    const base = operationalFilteredLancamentos.filter(l => l.data_vencimento && l.data_vencimento >= start && l.data_vencimento <= end);

    const calc = (tipoCheck: (t?: string) => boolean) => {
      const hojeList = base.filter(l => l.data_vencimento === hoje && tipoCheck(l.tipo) && !isPago(l.status));
      const amanhaList = base.filter(l => l.data_vencimento === amanha && tipoCheck(l.tipo) && !isPago(l.status));
      const atrasadasList = base.filter(l => l.data_vencimento < hoje && tipoCheck(l.tipo) && !isPago(l.status));
      const totalMes = base.filter(l => tipoCheck(l.tipo)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
      const realizadas = base.filter(l => tipoCheck(l.tipo) && isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
      const emAberto = base.filter(l => tipoCheck(l.tipo) && !isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);

      return {
        hoje: hojeList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        amanha: amanhaList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        atrasadas: atrasadasList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        totalMes,
        realizadas,
        emAberto
      };
    };

    return {
      pagar: calc(isDespesa),
      receber: calc(isReceita)
    };
  }, [operationalFilteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo, selectedDate]);

  const lancamentosContasDetalhe = useMemo(() => {
    const sorted = [...filteredLancamentos].sort((a, b) => {
      const da = parseDateLocal(a.data_vencimento)?.getTime() || 0;
      const db = parseDateLocal(b.data_vencimento)?.getTime() || 0;
      return db - da;
    });
    return {
      pagar: sorted.filter((l) => matchesFinanceDrilldown(l, 'PAGAR')).slice(0, 20),
      receber: sorted.filter((l) => matchesFinanceDrilldown(l, 'RECEBER')).slice(0, 20),
    };
  }, [filteredLancamentos, financeDrilldown]);

  const categoriaLancamentos = useMemo(() => {
    if (selectedCategorias.size === 0) return [] as Lancamento[];
    return filteredLancamentos
      .filter(l => selectedCategorias.has(Number(l.plano_contas_id)))
      .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 50);
  }, [filteredLancamentos, selectedCategorias]);

  const diaLancamentos = useMemo(() => {
    if (!selectedDate) return [] as Lancamento[];
    return lancamentos
      .filter(l => {
        if (toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
        if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
        if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
        return true;
      })
        .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 50);
  }, [lancamentos, selectedDate, selectedCentro, selectedCategorias]);

  const categoriasList = useMemo(() => {
    return despesasPorCategoria.map(item => ({
      ...item,
      active: selectedCategorias.has(item.id)
    }));
  }, [despesasPorCategoria, selectedCategorias]);

  const topLancamentos = useMemo(() => {
    const base = selectedDate
      ? filteredLancamentos.filter(l => toDateOnlyStr(l.data_vencimento) === selectedDate)
      : selectedMonth
        ? filteredLancamentos.filter(l => toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth))
        : filteredLancamentos;

    return [...base]
        .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 12);
  }, [filteredLancamentos, selectedDate, selectedMonth]);

  const heatmapReferenceMonth = useMemo(() => {
    if (selectedDate) return selectedDate.slice(0, 7);
    if (selectedMonth) return selectedMonth;
    if (periodoTipo === 'MES') return mes;
    if (periodoTipo === 'ANO') {
      const month = ano === new Date().getFullYear() ? String(new Date().getMonth() + 1).padStart(2, '0') : '01';
      return `${ano}-${month}`;
    }
    return periodoIni.slice(0, 7);
  }, [selectedDate, selectedMonth, periodoTipo, mes, ano, periodoIni]);

  const heatmapCalendario = useMemo(() => {
    const { start, end } = getMonthRange(heatmapReferenceMonth);
    const startDate = parseDateLocal(start) || new Date();
    const endDate = parseDateLocal(end) || new Date();
    const weekLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const receitasMap = new Map<string, number>();
    const despesasMap = new Map<string, number>();

    filteredLancamentos.forEach((lancamento) => {
      const date = toDateOnlyStr(lancamento.data_vencimento);
      if (!date.startsWith(heatmapReferenceMonth)) return;
      const value = Number(lancamento.valor_previsto || 0);
      if (isReceita(lancamento.tipo)) {
        receitasMap.set(date, (receitasMap.get(date) || 0) + value);
      } else {
        despesasMap.set(date, (despesasMap.get(date) || 0) + value);
      }
    });

    const firstCell = new Date(startDate);
    firstCell.setDate(startDate.getDate() - startDate.getDay());
    const lastCell = new Date(endDate);
    lastCell.setDate(endDate.getDate() + (6 - endDate.getDay()));

    const cells: Array<{ date: string; dayLabel: string; isCurrentMonth: boolean; receita: number; despesa: number; weekIndex: number; weekdayIndex: number }> = [];
    let cursor = new Date(firstCell);
    let weekIndex = 0;
    while (cursor <= lastCell) {
      const currentDate = toDateOnly(cursor);
      cells.push({
        date: currentDate,
        dayLabel: String(cursor.getDate()).padStart(2, '0'),
        isCurrentMonth: currentDate.startsWith(heatmapReferenceMonth),
        receita: receitasMap.get(currentDate) || 0,
        despesa: despesasMap.get(currentDate) || 0,
        weekIndex,
        weekdayIndex: cursor.getDay(),
      });
      if (cursor.getDay() === 6) weekIndex += 1;
      cursor.setDate(cursor.getDate() + 1);
    }

    const maxReceita = Math.max(...cells.map((cell) => cell.receita), 0);
    const maxDespesa = Math.max(...cells.map((cell) => cell.despesa), 0);

    return {
      monthLabel: formatMonthLabel(heatmapReferenceMonth),
      weekLabels,
      weeks: Array.from({ length: Math.max(...cells.map((cell) => cell.weekIndex), 0) + 1 }, (_, index) => ({
        label: `S${index + 1}`,
        cells: cells.filter((cell) => cell.weekIndex === index),
      })),
      maxReceita,
      maxDespesa,
    };
  }, [filteredLancamentos, heatmapReferenceMonth]);

  const bancosEmFoco = useMemo(() => {
    const grouped = new Map<number, { contaId: number; nome: string; banco: string; total: number; saldo: number; quantidade: number }>();

    filteredLancamentos.forEach((lancamento) => {
      const contaId = Number((lancamento as any).conta_id);
      if (!Number.isFinite(contaId) || contaId <= 0) return;

      const conta = contaPorId.get(contaId);
      const current = grouped.get(contaId) || {
        contaId,
        nome: conta?.nome || `Conta ${contaId}`,
        banco: conta?.banco || 'Banco não informado',
        total: 0,
        saldo: 0,
        quantidade: 0,
      };
      const valor = Number(lancamento.valor_previsto || 0);
      current.total += valor;
      current.saldo += isReceita(lancamento.tipo) ? valor : -valor;
      current.quantidade += 1;
      grouped.set(contaId, current);
    });

    return Array.from(grouped.values())
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 6);
  }, [filteredLancamentos, contaPorId]);

  const margemPercentual = operationalKpis.receitas > 0 ? (operationalKpis.saldo / operationalKpis.receitas) * 100 : 0;
  const ticketMedio = operationalFilteredLancamentos.length > 0 ? (operationalKpis.receitas + operationalKpis.despesas) / operationalFilteredLancamentos.length : 0;
  const coberturaPagamentos = operationalKpis.despesas > 0 ? (operationalKpis.pagos / operationalKpis.despesas) * 100 : 0;
  const mixFinanceiro = useMemo(() => {
    const total = operationalKpis.receitas + operationalKpis.despesas;
    if (total <= 0) {
      return { receitaPct: 50, despesaPct: 50 };
    }
    return {
      receitaPct: (operationalKpis.receitas / total) * 100,
      despesaPct: (operationalKpis.despesas / total) * 100,
    };
  }, [operationalKpis.despesas, operationalKpis.receitas]);

  const sinaisExecutivos = useMemo(() => {
    const receitaDominante = receitasPorCategoria[0];
    const despesaDominante = despesasPorCategoria[0];
    return [
      {
        key: 'MARGEM_CORRENTE' as const,
        titulo: 'Margem corrente',
        valor: `${margemPercentual.toFixed(1)}%`,
        apoio: margemPercentual >= 0 ? 'Resultado operacional saudável no recorte.' : 'Despesas comprimindo o caixa no recorte.',
        destaque: margemPercentual >= 0 ? 'text-emerald-600' : 'text-rose-500',
      },
      {
        key: 'TICKET_MEDIO' as const,
        titulo: 'Ticket médio',
        valor: BRL.format(ticketMedio),
        apoio: `${filteredLancamentos.length} lançamentos considerados após os filtros.`,
        destaque: 'text-slate-900 dark:text-white',
      },
      {
        key: 'COBERTURA_FINANCEIRA' as const,
        titulo: 'Cobertura financeira',
        valor: `${coberturaPagamentos.toFixed(1)}%`,
        apoio: 'Percentual do valor filtrado já executado/pago.',
        destaque: 'text-indigo-600',
      },
      {
        key: 'MAIOR_PRESSAO' as const,
        titulo: 'Maior pressão',
        valor: despesaDominante ? despesaDominante.label : 'Sem destaque',
        apoio: despesaDominante ? BRL.format(despesaDominante.total) : 'Sem despesas relevantes no período.',
        destaque: 'text-rose-500',
      },
      {
        key: 'MAIOR_MOTOR_RECEITA' as const,
        titulo: 'Maior motor de receita',
        valor: receitaDominante ? receitaDominante.label : 'Sem destaque',
        apoio: receitaDominante ? BRL.format(receitaDominante.total) : 'Sem receitas relevantes no período.',
        destaque: 'text-emerald-600',
      },
    ];
  }, [coberturaPagamentos, despesasPorCategoria, filteredLancamentos.length, margemPercentual, receitasPorCategoria, ticketMedio]);

  const linhasAnaliticas = useMemo(() => {
    const query = analysisQuery.trim().toLowerCase();
    return [...filteredLancamentos]
      .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .map((lancamento) => ({
        ...lancamento,
        categoriaId: Number(lancamento.plano_contas_id),
        categoriaNome: categoriaPorId.get(Number(lancamento.plano_contas_id)) || 'Sem categoria',
        centroNome: centroPorId.get(Number(lancamento.centro_custo_id)) || 'Sem centro',
        contaNome: contaPorId.get(Number((lancamento as any).conta_id))?.nome || 'Sem conta',
        bancoNome: contaPorId.get(Number((lancamento as any).conta_id))?.banco || 'Sem banco',
        naoOperacional: categoriasExcluidasResultado.has(Number(lancamento.plano_contas_id)),
      }))
      .filter((lancamento) => {
        if (!query) return true;
        const haystack = [
          lancamento.descricao,
          lancamento.categoriaNome,
          lancamento.centroNome,
          lancamento.contaNome,
          lancamento.bancoNome,
          lancamento.status,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
  }, [analysisQuery, categoriaPorId, centroPorId, contaPorId, filteredLancamentos, categoriasExcluidasResultado]);

  const linhasAnaliticasResumo = useMemo(() => {
    const receitasOperacionais = linhasAnaliticas
      .filter((l) => isReceita(l.tipo) && !l.naoOperacional)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const despesasOperacionais = linhasAnaliticas
      .filter((l) => isDespesa(l.tipo) && !l.naoOperacional)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const movimentosNaoOperacionais = linhasAnaliticas
      .filter((l) => l.naoOperacional)
      .reduce((acc, l) => acc + (isReceita(l.tipo) ? Number(l.valor_previsto || 0) : -Number(l.valor_previsto || 0)), 0);
    const saldoConsolidado = linhasAnaliticas
      .reduce((acc, l) => acc + (isReceita(l.tipo) ? Number(l.valor_previsto || 0) : -Number(l.valor_previsto || 0)), 0);

    return {
      receitasOperacionais,
      despesasOperacionais,
      movimentosNaoOperacionais,
      saldoConsolidado,
    };
  }, [linhasAnaliticas]);

  const resumoExecutivoDashboard = useMemo(() => {
    const topDespesas = despesasPorCategoria.slice(0, 3).map((item) => ({ categoria: item.label, total: item.total }));
    const topReceitas = receitasPorCategoria.slice(0, 3).map((item) => ({ categoria: item.label, total: item.total }));
    const topCentros = despesasPorCentro.slice(0, 3).map((item) => ({ centro: item.label, total: item.total }));
    const ultimosLancamentosResumo = topLancamentos.slice(0, 5).map((item) => ({
      data: item.data_vencimento,
      descricao: item.descricao,
      tipo: item.tipo,
      valor: item.valor_previsto,
      status: item.status,
    }));

    const mediaMensal = resultadoMensal.values.length
      ? resultadoMensal.values.reduce((acc, value) => acc + value, 0) / resultadoMensal.values.length
      : 0;
    const mediaAno = resultadoMensalAno.values.reduce((acc, value) => acc + value, 0) / (resultadoMensalAno.values.length || 1);
    const varianciaAno = resultadoMensalAno.values.reduce((acc, value) => acc + Math.pow(value - mediaAno, 2), 0) / (resultadoMensalAno.values.length || 1);
    const desvioAno = Math.sqrt(varianciaAno);

    return {
      resultado_operacional: {
        media_mensal: mediaMensal,
        melhor_mes: resultadoMensalAno.values.length ? Math.max(...resultadoMensalAno.values) : 0,
        pior_mes: resultadoMensalAno.values.length ? Math.min(...resultadoMensalAno.values) : 0,
        resultado_acumulado_final: resultadoAcumulado.values.at(-1) || 0,
      },
      cenarios: {
        pessimista: operationalKpis.saldo - desvioAno,
        realista: operationalKpis.saldo,
        otimista: operationalKpis.saldo + desvioAno,
      },
      contas_a_pagar: contasHoje.pagar,
      contas_a_receber: contasHoje.receber,
      distribuicao_status: statusDistrib,
      top_despesas_categoria: topDespesas,
      top_receitas_categoria: topReceitas,
      top_centros_custo: topCentros,
      ultimos_lancamentos: ultimosLancamentosResumo,
      variacao_ano_contra_ano: {
        ano_atual: resultadoMensalAno.year,
        ano_anterior: resultadoMensalAnoAnterior.year,
        resultado_atual: resultadoMensalAno.values.reduce((acc, value) => acc + value, 0),
        resultado_anterior: resultadoMensalAnoAnterior.values.reduce((acc, value) => acc + value, 0),
      },
    };
  }, [contasHoje, despesasPorCategoria, despesasPorCentro, operationalKpis.saldo, receitasPorCategoria, resultadoAcumulado.values, resultadoMensal, resultadoMensalAno, resultadoMensalAnoAnterior, statusDistrib, topLancamentos]);

  const exportRows = (rows: Lancamento[]) => rows.map((l) => ({
      data_vencimento: l.data_vencimento,
      data_pagamento: l.data_pagamento || '',
      descricao: l.descricao,
      tipo: l.tipo,
      categoria: categoriaPorId.get(Number(l.plano_contas_id)) || '',
      entidade: '',
      banco: contaPorId.get(Number((l as any).conta_id))?.banco || '',
      conta: contaPorId.get(Number((l as any).conta_id))?.nome || '',
      centro_custo: centroPorId.get(Number(l.centro_custo_id)) || '',
      valor_previsto: l.valor_previsto,
      valor_pago: l.valor_pago,
      status: l.status
    }));

  const exportLancamentos = async (rows: Lancamento[], format: 'csv' | 'xlsx', fileName: string) => {
    const exportData = exportRows(rows);

    if (format === 'csv') {
      const header = 'data_vencimento,data_pagamento,descricao,tipo,categoria,centro_custo,conta,banco,valor_previsto,valor_pago,status\n';
      const csv = header + exportData.map(r => `${r.data_vencimento},${r.data_pagamento},"${String(r.descricao).replace(/"/g, '""')}",${r.tipo},"${String(r.categoria).replace(/"/g, '""')}","${String(r.centro_custo).replace(/"/g, '""')}","${String(r.conta).replace(/"/g, '""')}","${String(r.banco).replace(/"/g, '""')}",${r.valor_previsto},${r.valor_pago},${r.status}`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lancamentos');
    ws.columns = [
      { header: 'Data Vencimento', key: 'data_vencimento', width: 14 },
      { header: 'Data Pagamento', key: 'data_pagamento', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 40 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Categoria', key: 'categoria', width: 22 },
      { header: 'Centro de Custo', key: 'centro_custo', width: 22 },
      { header: 'Conta', key: 'conta', width: 22 },
      { header: 'Banco', key: 'banco', width: 18 },
      { header: 'Valor Previsto', key: 'valor_previsto', width: 16 },
      { header: 'Valor Pago', key: 'valor_pago', width: 14 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    exportData.forEach(r => ws.addRow(r));

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportUltimosLancamentos = async (format: 'csv' | 'xlsx') => {
    await exportLancamentos(topLancamentos, format, `ultimos_lancamentos_${mes}`);
  };

  const renameActiveDashboardView = () => {
    const suggestedName = activeDashboardViewIsDefault ? `Vista ${dashboardViews.length + 1}` : (activeDashboardView?.name || 'Nova vista');
    const nextName = window.prompt('Nome da vista', suggestedName);
    if (nextName === null) return;
    const normalizedName = nextName.trim();
    if (!normalizedName) return;
    if (activeDashboardViewIsDefault) {
      const nextView = createEditableDashboardView(activeDashboardView, normalizedName);
      setDashboardViews((prev) => [...prev, nextView]);
      setActiveDashboardViewId(nextView.id);
      return;
    }
    updateActiveDashboardView((view) => ({ ...view, name: normalizedName }));
  };

  const setWidgetSize = (widgetId: DashboardWidgetId, size: DashboardWidgetSize) => {
    updateActiveWidget(widgetId, {
      size,
      autoWidth: false,
      w: getWidgetWidthFromSize(size),
    });
  };

  const toggleWidgetVisibility = (widgetId: DashboardWidgetId) => {
    const widget = activeDashboardWidgets.find((item) => item.id === widgetId);
    if (!widget) return;
    updateActiveWidget(widgetId, { visible: !widget.visible });
  };

  const moveWidgetVertically = (widgetId: DashboardWidgetId, direction: -1 | 1) => {
    const orderedWidgets = [...visibleDashboardWidgets].sort((left, right) => {
      const leftY = left.y ?? 0;
      const rightY = right.y ?? 0;
      if (leftY !== rightY) return leftY - rightY;
      return (left.x ?? 0) - (right.x ?? 0);
    });
    const currentIndex = orderedWidgets.findIndex((widget) => widget.id === widgetId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= orderedWidgets.length) return;

    const currentWidget = orderedWidgets[currentIndex];
    const targetWidget = orderedWidgets[targetIndex];
    updateActiveDashboardView((view) => ({
      ...view,
      widgets: view.widgets.map((widget) => {
        if (widget.id === currentWidget.id) {
          return {
            ...widget,
            x: targetWidget.x,
            y: targetWidget.y,
            w: targetWidget.w,
            h: targetWidget.h,
            size: getWidgetSizeFromWidth(targetWidget.w ?? getWidgetWidthFromSize(targetWidget.size)),
          };
        }
        if (widget.id === targetWidget.id) {
          return {
            ...widget,
            x: currentWidget.x,
            y: currentWidget.y,
            w: currentWidget.w,
            h: currentWidget.h,
            size: getWidgetSizeFromWidth(currentWidget.w ?? getWidgetWidthFromSize(currentWidget.size)),
          };
        }
        return widget;
      }),
    }));
  };

  const toggleWidgetAutoHeight = (widgetId: DashboardWidgetId) => {
    const widget = activeDashboardWidgets.find((item) => item.id === widgetId);
    if (!widget) return;
    updateActiveWidget(widgetId, { autoHeight: !widget.autoHeight });
  };

  const toggleWidgetAutoWidth = (widgetId: DashboardWidgetId) => {
    const widget = activeDashboardWidgets.find((item) => item.id === widgetId);
    if (!widget) return;
    updateActiveWidget(widgetId, { autoWidth: !widget.autoWidth });
  };

  const toggleTimelineSelection = (index: number) => {
    if (index < 0) return;
    if (fluxoDiario.mode === 'MONTH') {
      const month = fluxoDiario.indexToDate?.[index];
      if (!month) return;
      setSelectedDate(null);
      setSelectedMonth((prev) => prev === month ? null : month);
      return;
    }

    const date = fluxoDiario.indexToDate?.[index];
    if (!date) return;
    setSelectedMonth(null);
    setSelectedDate((prev) => prev === date ? null : date);
  };

  const toggleYearMonthSelection = (year: number, monthIndex: number) => {
    if (monthIndex < 0 || monthIndex > 11) return;
    const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    setSelectedDate(null);
    setSelectedMonth((prev) => prev === month ? null : month);
  };

  const toggleStatusSelection = (index: number) => {
    const nextStatus = index === 0 ? 'PAGO' : index === 1 ? 'PENDENTE' : 'ATRASADO';
    setStatusFiltro((prev) => prev === nextStatus ? 'TODOS' : nextStatus);
  };

  const toggleDashboardCategoria = (categoriaId: number) => {
    setSelectedCategorias((prev) => {
      const next = new Set(prev);
      if (next.has(categoriaId)) next.delete(categoriaId);
      else next.add(categoriaId);
      return next;
    });
  };

  const toggleDashboardCentro = (centroId: number) => {
    setSelectedCentro((prev) => prev === centroId ? null : centroId);
  };

  const clearAllDashboardFilters = () => {
    setSelectedCategorias(new Set());
    setSelectedCentro(null);
    setSelectedConta(null);
    setSelectedDate(null);
    setSelectedMonth(null);
    setStatusFiltro('TODOS');
    setTipoFiltro('TODOS');
    setPrevistoFiltro('TODOS');
    setCompetenciaFiltro('');
    setFiltroHojeAtivo(false);
    setFinanceDrilldown(null);
  };

  const widgetAutoMetrics = useMemo<Record<DashboardWidgetId, { w: number; h: number }>>(() => ({
    // Heights below are derived from the card chrome plus a bounded number of visible table rows.
    heatmap_calendar: { w: 8, h: Math.max(6, Math.min(9, heatmapCalendario.weeks.length + 2)) },
    executive_readings: { w: 4, h: 6 },
    productivity: { w: 12, h: 6 },
    contas_pagar: { w: 6, h: 4 },
    contas_receber: { w: 6, h: 4 },
    lancamentos_pagar: {
      w: 6,
      h: getRowsForPixelHeight(132 + Math.max(4, lancamentosContasDetalhe.pagar.length || 1) * 42),
    },
    lancamentos_receber: {
      w: 6,
      h: getRowsForPixelHeight(132 + Math.max(4, lancamentosContasDetalhe.receber.length || 1) * 42),
    },
    fluxo: { w: 12, h: 6 },
    despesas_categoria: { w: 8, h: 7 },
    receitas_categoria: { w: 4, h: 7 },
    acumulado_rec_desp: { w: 8, h: 5 },
    resultado_operacional: { w: 8, h: 5 },
    resumo_operacional: { w: 4, h: 5 },
    receitas_despesas_ano: { w: 8, h: 5 },
    margem_operacional: { w: 4, h: 5 },
    comparativo_ano: { w: 8, h: 5 },
    sazonalidade: { w: 4, h: 5 },
    cenarios: { w: 4, h: 5 },
    resultado_acumulado: { w: 8, h: 5 },
    pulso_acumulado: { w: 4, h: 6 },
    status: { w: 6, h: 4 },
    despesas_centro: { w: 6, h: 6 },
    ultimos_lancamentos: { w: 8, h: getRowsForPixelHeight(128 + Math.max(4, topLancamentos.length || 1) * 42) },
    gastos_categoria_lista: { w: 4, h: Math.max(4, Math.min(9, 4 + Math.ceil(categoriasList.length / 4))) },
    lancamentos_categoria: { w: 12, h: getRowsForPixelHeight(160 + Math.max(4, categoriaLancamentos.length || 1) * 42) },
    base_analitica: { w: 12, h: getRowsForPixelHeight(236 + Math.max(6, Math.min(60, linhasAnaliticas.length || 1)) * 44) },
    lancamentos_dia: { w: 12, h: selectedDate ? getRowsForPixelHeight(128 + Math.max(4, diaLancamentos.length || 1) * 42) : 4 },
    ...Object.fromEntries(
      activeDashboardWidgets
        .filter((widget) => widget.customDefinition)
        .map((widget) => [widget.id, {
          w: widget.customDefinition?.kind === 'kpi' ? 4 : 8,
          h: widget.customDefinition?.kind === 'kpi' ? 4 : 6,
        }])
    ),
  }), [categoriaLancamentos.length, categoriasList.length, diaLancamentos.length, heatmapCalendario.weeks.length, lancamentosContasDetalhe.pagar.length, lancamentosContasDetalhe.receber.length, linhasAnaliticas.length, selectedCategorias.size, selectedDate, topLancamentos.length]);

  const getResolvedWidgetWidth = (widget: DashboardWidgetConfig) => {
    const autoWidth = widget.autoWidth ? widgetAutoMetrics[widget.id].w : widget.w ?? getWidgetWidthFromSize(widget.size);
    return Math.max(2, Math.min(DASHBOARD_GRID_COLUMNS, autoWidth));
  };

  const getResolvedWidgetHeight = (widget: DashboardWidgetConfig) => {
    const autoHeight = widget.autoHeight ? widgetAutoMetrics[widget.id].h : widget.h ?? getWidgetDefaultHeight(widget);
    return Math.max(3, autoHeight);
  };

  const getWidgetResizeHandles = (widget: DashboardWidgetConfig): DashboardResizeHandle[] => {
    if (!dashboardEditMode) return [];
    if (widget.autoWidth && widget.autoHeight) return [];
    if (widget.autoWidth) return ['n', 's'];
    if (widget.autoHeight) return ['e', 'w'];
    return ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  };

  const dashboardLayouts = useMemo<DashboardGridLayout>(() => {
    return visibleDashboardWidgets.map((widget) => {
      const width = getResolvedWidgetWidth(widget);
      const height = getResolvedWidgetHeight(widget);
      const resizeHandles = getWidgetResizeHandles(widget);

      return {
        i: widget.id,
        x: dashboardGridCols === 12 ? (widget.x ?? 0) : 0,
        y: widget.y ?? 0,
        w: Math.min(dashboardGridCols, width),
        h: height,
        minW: 2,
        minH: 3,
        isResizable: resizeHandles.length > 0,
        resizeHandles,
      } satisfies DashboardGridItem;
    });
  }, [dashboardEditMode, dashboardGridCols, visibleDashboardWidgets, widgetAutoMetrics]);

  const renderResizeHandle = (axis: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw', ref: Ref<HTMLElement>) => (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      className={`react-resizable-handle react-resizable-handle-${axis} dashboard-resize-handle dashboard-resize-handle-${axis}`}
    />
  );

  const getCustomWidgetDataset = (definition: DashboardCustomWidgetDefinition): DashboardCustomWidgetDataset => {
    const buildLabel = (lancamento: Lancamento, groupBy: DashboardCustomGroupBy) => {
      if (groupBy === 'categoria') return categoriaPorId.get(Number(lancamento.plano_contas_id)) || 'Sem categoria';
      if (groupBy === 'centro_custo') return centroPorId.get(Number(lancamento.centro_custo_id)) || 'Sem centro';
      if (groupBy === 'conta') return contaPorId.get(Number((lancamento as any).conta_id))?.nome || 'Sem conta';
      if (groupBy === 'status') return String(lancamento.status || 'Sem status');
      if (groupBy === 'tipo') return isReceita(lancamento.tipo) ? 'Receitas' : 'Despesas';
      if (groupBy === 'competencia') return lancamento.competencia || toCompetencia(lancamento.data_vencimento) || 'Sem competência';
      if (groupBy === 'mes') return toDateOnlyStr(lancamento.data_vencimento).slice(0, 7) || 'Sem mês';
      return toDateOnlyStr(lancamento.data_vencimento) || 'Sem dia';
    };

    const aggregateMetricValue = (definition: DashboardCustomWidgetDefinition, lancamento: Lancamento) => {
      if (definition.metricField === 'count') return 1;
      return definition.metricField === 'valor_pago'
        ? Number(lancamento.valor_pago || 0)
        : Number(lancamento.valor_previsto || 0);
    };

    const createBucket = () => ({
      receitasPrevisto: 0,
      despesasPrevisto: 0,
      receitasPago: 0,
      despesasPago: 0,
      pagamentos: 0,
      lancamentos: 0,
      metricTotal: 0,
    });

    const resolveFormulaValue = (formula: DashboardCustomFormulaId, bucket: ReturnType<typeof createBucket>) => {
      if (formula === 'saldo') return bucket.receitasPrevisto - bucket.despesasPrevisto;
      if (formula === 'margem_percentual') return bucket.receitasPrevisto > 0 ? ((bucket.receitasPrevisto - bucket.despesasPrevisto) / bucket.receitasPrevisto) * 100 : 0;
      if (formula === 'cobertura_pagamentos') return bucket.despesasPrevisto > 0 ? (bucket.pagamentos / bucket.despesasPrevisto) * 100 : 0;
      return bucket.lancamentos > 0 ? bucket.metricTotal / bucket.lancamentos : 0;
    };

    const resolveBucketValue = (definition: DashboardCustomWidgetDefinition, bucket: ReturnType<typeof createBucket>) => {
      if (definition.formula) return resolveFormulaValue(definition.formula, bucket);
      if (definition.aggregation === 'avg') return bucket.metricTotal / (bucket.lancamentos || 1);
      return bucket.metricTotal;
    };

    const scoped = filteredLancamentos.filter((lancamento) => {
      if (definition.scope === 'receitas') return isReceita(lancamento.tipo);
      if (definition.scope === 'despesas') return isDespesa(lancamento.tipo);
      return true;
    });

    const populateBucket = (bucket: ReturnType<typeof createBucket>, lancamento: Lancamento) => {
      const previsto = Number(lancamento.valor_previsto || 0);
      const pago = Number(lancamento.valor_pago || 0);
      if (isReceita(lancamento.tipo)) {
        bucket.receitasPrevisto += previsto;
        bucket.receitasPago += pago;
      } else if (isDespesa(lancamento.tipo)) {
        bucket.despesasPrevisto += previsto;
        bucket.despesasPago += pago;
      }
      bucket.pagamentos += pago;
      bucket.lancamentos += 1;
      bucket.metricTotal += aggregateMetricValue(definition, lancamento);
    };

    if (definition.kind === 'kpi') {
      const bucket = createBucket();
      scoped.forEach((lancamento) => populateBucket(bucket, lancamento));
      return {
        total: resolveBucketValue(definition, bucket),
        count: bucket.lancamentos,
      };
    }

    const buckets = new Map<string, ReturnType<typeof createBucket>>();
    scoped.forEach((lancamento) => {
      const label = buildLabel(lancamento, definition.groupBy || 'categoria');
      const current = buckets.get(label) || createBucket();
      populateBucket(current, lancamento);
      buckets.set(label, current);
    });

    const rows = Array.from(buckets.entries()).map(([label, bucket]) => ({
      label,
      value: resolveBucketValue(definition, bucket),
    }));

    rows.sort((a, b) => b.value - a.value);
    return rows.slice(0, definition.limit || 8);
  };

  const customWidgetSeries = useMemo(() => {
    return Object.fromEntries(
      activeDashboardWidgets
        .filter((widget) => widget.customDefinition)
        .map((widget) => [widget.id, getCustomWidgetDataset(widget.customDefinition!)])
    ) as Record<string, DashboardCustomWidgetDataset>;
  }, [activeDashboardWidgets, categoriaPorId, centroPorId, contaPorId, filteredLancamentos]);

  const customWidgetPreviewDefinition = normalizeCustomWidgetDefinition(customWidgetDraft);
  const customWidgetPreviewDataset = useMemo<DashboardCustomWidgetDataset | null>(() => {
    if (!customWidgetModalOpen || !customWidgetPreviewDefinition) return null;
    return getCustomWidgetDataset(customWidgetPreviewDefinition);
  }, [categoriaPorId, centroPorId, contaPorId, customWidgetModalOpen, customWidgetPreviewDefinition, filteredLancamentos]);

  const renderCustomDashboardWidget = (widget: DashboardWidgetConfig, datasetOverride?: DashboardCustomWidgetDataset | null) => {
    const definition = widget.customDefinition;
    if (!definition) return null;

    if (definition.kind === 'kpi') {
      const dataset = (datasetOverride || customWidgetSeries[widget.id]) as DashboardCustomWidgetKpiDataset | undefined;
      const value = dataset?.total || 0;
      const formulaLabel = getCustomWidgetFormulaLabel(definition.formula);
      const isPercentFormula = definition.formula === 'margem_percentual' || definition.formula === 'cobertura_pagamentos';
      return (
        <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">KPI customizado</p>
          <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{definition.title}</h3>
          {definition.description && <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{definition.description}</p>}
          <p className="mt-5 text-4xl font-black" style={{ color: definition.color || '#0ea5e9' }}>
            {isPercentFormula ? `${value.toFixed(1)}%` : definition.metricField === 'count' && !definition.formula ? Math.round(value).toLocaleString('pt-BR') : BRL.format(value)}
          </p>
          <p className="text-xs text-slate-400" style={{ marginTop: 'auto', paddingTop: 12 }}>{formulaLabel || `${definition.aggregation.toUpperCase()} de ${getCustomMetricLabel(definition)}`} com filtros atuais da empresa.</p>
        </div>
      );
    }

    const dataset = ((datasetOverride || customWidgetSeries[widget.id]) as DashboardCustomWidgetChartDataset | undefined) || [];
    const isPercentFormula = definition.formula === 'margem_percentual' || definition.formula === 'cobertura_pagamentos';
    const chartSeries = [{
      name: definition.title,
      data: dataset.map((item) => item.value),
    }];
    const chartOptions = {
      chart: { toolbar: { show: false }, background: 'transparent' },
      colors: [definition.color || '#0ea5e9'],
      xaxis: { categories: dataset.map((item) => item.label) },
      labels: dataset.map((item) => item.label),
      legend: { show: definition.chartType === 'donut' },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth' as const },
      theme: { mode: isDark ? 'dark' : 'light' },
      tooltip: {
        y: {
          formatter: (value: number) => isPercentFormula ? `${value.toFixed(1)}%` : definition.metricField === 'count' && !definition.formula ? Math.round(value).toLocaleString('pt-BR') : BRL.format(value),
        },
      },
    };

    return (
      <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Gráfico customizado</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{definition.title}</h3>
          </div>
          <span className="text-xs text-slate-400">{getCustomMetricLabel(definition)} • {(definition.groupBy || 'categoria').replace('_', ' ')}</span>
        </div>
        {definition.description && <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{definition.description}</p>}
        {dataset.length === 0 ? (
          <div className="mt-6 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700" style={{ minHeight: 260 }}>Sem dados para os filtros atuais.</div>
        ) : (
          <div className="mt-4 flex-1">
            <AsyncApexChart type={definition.chartType || 'bar'} height={320} series={chartSeries} options={chartOptions} />
          </div>
        )}
      </div>
    );
  };

  const chartFluxo = {
    series: [
      { name: 'Entradas', data: fluxoDiario.rec },
      { name: 'Saídas', data: fluxoDiario.desp }
    ],
    options: {
      chart: {
        type: 'area',
        height: 320,
        toolbar: { show: false },
        animations: { enabled: true },
        selection: { enabled: true },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            toggleTimelineSelection(opts.dataPointIndex ?? -1);
          },
          markerClick: (_: any, __: any, opts: any) => {
            toggleTimelineSelection(opts.dataPointIndex ?? -1);
          },
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            toggleTimelineSelection(idx);
          }
        }
      },
      markers: {
        size: 4,
        strokeWidth: 0,
        hover: { size: 6 }
      },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      colors: ['#10b981', '#ef4444'],
      fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
      xaxis: { categories: fluxoDiario.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      legend: { show: true }
    } as any
  };

  const chartCategorias = {
    series: [{ name: 'Despesas Operacionais', data: despesasTreemapData }],
    options: {
      chart: {
        type: 'treemap',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = despesasPorCategoria[idx];
            if (!item || item.id === -1) return;
            setSelectedCategorias(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      legend: { show: false },
      dataLabels: {
        enabled: true,
        style: { fontSize: '10px', fontWeight: 700 },
        formatter: (_: string, opts: any) => {
          const point = despesasTreemapData[opts.dataPointIndex];
          if (!point) return '';
          return formatTreemapLabel(point.x, point.y, totalDespesasTreemap);
        },
      },
      plotOptions: { treemap: { distributed: true, enableShades: true, shadeIntensity: 0.18, borderRadius: 8 } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { formatter: (_: string, opts: any) => despesasTreemapData[opts.dataPointIndex]?.x || '' },
        y: { formatter: (val: number) => BRL.format(val) }
      },
      colors: ['#ef4444', '#f97316', '#f59e0b', '#fb7185', '#e11d48', '#c2410c', '#a855f7']
    } as any
  };

  const chartReceitasCategorias = {
    series: [{ name: 'Receitas Operacionais', data: receitasTreemapData }],
    options: {
      chart: {
        type: 'treemap',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = receitasPorCategoria[idx];
            if (!item || item.id === -1) return;
            setSelectedCategorias(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      legend: { show: false },
      dataLabels: {
        enabled: true,
        style: { fontSize: '10px', fontWeight: 700 },
        formatter: (_: string, opts: any) => {
          const point = receitasTreemapData[opts.dataPointIndex];
          if (!point) return '';
          return formatTreemapLabel(point.x, point.y, totalReceitasTreemap);
        },
      },
      plotOptions: { treemap: { distributed: true, enableShades: true, shadeIntensity: 0.18, borderRadius: 8 } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { formatter: (_: string, opts: any) => receitasTreemapData[opts.dataPointIndex]?.x || '' },
        y: { formatter: (val: number) => BRL.format(val) }
      },
      colors: ['#10b981', '#14b8a6', '#22c55e', '#06b6d4', '#0ea5e9', '#84cc16', '#3b82f6']
    } as any
  };

  const chartCentros = {
    series: [{ name: 'Despesas', data: despesasPorCentro.map(r => r.total) }],
    options: {
      chart: {
        type: 'bar',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = despesasPorCentro[idx];
            if (!item) return;
            setSelectedCentro(prev => prev === item.id ? null : item.id);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: despesasPorCentro.map(r => r.label) },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      colors: ['#6366f1']
    } as any
  };

  const totalPrevisto = operationalKpis.receitas + operationalKpis.despesas;
  const execucaoPct = totalPrevisto > 0 ? Math.round((operationalKpis.pagos / totalPrevisto) * 100) : 0;
  const todoPendentesPct = useMemo(() => {
    const total = todos.length;
    if (!total) return 0;
    const pendentes = todos.filter(t => t.status !== 'CONCLUIDO' && t.status !== 'CANCELADO').length;
    return Math.round((pendentes / total) * 100);
  }, [todos]);
  const mediaResultado = resultadoMensal.values.length
    ? resultadoMensal.values.reduce((acc, v) => acc + v, 0) / resultadoMensal.values.length
    : 0;

  const produtividadeIndicadores = [
    { key: 'execucao', label: 'Execução financeira', valor: `${execucaoPct}%`, percentual: execucaoPct, tone: 'bg-indigo-500', apoio: 'Volume financeiro já executado.' },
    { key: 'pendencias', label: 'Pendências operacionais', valor: `${todoPendentesPct}%`, percentual: todoPendentesPct, tone: 'bg-amber-500', apoio: 'Percentual de tarefas ainda abertas.' },
    { key: 'cobertura', label: 'Cobertura de despesas', valor: `${coberturaPagamentos.toFixed(1)}%`, percentual: Math.max(0, Math.min(100, coberturaPagamentos)), tone: 'bg-emerald-500', apoio: 'Quanto das despesas já encontra cobertura financeira.' },
  ];

  const chartResultadoOperacional = {
    series: [{ name: 'Resultado Operacional', data: resultadoMensalAno.values }],
    options: {
      chart: {
        type: 'bar',
        height: 320,
        toolbar: { show: false },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleYearMonthSelection(resultadoMensalAno.year, opts.dataPointIndex ?? -1),
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            toggleYearMonthSelection(resultadoMensalAno.year, idx);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: '55%',
          colors: {
            ranges: [
              { from: -999999999, to: -0.01, color: '#ef4444' },
              { from: 0, to: 999999999, color: '#10b981' }
            ]
          }
        }
      },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartComparativoAno = {
    series: [
      { name: String(resultadoMensalAno.year), data: resultadoMensalAno.values },
      { name: String(resultadoMensalAnoAnterior.year), data: resultadoMensalAnoAnterior.values }
    ],
    options: {
      chart: {
        type: 'line',
        height: 280,
        toolbar: { show: false },
        zoom: { enabled: true },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const year = opts.seriesIndex === 1 ? resultadoMensalAnoAnterior.year : resultadoMensalAno.year;
            toggleYearMonthSelection(year, opts.dataPointIndex ?? -1);
          },
          markerClick: (_: any, __: any, opts: any) => {
            const year = opts.seriesIndex === 1 ? resultadoMensalAnoAnterior.year : resultadoMensalAno.year;
            toggleYearMonthSelection(year, opts.dataPointIndex ?? -1);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#6366f1', '#f59e0b'],
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartSazonalidade = {
    series: [{ name: 'Índice Sazonal (%)', data: sazonalidadeIndice.values }],
    options: {
      chart: {
        type: 'bar',
        height: 260,
        toolbar: { show: false },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleYearMonthSelection(resultadoMensalAno.year, opts.dataPointIndex ?? -1),
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            toggleYearMonthSelection(resultadoMensalAno.year, idx);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: sazonalidadeIndice.labels },
      yaxis: { labels: { formatter: (val: number) => `${val}%` } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val}%` } },
      plotOptions: { bar: { borderRadius: 8, columnWidth: '60%' } },
      colors: ['#06b6d4'],
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const cenarios = useMemo(() => {
    const valores = resultadoMensalAno.values;
    const media = valores.reduce((acc, v) => acc + v, 0) / (valores.length || 1);
    const variancia = valores.reduce((acc, v) => acc + Math.pow(v - media, 2), 0) / (valores.length || 1);
    const desvio = Math.sqrt(variancia);
    return {
      pessimista: operationalKpis.saldo - desvio,
      realista: operationalKpis.saldo,
      otimista: operationalKpis.saldo + desvio
    };
  }, [resultadoMensalAno.values, operationalKpis.saldo]);

  const resultadoAcumuladoSnapshot = useMemo(() => {
    if (!resultadoAcumulado.values.length) {
      return { final: 0, pico: 0, vale: 0, amplitude: 0 };
    }

    const final = resultadoAcumulado.values[resultadoAcumulado.values.length - 1] || 0;
    const pico = Math.max(...resultadoAcumulado.values);
    const vale = Math.min(...resultadoAcumulado.values);
    return {
      final,
      pico,
      vale,
      amplitude: pico - vale,
    };
  }, [resultadoAcumulado.values]);

  const dashboardGlossario = useMemo(() => (Object.entries(DASHBOARD_HELP).map(([key, value]) => ({
    chave: key,
    titulo: value.titulo,
    significado: value.significado,
    calculo: value.calculo,
    utilidade: value.utilidade,
  }))), []);

  const assistenteConfig = useMemo(() => ({
    tela: 'dashboard' as const,
    titulo: 'Assistente KyrusTECH',
    contexto: {
      ...aiContexto,
      modo_consultoria: 'financeira_empresarial',
      resumo_executivo: resumoExecutivoDashboard,
      sinais_executivos: sinaisExecutivos,
      bancos_em_foco: bancosEmFoco,
      glossario_dashboard: dashboardGlossario,
      recorte_interativo: {
        dataSelecionada: selectedDate,
        mesSelecionado: selectedMonth,
        drilldownFinanceiro: financeDrilldown,
      },
      instrucao_analise: 'Explique o dashboard em profundidade e entregue a analise agora, sem responder que vai analisar depois. Quando a pergunta for vaga, descubra o painel mais provavel pelo contexto e use o glossario do dashboard para explicar significado, calculo e utilidade pratica. Aponte causas, riscos, oportunidades e prioridades de melhoria viaveis. Estruture a resposta com: resumo executivo, sinais positivos, sinais de alerta, causas provaveis, impacto no caixa e lucro, acoes imediatas, acoes estruturais e perguntas de acompanhamento.',
    },
    sugestoes: [
      'Analise este dashboard como meu consultor financeiro e empresarial.',
      'Explique detalhadamente o que esta acontecendo nos indicadores.',
      'Quais melhorias praticas podem elevar resultado, caixa e previsibilidade?',
    ],
  }), [aiContexto, bancosEmFoco, dashboardGlossario, financeDrilldown, resumoExecutivoDashboard, selectedDate, selectedMonth, sinaisExecutivos]);

  useAssistentePage(assistenteConfig);

  const chartReceitasDespesasAno = {
    series: [
      { name: 'Receitas', data: resultadoMensalAno.rec },
      { name: 'Despesas', data: resultadoMensalAno.desp }
    ],
    options: {
      chart: {
        type: 'bar',
        height: 320,
        stacked: true,
        toolbar: { show: false },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleYearMonthSelection(resultadoMensalAno.year, opts.dataPointIndex ?? -1),
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            toggleYearMonthSelection(resultadoMensalAno.year, idx);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      colors: ['#10b981', '#ef4444'],
      legend: { position: 'top' },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartMargemAno = {
    series: [{ name: 'Margem Operacional %', data: resultadoMensalAno.margem }],
    options: {
      chart: {
        type: 'line',
        height: 280,
        toolbar: { show: false },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleYearMonthSelection(resultadoMensalAno.year, opts.dataPointIndex ?? -1),
          markerClick: (_: any, __: any, opts: any) => toggleYearMonthSelection(resultadoMensalAno.year, opts.dataPointIndex ?? -1),
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#6366f1'],
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => `${val}%` } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val}%` } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartResultadoAcumulado = {
    series: [{ name: 'Resultado Acumulado', data: resultadoAcumulado.values }],
    options: {
      chart: {
        type: 'line',
        height: 280,
        toolbar: { show: false },
        animations: { enabled: true },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleTimelineSelection(opts.dataPointIndex ?? -1),
          markerClick: (_: any, __: any, opts: any) => toggleTimelineSelection(opts.dataPointIndex ?? -1),
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#22c55e'],
      xaxis: { categories: resultadoAcumulado.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartAcumuladoRecDesp = {
    series: [
      { name: 'Receitas Acumuladas', data: acumuladoRecDesp.rec },
      { name: 'Despesas Acumuladas', data: acumuladoRecDesp.desp }
    ],
    options: {
      chart: {
        type: 'line',
        height: 280,
        toolbar: { show: false },
        animations: { enabled: true },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleTimelineSelection(opts.dataPointIndex ?? -1),
          markerClick: (_: any, __: any, opts: any) => toggleTimelineSelection(opts.dataPointIndex ?? -1),
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#10b981', '#ef4444'],
      xaxis: { categories: acumuladoRecDesp.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartStatus = {
    series: [statusDistrib.pagos, statusDistrib.pendentes, statusDistrib.atrasados],
    options: {
      chart: {
        type: 'donut',
        height: 220,
        toolbar: { show: false },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => toggleStatusSelection(opts.dataPointIndex ?? -1),
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            toggleStatusSelection(idx);
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      labels: ['Pagos', 'Pendentes', 'Atrasados'],
      dataLabels: { enabled: false },
      colors: ['#10b981', '#f59e0b', '#ef4444'],
      legend: { position: 'top' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Total',
                formatter: () => BRL.format(statusDistrib.pagos + statusDistrib.pendentes + statusDistrib.atrasados),
              },
            },
          },
        },
      },
      stroke: { width: 0 },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } }
    } as any
  };

  const selectedChips = (
    <div className="flex flex-wrap gap-2">
      {selectedCategorias.size > 0 && (
        <button
          onClick={() => setSelectedCategorias(new Set())}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <Layers className="w-3 h-3" />
          {selectedCategorias.size} categoria(s)
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedCentro && (
        <button
          onClick={() => setSelectedCentro(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <Building2 className="w-3 h-3" />
          {centros.find(c => c.id === selectedCentro)?.nome || 'Centro'}
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedConta && (
        <button
          onClick={() => setSelectedConta(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 flex items-center gap-1"
        >
          <Landmark className="w-3 h-3" />
          {contaPorId.get(selectedConta)?.nome || 'Conta'}
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedDate && (
        <button
          onClick={() => setSelectedDate(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {parseDateLocal(selectedDate)?.toLocaleDateString('pt-BR')}
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedMonth && (
        <button
          onClick={() => setSelectedMonth(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {formatMonthLabel(selectedMonth)}
          <X className="w-3 h-3" />
        </button>
      )}
      {financeDrilldown && (
        <button
          onClick={() => setFinanceDrilldown(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1"
        >
          <Wallet className="w-3 h-3" />
          {FINANCE_DRILLDOWN_LABELS[financeDrilldown]}
          <X className="w-3 h-3" />
        </button>
      )}
      {statusFiltro !== 'TODOS' && (
        <button
          onClick={() => setStatusFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <Filter className="w-3 h-3" />
          {statusFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {tipoFiltro !== 'TODOS' && (
        <button
          onClick={() => setTipoFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <TrendingUp className="w-3 h-3" />
          {tipoFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {previstoFiltro !== 'TODOS' && (
        <button
          onClick={() => setPrevistoFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1"
        >
          <Filter className="w-3 h-3" />
          Previsto: {previstoFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {competenciaFiltro && (
        <button
          onClick={() => setCompetenciaFiltro('')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {competenciaFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {filtroHojeAtivo && (
        <button
          onClick={() => setFiltroHojeAtivo(false)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          Hoje
          <X className="w-3 h-3" />
        </button>
      )}
      {!selectedCategorias.size && !selectedCentro && !selectedConta && !selectedDate && !selectedMonth && statusFiltro === 'TODOS' && tipoFiltro === 'TODOS' && previstoFiltro === 'TODOS' && !competenciaFiltro && !filtroHojeAtivo && (
        <span className="text-xs text-slate-400">Clique nos gráficos para filtrar</span>
      )}
    </div>
  );

  const dashboardActiveFiltersCount = [
    selectedCategorias.size > 0 ? 1 : 0,
    selectedCentro ? 1 : 0,
    selectedConta ? 1 : 0,
    selectedDate ? 1 : 0,
    selectedMonth ? 1 : 0,
    financeDrilldown ? 1 : 0,
    statusFiltro !== 'TODOS' ? 1 : 0,
    tipoFiltro !== 'TODOS' ? 1 : 0,
    previstoFiltro !== 'TODOS' ? 1 : 0,
    competenciaFiltro ? 1 : 0,
    filtroHojeAtivo ? 1 : 0,
  ].filter(Boolean).length;

  const dashboardFiltersSidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Filtros do dashboard</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Refine o recorte</h3>
        </div>
        <div className="flex items-center gap-2">
          {dashboardActiveFiltersCount > 0 && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
              {dashboardActiveFiltersCount} ativo(s)
            </span>
          )}
          <button
            type="button"
            onClick={() => setDashboardFiltersRailCollapsed(true)}
            className="hidden rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 xl:inline-flex"
            title="Recolher painel de filtros"
          >
            <Filter className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowDashboardFiltersSidebar(false)}
            className="xl:hidden rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-4 custom-scrollbar">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Ativos agora</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Veja e remova qualquer filtro com um clique.</p>
            </div>
            <button
              type="button"
              onClick={clearAllDashboardFilters}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Limpar tudo
            </button>
          </div>
          <div className="mt-4">{selectedChips}</div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Status rápido</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: 'HOJE', label: 'Hoje' },
              { key: 'TODOS', label: 'Todos' },
              { key: 'PAGO', label: 'Pagos' },
              { key: 'PENDENTE', label: 'Pendentes' },
              { key: 'ATRASADO', label: 'Atrasados' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key === 'HOJE') {
                    setFiltroHojeAtivo((prev) => !prev);
                    return;
                  }
                  setStatusFiltro(item.key);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${item.key === 'HOJE' ? (filtroHojeAtivo ? 'border-cyan-500 bg-cyan-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800') : (statusFiltro === item.key ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800')}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Tipo</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'TODOS', label: 'Todos' },
              { key: 'RECEITA', label: 'Receitas' },
              { key: 'DESPESA', label: 'Despesas' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTipoFiltro(item.key)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${tipoFiltro === item.key ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Previsto</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { key: 'TODOS', label: 'Todos' },
              { key: 'SIM', label: 'Sim' },
              { key: 'NAO', label: 'Não' },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPrevistoFiltro(item.key)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${previstoFiltro === item.key ? 'border-amber-500 bg-amber-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Competência</label>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900/50">
            <CalendarRange className="h-4 w-4 text-slate-400" />
            <input
              value={competenciaFiltro}
              onChange={(e) => setCompetenciaFiltro(e.target.value)}
              placeholder="MM-AAAA"
              className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none dark:text-slate-200"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Conta</label>
          <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
            <button
              type="button"
              onClick={() => setSelectedConta(null)}
              className={`rounded-2xl border px-3 py-2 text-left text-sm font-bold transition ${selectedConta === null ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-500/10 dark:text-cyan-300' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            >
              Todas as contas
            </button>
            {contas.map((conta) => (
              <button
                key={conta.id}
                type="button"
                onClick={() => setSelectedConta((prev) => prev === conta.id ? null : conta.id)}
                className={`rounded-2xl border px-3 py-2 text-left text-sm font-bold transition ${selectedConta === conta.id ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-400 dark:bg-cyan-500/10 dark:text-cyan-300' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {conta.nome}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Centro de custo</label>
          <div className="flex flex-wrap gap-2">
            {centros.map((centro) => (
              <button
                key={centro.id}
                type="button"
                onClick={() => toggleDashboardCentro(centro.id)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${selectedCentro === centro.id ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {centro.nome}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400 mb-2">Categorias</label>
          <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {categorias.map((categoria) => {
              const active = selectedCategorias.has(categoria.id);
              return (
                <button
                  key={categoria.id}
                  type="button"
                  onClick={() => toggleDashboardCategoria(categoria.id)}
                  className={`rounded-2xl border px-3 py-2 text-left text-sm font-bold transition ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                >
                  {categoria.nome}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDashboardWidget = (widgetId: DashboardWidgetId) => {
    const widget = activeDashboardWidgets.find((item) => item.id === widgetId);
    if (widget?.customDefinition) {
      return renderCustomDashboardWidget(widget);
    }

    switch (widgetId) {
      case 'heatmap_calendar':
        return (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Heatmaps reativos</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Mapa de calor por receita e despesa</h3>
              </div>
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-300">{heatmapCalendario.monthLabel}</span>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {([
                { key: 'receita', label: 'Receitas', max: heatmapCalendario.maxReceita },
                { key: 'despesa', label: 'Despesas', max: heatmapCalendario.maxDespesa },
              ] as const).map((mapa) => (
                <div key={mapa.key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className={`text-sm font-bold ${mapa.key === 'receita' ? 'text-emerald-600' : 'text-rose-500'}`}>{mapa.label}</h4>
                    <span className="text-xs text-slate-400">Clique para abrir o dia</span>
                  </div>
                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    {heatmapCalendario.weekLabels.map((label) => <div key={label}>{label}</div>)}
                  </div>
                  <div className="mt-2 space-y-2">
                    {heatmapCalendario.weeks.map((week) => (
                      <div key={week.label} className="grid grid-cols-7 gap-2">
                        {week.cells.map((cell) => {
                          const amount = mapa.key === 'receita' ? cell.receita : cell.despesa;
                          const ratio = mapa.max > 0 ? amount / mapa.max : 0;
                          return (
                            <button
                              key={`${mapa.key}-${cell.date}`}
                              onClick={() => cell.isCurrentMonth && setSelectedDate((prev) => prev === cell.date ? null : cell.date)}
                              className={`aspect-square rounded-2xl border text-[11px] font-bold transition hover:-translate-y-0.5 ${cell.isCurrentMonth ? getHeatCellClass(ratio, mapa.key) : 'border-slate-100 bg-slate-50 text-slate-300 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-600'} ${selectedDate === cell.date ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-800' : ''}`}
                              title={`${parseDateLocal(cell.date)?.toLocaleDateString('pt-BR')} • ${BRL.format(amount)}`}
                            >
                              {cell.dayLabel}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      case 'executive_readings':
        return (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Conexao dos paineis</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Leituras executivas do recorte</h3>
              </div>
              <Sparkles className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Saldo atual</p>
                <p className={`mt-2 text-3xl font-black ${operationalKpis.saldo >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>{BRL.format(operationalKpis.saldo)}</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">O saldo reage ao periodo, tipo, centro, categoria, conta e cortes vindos dos graficos.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-100">Mix financeiro</p>
                  <span className="text-xs text-slate-400">Receita {mixFinanceiro.receitaPct.toFixed(1)}% x despesa {mixFinanceiro.despesaPct.toFixed(1)}%</span>
                </div>
                <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${mixFinanceiro.receitaPct}%` }} />
                  <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${mixFinanceiro.despesaPct}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Receitas: {BRL.format(operationalKpis.receitas)} ({mixFinanceiro.receitaPct.toFixed(1)}%)</div>
                  <div className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Despesas: {BRL.format(operationalKpis.despesas)} ({mixFinanceiro.despesaPct.toFixed(1)}%)</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-100">Preparacao para exportacao</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">A base do fim da pagina replica exatamente estes filtros. Voce pode buscar um termo e baixar CSV/XLSX do resultado consolidado.</p>
              </div>
            </div>
          </div>
        );
      case 'productivity':
        return (
          <div className={`${INTERACTIVE_PANEL_CLASS} bg-white/80 backdrop-blur`} onMouseEnter={(event) => scheduleKpiMeaning('PRODUTIVIDADE', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Produtividade</h3>
              <span className="text-xs text-slate-400">Eficiencia de execucao financeira</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
              <div className="lg:col-span-1 rounded-3xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Leitura rapida</p>
                <p className="mt-3 text-3xl font-black text-slate-900 dark:text-white">{execucaoPct}%</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Quanto do financeiro ja saiu do planejado e virou execucao dentro do recorte atual.</p>
              </div>
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-400">Execucao</p>
                  <p className="text-xl font-bold text-indigo-600">{execucaoPct}%</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-400">Tarefas pendentes</p>
                  <p className="text-xl font-bold text-amber-600">{todoPendentesPct}%</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-400">Resultado no periodo</p>
                  <p className={`text-xl font-bold ${operationalKpis.saldo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(operationalKpis.saldo)}</p>
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              {produtividadeIndicadores.map((item) => (
                <div key={item.key} className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">{item.label}</p>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{item.valor}</span>
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className={`h-full ${item.tone}`} style={{ width: `${Math.max(6, Math.min(100, item.percentual))}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{item.apoio}</p>
                </div>
              ))}
            </div>
          </div>
        );
      case 'contas_pagar':
        return (
          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Pagar</h3>
              <span className="text-xs text-slate-400">Vencimentos reativos</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_HOJE')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_HOJE' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}><p className="text-xs text-slate-400">Para hoje</p><p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.hoje)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_AMANHA')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_AMANHA' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}><p className="text-xs text-slate-400">Para amanha</p><p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.amanha)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_ATRASADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_ATRASADAS' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}><p className="text-xs text-slate-400">Atrasadas</p><p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.atrasadas)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_TOTAL')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_TOTAL' ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-700/30' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-500/60'}`}><p className="text-xs text-slate-400">Total do mes</p><p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.pagar.totalMes)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_REALIZADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_REALIZADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}><p className="text-xs text-slate-400">Realizadas</p><p className="font-bold text-emerald-600">{BRL.format(contasHoje.pagar.realizadas)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_ABERTO')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_ABERTO' ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-amber-300 dark:hover:border-amber-500/60'}`}><p className="text-xs text-slate-400">Em aberto</p><p className="font-bold text-amber-600">{BRL.format(contasHoje.pagar.emAberto)}</p></button>
            </div>
          </div>
        );
      case 'contas_receber':
        return (
          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Receber</h3>
              <span className="text-xs text-slate-400">Vencimentos reativos</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_HOJE')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_HOJE' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}><p className="text-xs text-slate-400">Para hoje</p><p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.hoje)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_AMANHA')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_AMANHA' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}><p className="text-xs text-slate-400">Para amanha</p><p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.amanha)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_ATRASADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_ATRASADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}><p className="text-xs text-slate-400">Atrasadas</p><p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.atrasadas)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_TOTAL')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_TOTAL' ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-700/30' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-500/60'}`}><p className="text-xs text-slate-400">Total do mes</p><p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.receber.totalMes)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_REALIZADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_REALIZADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}><p className="text-xs text-slate-400">Realizadas</p><p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.realizadas)}</p></button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_ABERTO')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_ABERTO' ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-amber-300 dark:hover:border-amber-500/60'}`}><p className="text-xs text-slate-400">Em aberto</p><p className="font-bold text-amber-600">{BRL.format(contasHoje.receber.emAberto)}</p></button>
            </div>
          </div>
        );
      case 'lancamentos_pagar':
        return (
          <div className={`${INTERACTIVE_PANEL_CLASS} flex h-full flex-col`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lancamentos • Contas a Pagar</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.pagar.length} item(ns){financeDrilldown?.startsWith('PAGAR') ? ' no recorte ativo' : ''}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 text-xs uppercase"><tr><th className="p-2 text-left">Descricao</th><th className="p-2 text-left">Venc.</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Valor</th></tr></thead><tbody>{lancamentosContasDetalhe.pagar.length === 0 ? (<tr><td className="p-3 text-slate-400" colSpan={4}>Sem lancamentos de contas a pagar no filtro atual.</td></tr>) : (lancamentosContasDetalhe.pagar.map((l) => (<tr key={`pagar-${l.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2 text-slate-700 dark:text-slate-200">{l.descricao}</td><td className="p-2 text-slate-500">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="p-2"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isPago(l.status) ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'}`}>{l.status}</span></td><td className="p-2 text-right font-bold text-red-500">{BRL.format(Number(l.valor_previsto || 0))}</td></tr>)))}</tbody></table>
            </div>
          </div>
        );
      case 'lancamentos_receber':
        return (
          <div className={`${INTERACTIVE_PANEL_CLASS} flex h-full flex-col`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lancamentos • Contas a Receber</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.receber.length} item(ns){financeDrilldown?.startsWith('RECEBER') ? ' no recorte ativo' : ''}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm"><thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 text-xs uppercase"><tr><th className="p-2 text-left">Descricao</th><th className="p-2 text-left">Venc.</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Valor</th></tr></thead><tbody>{lancamentosContasDetalhe.receber.length === 0 ? (<tr><td className="p-3 text-slate-400" colSpan={4}>Sem lancamentos de contas a receber no filtro atual.</td></tr>) : (lancamentosContasDetalhe.receber.map((l) => (<tr key={`receber-${l.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="p-2 text-slate-700 dark:text-slate-200">{l.descricao}</td><td className="p-2 text-slate-500">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="p-2"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isPago(l.status) ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'}`}>{l.status}</span></td><td className="p-2 text-right font-bold text-emerald-600">{BRL.format(Number(l.valor_previsto || 0))}</td></tr>)))}</tbody></table>
            </div>
          </div>
        );
      case 'fluxo':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('FLUXO_CAIXA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">{periodoTipo === 'ANO' ? 'Fluxo de Caixa Mensal' : 'Fluxo de Caixa Diario'}</h3>
              <span className="text-xs text-slate-400">{periodoTipo === 'ANO' ? 'Interativo por mes' : 'Interativo por dia'}</span>
            </div>
            <AsyncApexChart type="area" height={320} series={chartFluxo.series} options={chartFluxo.options} />
          </div>
        );
      case 'despesas_categoria':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('DESPESAS_CATEGORIA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200">{includeNaoOperacionaisCategorias ? 'Despesas por Categoria' : 'Despesas Operacionais por Categoria'}</h3>
                <span className="text-xs text-slate-400">Treemap proporcional • clique para filtrar</span>
              </div>
              <button type="button" onClick={() => setIncludeNaoOperacionaisCategorias((prev) => !prev)} className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold transition ${includeNaoOperacionaisCategorias ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/70'}`}>{includeNaoOperacionaisCategorias ? 'Ocultar nao operacionais' : 'Incluir nao operacionais'}</button>
            </div>
            {chartCategorias.series.length === 0 ? <div className="h-96 flex items-center justify-center text-sm text-slate-400">Sem dados de despesas no periodo.</div> : <AsyncApexChart type="treemap" height={420} series={chartCategorias.series} options={chartCategorias.options} />}
            {despesasCategoriaResumo.length > 0 && (<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{despesasCategoriaResumo.map((item) => (<button key={`despesa-resumo-${item.id}`} type="button" onClick={() => { if (item.id === -1) return; setSelectedCategorias((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); }} className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-left transition ${item.id !== -1 && selectedCategorias.has(item.id) ? 'border-rose-300 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-500/10' : 'border-slate-200 bg-white/70 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-800/50'}`}><span className="min-w-0 pr-3 text-sm font-semibold text-slate-700 dark:text-slate-100 truncate">{item.label}</span><span className="shrink-0 text-xs font-black text-slate-500 dark:text-slate-300">{item.percentual.toFixed(1)}%</span></button>))}</div>)}
            <p className="mt-3 text-xs text-slate-400">{includeNaoOperacionaisCategorias ? 'Visualizacao ampliada: categorias nao operacionais entram apenas neste treemap para comparacao visual, sem alterar os KPIs operacionais do dashboard.' : 'Categorias nao operacionais continuam visiveis nos lancamentos e no consolidado, mas ficam fora desta leitura operacional.'}</p>
          </div>
        );
      case 'receitas_categoria':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RECEITAS_CATEGORIA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">{includeNaoOperacionaisCategorias ? 'Receitas por Categoria' : 'Receitas Operacionais por Categoria'}</h3><span className="text-xs text-slate-400">Treemap proporcional • clique para filtrar</span></div>
            {chartReceitasCategorias.series.length === 0 ? <div className="h-80 flex items-center justify-center text-sm text-slate-400">Sem dados de receitas no periodo.</div> : <AsyncApexChart type="treemap" height={320} series={chartReceitasCategorias.series} options={chartReceitasCategorias.options} />}
            {receitasCategoriaResumo.length > 0 && (<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">{receitasCategoriaResumo.map((item) => (<button key={`receita-resumo-${item.id}`} type="button" onClick={() => { if (item.id === -1) return; setSelectedCategorias((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); }} className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-left transition ${item.id !== -1 && selectedCategorias.has(item.id) ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-500/10' : 'border-slate-200 bg-white/70 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-800/50'}`}><span className="min-w-0 pr-3 text-sm font-semibold text-slate-700 dark:text-slate-100 truncate">{item.label}</span><span className="shrink-0 text-xs font-black text-slate-500 dark:text-slate-300">{item.percentual.toFixed(1)}%</span></button>))}</div>)}
            <p className="mt-3 text-xs text-slate-400">{includeNaoOperacionaisCategorias ? 'Ao incluir nao operacionais, este painel vira uma visao comparativa ampliada por categoria.' : 'O maior motor de receita agora considera apenas categorias operacionais marcadas para resultado.'}</p>
          </div>
        );
      case 'acumulado_rec_desp':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('ACUMULADO_REC_DESP', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Acumulado: Receitas x Despesas</h3><span className="text-xs text-slate-400">Evolucao no periodo</span></div>
            <AsyncApexChart type="line" height={280} series={chartAcumuladoRecDesp.series} options={chartAcumuladoRecDesp.options} />
          </div>
        );
      case 'resultado_operacional':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RESULTADO_OPERACIONAL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Operacional ({resultadoMensalAno.year})</h3><span className="text-xs text-slate-400">Jan → Dez</span></div>
            {chartResultadoOperacional.series[0].data.length === 0 ? <div className="h-80 flex items-center justify-center text-sm text-slate-400">Sem dados suficientes para o periodo.</div> : <AsyncApexChart type="bar" height={320} series={chartResultadoOperacional.series} options={chartResultadoOperacional.options} />}
          </div>
        );
      case 'resumo_operacional':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RESUMO_OPERACIONAL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Resumo Operacional</h3><span className="text-xs text-slate-400">Media mensal</span></div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10"><p className="text-xs text-slate-400">Media por mes</p><p className={`text-lg font-bold ${mediaResultado >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(mediaResultado)}</p></div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 dark:border-sky-900/40 dark:bg-sky-500/10"><p className="text-xs text-slate-400">Melhor cenario</p><p className="text-lg font-bold text-emerald-600">{resultadoMensal.values.length ? BRL.format(Math.max(...resultadoMensal.values)) : '—'}</p></div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10"><p className="text-xs text-slate-400">Pior cenario</p><p className="text-lg font-bold text-red-500">{resultadoMensal.values.length ? BRL.format(Math.min(...resultadoMensal.values)) : '—'}</p></div>
            </div>
          </div>
        );
      case 'receitas_despesas_ano':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RECEITAS_DESPESAS_ANO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Receitas x Despesas ({resultadoMensalAno.year})</h3><span className="text-xs text-slate-400">Comparativo anual</span></div>
            <AsyncApexChart type="bar" height={320} series={chartReceitasDespesasAno.series} options={chartReceitasDespesasAno.options} />
          </div>
        );
      case 'margem_operacional':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('MARGEM_OPERACIONAL_PAINEL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Margem Operacional</h3><span className="text-xs text-slate-400">% mes a mes</span></div>
            <AsyncApexChart type="line" height={280} series={chartMargemAno.series} options={chartMargemAno.options} />
          </div>
        );
      case 'comparativo_ano':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('COMPARATIVO_ANO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Comparativo Ano a Ano</h3><span className="text-xs text-slate-400">{resultadoMensalAnoAnterior.year} vs {resultadoMensalAno.year}</span></div>
            <AsyncApexChart type="line" height={280} series={chartComparativoAno.series} options={chartComparativoAno.options} />
          </div>
        );
      case 'sazonalidade':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('SAZONALIDADE', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Sazonalidade</h3><span className="text-xs text-slate-400">Indice mensal</span></div>
            <AsyncApexChart type="bar" height={260} series={chartSazonalidade.series} options={chartSazonalidade.options} />
          </div>
        );
      case 'cenarios':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('CENARIOS', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Cenarios</h3><span className="text-xs text-slate-400">Baseado na volatilidade</span></div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10"><p className="text-xs text-slate-400">Pessimista</p><p className="text-lg font-bold text-red-500">{BRL.format(cenarios.pessimista)}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/50"><p className="text-xs text-slate-400">Realista</p><p className="text-lg font-bold text-slate-800 dark:text-white">{BRL.format(cenarios.realista)}</p></div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10"><p className="text-xs text-slate-400">Otimista</p><p className="text-lg font-bold text-emerald-600">{BRL.format(cenarios.otimista)}</p></div>
            </div>
          </div>
        );
      case 'resultado_acumulado':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RESULTADO_ACUMULADO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Acumulado</h3><span className="text-xs text-slate-400">Evolucao do caixa</span></div>
            <AsyncApexChart type="line" height={280} series={chartResultadoAcumulado.series} options={chartResultadoAcumulado.options} />
          </div>
        );
      case 'pulso_acumulado':
        return (
          <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.96))] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))]" onMouseEnter={(event) => scheduleKpiMeaning('PULSO_ACUMULADO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Pulso do Acumulado</h3><span className="text-xs text-slate-400">Resumo instantaneo do caixa</span></div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white/85 p-4 dark:border-slate-700 dark:bg-slate-900/50" onMouseEnter={(event) => scheduleKpiMeaning('FECHAMENTO_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Fechamento</p><p className={`mt-3 text-xl font-black ${resultadoAcumuladoSnapshot.final >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{BRL.format(resultadoAcumuladoSnapshot.final)}</p></div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10" onMouseEnter={(event) => scheduleKpiMeaning('PICO_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Pico</p><p className="mt-3 text-xl font-black text-emerald-600">{BRL.format(resultadoAcumuladoSnapshot.pico)}</p></div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10" onMouseEnter={(event) => scheduleKpiMeaning('VALE_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Vale</p><p className="mt-3 text-xl font-black text-rose-500">{BRL.format(resultadoAcumuladoSnapshot.vale)}</p></div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 dark:border-sky-900/40 dark:bg-sky-500/10" onMouseEnter={(event) => scheduleKpiMeaning('AMPLITUDE_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Amplitude</p><p className="mt-3 text-xl font-black text-sky-600">{BRL.format(resultadoAcumuladoSnapshot.amplitude)}</p></div>
            </div>
          </div>
        );
      case 'status':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('STATUS_DISTRIB', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Distribuicao por Status</h3><span className="text-xs text-slate-400">Valor por status</span></div>
            <AsyncApexChart type="donut" height={220} series={chartStatus.series} options={chartStatus.options} />
          </div>
        );
      case 'despesas_centro':
        return (
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('DESPESAS_CENTRO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Despesas por Centro</h3><span className="text-xs text-slate-400">Clique para filtrar</span></div>
            <AsyncApexChart type="bar" height={320} series={chartCentros.series} options={chartCentros.options} />
          </div>
        );
      case 'ultimos_lancamentos':
        return (
          <div className={`${DASHBOARD_SECTION_CLASS} flex h-full flex-col`} onMouseEnter={(event) => scheduleKpiMeaning('ULTIMOS_LANCAMENTOS', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Ultimos Lancamentos</h3><div className="flex items-center gap-2"><span className="text-xs text-slate-400">Atualiza com filtros</span><button onClick={() => exportUltimosLancamentos('csv')} className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40">CSV</button><button onClick={() => exportUltimosLancamentos('xlsx')} className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40">XLSX</button></div></div>
            <div className="min-h-0 flex-1 overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-400 uppercase"><tr><th className="py-2 text-left">Data</th><th className="py-2 text-left">Descricao</th><th className="py-2 text-right">Valor</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{loading ? (<tr><td colSpan={3} className="py-6 text-center text-slate-400">Carregando...</td></tr>) : topLancamentos.length === 0 ? (<tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lancamentos no periodo.</td></tr>) : (topLancamentos.map(l => (<tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40"><td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td><td className={`py-3 text-right font-bold ${String(l.tipo).toUpperCase().startsWith('R') ? 'text-emerald-600' : 'text-red-500'}`}>{String(l.tipo).toUpperCase().startsWith('D') ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}</td></tr>)))}</tbody></table></div>
          </div>
        );
      case 'gastos_categoria_lista':
        return (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Gastos por Categoria</h3><span className="text-xs text-slate-400">Clique para filtrar</span></div>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">{categoriasList.length === 0 ? (<div className="text-sm text-slate-400">Sem despesas no periodo.</div>) : (categoriasList.map(item => (<button key={item.id} onClick={() => setSelectedCategorias(prev => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition ${item.active ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}><span className="text-sm text-slate-700 dark:text-slate-100 truncate pr-2">{item.label}</span><span className="text-sm font-bold text-slate-800 dark:text-slate-100">{BRL.format(item.total)}</span></button>)))}</div>
          </div>
        );
      case 'lancamentos_categoria':
        return (
          <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Lancamentos da Categoria</h3><span className="text-xs text-slate-400">Mostra quando categoria esta selecionada</span></div>
            <div className="flex items-center justify-between mb-3"><span className="text-xs text-slate-400">Exportacao inclui filtros atuais</span><div className="flex items-center gap-2"><button onClick={() => exportLancamentos(filteredLancamentos, 'csv', `lancamentos_${mes}`)} className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40">Exportar CSV</button><button onClick={() => exportLancamentos(filteredLancamentos, 'xlsx', `lancamentos_${mes}`)} className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40">Exportar XLSX</button></div></div>
            <div className="min-h-0 flex-1 overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-400 uppercase"><tr><th className="py-2 text-left">Data</th><th className="py-2 text-left">Descricao</th><th className="py-2 text-right">Valor</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{selectedCategorias.size === 0 ? (<tr><td colSpan={3} className="py-6 text-center text-slate-400">Selecione uma ou mais categorias para ver os lancamentos.</td></tr>) : categoriaLancamentos.length === 0 ? (<tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lancamentos para esta categoria.</td></tr>) : (categoriaLancamentos.map(l => (<tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40"><td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td><td className={`py-3 text-right font-bold ${isReceita(l.tipo) ? 'text-emerald-600' : 'text-red-500'}`}>{isDespesa(l.tipo) ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}</td></tr>)))}</tbody></table></div>
          </div>
        );
      case 'base_analitica':
        return (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Base analitica final</p><h3 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Resultado consolidado dos lancamentos filtrados</h3><p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Ideal para analise fina, conferencia antes de conciliacao e exportacao do financeiro conforme o recorte que voce montou no dashboard.</p></div><div className="flex flex-wrap items-center gap-2"><button onClick={() => exportLancamentos(linhasAnaliticas, 'csv', `analise_financeira_${mes}`)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"><Download className="h-4 w-4" />Exportar CSV</button><button onClick={() => exportLancamentos(linhasAnaliticas, 'xlsx', `analise_financeira_${mes}`)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"><Download className="h-4 w-4" />Exportar XLSX</button></div></div>
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]"><label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700"><Search className="h-4 w-4 text-slate-400" /><input value={analysisQuery} onChange={(e) => setAnalysisQuery(e.target.value)} placeholder="Buscar por descricao, categoria, centro, conta, banco ou status" className="w-full bg-transparent outline-none text-slate-700 dark:text-slate-100" /></label><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Linhas</p><p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{linhasAnaliticas.length}</p></div><div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Receitas operacionais</p><p className="mt-2 text-xl font-black text-emerald-600">{BRL.format(linhasAnaliticasResumo.receitasOperacionais)}</p></div><div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Despesas operacionais</p><p className="mt-2 text-xl font-black text-rose-500">{BRL.format(linhasAnaliticasResumo.despesasOperacionais)}</p></div><div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Nao operacionais</p><p className={`mt-2 text-xl font-black ${linhasAnaliticasResumo.movimentosNaoOperacionais >= 0 ? 'text-sky-600' : 'text-amber-600'}`}>{BRL.format(linhasAnaliticasResumo.movimentosNaoOperacionais)}</p></div><div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Saldo consolidado</p><p className={`mt-2 text-xl font-black ${linhasAnaliticasResumo.saldoConsolidado >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>{BRL.format(linhasAnaliticasResumo.saldoConsolidado)}</p></div></div></div>
            <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200 dark:border-slate-700"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-400 dark:bg-slate-900/50"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Descricao</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Centro</th><th className="px-4 py-3">Conta</th><th className="px-4 py-3">Banco</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Valor</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{linhasAnaliticas.length === 0 ? (<tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Nenhum lancamento encontrado para os filtros e a busca informada.</td></tr>) : (linhasAnaliticas.map((lancamento) => (<tr key={`analitico-${lancamento.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="px-4 py-3 font-mono text-slate-500">{parseDateLocal(lancamento.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="px-4 py-3 text-slate-700 dark:text-slate-100">{lancamento.descricao}</td><td className="px-4 py-3 text-slate-500"><div className="flex flex-wrap items-center gap-2"><span>{lancamento.categoriaNome}</span>{lancamento.naoOperacional && (<span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">Nao operacional</span>)}</div></td><td className="px-4 py-3 text-slate-500">{lancamento.centroNome}</td><td className="px-4 py-3 text-slate-500">{lancamento.contaNome}</td><td className="px-4 py-3 text-slate-500">{lancamento.bancoNome}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isPago(lancamento.status) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>{lancamento.status}</span></td><td className={`px-4 py-3 text-right font-bold ${isReceita(lancamento.tipo) ? 'text-emerald-600' : 'text-rose-500'}`}>{isDespesa(lancamento.tipo) ? '-' : ''}{BRL.format(Number(lancamento.valor_previsto || 0))}</td></tr>)))}</tbody></table></div>
          </div>
        );
      case 'lancamentos_dia':
        return selectedDate ? (
          <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-slate-700 dark:text-slate-200">Lancamentos do Dia {parseDateLocal(selectedDate)?.toLocaleDateString('pt-BR')}</h3><span className="text-xs text-slate-400">Vencimento no dia selecionado</span></div>
            <div className="min-h-0 flex-1 overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-400 uppercase"><tr><th className="py-2 text-left">Data</th><th className="py-2 text-left">Descricao</th><th className="py-2 text-right">Valor</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{diaLancamentos.length === 0 ? (<tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lancamentos para este dia.</td></tr>) : (diaLancamentos.map(l => (<tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40"><td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td><td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td><td className={`py-3 text-right font-bold ${isReceita(l.tipo) ? 'text-emerald-600' : 'text-red-500'}`}>{isDespesa(l.tipo) ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}</td></tr>)))}</tbody></table></div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/30">Selecione um dia no heatmap ou nos graficos temporais para abrir os lancamentos detalhados.</div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <style>{`
        .dashboard-grid .dashboard-resize-handle {
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          border: 2px solid rgb(14 165 233);
          background: rgba(255, 255, 255, 0.96);
          background-image: none;
          box-shadow: 0 6px 16px rgba(14, 165, 233, 0.28);
          opacity: 0;
          transition: opacity 160ms ease, transform 160ms ease;
          z-index: 30;
        }
        .dashboard-grid .dashboard-grid-item:hover .dashboard-resize-handle,
        .dashboard-grid .dashboard-grid-item.is-editing .dashboard-resize-handle {
          opacity: 1;
        }
        .dashboard-grid .dashboard-resize-handle-n { top: -8px; left: calc(50% - 8px); }
        .dashboard-grid .dashboard-resize-handle-s { bottom: -8px; left: calc(50% - 8px); }
        .dashboard-grid .dashboard-resize-handle-e { right: -8px; top: calc(50% - 8px); }
        .dashboard-grid .dashboard-resize-handle-w { left: -8px; top: calc(50% - 8px); }
        .dashboard-grid .dashboard-resize-handle-ne { top: -8px; right: -8px; }
        .dashboard-grid .dashboard-resize-handle-nw { top: -8px; left: -8px; }
        .dashboard-grid .dashboard-resize-handle-se { right: -8px; bottom: -8px; }
        .dashboard-grid .dashboard-resize-handle-sw { left: -8px; bottom: -8px; }
        .dashboard-grid.is-editing {
          background-image:
            linear-gradient(to right, rgba(14, 165, 233, 0.12) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(14, 165, 233, 0.12) 1px, transparent 1px),
            radial-gradient(circle at top, rgba(14, 165, 233, 0.08), transparent 42%);
          background-repeat: repeat, repeat, no-repeat;
        }
        .dark .dashboard-grid.is-editing {
          background-image:
            linear-gradient(to right, rgba(56, 189, 248, 0.16) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(56, 189, 248, 0.16) 1px, transparent 1px),
            radial-gradient(circle at top, rgba(14, 165, 233, 0.14), transparent 42%);
        }
      `}</style>
      <header className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 px-4 sm:px-8 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">Operação financeira conectada, filtrável e pronta para exportação</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 w-full sm:w-auto">
            <select
              value={periodoTipo}
              onChange={(e) => setPeriodoTipo(e.target.value as any)}
              className="bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none [&>option]:text-slate-900 [&>option]:bg-white dark:[&>option]:text-slate-100 dark:[&>option]:bg-slate-800"
            >
              <option value="MES">Mês</option>
              <option value="ANO">Ano</option>
              <option value="PERSONALIZADO">Período</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 w-full sm:w-auto">
            <CalendarRange className="w-4 h-4 text-slate-400" />
            {periodoTipo === 'MES' && (
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
              />
            )}
            {periodoTipo === 'ANO' && (
              <input
                type="number"
                min={2000}
                max={2100}
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="w-24 bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
              />
            )}
            {periodoTipo === 'PERSONALIZADO' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={periodoIni}
                  onChange={(e) => setPeriodoIni(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
                />
                <span className="text-xs text-slate-400">→</span>
                <input
                  type="date"
                  value={periodoFim}
                  onChange={(e) => setPeriodoFim(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 w-full sm:w-auto min-w-55">
            <LayoutGrid className="w-4 h-4 text-slate-400" />
            <select
              value={activeDashboardViewId}
              onChange={(e) => setActiveDashboardViewId(e.target.value)}
              className="w-full bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none [&>option]:text-slate-900 [&>option]:bg-white dark:[&>option]:text-slate-100 dark:[&>option]:bg-slate-800"
            >
              {allDashboardViews.map((view) => (
                <option key={view.id} value={view.id}>{view.isDefault ? `${view.name} • Global` : view.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-1.5 py-1 dark:border-slate-600 dark:bg-slate-700/50">
            <button
              type="button"
              onClick={createDashboardViewFromCurrent}
              className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Nova vista baseada na atual"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={renameActiveDashboardView}
              className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              title={activeDashboardViewIsDefault ? 'Criar uma nova vista a partir do padrão' : 'Renomear vista'}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={deleteActiveDashboardView}
              disabled={activeDashboardViewIsDefault}
              className="rounded-md p-2 text-rose-500 transition hover:bg-white hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300 dark:hover:bg-slate-800"
              title={activeDashboardViewIsDefault ? 'O padrão global não pode ser excluído pela empresa' : 'Excluir vista atual'}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetActiveDashboardView}
              disabled={activeDashboardViewIsDefault}
              className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              title={activeDashboardViewIsDefault ? 'O padrão global já é a base imutável' : 'Restaurar esta vista para o layout padrão'}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openCreateCustomWidgetModal()}
              className="rounded-md p-2 text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Criar KPI ou gráfico customizado"
            >
              <Activity className="h-4 w-4" />
            </button>
          </div>
          {canManageGlobalDefault && (
            <button
              type="button"
              onClick={publishCurrentViewAsGlobalDefault}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
              title="Aplicar a vista atual como novo dashboard padrão global"
            >
              <Sparkles className="h-4 w-4" />
              Atualizar padrão global
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDashboardFiltersSidebar(true)}
            className={`xl:hidden inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition ${showDashboardFiltersSidebar ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-100 dark:hover:bg-slate-700'}`}
          >
            <Filter className="h-4 w-4" />
            Painel lateral
            {dashboardActiveFiltersCount > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{dashboardActiveFiltersCount}</span>}
          </button>
          <button
            type="button"
            onClick={() => setDashboardFiltersRailCollapsed((prev) => !prev)}
            className={`hidden xl:inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition ${!dashboardFiltersRailCollapsed ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-100 dark:hover:bg-slate-700'}`}
          >
            <Filter className="h-4 w-4" />
            {dashboardFiltersRailCollapsed ? 'Abrir painel' : 'Recolher painel'}
            {dashboardActiveFiltersCount > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">{dashboardActiveFiltersCount}</span>}
          </button>
          <button
            type="button"
            onClick={toggleDashboardEditMode}
            className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition ${dashboardEditMode ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-100 dark:hover:bg-slate-700'}`}
          >
            <Settings2 className="h-4 w-4" />
            {dashboardEditMode ? 'Fechar edição' : 'Editar dashboard'}
          </button>
          <button
            onClick={handleSync}
            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition"
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6">
        <div
          className="items-start gap-6 xl:grid"
          style={{ gridTemplateColumns: dashboardFiltersRailCollapsed ? '88px minmax(0, 1fr)' : '360px minmax(0, 1fr)' }}
        >
        <aside className="sticky top-6 hidden xl:block">
          <div className="flex max-h-[calc(100vh-3rem)] min-h-160 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            {dashboardFiltersRailCollapsed ? (
              <div className="flex h-full w-full flex-col items-center justify-between px-3 py-4">
                <button
                  type="button"
                  onClick={() => setDashboardFiltersRailCollapsed(false)}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700 transition hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
                  title="Expandir painel de filtros"
                >
                  <Filter className="h-5 w-5" />
                </button>
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{dashboardActiveFiltersCount}</div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400 [writing-mode:vertical-rl]">Filtros</span>
                </div>
                <button
                  type="button"
                  onClick={clearAllDashboardFilters}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  title="Limpar filtros"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              dashboardFiltersSidebarContent
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_38%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.22),transparent_28%),linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#ecfeff_100%)] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_38%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_48%,rgba(8,47,73,0.92)_100%)]">
          <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-sky-400/10 blur-3xl" />
          <div className="relative grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_0.95fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                    Sala de controle financeira
                  </div>
                  <h3 className="max-w-3xl text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                    Visão integrada do caixa, pressão de despesas e resposta por banco.
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Todos os painéis abaixo reagem aos filtros, aos cliques nos gráficos e ao banco selecionado. Use o heatmap para abrir dias críticos e a base analítica para exportar exatamente o recorte em tela.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Período ativo</p>
                  <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    {periodoTipo === 'MES' ? formatMonthLabel(mes) : periodoTipo === 'ANO' ? String(ano) : `${parseDateLocal(periodoIni)?.toLocaleDateString('pt-BR')} → ${parseDateLocal(periodoFim)?.toLocaleDateString('pt-BR')}`}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{filteredLancamentos.length} lançamentos após filtros ativos</p>
                </div>
              </div>

              {dashboardEditMode && <p className="text-sm text-slate-600 dark:text-slate-300">Arraste os widgets pela faixa pontilhada, use a malha azul como guia e note que qualquer ajuste manual fixa a largura e a altura para evitar reposicionamentos inesperados depois do refresh.</p>}

              {dashboardActiveFiltersCount > 0 && (
                <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Recorte ativo</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Os filtros continuam presos na lateral, mas o resumo do recorte fica visível aqui.</p>
                    </div>
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{dashboardActiveFiltersCount} ativo(s)</span>
                  </div>
                  {selectedChips}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {sinaisExecutivos.slice(0, 3).map((sinal) => (
                  <div
                    key={sinal.key}
                    className="relative rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/40"
                    onMouseEnter={(event) => scheduleKpiMeaning(sinal.key, event.currentTarget)}
                    onMouseLeave={hideKpiMeaning}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{sinal.titulo}</p>
                    <p className={`mt-3 text-2xl font-black ${sinal.destaque}`}>{sinal.valor}</p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{sinal.apoio}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Modo de uso</p>
                    <h4 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Como o novo layout responde</h4>
                  </div>
                  <Activity className="h-5 w-5 text-sky-500" />
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    'Mapa de calor e leitura executiva ficam na primeira linha da grade, exatamente lado a lado.',
                    'Produtividade, lançamentos do dia, pagar e receber agora entram só na grade configurável, sem duplicação fora dela.',
                    'Resultado consolidado cresce com a quantidade de linhas e prioriza rolagem da página em vez de uma tabela comprimida.',
                  ].map((item) => (
                    <div key={item} className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Bancos em foco</p>
                    <h4 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Selecione uma conta e propague o filtro</h4>
                  </div>
                  <Landmark className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="mt-4 space-y-2">
                  {bancosEmFoco.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-400 dark:border-slate-700">Nenhuma conta com movimentação no recorte atual.</div>
                  ) : (
                    bancosEmFoco.map((item) => (
                      <button
                        key={item.contaId}
                        onClick={() => setSelectedConta((prev) => prev === item.contaId ? null : item.contaId)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selectedConta === item.contaId ? 'border-cyan-500 bg-cyan-50 shadow-sm dark:border-cyan-400 dark:bg-cyan-500/10' : 'border-slate-200 bg-white/70 hover:border-cyan-300 hover:bg-cyan-50/60 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-cyan-500 dark:hover:bg-cyan-500/10'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-800 dark:text-slate-100">{item.nome}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-300">{item.banco}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900 dark:text-white">{BRL.format(item.total)}</p>
                            <p className={`text-xs font-bold ${item.saldo >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{item.quantidade} mov. • {BRL.format(item.saldo)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              key: 'RECEITAS' as const,
              label: 'Receitas',
              value: BRL.format(operationalKpis.receitas),
              icon: TrendingUp,
              iconWrap: 'bg-emerald-100 dark:bg-emerald-900/30',
              iconTone: 'text-emerald-600',
              active: tipoFiltro === 'RECEITA',
              activeClass: 'border-emerald-400 bg-emerald-50/80 dark:border-emerald-500 dark:bg-emerald-500/10',
              onClick: () => setTipoFiltro((prev) => prev === 'RECEITA' ? 'TODOS' : 'RECEITA'),
            },
            {
              key: 'DESPESAS' as const,
              label: 'Despesas',
              value: BRL.format(operationalKpis.despesas),
              icon: TrendingDown,
              iconWrap: 'bg-rose-100 dark:bg-rose-900/30',
              iconTone: 'text-rose-500',
              active: tipoFiltro === 'DESPESA',
              activeClass: 'border-rose-400 bg-rose-50/80 dark:border-rose-500 dark:bg-rose-500/10',
              onClick: () => setTipoFiltro((prev) => prev === 'DESPESA' ? 'TODOS' : 'DESPESA'),
            },
            {
              key: 'SALDO' as const,
              label: 'Saldo',
              value: BRL.format(operationalKpis.saldo),
              icon: Wallet,
              iconWrap: 'bg-slate-100 dark:bg-slate-700/50',
              iconTone: 'text-slate-600 dark:text-slate-200',
              active: !selectedCategorias.size && !selectedCentro && !selectedConta && !selectedDate && !selectedMonth && !financeDrilldown && statusFiltro === 'TODOS' && tipoFiltro === 'TODOS',
              activeClass: 'border-sky-400 bg-sky-50/80 dark:border-sky-500 dark:bg-sky-500/10',
              onClick: () => {
                setStatusFiltro('TODOS');
                setTipoFiltro('TODOS');
                setSelectedCategorias(new Set());
                setSelectedCentro(null);
                setSelectedConta(null);
                setSelectedDate(null);
                setSelectedMonth(null);
                setFinanceDrilldown(null);
              },
            },
            {
              key: 'PAGOS' as const,
              label: 'Pagos',
              value: BRL.format(operationalKpis.pagos),
              icon: Filter,
              iconWrap: 'bg-indigo-100 dark:bg-indigo-900/30',
              iconTone: 'text-indigo-600',
              active: statusFiltro === 'PAGO',
              activeClass: 'border-indigo-400 bg-indigo-50/80 dark:border-indigo-500 dark:bg-indigo-500/10',
              onClick: () => setStatusFiltro((prev) => prev === 'PAGO' ? 'TODOS' : 'PAGO'),
            },
          ].map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              onMouseEnter={(event) => scheduleKpiMeaning(card.key, event.currentTarget)}
              onMouseLeave={hideKpiMeaning}
              onFocus={(event) => scheduleKpiMeaning(card.key, event.currentTarget)}
              onBlur={hideKpiMeaning}
              className={`relative rounded-2xl border p-5 text-left shadow-sm backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-lg ${card.active ? card.activeClass : 'border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-800'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-slate-400">{card.label}</p>
                  <p className={`text-2xl font-black ${card.label === 'Saldo' && operationalKpis.saldo < 0 ? 'text-rose-500' : card.iconTone}`}>{card.value}</p>
                </div>
                <div className={`rounded-lg p-2 ${card.iconWrap}`}>
                  <card.icon className={`h-5 w-5 ${card.iconTone}`} />
                </div>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-400">Clique para cruzar o dashboard por este KPI</p>
            </button>
          ))}
        </div>

        {dashboardEditMode && hiddenDashboardWidgets.length > 0 && (
          <div className="rounded-3xl border border-dashed border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-500/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Widgets ocultos</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Reative um painel sem sair da grade.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hiddenDashboardWidgets.map((widget) => (
                  <button
                    key={`hidden-${widget.id}`}
                    type="button"
                    onClick={() => toggleWidgetVisibility(widget.id)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm font-bold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/50 dark:text-sky-300 dark:hover:bg-slate-800"
                  >
                    <Eye className="h-4 w-4" />
                    {getWidgetLabel(widget)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {customWidgetModalOpen && (
          <div className="fixed inset-0 z-120 flex items-center justify-center bg-slate-950/50 px-4 py-8 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-700">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-500">Construtor de widgets</p>
                  <h3 className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{editingCustomWidgetId ? 'Editar widget customizado' : 'Criar KPI ou gráfico com dados da empresa'}</h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Use os mesmos filtros do dashboard para montar leituras personalizadas por empresa, no estilo mini Power BI.</p>
                </div>
                <button
                  type="button"
                  onClick={closeCustomWidgetModal}
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <div className="min-h-0 overflow-y-auto px-6 py-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Templates rápidos</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Comece com uma leitura pronta e ajuste o que precisar.</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {DASHBOARD_CUSTOM_WIDGET_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => applyCustomWidgetTemplate(template)}
                      className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-sky-700 dark:hover:bg-slate-800"
                    >
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{template.label}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{template.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Tipo</span>
                  <select
                    value={customWidgetDraft.kind}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({
                      ...prev,
                      kind: e.target.value as DashboardCustomWidgetKind,
                      title: prev.title === resolveCustomWidgetTitle(prev.kind) ? resolveCustomWidgetTitle(e.target.value as DashboardCustomWidgetKind) : prev.title,
                    }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                  >
                    <option value="kpi">KPI</option>
                    <option value="chart">Gráfico</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Título</span>
                  <input
                    value={customWidgetDraft.title}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                    placeholder="Ex.: Receita média por centro"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Descrição</span>
                  <input
                    value={customWidgetDraft.description || ''}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, description: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-100"
                    placeholder="Explique rapidamente o objetivo desse indicador"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Escopo</span>
                  <select
                    value={customWidgetDraft.scope}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, scope: e.target.value as DashboardCustomScope }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                  >
                    <option value="todos">Todos os lançamentos</option>
                    <option value="receitas">Só receitas</option>
                    <option value="despesas">Só despesas</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Métrica</span>
                  <select
                    value={customWidgetDraft.metricField}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, metricField: e.target.value as DashboardCustomMetricField }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                  >
                    <option value="valor_previsto">Valor previsto</option>
                    <option value="valor_pago">Valor pago</option>
                    <option value="count">Quantidade de lançamentos</option>
                  </select>
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Fórmula pronta</span>
                  <select
                    value={customWidgetDraft.formula || ''}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, formula: (e.target.value || null) as DashboardCustomFormulaId | null }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                  >
                    <option value="">Sem fórmula pronta</option>
                    <option value="saldo">Saldo</option>
                    <option value="margem_percentual">Margem %</option>
                    <option value="cobertura_pagamentos">Cobertura de pagamentos %</option>
                    <option value="ticket_medio">Ticket médio</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Agregação</span>
                  <select
                    value={customWidgetDraft.aggregation}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, aggregation: e.target.value as DashboardCustomAggregation }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                  >
                    <option value="sum">Soma</option>
                    <option value="avg">Média</option>
                    <option value="count">Contagem</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Cor</span>
                  <input
                    type="color"
                    value={customWidgetDraft.color || '#0ea5e9'}
                    onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, color: e.target.value }))}
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-950/50"
                  />
                </label>

                {customWidgetDraft.kind === 'chart' && (
                  <>
                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Tipo do gráfico</span>
                      <select
                        value={customWidgetDraft.chartType}
                        onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, chartType: e.target.value as DashboardCustomChartType }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                      >
                        <option value="bar">Barras</option>
                        <option value="line">Linha</option>
                        <option value="donut">Donut</option>
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Agrupar por</span>
                      <select
                        value={customWidgetDraft.groupBy}
                        onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, groupBy: e.target.value as DashboardCustomGroupBy }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                      >
                        <option value="categoria">Categoria</option>
                        <option value="centro_custo">Centro de custo</option>
                        <option value="conta">Conta</option>
                        <option value="status">Status</option>
                        <option value="tipo">Tipo</option>
                        <option value="competencia">Competência</option>
                        <option value="mes">Mês</option>
                        <option value="dia">Dia</option>
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Limite de grupos</span>
                      <input
                        type="number"
                        min={3}
                        max={20}
                        value={customWidgetDraft.limit || 8}
                        onChange={(e) => setCustomWidgetDraft((prev) => ({ ...prev, limit: Number(e.target.value) || 8 }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/50 dark:text-white"
                      />
                    </label>
                  </>
                )}
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCustomWidgetModal}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={createCustomDashboardWidget}
                  className="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-500"
                >
                  {editingCustomWidgetId ? 'Salvar widget' : 'Criar widget'}
                </button>
              </div>
              </div>

              <div className="min-h-0 border-t border-slate-200 bg-slate-50/70 px-6 py-6 dark:border-slate-700 dark:bg-slate-950/30 xl:border-l xl:border-t-0">
              {customWidgetPreviewDefinition && customWidgetPreviewDataset && (
                <div className="flex h-full flex-col" style={{ minHeight: 420 }}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Prévia em tempo real</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">A prévia já usa os filtros atuais do dashboard e muda enquanto você ajusta o widget.</p>
                    </div>
                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-300">
                      {customWidgetPreviewDefinition.kind === 'kpi' ? 'KPI' : 'Gráfico'}
                    </span>
                  </div>
                  <div className="flex-1 rounded-4xl bg-white p-2 shadow-sm dark:bg-slate-900/80">
                    {renderCustomDashboardWidget({
                      id: editingCustomWidgetId || 'custom_widget_preview',
                      visible: true,
                      size: customWidgetPreviewDefinition.kind === 'kpi' ? 'sm' : 'lg',
                      autoHeight: true,
                      autoWidth: customWidgetPreviewDefinition.kind === 'chart',
                      customDefinition: customWidgetPreviewDefinition,
                    }, customWidgetPreviewDataset)}
                  </div>
                </div>
              )}
              </div>
              </div>
            </div>
          </div>
        )}

        {showDashboardFiltersSidebar && (
          <button
            type="button"
            aria-label="Fechar filtros"
            onClick={() => setShowDashboardFiltersSidebar(false)}
            className="fixed inset-0 z-65 bg-slate-950/40 backdrop-blur-sm xl:hidden"
          />
        )}

        <div className={`fixed inset-y-0 left-0 z-70 w-full max-w-sm transform border-r border-slate-200 bg-white shadow-2xl transition-transform duration-300 dark:border-slate-700 dark:bg-slate-900 xl:hidden ${showDashboardFiltersSidebar ? 'translate-x-0' : '-translate-x-full'}`}>
          {dashboardFiltersSidebarContent}
        </div>

        <div
          ref={dashboardGridRef}
          className={`dashboard-grid rounded-4xl border border-slate-200/80 bg-white/70 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 ${dashboardEditMode ? 'is-editing' : ''}`}
          style={dashboardEditMode ? {
            backgroundSize: `${Math.max(96, Math.floor(dashboardGridWidth / Math.max(dashboardGridCols, 1)) + DASHBOARD_GRID_MARGIN)}px 100%, 100% ${DASHBOARD_GRID_ROW_HEIGHT + DASHBOARD_GRID_MARGIN}px, auto`,
            backgroundPosition: '0 0, 0 0, center top',
          } : undefined}
        >
          <GridLayout
            className="layout"
            layout={dashboardLayouts}
            width={dashboardGridWidth}
            gridConfig={{
              cols: dashboardGridCols,
              rowHeight: DASHBOARD_GRID_ROW_HEIGHT,
              margin: [24, 24],
            }}
            dragConfig={{
              enabled: dashboardEditMode,
              handle: '.dashboard-widget-drag-handle',
            }}
            resizeConfig={{
              enabled: dashboardEditMode,
              handles: ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
              handleComponent: renderResizeHandle,
            }}
            onDragStop={(layout) => updateActiveWidgetLayout(layout as readonly DashboardGridItem[])}
            onResizeStop={(layout) => updateActiveWidgetLayout(layout as readonly DashboardGridItem[])}
          >
            {visibleDashboardWidgets.map((widget) => (
              <div key={widget.id} className={`dashboard-grid-item overflow-visible ${dashboardEditMode ? 'is-editing' : ''}`}>
                <div className={`h-full overflow-hidden rounded-[30px] ${dashboardEditMode ? 'ring-1 ring-sky-200 dark:ring-sky-800' : ''}`}>
                  {dashboardEditMode && (
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-sky-200 bg-sky-50/80 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-sky-700 dark:border-sky-900 dark:bg-sky-500/10 dark:text-sky-300">
                      <div className="dashboard-widget-drag-handle inline-flex cursor-move items-center gap-2 rounded-xl px-2 py-1">
                        <GripVertical className="h-4 w-4" />
                        <span>{getWidgetLabel(widget)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => moveWidgetVertically(widget.id, -1)}
                          className="rounded-xl border border-sky-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800"
                          title="Mover widget para cima"
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidgetVertically(widget.id, 1)}
                          className="rounded-xl border border-sky-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800"
                          title="Mover widget para baixo"
                        >
                          Descer
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWidgetVisibility(widget.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800"
                          title={widget.visible ? 'Ocultar widget' : 'Mostrar widget'}
                        >
                          {widget.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWidgetAutoWidth(widget.id)}
                          className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${widget.autoWidth ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-500/20 dark:text-sky-200' : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800'}`}
                          title="Alternar largura automática"
                        >
                          L auto
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWidgetAutoHeight(widget.id)}
                          className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition ${widget.autoHeight ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-500/20 dark:text-sky-200' : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800'}`}
                          title="Alternar altura automática"
                        >
                          A auto
                        </button>
                        {(['sm', 'md', 'lg', 'full'] as const).map((size) => (
                          <button
                            key={`${widget.id}-${size}`}
                            type="button"
                            onClick={() => setWidgetSize(widget.id, size)}
                            disabled={Boolean(widget.autoWidth)}
                            className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${widget.size === size && !widget.autoWidth ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-500/20 dark:text-sky-200' : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900/60 dark:text-sky-300 dark:hover:bg-slate-800'}`}
                            title={`Definir tamanho ${size.toUpperCase()}`}
                          >
                            {size.toUpperCase()}
                          </button>
                        ))}
                        {widget.customDefinition && (
                          <button
                            type="button"
                            onClick={() => openEditCustomWidgetModal(widget)}
                            className="rounded-xl border border-amber-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-700 transition hover:bg-amber-50 dark:border-amber-900 dark:bg-slate-900/60 dark:text-amber-300 dark:hover:bg-slate-800"
                            title="Editar widget customizado"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {widget.customDefinition && (
                          <button
                            type="button"
                            onClick={() => deleteCustomDashboardWidget(widget.id)}
                            className="rounded-xl border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-900/60 dark:text-rose-300 dark:hover:bg-slate-800"
                            title="Excluir widget customizado"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {renderDashboardWidget(widget.id)}
                </div>
              </div>
            ))}
          </GridLayout>
        </div>

        {selectedDate && !activeDashboardWidgets.some((widget) => widget.id === 'lancamentos_dia' && widget.visible) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos do Dia {parseDateLocal(selectedDate)?.toLocaleDateString('pt-BR')}</h3>
              <span className="text-xs text-slate-400">Vencimento no dia selecionado</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 text-left">Data</th>
                    <th className="py-2 text-left">Descrição</th>
                    <th className="py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {diaLancamentos.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lançamentos para este dia.</td></tr>
                  ) : (
                    diaLancamentos.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className={`py-3 text-right font-bold ${isReceita(l.tipo) ? 'text-emerald-600' : 'text-red-500'}`}>
                          {isDespesa(l.tipo) ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
        </div>
      </div>

      {visibleKpiMeaning && (
        <div
          className="pointer-events-none fixed bottom-4 right-4 z-120 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-left shadow-2xl shadow-slate-950/30 dark:border-slate-700 lg:bottom-6 lg:right-6"
        >
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">{DASHBOARD_HELP[visibleKpiMeaning.key].titulo}</p>
          <p className="mt-2 text-sm font-semibold text-white">{DASHBOARD_HELP[visibleKpiMeaning.key].significado}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Como é calculado</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{DASHBOARD_HELP[visibleKpiMeaning.key].calculo}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Utilidade real</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{DASHBOARD_HELP[visibleKpiMeaning.key].utilidade}</p>
        </div>
      )}
    </div>
  );
}
