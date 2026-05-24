import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ChevronRight, PencilLine, RotateCcw, Save } from 'lucide-react';

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

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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

function isReceita(tipo?: string | null) {
  return String(tipo || '').trim().toUpperCase().startsWith('R');
}

function formatMoney(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value: number) {
  return `${percentFormatter.format(Number.isFinite(value) ? value : 0)}%`;
}

function getDesvioToneClass(tipo: string, desvioAbsoluto: number) {
  const positiveIsGood = isReceita(tipo);
  const isFavorable = positiveIsGood ? desvioAbsoluto >= 0 : desvioAbsoluto < 0;
  return isFavorable
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
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
    total_realizado: toNumber(node.total_realizado),
    total_orcado: toNumber(node.total_orcado),
    total_desvio_absoluto: toNumber(node.total_desvio_absoluto),
    total_desvio_percentual: toNumber(node.total_desvio_percentual),
    meses,
    children,
  };
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
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalLeafValuesRef = useRef<Map<string, number>>(new Map());

  const loadMatrix = async (selectedYear: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<OrcamentoNode[]>(`/orcamentos/matriz/${selectedYear}`);
      const nodes = recalculateTree(normalizeListResponse<OrcamentoNode>(response.data).map(normalizeNode));
      originalLeafValuesRef.current = buildOriginalLeafMap(nodes);
      startTransition(() => {
        setMatrix(nodes);
        setExpandedIds(new Set(nodes.filter((node) => node.children.length).map((node) => node.plano_contas_id)));
      });
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

  function handleEditToggle() {
    setIsEditing((current) => !current);
  }

  function handleBudgetChange(planoContaId: number, mes: number, rawValue: string) {
    const nextValue = Number(rawValue);
    const safeValue = Number.isFinite(nextValue) ? nextValue : 0;

    startTransition(() => {
      setMatrix((current) => recalculateTree(patchLeafBudget(current, planoContaId, mes, safeValue)));
    });
  }

  async function handleSaveChanges() {
    if (!hasPendingChanges) return;

    setSaving(true);
    setError(null);
    try {
      await api.post('/orcamentos/batch', dirtyPayloads);
      await loadMatrix(ano);
      setIsEditing(false);
    } catch (saveError) {
      console.error('Erro ao salvar orçamento:', saveError);
      setError('Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetChanges() {
    await loadMatrix(ano);
    setIsEditing(false);
  }

  const summary = useMemo(() => {
    return matrix.reduce(
      (acc, node) => {
        acc.totalOrcado += node.total_orcado;
        acc.totalRealizado += node.total_realizado;
        return acc;
      },
      { totalOrcado: 0, totalRealizado: 0 },
    );
  }, [matrix]);

  const totalDesvio = summary.totalRealizado - summary.totalOrcado;

  return (
    <div className="space-y-6 pb-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <Calculator className="h-3.5 w-3.5" /> Planejamento Orçamentário
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Matriz de Orçamento</h1>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Estrutura em árvore com edição local nas contas folha, recalculo instantâneo e salvamento em lote.
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
            onClick={handleEditToggle}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              isEditing
                ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            <PencilLine className="h-4 w-4" />
            {isEditing ? 'Modo de edição ativo' : 'Editar Orçamento'}
          </button>

          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={!isEditing || !hasPendingChanges || saving}
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

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Orçado total</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.totalOrcado)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Realizado total</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{formatMoney(summary.totalRealizado)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Desvio total</p>
          <p className={`mt-2 text-2xl font-black tracking-tight ${getDesvioToneClass('D', totalDesvio)}`}>{formatMoney(totalDesvio)}</p>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95">
              <tr>
                <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Conta
                </th>
                <th className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Orçado total
                </th>
                <th className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Realizado total
                </th>
                <th className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Desvio
                </th>
                {MONTH_LABELS.map((label) => (
                  <th key={label} className="border-b border-slate-200 px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Carregando matriz de orçamento...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={4 + MONTH_LABELS.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    Nenhum orçamento encontrado para este ano.
                  </td>
                </tr>
              ) : (
                visibleRows.map(({ node, level, hasChildren }) => {
                  const isLeaf = !hasChildren;
                  return (
                    <tr key={node.plano_contas_id} className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-1.5 dark:border-slate-900 dark:bg-slate-950">
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
                            <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                              {node.codigo ? `${node.codigo} - ` : ''}
                              {node.nome}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                              {node.tipo === 'R' ? 'Receita' : 'Despesa'}
                              {isLeaf ? ' · Nível folha' : ' · Conta agregadora'}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="border-b border-slate-100 px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-slate-700 dark:border-slate-900 dark:text-slate-200">
                        {formatMoney(node.total_orcado)}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-slate-700 dark:border-slate-900 dark:text-slate-200">
                        {formatMoney(node.total_realizado)}
                      </td>
                      <td className="border-b border-slate-100 px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-slate-700 dark:border-slate-900 dark:text-slate-200">
                        <div className="flex flex-col items-end leading-tight">
                          <span>{formatMoney(node.total_desvio_absoluto)}</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatPercent(node.total_desvio_percentual)}</span>
                        </div>
                      </td>

                      {node.meses.map((mes) => {
                        const desvioClass = getDesvioToneClass(node.tipo, mes.desvio_absoluto);
                        return (
                          <td key={`${node.plano_contas_id}-${mes.mes}`} className="border-b border-slate-100 px-2 py-1.5 text-right dark:border-slate-900">
                            <div className="leading-tight">
                              {isLeaf && isEditing ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number.isFinite(mes.valor_orcado) ? mes.valor_orcado : 0}
                                  onChange={(event) => handleBudgetChange(node.plano_contas_id, mes.mes, event.target.value)}
                                  className="w-full border-0 border-b border-transparent bg-transparent px-0 py-0 text-right text-[13px] font-semibold tabular-nums text-slate-900 outline-none focus:border-slate-400 focus:ring-0 dark:text-slate-100 dark:focus:border-slate-500"
                                />
                              ) : (
                                <div className="text-[13px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                                  {formatMoney(mes.valor_orcado)}
                                </div>
                              )}

                              <div className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                <span>Real: {formatMoney(mes.valor_realizado)}</span>
                                <span className="px-1 text-slate-300 dark:text-slate-600">|</span>
                                <span>
                                  Desv: <span className={desvioClass}>{formatPercent(mes.desvio_percentual)}</span>
                                </span>
                              </div>
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
        <p>
          {isEditing
            ? 'Modo de edição ativo: apenas contas folha ficam editáveis.'
            : 'A tabela começa bloqueada para leitura. Clique em Editar Orçamento para alterar apenas contas folha.'}
        </p>
        <p>{hasPendingChanges ? `${dirtyPayloads.length} alteração(ões) pendente(s)` : 'Nenhuma alteração pendente'}</p>
      </footer>
    </div>
  );
}
