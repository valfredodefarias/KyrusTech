import { Calendar, ChevronDown, Check, Paperclip, Search, Layers } from 'lucide-react';
import type { Lancamento, ListaSortKey, ListaSortDirection } from '../types';
import {
  isTransferencia,
  isLancamentoAtrasado,
  formatDateExtenso,
  getCategoriaLabel,
} from '../utils';

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
}: LancamentosTableProps) => {
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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
        <div key={date} className="mb-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-center gap-4 mb-1.5 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-10 py-1.5 border-b border-slate-200 dark:border-slate-800">
            <div className="px-3 py-1 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 shadow-sm">
              <Calendar className="w-4 h-4 text-blue-500" />
              {formatDateExtenso(date)}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="w-12 p-2.5 text-center">Sel</th>
                    <th className="w-12 p-2.5 text-center">IPP</th>
                    <th className="w-[36%] p-2.5" aria-sort={getHeaderAriaSort('descricao')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('descricao')}
                        className="group inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Descrição</span>
                        <ChevronDown className={getSortIconClass('descricao')} />
                      </button>
                    </th>
                    <th className="hidden w-[30%] p-2.5 md:table-cell" aria-sort={getHeaderAriaSort('interessado')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('interessado')}
                        className="group inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Interessado / Categoria</span>
                        <ChevronDown className={getSortIconClass('interessado')} />
                      </button>
                    </th>
                    <th className="w-32 p-2.5 text-right" aria-sort={getHeaderAriaSort('valor')}>
                      <button
                        type="button"
                        onClick={() => toggleListaSort('valor')}
                        className="group inline-flex w-full items-center justify-end gap-1 rounded-md px-1 py-0.5 text-right transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Valor</span>
                        <ChevronDown className={getSortIconClass('valor')} />
                      </button>
                    </th>
                    <th className="w-28 p-2.5 text-center" aria-sort={getHeaderAriaSort('status')}>
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
                <tbody className="text-[15px] divide-y divide-slate-200 dark:divide-slate-700">
                  {grouped.groups[date].map((l) => {
                    const atrasado = isLancamentoAtrasado(l);
                    const pago = String(l.status).toUpperCase() === 'PAGO';
                    const parcial = String(l.status).toUpperCase() === 'PARCIALMENTE_PAGO';
                    const statusLabel = pago ? 'PAGO' : parcial ? 'PARCIAL' : atrasado ? 'ATRASADO' : l.status;
                    const transfer = isTransferencia(l);
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
                            : pago
                              ? 'bg-emerald-100/70 dark:bg-emerald-900/25'
                              : parcial
                                ? 'bg-amber-100/40 dark:bg-amber-900/10'
                                : atrasado
                                  ? 'bg-red-200/80 dark:bg-red-900/40'
                                  : ''
                        }`}
                      >
                        <td className="w-12 p-2.5 text-center align-middle" onClick={(e) => e.stopPropagation()}>
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
                            className={`w-7 h-7 rounded border flex items-center justify-center transition pointer-events-auto ${
                              l.conciliado
                                ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-800'
                                : selectedIds.has(l.id)
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-blue-400'
                            }`}
                          >
                            <Check className={`w-3 h-3 ${selectedIds.has(l.id) ? 'opacity-100' : 'opacity-0'}`} />
                          </button>
                        </td>
                        <td
                          className="w-12 p-2.5 text-center align-middle"
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
                            disabled={transfer || l.conciliado}
                            className={`w-7 h-7 rounded border flex items-center justify-center transition pointer-events-auto ${
                              l.ipp
                                ? 'bg-purple-600 border-purple-600 text-white'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-purple-400'
                            } ${transfer || l.conciliado ? 'cursor-not-allowed opacity-40' : ''}`}
                            title={l.conciliado ? "Lançamento conciliado" : "Marcar como IPP"}
                            aria-pressed={l.ipp}
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </td>
                        <td
                          className={`p-2.5 align-middle font-semibold text-slate-800 dark:text-white ${
                            contaExtratoAtivaId !== null ? 'text-[13px]' : ''
                          }`}
                        >
                           <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate">{l.descricao}</span>
                            {l.anexos?.length > 0 && <Paperclip className="h-3 w-3 shrink-0 text-blue-400" />}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {l.numero_parcela && (
                              <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800/40 px-1.5 py-0.5 rounded">
                                Parcela {l.numero_parcela}
                              </span>
                            )}
                            {l.id_parcelamento && (
                              <span className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                                <Layers className="w-2.5 h-2.5" />
                                Vinculado
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden p-2.5 align-middle md:table-cell">
                          <div className="truncate text-sm font-bold text-slate-700 dark:text-slate-300">
                            {entidades.find((e) => e.id === l.entidade_id)?.nome || '-'}
                          </div>
                          <div className="truncate text-[12px] text-slate-500">{getCategoriaLabel(l, categorias)}</div>
                        </td>
                        <td
                          className={`p-2.5 text-right align-middle tabular-nums font-bold ${
                            l.tipo === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {BRL.format(l.valor_previsto)}
                        </td>
                        <td className="w-28 p-2.5 text-center align-middle">
                          <span
                            className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase border ${
                              pago
                                ? 'bg-emerald-200/90 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                                : parcial
                                  ? 'bg-amber-200/90 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800'
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
