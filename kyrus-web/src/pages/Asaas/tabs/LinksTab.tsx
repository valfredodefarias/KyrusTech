import React from 'react';
import { Link2, Plus, Sparkles, Share2, Copy, Check, ExternalLink, QrCode, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

interface LinksTabProps {
  onOpenNovaCobranca: () => void;
}

export function LinksTab({ onOpenNovaCobranca }: LinksTabProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Banner de Apresentação de Links de Pagamento */}
      <div className="p-6 bg-gradient-to-r from-blue-900 to-indigo-900 text-white border border-blue-800 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/10 text-white text-[10px] font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Vendas Rápidas & Checkout Digital</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight">
            Links de Pagamento Asaas
          </h2>
          <p className="text-xs text-blue-100 leading-relaxed">
            Crie links compartilháveis para cobrar qualquer cliente em segundos. Seu cliente pode pagar via Pix, Boleto ou Cartão de Crédito em até 12x. Todas as liquidações entram automaticamente na sua conta e são conciliadas no ERP.
          </p>
        </div>

        <button
          onClick={onOpenNovaCobranca}
          className="px-5 py-3 bg-white text-blue-900 hover:bg-blue-50 text-xs font-black flex items-center gap-2 cursor-pointer transition shrink-0 shadow-lg"
        >
          <Plus className="w-4 h-4 text-blue-600" />
          <span>Criar Link de Pagamento</span>
        </button>
      </div>

      {/* Cards de Recursos e Casos de Uso */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 w-fit">
            <QrCode className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Pix Instantâneo Automático
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Gera QR Code Pix com confirmação de pagamento em tempo real, sem necessidade de enviar comprovante.
          </p>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="p-2.5 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 w-fit">
            <CreditCard className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Parcelamento no Cartão
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Seu cliente pode parcelar compras em até 12x no cartão de crédito, com antifraude nativo do Asaas.
          </p>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 w-fit">
            <Share2 className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Compartilhe em Qualquer Canal
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Envie no WhatsApp, Instagram Direct, e-mail ou coloque na bio das redes sociais da sua empresa.
          </p>
        </div>
      </div>
    </div>
  );
}
