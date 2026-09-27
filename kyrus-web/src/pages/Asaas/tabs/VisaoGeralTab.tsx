import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, Calendar, AlertTriangle, ArrowUpRight, 
  CreditCard, DollarSign, QrCode, FileText, ChevronRight, ChevronDown,
  PieChart as PieIcon, Layers, Percent, Clock, Sparkles, X, Search,
  ExternalLink, Edit3, CheckCircle2, ArrowRight, BarChart3, RefreshCw
} from 'lucide-react';
import { api } from '../../../services/api';
import { toast } from 'sonner';
import { AsyncApexChart } from '../../../components/AsyncApexChart';
import { LancamentoFormDrawer } from '../../Lancamentos/components/LancamentoFormDrawer';
import { useLookupStore } from '../../../store/lookupStore';
import type { 
  AsaasDashboardData, 
  AsaasLancamentoContexto, 
  AsaasExtratoItem, 
  AsaasPrevisaoTimeline 
} from '../types';

interface VisaoGeralTabProps {
  integracaoId?: number | null;
  data: AsaasDashboardData | null;
  onNavigateTab: (tab: string, filters?: { status?: string; meio?: string }) => void;
  onOpenNovaCobranca: () => void;
  onRefresh?: () => void;
}

interface DrilldownState {
  isOpen: boolean;
  contexto: string;
  title: string;
  subtitle: string;
  mes?: string;
  categoria_codigo?: string;
}

export function VisaoGeralTab({
  integracaoId,
  data,
  onNavigateTab,
  onOpenNovaCobranca,
  onRefresh,
}: VisaoGeralTabProps) {
  // Lookups para edição do lançamento
  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);
  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);

  useEffect(() => {
    fetchContas();
    fetchPlanoContas();
    fetchEntidadesLookup();
    fetchCentrosCusto();
  }, [fetchContas, fetchPlanoContas, fetchEntidadesLookup, fetchCentrosCusto]);

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Estado do Drawer de Drilldown de Lançamentos
  const [drilldown, setDrilldown] = useState<DrilldownState>({
    isOpen: false,
    contexto: 'TODOS',
    title: '',
    subtitle: '',
  });
  const [drilldownLancamentos, setDrilldownLancamentos] = useState<AsaasLancamentoContexto[]>([]);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [drilldownSearch, setDrilldownSearch] = useState('');

  // Estado da edição de lançamento via LancamentoFormDrawer
  const [editingLancamentoId, setEditingLancamentoId] = useState<number | null>(null);
  const [isLancamentoDrawerOpen, setIsLancamentoDrawerOpen] = useState(false);

  // Expansão das previsões de recebimento
  const [expandedPrevisoes, setExpandedPrevisoes] = useState<Record<string, boolean>>({});

  // Filtro de pesquisa no extrato recente
  const [extratoSearch, setExtratoSearch] = useState('');

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  const saldo = data?.saldo || { saldo: 0, saldo_disponivel: 0, saldo_bloqueado: 0 };
  const kpis = data?.kpis || {
    total_faturado: 0,
    total_recebido: 0,
    total_a_receber: 0,
    total_vencido: 0,
    total_gastos: 0,
    taxa_media_efetiva: 0,
    qtd_recebidas: 0,
    qtd_pendentes: 0,
    qtd_vencidas: 0,
    qtd_total: 0,
  };
  const distribuicao_meios = data?.distribuicao_meios || {
    PIX: { valor: 0, qtd: 0, pct: 0 },
    BOLETO: { valor: 0, qtd: 0, pct: 0 },
    CREDIT_CARD: { valor: 0, qtd: 0, pct: 0 },
    OUTROS: { valor: 0, qtd: 0, pct: 0 },
  };
  const previsoes_timeline = data?.previsoes_timeline || [];
  const gastos_por_categoria = data?.gastos_por_categoria || [];
  const evolucao_mensal = data?.evolucao_mensal || [];
  const extrato_recente = data?.extrato_recente || [];

  // Carrega os lançamentos do contexto selecionado
  const openDrilldown = async (
    contexto: string,
    title: string,
    subtitle: string,
    mes?: string,
    categoria_codigo?: string
  ) => {
    setDrilldown({ isOpen: true, contexto, title, subtitle, mes, categoria_codigo });
    setDrilldownSearch('');
    if (!integracaoId) return;

    try {
      setLoadingDrilldown(true);
      const params: any = { contexto };
      if (mes) params.mes = mes;
      if (categoria_codigo) params.categoria_codigo = categoria_codigo;

      const res = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/lancamentos-contexto`, { params });
      setDrilldownLancamentos(res.data || []);
    } catch (err) {
      toast.error('Erro ao carregar lançamentos do contexto');
    } finally {
      setLoadingDrilldown(false);
    }
  };

  const reloadDrilldown = async () => {
    if (!drilldown.isOpen || !integracaoId) return;
    try {
      setLoadingDrilldown(true);
      const params: any = { contexto: drilldown.contexto };
      if (drilldown.mes) params.mes = drilldown.mes;
      if (drilldown.categoria_codigo) params.categoria_codigo = drilldown.categoria_codigo;

      const res = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/lancamentos-contexto`, { params });
      setDrilldownLancamentos(res.data || []);
    } catch (err) {
      // Silencioso
    } finally {
      setLoadingDrilldown(false);
    }
  };

  const handleOpenLancamento = (id: number) => {
    setEditingLancamentoId(id);
    setIsLancamentoDrawerOpen(true);
  };

  const toggleExpandPrevisao = (dateStr: string) => {
    setExpandedPrevisoes((prev) => ({
      ...prev,
      [dateStr]: !prev[dateStr],
    }));
  };

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

  // Filtragem dos lançamentos no drawer de drilldown
  const filteredDrilldownLancamentos = useMemo(() => {
    if (!drilldownSearch.trim()) return drilldownLancamentos;
    const q = drilldownSearch.toLowerCase();
    return drilldownLancamentos.filter((l) => {
      const desc = (l.descricao || '').toLowerCase();
      const cat = (l.categoria_nome || '').toLowerCase();
      const ent = (l.entidade_nome || '').toLowerCase();
      const obs = (l.observacao || '').toLowerCase();
      return desc.includes(q) || cat.includes(q) || ent.includes(q) || obs.includes(q);
    });
  }, [drilldownLancamentos, drilldownSearch]);

  const totalDrilldownValor = useMemo(() => {
    return filteredDrilldownLancamentos.reduce((acc, curr) => acc + (curr.valor || 0), 0);
  }, [filteredDrilldownLancamentos]);

  // Filtragem do extrato recente
  const filteredExtratoRecente = useMemo(() => {
    if (!extratoSearch.trim()) return extrato_recente;
    const q = extratoSearch.toLowerCase();
    return extrato_recente.filter((item) => {
      const desc = (item.descricao || '').toLowerCase();
      const cat = (item.categoria_nome || '').toLowerCase();
      const ent = (item.entidade_nome || '').toLowerCase();
      return desc.includes(q) || cat.includes(q) || ent.includes(q);
    });
  }, [extrato_recente, extratoSearch]);

  // Configuração do Gráfico Apex de Evolução Mensal
  const chartCategories = useMemo(() => evolucao_mensal.map((e) => e.mes_label), [evolucao_mensal]);
  const chartSeries = useMemo(() => [
    {
      name: 'Recebido / Pago',
      data: evolucao_mensal.map((e) => e.pago),
    },
    {
      name: 'Aguardando Pagamento',
      data: evolucao_mensal.map((e) => e.aguardando),
    },
    {
      name: 'Em Atraso / Vencido',
      data: evolucao_mensal.map((e) => e.atrasado),
    },
  ], [evolucao_mensal]);

  const chartOptions: any = useMemo(() => ({
    chart: {
      type: 'bar',
      toolbar: { show: false },
      fontFamily: 'inherit',
      background: 'transparent',
      events: {
        dataPointSelection: (_event: any, _chartContext: any, config: any) => {
          const selectedIdx = config?.dataPointIndex;
          const selectedSeriesIdx = config?.seriesIndex;
          if (typeof selectedIdx !== 'number' || selectedIdx < 0) return;
          const item = evolucao_mensal[selectedIdx];
          if (item) {
            const ctx = selectedSeriesIdx === 0 ? 'RECEBIDO' : selectedSeriesIdx === 1 ? 'PREVISAO' : 'ATRASADO';
            const seriesName = selectedSeriesIdx === 0 ? 'Recebidos' : selectedSeriesIdx === 1 ? 'Aguardando Pagamento' : 'Em Atraso';
            openDrilldown(
              ctx,
              `Cobranças ${seriesName} • ${item.mes_label}`,
              `Lançamentos registrados para a competência ${item.mes_label}`,
              item.mes
            );
          }
        },
      },
    },
    colors: ['#10b981', '#3b82f6', '#ef4444'],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '55%',
        borderRadius: 4,
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: { enabled: false },
    stroke: { show: true, width: 2, colors: ['transparent'] },
    xaxis: {
      categories: chartCategories,
      labels: {
        style: {
          colors: isDark ? '#94a3b8' : '#64748b',
          fontSize: '11px',
          fontWeight: 600,
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        formatter: (val: number) => formatCurrency(val),
        style: {
          colors: isDark ? '#94a3b8' : '#64748b',
          fontSize: '11px',
        },
      },
    },
    fill: { opacity: 1 },
    tooltip: {
      theme: isDark ? 'dark' : 'light',
      y: {
        formatter: (val: number) => formatCurrency(val),
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '11px',
      fontWeight: 600,
      labels: {
        colors: isDark ? '#cbd5e1' : '#475569',
      },
      markers: {
        radius: 3,
      },
    },
    grid: {
      borderColor: isDark ? '#1e293b' : '#f1f5f9',
      strokeDashArray: 3,
    },
  }), [chartCategories, evolucao_mensal, isDark]);

  if (!data) {
    return (
      <div className="py-24 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
        <span>Carregando métricas e previsões do Asaas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* 5 Cards de KPIs Superiores com Interatividade Drilldown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
        {/* Card 1: Saldo Disponível */}
        <div 
          onClick={() => openDrilldown('SALDO', 'Movimentações e Extrato Asaas', 'Todas as transações e movimentações da conta bancária integrada')}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition"
          title="Clique para ver os lançamentos da conta Asaas"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Saldo Disponível</span>
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            {formatCurrency(saldo.saldo_disponivel)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Total: <strong>{formatCurrency(saldo.saldo)}</strong></span>
            <span className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-0.5 group-hover:translate-x-0.5 transition">
              Ver extrato <ArrowUpRight className="w-3 h-3" />
            </span>
          </div>
        </div>

        {/* Card 2: Total Recebido */}
        <div 
          onClick={() => openDrilldown('RECEBIDO', 'Lançamentos Recebidos via Asaas', 'Lançamentos de receitas liquidadas com baixa efetivada')}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-600 transition"
          title="Clique para ver os lançamentos recebidos"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Recebido Líquido</span>
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
            {formatCurrency(kpis.total_recebido)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>{kpis.qtd_recebidas} cobrança(s) paga(s)</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateTab('cobrancas', { status: 'RECEIVED' });
              }}
              className="text-emerald-600 dark:text-emerald-400 hover:underline font-bold flex items-center gap-0.5"
            >
              Faturas <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 3: A Receber (Previsão Futura) */}
        <div 
          onClick={() => openDrilldown('PREVISAO', 'Recebimentos Futuros Previstos', 'Cobranças em aberto e previsões de repasse no Asaas')}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group cursor-pointer hover:border-sky-400 dark:hover:border-sky-600 transition"
          title="Clique para ver os lançamentos previstos"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Previsão a Receber</span>
            <div className="p-1.5 bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-sky-600 dark:text-sky-400 tracking-tight">
            {formatCurrency(kpis.total_a_receber)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>{kpis.qtd_pendentes} fatura(s) a vencer</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateTab('previsoes');
              }}
              className="text-sky-600 dark:text-sky-400 hover:underline font-bold flex items-center gap-0.5"
            >
              Agenda <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 4: Cobranças Vencidas (Inadimplência) */}
        <div 
          onClick={() => openDrilldown('ATRASADO', 'Cobranças em Atraso / Vencidas', 'Faturas vencidas no Asaas aguardando liquidação')}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group cursor-pointer hover:border-red-400 dark:hover:border-red-600 transition"
          title="Clique para ver as faturas e lançamentos em atraso"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Em Atraso / Vencidas</span>
            <div className="p-1.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 group-hover:scale-110 transition">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-red-600 dark:text-red-400 tracking-tight">
            {formatCurrency(kpis.total_vencido)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>{kpis.qtd_vencidas} fatura(s) vencida(s)</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateTab('cobrancas', { status: 'OVERDUE' });
              }}
              className="text-red-600 dark:text-red-400 hover:underline font-bold flex items-center gap-0.5"
            >
              Cobrar <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 5: Gastos & Tarifas Retidas */}
        <div 
          onClick={() => openDrilldown('TARIFAS', 'Tarifas e Gastos Asaas', 'Despesas registradas no ERP referentes à intermediação bancária')}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition"
          title="Clique para ver os lançamentos de tarifas"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Tarifas Asaas</span>
            <div className="p-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 group-hover:scale-110 transition">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400 tracking-tight">
            {formatCurrency(kpis.total_gastos)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Taxa: <strong>{kpis.taxa_media_efetiva}%</strong></span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateTab('gastos');
              }}
              className="text-amber-600 dark:text-amber-400 hover:underline font-bold flex items-center gap-0.5"
            >
              Extrato <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Gráfico de Evolução Mensal de Cobranças */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Evolução Mensal de Cobranças (Recebidas, Atrasadas e Aguardando Pagamento)
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer barra do gráfico para visualizar os lançamentos do mês em detalhes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-bold">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" /> Recebido
            </span>
            <span className="inline-flex items-center gap-1.5 text-blue-600 font-bold">
              <span className="w-2.5 h-2.5 bg-blue-500 rounded-full" /> Aguardando
            </span>
            <span className="inline-flex items-center gap-1.5 text-red-600 font-bold">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full" /> Em Atraso
            </span>
          </div>
        </div>

        {evolucao_mensal.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
            Nenhuma movimentação mensal registrada no Asaas.
          </div>
        ) : (
          <div className="pt-2">
            <AsyncApexChart
              type="bar"
              height={300}
              series={chartSeries}
              options={chartOptions}
            />
          </div>
        )}
      </div>

      {/* Grid Principal: Previsões de Recebimento + Meios de Pagamento */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Coluna 1 & 2: Agenda de Previsões de Recebimento com Clientes e Descrições */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Previsões de Recebimento (Próximas Liquidações)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Clique nas datas para expandir os clientes, faturas e valores líquidos previstos
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('previsoes')}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Ver agenda completa</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {previsoes_timeline.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
              Nenhuma liquidação futura programada no momento.
            </div>
          ) : (
            <div className="space-y-2.5">
              {previsoes_timeline.slice(0, 8).map((item, idx) => {
                const dataFormatada = new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  weekday: 'short',
                });
                const isExpanded = !!expandedPrevisoes[item.data];
                const itens = item.itens || [];

                return (
                  <div
                    key={idx}
                    className="border border-slate-200/90 dark:border-slate-800 overflow-hidden transition"
                  >
                    {/* Linha Resumo da Data */}
                    <div
                      onClick={() => toggleExpandPrevisao(item.data)}
                      className="p-3 bg-slate-50/80 dark:bg-slate-850/60 hover:bg-slate-100/70 dark:hover:bg-slate-800/80 flex items-center justify-between text-xs cursor-pointer select-none transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </div>
                        <div className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold uppercase tracking-wider text-[10px] text-slate-700 dark:text-slate-300">
                          {dataFormatada}
                        </div>
                        <div className="text-slate-600 dark:text-slate-400 truncate">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{item.qtd} cobrança(s)</span>
                          {itens.length > 0 && !isExpanded && (
                            <span className="text-[11px] text-slate-400 ml-2 hidden sm:inline">
                              • {itens[0].cliente} {itens.length > 1 ? `e mais ${itens.length - 1}` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-right shrink-0">
                        <div>
                          <div className="text-[10px] text-slate-400">Bruto Previsto</div>
                          <div className="font-semibold text-slate-700 dark:text-slate-300">
                            {formatCurrency(item.valor_bruto)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">Líquido a Entrar</div>
                          <div className="font-black text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(item.valor_liquido)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Detalhes com Clientes e Descrições */}
                    {isExpanded && (
                      <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        {itens.length === 0 ? (
                          <div className="text-xs text-slate-400 italic">
                            Detalhes individuais da cobrança estão sendo consolidados pelo Asaas.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {itens.map((cob, cIdx) => (
                              <div
                                key={cIdx}
                                className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                              >
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {getBillingIcon(cob.meio)}
                                    <span className="font-bold text-slate-900 dark:text-white truncate">
                                      {cob.cliente}
                                    </span>
                                    {cob.cliente_cpf_cnpj && (
                                      <span className="text-[10px] text-slate-400 hidden sm:inline">
                                        ({cob.cliente_cpf_cnpj})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {cob.descricao || 'Sem descrição informada'}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-3 text-right shrink-0">
                                  <div className="text-left sm:text-right">
                                    <div className="text-[10px] text-slate-400">
                                      Bruto: {formatCurrency(cob.valor_bruto)} • Taxa: -{formatCurrency(cob.taxa_estimada)}
                                    </div>
                                    <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                                      {formatCurrency(cob.valor_liquido)}
                                    </div>
                                  </div>

                                  {cob.invoice_url && (
                                    <a
                                      href={cob.invoice_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition"
                                      title="Visualizar cobrança no Asaas"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coluna 3: Mix de Meios de Pagamento */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Formas de Recebimento
                </h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase">Volume %</span>
            </div>

            <div className="space-y-3">
              {/* PIX */}
              {(() => {
                const pix = distribuicao_meios?.PIX || { valor: 0, qtd: 0, pct: 0 };
                return (
                  <div 
                    onClick={() => onNavigateTab('cobrancas', { meio: 'PIX' })}
                    title="Filtrar cobranças via Pix"
                    className="p-3 bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5 cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-600 transition"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <QrCode className="w-3.5 h-3.5" /> Pix Instantâneo
                      </span>
                      <span>{pix.pct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5">
                      <div
                        className="bg-emerald-500 h-1.5 transition-all"
                        style={{ width: `${Math.min(pix.pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{pix.qtd} cobranças</span>
                      <span className="font-semibold">{formatCurrency(pix.valor)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Boleto */}
              {(() => {
                const boleto = distribuicao_meios?.BOLETO || { valor: 0, qtd: 0, pct: 0 };
                return (
                  <div 
                    onClick={() => onNavigateTab('cobrancas', { meio: 'BOLETO' })}
                    title="Filtrar cobranças via Boleto"
                    className="p-3 bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5 cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 transition"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                        <FileText className="w-3.5 h-3.5" /> Boleto Bancário
                      </span>
                      <span>{boleto.pct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5">
                      <div
                        className="bg-blue-500 h-1.5 transition-all"
                        style={{ width: `${Math.min(boleto.pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{boleto.qtd} cobranças</span>
                      <span className="font-semibold">{formatCurrency(boleto.valor)}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Cartão de Crédito */}
              {(() => {
                const card = distribuicao_meios?.CREDIT_CARD || { valor: 0, qtd: 0, pct: 0 };
                return (
                  <div 
                    onClick={() => onNavigateTab('cobrancas', { meio: 'CREDIT_CARD' })}
                    title="Filtrar cobranças via Cartão de Crédito"
                    className="p-3 bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5 cursor-pointer hover:border-purple-400 dark:hover:border-purple-600 transition"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                        <CreditCard className="w-3.5 h-3.5" /> Cartão de Crédito
                      </span>
                      <span>{card.pct}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5">
                      <div
                        className="bg-purple-500 h-1.5 transition-all"
                        style={{ width: `${Math.min(card.pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{card.qtd} cobranças</span>
                      <span className="font-semibold">{formatCurrency(card.valor)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={onOpenNovaCobranca}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              <span>Emitir Nova Cobrança Asaas</span>
            </button>
          </div>
        </div>
      </div>

      {/* Área de Extrato & Lançamentos Vinculados no ERP */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Extrato Recente & Lançamentos Vinculados no ERP
              </h3>
              <p className="text-[11px] text-slate-500">
                Movimentações financeiras e registros contábeis sincronizados da sua conta Asaas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Pesquisar movimentação..."
                value={extratoSearch}
                onChange={(e) => setExtratoSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:border-blue-500 w-44 sm:w-56"
              />
            </div>
            <button
              onClick={() => openDrilldown('TODOS', 'Todos os Lançamentos Asaas', 'Listagem completa dos lançamentos contábeis vinculados')}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
            >
              <span>Ver todos</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {filteredExtratoRecente.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
            {extratoSearch ? 'Nenhuma movimentação encontrada para o termo pesquisado.' : 'Nenhum lançamento recente encontrado para esta conta Asaas. Realize uma sincronização manual acima.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">Data</th>
                  <th className="py-2.5 px-3">Descrição / Lançamento</th>
                  <th className="py-2.5 px-3">Categoria (Plano de Contas)</th>
                  <th className="py-2.5 px-3">Cliente / Entidade</th>
                  <th className="py-2.5 px-3 text-right">Valor</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredExtratoRecente.map((item) => {
                  const isReceita = item.tipo?.toUpperCase() === 'RECEITA';
                  const dataFormatada = item.data ? new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleOpenLancamento(item.id)}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60 transition cursor-pointer select-none group"
                      title="Clique para editar este lançamento no ERP"
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-600 dark:text-slate-400">
                        {dataFormatada}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-xs" title={item.descricao}>
                            {item.descricao}
                          </span>
                          <span className="shrink-0 inline-flex items-center rounded bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-700/10">
                            Asaas
                          </span>
                          {item.conciliado && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-2.5 h-2.5" /> Conciliado
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {item.categoria_nome || 'Geral'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {item.entidade_nome || '-'}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-black whitespace-nowrap ${isReceita ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {isReceita ? '+' : '-'}{formatCurrency(item.valor)}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${
                          item.status === 'PAGO' || item.status === 'LIQUIDADO'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                            : item.status === 'ATRASADO'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800'
                            : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenLancamento(item.id);
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold inline-flex items-center gap-1 transition"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gastos e Tarifas Separados por Categoria */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-600" />
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Gastos e Tarifas Asaas Separados por Categoria
              </h3>
              <p className="text-[11px] text-slate-500">
                Clique em qualquer categoria para listar todos os lançamentos de despesa correspondentes
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigateTab('gastos')}
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>Ver extrato discriminado</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {gastos_por_categoria.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800">
            Nenhuma tarifa ou despesa registrada para o período.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {gastos_por_categoria.map((g, idx) => (
              <div
                key={idx}
                onClick={() => openDrilldown('TARIFAS', `Tarifas: ${g.categoria}`, `Lançamentos registrados para ${g.categoria}`, undefined, g.codigo)}
                className="p-3 bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs cursor-pointer hover:border-amber-400 dark:hover:border-amber-600 transition group select-none"
                title="Clique para ver os lançamentos desta tarifa"
              >
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-amber-600 transition">
                    {g.categoria}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {g.qtd} débito(s) • {g.percentual}% do total
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-black text-amber-600 dark:text-amber-400">
                    {formatCurrency(g.valor)}
                  </div>
                  <span className="text-[10px] text-amber-600/70 font-semibold group-hover:underline">
                    Ver lançamentos &rarr;
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawer Lateral de Drilldown (estilo Boletim.tsx) */}
      {drilldown.isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end animate-in fade-in duration-200">
          {/* Backdrop */}
          <div 
            onClick={() => setDrilldown((prev) => ({ ...prev, isOpen: false }))}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
          />

          {/* Painel Lateral */}
          <aside className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-300">
            {/* Header do Drilldown */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 bg-slate-50/50 dark:bg-slate-850/50">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                    {drilldown.contexto}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                    {drilldown.title}
                  </h3>
                </div>
                {drilldown.subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {drilldown.subtitle}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setDrilldown((prev) => ({ ...prev, isOpen: false }))}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-sm transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de Filtros e Totalizadores do Drilldown */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar por descrição, cliente ou categoria..."
                  value={drilldownSearch}
                  onChange={(e) => setDrilldownSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0 text-xs font-semibold">
                <div className="text-slate-500">
                  <span>{filteredDrilldownLancamentos.length} lançamento(s)</span>
                </div>
                <div className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <span>Total: <strong>{formatCurrency(totalDrilldownValor)}</strong></span>
                </div>
              </div>
            </div>

            {/* Conteúdo da Tabela de Lançamentos */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingDrilldown ? (
                <div className="py-16 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                  <span>Carregando lançamentos vinculados...</span>
                </div>
              ) : filteredDrilldownLancamentos.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 p-6">
                  {drilldownSearch
                    ? 'Nenhum lançamento corresponde ao filtro de busca.'
                    : 'Nenhum lançamento registrado no ERP para este contexto específico.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDrilldownLancamentos.map((lanc) => {
                    const isReceita = lanc.tipo?.toUpperCase() === 'RECEITA';
                    const dataFormatada = lanc.data
                      ? new Date(lanc.data + 'T00:00:00').toLocaleDateString('pt-BR')
                      : lanc.data_vencimento
                      ? new Date(lanc.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')
                      : '-';

                    return (
                      <div
                        key={lanc.id}
                        onClick={() => handleOpenLancamento(lanc.id)}
                        className="p-3 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 transition cursor-pointer select-none group shadow-xs space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                {lanc.descricao}
                              </span>
                              <span className="shrink-0 inline-flex items-center rounded bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-400 ring-1 ring-inset ring-blue-700/10">
                                Asaas
                              </span>
                              {lanc.conciliado && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Conciliado
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                              <span>Data: <strong>{dataFormatada}</strong></span>
                              <span>•</span>
                              <span>Categoria: <strong>{lanc.categoria_nome || 'Geral'}</strong></span>
                              {lanc.entidade_nome && (
                                <>
                                  <span>•</span>
                                  <span>Cliente/Favorecido: <strong>{lanc.entidade_nome}</strong></span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className={`text-sm font-black ${isReceita ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {isReceita ? '+' : '-'}{formatCurrency(lanc.valor)}
                            </div>
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded mt-1 ${
                              lanc.status === 'PAGO' || lanc.status === 'LIQUIDADO'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                : lanc.status === 'ATRASADO'
                                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                            }`}>
                              {lanc.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                          <span className="truncate">
                            {lanc.observacao || 'ID Lançamento: #' + lanc.id}
                          </span>
                          <span className="text-blue-600 dark:text-blue-400 font-bold group-hover:underline flex items-center gap-0.5 shrink-0">
                            <Edit3 className="w-3 h-3" /> Editar no ERP &rarr;
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rodapé do Drilldown */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850/50 flex items-center justify-between text-xs text-slate-500">
              <span>Clique no lançamento para abrir o formulário contábil</span>
              <button
                type="button"
                onClick={() => setDrilldown((prev) => ({ ...prev, isOpen: false }))}
                className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                Fechar Painel
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Formulário Modal/Drawer do Lançamento (LancamentoFormDrawer) */}
      <LancamentoFormDrawer
        showDrawer={isLancamentoDrawerOpen}
        editarId={editingLancamentoId}
        onlyCategoryEditable={true}
        onClose={() => {
          setIsLancamentoDrawerOpen(false);
          setEditingLancamentoId(null);
        }}
        onSaveSuccess={async () => {
          setIsLancamentoDrawerOpen(false);
          setEditingLancamentoId(null);
          toast.success('Categoria do lançamento atualizada com sucesso!');
          if (onRefresh) onRefresh();
          reloadDrilldown();
        }}
        categorias={categorias}
        entidades={entidades}
        contas={contas}
        centros={centrosCusto}
      />
    </div>
  );
}
