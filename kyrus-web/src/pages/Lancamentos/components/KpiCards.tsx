import { useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Kpis {
  r: number;
  d: number;
  s: number;
}

interface KpiCardsProps {
  kpis: Kpis;
  showResumoKpis: boolean;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const KpiCards = ({ kpis, showResumoKpis }: KpiCardsProps) => {
  const kpiCards = useMemo(() => {
    if (!showResumoKpis) return [];
    return [
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
  }, [showResumoKpis, kpis.r, kpis.d]);

  if (!showResumoKpis) return null;

  return (
    <div className="px-4 sm:px-6 pt-2 pb-1">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
    </div>
  );
};
