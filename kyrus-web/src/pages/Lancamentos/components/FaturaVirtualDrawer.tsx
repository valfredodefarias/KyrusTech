import React, { useState } from 'react';
import { api } from '../../../services/api';
import { X, CheckCircle2 } from 'lucide-react';
import type { Lancamento } from '../types';

interface FaturaVirtualDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  fatura: Lancamento;
  contas: any[];
  onSuccess: () => void;
}

export function FaturaVirtualDrawer({ isOpen, onClose, fatura, contas, onSuccess }: FaturaVirtualDrawerProps) {
  const [contaPagamentoId, setContaPagamentoId] = useState<string>('');
  const [dataPagamento, setDataPagamento] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handlePagar = async () => {
    if (!contaPagamentoId) {
      setError('Selecione uma conta bancária para o pagamento.');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      await api.post('/cartoes/pagar-fatura', {
        cartao_id: fatura.cartao_id,
        competencia_fatura: fatura.competencia,
        conta_pagamento_id: parseInt(contaPagamentoId, 10),
        data_pagamento: dataPagamento
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao pagar a fatura.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[500px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 translate-x-0">
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b bg-gray-50">
        <h2 className="text-xl font-bold text-gray-800">
          Pagamento de Fatura Virtual
        </h2>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
          <h3 className="font-semibold text-blue-900 mb-2">{fatura.descricao}</h3>
          <p className="text-blue-800 text-sm">{fatura.observacao}</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-sm text-blue-700">Valor Total:</span>
            <span className="text-2xl font-bold text-blue-900">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fatura.valor_previsto || 0)}
            </span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Data de Pagamento
          </label>
          <input
            type="date"
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            value={dataPagamento}
            onChange={(e) => setDataPagamento(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Conta de Pagamento (Saída do Dinheiro)
          </label>
          <select
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            value={contaPagamentoId}
            onChange={(e) => setContaPagamentoId(e.target.value)}
          >
            <option value="">Selecione uma conta...</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        
        <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded-lg border">
          <p>
            <strong>Nota:</strong> Ao confirmar o pagamento, todos os lançamentos que compõem esta fatura serão gerados no financeiro com o status PAGO, impactando seu fluxo de caixa e DRE corretamente.
          </p>
        </div>
      </div>

      <div className="flex-shrink-0 border-t p-4 bg-gray-50 flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
        >
          Cancelar
        </button>
        <button
          onClick={handlePagar}
          disabled={loading || !contaPagamentoId}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? 'Processando...' : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              Confirmar Pagamento
            </>
          )}
        </button>
      </div>
    </div>
  );
}
