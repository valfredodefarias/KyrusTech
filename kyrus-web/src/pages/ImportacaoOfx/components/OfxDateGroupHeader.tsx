import React from 'react';
import { Calendar, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

interface OfxDateGroupHeaderProps {
  dataFormatted: string; // Ex: "Terça-feira, 29/07/2026"
  totalItens: number;
  totalEntradas: number;
  totalSaidas: number;
  isCollapsed: boolean;
  onToggle: () => void;
}

export const OfxDateGroupHeader: React.FC<OfxDateGroupHeaderProps> = ({
  dataFormatted,
  totalItens,
  totalEntradas,
  totalSaidas,
  isCollapsed,
  onToggle,
}) => {
  const formatMoney = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const saldoDia = totalEntradas - totalSaidas;

  return (
    <div
      onClick={onToggle}
      className="cursor-pointer select-none bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl p-3.5 mb-3 mt-6 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-all shadow-sm"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
          <Calendar className="w-4 h-4" />
        </div>
        <div>
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {dataFormatted}
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
              {totalItens} movimentaçõ{totalItens > 1 ? 'es' : 'ão'}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-medium justify-between md:justify-end">
        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5" /> +{formatMoney(totalEntradas)}
        </span>
        <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <ArrowDownLeft className="w-3.5 h-3.5" /> -{formatMoney(totalSaidas)}
        </span>
        <span
          className={`font-bold px-2.5 py-1 rounded-lg ${
            saldoDia >= 0
              ? 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-rose-100/70 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
          }`}
        >
          Dia: {saldoDia >= 0 ? '+' : ''}{formatMoney(saldoDia)}
        </span>

        <div className="p-1 text-slate-400">
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>
    </div>
  );
};
