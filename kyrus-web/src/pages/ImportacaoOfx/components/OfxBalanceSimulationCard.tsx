import React from 'react';
import { DollarSign, ArrowUpRight, ArrowDownLeft, ShieldCheck } from 'lucide-react';

interface OfxBalanceSimulationCardProps {
  saldoAtual: number;
  totalReceitas: number;
  totalDespesas: number;
  saldoProjetado: number;
  ledgerBal?: number | null;
}

export const OfxBalanceSimulationCard: React.FC<OfxBalanceSimulationCardProps> = ({
  saldoAtual,
  totalReceitas,
  totalDespesas,
  saldoProjetado,
  ledgerBal,
}) => {
  const formatMoney = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const bateuComExtrato = ledgerBal != null && Math.abs(ledgerBal - saldoProjetado) < 0.05;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-6 mb-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold tracking-wide uppercase text-slate-600 dark:text-slate-400 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-500" />
          Projeção de Saldo Pós-Importação
        </h3>
        {ledgerBal != null && (
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1.5 ${
              bateuComExtrato
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {bateuComExtrato ? 'Bate com o Saldo Bancário OFX' : 'Aguardando Aprovação de Todos os Itens'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
          <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Saldo Atual no ERP</span>
          <span className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100">
            {formatMoney(saldoAtual)}
          </span>
        </div>

        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
          <span className="text-xs text-emerald-600 dark:text-emerald-400 block mb-1 flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" /> Entradas a Conciliar
          </span>
          <span className="text-base md:text-lg font-bold text-emerald-600 dark:text-emerald-400">
            + {formatMoney(totalReceitas)}
          </span>
        </div>

        <div className="bg-rose-50/50 dark:bg-rose-950/20 p-3 rounded-xl border border-rose-100 dark:border-rose-900/30">
          <span className="text-xs text-rose-600 dark:text-rose-400 block mb-1 flex items-center gap-1">
            <ArrowDownLeft className="w-3.5 h-3.5" /> Saídas a Conciliar
          </span>
          <span className="text-base md:text-lg font-bold text-rose-600 dark:text-rose-400">
            - {formatMoney(totalDespesas)}
          </span>
        </div>

        <div className="bg-indigo-50/60 dark:bg-indigo-950/30 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
          <span className="text-xs text-indigo-600 dark:text-indigo-400 block mb-1 font-semibold">
            Saldo Projetado Final
          </span>
          <span className="text-base md:text-lg font-extrabold text-indigo-700 dark:text-indigo-300">
            {formatMoney(saldoProjetado)}
          </span>
        </div>
      </div>
    </div>
  );
};
