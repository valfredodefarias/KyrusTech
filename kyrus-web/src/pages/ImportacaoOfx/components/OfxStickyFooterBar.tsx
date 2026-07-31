import React from 'react';
import { CheckCircle2, Loader2, ArrowRight, AlertTriangle } from 'lucide-react';

interface OfxStickyFooterBarProps {
  totalItems: number;
  reviewedCount: number;
  saldoAtualErp: number;
  saldoProjetado: number;
  saldoOfx?: number | null;
  saldoOfxData?: string | null;
  pendentesCategoriaCount?: number;
  loading: boolean;
  onConfirm: () => void;
}

export const OfxStickyFooterBar: React.FC<OfxStickyFooterBarProps> = ({
  totalItems,
  reviewedCount,
  saldoAtualErp,
  saldoProjetado,
  saldoOfx,
  saldoOfxData,
  pendentesCategoriaCount = 0,
  loading,
  onConfirm,
}) => {
  const formatMoney = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  const pct = totalItems > 0 ? Math.round((reviewedCount / totalItems) * 100) : 0;
  const temSaldoOfx = saldoOfx != null && !isNaN(Number(saldoOfx));
  const diferenca = temSaldoOfx ? Number((saldoProjetado - Number(saldoOfx)).toFixed(2)) : 0;
  const saldoBatido = temSaldoOfx && Math.abs(diferenca) < 0.01;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 shadow-2xl backdrop-blur-md px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Progress & 3 Core Balances */}
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-extrabold text-xs">
              {pct}%
            </div>
            <div>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-semibold uppercase tracking-wider">
                Revisão
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {reviewedCount}/{totalItems} itens
              </span>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          {/* 1. Saldo OFX Banco */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold uppercase tracking-wider">
              1. Saldo Extrato OFX (Banco)
            </span>
            <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
              {temSaldoOfx ? formatMoney(Number(saldoOfx)) : 'Não informado'}
            </span>
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          {/* 2. Saldo Projetado ERP */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold uppercase tracking-wider">
              2. Saldo Projetado (ERP)
            </span>
            <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
              {formatMoney(saldoProjetado)}
            </span>
          </div>

          <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          {/* 3. Diferença Apurada */}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-bold uppercase tracking-wider">
              3. Diferença Apurada
            </span>
            {temSaldoOfx ? (
              saldoBatido ? (
                <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Saldo 100% Batido
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-lg border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Diferença: {formatMoney(Math.abs(diferenca))}
                </span>
              )
            ) : (
              <span className="text-xs text-slate-400">Sem referência</span>
            )}
          </div>
        </div>

        {/* Confirmation Button */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          {pendentesCategoriaCount > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium hidden lg:inline">
              {pendentesCategoriaCount} sem categoria
            </span>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className="w-full md:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando Lançamentos...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirmar Importação OFX
                <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
