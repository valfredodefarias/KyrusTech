import { useEffect, useMemo, useState } from 'react';
import { Calculator, ChevronRight, RotateCcw } from 'lucide-react';

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

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const EXCLUDED_BUDGET_GROUP_NAME = 'Não operacional / fora da DRE';

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

function isReceita(tipo?: string | null) {
  return String(tipo || '').trim().toUpperCase().startsWith('R');
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
    total_realizado: toNumber(node.total_realizado),
    total_orcado: toNumber(node.total_orcado),
    total_desvio_absoluto: toNumber(node.total_desvio_absoluto),
    total_desvio_percentual: toNumber(node.total_desvio_percentual),
    meses,
    children,
  };
}

function filterBudgetTree(nodes: BudgetNode[]): BudgetNode[] {
  return nodes
    .filter((node) => node.nome !== EXCLUDED_BUDGET_GROUP_NAME)
    .map((node) => ({
      ...node,
      children: filterBudgetTree(node.children),
    }));
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

  const visibleRows = useMemo(() => flattenVisibleNodes(matrix, expandedIds), [matrix, expandedIds]);

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 border-b border-r border-slate-800 bg-slate-950 px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white">
                  Conta
                </th>
                <th className="border-b border-r border-slate-800 bg-slate-950 px-3 py-3 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white">
                  Orçado total
                </th>
                {MONTH_LABELS.map((label) => (
                  <th key={label} className="min-w-[100px] w-[100px] border-b border-r border-slate-800 bg-slate-950 px-2 py-3 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white last:border-r-0">
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
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={2 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum dado encontrado para este ano.
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ node, level, hasChildren }, rowIndex) => {
                  return (
                    <tr key={node.plano_contas_id} className={rowIndex % 2 === 0 ? 'bg-white dark:bg-slate-950/20' : 'bg-slate-50/70 dark:bg-slate-900/30'}>
                      <td className="sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-2 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.45)] dark:border-slate-800">
                        <div className="flex items-start gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!hasChildren) return;
                              setExpandedIds((current) => {
                                const next = new Set(current);
                                if (next.has(node.plano_contas_id)) {
                                  next.delete(node.plano_contas_id);
                                } else {
                                  next.add(node.plano_contas_id);
                                }
                                return next;
                              });
                            }}
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
                              {hasChildren ? 'Conta agregadora' : 'Nível folha'}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200">
                        {formatMoney(node.total_orcado)}
                      </td>

                      {node.meses.map((mes) => {
                        const deviationBadgeClass = getDeviationBadgeClass(node.tipo, mes.desvio_absoluto);
                        const deviationLabel = mes.valor_orcado !== 0 ? formatPercent(mes.desvio_percentual) : '—';
                        const tooltip = `Orçado: ${formatMoney(mes.valor_orcado)} | Desvio absoluto: ${formatMoney(mes.desvio_absoluto)}`;

                        return (
                          <td
                            key={`${node.plano_contas_id}-${mes.mes}`}
                            title={tooltip}
                            className="min-w-[100px] w-[100px] border-b border-r border-slate-200 px-2 py-2 text-right dark:border-slate-800 last:border-r-0"
                          >
                            <div className="flex items-center justify-end gap-1.5 leading-tight">
                              <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                                {formatMoney(mes.valor_realizado)}
                              </span>
                              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${deviationBadgeClass}`}>
                                {deviationLabel}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
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
