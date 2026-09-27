import React, { useState } from 'react';
import { 
  Calendar, Clock, DollarSign, TrendingUp, AlertCircle, 
  ArrowDownRight, Layers, ChevronDown, ChevronRight, ExternalLink,
  User, QrCode, FileText, CreditCard
} from 'lucide-react';
import type { AsaasPrevisaoTimeline } from '../types';

interface PrevisoesTabProps {
  previsoes: AsaasPrevisaoTimeline[];
  totalAReceber: number;
}

export function PrevisoesTab({
  previsoes,
  totalAReceber,
}: PrevisoesTabProps) {
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>(() => {
    // Abre a primeira data por padrão se existir
    if (previsoes.length > 0) {
      return { [previsoes[0].data]: true };
    }
    return {};
  });

  const toggleExpand = (data: string) => {
    setExpandedDates((prev) => ({
      ...prev,
      [data]: !prev[data],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    previsoes.forEach((p) => {
      all[p.data] = true;
    });
    setExpandedDates(all);
  };

  const collapseAll = () => {
    setExpandedDates({});
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  const totalBruto = previsoes.reduce((acc, curr) => acc + curr.valor_bruto, 0);
  const totalTaxas = previsoes.reduce((acc, curr) => acc + curr.taxa_estimada, 0);
  const totalLiquido = previsoes.reduce((acc, curr) => acc + curr.valor_liquido, 0);

  const getBillingIcon = (meio: string) => {
    switch (meio) {
      case 'PIX':
        return <QrCode className="w-3.5 h-3.5 text-emerald-500" />;
      case 'BOLETO':
        return <FileText className="w-3.5 h-3.5 text-blue-500" />;
      case 'CREDIT_CARD':
        return <CreditCard className="w-3.5 h-3.5 text-purple-500" />;
      default:
        return <DollarSign className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Top Banner de Previsões */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Total Previsto a Compensar
          </div>
          <div className="text-xl font-black text-sky-600 dark:text-sky-400">
            {formatCurrency(totalAReceber || totalBruto)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {previsoes.reduce((a, b) => a + b.qtd, 0)} cobranças futuras
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Desconto Estimado de Tarifas
          </div>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400">
            -{formatCurrency(totalTaxas)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Retenções de intermediação Asaas
          </div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Líquido Real Previsto no Caixa
          </div>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
            {formatCurrency(totalLiquido)}
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
            Valor projetado a ser creditado
          </div>
        </div>
      </div>

      {/* Tabela de Previsões por Data com Detalhes de Clientes */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Cronograma Detalhado de Liquidação dos Recebíveis
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={expandAll}
              className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold transition"
            >
              Expandir Todos
            </button>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <button
              onClick={collapseAll}
              className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold transition"
            >
              Recolher Todos
            </button>
          </div>
        </div>

        {previsoes.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
            Nenhuma previsão futura no momento. Emita novas cobranças para visualizar a agenda de recebimentos.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4 w-10"></th>
                  <th className="py-3 px-4">Data Prevista</th>
                  <th className="py-3 px-4">Qtd Cobranças</th>
                  <th className="py-3 px-4 text-right">Valor Bruto</th>
                  <th className="py-3 px-4 text-right">Tarifas Estimadas</th>
                  <th className="py-3 px-4 text-right">Líquido Previsto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {previsoes.map((p, idx) => {
                  const dataObj = new Date(p.data + 'T00:00:00');
                  const dataFormatada = dataObj.toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  });
                  const diaSemana = dataObj.toLocaleDateString('pt-BR', { weekday: 'long' });
                  const isExpanded = !!expandedDates[p.data];
                  const itens = p.itens || [];

                  return (
                    <React.Fragment key={idx}>
                      <tr 
                        onClick={() => toggleExpand(p.data)}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition cursor-pointer select-none group"
                      >
                        <td className="py-3 px-4 text-slate-400 group-hover:text-blue-600 transition">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{dataFormatada}</span>
                            <span className="text-[10px] font-normal text-slate-400 capitalize">({diaSemana})</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-[11px]">
                            {p.qtd} cobrança(s)
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-200">
                          {formatCurrency(p.valor_bruto)}
                        </td>
                        <td className="py-3 px-4 text-right text-amber-600 dark:text-amber-400 font-semibold">
                          -{formatCurrency(p.taxa_estimada)}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          {formatCurrency(p.valor_liquido)}
                        </td>
                      </tr>

                      {/* Linha Expandida com os Detalhes de Cada Cliente e Cobrança */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50 dark:bg-slate-950/30">
                          <td colSpan={6} className="p-3 pl-8">
                            <div className="space-y-2">
                              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-blue-500" />
                                <span>Cobranças discriminadas para {dataFormatada}</span>
                              </div>

                              {itens.length === 0 ? (
                                <div className="text-xs text-slate-400 italic py-2">
                                  Informações dos clientes em processamento.
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                  {itens.map((item, itemIdx) => (
                                    <div
                                      key={itemIdx}
                                      className="p-3 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 shadow-xs"
                                    >
                                      <div className="min-w-0 space-y-1">
                                        <div className="flex items-center gap-2">
                                          {getBillingIcon(item.meio)}
                                          <span className="font-bold text-slate-900 dark:text-white truncate">
                                            {item.cliente}
                                          </span>
                                          {item.cliente_cpf_cnpj && (
                                            <span className="text-[10px] text-slate-400">
                                              ({item.cliente_cpf_cnpj})
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                          {item.descricao || 'Sem descrição'}
                                        </div>
                                        <div className="flex items-center gap-2 pt-0.5">
                                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                            {item.meio}
                                          </span>
                                          {item.invoice_url && (
                                            <a
                                              href={item.invoice_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
                                            >
                                              <span>Fatura Asaas</span>
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          )}
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0">
                                        <div className="text-[10px] text-slate-400">Bruto: {formatCurrency(item.valor_bruto)}</div>
                                        <div className="text-[10px] text-amber-600">Tarifa: -{formatCurrency(item.taxa_estimada)}</div>
                                        <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                                          {formatCurrency(item.valor_liquido)}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
