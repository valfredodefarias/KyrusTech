import React, { useEffect, useState, useRef, useMemo } from 'react';
import { api } from '../services/api';
import {
  Calendar, Filter, Download, ArrowUpRight, ArrowDownRight, Search, CheckCircle2, ChevronRight, X, AlertCircle, Info, RefreshCw, Upload, Edit2, PlayCircle, Loader2, Link as LinkIcon, Trash2, Zap, Settings, CreditCard, Coins, Check, Receipt, ShoppingCart, User, MoreHorizontal, ArrowLeft, ArrowRight, ShieldCheck, HelpCircle, CheckSquare, TrendingUp, Percent, DollarSign, Sparkles, Plus, ChevronLeft, ChevronDown, ChevronUp
} from 'lucide-react';
import { BrandAvatar, inferCardBrand } from '../components/BrandAvatar';
import { SearchableSelect } from '../components/SearchableSelect';
import type { Recebivel, DepositoExtrato, RegraCartao, Conta, PlanoContas, SugestaoConciliacao } from './ConciliacaoCartoes/types';
import { formatSafeDate, parseSafeDate } from './ConciliacaoCartoes/types';

import { useAgendaCartoes } from './ConciliacaoCartoes/hooks/useAgendaCartoes';
import { useConciliacaoCartoes } from './ConciliacaoCartoes/hooks/useConciliacaoCartoes';
import { useRegrasCartoes } from './ConciliacaoCartoes/hooks/useRegrasCartoes';
import { useConciliacaoWebSocket } from './ConciliacaoCartoes/hooks/useConciliacaoWebSocket';
import { MovimentacaoPDVDrawer } from './MovimentacaoPDV/components/MovimentacaoPDVDrawer';
import { IfoodTransactionDrawer } from './Apps/components/IfoodTransactionDrawer';
import { PdvVendaDrawer } from './PDV/components/PdvVendaDrawer';

export function ConciliacaoCartoes() {
  const [activeTab, setActiveTab] = useState<'agenda' | 'conciliacao' | 'regras'>('agenda');
  const [contas, setContas] = useState<Conta[]>([]);
  const [categoriasDespesa, setCategoriasDespesa] = useState<PlanoContas[]>([]);
  const [regras, setRegras] = useState<RegraCartao[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  const fetchContas = async () => {
    try {
      const res = await api.get('/contas/');
      setContas(res.data.items || res.data);
    } catch (e) {
      console.error('Erro ao carregar contas:', e);
    }
  };

  const fetchCategorias = async () => {
    try {
      const res = await api.get('/plano-contas/', { params: { tipo: 'DESPESA' } });
      setCategoriasDespesa(res.data.items || res.data);
    } catch (e) {
      console.error('Erro ao carregar categorias:', e);
    }
  };

  const fetchRegras = async () => {
    try {
      const res = await api.get('/pdv/regras-cartao');
      setRegras(res.data.items || res.data);
    } catch (e) {
      console.error('Erro ao carregar regras:', e);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoadingInitial(true);
      await Promise.all([fetchContas(), fetchCategorias(), fetchRegras()]);
      setLoadingInitial(false);
    };
    void init();
  }, []);

  const agenda = useAgendaCartoes(contas);
  const conciliacao = useConciliacaoCartoes(agenda.recebiveis, agenda.fetchAgenda);
  const regrasHook = useRegrasCartoes(regras, contas, categoriasDespesa, fetchRegras);

  useConciliacaoWebSocket(agenda.fetchAgenda, conciliacao.fetchDepositos, fetchRegras);

  useEffect(() => {
    if (activeTab === 'agenda') {
      void agenda.fetchAgenda();
    } else if (activeTab === 'conciliacao') {
      void conciliacao.fetchDepositos();
      // Ensure agenda.recebiveis is loaded for the pending list
      if (agenda.recebiveis.length === 0) {
        void agenda.fetchAgenda();
      }
    } else if (activeTab === 'regras') {
      void fetchRegras();
    }
  }, [activeTab, agenda.currentMonth, agenda.startDate, agenda.endDate, agenda.viewMode]);

  const [showEditRecebivelDrawer, setShowEditRecebivelDrawer] = useState(false);
  const [activeOriginDrawer, setActiveOriginDrawer] = useState<'pdv_movimentacao' | 'pdv_venda' | 'pdv_ifood_lancamento' | 'manual' | null>(null);
  const [selectedOriginId, setSelectedOriginId] = useState<string | number | null>(null);
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [recebivelForm, setRecebivelForm] = useState<any>({});
  const handleRecebivelFormChange = (updates: any) => setRecebivelForm((prev: any) => ({ ...prev, ...updates }));
  const handleSaveRecebivel = async (e: React.FormEvent) => { e.preventDefault(); setShowEditRecebivelDrawer(false); };
  const handleDeleteRecebivel = async () => { setShowEditRecebivelDrawer(false); };
  const [entidades, setEntidades] = useState<any[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [categoriasReceita, setCategoriasReceita] = useState<any[]>([]);

  const formatTipoPagamento = (tipo: string) => {
    if (!tipo) return '';
    if (tipo.includes('credito_vista')) return 'Crédito à Vista';
    if (tipo.includes('credito_parcelado')) return 'Crédito Parcelado';
    if (tipo.includes('debito')) return 'Débito';
    return tipo;
  };
  const detailsRef = useRef<HTMLDivElement>(null);

  const handleOpenEditRecebivel = (item: any) => {
    const origTipo = item.origem?.tipo || item.origem_tipo;
    const origId = item.origem?.id || item.origem_id;

    if (origTipo === 'pdv_movimentacao' && (origId || item.movimentacao_id)) {
      setSelectedOriginId(origId || item.movimentacao_id);
      setActiveOriginDrawer('pdv_movimentacao');
      return;
    }
    if (origTipo === 'pdv_ifood_lancamento' && (origId || item.ifood_lancamento_id)) {
      setSelectedOriginId(origId || item.ifood_lancamento_id);
      setActiveOriginDrawer('pdv_ifood_lancamento');
      return;
    }
    if (origTipo === 'pdv_venda' && (origId || item.venda_id_uuid || item.venda_id)) {
      setSelectedOriginId(origId || item.venda_id_uuid || item.venda_id);
      setActiveOriginDrawer('pdv_venda');
      return;
    }

    // Fallback: manual / desconhecido -> abre drawer genérico padrão
    setRecebivelForm(item);
    setShowEditRecebivelDrawer(true);
  };

  const handleOriginDrawerClose = () => {
    setActiveOriginDrawer(null);
    setSelectedOriginId(null);
  };

  const handleOriginDrawerSuccess = () => {
    setActiveOriginDrawer(null);
    setSelectedOriginId(null);
    agenda.fetchAgenda();
  };

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // Destructure for the UI to continue working without changes
  const {
    viewMode, setViewMode, currentMonth, setCurrentMonth, selectedDay, setSelectedDay,
    expandedBrands, setExpandedBrands, modalityFilter, setModalityFilter, copyToast, setCopyToast,
    searchInputRef, showAntecipacaoModal, setShowAntecipacaoModal, antecipacaoTaxaPct, setAntecipacaoTaxaPct,
    antecipacaoDias, setAntecipacaoDias, antecipacaoLancarFinanceiro, setAntecipacaoLancarFinanceiro,
    antecipacaoContaId, setAntecipacaoContaId, antecipandoEfetivo, setAntecipandoEfetivo,
    antecipacaoDataInicio, setAntecipacaoDataInicio, antecipacaoDataFim, setAntecipacaoDataFim,
    modalRecebiveis, loadingModalRecebiveis, recebiveis, setRecebiveis, filterBrand, setFilterBrand,
    filterStatus, setFilterStatus, filterSearch, setFilterSearch, startDate, setStartDate, endDate, setEndDate,
    fetchAgenda, handleSyncFinanceiro, handleCopyWhatsAppSummary, handleEfetivarAntecipacao,
    filteredAgenda, calendarFilteredAgenda, agendaSummary, agendaGroupedByDate, calendarDays,
    handlePrevMonth, handleNextMonth, handleGoToday, goToMonth, getMonthRange,
    loading: agendaLoading, syncing: agendaSyncing
  } = agenda;

  const [expandedListSubgroups, setExpandedListSubgroups] = useState<Record<string, boolean>>({});
  const toggleListSubgroup = (key: string) => {
    setExpandedListSubgroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const dayStatsMap = useMemo(() => {
    const stats = new Map<string, { count: number; bruto: number; liquido: number }>();
    calendarFilteredAgenda.forEach(r => {
      const d = (r.data_vencimento || '').split('T')[0];
      if (!d) return;
      const existing = stats.get(d) || { count: 0, bruto: 0, liquido: 0 };
      existing.count += 1;
      existing.bruto += Number(r.valor_bruto || 0);
      existing.liquido += Number(r.valor_liquido || 0);
      stats.set(d, existing);
    });
    return stats;
  }, [calendarFilteredAgenda]);

  const maxDayLiquido = useMemo(() => {
    let max = 0;
    dayStatsMap.forEach(stat => {
      if (stat.liquido > max) max = stat.liquido;
    });
    return max || 1;
  }, [dayStatsMap]);

  const activeModalityKey = regrasHook.drawerSubTab as 'debito' | 'credito_vista' | 'credito_parcelado';
  const activeModality = regrasHook.groupedRegraForm[activeModalityKey] || ({} as any);

  const {
    depositos, setDepositos, selectedDeposito, setSelectedDeposito,
    sugestoes, loadingSugestoes, rightPanelTab, setRightPanelTab, manualFilterBrand, setManualFilterBrand,
    manualSearch, setManualSearch, selectedManualIds, setSelectedManualIds, anticipationRate, setAnticipationRate,
    manualReconcileDate, setManualReconcileDate, manualReconcileContaId, setManualReconcileContaId,
    showConfirmModal, setShowConfirmModal, selectedSugestao, setSelectedSugestao, confirmData, setConfirmData,
    fetchDepositos, handleOpenConfirmConciliacao, handleConfirmConciliacao, handleBatchManualReconcile,
    pendingReceivables, filteredManualReceivables, manualSummary, loading: conciliacaoLoading, syncing: conciliacaoSyncing,
    saving: conciliacaoSaving
  } = conciliacao;

  const {
    showRegraDrawer, setShowRegraDrawer, isEditingRegra, drawerSubTab, setDrawerSubTab,
    groupedRegraForm, setGroupedRegraForm, regraForm, setRegraForm, handleOpenConfigureBrand,
    handleOpenCreateRegra, handleOpenEditGroupedRegra, handleSaveRegra, handleDeleteGroupedRegra, groupedRegras,
    saving: regrasSaving
  } = regrasHook;

  // Aliases required by the UI
  const loading = loadingInitial || agendaLoading || conciliacaoLoading;
  const syncing = agendaSyncing || conciliacaoSyncing;
  const saving = conciliacaoSaving || regrasSaving;

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 overflow-y-auto custom-scrollbar">
      {/* HEADER */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sticky top-0 z-20 shadow-sm">
        <div>
          <h2 className="text-2xl font-black text-slate-950 dark:text-white flex items-center gap-2">
            <Coins className="w-7 h-7 text-blue-500" />
            Conciliadora de Cartões
          </h2>
          <p className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wider">Mapeamento de taxas, agenda de recebíveis e conciliação assistida de adquirentes</p>
        </div>

        {/* TABS CONTROLS & ACTIONS */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto self-stretch md:self-auto">
          <button
            onClick={() => setShowAntecipacaoModal(true)}
            className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs border border-amber-500/20 transition flex items-center justify-center gap-2 shadow-2xs w-full sm:w-auto"
            title="Simular antecipação de recebíveis de crédito futuros"
          >
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500/30" />
            Simular Antecipação
          </button>

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700/80 w-full sm:w-auto flex-1 md:flex-none">
            <button
              onClick={() => setActiveTab('agenda')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${activeTab === 'agenda' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              <Calendar className="w-4 h-4" />
              Agenda de Recebíveis
            </button>
            <button
              onClick={() => setActiveTab('conciliacao')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${activeTab === 'conciliacao' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              <CheckSquare className="w-4 h-4" />
              Conciliação Assistida
            </button>
            <button
              onClick={() => setActiveTab('regras')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${activeTab === 'regras' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/50 dark:border-slate-700/50' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              <Filter className="w-4 h-4" />
              Parâmetros das Bandeiras
            </button>
          </div>
        </div>
      </header>

      <div className="w-full flex-1 p-6 space-y-6">
        {/* TAB 1: AGENDA DE RECEBÍVEIS */}
        {activeTab === 'agenda' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Previsto (Bruto)</p>
                <h3 className="text-3xl font-black text-slate-900 dark:text-white mt-2 font-mono">{BRL.format(agendaSummary.bruto)}</h3>
                <div className="absolute right-4 bottom-4 bg-blue-100 dark:bg-blue-900/20 p-2.5 rounded-xl text-blue-600 dark:text-blue-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Taxas Estimadas (Custo)</p>
                <h3 className="text-3xl font-black text-rose-600 dark:text-rose-400 mt-2 font-mono">{BRL.format(agendaSummary.taxa)}</h3>
                <div className="absolute right-4 bottom-4 bg-rose-100 dark:bg-rose-900/20 p-2.5 rounded-xl text-rose-600 dark:text-rose-400">
                  <Percent className="w-5 h-5" />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.06) 0%, rgba(0,0,0,0) 100%)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Líquido a Receber</p>
                <h3 className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-2 font-mono">{BRL.format(agendaSummary.liquido)}</h3>
                <div className="absolute right-4 bottom-4 bg-emerald-100 dark:bg-emerald-900/20 p-2.5 rounded-xl text-emerald-600 dark:text-emerald-400">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={filterSearch}
                  onChange={e => setFilterSearch(e.target.value)}
                  placeholder="Pesquisar venda ou ID... (Atalho: /)"
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 focus:border-transparent transition"
                />
              </div>

              <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-between md:justify-end">
                {agendaSyncing && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-bold border border-blue-200/60 dark:border-blue-800/60 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Atualizando...</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowFiltrosSidebar(true)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-sm transition cursor-pointer"
                >
                  <Filter className="w-4 h-4" />
                  Filtros
                </button>

                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${viewMode === 'list' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('calendar');
                      if (!selectedDay) {
                        const y = currentMonth.getFullYear();
                        const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
                        const prefix = `${y}-${m}`;
                        const firstWithRec = calendarFilteredAgenda.find(r => (r.data_vencimento || '').startsWith(prefix));
                        if (firstWithRec?.data_vencimento) {
                          setSelectedDay(firstWithRec.data_vencimento.split('T')[0]);
                        } else {
                          const d = String(new Date().getDate()).padStart(2, '0');
                          setSelectedDay(`${y}-${m}-${d}`);
                        }
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  >
                    Calendário
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content (List vs Calendar) */}
            {loading && recebiveis.length === 0 ? (
              <div className="py-20 text-center text-slate-400 flex flex-col items-center gap-3">
                <Loader2 className="animate-spin text-blue-500 w-10 h-10" />
                <span>Carregando agenda...</span>
              </div>
            ) : viewMode === 'list' ? (
              <div className="space-y-6">
                {/* Month Switcher Bar in List Mode */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                      <button
                        type="button"
                        onClick={handlePrevMonth}
                        className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition cursor-pointer shadow-2xs"
                        title="Mês Anterior (Atalho: ←)"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleGoToday}
                        className="px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        title="Ir para o mês atual"
                      >
                        <Calendar className="w-3.5 h-3.5 text-blue-500" />
                        Mês Atual
                      </button>
                      <button
                        type="button"
                        onClick={handleNextMonth}
                        className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition cursor-pointer shadow-2xs"
                        title="Próximo Mês (Atalho: →)"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white capitalize flex items-center gap-2">
                        {currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {filteredAgenda.length} recebível(eis) no período ({startDate} a {endDate})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Previsto</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">{BRL.format(agendaSummary.bruto)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Taxas</span>
                      <span className="font-mono font-bold text-rose-500 text-sm">-{BRL.format(agendaSummary.taxa)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Líquido do Mês</span>
                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-base">{BRL.format(agendaSummary.liquido)}</span>
                    </div>
                  </div>
                </div>

                {filteredAgenda.length === 0 ? (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl py-16 text-center text-slate-500">
                    <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                    <h4 className="font-bold text-slate-900 dark:text-white">Nenhum recebível previsto</h4>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">Nenhum lançamento no financeiro corresponde às regras e filtros aplicados.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {agendaGroupedByDate.map((grupo) => {
                      // Sub-group items of this day by Bandeira + Forma de Pagamento
                      const subGroupsMap: Record<string, {
                        key: string;
                        bandeira: string;
                        tipo_pagamento: string;
                        formaLabel: string;
                        badgeColor: string;
                        itens: Recebivel[];
                        bruto: number;
                        taxa: number;
                        liquido: number;
                        status: string;
                      }> = {};

                      grupo.itens.forEach(item => {
                        const brand = (item.bandeira || 'OUTROS').toUpperCase();
                        const tipo = item.tipo_pagamento || 'outros';
                        const key = `${brand}___${tipo}`;

                        let formaLabel = 'Outros';
                        let badgeColor = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
                        if (tipo.includes('debito')) {
                          formaLabel = 'Débito';
                          badgeColor = 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800';
                        } else if (tipo.includes('credito_parcelado')) {
                          formaLabel = 'Crédito Parcelado';
                          badgeColor = 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
                        } else if (tipo.includes('credito_vista') || tipo.includes('credito')) {
                          formaLabel = 'Crédito à Vista';
                          badgeColor = 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
                        }

                        if (!subGroupsMap[key]) {
                          subGroupsMap[key] = {
                            key: `${grupo.data}___${key}`,
                            bandeira: brand,
                            tipo_pagamento: tipo,
                            formaLabel,
                            badgeColor,
                            itens: [],
                            bruto: 0,
                            taxa: 0,
                            liquido: 0,
                            status: item.status || 'A RECEBER'
                          };
                        }

                        subGroupsMap[key].itens.push(item);
                        subGroupsMap[key].bruto += Number(item.valor_bruto || 0);
                        subGroupsMap[key].taxa += Number(item.valor_taxa || 0);
                        subGroupsMap[key].liquido += Number(item.valor_liquido || 0);
                        if (subGroupsMap[key].status !== item.status) {
                          subGroupsMap[key].status = 'MISTO';
                        }
                      });

                      const daySubGroups = Object.values(subGroupsMap).sort((a, b) => b.liquido - a.liquido);
                      const isAllDayExpanded = daySubGroups.every(sg => !!expandedListSubgroups[sg.key]);

                      return (
                        <div key={grupo.data} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                          {/* Day Header */}
                          <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-2">
                            <div className="flex items-center gap-3">
                              <div className="text-left flex items-center gap-2 flex-wrap">
                                <span className="font-black text-slate-900 dark:text-white text-sm">
                                  {formatSafeDate(grupo.data, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </span>
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                                  {grupo.itens.length} Recebível(eis)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const target = !isAllDayExpanded;
                                  setExpandedListSubgroups(prev => {
                                    const next = { ...prev };
                                    daySubGroups.forEach(sg => {
                                      next[sg.key] = target;
                                    });
                                    return next;
                                  });
                                }}
                                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                {isAllDayExpanded ? 'Recolher todos' : 'Expandir todos'}
                              </button>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <span className="text-slate-400">Total Previsto: <b className="text-slate-700 dark:text-slate-300 font-mono font-bold">{BRL.format(grupo.bruto)}</b></span>
                              <span className="text-slate-400">Líquido do dia: <b className="text-emerald-600 dark:text-emerald-400 font-mono font-black">{BRL.format(grupo.liquido)}</b></span>
                            </div>
                          </div>

                          {/* Sub-groups by Bandeira + Forma */}
                          <div className="p-4 space-y-3 bg-slate-50/30 dark:bg-slate-950/20">
                            {daySubGroups.map(sub => {
                              const isExpanded = !!expandedListSubgroups[sub.key];
                              const brandObj = inferCardBrand(sub.bandeira);

                              return (
                                <div
                                  key={sub.key}
                                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-2xs hover:border-slate-300 dark:hover:border-slate-700 transition"
                                >
                                  {/* Subgroup Summary Row */}
                                  <div
                                    onClick={() => toggleListSubgroup(sub.key)}
                                    className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition select-none"
                                  >
                                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                                      <BrandAvatar visual={brandObj} size="sm" className="shrink-0" />
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-extrabold text-slate-900 dark:text-white text-sm">
                                            {sub.bandeira}
                                          </span>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sub.badgeColor}`}>
                                            {sub.formaLabel}
                                          </span>
                                          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold px-2 py-0.5 rounded-full">
                                            {sub.itens.length} {sub.itens.length === 1 ? 'recebível' : 'recebíveis'}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                          {isExpanded ? 'Clique para recolher lançamentos' : 'Clique para detalhar os lançamentos individuais'}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-5 justify-between md:justify-end w-full md:w-auto shrink-0 border-t md:border-t-0 pt-2.5 md:pt-0 border-slate-100 dark:border-slate-800">
                                      <div className="text-right">
                                        <span className="text-[10px] font-bold text-slate-400 block uppercase">Bruto</span>
                                        <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{BRL.format(sub.bruto)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-[10px] font-bold text-slate-400 block uppercase">Taxa</span>
                                        <span className="font-mono text-xs text-rose-500">-{BRL.format(sub.taxa)}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-[10px] font-bold text-slate-400 block uppercase">Líquido</span>
                                        <span className="font-mono text-sm font-black text-slate-900 dark:text-white">{BRL.format(sub.liquido)}</span>
                                      </div>
                                      <div className="text-center min-w-[75px]">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                                          sub.status === 'PAGO'
                                            ? 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                                            : sub.status === 'ANTECIPADO'
                                              ? 'bg-purple-100 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900'
                                              : 'bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900'
                                        }`}>
                                          {sub.status}
                                        </span>
                                      </div>
                                      <div className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition pl-1">
                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Expanded Item Details */}
                                  {isExpanded && (
                                    <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 divide-y divide-slate-100 dark:divide-slate-800/60 animate-in fade-in-50 duration-150">
                                      {[...sub.itens].sort((a, b) => Number(b.valor_liquido || 0) - Number(a.valor_liquido || 0)).map(item => (
                                        <div
                                          key={`${item.id}-${item.venda_id_uuid || ''}`}
                                          onClick={() => handleOpenEditRecebivel(item)}
                                          className="p-3.5 pl-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:bg-white dark:hover:bg-slate-800/60 cursor-pointer transition"
                                          title="Clique para editar / ver detalhes do lançamento"
                                        >
                                          <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                                  {item.numero_parcela 
                                                    ? `Parcela ${item.numero_parcela}/${item.total_parcelas} • RV: ${item.rv || '-'}` 
                                                    : (item.tipo_pagamento?.includes('debito') ? `Débito • RV: ${item.rv || '-'}` : `À Vista • RV: ${item.rv || '-'}`)}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                                                <span>Venda: {formatSafeDate(item.data_venda)}</span>
                                                {item.vendedor && (
                                                  <>
                                                    <span>•</span>
                                                    <span>Vendedor: <b className="text-slate-600 dark:text-slate-350">{item.vendedor}</b></span>
                                                  </>
                                                )}
                                                {item.cliente && (
                                                  <>
                                                    <span>•</span>
                                                    <span>Cliente: <b className="text-slate-600 dark:text-slate-350">{item.cliente}</b></span>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-4 justify-between md:justify-end w-full md:w-auto shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-100 dark:border-slate-800">
                                            <div className="text-right">
                                              <span className="text-[9px] font-bold text-slate-400 block uppercase">Bruto</span>
                                              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{BRL.format(item.valor_bruto)}</span>
                                            </div>
                                            <div className="text-right">
                                              <span className="text-[9px] font-bold text-slate-400 block uppercase">Taxa</span>
                                              <span className="font-mono text-xs text-rose-500">-{BRL.format(item.valor_taxa)}</span>
                                            </div>
                                            <div className="text-right">
                                              <span className="text-[9px] font-bold text-slate-400 block uppercase">Líquido</span>
                                              <span className="font-mono text-xs font-black text-slate-900 dark:text-white">{BRL.format(item.valor_liquido)}</span>
                                            </div>
                                            <div className="text-center w-20">
                                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                                                item.status === 'PAGO'
                                                  ? 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                                                  : item.status === 'ANTECIPADO'
                                                    ? 'bg-purple-100 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900'
                                                    : 'bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900'
                                              }`}>
                                                {item.status}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Calendar View Grid - Side by Side Layout */
              <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[430px_minmax(0,1fr)] gap-6 items-start">
                {/* Left Column: Calendar Card with Limited Width */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-4 space-y-3">
                  {/* Month Selector Header */}
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 px-3.5 py-2.5 rounded-xl gap-2">
                    <h3 className="text-sm font-black text-slate-950 dark:text-white capitalize truncate">
                      {currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleGoToday}
                        className="px-2 py-1 bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg text-xs font-bold transition border border-slate-200 dark:border-slate-700 flex items-center gap-1 cursor-pointer shadow-2xs"
                        title="Ir para o dia de hoje (Atalho: T)"
                      >
                        <Calendar className="w-3.5 h-3.5 text-blue-500" />
                        Hoje
                      </button>
                      <button
                        type="button"
                        onClick={handlePrevMonth}
                        className="p-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs"
                        title="Mês anterior (Atalho: ←)"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleNextMonth}
                        className="p-1.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer shadow-2xs"
                        title="Próximo mês (Atalho: →)"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Calendar Grid */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                    {/* Days of week header */}
                    <div className="grid grid-cols-7 text-center bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 py-2 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                      <div>Dom</div>
                      <div>Seg</div>
                      <div>Ter</div>
                      <div>Qua</div>
                      <div>Qui</div>
                      <div>Sex</div>
                      <div>Sáb</div>
                    </div>

                    {/* Day Slots */}
                    <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-slate-800">
                      {calendarDays.map((slot, index) => {
                        const isSelected = selectedDay === slot.dateStr;
                        const stat = dayStatsMap.get(slot.dateStr);
                        const hasReceivables = !!(stat && stat.count > 0);
                        const intensity = hasReceivables ? Math.min(1, stat.liquido / maxDayLiquido) : 0;

                        const isToday = (() => {
                          const today = new Date();
                          const y = today.getFullYear();
                          const m = String(today.getMonth() + 1).padStart(2, '0');
                          const d = String(today.getDate()).padStart(2, '0');
                          return slot.dateStr === `${y}-${m}-${d}`;
                        })();

                        // Heatmap styling
                        let heatmapClass = '';
                        if (hasReceivables) {
                          if (intensity <= 0.25) {
                            heatmapClass = 'bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 font-bold';
                          } else if (intensity <= 0.50) {
                            heatmapClass = 'bg-emerald-100/75 dark:bg-emerald-950/45 text-emerald-800 dark:text-emerald-300 font-black';
                          } else if (intensity <= 0.75) {
                            heatmapClass = 'bg-emerald-200/70 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 font-black';
                          } else {
                            heatmapClass = 'bg-emerald-300/60 dark:bg-emerald-800/50 text-emerald-950 dark:text-emerald-100 font-black';
                          }
                        }

                        return (
                          <div
                            key={`${slot.dateStr}-${index}`}
                            onClick={() => setSelectedDay(slot.dateStr)}
                            title={hasReceivables ? `${stat.count} recebível(is) • Líquido: ${BRL.format(stat.liquido)}` : `${slot.dayNum}`}
                            className={`h-14 p-1 flex flex-col items-center justify-between cursor-pointer transition select-none relative ${
                              !slot.isCurrentMonth ? 'bg-slate-50/40 dark:bg-slate-950/20 opacity-30' : ''
                            } ${heatmapClass} ${
                              isSelected
                                ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/60 dark:bg-blue-950/40 z-10'
                                : isToday
                                  ? 'border-2 border-dashed border-blue-400/80'
                                  : 'hover:bg-blue-50/30 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <div className="flex items-center justify-center w-full mt-0.5">
                              <span className={`text-xs ${
                                isSelected
                                  ? '!text-blue-600 dark:!text-blue-400 !font-black'
                                  : hasReceivables
                                    ? '!text-emerald-600 dark:!text-emerald-400 !font-black'
                                    : slot.isCurrentMonth
                                      ? 'text-slate-800 dark:text-slate-200 font-semibold'
                                      : 'text-slate-400 font-normal'
                              }`}>
                                {slot.dayNum}
                              </span>
                            </div>

                            {hasReceivables ? (
                              <div className="flex items-center gap-1 mb-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs"></span>
                                <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 tracking-tight">
                                  {stat.count}
                                </span>
                              </div>
                            ) : (
                              <div className="h-2 mb-0.5" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Heatmap Legend */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1.5 font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Com Recebíveis
                    </span>
                    <div className="flex items-center gap-1 text-[9px] font-medium">
                      <span>Menor</span>
                      <span className="w-2.5 h-2.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/50"></span>
                      <span className="w-2.5 h-2.5 rounded bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300/50"></span>
                      <span className="w-2.5 h-2.5 rounded bg-emerald-200 dark:bg-emerald-900/50 border border-emerald-400/50"></span>
                      <span className="w-2.5 h-2.5 rounded bg-emerald-300 dark:bg-emerald-800/60 border border-emerald-500/50"></span>
                      <span>Maior</span>
                    </div>
                  </div>
                </div>

                {/* Right Column: Selected Day Details Panel */}
                <div className="min-w-0">
                  {selectedDay ? (
                    <div ref={detailsRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 animate-in fade-in-50 duration-200">
                      <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3 flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <h4 className="font-black text-slate-950 dark:text-white text-sm">
                          Detalhamento de Recebíveis para {formatSafeDate(selectedDay, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </h4>
                        {copyToast && (
                          <span className="text-[10px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full animate-in fade-in">
                            ✓ {copyToast}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            handleSyncFinanceiro(selectedDay);
                          }}
                          className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-3 py-1.5 rounded-lg border border-amber-500/20 transition flex items-center gap-1.5 shadow-2xs group"
                          title="Atualizar Financeiro com os valores das sub-vendas"
                        >
                          <Sparkles className="w-4 h-4 group-hover:scale-110 transition-transform" />
                          Atualizar Financeiro
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const dayItems = filteredAgenda.filter(r => r.data_vencimento === selectedDay);
                            handleCopyWhatsAppSummary(selectedDay, dayItems);
                          }}
                          className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-3 py-1.5 rounded-lg border border-emerald-500/20 transition flex items-center gap-1.5 shadow-2xs"
                          title="Copiar resumo formatado do dia para colar no WhatsApp"
                        >
                          💬 Copiar para WhatsApp
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDay(null);
                            const range = getMonthRange(currentMonth);
                            setStartDate(range.start);
                            setEndDate(range.end);
                          }}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold cursor-pointer"
                        >
                          Fechar detalhes
                        </button>
                      </div>
                    </div>

                    {(() => {
                      const dayItems = filteredAgenda.filter(r => r.data_vencimento === selectedDay);
                      if (dayItems.length === 0) {
                        return <p className="text-xs text-slate-400 text-center py-6">Nenhum recebível previsto para este dia.</p>;
                      }

                      const totalDayBruto = dayItems.reduce((acc, curr) => acc + Number(curr.valor_bruto || 0), 0);
                      const totalDayTaxa = dayItems.reduce((acc, curr) => acc + Number(curr.valor_taxa || 0), 0);
                      const totalDayLiquido = dayItems.reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
                      const totalDayDebito = dayItems.filter(r => r.tipo_pagamento === 'cartao_debito').reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
                      const totalDayCredito = dayItems.filter(r => r.tipo_pagamento !== 'cartao_debito').reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
                      const avgTaxaPct = totalDayBruto > 0 ? (totalDayTaxa / totalDayBruto) * 100 : 0;

                      // Group items by brand + modality (DEBITO / CREDITO)
                      const groups: Record<string, {
                        key: string;
                        bandeira: string;
                        modalidade: 'DEBITO' | 'CREDITO';
                        items: typeof filteredAgenda;
                        bruto: number;
                        taxa: number;
                        liquido: number;
                        status: string;
                      }> = {};

                      dayItems.forEach(item => {
                        const brand = (item.bandeira || 'OUTROS').toUpperCase();
                        const tipo = item.tipo_pagamento || '';
                        const modalidade: 'DEBITO' | 'CREDITO' = (tipo === 'cartao_debito') ? 'DEBITO' : 'CREDITO';
                        const key = `${brand}___${modalidade}`;

                        if (!groups[key]) {
                          groups[key] = {
                            key,
                            bandeira: brand,
                            modalidade,
                            items: [],
                            bruto: 0,
                            taxa: 0,
                            liquido: 0,
                            status: item.status,
                          };
                        }

                        groups[key].items.push(item);
                        groups[key].bruto += Number(item.valor_bruto);
                        groups[key].taxa += Number(item.valor_taxa);
                        groups[key].liquido += Number(item.valor_liquido);
                        if (item.status === 'ANTECIPADO') {
                          groups[key].status = 'ANTECIPADO';
                        } else if (item.status !== 'PAGO' && groups[key].status !== 'ANTECIPADO') {
                          groups[key].status = 'A RECEBER';
                        }
                      });

                      const groupedList = Object.values(groups).sort((a, b) => {
                        const comp = a.bandeira.localeCompare(b.bandeira);
                        if (comp !== 0) return comp;
                        return a.modalidade.localeCompare(b.modalidade);
                      });

                      return (
                        <div className="space-y-4">
                          {/* Selected Day Summary KPIs */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* Card 1: Bruto */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-xl p-3.5 flex items-center justify-between shadow-2xs">
                              <div>
                                <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider block">Total Bruto do Dia</span>
                                <span className="text-base font-black text-slate-900 dark:text-white font-mono mt-0.5 block">{BRL.format(totalDayBruto)}</span>
                                <span className="text-[10px] text-slate-400 font-medium block mt-0.5">{dayItems.length} recebível(eis)</span>
                              </div>
                              <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                                💵
                              </div>
                            </div>

                            {/* Card 2: Taxas */}
                            <div className="bg-rose-50/40 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 rounded-xl p-3.5 flex items-center justify-between shadow-2xs">
                              <div>
                                <span className="text-[10px] font-black uppercase text-rose-500/80 dark:text-rose-400/80 tracking-wider block">Taxas Estimadas (Custo)</span>
                                <span className="text-base font-black text-rose-600 dark:text-rose-400 font-mono mt-0.5 block">{BRL.format(totalDayTaxa)}</span>
                                <span className="text-[10px] text-rose-500/80 font-medium block mt-0.5">Taxa Média: {avgTaxaPct.toFixed(2)}%</span>
                              </div>
                              <div className="w-9 h-9 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs">
                                %
                              </div>
                            </div>

                            {/* Card 3: Líquido */}
                            <div className="bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl p-3.5 flex items-center justify-between shadow-2xs">
                              <div>
                                <span className="text-[10px] font-black uppercase text-emerald-600/80 dark:text-emerald-400/80 tracking-wider block">Líquido a Receber</span>
                                <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5 block">{BRL.format(totalDayLiquido)}</span>
                                <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-bold">
                                  <span className="text-blue-600 dark:text-blue-400">Débito: {BRL.format(totalDayDebito)}</span>
                                  <span className="text-slate-300 dark:text-slate-700">•</span>
                                  <span className="text-violet-600 dark:text-violet-400">Crédito: {BRL.format(totalDayCredito)}</span>
                                </div>
                              </div>
                              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs">
                                💰
                              </div>
                            </div>
                          </div>
                          {groupedList.map(group => {
                            const brandObj = inferCardBrand(group.bandeira);
                            const isExpanded = !!expandedBrands[group.key];
                            const isDebito = group.modalidade === 'DEBITO';

                            const modalColor = isDebito
                              ? {
                                border: 'border-blue-150 dark:border-blue-900/40',
                                badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 border-blue-200 dark:border-blue-800',
                                liq: 'text-blue-700 dark:text-blue-400'
                              }
                              : {
                                border: 'border-violet-150 dark:border-violet-900/40',
                                badge: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 border-violet-200 dark:border-violet-800',
                                liq: 'text-violet-700 dark:text-violet-400'
                              };

                            return (
                              <div key={group.key} className={`border rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900/60 ${modalColor.border}`}>
                                {/* Group Header */}
                                <div
                                  onClick={() => setExpandedBrands(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                                  className="p-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition select-none"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <BrandAvatar visual={brandObj} size="md" className="shrink-0" />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-slate-900 dark:text-white text-sm uppercase tracking-wide">
                                          {group.bandeira}
                                        </span>
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${modalColor.badge}`}>
                                          {group.modalidade === 'DEBITO' ? 'Débito' : 'Crédito'}
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">
                                        {group.items.length} {group.items.length === 1 ? 'recebível' : 'recebíveis'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-6 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100 dark:border-slate-800 w-full lg:w-auto justify-between lg:justify-end">
                                    <div className="text-right">
                                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Bruto</span>
                                      <span className="font-mono text-sm font-semibold text-slate-500 dark:text-slate-400">
                                        {BRL.format(group.bruto)}
                                      </span>
                                    </div>

                                    <div className="text-right">
                                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Taxa</span>
                                      <span className="font-mono text-sm font-semibold text-rose-500">
                                        -{BRL.format(group.taxa)}
                                      </span>
                                    </div>

                                    <div className="text-right pr-2">
                                      <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block mb-0.5">Líquido</span>
                                      <span className={`font-mono text-xl font-black ${modalColor.liq}`}>
                                        {BRL.format(group.liquido)}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2.5 shrink-0">
                                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${group.status === 'ANTECIPADO'
                                          ? 'bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                                          : group.status === 'PAGO'
                                            ? 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
                                            : 'bg-amber-100 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50'
                                        }`}>
                                        {group.status === 'ANTECIPADO' ? '⚡ ANTECIPADO' : group.status}
                                      </span>
                                      <svg className={`h-4 w-4 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="bg-slate-50/40 dark:bg-slate-900/20 border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 pl-4 pr-3">
                                    {[...group.items].sort((a, b) => Number(b.valor_liquido || 0) - Number(a.valor_liquido || 0)).map(item => (
                                      <div key={`${item.id}-${item.venda_id_uuid || ''}`} className="py-1 flex flex-col">
                                        <div
                                          onClick={() => handleOpenEditRecebivel(item)}
                                          className="py-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-white dark:hover:bg-slate-800/40 cursor-pointer transition px-2 rounded-lg"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-bold text-slate-850 dark:text-slate-200 text-xs">
                                                {item.numero_parcela ? `Parcela ${item.numero_parcela}/${item.total_parcelas}` : 'À Vista'} RV: {item.rv}
                                              </span>
                                              <span className="text-[9px] font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 font-mono">
                                                {item.tipo_pagamento === 'cartao_credito_parcelado' ? 'Parcelado' : 'À Vista'}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 flex-wrap">
                                              <span>Venda: {formatSafeDate(item.data_venda)}</span>
                                              <span>•</span>
                                              <span>Venc: {formatSafeDate(item.data_vencimento)}</span>
                                              {item.numero_parcela && (
                                                <>
                                                  <span>•</span>
                                                  <span>Parcela {item.numero_parcela}/{item.total_parcelas}</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-5 justify-between md:justify-end w-full md:w-auto shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-100 dark:border-slate-855 font-mono text-slate-550">
                                            <div className="text-right w-20">
                                              <span className="text-[8px] text-slate-450 uppercase block font-semibold">Bruto</span>
                                              <span className="text-xs">{BRL.format(item.valor_bruto)}</span>
                                            </div>
                                            <div className="text-right w-20">
                                              <span className="text-[8px] text-slate-450 uppercase block font-semibold">Taxa</span>
                                              <span className="text-xs text-rose-500">-{BRL.format(item.valor_taxa)}</span>
                                            </div>
                                            <div className="text-right w-24">
                                              <span className="text-[8px] text-slate-450 uppercase block font-semibold">Líquido</span>
                                              <span className={`text-sm font-black ${modalColor.liq}`}>{BRL.format(item.valor_liquido)}</span>
                                            </div>
                                            <div className="text-center w-24 pl-2">
                                              <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase border ${item.status === 'ANTECIPADO'
                                                  ? 'bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-300 border-purple-100 dark:border-purple-900/40'
                                                  : item.status === 'PAGO'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-450 border-emerald-100 dark:border-emerald-950'
                                                    : 'bg-amber-50 dark:bg-amber-950/10 text-amber-600 dark:text-amber-450 border-amber-100 dark:border-amber-950'
                                                }`}>
                                                {item.status === 'ANTECIPADO' ? '⚡ ANTECIPADO' : item.status}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Sub-vendas */}
                                        {item.itens && item.itens.length > 0 && (
                                          <div className="pl-6 md:pl-10 relative mt-1 mb-3">
                                            {/* Linha guia visual */}
                                            <div className="absolute top-0 bottom-4 left-3 md:left-5 w-[1.5px] bg-slate-200 dark:bg-slate-700/60 rounded"></div>
                                            <div className="space-y-1.5">
                                              {item.itens.map((sub: any) => (
                                                <div
                                                  key={sub.id}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenEditRecebivel(sub);
                                                  }}
                                                  className="relative flex items-center justify-between gap-3 p-2.5 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-700/30 rounded-lg text-xs hover:bg-white dark:hover:bg-slate-800 transition cursor-pointer group"
                                                  title={`Vendedor: ${sub.vendedor}`}
                                                >
                                                  {/* Tracinho visual ligando à linha */}
                                                  <div className="absolute -left-3 md:-left-5 top-1/2 w-3 md:w-5 h-[1.5px] bg-slate-200 dark:bg-slate-700/60"></div>

                                                  <div className="flex items-center gap-3">
                                                    <span className="font-mono text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded-md text-[9px] shadow-sm">{sub.rv}</span>
                                                    <div className="flex flex-col">
                                                      <span className="text-slate-600 dark:text-slate-300 font-bold">{formatSafeDate(sub.data_venda)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                                      <span className="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 p-1 rounded-md shadow-sm border border-blue-100 dark:border-blue-900/50">
                                                        <Edit2 className="w-3 h-3" />
                                                      </span>
                                                    </div>
                                                  </div>
                                                  <div className="font-mono font-black text-slate-600 dark:text-slate-300">
                                                    {BRL.format(sub.valor_bruto)}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 shadow-sm text-center flex flex-col items-center justify-center min-h-[360px]">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-3">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-base">Nenhum dia selecionado</h4>
                      <p className="text-xs text-slate-400 max-w-xs mt-1">
                        Clique em qualquer dia do calendário ao lado para ver o detalhamento completo dos recebíveis e totais previstos.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* FILTROS SIDEBAR */}
            <>
              <button
                type="button"
                aria-label="Fechar painel de filtros"
                onClick={() => setShowFiltrosSidebar(false)}
                className={`fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] transition-opacity duration-200 ${showFiltrosSidebar ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              />
              <div
                className={`fixed inset-y-0 right-0 w-80 xl:w-[min(34vw,560px)] xl:min-w-[380px] xl:max-w-[420px] bg-white dark:bg-slate-800 shadow-2xl z-[50] transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 flex flex-col ${showFiltrosSidebar ? 'translate-x-0' : 'translate-x-full'}`}
              >
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
                  <h3 className="font-bold flex gap-2 text-slate-800 dark:text-white">
                    <Filter className="w-4 h-4 text-blue-500" /> Filtros da Agenda
                  </h3>
                  <button onClick={() => setShowFiltrosSidebar(false)}>
                    <X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                  {/* Modalidade */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                      Tipo de Lançamento
                    </label>
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700/80 w-full">
                      <button
                        type="button"
                        onClick={() => setModalityFilter('ALL')}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition ${modalityFilter === 'ALL' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalityFilter('CREDITO')}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition ${modalityFilter === 'CREDITO' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                      >
                        Crédito
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalityFilter('DEBITO')}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition ${modalityFilter === 'DEBITO' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                      >
                        Débito
                      </button>
                    </div>
                  </div>

                  {/* Período */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                      Período Personalizado
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full pl-3 pr-2 py-2 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs"
                        />
                      </div>
                      <span className="text-slate-400 text-xs font-bold">-</span>
                      <div className="relative flex-1">
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className="w-full pl-3 pr-2 py-2 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bandeira */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                      Bandeira
                    </label>
                    <SearchableSelect
                      value={filterBrand}
                      onChange={val => setFilterBrand(String(val))}
                      options={[{
                        label: 'Bandeiras',
                        options: [
                          { id: '', label: 'Todas as Bandeiras' },
                          { id: 'VISA', label: 'VISA' },
                          { id: 'MASTERCARD', label: 'MASTERCARD' },
                          { id: 'ELO', label: 'ELO' },
                          { id: 'AMEX', label: 'AMEX' },
                          { id: 'HIPERCARD', label: 'HIPERCARD' },
                          { id: 'IFOOD', label: 'IFOOD' }
                        ]
                      }]}
                    />
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                      Status
                    </label>
                    <SearchableSelect
                      value={filterStatus}
                      onChange={val => setFilterStatus(String(val))}
                      options={[{
                        label: 'Status',
                        options: [
                          { id: '', label: 'Todos os Status' },
                          { id: 'A RECEBER', label: 'A RECEBER' },
                          { id: 'PAGO', label: 'PAGO' }
                        ]
                      }]}
                    />
                  </div>
                </div>
                
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterSearch('');
                      setFilterBrand('');
                      setFilterStatus('');
                      setStartDate('');
                      setEndDate('');
                      setModalityFilter('ALL');
                      setSelectedDay(null);
                      setShowFiltrosSidebar(false);
                    }}
                    className="w-full py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                  >
                    Limpar Filtros
                  </button>
                </div>
              </div>
            </>
          </div>
        )}

        {/* TAB 2: CONCILIAÇÃO ASSISTIDA */}
        {activeTab === 'conciliacao' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-200 min-h-[500px]">
            {/* Left Pane: Bank Deposits from Extrato */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <h3 className="font-black text-slate-900 dark:text-white text-base">1. Depósitos no Extrato</h3>
                <p className="text-xs text-slate-400 mt-1">Selecione uma receita de extrato para buscar recebíveis correspondentes</p>
              </div>

              <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[600px] custom-scrollbar">
                {depositos.length === 0 ? (
                  <div className="p-10 text-center text-slate-500">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="font-bold text-slate-800 dark:text-white">Tudo conciliado!</p>
                    <p className="text-xs text-slate-400 mt-1">Não há depósitos de extrato em aberto aguardando conciliação.</p>
                  </div>
                ) : (
                  depositos.map(d => {
                    const isSelected = selectedDeposito?.id === d.id;
                    const val = d.valor_pago > 0 ? d.valor_pago : d.valor_previsto;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setSelectedDeposito(d)}
                        className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition flex items-center justify-between gap-3 ${isSelected ? 'bg-blue-50/70 dark:bg-blue-950/20 ring-2 ring-inset ring-blue-500' : ''}`}
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white text-sm block truncate">{d.descricao}</span>
                          <span className="text-[10px] text-slate-400 mt-1 font-mono block">
                            Venc: {formatSafeDate(d.data_vencimento)}
                            {d.data_pagamento && ` • Pago em ${formatSafeDate(d.data_pagamento)}`}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-mono text-sm font-black text-slate-900 dark:text-white">{BRL.format(val)}</span>
                          <span className="text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded text-slate-500 uppercase font-bold tracking-wider mt-1 block w-max ml-auto">Extrato</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {/* Right Pane: Auto-Match Suggestions */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-base">2. Sugestões de Conciliação</h3>
                  <p className="text-xs text-slate-400 mt-1">Sugestões baseadas em data de vencimento e valores líquidos</p>
                </div>
                {selectedDeposito && (
                  <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Valor Alvo: {BRL.format(selectedDeposito.valor_pago || selectedDeposito.valor_previsto)}
                  </div>
                )}
              </div>

              {selectedDeposito && (
                <div className="px-6 pt-3 pb-0 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/20 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('sugestoes')}
                    className={`pb-3 text-xs font-bold transition-all relative ${rightPanelTab === 'sugestoes' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-slate-400 hover:text-slate-655 dark:hover:text-slate-300'}`}
                  >
                    Sugestões Inteligentes
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('manual')}
                    className={`pb-3 text-xs font-bold transition-all relative ${rightPanelTab === 'manual' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-slate-400 hover:text-slate-655 dark:hover:text-slate-300'}`}
                  >
                    Seleção Manual & Antecipação
                  </button>
                </div>
              )}

              <div className="flex-1 p-6 overflow-y-auto max-h-[600px] custom-scrollbar">
                {!selectedDeposito ? (
                  <div className="py-24 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                    <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full text-slate-400">
                      <ArrowRight className="w-8 h-8 rotate-90 lg:rotate-0" />
                    </div>
                    <p className="font-bold text-slate-800 dark:text-white text-sm">Selecione um depósito</p>
                    <p className="text-xs text-slate-400 max-w-xs mx-auto">Clique em um depósito no painel esquerdo para buscar sugestões inteligentes de correspondência.</p>
                  </div>
                ) : rightPanelTab === 'sugestoes' ? (
                  loadingSugestoes ? (
                    <div className="py-24 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                      <Loader2 className="animate-spin text-blue-500 w-10 h-10" />
                      <span>Calculando combinações ideais...</span>
                    </div>
                  ) : sugestoes.length === 0 ? (
                    <div className="py-20 text-center text-slate-500">
                      <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                      <h4 className="font-bold text-slate-900 dark:text-white">Nenhuma sugestão encontrada</h4>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">Não foi possível encontrar nenhum recebível de cartão (individual ou lote) com valor líquido aproximado a este depósito na mesma semana.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sugestoes.map((sug, index) => {
                        const isHighMatch = sug.score >= 90;
                        const isMediumMatch = sug.score >= 70;
                        return (
                          <div key={index} className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 hover:border-blue-400 dark:hover:border-blue-800/80 bg-slate-50/50 dark:bg-slate-900/30 transition flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div className="space-y-2 min-w-0 flex-1">
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <span className={`text-[10px] font-black tracking-wider px-2 py-0.5 rounded uppercase ${isHighMatch ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50' : isMediumMatch ? 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                  {sug.score}% Match
                                </span>
                                <span className="text-xs font-bold text-slate-400 uppercase font-mono bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                  {sug.tipo === 'GRUPO_DIA_BANDEIRA' ? 'Lote Diário' : sug.tipo === 'AVULSO' ? 'Individual' : 'Combinação'}
                                </span>
                              </div>

                              <h4 className="font-black text-slate-900 dark:text-white text-sm">{sug.label}</h4>
                              <p className="text-xs text-slate-400">{sug.detalhes} • {sug.lancamentos.length} recebível(eis) selecionado(s)</p>
                            </div>

                            <div className="flex items-center gap-5 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-200 dark:border-slate-800 shrink-0">
                              <div className="text-right">
                                <span className="text-[10px] font-bold text-slate-400 block uppercase">Líquido do Lote</span>
                                <span className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">{BRL.format(sug.valor_liquido)}</span>
                                <span className="text-[10px] text-slate-400 block font-mono">Taxas: {BRL.format(sug.valor_taxa)}</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenConfirmConciliacao(sug)}
                                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-2"
                              >
                                <CheckSquare className="w-3.5 h-3.5" />
                                Conciliar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  /* Manual Selection & Anticipation tab content */
                  <div className="space-y-5">
                    {/* Filter controls */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/35 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/80">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Filtrar por Bandeira</label>
                        <SearchableSelect
                          value={manualFilterBrand}
                          onChange={val => setManualFilterBrand(String(val))}
                          options={[{
                            label: 'Bandeira',
                            options: [
                              { id: '', label: 'Todas Bandeiras' },
                              { id: 'VISA', label: 'VISA' },
                              { id: 'MASTERCARD', label: 'MASTERCARD' },
                              { id: 'ELO', label: 'ELO' },
                              { id: 'AMEX', label: 'AMEX' },
                              { id: 'HIPERCARD', label: 'HIPERCARD' },
                              { id: 'CABAL', label: 'CABAL' },
                              { id: 'IFOOD', label: 'IFOOD' }
                            ]
                          }]}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Pesquisar Recebível</label>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                          <input
                            type="text"
                            value={manualSearch}
                            onChange={e => setManualSearch(e.target.value)}
                            placeholder="Nome ou código RV..."
                            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Receivables checklist */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Selecione os Recebíveis em Aberto ({filteredManualReceivables.length})</span>
                        {filteredManualReceivables.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const allIds = filteredManualReceivables.map(item => item.id);
                              const allSelected = allIds.every(id => selectedManualIds.includes(id));
                              if (allSelected) {
                                setSelectedManualIds(prev => prev.filter(id => !allIds.includes(id)));
                              } else {
                                setSelectedManualIds(prev => Array.from(new Set([...prev, ...allIds])));
                              }
                            }}
                            className="text-[10px] font-black text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {filteredManualReceivables.every(item => selectedManualIds.includes(item.id)) ? 'Desmarcar Todos' : 'Selecionar Todos'}
                          </button>
                        )}
                      </div>
                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[260px] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900">
                        {filteredManualReceivables.length === 0 ? (
                          <div className="p-6 text-center text-slate-400 text-xs">
                            Nenhum recebível em aberto encontrado para os filtros aplicados.
                          </div>
                        ) : (
                          filteredManualReceivables.map(item => {
                            const isChecked = selectedManualIds.includes(item.id);
                            return (
                              <label
                                key={item.id}
                                className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850/30 transition-all ${isChecked ? 'bg-blue-50/20 dark:bg-blue-950/5' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setSelectedManualIds(prev => [...prev, item.id]);
                                    } else {
                                      setSelectedManualIds(prev => prev.filter(id => id !== item.id));
                                    }
                                  }}
                                  className="mt-1 rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                      {item.numero_parcela 
                                        ? `Parcela ${item.numero_parcela}/${item.total_parcelas} RV: ${item.rv || '-'}` 
                                        : (item.tipo_pagamento?.includes('debito') ? `Débito RV: ${item.rv || '-'}` : `À Vista RV: ${item.rv || '-'}`)}
                                    </span>
                                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white">{BRL.format(item.valor_bruto)}</span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 mt-1 text-[10px] text-slate-400">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono uppercase font-bold text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">{item.bandeira}</span>
                                      <span>Venc: {formatSafeDate(item.data_vencimento)}</span>
                                      {item.numero_parcela && (
                                        <span>Parc: {item.numero_parcela}/{item.total_parcelas}</span>
                                      )}
                                    </div>
                                    <span>Taxa: -{BRL.format(item.valor_taxa)}</span>
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Batch Settings */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data Real do Depósito/Baixa</label>
                        <input
                          type="date"
                          value={manualReconcileDate}
                          onChange={e => setManualReconcileDate(e.target.value)}
                          className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Taxa Antecipação (%)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={anticipationRate}
                          onChange={e => setAnticipationRate(Number(e.target.value))}
                          className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Conta Bancária Destino</label>
                      <SearchableSelect
                        value={manualReconcileContaId}
                        onChange={val => setManualReconcileContaId(String(val))}
                        options={[{
                          label: 'Conta Destino',
                          options: [
                            { id: '', label: 'Selecione...' },
                            ...contas.map(c => ({ id: String(c.id), label: `${c.nome} ${c.banco ? `(${c.banco})` : ''}` }))
                          ]
                        }]}
                      />
                    </div>

                    {/* Calculations Summary Card */}
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-800/60 space-y-2.5 text-[11px]">
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800/80 pb-1.5 mb-1 font-black">Simulação Financeira</span>
                      <div className="flex justify-between">
                        <span className="text-slate-400 font-semibold">Bruto Selecionado:</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">{BRL.format(manualSummary.bruto)}</span>
                      </div>
                      <div className="flex justify-between text-rose-500 font-semibold">
                        <span>Taxa de Administração original:</span>
                        <span className="font-mono">-{BRL.format(manualSummary.taxaAdm)}</span>
                      </div>
                      {manualSummary.antecipacao > 0 && (
                        <div className="flex justify-between text-amber-500 font-semibold">
                          <span>Taxa de Antecipação ({anticipationRate.toFixed(2)}%):</span>
                          <span className="font-mono">-{BRL.format(manualSummary.antecipacao)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-slate-200 dark:border-slate-700/80 pt-2 font-bold text-xs">
                        <span className="text-slate-800 dark:text-white">Líquido Previsto do Lote:</span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-450">{BRL.format(manualSummary.liquido)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 dark:border-slate-700/80 pt-2">
                        <span className="text-slate-400 font-semibold">Valor Creditado (Depósito Alvo):</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{BRL.format(selectedDeposito.valor_pago || selectedDeposito.valor_previsto)}</span>
                      </div>

                      {/* Difference calculation */}
                      <div className={`flex justify-between border-t border-slate-200 dark:border-slate-700/80 pt-2 font-black ${Math.abs(manualSummary.diferenca) < 0.1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                        <span>Diferença a Conciliar:</span>
                        <span className="font-mono">{BRL.format(manualSummary.diferenca)}</span>
                      </div>
                    </div>

                    {/* Confirm Button */}
                    <button
                      type="button"
                      onClick={() => handleBatchManualReconcile(BRL)}
                      disabled={saving || selectedManualIds.length === 0 || !manualReconcileContaId || !manualReconcileDate}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                    >
                      {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      Conciliar Lote Selecionado
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PARÂMETROS DAS BANDEIRAS */}
        {activeTab === 'regras' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl shadow-sm flex-wrap gap-3">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white text-lg">Parâmetros das Bandeiras</h3>
                <p className="text-xs text-slate-400 mt-1">Cadastre os parâmetros de recebimento (taxas, prazos, adiantamento) de cada bandeira</p>
              </div>
              <button
                onClick={handleOpenCreateRegra}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow flex items-center gap-2 transition"
              >
                <Plus className="w-4.5 h-4.5" />
                Novos Parâmetros
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupedRegras.map(g => {
                const brandObj = inferCardBrand(g.bandeira);
                const isConfigured = !!(g.debito || g.credito_vista || g.credito_parcelado);
                return (
                  <div
                    key={g.bandeira}
                    className={`bg-white dark:bg-slate-900 border ${isConfigured ? 'border-slate-200 dark:border-slate-800' : 'border-slate-200/60 dark:border-slate-800/60 opacity-90'} rounded-2xl p-5 shadow-sm space-y-4 hover:shadow-md transition relative overflow-hidden flex flex-col justify-between`}
                  >
                    <div className="absolute top-0 right-0 -mr-6 -mt-6 w-20 h-20 bg-blue-500 opacity-5 rounded-full blur-xl pointer-events-none"></div>

                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <BrandAvatar visual={brandObj} size="sm" />
                        <div>
                          <span className="font-black text-slate-950 dark:text-white text-sm block">{g.bandeira}</span>
                          {isConfigured ? (
                            <>
                              <span className="text-[9px] bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider block mt-0.5 w-max">
                                Configurado
                              </span>
                              {g.data_inicio && (
                                <span className="text-[9px] bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider block mt-1 w-max" title="Válido a partir desta data">
                                  A partir de: {formatSafeDate(g.data_inicio)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider block mt-0.5 w-max">
                              Não Configurado
                            </span>
                          )}
                        </div>
                      </div>

                      {isConfigured && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleOpenEditGroupedRegra(g)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition"
                            title="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteGroupedRegra(g)}
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {/* Débito */}
                      {g.debito ? (
                        <div className="text-xs bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 flex justify-between items-center">
                          <div>
                            <span className="font-bold text-slate-800 dark:text-slate-200">Débito</span>
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              {g.debito.tipo_prazo === 'DIAS_CORRIDOS' ? `D+${g.debito.dias_payout} Corridos` : g.debito.tipo_prazo === 'DIAS_UTEIS' ? `D+${g.debito.dias_payout} Úteis` : `Dia ${g.debito.dia_fixo} fixo`}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-blue-600 dark:text-blue-400 text-xs font-mono">{Number(g.debito.taxa_porcentagem || 0).toFixed(2)}%</span>
                          </div>
                        </div>
                      ) : isConfigured ? (
                        <div className="text-[10px] text-slate-400 bg-slate-50/50 dark:bg-slate-800/10 p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex justify-between items-center opacity-60">
                          <span>Débito não configurado</span>
                        </div>
                      ) : null}

                      {/* Crédito à Vista */}
                      {g.credito_vista ? (
                        <div className="text-xs bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 space-y-1">
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-800 dark:text-slate-200">Crédito à Vista</span>
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                {g.credito_vista.tipo_prazo === 'DIAS_CORRIDOS' ? `D+${g.credito_vista.dias_payout} Corridos` : g.credito_vista.tipo_prazo === 'DIAS_UTEIS' ? `D+${g.credito_vista.dias_payout} Úteis` : `Dia ${g.credito_vista.dia_fixo} fixo`}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-blue-600 dark:text-blue-400 text-xs font-mono">{Number(g.credito_vista.taxa_porcentagem || 0).toFixed(2)}%</span>
                            </div>
                          </div>
                          {g.credito_vista.modo_parcelamento === 'ANTECIPADO' && (
                            <div className="text-[9px] text-amber-600 dark:text-amber-400 font-semibold border-t border-slate-200/50 dark:border-slate-700/50 pt-1 flex justify-between">
                              <span>Modo Antecipado</span>
                              <span className="font-mono font-bold">Taxa: {Number(g.credito_vista.taxa_antecipacao || 0).toFixed(2)}%</span>
                            </div>
                          )}
                        </div>
                      ) : isConfigured ? (
                        <div className="text-[10px] text-slate-400 bg-slate-50/50 dark:bg-slate-800/10 p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex justify-between items-center opacity-60">
                          <span>Crédito à Vista não configurado</span>
                        </div>
                      ) : null}

                      {/* Crédito Parcelado */}
                      {g.credito_parcelado ? (
                        <div className="text-xs bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 space-y-1">
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-800 dark:text-slate-200">Crédito Parcelado</span>
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                {g.credito_parcelado.tipo_prazo === 'DIAS_CORRIDOS' ? `D+${g.credito_parcelado.dias_payout} Corridos` : g.credito_parcelado.tipo_prazo === 'DIAS_UTEIS' ? `D+${g.credito_parcelado.dias_payout} Úteis` : `Dia ${g.credito_parcelado.dia_fixo} fixo`}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-blue-600 dark:text-blue-400 text-xs font-mono">{Number(g.credito_parcelado.taxa_porcentagem || 0).toFixed(2)}%</span>
                            </div>
                          </div>
                          <div className="text-[9px] text-slate-500 dark:text-slate-400 border-t border-slate-200/50 dark:border-slate-700/50 pt-1 flex justify-between">
                            <span>{g.credito_parcelado.modo_parcelamento === 'PRO_RATA' ? 'Mês a Mês (Pro-Rata)' : 'Antecipado Total'}</span>
                            {g.credito_parcelado.modo_parcelamento === 'ANTECIPADO' && (
                              <span className="text-amber-600 dark:text-amber-400 font-semibold font-mono">Taxa: {Number(g.credito_parcelado.taxa_antecipacao || 0).toFixed(2)}%</span>
                            )}
                          </div>
                        </div>
                      ) : isConfigured ? (
                        <div className="text-[10px] text-slate-400 bg-slate-50/50 dark:bg-slate-800/10 p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex justify-between items-center opacity-60">
                          <span>Crédito Parcelado não configurado</span>
                        </div>
                      ) : null}

                      {!isConfigured && (
                        <div className="py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/30 dark:bg-slate-900/30 text-slate-400">
                          Sem taxas configuradas
                        </div>
                      )}
                    </div>

                    {isConfigured ? (
                      <div className="text-[10px] text-slate-400 font-semibold space-y-1 mt-2">
                        {((g.debito?.fds_proximo_dia_util) || (g.credito_vista?.fds_proximo_dia_util) || (g.credito_parcelado?.fds_proximo_dia_util)) && (
                          <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                            <Check className="w-3.5 h-3.5" /> Fim de semana rola p/ próximo dia útil
                          </p>
                        )}
                        <p className="truncate">
                          Conta destino: {
                            contas.find(c => String(c.id) === String(g.debito?.conta_destino_id || g.credito_vista?.conta_destino_id || g.credito_parcelado?.conta_destino_id))?.nome ||
                            `Não configurada`
                          }
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenConfigureBrand(g.bandeira)}
                        className="w-full mt-2 py-2 bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-200/50 dark:border-blue-800/50 font-bold rounded-xl flex items-center justify-center gap-1.5 transition"
                      >
                        <Plus className="w-4 h-4" /> Configurar {brandObj.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* REGRA DRAWER (Novo / Editar) */}
      {showRegraDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowRegraDrawer(false)}></div>
          <div className="relative w-full max-w-md bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="font-black text-slate-900 dark:text-white text-lg">{isEditingRegra ? 'Editar Parâmetros' : 'Novos Parâmetros de Bandeira'}</h3>
              <button onClick={() => setShowRegraDrawer(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white transition"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleSaveRegra} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar text-xs">
              <div className="space-y-4">
                {/* Tipo de Pagamento */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Forma de Pagamento</label>
                  <SearchableSelect
                    value={regraForm.tipo_pagamento}
                    onChange={val => setRegraForm({ ...regraForm, tipo_pagamento: String(val) })}
                    options={[{
                      label: 'Forma de Pagamento',
                      options: [
                        { id: 'cartao_credito_vista', label: 'Crédito à Vista' },
                        { id: 'cartao_credito_parcelado', label: 'Crédito Parcelado' },
                        { id: 'cartao_debito', label: 'Débito' }
                      ]
                    }]}
                  />
                </div>

                {/* Habilitar esta forma de pagamento */}
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800/60">
                  <span className="font-bold text-slate-700 dark:text-slate-200">Habilitar esta forma de pagamento</span>
                  <input
                    type="checkbox"
                    checked={activeModality.active}
                    onChange={e => {
                      setGroupedRegraForm(prev => {
                        const next = { ...prev };
                        next[activeModalityKey] = {
                          ...next[activeModalityKey],
                          active: e.target.checked
                        };
                        return next;
                      });
                    }}
                    className="rounded text-blue-500 focus:ring-blue-500 h-4 w-4"
                  />
                </div>

                {/* Data Início */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Válido a partir de (Data de Início)
                  </label>
                  <input
                    type="date"
                    value={groupedRegraForm.data_inicio}
                    onChange={e => setGroupedRegraForm(prev => ({ ...prev, data_inicio: e.target.value }))}
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Se alterado, criará uma nova versão da regra a partir desta data, mantendo o histórico anterior.</p>
                </div>

                {/* Bandeira */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bandeira</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'PIX', 'IFOOD'].map(bName => {
                      const visual = inferCardBrand(bName);
                      const isSelected = groupedRegraForm.bandeira.toUpperCase() === bName;
                      return (
                        <button
                          key={bName}
                          type="button"
                          onClick={() => setGroupedRegraForm(prev => ({ ...prev, bandeira: bName }))}
                          className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all gap-1.5 ${isSelected ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 bg-white dark:bg-slate-900'}`}
                        >
                          <BrandAvatar visual={visual} size="sm" />
                          <span className="text-[10px] font-bold tracking-wider">{visual.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Taxas */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Taxa Adm (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={regraForm.taxa_porcentagem}
                      onChange={e => setRegraForm({ ...regraForm, taxa_porcentagem: Number(e.target.value) })}
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                  {regraForm.modo_parcelamento === 'ANTECIPADO' && (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Taxa Antecipação / Juros (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={regraForm.taxa_antecipacao}
                        onChange={e => setRegraForm({ ...regraForm, taxa_antecipacao: Number(e.target.value) })}
                        className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  )}
                </div>

                {/* Modo de Parcelamento */}
                {regraForm.tipo_pagamento !== 'cartao_debito' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      {regraForm.tipo_pagamento === 'cartao_credito_vista' ? 'Modo de Repasse (Adiantamento)' : 'Regra de Parcelamento'}
                    </label>
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <button
                        type="button"
                        onClick={() => setRegraForm({ ...regraForm, modo_parcelamento: 'PRO_RATA' })}
                        className={`p-3 rounded-xl border font-bold transition ${regraForm.modo_parcelamento === 'PRO_RATA' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                      >
                        {regraForm.tipo_pagamento === 'cartao_credito_vista' ? 'Fluxo Padrão' : 'Repasse Mês a Mês'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegraForm({ ...regraForm, modo_parcelamento: 'ANTECIPADO' })}
                        className={`p-3 rounded-xl border font-bold transition ${regraForm.modo_parcelamento === 'ANTECIPADO' ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400' : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500'}`}
                      >
                        {regraForm.tipo_pagamento === 'cartao_credito_vista' ? 'Antecipado' : 'Antecipado Total'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Prazo Tipo */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Tipo de Prazo</label>
                  <SearchableSelect
                    value={regraForm.tipo_prazo}
                    onChange={val => setRegraForm({ ...regraForm, tipo_prazo: String(val) as any })}
                    options={[{
                      label: 'Tipo de Prazo',
                      options: [
                        { id: 'DIAS_CORRIDOS', label: 'Dias Corridos (ex: D+30)' },
                        { id: 'DIAS_UTEIS', label: 'Dias Úteis (ex: D+30 úteis)' },
                        { id: 'DIA_FIXO', label: 'Dia Fixo do Mês' }
                      ]
                    }]}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {regraForm.tipo_prazo !== 'DIA_FIXO' ? (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dias Payout</label>
                      <input
                        type="number"
                        min="0"
                        value={regraForm.dias_payout}
                        onChange={e => setRegraForm({ ...regraForm, dias_payout: Number(e.target.value) })}
                        className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dia de Repasse Fixo</label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Ex: 5 (Todo dia 5)"
                        value={regraForm.dia_fixo}
                        onChange={e => setRegraForm({ ...regraForm, dia_fixo: e.target.value })}
                        className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                  )}

                  {/* FDS Rollover */}
                  {regraForm.tipo_prazo !== 'DIAS_UTEIS' && (
                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={regraForm.fds_proximo_dia_util}
                          onChange={(e) => setRegraForm({ ...regraForm, fds_proximo_dia_util: e.target.checked })}
                          className="rounded text-blue-500 focus:ring-blue-500 h-4 w-4"
                        />
                        Rolar para o primeiro dia útil
                      </label>
                    </div>
                  )}
                </div>

                {/* Conta Destino */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Conta Bancária Destino</label>
                  <SearchableSelect
                    value={regraForm.conta_destino_id}
                    onChange={val => setRegraForm({ ...regraForm, conta_destino_id: String(val) })}
                    options={[{
                      label: 'Conta Bancária Destino',
                      options: [
                        { id: '', label: 'Selecione...' },
                        ...contas.map(c => ({ id: String(c.id), label: `${c.nome} ${c.banco ? `(${c.banco})` : ''}` }))
                      ]
                    }]}
                  />
                </div>

                {/* Plano de contas taxa */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Categoria de Despesa de Taxa</label>
                  <SearchableSelect
                    value={regraForm.plano_contas_taxa_id}
                    onChange={val => setRegraForm({ ...regraForm, plano_contas_taxa_id: String(val) })}
                    options={[{
                      label: 'Categoria de Despesa de Taxa',
                      options: [
                        { id: '', label: 'Selecione...' },
                        ...categoriasDespesa.map(d => ({ id: String(d.id), label: `${d.codigo} - ${d.nome}` }))
                      ]
                    }]}
                  />
                </div>
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 pt-6 bg-slate-50 dark:bg-slate-900/50 absolute bottom-0 left-0 w-full">
                <button type="button" onClick={() => setShowRegraDrawer(false)} className="px-5 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition">Cancelar</button>
                <button type="submit" disabled={saving} className="px-7 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-50">
                  {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Check className="w-4 h-4" />} Salvar Parâmetros
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM CONCILIACAO MODAL */}
      {showConfirmModal && selectedSugestao && selectedDeposito && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowConfirmModal(false)}></div>
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 border border-slate-200 dark:border-slate-800 text-xs">
            <h3 className="font-black text-lg text-slate-950 dark:text-white mb-4 flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-emerald-500" /> Confirmar Liquidação de Lote
            </h3>

            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-100 dark:border-slate-800/60 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Bruto das Vendas:</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200 font-mono">{BRL.format(selectedSugestao.valor_bruto)}</span>
                </div>
                <div className="flex justify-between text-rose-500">
                  <span>Despesa de Taxas Adquirente:</span>
                  <span className="font-mono">-{BRL.format(selectedSugestao.valor_taxa)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 dark:border-slate-700 pt-2 font-bold">
                  <span className="text-slate-800 dark:text-white">Líquido Creditado:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 text-sm">{BRL.format(selectedSugestao.valor_liquido)}</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data Real do Depósito / Baixa</label>
                <input
                  type="date"
                  value={confirmData.data_pagamento}
                  onChange={e => setConfirmData({ ...confirmData, data_pagamento: e.target.value })}
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Conta Financeira Destino</label>
                <SearchableSelect
                  value={confirmData.conta_destino_id}
                  onChange={val => setConfirmData({ ...confirmData, conta_destino_id: String(val) })}
                  options={[{
                    label: 'Conta Financeira Destino',
                    options: [
                      { id: '', label: 'Selecione...' },
                      ...contas.map(c => ({ id: String(c.id), label: `${c.nome} ${c.banco ? `(${c.banco})` : ''}` }))
                    ]
                  }]}
                />
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 p-3 rounded-xl border border-amber-100 dark:border-amber-900/50 flex gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-[10px] leading-relaxed">
                  Isso irá liquidar todos os {selectedSugestao.lancamentos.length} recebíveis vinculados no financeiro como <b>PAGO</b> e gerar automaticamente uma despesa de taxas adquirentes de <b>{BRL.format(selectedSugestao.valor_taxa)}</b> contra a conta bancária selecionada.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6 border-t border-slate-100 dark:border-slate-800 pt-4">
              <button onClick={() => setShowConfirmModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition">Cancelar</button>
              <button
                onClick={confirmData.conta_destino_id ? handleConfirmConciliacao : undefined}
                disabled={saving || !confirmData.conta_destino_id}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} Confirmar Baixa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT/VIEW RECEBIVEL DRAWER */}
      {showEditRecebivelDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowEditRecebivelDrawer(false)}></div>
          <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-800">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white text-lg flex items-center gap-2">
                  <Coins className="w-5 h-5 text-blue-500" />
                  Detalhes do Recebível
                </h3>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-0.5">Visualização e edição do lançamento financeiro</p>
              </div>
              <button onClick={() => setShowEditRecebivelDrawer(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRecebivel} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-xs">

              {/* STATUS & IDENTIFIERS */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</label>
                  <SearchableSelect
                    value={recebivelForm.status}
                    onChange={val => handleRecebivelFormChange({ status: String(val) as any })}
                    options={[{
                      label: 'Status',
                      options: [
                        { id: 'A RECEBER', label: 'A RECEBER' },
                        { id: 'PAGO', label: 'PAGO' }
                      ]
                    }]}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cód. Autorização / RV</label>
                  <input
                    type="text"
                    value={recebivelForm.rv}
                    onChange={e => handleRecebivelFormChange({ rv: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="RV-XXXXXX"
                  />
                </div>
              </div>

              {/* DESCRIPTION */}
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  value={recebivelForm.descricao}
                  onChange={e => handleRecebivelFormChange({ descricao: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>

              {/* DATES */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data da Venda</label>
                  <input
                    type="date"
                    required
                    value={recebivelForm.data_venda}
                    onChange={e => handleRecebivelFormChange({ data_venda: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Data Prev. Recebimento</label>
                  <input
                    type="date"
                    required
                    value={recebivelForm.data_vencimento}
                    onChange={e => handleRecebivelFormChange({ data_vencimento: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* BRAND & PAYMENT TYPE */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bandeira</label>
                  <SearchableSelect
                    value={recebivelForm.bandeira}
                    onChange={val => handleRecebivelFormChange({ bandeira: String(val) })}
                    options={[{
                      label: 'Bandeira',
                      options: [
                        { id: 'VISA', label: 'VISA' },
                        { id: 'MASTERCARD', label: 'MASTERCARD' },
                        { id: 'ELO', label: 'ELO' },
                        { id: 'AMEX', label: 'AMEX' },
                        { id: 'HIPERCARD', label: 'HIPERCARD' },
                        { id: 'IFOOD', label: 'IFOOD' },
                        { id: 'OUTROS', label: 'OUTROS' }
                      ]
                    }]}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Forma de Pagamento</label>
                  <SearchableSelect
                    value={recebivelForm.tipo_pagamento}
                    onChange={val => handleRecebivelFormChange({ tipo_pagamento: String(val) })}
                    options={[{
                      label: 'Forma de Pagamento',
                      options: [
                        { id: 'cartao_credito_vista', label: 'Crédito à Vista' },
                        { id: 'cartao_credito_parcelado', label: 'Crédito Parcelado' },
                        { id: 'cartao_debito', label: 'Débito' }
                      ]
                    }]}
                  />
                </div>
              </div>

              {/* CLIENT & SELLER */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cliente</label>
                  <SearchableSelect
                    value={recebivelForm.entidade_id}
                    onChange={val => handleRecebivelFormChange({ entidade_id: String(val) })}
                    options={[{
                      label: 'Cliente',
                      options: [
                        { id: '', label: 'Cliente Final (Nenhum)' },
                        ...entidades.map(ent => ({ id: String(ent.id), label: ent.nome || ent.nome_fantasia || '' }))
                      ]
                    }]}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Vendedor (Criador)</label>
                  <SearchableSelect
                    value={recebivelForm.vendedor_id}
                    onChange={() => { }}
                    options={[{
                      label: 'Vendedor',
                      options: [
                        { id: '', label: 'Sem vendedor' },
                        ...vendedores.map(v => ({ id: String(v.id), label: v.nome || v.email || '' }))
                      ]
                    }]}
                  />
                </div>
              </div>

              {/* FINANCIAL BREAKDOWN */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Conta Financeira Destino</label>
                  <SearchableSelect
                    value={recebivelForm.conta_id}
                    onChange={val => handleRecebivelFormChange({ conta_id: String(val) })}
                    options={[{
                      label: 'Conta Financeira Destino',
                      options: [
                        { id: '', label: 'Selecione...' },
                        ...contas.map(c => ({ id: String(c.id), label: c.nome }))
                      ]
                    }]}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Categoria de Receita</label>
                  <SearchableSelect
                    value={recebivelForm.plano_contas_id}
                    onChange={val => handleRecebivelFormChange({ plano_contas_id: String(val) })}
                    options={[{
                      label: 'Categoria de Receita',
                      options: [
                        { id: '', label: 'Selecione...' },
                        ...categoriasReceita.map(cat => ({ id: String(cat.id), label: `${cat.codigo} - ${cat.nome}` }))
                      ]
                    }]}
                  />
                </div>
              </div>

              {/* VALUES (GROSS, TAX%, TAX VAL, NET) */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Detalhamento Financeiro</span>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Valor Bruto</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={recebivelForm.valor_bruto}
                      onChange={e => handleRecebivelFormChange({ valor_bruto: Number(e.target.value) })}
                      className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Taxa (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={recebivelForm.cartao_taxa}
                      onChange={e => handleRecebivelFormChange({ cartao_taxa: Number(e.target.value) })}
                      className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Desconto Taxa (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={recebivelForm.cartao_taxa_valor}
                      onChange={e => handleRecebivelFormChange({ cartao_taxa_valor: Number(e.target.value) })}
                      className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-3 mt-1">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Valor Líquido Previsto:</span>
                  <div className="bg-emerald-100 dark:bg-emerald-950/30 border border-emerald-250 dark:border-emerald-900 px-3 py-1.5 rounded-xl">
                    <span className="font-mono font-black text-emerald-600 dark:text-emerald-450 text-base">{BRL.format(recebivelForm.valor_liquido)}</span>
                  </div>
                </div>
              </div>

              {/* ITEMS LIST (ITENS DA VENDA) */}
              <div className="space-y-3">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Itens da Venda (PDV)</span>
                {recebivelForm.itens.length === 0 ? (
                  <div className="p-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 bg-slate-50/50 dark:bg-slate-900/50">
                    Nenhum item itemizado cadastrado para este recebível.
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/40 text-[9px] font-bold text-slate-400 uppercase border-b border-slate-200 dark:border-slate-800">
                          <th className="p-2.5">Produto/Serviço</th>
                          <th className="p-2.5 text-center">Qtd</th>
                          <th className="p-2.5 text-right font-mono">Preço</th>
                          <th className="p-2.5 text-right font-mono">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
                        {recebivelForm.itens.map((it: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/35 dark:hover:bg-slate-850/20 text-slate-700 dark:text-slate-350">
                            <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{it.nome}</td>
                            <td className="p-2.5 text-center font-bold">{it.quantidade}</td>
                            <td className="p-2.5 text-right font-mono">{BRL.format(it.preco_unitario)}</td>
                            <td className="p-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">{BRL.format(it.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </form>

            {/* DRAWER FOOTER */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={handleDeleteRecebivel}
                disabled={saving}
                className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 dark:hover:bg-rose-950/20 text-rose-600 dark:text-rose-400 font-bold rounded-xl flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Excluir
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditRecebivelDrawer(false)}
                  className="px-5 py-2.5 rounded-xl text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveRecebivel}
                  disabled={saving}
                  className="px-7 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Check className="w-4 h-4" />}
                  Salvar
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ORIGIN DRAWERS - ROTEAMENTO DE ORIGEM BASEADO EM BANCO REAL */}
      <MovimentacaoPDVDrawer
        isOpen={activeOriginDrawer === 'pdv_movimentacao'}
        onClose={handleOriginDrawerClose}
        onSuccess={handleOriginDrawerSuccess}
        movimentacaoId={selectedOriginId}
      />

      <IfoodTransactionDrawer
        isOpen={activeOriginDrawer === 'pdv_ifood_lancamento'}
        onClose={handleOriginDrawerClose}
        onSuccess={handleOriginDrawerSuccess}
        transactionId={selectedOriginId}
      />

      <PdvVendaDrawer
        isOpen={activeOriginDrawer === 'pdv_venda'}
        onClose={handleOriginDrawerClose}
        onSuccess={handleOriginDrawerSuccess}
        vendaUuid={typeof selectedOriginId === 'string' && selectedOriginId.includes('-') ? selectedOriginId : undefined}
        vendaId={typeof selectedOriginId === 'number' || (typeof selectedOriginId === 'string' && !selectedOriginId.includes('-')) ? selectedOriginId : undefined}
      />

      {/* SIMULADOR DE ANTECIPAÇÃO MODAL */}
      {showAntecipacaoModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl max-w-xl w-full space-y-6 relative">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold shrink-0">
                  <Zap className="w-5 h-5 fill-amber-500/30" />
                </div>
                <div>
                  <h3 className="font-black text-slate-950 dark:text-white text-base">Simulador de Antecipação de Cartão</h3>
                  <p className="text-xs text-slate-400 font-medium">Calcule o custo e o valor líquido ao antecipar recebíveis de crédito futuros</p>
                </div>
              </div>
              <button
                onClick={() => setShowAntecipacaoModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              // Compute available future credit launches filtered by period if selected
              const sourceList = (modalRecebiveis && modalRecebiveis.length > 0) ? modalRecebiveis : recebiveis;
              const credFuturos = sourceList.filter(r => {
                if (r.tipo_pagamento === 'cartao_debito' || r.status === 'PAGO' || r.status === 'ANTECIPADO') return false;
                if (antecipacaoDataInicio && (r.data_vencimento || r.data_venda) < antecipacaoDataInicio) return false;
                if (antecipacaoDataFim && (r.data_vencimento || r.data_venda) > antecipacaoDataFim) return false;
                return true;
              });
              const totalBrutoFuturo = credFuturos.reduce((acc, curr) => acc + Number(curr.valor_bruto || 0), 0);
              const totalLiquidoOriginal = credFuturos.reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);

              // Calculation based on selected rate % a.m.
              const taxaDecimal = (antecipacaoTaxaPct || 0) / 100;
              const proporcionalMeses = (antecipacaoDias || 30) / 30;
              const despesaAntecipacao = totalBrutoFuturo * taxaDecimal * proporcionalMeses;
              const valorLiquidoHoje = Math.max(0, totalBrutoFuturo - despesaAntecipacao);

              return (
                <div className="space-y-5">
                  {/* Período de Recebíveis Filter */}
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 space-y-2">
                    <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300">
                      Período dos Recebíveis (Filtrar Datas de Vencimento)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">De</span>
                        <input
                          type="date"
                          value={antecipacaoDataInicio}
                          onChange={(e) => setAntecipacaoDataInicio(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Até</span>
                        <input
                          type="date"
                          value={antecipacaoDataFim}
                          onChange={(e) => setAntecipacaoDataFim(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    {(antecipacaoDataInicio || antecipacaoDataFim) && (
                      <button
                        type="button"
                        onClick={() => { setAntecipacaoDataInicio(''); setAntecipacaoDataFim(''); }}
                        className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline pt-1 block"
                      >
                        Limpar Filtro de Período (Considerar Todos os Futuros)
                      </button>
                    )}
                  </div>

                  {/* Input Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                        Taxa de Antecipação (% a.m.)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="15"
                          value={antecipacaoTaxaPct}
                          onChange={(e) => setAntecipacaoTaxaPct(Number(e.target.value))}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 dark:text-white pr-8 focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">%</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 dark:text-slate-300 mb-1">
                        Prazo Médio de Antecipação
                      </label>
                      <SearchableSelect
                        value={String(antecipacaoDias)}
                        onChange={(val) => setAntecipacaoDias(Number(val))}
                        options={[{
                          label: 'Prazo Médio de Antecipação',
                          options: [
                            { id: '15', label: '15 dias de antecedência' },
                            { id: '30', label: '30 dias de antecedência (1 mês)' },
                            { id: '60', label: '60 dias de antecedência (2 meses)' },
                            { id: '90', label: '90 dias de antecedência (3 meses)' }
                          ]
                        }]}
                      />
                    </div>
                  </div>

                  {/* Results Cards */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center bg-slate-100 dark:bg-slate-800 p-3.5 rounded-xl text-xs font-semibold">
                      <span className="text-slate-500 dark:text-slate-400">Total de Crédito Futuro a Receber:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-white">{BRL.format(totalBrutoFuturo)} ({credFuturos.length} lote/s)</span>
                    </div>

                    <div className="flex justify-between items-center bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 p-3.5 rounded-xl text-xs font-semibold">
                      <span className="text-rose-600 dark:text-rose-400 font-bold">(-) Custo Desconto de Antecipação ({antecipacaoTaxaPct}%):</span>
                      <span className="font-mono font-black text-rose-600 dark:text-rose-400">- {BRL.format(despesaAntecipacao)}</span>
                    </div>

                    <div className="flex justify-between items-center bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl">
                      <div>
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block">(=) Valor Líquido Entrando Hoje na Conta</span>
                        <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1 block">{BRL.format(valorLiquidoHoje)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">Diferença vs Líquido Sem Antecipar:</span>
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono">-{BRL.format(totalLiquidoOriginal - valorLiquidoHoje)}</span>
                      </div>
                    </div>
                  </div>

                  {/* EFETIVAÇÃO DE ANTECIPAÇÃO SECTION */}
                  <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-amber-700 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-4 h-4" /> Efetivar e Baixar no Sistema
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Conta Bancária Destino
                        </label>
                        <SearchableSelect
                          value={antecipacaoContaId || (contas.length > 0 ? String(contas[0].id) : '')}
                          onChange={(val) => setAntecipacaoContaId(String(val))}
                          options={[{
                            label: 'Conta Bancária Destino',
                            options: contas.map(c => ({ id: String(c.id), label: c.nome }))
                          }]}
                        />
                      </div>

                      <div className="flex items-center pt-4">
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={antecipacaoLancarFinanceiro}
                            onChange={(e) => setAntecipacaoLancarFinanceiro(e.target.checked)}
                            className="rounded text-amber-500 focus:ring-amber-500 h-4 w-4"
                          />
                          Gerar depósito líquido no Financeiro
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center gap-3 pt-2">
                    <button
                      onClick={() => setShowAntecipacaoModal(false)}
                      className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      Fechar
                    </button>

                    <button
                      disabled={antecipandoEfetivo || credFuturos.length === 0}
                      onClick={() => void handleEfetivarAntecipacao(credFuturos, valorLiquidoHoje, despesaAntecipacao)}
                      className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs transition shadow-md disabled:opacity-50 flex items-center gap-2"
                    >
                      <Zap className="w-4 h-4 fill-slate-950/20" />
                      {antecipandoEfetivo ? 'Efetivando...' : 'Efetivar Antecipação e Quitar Recebíveis'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

