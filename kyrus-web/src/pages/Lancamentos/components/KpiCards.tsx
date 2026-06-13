import { useState } from 'react';
import { ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';

interface Kpis {
  r: number;
  d: number;
  s: number;
}

interface KpiCardsProps {
  kpis: Kpis;
}

export const KpiCards = ({ kpis }: KpiCardsProps) => {
  const [showResumoKpis, setShowResumoKpis] = useState(false);
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const kpiCards = [
    {
      label: 'Receitas',
      value: BRL.format(kpis.r),
      tone: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10 dark:bg-emerald-900/20',
      icon: TrendingUp,
    },
    {
      label: 'Despesas',
      value: BRL.format(kpis.d),
      tone: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-500/10 dark:bg-red-900/20',
      icon: TrendingDown,
    },
  ];

  return (
    <div className="px-4 sm:px-6 pt-2 pb-1">
      <button
        type="button"
        onClick={() => setShowResumoKpis((prev) => !prev)}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition ${showResumoKpis ? 'border-blue-600 bg-blue-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${showResumoKpis ? 'rotate-180' : ''}`} />
        KPI de receitas e despesas
      </button>

      {showResumoKpis && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
            >
              <div className={card.tone}>
                <p className="mb-0.5 text-[10px] font-bold uppercase opacity-70">{card.label}</p>
                <p className="text-xl font-black">{card.value}</p>
              </div>
              <div className={`rounded-lg p-1.5 ${card.bg}`}>
                <card.icon className={`h-5 w-5 ${card.tone}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
