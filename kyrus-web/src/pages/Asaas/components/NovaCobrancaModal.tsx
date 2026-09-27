import React, { useState } from 'react';
import { 
  X, Check, Copy, ExternalLink, QrCode, Share2, 
  CreditCard, DollarSign, Calendar, User, Mail, Phone,
  FileText, Link2, Sparkles, Loader2, AlertCircle
} from 'lucide-react';
import { api } from '../../../services/api';
import { toast } from 'sonner';

interface NovaCobrancaModalProps {
  isOpen: boolean;
  onClose: () => void;
  integracaoId: number;
  onSuccess?: () => void;
  clientePredefinido?: {
    nome: string;
    cpfCnpj?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
}

export function NovaCobrancaModal({
  isOpen,
  onClose,
  integracaoId,
  onSuccess,
  clientePredefinido,
}: NovaCobrancaModalProps) {
  const [tipoEmissao, setTipoEmissao] = useState<'COBRANCA' | 'LINK'>('COBRANCA');
  const [clienteNome, setClienteNome] = useState(clientePredefinido?.nome || '');
  const [clienteCpfCnpj, setClienteCpfCnpj] = useState(clientePredefinido?.cpfCnpj || '');
  const [clienteEmail, setClienteEmail] = useState(clientePredefinido?.email || '');
  const [clienteTelefone, setClienteTelefone] = useState(clientePredefinido?.phone || '');
  const [valor, setValor] = useState('');
  const [dataVencimento, setDataVencimento] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [formaPagamento, setFormaPagamento] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD' | 'UNDEFINED'>('PIX');
  const [maxParcelas, setMaxParcelas] = useState(1);
  const [descricao, setDescricao] = useState('');
  const [loading, setLoading] = useState(false);

  // Resultado da emissão
  const [resultado, setResultado] = useState<{
    id: string;
    invoiceUrl?: string | null;
    bankSlipUrl?: string | null;
    paymentLinkUrl?: string | null;
    pixQrCode?: string | null;
    pixCopyPaste?: string | null;
    valor: number;
    cliente: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const valorNumerico = parseFloat(
      valor.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')
    );

    if (isNaN(valorNumerico) || valorNumerico <= 0) {
      toast.error('Informe um valor válido maior que zero.');
      return;
    }

    if (!clienteNome.trim() && tipoEmissao === 'COBRANCA') {
      toast.error('Informe o nome do cliente.');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        cliente_nome: clienteNome.trim() || 'Cliente Geral',
        valor: valorNumerico,
        data_vencimento: dataVencimento,
        cliente_cpf_cnpj: clienteCpfCnpj.trim() || undefined,
        cliente_email: clienteEmail.trim() || undefined,
        cliente_telefone: clienteTelefone.trim() || undefined,
        descricao: descricao.trim() || undefined,
        forma_pagamento: formaPagamento,
        criar_link: tipoEmissao === 'LINK',
        max_parcelas: maxParcelas,
      };

      const res = await api.post(`/integracoes-bancarias/${integracaoId}/asaas/cobrancas`, payload);
      const data = res.data;

      setResultado({
        id: data.id,
        invoiceUrl: data.invoiceUrl,
        bankSlipUrl: data.bankSlipUrl,
        paymentLinkUrl: data.paymentLinkUrl,
        pixQrCode: data.pixQrCode,
        pixCopyPaste: data.pixCopyPaste,
        valor: valorNumerico,
        cliente: clienteNome.trim() || 'Cliente',
      });

      toast.success(tipoEmissao === 'LINK' ? 'Link de pagamento criado!' : 'Cobrança emitida no Asaas!');
      onSuccess?.();
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Falha ao emitir cobrança no Asaas';
      toast.error(String(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado para a área de transferência!`);
  };

  const handleShareWhatsApp = (url: string) => {
    const texto = encodeURIComponent(
      `Olá ${clienteNome || 'cliente'}! Segue o link para pagamento da sua fatura no valor de R$ ${valor}: ${url}`
    );
    window.open(`https://api.whatsapp.com/send?text=${texto}`, '_blank');
  };

  const handleResetForm = () => {
    setResultado(null);
    setValor('');
    setDescricao('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-none overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {resultado ? 'Cobrança Gerada com Sucesso' : 'Nova Cobrança ou Link Asaas'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {resultado ? 'Compartilhe com o cliente via WhatsApp ou link direto' : 'Emita cobranças avulsas ou gere links de pagamento rápido'}
              </p>
            </div>
          </div>
          <button
            onClick={handleResetForm}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {resultado ? (
            /* Sucesso / Compartilhamento */
            <div className="space-y-5 text-center sm:text-left">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-3">
                <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  Cobrança no valor de <strong>R$ {resultado.valor.toFixed(2)}</strong> para <strong>{resultado.cliente}</strong> gerada com sucesso!
                </span>
              </div>

              {/* QR Code PIX se disponível */}
              {resultado.pixQrCode && (
                <div className="p-5 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex flex-col items-center gap-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                    <QrCode className="w-4 h-4 text-blue-600" />
                    <span>QR Code Pix Instantâneo</span>
                  </div>
                  <img
                    src={`data:image/png;base64,${resultado.pixQrCode}`}
                    alt="QR Code Pix Asaas"
                    className="w-44 h-44 border border-slate-200 dark:border-slate-800 bg-white p-2"
                  />
                  {resultado.pixCopyPaste && (
                    <button
                      type="button"
                      onClick={() => handleCopy(resultado.pixCopyPaste!, 'Código Pix')}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar Pix Copia e Cola</span>
                    </button>
                  )}
                </div>
              )}

              {/* Links de Pagamento / Fatura */}
              <div className="space-y-3">
                {(resultado.paymentLinkUrl || resultado.invoiceUrl) && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Link de Pagamento / Fatura Asaas:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={resultado.paymentLinkUrl || resultado.invoiceUrl || ''}
                        className="flex-1 px-3 py-2 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(resultado.paymentLinkUrl || resultado.invoiceUrl || '', 'Link')}
                        className="px-3 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                      >
                        <Copy className="w-4 h-4" />
                        <span>Copiar</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Botões de Ação Direta */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {(resultado.paymentLinkUrl || resultado.invoiceUrl) && (
                    <button
                      type="button"
                      onClick={() => handleShareWhatsApp(resultado.paymentLinkUrl || resultado.invoiceUrl || '')}
                      className="flex-1 min-w-[180px] px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Compartilhar via WhatsApp</span>
                    </button>
                  )}

                  {(resultado.invoiceUrl || resultado.paymentLinkUrl) && (
                    <a
                      href={resultado.invoiceUrl || resultado.paymentLinkUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Abrir Fatura</span>
                    </a>
                  )}

                  {resultado.bankSlipUrl && (
                    <a
                      href={resultado.bankSlipUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Visualizar Boleto</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Formulário */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Tipo: Cobrança Direta vs Link de Pagamento */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setTipoEmissao('COBRANCA')}
                  className={`py-2 px-3 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    tipoEmissao === 'COBRANCA'
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Cobrança Nominal</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTipoEmissao('LINK')}
                  className={`py-2 px-3 text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                    tipoEmissao === 'LINK'
                      ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Link2 className="w-4 h-4" />
                  <span>Link de Pagamento Aberto</span>
                </button>
              </div>

              {/* Dados do Cliente */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nome do Cliente {tipoEmissao === 'COBRANCA' && '*'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      required={tipoEmissao === 'COBRANCA'}
                      placeholder="Ex: Maria Silva ou Empresa ABC Ltda"
                      value={clienteNome}
                      onChange={(e) => setClienteNome(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    CPF / CNPJ
                  </label>
                  <input
                    type="text"
                    placeholder="000.000.000-00"
                    value={clienteCpfCnpj}
                    onChange={(e) => setClienteCpfCnpj(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    WhatsApp / Telefone
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="(00) 90000-0000"
                      value={clienteTelefone}
                      onChange={(e) => setClienteTelefone(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    E-mail do Pagador
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="email"
                      placeholder="cliente@email.com"
                      value={clienteEmail}
                      onChange={(e) => setClienteEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Valores e Vencimento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Valor (R$) *
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="0,00"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Data de Vencimento *
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="date"
                      required
                      value={dataVencimento}
                      onChange={(e) => setDataVencimento(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Meio de Pagamento */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Forma de Recebimento
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'PIX', label: 'Pix Instantâneo' },
                    { id: 'BOLETO', label: 'Boleto Bancário' },
                    { id: 'CREDIT_CARD', label: 'Cartão de Crédito' },
                    { id: 'UNDEFINED', label: 'Todas as Opções' },
                  ].map((meio) => (
                    <button
                      key={meio.id}
                      type="button"
                      onClick={() => setFormaPagamento(meio.id as any)}
                      className={`px-3 py-2 text-xs font-bold border transition text-center cursor-pointer ${
                        formaPagamento === meio.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      {meio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Parcelamento se Cartão ou Link */}
              {(formaPagamento === 'CREDIT_CARD' || tipoEmissao === 'LINK') && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Número Máximo de Parcelas
                  </label>
                  <select
                    value={maxParcelas}
                    onChange={(e) => setMaxParcelas(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1x (À vista)' : `Até ${n}x`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Descrição */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Descrição da Cobrança (aparece no comprovante do cliente)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Prestação de serviços referente ao mês vigente, pedido #1042..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Footer Buttons */}
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
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Emitindo no Asaas...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>{tipoEmissao === 'LINK' ? 'Gerar Link de Pagamento' : 'Emitir Cobrança'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
