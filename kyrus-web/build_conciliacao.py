import re

file_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes_old.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

# Find the start of the return block
return_idx = text.find('  return (\n    <div className="flex flex-col h-full bg-slate-50')
if return_idx == -1:
    print("Could not find return block!")
    exit(1)

ui_block = text[return_idx:]

new_component = """import React, { useEffect, useState, useRef, useMemo } from 'react';
import { api } from '../services/api';
import {
  CreditCard, Calendar, Filter, Search, ChevronLeft, ChevronRight, X, Loader2, Plus, 
  ArrowRight, CheckCircle2, AlertCircle, Edit2, CheckSquare, Settings2, Trash2, 
  Wallet, RefreshCw, Check, Percent, Sparkles, Building2, TrendingUp, HelpCircle
} from 'lucide-react';
import BrandAvatar, { inferCardBrand } from '../components/BrandAvatar';
import type { Recebivel, DepositoExtrato, RegraCartao, Conta, PlanoContas, SugestaoConciliacao } from './ConciliacaoCartoes/types';
import { formatSafeDate, parseSafeDate } from './ConciliacaoCartoes/types';

import { useAgendaCartoes } from './ConciliacaoCartoes/hooks/useAgendaCartoes';
import { useConciliacaoCartoes } from './ConciliacaoCartoes/hooks/useConciliacaoCartoes';
import { useRegrasCartoes } from './ConciliacaoCartoes/hooks/useRegrasCartoes';
import { useConciliacaoWebSocket } from './ConciliacaoCartoes/hooks/useConciliacaoWebSocket';

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

  const handleOpenEditRecebivel = (item: any) => {
    // We will keep the original implementation here if needed
    // Actually, in the UI block it calls handleOpenEditRecebivel
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
    handlePrevMonth, handleNextMonth, loading: agendaLoading, syncing: agendaSyncing
  } = agenda;

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

""" + ui_block + "\n"

out_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/ConciliacaoCartoes.tsx"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(new_component)

print(f"Written updated ConciliacaoCartoes.tsx ({len(new_component.splitlines())} lines)")
