import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ChevronRight, RotateCcw, Save } from 'lucide-react';

import { api, normalizeListResponse } from '../services/api';

interface OrcamentoMes {
  mes: number;
  valor_realizado: number;
  valor_orcado: number;
  desvio_absoluto: number;
  desvio_percentual: number;
}

interface OrcamentoNode {
  plano_contas_id: number;
  conta_pai_id?: number | null;
  nome: string;
  codigo?: string | null;
  tipo: string;
  dre_grupo?: string | null;
  meses: OrcamentoMes[];
  total_realizado: number;
  total_orcado: number;
  total_desvio_absoluto: number;
  total_desvio_percentual: number;
  children: OrcamentoNode[];
}

interface BudgetEditPayload {
  plano_conta_id: number;
  ano: number;
  mes: number;
  valor_orcado: number;
}

interface VisibleNode {
  node: OrcamentoNode;
  level: number;
  hasChildren: boolean;
}

interface EditingCell {
  planoContaId: number;
  mes: number;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const EXCLUDED_DRE_GROUPS = new Set(['NÃO OPERACIONAL / FORA DA DRE', 'NAO OPERACIONAL / FORA DA DRE', 'NÃO OP.', 'NAO OP.']);

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

function buildOriginalLeafMap(nodes: OrcamentoNode[]): Map<string, number> {
  const map = new Map<string, number>();

  const walk = (node: OrcamentoNode) => {
    if (!node.children.length) {
      node.meses.forEach((mes) => {
        map.set(`${node.plano_contas_id}:${mes.mes}`, toNumber(mes.valor_orcado));
      });
      return;
    }

    node.children.forEach(walk);
  };

  nodes.forEach(walk);
  return map;
}

function normalizeNode(node: OrcamentoNode): OrcamentoNode {
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

function filterDRETree(nodes: OrcamentoNode[]): OrcamentoNode[] {
  return nodes
    .filter((node) => {
      const dreGroup = normalizeDreGroup(node.dre_grupo);
      return !EXCLUDED_DRE_GROUPS.has(dreGroup);
    })
    .map((node) => ({
      ...node,
      children: filterDRETree(node.children),
    }));
}

function recalculateNode(node: OrcamentoNode): OrcamentoNode {
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

function recalculateTree(nodes: OrcamentoNode[]) {
  return nodes.map(recalculateNode);
}

function patchLeafBudget(nodes: OrcamentoNode[], planoContaId: number, mes: number, valorOrcado: number): OrcamentoNode[] {
  return nodes.map((node) => {
    if (node.plano_contas_id === planoContaId && !node.children.length) {
      const meses = node.meses.map((item) => {
        if (item.mes !== mes) return item;
        const desvioAbsoluto = item.valor_realizado - valorOrcado;
        return {
          ...item,
          valor_orcado: valorOrcado,
          desvio_absoluto: desvioAbsoluto,
          desvio_percentual: valorOrcado !== 0 ? (desvioAbsoluto / valorOrcado) * 100 : 0,
        };
      });

      return { ...node, meses };
    }

    if (node.children.length) {
      return { ...node, children: patchLeafBudget(node.children, planoContaId, mes, valorOrcado) };
    }

    return node;
  });
}

function collectDirtyBudgets(nodes: OrcamentoNode[], originalMap: Map<string, number>, ano: number) {
  const payloads: BudgetEditPayload[] = [];

  const walk = (node: OrcamentoNode) => {
    if (!node.children.length) {
      node.meses.forEach((mes) => {
        const key = `${node.plano_contas_id}:${mes.mes}`;
        const originalValue = originalMap.get(key) ?? 0;
        const currentValue = toNumber(mes.valor_orcado);

        if (Math.abs(currentValue - originalValue) > 0.0001) {
          payloads.push({
            plano_conta_id: node.plano_contas_id,
            ano,
            mes: mes.mes,
            valor_orcado: currentValue,
          });
        }
      });
      return;
    }

    node.children.forEach(walk);
  };

  nodes.forEach(walk);
  return payloads;
}

function flattenVisibleNodes(nodes: OrcamentoNode[], expandedIds: Set<number>, level = 0): VisibleNode[] {
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

export function Orcamentos() {
  const currentYear = new Date().getFullYear();
  const [ano, setAno] = useState<number>(currentYear);
  const [matrix, setMatrix] = useState<OrcamentoNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalLeafValuesRef = useRef<Map<string, number>>(new Map());

  const loadMatrix = async (selectedYear: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<OrcamentoNode[]>(`/orcamentos/matriz/${selectedYear}`);
      const nodes = recalculateTree(filterDRETree(normalizeListResponse<OrcamentoNode>(response.data).map(normalizeNode)));
      originalLeafValuesRef.current = buildOriginalLeafMap(nodes);
      startTransition(() => {
        setMatrix(nodes);
        setExpandedIds(new Set(nodes.filter((node) => node.children.length).map((node) => node.plano_contas_id)));
      });
      setEditingCell(null);
      setEditingValue('');
    } catch (loadError) {
      console.error('Erro ao carregar matriz de orçamento:', loadError);
      setError('Não foi possível carregar a matriz de orçamento.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMatrix(ano);
  }, [ano]);

  const visibleRows = useMemo(() => flattenVisibleNodes(matrix, expandedIds), [matrix, expandedIds]);
  const dirtyPayloads = useMemo(() => collectDirtyBudgets(matrix, originalLeafValuesRef.current, ano), [matrix, ano]);
  const hasPendingChanges = dirtyPayloads.length > 0;

  function handleToggleExpanded(nodeId: number) {
    startTransition(() => {
      setExpandedIds((current) => {
        const next = new Set(current);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    });
  }

  function getCellKey(planoContaId: number, mes: number) {
    return `${planoContaId}-${mes}`;
  }

  function beginCellEdit(planoContaId: number, mes: number, currentValue: number) {
    setEditingCell({ planoContaId, mes });
    setEditingValue(String(Number.isFinite(currentValue) ? currentValue : 0));
  }

  function applyInlineEdit(baseMatrix: OrcamentoNode[], cell: EditingCell, valueRaw: string) {
    const nextValue = Number(valueRaw);
    const safeValue = Number.isFinite(nextValue) ? nextValue : 0;
    return recalculateTree(patchLeafBudget(baseMatrix, cell.planoContaId, cell.mes, safeValue));
  }

  function commitEditingCell() {
    if (!editingCell) return null;

    const updatedMatrix = applyInlineEdit(matrix, editingCell, editingValue);
    setMatrix(updatedMatrix);
    setEditingCell(null);
    setEditingValue('');
    return updatedMatrix;
  }

  function cancelEditingCell() {
    setEditingCell(null);
    setEditingValue('');
  }

  async function handleSaveChanges() {
    let currentMatrix = matrix;
    if (editingCell) {
      const maybeUpdated = commitEditingCell();
      if (maybeUpdated) {
        currentMatrix = maybeUpdated;
      }
    }

    const payloads = collectDirtyBudgets(currentMatrix, originalLeafValuesRef.current, ano);
    if (!payloads.length) return;

    setSaving(true);
    setError(null);
    try {
      await api.post('/orcamentos/batch', payloads);
      await loadMatrix(ano);
    } catch (saveError) {
      console.error('Erro ao salvar orçamento:', saveError);
      setError('Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetChanges() {
    await loadMatrix(ano);
    setEditingCell(null);
    setEditingValue('');
  }

  const summary = useMemo(() => {
    return matrix.reduce(
      (acc, node) => {
        acc.totalOrcado += node.total_orcado;
        return acc;
      },
      { totalOrcado: 0 },
    );
  }, [matrix]);

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <Calculator className="h-3.5 w-3.5" /> Planejamento Orçamentário
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Matriz de Orçamento</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Definição de metas orçamentárias por conta e por mês, com preenchimento rápido em grade.
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
            onClick={handleSaveChanges}
            disabled={!hasPendingChanges || saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>

          <button
            type="button"
            onClick={handleResetChanges}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <RotateCcw className="h-4 w-4" />
            Recarregar
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-1">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Orçado total</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.totalOrcado)}</p>
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
                    Carregando matriz de orçamento...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={2 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum orçamento encontrado para este ano.
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ node, level, hasChildren }, rowIndex) => {
                  const isLeaf = !hasChildren;
                  return (
                    <tr key={node.plano_contas_id} className={rowIndex % 2 === 0 ? 'bg-white dark:bg-slate-950/20' : 'bg-slate-50/70 dark:bg-slate-900/30'}>
                      <td className="sticky left-0 z-10 border-b border-r border-slate-200 px-3 py-2 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.45)] dark:border-slate-800">
                        <div className="flex items-start gap-2" style={{ paddingLeft: `${level * 18}px` }}>
                          <button
                            type="button"
                            onClick={() => hasChildren && handleToggleExpanded(node.plano_contas_id)}
                            disabled={!hasChildren}
                            className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 transition ${
                              hasChildren
                                ? 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                : 'opacity-30'
                            }`}
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

                      <td className="border-b border-r border-slate-200 px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200">
                        {formatMoney(node.total_orcado)}
                      </td>
                      {node.meses.map((mes) => {
                        const cellKey = getCellKey(node.plano_contas_id, mes.mes);
                        const isCellEditing = editingCell !== null && getCellKey(editingCell.planoContaId, editingCell.mes) === cellKey;
                        return (
                          <td
                            key={`${node.plano_contas_id}-${mes.mes}`}
                            onDoubleClick={() => {
                              if (isLeaf) {
                                beginCellEdit(node.plano_contas_id, mes.mes, mes.valor_orcado);
                              }
                            }}
                            className={`min-w-[100px] w-[100px] border-b border-r border-slate-200 px-2 py-2 text-right dark:border-slate-800 ${isLeaf ? 'cursor-text' : 'cursor-default'} last:border-r-0`}
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
