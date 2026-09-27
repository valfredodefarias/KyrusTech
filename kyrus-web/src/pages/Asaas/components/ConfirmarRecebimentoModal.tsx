import React, { useState } from 'react';
import { X, CheckCircle2, DollarSign, Calendar, Loader2 } from 'lucide-react';
import { api } from '../../../services/api';
import { toast } from 'sonner';
import type { AsaasCobranca } from '../types';

interface ConfirmarRecebimentoModalProps {
  isOpen: boolean;
  onClose: () => void;
  integracaoId: number;
  cobranca: AsaasCobranca | null;
  onSuccess: () => void;
}

export function ConfirmarRecebimentoModal({
  isOpen,
  onClose,
  integracaoId,
  cobranca,
  onSuccess,
}: ConfirmarRecebimentoModalProps) {
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().slice(0, 10));
  const [valorPago, setValorPago] = useState(() => (cobranca?.value ? cobranca.value.toFixed(2) : ''));
  const [loading, setLoading] = useState(false);

  if (!isOpen || !cobranca) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const valNum = parseFloat(valorPago.replace(/\./g, '').replace(',', '.'));
      await api.post(`/integracoes-bancarias/${integracaoId}/asaas/confirmar-recebimento`, {
        payment_id: cobranca.id,
        data_pagamento: dataPagamento,
        valor: !isNaN(valNum) && valNum > 0 ? valNum : undefined,
      });

      toast.success('Recebimento confirmado com sucesso no Asaas!');
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Falha ao confirmar recebimento';
      toast.error(String(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-none overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Confirmar Recebimento Manual
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Baixa de cobrança recebida diretamente em dinheiro/espécie
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">ID da Cobrança:</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{cobranca.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cliente:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{cobranca.customerName || 'Cliente'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Valor Original:</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">
                R$ {cobranca.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Data do Recebimento Real
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="date"
                required
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Valor Efetivamente Recebido (R$)
            </label>
            <div className="relative">
              <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                required
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Confirmando...</span>
                </>
              ) : (
                <span>Confirmar Recebimento</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
