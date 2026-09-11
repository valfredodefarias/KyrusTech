import React, { useState, useEffect } from 'react';
import { api } from '../../../services/api';
import { X, CheckCircle2, Trash2, Loader2, CreditCard, AlertTriangle } from 'lucide-react';
import type { Lancamento } from '../types';

interface FaturaVirtualDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  fatura: Lancamento;
  contas: any[];
  onSuccess: () => void;
}

interface ItemFatura {
  id: number;
  descricao: string;
  valor: number;
  data_compra: string;
  numero_parcela?: number | null;
  fatura_paga?: boolean;
}

export function FaturaVirtualDrawer({ isOpen, onClose, fatura, contas, onSuccess }: FaturaVirtualDrawerProps) {
  const [contaPagamentoId, setContaPagamentoId] = useState<string>('');
  const [dataPagamento, setDataPagamento] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingItens, setLoadingItens] = useState(false);
  const [itens, setItens] = useState<ItemFatura[]>([]);
  const [error, setError] = useState('');

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  useEffect(() => {
    if (!isOpen || !fatura?.cartao_id) return;

    const carregarItens = async () => {
      setLoadingItens(true);
      try {
        const res = await api.get(`/cartoes/${fatura.cartao_id}/lancamentos`, {
          params: { competencia_fatura: fatura.competencia },
        });
        setItens(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        console.error('Erro ao carregar compras da fatura:', err);
      } finally {
        setLoadingItens(false);
      }
    };

    carregarItens();
  }, [isOpen, fatura?.cartao_id, fatura?.competencia]);

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
        data_pagamento: dataPagamento,
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao pagar a fatura.');
    } finally {
      setLoading(false);
    }
  };

  const handleExcluirItem = async (itemId: number) => {
    if (!window.confirm('Tem certeza que deseja excluir esta despesa do cartão?')) return;

    try {
      await api.delete(`/cartoes/lancamentos/${itemId}`);
      setItens((prev) => prev.filter((i) => i.id !== itemId));
      onSuccess();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Erro ao excluir despesa do cartão.');
    }
  };

  const handleExcluirFaturaInteira = async () => {
    const msg = `Tem certeza que deseja excluir esta fatura virtual e todas as ${itens.length || ''} despesas vinculadas a ela? Esta ação não pode ser desfeita.`;
    if (!window.confirm(msg)) return;

    setDeleting(true);
    setError('');

    try {
      await api.delete(`/cartoes/${fatura.cartao_id}/faturas/${fatura.competencia}`);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao excluir fatura de cartão.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full md:w-[540px] bg-white dark:bg-slate-900 shadow-2xl h-full flex flex-col z-10 border-l border-slate-200 dark:border-slate-800">
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2.5">
            <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Fatura de Cartão</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Competência: <strong>{fatura.competencia}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExcluirFaturaInteira}
              disabled={deleting}
              title="Excluir todas as despesas desta fatura"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition cursor-pointer disabled:opacity-50"
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Excluir Fatura
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-purple-50/60 dark:bg-purple-950/20 p-4 rounded-xl border border-purple-200 dark:border-purple-900/40">
            <h3 className="font-bold text-purple-950 dark:text-purple-200">{fatura.descricao}</h3>
            <p className="text-purple-700 dark:text-purple-400 text-xs mt-0.5">{fatura.observacao}</p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase">Valor Total:</span>
              <span className="text-2xl font-black text-purple-950 dark:text-purple-100">
                {BRL.format(fatura.valor_previsto || 0)}
              </span>
            </div>
          </div>

          {/* ITENS DA FATURA */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                Compras vinculadas a esta fatura ({itens.length})
              </label>
              {loadingItens && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
                </span>
              )}
            </div>

            {itens.length === 0 && !loadingItens ? (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500 text-center">
                Nenhuma compra encontrada para esta fatura.
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden max-h-56 overflow-y-auto">
                {itens.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs transition"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-bold text-slate-800 dark:text-slate-200 truncate">
                        {item.descricao}
                        {item.numero_parcela ? ` (${item.numero_parcela})` : ''}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {item.data_compra ? item.data_compra.split('-').reverse().join('/') : '-'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        {BRL.format(Number(item.valor || 0))}
                      </span>
                      <button
                        type="button"
                        title="Excluir esta compra"
                        onClick={() => handleExcluirItem(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Registrar Pagamento da Fatura
            </h4>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Data de Pagamento</label>
              <input
                type="date"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                Conta de Pagamento (Saída do Dinheiro)
              </label>
              <select
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                value={contaPagamentoId}
                onChange={(e) => setContaPagamentoId(e.target.value)}
              >
                <option value="">Selecione uma conta...</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-lg border border-slate-200 dark:border-slate-700/60 leading-relaxed">
              <strong>Nota:</strong> Ao confirmar o pagamento, todos os lançamentos que compõem esta fatura serão gerados no
              financeiro com o status PAGO, impactando seu fluxo de caixa e DRE corretamente.
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-800/60 flex justify-between items-center gap-3">
          <button
            type="button"
            onClick={handleExcluirFaturaInteira}
            disabled={deleting}
            className="px-4 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition disabled:opacity-50"
          >
            Excluir Fatura
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handlePagar}
              disabled={loading || !contaPagamentoId}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 shadow-md shadow-blue-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Confirmar Pagamento
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
