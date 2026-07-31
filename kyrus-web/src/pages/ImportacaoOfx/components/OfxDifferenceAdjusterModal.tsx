import React, { useState } from 'react';
import { X, Scale, Calculator, ArrowRight } from 'lucide-react';

interface OfxDifferenceAdjusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  valorBanco: number;
  valorPrevisto: number;
  diferenca: number; // valorBanco - valorPrevisto
  onAjustarValorPrevisto: () => void;
  onLancarDiferenca: (tipoBaixa: 'JUROS' | 'MULTA' | 'TARIFA' | 'DESCONTO') => void;
}

export const OfxDifferenceAdjusterModal: React.FC<OfxDifferenceAdjusterModalProps> = ({
  isOpen,
  onClose,
  valorBanco,
  valorPrevisto,
  diferenca,
  onAjustarValorPrevisto,
  onLancarDiferenca,
}) => {
  const [tipoSelecionado, setTipoSelecionado] = useState<'JUROS' | 'MULTA' | 'TARIFA' | 'DESCONTO'>(
    diferenca > 0 ? 'JUROS' : 'DESCONTO'
  );

  if (!isOpen) return null;

  const formatMoney = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(val));

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 rounded-xl">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Divergência de Valores
              </h3>
              <p className="text-xs text-slate-500">
                Valor Banco: <strong className="text-slate-700 dark:text-slate-300">{formatMoney(valorBanco)}</strong> | Previsto: <strong className="text-slate-700 dark:text-slate-300">{formatMoney(valorPrevisto)}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-4 rounded-2xl mb-6">
          <div className="flex items-center justify-between text-sm font-bold text-amber-800 dark:text-amber-300">
            <span>Diferença apurada:</span>
            <span className="text-base">{formatMoney(diferenca)}</span>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            {diferenca > 0
              ? 'O valor depositado/debitado no banco é maior do que o valor cadastrado na previsão.'
              : 'O valor no banco é menor do que a previsão cadastrada (desconto ou retenção de taxa).'}
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => {
              onAjustarValorPrevisto();
              onClose();
            }}
            className="w-full p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 text-left transition-all group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                1. Ajustar o valor previsto do título
              </span>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-transform group-hover:translate-x-1" />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Atualiza o lançamento previsto original para {formatMoney(valorBanco)}, quitando o título sem criar ajustes extras.
            </p>
          </button>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40">
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 block mb-2">
              2. Lançar a diferença como taxa ou desconto
            </span>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(diferenca > 0 ? ['JUROS', 'MULTA', 'TARIFA'] : ['DESCONTO', 'TARIFA']).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setTipoSelecionado(cat as any)}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                    tipoSelecionado === cat
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {cat === 'JUROS' && 'Juros / Encargos'}
                  {cat === 'MULTA' && 'Multa por Atraso'}
                  {cat === 'TARIFA' && 'Tarifa Bancária'}
                  {cat === 'DESCONTO' && 'Desconto Concedido'}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                onLancarDiferenca(tipoSelecionado);
                onClose();
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2"
            >
              <Calculator className="w-4 h-4" />
              Lançar {formatMoney(diferenca)} como {tipoSelecionado}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
