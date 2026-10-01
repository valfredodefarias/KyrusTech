import React, { useState, useEffect } from 'react';
import { Store, X, Check, RefreshCw } from 'lucide-react';
import { api } from '../../../services/api';

export interface IfoodTransactionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (savedData?: any) => void;
  transaction?: any | null;
  transactionId?: number | string | null;
  ifoodTaxa?: number;
}

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
};

const parseCurrency = (valStr: string) => {
  if (!valStr) return 0;
  const clean = valStr.replace(/[^\d]/g, '');
  return (parseFloat(clean) || 0) / 100;
};

const calculateNextWednesday = (dateStr: string) => {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + 7);
    const dayOfWeek = date.getDay();
    const daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
    date.setDate(date.getDate() + (daysUntilWednesday === 0 ? 7 : daysUntilWednesday));
    return date.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
};

export function IfoodTransactionDrawer({
  isOpen,
  onClose,
  onSuccess,
  transaction: initialTransaction,
  transactionId,
  ifoodTaxa = 12.0
}: IfoodTransactionDrawerProps) {
  const [editingTransaction, setEditingTransaction] = useState<any | null>(initialTransaction || null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [formFormaRecebimento, setFormFormaRecebimento] = useState('Pix Ifood');
  const [formValorBruto, setFormValorBruto] = useState('R$ 0,00');
  const [formDespesasExtras, setFormDespesasExtras] = useState<string[]>([]);
  const [formDataVenda, setFormDataVenda] = useState(new Date().toISOString().split('T')[0]);
  const [formHoraVenda, setFormHoraVenda] = useState('12:00:00');
  const [formDataRecebimento, setFormDataRecebimento] = useState(calculateNextWednesday(new Date().toISOString().split('T')[0]));
  const [showDateConfig, setShowDateConfig] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (initialTransaction) {
      setEditingTransaction(initialTransaction);
      populateForm(initialTransaction);
    } else if (transactionId) {
      setLoadingItem(true);
      api.get(`/pdv/ifood/transacoes/${transactionId}`)
        .then(res => {
          setEditingTransaction(res.data);
          populateForm(res.data);
        })
        .catch(err => {
          console.error("Erro ao carregar transação iFood:", err);
          alert(err?.response?.data?.detail || "Erro ao carregar detalhes da transação iFood.");
          onClose();
        })
        .finally(() => setLoadingItem(false));
    } else {
      setEditingTransaction(null);
      setFormFormaRecebimento('Pix Ifood');
      setFormValorBruto('R$ 0,00');
      setFormDespesasExtras([]);
      const today = new Date().toISOString().split('T')[0];
      setFormDataVenda(today);
      setFormHoraVenda('12:00:00');
      setFormDataRecebimento(calculateNextWednesday(today));
      setShowDateConfig(false);
    }
  }, [isOpen, initialTransaction, transactionId]);

  function populateForm(tx: any) {
    setFormFormaRecebimento(tx.forma_recebimento || 'Crédito à vista');
    setFormValorBruto(formatCurrency(tx.valor_bruto || 0));
    setFormDespesasExtras(tx.despesas_extras || []);
    const dateVenda = tx.data_venda ? tx.data_venda.substring(0, 10) : new Date().toISOString().split('T')[0];
    setFormDataVenda(dateVenda);
    setFormHoraVenda(tx.hora_venda || '12:00:00');
    setFormDataRecebimento(tx.data_recebimento_ajustada ? String(tx.data_recebimento_ajustada).substring(0, 10) : calculateNextWednesday(dateVenda));
    setShowDateConfig(false);
  }

  const handleCurrencyChange = (valStr: string) => {
    const rawVal = parseCurrency(valStr);
    setFormValorBruto(formatCurrency(rawVal));
  };

  const adjustFormValue = (delta: number) => {
    const current = parseCurrency(formValorBruto);
    const updated = Math.max(0, current + delta);
    setFormValorBruto(formatCurrency(updated));
  };

  const toggleExtraExpense = (key: string) => {
    setFormDespesasExtras(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valorBrutoNum = parseCurrency(formValorBruto);
    if (valorBrutoNum <= 0) {
      alert('Informe um valor bruto maior que zero.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        forma_recebimento: formFormaRecebimento,
        valor_bruto: valorBrutoNum,
        data_venda: formDataVenda,
        hora_venda: formHoraVenda || "00:00:00",
        data_recebimento_ajustada: formDataRecebimento,
        despesas_extras: formDespesasExtras
      };

      let responseData: any;
      if (editingTransaction) {
        const res = await api.put(`/pdv/ifood/transacoes/${editingTransaction.id}`, payload);
        responseData = res.data;
      } else {
        const res = await api.post('/pdv/ifood/transacoes', payload);
        responseData = res.data;
      }

      onSuccess?.(responseData);
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar transação iFood:', err);
      alert(err?.response?.data?.detail || 'Erro ao registrar transação.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop Overlay */}
      <div 
        onClick={() => !submitting && onClose()}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[90] animate-in fade-in"
      />

      {/* Form Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl z-[100] transform transition-transform duration-300 ease-out translate-x-0 border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/20 dark:bg-slate-950/10">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Store className="w-5 h-5 text-rose-500" />
              <span>{editingTransaction ? 'Editar Lançamento iFood' : 'Novo Lançamento iFood'}</span>
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] mt-0.5">
              {editingTransaction ? 'Altere os valores da transação do delivery selecionada.' : 'Preencha os valores consolidados da transação do delivery.'}
            </p>
          </div>
          
          <button 
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-650 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadingItem ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-rose-500 mb-2" />
            <span className="text-xs font-bold">Carregando detalhes do iFood...</span>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Payment Method / Forma de recebimento */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Forma de Recebimento *</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  'Crédito à vista', 'Crédito Ifood', 'Débito', 
                  'Débito Ifood', 'Pix QRS', 'Pix Chave', 
                  'Pix Ifood', 'Dinheiro', 'Carteira digital'
                ].map((mode) => {
                  const isSelected = formFormaRecebimento === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFormFormaRecebimento(mode)}
                      className={`px-3 py-2.5 rounded-xl border text-[11px] font-bold text-center transition cursor-pointer leading-tight ${
                        isSelected
                          ? 'bg-rose-50 border-rose-450 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                          : 'bg-white border-slate-200 hover:border-slate-350 hover:bg-slate-50 dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Gross Value Input with modificators */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Valor Bruto do Pedido (R$) *</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span>
                  <input
                    type="text"
                    value={formValorBruto.replace('R$', '').trim()}
                    onChange={(e) => handleCurrencyChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 bg-white font-mono font-bold text-base text-slate-800 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                    required
                  />
                </div>
                
                {/* Modificators */}
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => adjustFormValue(-10)}
                    className="w-11 h-11 border border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-750 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-350 rounded-xl flex items-center justify-center font-black text-sm cursor-pointer select-none"
                  >
                    -10
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustFormValue(10)}
                    className="w-11 h-11 border border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-750 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-350 rounded-xl flex items-center justify-center font-black text-sm cursor-pointer select-none"
                  >
                    +10
                  </button>
                </div>
              </div>

              {/* Simulated Net Value Summary */}
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between text-xs mt-2">
                <div className="space-y-0.5">
                  <span className="text-slate-450 font-semibold block">Valor Líquido Previsto (Menos Taxa {ifoodTaxa}%)</span>
                  <span className="text-[10px] text-rose-500 block">Comissão Estimada: {formatCurrency(parseCurrency(formValorBruto) * (ifoodTaxa / 100))}</span>
                </div>
                <span className="font-black text-sm text-emerald-650 dark:text-emerald-450">
                  {formatCurrency(parseCurrency(formValorBruto) * (1 - ifoodTaxa / 100))}
                </span>
              </div>
            </div>

            {/* Extra Expenses checkboxes */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Despesas / Subsídios Extras</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'cupom_descontos', label: 'Cupom de descontos' },
                  { key: 'patrocinado', label: 'Patrocinado' },
                  { key: 'entrega_gratis', label: 'Entrega grátis' },
                  { key: 'motoboy_ifood', label: 'Motoboy iFood' }
                ].map((exp) => {
                  const isSelected = formDespesasExtras.includes(exp.key);
                  return (
                    <button
                      key={exp.key}
                      type="button"
                      onClick={() => toggleExtraExpense(exp.key)}
                      className={`flex items-center justify-between px-3.5 py-3 rounded-xl border text-xs font-bold text-left transition cursor-pointer ${
                        isSelected
                          ? 'bg-rose-50/50 border-rose-350 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400'
                          : 'bg-white border-slate-200 hover:border-slate-350 dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 text-slate-650 dark:text-slate-350'
                      }`}
                    >
                      <span>{exp.label}</span>
                      {isSelected ? (
                        <Check className="w-4 h-4 text-rose-550 shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-800 shrink-0"></div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Collapsible advanced date configurations */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowDateConfig(!showDateConfig)}
                className="text-xs font-bold text-slate-500 hover:text-rose-500 transition flex items-center gap-1 cursor-pointer border-none bg-transparent"
              >
                <span>{showDateConfig ? 'Ocultar configurações de data' : 'Ajustar data/hora manualmente...'}</span>
              </button>

              {showDateConfig && (
                <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* Data Venda */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data da Venda *</label>
                    <input
                      type="date"
                      value={formDataVenda}
                      onChange={(e) => {
                        setFormDataVenda(e.target.value);
                        setFormDataRecebimento(calculateNextWednesday(e.target.value));
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                      required
                    />
                  </div>

                  {/* Hora Venda */}
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hora da Venda</label>
                    <input
                      type="text"
                      placeholder="00:00:00"
                      value={formHoraVenda}
                      onChange={(e) => setFormHoraVenda(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                    />
                  </div>

                  {/* Data Recebimento Ajustada */}
                  <div className="col-span-2 space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Estimada de Recebimento (Ajustada) *</label>
                    <input
                      type="date"
                      value={formDataRecebimento}
                      readOnly
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 font-mono font-bold cursor-not-allowed"
                      required
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Calculado automaticamente baseando-se nas regras de payout do iFood (+7 dias rolando para a quarta-feira seguinte).
                    </span>
                  </div>
                </div>
              )}
            </div>

          </form>
        )}

        {/* Footer buttons */}
        <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/20 dark:bg-slate-950/10">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || loadingItem}
            onClick={handleFormSubmit}
            className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 transition shadow-lg shadow-rose-500/20 cursor-pointer border-none disabled:opacity-50"
          >
            {submitting ? 'Salvando...' : 'Salvar Lançamento'}
          </button>
        </div>

      </div>
    </>
  );
}
