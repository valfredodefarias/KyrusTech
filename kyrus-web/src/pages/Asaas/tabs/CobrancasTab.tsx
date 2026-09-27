import React, { useState, useEffect } from 'react';
import { 
  Search, Filter, ExternalLink, Copy, CheckCircle2, 
  AlertTriangle, Clock, RotateCcw, QrCode, FileText, 
  CreditCard, Plus, Loader2, RefreshCw, Calendar, DollarSign
} from 'lucide-react';
import { api } from '../../../services/api';
import { toast } from 'sonner';
import type { AsaasCobranca } from '../types';
import { ConfirmarRecebimentoModal } from '../components/ConfirmarRecebimentoModal';

interface CobrancasTabProps {
  integracaoId: number;
  onOpenNovaCobranca: () => void;
  initialStatus?: string;
  initialMeio?: string;
  onClearFilters?: () => void;
}

export function CobrancasTab({
  integracaoId,
  onOpenNovaCobranca,
  initialStatus,
  initialMeio,
  onClearFilters,
}: CobrancasTabProps) {
  const [cobrancas, setCobrancas] = useState<AsaasCobranca[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFiltro, setStatusFiltro] = useState<string>(initialStatus || '');
  const [meioFiltro, setMeioFiltro] = useState<string>(initialMeio || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [totais, setTotais] = useState({
    total_bruto: 0,
    total_liquido: 0,
    total_taxas: 0,
    total_registros: 0,
  });

  // Modal de confirmação
  const [cobrancaParaConfirmar, setCobrancaParaConfirmar] = useState<AsaasCobranca | null>(null);

  useEffect(() => {
    if (initialStatus !== undefined) {
      setStatusFiltro(initialStatus);
    }
  }, [initialStatus]);

  useEffect(() => {
    if (initialMeio !== undefined) {
      setMeioFiltro(initialMeio);
    }
  }, [initialMeio]);

  const fetchCobrancas = async () => {
    try {
      setLoading(true);
      const params: any = { limit: 100 };
      if (statusFiltro) params.status = statusFiltro;
      if (meioFiltro) params.billing_type = meioFiltro;
      if (searchTerm.trim()) params.search = searchTerm.trim();

      const res = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/cobrancas-gerencial`, { params });
      setCobrancas(res.data.items || []);
      setTotais({
        total_bruto: res.data.total_bruto || 0,
        total_liquido: res.data.total_liquido || 0,
        total_taxas: res.data.total_taxas || 0,
        total_registros: res.data.total_registros || 0,
      });
    } catch (err: any) {
      toast.error('Erro ao carregar cobranças do Asaas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCobrancas();
  }, [integracaoId, statusFiltro, meioFiltro]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCobrancas();
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('Link copiado com sucesso!');
  };

  const handleEstornar = async (cobranca: AsaasCobranca) => {
    if (!window.confirm(`Tem certeza que deseja estornar a cobrança ${cobranca.id} de R$ ${cobranca.value.toFixed(2)}?`)) {
      return;
    }

    try {
      await api.post(`/integracoes-bancarias/${integracaoId}/asaas/estornar`, {
        payment_id: cobranca.id,
      });
      toast.success('Cobrança estornada com sucesso no Asaas!');
      fetchCobrancas();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Erro ao estornar cobrança';
      toast.error(String(msg));
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'RECEIVED' || s === 'CONFIRMED' || s === 'RECEIVED_IN_CASH' || s === 'DONE') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
          Recebida
        </span>
      );
    }
    if (s === 'PENDING' || s === 'AWAITING_PAYMENT') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
          Aguardando
        </span>
      );
    }
    if (s === 'OVERDUE') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          Vencida
        </span>
      );
    }
    if (s === 'REFUNDED') {
      return (
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
          Estornada
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
        {status}
      </span>
    );
  };

  const getBillingTypeBadge = (type: string) => {
    const t = type.toUpperCase();
    if (t === 'PIX') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
          <QrCode className="w-3.5 h-3.5" /> Pix
        </span>
      );
    }
    if (t === 'BOLETO') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400">
          <FileText className="w-3.5 h-3.5" /> Boleto
        </span>
      );
    }
    if (t === 'CREDIT_CARD') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-600 dark:text-purple-400">
          <CreditCard className="w-3.5 h-3.5" /> Cartão
        </span>
      );
    }
    return <span className="text-[11px] text-slate-500">{type}</span>;
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Top Filter & Actions Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Busca por cliente ou ID */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por cliente, CPF/CNPJ, ID Asaas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => { setSearchTerm(''); fetchCobrancas(); }}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </form>

          {/* Filtros rápidos & Botão Nova Cobrança */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Status Select */}
            <select
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
              className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Status: Todos</option>
              <option value="RECEIVED">Recebidas (Pagas)</option>
              <option value="PENDING">Aguardando Pagamento</option>
              <option value="OVERDUE">Vencidas (Em Atraso)</option>
              <option value="REFUNDED">Estornadas</option>
            </select>

            {/* Forma de Pagamento */}
            <select
              value={meioFiltro}
              onChange={(e) => setMeioFiltro(e.target.value)}
              className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="">Meio: Todos</option>
              <option value="PIX">Pix</option>
              <option value="BOLETO">Boleto</option>
              <option value="CREDIT_CARD">Cartão de Crédito</option>
            </select>

            <button
              onClick={() => fetchCobrancas()}
              title="Atualizar listagem"
              className="p-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onOpenNovaCobranca}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova Cobrança</span>
            </button>
          </div>
        </div>

        {/* Chips de Filtros Ativos */}
        {(statusFiltro || meioFiltro || searchTerm) && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs flex-wrap">
            <span className="text-slate-500 font-medium">Filtrando por:</span>
            {statusFiltro && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 text-[11px] font-bold">
                <span>Status: {statusFiltro === 'OVERDUE' ? 'Vencidas (Em Atraso)' : statusFiltro === 'RECEIVED' ? 'Recebidas' : statusFiltro === 'PENDING' ? 'Aguardando Pagamento' : statusFiltro}</span>
                <button
                  type="button"
                  onClick={() => { setStatusFiltro(''); onClearFilters?.(); }}
                  className="hover:text-red-900 dark:hover:text-red-200 font-black cursor-pointer text-xs leading-none"
                  title="Remover filtro de status"
                >
                  ✕
                </button>
              </span>
            )}
            {meioFiltro && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-[11px] font-bold">
                <span>Meio: {meioFiltro === 'PIX' ? 'Pix' : meioFiltro === 'BOLETO' ? 'Boleto' : meioFiltro === 'CREDIT_CARD' ? 'Cartão' : meioFiltro}</span>
                <button
                  type="button"
                  onClick={() => { setMeioFiltro(''); onClearFilters?.(); }}
                  className="hover:text-blue-900 dark:hover:text-blue-200 font-black cursor-pointer text-xs leading-none"
                  title="Remover filtro de meio"
                >
                  ✕
                </button>
              </span>
            )}
            {searchTerm && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
                <span>Busca: "{searchTerm}"</span>
                <button
                  type="button"
                  onClick={() => { setSearchTerm(''); }}
                  className="hover:text-slate-900 dark:hover:text-white font-black cursor-pointer text-xs leading-none"
                  title="Limpar busca"
                >
                  ✕
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => { setStatusFiltro(''); setMeioFiltro(''); setSearchTerm(''); onClearFilters?.(); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer ml-1"
            >
              Ver todas as cobranças
            </button>
          </div>
        )}

        {/* Resumo dos Totais Filtrados */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div className="text-slate-500">
            Registros: <strong className="text-slate-800 dark:text-slate-200">{totais.total_registros}</strong>
          </div>
          <div className="text-slate-500">
            Total Bruto: <strong className="text-slate-800 dark:text-slate-200">{formatCurrency(totais.total_bruto)}</strong>
          </div>
          <div className="text-slate-500">
            Taxas Retidas: <strong className="text-amber-600 dark:text-amber-400">{formatCurrency(totais.total_taxas)}</strong>
          </div>
          <div className="text-slate-500">
            Líquido Real: <strong className="text-emerald-600 dark:text-emerald-400">{formatCurrency(totais.total_liquido)}</strong>
          </div>
        </div>
      </div>

      {/* Tabela de Cobranças */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span>Consultando cobranças no Asaas...</span>
          </div>
        ) : cobrancas.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            Nenhuma cobrança encontrada com os filtros aplicados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Cliente / Descrição</th>
                  <th className="py-3 px-4">Meio</th>
                  <th className="py-3 px-4">Vencimento</th>
                  <th className="py-3 px-4 text-right">Valor Bruto</th>
                  <th className="py-3 px-4 text-right">Taxa Asaas</th>
                  <th className="py-3 px-4 text-right">Valor Líquido</th>
                  <th className="py-3 px-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {cobrancas.map((item) => {
                  const isRecebida = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DONE'].includes(item.status.toUpperCase());
                  const isPendente = ['PENDING', 'AWAITING_PAYMENT', 'OVERDUE'].includes(item.status.toUpperCase());

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-850/40 transition group"
                    >
                      {/* Status */}
                      <td className="py-3 px-4 shrink-0">
                        {getStatusBadge(item.status)}
                      </td>

                      {/* Cliente */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {item.customerName || 'Cliente Asaas'}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 font-mono">
                          <span>{item.id}</span>
                          {item.customerCpfCnpj && <span>• {item.customerCpfCnpj}</span>}
                        </div>
                        {item.description && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs">
                            {item.description}
                          </div>
                        )}
                      </td>

                      {/* Meio */}
                      <td className="py-3 px-4">
                        {getBillingTypeBadge(item.billingType)}
                      </td>

                      {/* Vencimento */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {item.dueDate ? new Date(item.dueDate + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}
                        </div>
                        {item.paymentDate && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            Pago em {new Date(item.paymentDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </td>

                      {/* Valor Bruto */}
                      <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">
                        {formatCurrency(item.value)}
                      </td>

                      {/* Taxa */}
                      <td className="py-3 px-4 text-right text-amber-600 dark:text-amber-400 font-semibold">
                        {item.fee > 0 ? `-${formatCurrency(item.fee)}` : 'R$ 0,00'}
                      </td>

                      {/* Líquido */}
                      <td className="py-3 px-4 text-right font-black text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(item.netValue)}
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Copiar Link */}
                          {item.invoiceUrl && (
                            <button
                              type="button"
                              onClick={() => handleCopyLink(item.invoiceUrl!)}
                              title="Copiar Link de Pagamento"
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Abrir Fatura */}
                          {item.invoiceUrl && (
                            <a
                              href={item.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir Fatura / Comprovante Asaas"
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* Boleto se houver */}
                          {item.bankSlipUrl && (
                            <a
                              href={item.bankSlipUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Visualizar Boleto Bancário"
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </a>
                          )}

                          {/* Confirmar Recebimento em Dinheiro (se pendente) */}
                          {isPendente && (
                            <button
                              type="button"
                              onClick={() => setCobrancaParaConfirmar(item)}
                              title="Confirmar Recebimento Manual / Dinheiro"
                              className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Estornar se recebida */}
                          {isRecebida && (
                            <button
                              type="button"
                              onClick={() => handleEstornar(item)}
                              title="Estornar Cobrança"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Confirmação Manual */}
      {cobrancaParaConfirmar && (
        <ConfirmarRecebimentoModal
          isOpen={Boolean(cobrancaParaConfirmar)}
          onClose={() => setCobrancaParaConfirmar(null)}
          integracaoId={integracaoId}
          cobranca={cobrancaParaConfirmar}
          onSuccess={fetchCobrancas}
        />
      )}
    </div>
  );
}
