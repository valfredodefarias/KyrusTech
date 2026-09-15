import React from 'react';
import { ToggleSimNao, InputDark } from '../InputDark';
import { splitAmountIntoInstallments, formatCurrencyBRL, toCents, fromCents } from '../../../../utils/money';

interface LancamentoParcelasSectionProps {
  isCaixaMode?: boolean;
  formData: any;
  setFormData: React.Dispatch<React.SetStateAction<any>>;
  amountText: string;
  parseAmountExpression: (v: any) => number | null;
  BRL: Intl.NumberFormat;
}

export const LancamentoParcelasSection: React.FC<LancamentoParcelasSectionProps> = ({
  isCaixaMode,
  formData,
  setFormData,
  amountText,
  parseAmountExpression,
  BRL,
}) => {
  if (isCaixaMode) return null;

  const currentVal = parseAmountExpression(amountText) ?? Number(formData.valor_previsto || 0);
  const qtd = Math.max(2, Number(formData.qtd_parcelas || 2));
  const isTotalMode = (formData.modo_calculo || 'TOTAL') === 'TOTAL';

  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
      <ToggleSimNao
        label="Pagamento parcelado"
        value={!!formData.is_parcelado}
        onChange={(next) => setFormData((prev: any) => ({ ...prev, is_parcelado: next }))}
      />

      {formData.is_parcelado && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <InputDark
              label="Qtd. de parcelas"
              type="number"
              min={2}
              value={formData.qtd_parcelas}
              onChange={(e: any) =>
                setFormData((prev: any) => ({
                  ...prev,
                  qtd_parcelas: Math.max(2, Number(e.target.value) || 2),
                }))
              }
            />
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'TOTAL' }))}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    isTotalMode
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Total
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'PARCELA' }))}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    !isTotalMode
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Por parcela
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Frequência</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData((prev: any) => ({ ...prev, tipo_intervalo: 'MENSAL' }))}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    formData.tipo_intervalo !== 'DIAS'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Mensal
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev: any) => ({ ...prev, tipo_intervalo: 'DIAS' }))}
                  className={`py-2 rounded-lg text-xs font-bold border transition ${
                    formData.tipo_intervalo === 'DIAS'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  A cada X dias
                </button>
              </div>
            </div>
            <div>
              {formData.tipo_intervalo === 'DIAS' ? (
                <InputDark
                  label="Intervalo (dias)"
                  type="number"
                  min={1}
                  value={formData.intervalo_dias || 30}
                  onChange={(e: any) =>
                    setFormData((prev: any) => ({
                      ...prev,
                      intervalo_dias: Math.max(1, Number(e.target.value) || 30),
                    }))
                  }
                />
              ) : (
                <div className="opacity-50 select-none">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Intervalo</label>
                  <div className="py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-400 bg-white dark:bg-slate-900 h-[38px] flex items-center">
                    30 dias (Aprox.)
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <ToggleSimNao
              label="Ajustar vencimentos para dia útil?"
              value={formData.ajustar_vencimento_dia_util !== false}
              onChange={(next) => setFormData((prev: any) => ({ ...prev, ajustar_vencimento_dia_util: next }))}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Se ativado, parcelas que caírem em finais de semana serão movidas para a próxima segunda-feira.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Competência das parcelas</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'POR_PARCELA' }))}
                className={`py-2 rounded-lg text-xs font-bold border transition ${
                  formData.competencia_modo_parcelamento === 'POR_PARCELA'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                Por parcela
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'MES_COMPRA' }))}
                className={`py-2 rounded-lg text-xs font-bold border transition ${
                  formData.competencia_modo_parcelamento === 'MES_COMPRA'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                Mês da compra
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Por parcela: cada parcela entra no mês correspondente. Mês da compra: todas as parcelas ficam na competência
              da compra.
            </p>
          </div>

          {/* Resumo Exato de Parcelamento */}
          {formData.qtd_parcelas && (
            <div className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60">
              {isTotalMode ? (
                (() => {
                  const parcels = splitAmountIntoInstallments(currentVal, qtd);
                  const firstParcel = parcels[0] || 0;
                  const lastParcel = parcels[parcels.length - 1] || 0;
                  const hasDiff = firstParcel !== lastParcel;
                  return (
                    <>
                      {qtd}x de{' '}
                      <strong className="text-blue-400 dark:text-blue-300">
                        {hasDiff
                          ? `1x de ${formatCurrencyBRL(firstParcel)} + ${qtd - 1}x de ${formatCurrencyBRL(lastParcel)}`
                          : formatCurrencyBRL(firstParcel)}
                      </strong>{' '}
                      • Total <strong className="text-slate-700 dark:text-slate-200">{formatCurrencyBRL(currentVal)}</strong>
                    </>
                  );
                })()
              ) : (
                <>
                  {qtd}x de <strong className="text-blue-400 dark:text-blue-300">{formatCurrencyBRL(currentVal)}</strong>{' '}
                  • Total <strong className="text-slate-700 dark:text-slate-200">{formatCurrencyBRL(currentVal * qtd)}</strong>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
