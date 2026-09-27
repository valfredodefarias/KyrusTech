import React from 'react';
import { 
  Percent, Layers, DollarSign, TrendingDown, 
  AlertCircle, ShieldCheck, QrCode, FileText, CreditCard, Mail
} from 'lucide-react';
import type { AsaasGastoCategoria } from '../types';

interface GastosTabProps {
  gastos: AsaasGastoCategoria[];
  totalGastos: number;
  totalFaturado: number;
  taxaMediaEfetiva: number;
}

export function GastosTab({
  gastos,
  totalGastos,
  totalFaturado,
  taxaMediaEfetiva,
}: GastosTabProps) {
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  const getIconForCategory = (codigo: string) => {
    switch (codigo) {
      case 'PIX_FEE':
        return <QrCode className="w-4 h-4 text-emerald-600" />;
      case 'BOLETO_FEE':
        return <FileText className="w-4 h-4 text-blue-600" />;
      case 'CREDIT_CARD_FEE':
        return <CreditCard className="w-4 h-4 text-purple-600" />;
      case 'MESSAGING_FEE':
        return <Mail className="w-4 h-4 text-amber-600" />;
      default:
        return <Layers className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner de Métricas de Gastos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Total de Gastos & Tarifas Asaas
          </div>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400">
            {formatCurrency(totalGastos)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Descontos operacionais do gateway
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Taxa Média Efetiva
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {taxaMediaEfetiva}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Custo real sobre o faturamento total
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Faturamento Bruto Processado
          </div>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totalFaturado)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Base de cálculo das transações
          </div>
        </div>
      </div>

      {/* Grid de Categorias de Tarifas */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Tarifas e Custos Operacionais Separados por Categoria
          </h3>
          <p className="text-xs text-slate-500">
            Acompanhe o impacto de cada meio de pagamento nas despesas financeiras da sua empresa.
          </p>
        </div>

        {gastos.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
            Nenhuma tarifa operacional registrada no período.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {gastos.map((item, idx) => (
              <div
                key={idx}
                className="p-4 bg-slate-50 dark:bg-slate-850/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      {getIconForCategory(item.codigo)}
                    </div>
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      {item.categoria}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    {item.percentual}%
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="text-lg font-black text-amber-600 dark:text-amber-400">
                    {formatCurrency(item.valor)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {item.qtd} transação(ões) afetada(s)
                  </div>
                </div>

                {/* Barra de progresso visual */}
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-1.5 transition-all"
                    style={{ width: `${Math.min(item.percentual, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
