import { useState, useMemo, useEffect } from 'react';
import { Calendar, ChevronDown, Check, Paperclip, Search, Layers } from 'lucide-react';
import type { Lancamento, ListaSortKey, ListaSortDirection } from '../types';
import {
  isTransferencia,
  isLancamentoAtrasado,
  formatDateExtenso,
  getCategoriaLabel,
} from '../utils';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface GroupedData {
  groups: Record<string, Lancamento[]>;
  sortedDates: string[];
}

interface LancamentosTableProps {
  grouped: GroupedData;
  selectedIds: Set<number>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  toggleIpp: (l: Lancamento) => void;
  openDrawer: (l?: Lancamento) => void;
  entidades: any[];
  categorias: any[];
  listaSort: { key: ListaSortKey; direction: ListaSortDirection };
  toggleListaSort: (key: ListaSortKey) => void;
  contaExtratoAtivaId: number | null;
  savingIppIds: Set<number>;
  filtroTexto?: string;
}

export const LancamentosTable = ({
  grouped,
  selectedIds,
  setSelectedIds,
  toggleIpp,
  openDrawer,
  entidades,
  categorias,
  listaSort,
  toggleListaSort,
  contaExtratoAtivaId,
  savingIppIds,
  filtroTexto = '',
}: LancamentosTableProps) => {
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const flatLancamentos = useMemo(() => {
    return grouped.sortedDates.flatMap((date) => grouped.groups[date] || []);
  }, [grouped]);

  const highlightText = (text: string, search: string) => {
    if (!text) return '';
    if (!search || !search.trim()) return text;
    const cleanSearch = search.trim();
    const regex = new RegExp(`(${cleanSearch.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="bg-yellow-200 text-slate-900 rounded-[2px] px-0.5 dark:bg-yellow-500/80 dark:text-white">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.getAttribute('contenteditable') === 'true'
      )) {
        return;
      }

      if (flatLancamentos.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedId((prev) => {
          if (prev === null) return flatLancamentos[0].id;
          const idx = flatLancamentos.findIndex(l => l.id === prev);
          if (idx === -1 || idx === flatLancamentos.length - 1) return flatLancamentos[0].id;
          return flatLancamentos[idx + 1].id;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedId((prev) => {
          if (prev === null) return flatLancamentos[flatLancamentos.length - 1].id;
          const idx = flatLancamentos.findIndex(l => l.id === prev);
          if (idx === -1 || idx === 0) return flatLancamentos[flatLancamentos.length - 1].id;
          return flatLancamentos[idx - 1].id;
        });
      } else if (e.key === ' ') {
        if (focusedId !== null) {
          const focusedItem = flatLancamentos.find(l => l.id === focusedId);
          if (focusedItem && !focusedItem.conciliado) {
            e.preventDefault();
            setSelectedIds((prev) => {
              const s = new Set(prev);
              if (s.has(focusedId)) s.delete(focusedId);
              else s.add(focusedId);
              return s;
            });
          }
        }
      } else if (e.key === 'Enter') {
        if (focusedId !== null) {
          const focusedItem = flatLancamentos.find(l => l.id === focusedId);
          if (focusedItem && !isTransferencia(focusedItem)) {
            e.preventDefault();
            openDrawer(focusedItem);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [flatLancamentos, focusedId, setSelectedIds, openDrawer]);

  const getHeaderAriaSort = (key: ListaSortKey): 'none' | 'ascending' | 'descending' => {
    if (listaSort.key !== key) return 'none';
    return listaSort.direction === 'asc' ? 'ascending' : 'descending';
  };

  const getSortIconClass = (key: ListaSortKey) => {
    if (listaSort.key !== key) {
      return 'h-3.5 w-3.5 opacity-35 transition-all group-hover:opacity-70';
    }
    return `h-3.5 w-3.5 text-blue-500 opacity-100 transition-all ${listaSort.direction === 'asc' ? 'rotate-180' : ''}`;
  };

  if (grouped.sortedDates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500 opacity-60">
        <Search className="w-12 h-12 mb-2" />
        <p>Nenhum lançamento encontrado.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 sm:px-6 pb-20 overflow-y-auto custom-scrollbar">
      {grouped.sortedDates.map((date) => (
        <div key={date} className="mb-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-center gap-4 mb-1.5 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 py-1 border-b border-slate-200 dark:border-slate-800">
            <div className="px-2.5 py-0.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 shadow-sm">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              {formatDateExtenso(date)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="w-12 py-1.5 px-2.5 text-center">Sel</th>
                    <th className="w-12 py-1.5 px-2.5 text-center">IPP</th>
                    <th className="hidden w-[30%] py-1.5 px-2.5 md:table-cell" aria-sort={getHeaderAriaSort('interessado')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('interessado')}
                        className="group inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Interessado / Categoria</span>
                        <ChevronDown className={getSortIconClass('interessado')} />
                      </button>
                    </th>
                    <th className="w-[36%] py-1.5 px-2.5" aria-sort={getHeaderAriaSort('descricao')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('descricao')}
                        className="group inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Descrição</span>
                        <ChevronDown className={getSortIconClass('descricao')} />
                      </button>
                    </th>
                    <th className="w-32 py-1.5 px-2.5 text-right" aria-sort={getHeaderAriaSort('valor')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('valor')}
                        className="group inline-flex w-full items-center justify-end gap-1 rounded-md px-1 py-0.5 text-right transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Valor</span>
                        <ChevronDown className={getSortIconClass('valor')} />
                      </button>
                    </th>
                    <th className="w-28 py-1.5 px-2.5 text-center" aria-sort={getHeaderAriaSort('status')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('status')}
                        className="group inline-flex w-full items-center justify-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Status</span>
                        <ChevronDown className={getSortIconClass('status')} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px] divide-y divide-slate-200 dark:divide-slate-700">
                  {grouped.groups[date].map((l) => {
                    const atrasado = isLancamentoAtrasado(l);
                    const pago = String(l.status).toUpperCase() === 'PAGO';
                    const statusLabel = pago ? 'PAGO' : atrasado ? 'ATRASADO' : l.status;
                    const transfer = isTransferencia(l);
                    const entidadeNome = entidades.find((e) => e.id === l.entidade_id)?.nome || '-';
                    const isFocused = focusedId === l.id;

                    return (
                      <tr
                        key={l.id}
                        onClick={() => {
                          if (!transfer) openDrawer(l);
                        }}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-700/50 transition group ${
                          transfer ? 'cursor-default' : 'cursor-pointer'
                        } ${
                          selectedIds.has(l.id)
                            ? 'bg-blue-100/80 dark:bg-blue-900/25'
                            : ''
                        } ${isFocused ? 'ring-2 ring-blue-500 ring-inset dark:ring-blue-400 bg-slate-100 dark:bg-slate-700/60' : ''}`}
                      >
                        <td
                          className={`w-12 py-1.5 px-2.5 text-center align-middle border-l-4 transition-all ${
                            atrasado
                              ? 'border-rose-500'
                              : pago
                                ? 'border-emerald-500'
                                : 'border-slate-300 dark:border-slate-700'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            aria-label="Selecionar lançamento"
                            disabled={l.conciliado}
                            title={l.conciliado ? "Lançamentos conciliados não podem ser alterados em lote" : "Selecionar lançamento"}
                            onClick={() => {
                              setSelectedIds((prev) => {
                                const s = new Set(prev);
                                if (s.has(l.id)) s.delete(l.id);
                                else s.add(l.id);
                                return s;
                              });
                            }}
                            className={`w-6 h-6 rounded border flex items-center justify-center transition pointer-events-auto mx-auto ${
                              l.conciliado
                                ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-800'
                                : selectedIds.has(l.id)
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-blue-400'
                            }`}
                          >
                            <Check className={`w-2.5 h-2.5 ${selectedIds.has(l.id) ? 'opacity-100' : 'opacity-0'}`} />
                          </button>
                        </td>

                        {/* IPP Column */}
                        <td
                          className="w-12 py-1.5 px-2.5 text-center align-middle"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleIpp(l);
                            }}
                            disabled={transfer || l.conciliado || savingIppIds.has(l.id)}
                            className={`w-6 h-6 rounded border flex items-center justify-center transition pointer-events-auto mx-auto ${
                              l.ipp
                                ? 'bg-purple-600 border-purple-600 text-white'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-purple-400'
                            } ${transfer || l.conciliado || savingIppIds.has(l.id) ? 'cursor-not-allowed opacity-40' : ''}`}
                            title={l.conciliado ? "Lançamento conciliado" : savingIppIds.has(l.id) ? "Salvando..." : "Marcar como IPP"}
                            aria-pressed={l.ipp}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        {/* Interested Party / Category (Swapped to Left) */}
                        <td
                          className="hidden py-1.5 px-2.5 align-middle md:table-cell"
                          title={entidadeNome}
                        >
                          <div className="truncate text-xs font-bold text-slate-700 dark:text-slate-300">
                            {highlightText(entidadeNome, filtroTexto)}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {highlightText(getCategoriaLabel(l, categorias), filtroTexto)}
                          </div>
                        </td>

                        {/* Description */}
                        <td
                          className={`py-1.5 px-2.5 align-middle font-semibold text-slate-800 dark:text-white ${
                            contaExtratoAtivaId !== null ? 'text-[12px]' : ''
                          }`}
                          title={l.descricao}
                        >
                           <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{highlightText(l.descricao, filtroTexto)}</span>
                            {l.anexos?.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-blue-400" />}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {l.numero_parcela && (
                              <span className="text-[9px] text-slate-500 bg-slate-100 dark:bg-slate-800/40 px-1 py-0.5 rounded">
                                Parcela {l.numero_parcela}
                              </span>
                            )}
                            {l.id_parcelamento && (
                              <span className="text-[9px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-1 py-0.5 rounded font-medium flex items-center gap-1">
                                <Layers className="w-2 h-2" />
                                Vinculado
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Value */}
                        <td
                          className={`py-1.5 px-2.5 text-right align-middle tabular-nums font-bold ${
                            l.tipo === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {BRL.format(l.valor_previsto)}
                        </td>

                        {/* Status */}
                        <td className="w-28 py-1.5 px-2.5 text-center align-middle">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              pago
                                ? 'bg-emerald-200/90 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                                : atrasado
                                  ? 'bg-red-200/90 dark:bg-red-900/35 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800'
                                  : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600'
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
