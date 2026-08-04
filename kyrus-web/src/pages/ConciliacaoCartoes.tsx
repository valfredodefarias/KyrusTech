import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api, normalizeListResponse } from '../services/api';
import { BrandAvatar, inferCardBrand } from '../components/BrandAvatar';
import {
  Plus, Edit2, Trash2, X, Check, Loader2,
  CheckCircle2, Calendar,
  DollarSign, AlertCircle, ArrowRight, Search, Filter,
  Sparkles, TrendingUp, Percent, CheckSquare, Coins, Zap
} from 'lucide-react';

// --- HELPERS ---
const parseSafeDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  if (dateStr.includes('T') || dateStr.includes(' ')) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dateObj = new Date(y, m, d);
    if (!isNaN(dateObj.getTime())) return dateObj;
  }
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? null : fallback;
};

const formatSafeDate = (dateStr: string | null | undefined, options?: Intl.DateTimeFormatOptions): string => {
  const dObj = parseSafeDate(dateStr);
  if (!dObj) return '--/--/----';
  try {
    return dObj.toLocaleDateString('pt-BR', options);
  } catch (e) {
    return '--/--/----';
  }
};

// --- INTERFACES ---
interface RegraCartao {
  data_inicio?: string | null;
  id: number;
  tipo_pagamento: string;
  bandeira: string;
  taxa_porcentagem: number;
  taxa_antecipacao: number;
  dias_payout: number;
  tipo_prazo: 'DIAS_CORRIDOS' | 'DIAS_UTEIS' | 'DIA_FIXO';
  dia_fixo?: number | null;
  modo_parcelamento: 'PRO_RATA' | 'ANTECIPADO';
  fds_proximo_dia_util: boolean;
  conta_destino_id: number;
  plano_contas_taxa_id: number;
  empresa_id: number;
}

interface Recebivel {
  id: number;
  venda_id_uuid: string;
  rv: string;
  data_venda: string;
  data_vencimento: string;
  descricao: string;
  tipo_pagamento: string;
  bandeira: string;
  numero_parcela?: number | null;
  total_parcelas?: number | null;
  valor_bruto: number;
  valor_taxa: number;
  valor_liquido: number;
  status: 'PAGO' | 'A RECEBER' | 'ANTECIPADO';
  vendedor?: string;
  cliente?: string;
  itens?: any[];
}

interface DepositoExtrato {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  origem: string;
  valor_previsto: number;
  valor_pago: number;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia: string;
  conta_id: number;
  plano_contas_id: number;
  conciliado: boolean;
}

interface SugestaoConciliacao {
  tipo: 'GRUPO_DIA_BANDEIRA' | 'AVULSO' | 'COMBINACAO';
  label: string;
  score: number;
  valor_bruto: number;
  valor_taxa: number;
  valor_liquido: number;
  lancamentos: number[];
  detalhes: string;
}

interface Conta {
  id: number;
  nome: string;
  tipo: string;
  banco?: string | null;
}

interface PlanoContas {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  eh_cabecalho: boolean;
  permite_lancamentos?: boolean | null;
}

export function ConciliacaoCartoes() {
  const [activeTab, setActiveTab] = useState<'agenda' | 'conciliacao' | 'regras'>('agenda');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Calendar view states
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});

  // FASE 2: States & Shortcuts
  const [modalityFilter, setModalityFilter] = useState<'ALL' | 'DEBITO' | 'CREDITO'>('ALL');
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard Shortcuts Hook
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setCurrentMonth(new Date());
        const y = new Date().getFullYear();
        const m = String(new Date().getMonth() + 1).padStart(2, '0');
        const d = String(new Date().getDate()).padStart(2, '0');
        setSelectedDay(`${y}-${m}-${d}`);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
      } else if (e.key === 'Escape') {
        setSelectedDay(null);
        setShowAntecipacaoModal(false);
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Antecipação Simulator State
  const [showAntecipacaoModal, setShowAntecipacaoModal] = useState(false);
  const [antecipacaoTaxaPct, setAntecipacaoTaxaPct] = useState<number>(2.5);
  const [antecipacaoDias, setAntecipacaoDias] = useState<number>(30);
  const [antecipacaoLancarFinanceiro, setAntecipacaoLancarFinanceiro] = useState<boolean>(true);
  const [antecipacaoContaId, setAntecipacaoContaId] = useState<string>('');
  const [antecipandoEfetivo, setAntecipandoEfetivo] = useState<boolean>(false);
  const [antecipacaoDataInicio, setAntecipacaoDataInicio] = useState<string>('');
  const [antecipacaoDataFim, setAntecipacaoDataFim] = useState<string>('');
  const [modalRecebiveis, setModalRecebiveis] = useState<Recebivel[]>([]);
  const [loadingModalRecebiveis, setLoadingModalRecebiveis] = useState<boolean>(false);

  useEffect(() => {
    if (showAntecipacaoModal) {
      const fetchModalItems = async () => {
        setLoadingModalRecebiveis(true);
        try {
          const params: Record<string, string> = {};
          if (antecipacaoDataInicio) params.start_date = antecipacaoDataInicio;
          if (antecipacaoDataFim) params.end_date = antecipacaoDataFim;
          const res = await api.get('/pdv/recebiveis', { params });
          setModalRecebiveis(normalizeListResponse<Recebivel>(res.data));
        } catch (e) {
          console.error('Erro ao carregar recebíveis para antecipação:', e);
        } finally {
          setLoadingModalRecebiveis(false);
        }
      };
      void fetchModalItems();
    }
  }, [showAntecipacaoModal, antecipacaoDataInicio, antecipacaoDataFim]);

  // Lists from DB
  const [regras, setRegras] = useState<RegraCartao[]>([]);
  const [recebiveis, setRecebiveis] = useState<Recebivel[]>([]);
  const [depositos, setDepositos] = useState<DepositoExtrato[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [categoriasDespesa, setCategoriasDespesa] = useState<PlanoContas[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [categoriasReceita, setCategoriasReceita] = useState<PlanoContas[]>([]);

  // Selection & Actions
  const [selectedDeposito, setSelectedDeposito] = useState<DepositoExtrato | null>(null);
  const [sugestoes, setSugestoes] = useState<SugestaoConciliacao[]>([]);
  const [loadingSugestoes, setLoadingSugestoes] = useState(false);

  // Ref for auto-scroll
  const detailsRef = useRef<HTMLDivElement>(null);

  // Drawer / Form state for edit/view Recebivel
  const [showEditRecebivelDrawer, setShowEditRecebivelDrawer] = useState(false);
  const [recebivelForm, setRecebivelForm] = useState({
    id: null as number | null,
    descricao: '',
    rv: '',
    data_venda: '',
    data_vencimento: '',
    bandeira: 'VISA',
    tipo_pagamento: 'cartao_credito_vista',
    entidade_id: '' as string | number,
    vendedor_id: '' as string | number,
    conta_id: '' as string | number,
    plano_contas_id: '' as string | number,
    valor_bruto: 0,
    cartao_taxa: 0,
    cartao_taxa_valor: 0,
    valor_liquido: 0,
    status: 'A RECEBER' as 'PAGO' | 'A RECEBER' | 'ANTECIPADO',
    itens: [] as any[]
  });

  // Drawer / Form state for Regras
  const [showRegraDrawer, setShowRegraDrawer] = useState(false);
  const [isEditingRegra, setIsEditingRegra] = useState(false);
  const [drawerSubTab, setDrawerSubTab] = useState<'debito' | 'credito_vista' | 'credito_parcelado'>('debito');

  interface ModalityFormState {
    active: boolean;
    id: number | null;
    taxa_porcentagem: number;
    taxa_antecipacao: number;
    dias_payout: number;
    tipo_prazo: 'DIAS_CORRIDOS' | 'DIAS_UTEIS' | 'DIA_FIXO';
    dia_fixo: string | number;
    modo_parcelamento: 'PRO_RATA' | 'ANTECIPADO';
    fds_proximo_dia_util: boolean;
  }

  const initialModalityState = (tipo: string): ModalityFormState => ({
    active: false,
    id: null,
    taxa_porcentagem: 0,
    taxa_antecipacao: 0,
    dias_payout: tipo === 'cartao_debito' ? 1 : 30,
    tipo_prazo: 'DIAS_CORRIDOS',
    dia_fixo: '',
    modo_parcelamento: 'PRO_RATA',
    fds_proximo_dia_util: true,
  });

  const [groupedRegraForm, setGroupedRegraForm] = useState({
    bandeira: 'VISA',
    data_inicio: '',
    original_data_inicio: '',
    conta_destino_id: '',
    plano_contas_taxa_id: '',
    debito: initialModalityState('cartao_debito'),
    credito_vista: initialModalityState('cartao_credito_vista'),
    credito_parcelado: initialModalityState('cartao_credito_parcelado'),
  });

  // Compatibility aliases: the legacy drawer UI references regraForm / setRegraForm.
  // Map them to the active modality sub-form of groupedRegraForm.
  const modalityKeyMap: Record<string, 'debito' | 'credito_vista' | 'credito_parcelado'> = {
    cartao_debito: 'debito',
    cartao_credito_vista: 'credito_vista',
    cartao_credito_parcelado: 'credito_parcelado',
  };

  const activeModalityKey = drawerSubTab;
  const activeModality = groupedRegraForm[activeModalityKey];

  const tipoPagMap: Record<string, string> = {
    debito: 'cartao_debito',
    credito_vista: 'cartao_credito_vista',
    credito_parcelado: 'cartao_credito_parcelado',
  };

  const regraForm = {
    tipo_pagamento: tipoPagMap[activeModalityKey] || 'cartao_credito_vista',
    bandeira: groupedRegraForm.bandeira,
    taxa_porcentagem: activeModality.taxa_porcentagem,
    taxa_antecipacao: activeModality.taxa_antecipacao,
    dias_payout: activeModality.dias_payout,
    tipo_prazo: activeModality.tipo_prazo,
    dia_fixo: activeModality.dia_fixo,
    modo_parcelamento: activeModality.modo_parcelamento,
    fds_proximo_dia_util: activeModality.fds_proximo_dia_util,
    conta_destino_id: groupedRegraForm.conta_destino_id,
    plano_contas_taxa_id: groupedRegraForm.plano_contas_taxa_id,
  };

  const setRegraForm = (updates: Partial<typeof regraForm>) => {
    setGroupedRegraForm(prev => {
      const next = { ...prev };
      if ('bandeira' in updates) next.bandeira = updates.bandeira!;
      if ('conta_destino_id' in updates) next.conta_destino_id = String(updates.conta_destino_id ?? '');
      if ('plano_contas_taxa_id' in updates) next.plano_contas_taxa_id = String(updates.plano_contas_taxa_id ?? '');

      // If tipo_pagamento changed, switch the active drawer sub-tab
      if ('tipo_pagamento' in updates) {
        const newKey = modalityKeyMap[updates.tipo_pagamento!];
        if (newKey) setDrawerSubTab(newKey);
      }

      // Update the active modality fields
      const modKey = activeModalityKey;
      const mod = { ...next[modKey], active: true };
      if ('taxa_porcentagem' in updates) mod.taxa_porcentagem = Number(updates.taxa_porcentagem);
      if ('taxa_antecipacao' in updates) mod.taxa_antecipacao = Number(updates.taxa_antecipacao);
      if ('dias_payout' in updates) mod.dias_payout = Number(updates.dias_payout);
      if ('tipo_prazo' in updates) mod.tipo_prazo = updates.tipo_prazo as any;
      if ('dia_fixo' in updates) mod.dia_fixo = updates.dia_fixo as any;
      if ('modo_parcelamento' in updates) mod.modo_parcelamento = updates.modo_parcelamento as any;
      if ('fds_proximo_dia_util' in updates) mod.fds_proximo_dia_util = Boolean(updates.fds_proximo_dia_util);
      next[modKey] = mod;

      return next;
    });
  };

  // Manual Selection & Anticipation tab states
  const [rightPanelTab, setRightPanelTab] = useState<'sugestoes' | 'manual'>('sugestoes');
  const [manualFilterBrand, setManualFilterBrand] = useState('');
  const [manualSearch, setManualSearch] = useState('');
  const [selectedManualIds, setSelectedManualIds] = useState<number[]>([]);
  const [anticipationRate, setAnticipationRate] = useState<number>(0);
  const [manualReconcileDate, setManualReconcileDate] = useState('');
  const [manualReconcileContaId, setManualReconcileContaId] = useState('');

  // Pre-select manual filter brand and reconcile parameters when a deposit is selected
  useEffect(() => {
    if (selectedDeposito) {
      setManualReconcileDate(selectedDeposito.data_pagamento || selectedDeposito.data_vencimento || new Date().toISOString().split('T')[0]);
      setManualReconcileContaId(String(selectedDeposito.conta_id));

      const brand = inferCardBrand(selectedDeposito.descricao);
      const knownBrands = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'PIX'];
      const inferred = brand.key.toUpperCase();
      if (knownBrands.includes(inferred)) {
        setManualFilterBrand(inferred);
      } else {
        setManualFilterBrand('');
      }
    } else {
      setManualReconcileDate('');
      setManualReconcileContaId('');
      setManualFilterBrand('');
    }
    setSelectedManualIds([]);
    setAnticipationRate(0);
  }, [selectedDeposito]);

  // Modal confirm conciliacao
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedSugestao, setSelectedSugestao] = useState<SugestaoConciliacao | null>(null);
  const [confirmData, setConfirmData] = useState({
    data_pagamento: '',
    conta_destino_id: ''
  });

  // Filters for Agenda
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOfWeek = firstDay.getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean }> = [];
    const prevTotalDays = new Date(year, month, 0).getDate();

    for (let i = startOfWeek - 1; i >= 0; i--) {
      const d = prevTotalDays - i;
      const prevDate = new Date(year, month - 1, d);
      days.push({
        dateStr: prevDate.toISOString().split('T')[0],
        dayNum: d,
        isCurrentMonth: false
      });
    }

    for (let d = 1; d <= totalDays; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true
      });
    }

    const totalSlots = 42;
    const nextPadding = totalSlots - days.length;
    for (let d = 1; d <= nextPadding; d++) {
      const nextDate = new Date(year, month + 1, d);
      days.push({
        dateStr: nextDate.toISOString().split('T')[0],
        dayNum: d,
        isCurrentMonth: false
      });
    }
    return days;
  }, [currentMonth]);

  const handlePrevMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Load Data
  const loadData = async () => {
    setLoading(true);
    try {
      const [resRegras, resContas, resPlano, resEntidades, resVendedores] = await Promise.all([
        api.get('/pdv/regras-cartao'),
        api.get('/contas/', { params: { include_saldo: false } }),
        api.get('/plano-contas/'),
        api.get('/entidades/lookup'),
        api.get('/usuarios/vendedores')
      ]);

      setRegras(normalizeListResponse<RegraCartao>(resRegras.data));

      const loadedContas = normalizeListResponse<Conta>(resContas.data);
      setContas(loadedContas);

      const normalizedPlano = normalizeListResponse<PlanoContas>(resPlano.data);
      const despesas = normalizedPlano
        .filter(item => String(item.tipo || '').toUpperCase().startsWith('D'))
        .filter(item => item.eh_cabecalho !== true && item.permite_lancamentos !== false)
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
      setCategoriasDespesa(despesas);

      const receitas = normalizedPlano
        .filter(item => String(item.tipo || '').toUpperCase().startsWith('R') || String(item.tipo || '').toUpperCase() === 'RECEITA')
        .filter(item => item.eh_cabecalho !== true && item.permite_lancamentos !== false)
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
      setCategoriasReceita(receitas);

      setEntidades(normalizeListResponse<any>(resEntidades.data));
      setVendedores(normalizeListResponse<any>(resVendedores.data));

      // Default first account in rule forms if empty
      if (loadedContas.length > 0) {
        setGroupedRegraForm(prev => ({
          ...prev,
          conta_destino_id: prev.conta_destino_id || String(loadedContas[0].id)
        }));
      }
      if (despesas.length > 0) {
        setGroupedRegraForm(prev => ({
          ...prev,
          plano_contas_taxa_id: prev.plano_contas_taxa_id || String(despesas[0].id)
        }));
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMonthRange = (date: Date) => {
    const y = date.getFullYear();
    const m = date.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const format = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    return { start: format(firstDay), end: format(lastDay) };
  };

  const [syncing, setSyncing] = useState(false);

  const fetchAgenda = async () => {
    if (recebiveis.length === 0) {
      setLoading(true);
    } else {
      setSyncing(true);
    }
    try {
      const params: Record<string, string> = {};
      
      // No modo calendário, forçamos a busca de todo o mês selecionado
      if (viewMode === 'calendar') {
        const range = getMonthRange(currentMonth);
        params.start_date = range.start;
        params.end_date = range.end;
      } else {
        if (startDate) params.start_date = startDate;
        if (endDate) params.end_date = endDate;
      }

      const res = await api.get('/pdv/recebiveis', { params });
      setRecebiveis(normalizeListResponse<Recebivel>(res.data));
    } catch (e) {
      console.error('Erro ao carregar recebíveis:', e);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  const fetchDepositos = async () => {
    if (depositos.length === 0) {
      setLoading(true);
    } else {
      setSyncing(true);
    }
    try {
      const res = await api.get('/lancamentos/', {
        params: {
          tipo: 'RECEITA',
          origem: 'EXTRATO,OFX_EXTRATO',
          conciliado: false,
          sem_paginacao: true
        }
      });
      setDepositos(normalizeListResponse<DepositoExtrato>(res.data));
    } catch (e) {
      console.error('Erro ao carregar depósitos:', e);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  // Load static resources once on mount
  useEffect(() => {
    void loadData();
  }, []);

  // Fetch agenda dynamically based on activeTab, month, and date filters
  useEffect(() => {
    if (activeTab === 'agenda') {
      void fetchAgenda();
    }
  }, [activeTab, currentMonth, startDate, endDate, viewMode]);

  // Fetch non-reconciled deposits when on conciliacao tab
  useEffect(() => {
    if (activeTab === 'conciliacao') {
      void fetchDepositos();
    }
  }, [activeTab]);

  // Auto-scroll to details panel when selectedDay changes
  useEffect(() => {
    setExpandedBrands({});
    if (selectedDay) {
      setTimeout(() => {
        detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [selectedDay]);

  const handleOpenEditRecebivel = (item: any) => {
    // Calculate fee percentage if not explicitly present
    const bruto = Number(item.valor_bruto || 0);
    const taxaValor = Number(item.valor_taxa || 0);

    setRecebivelForm({
      id: item.id,
      descricao: item.descricao || '',
      rv: item.rv || '',
      data_venda: item.data_venda || '',
      data_vencimento: item.data_vencimento || '',
      bandeira: item.bandeira || 'OUTROS',
      tipo_pagamento: item.tipo_pagamento || 'cartao_credito_vista',
      entidade_id: item.cliente_id !== null && item.cliente_id !== undefined ? String(item.cliente_id) : '',
      vendedor_id: item.vendedor_id !== null && item.vendedor_id !== undefined ? String(item.vendedor_id) : '',
      conta_id: item.conta_id !== null && item.conta_id !== undefined ? String(item.conta_id) : '',
      plano_contas_id: item.plano_contas_id !== null && item.plano_contas_id !== undefined ? String(item.plano_contas_id) : '',
      valor_bruto: bruto,
      cartao_taxa: bruto ? Number(((taxaValor / bruto) * 100).toFixed(2)) : 0,
      cartao_taxa_valor: taxaValor,
      valor_liquido: Number(item.valor_liquido || 0),
      status: item.status || 'A RECEBER',
      itens: item.itens || []
    });
    setShowEditRecebivelDrawer(true);
  };

  const handleRecebivelFormChange = (updates: Partial<typeof recebivelForm>) => {
    setRecebivelForm(prev => {
      const next = { ...prev, ...updates };

      if ('valor_bruto' in updates || 'cartao_taxa' in updates) {
        const bruto = Number(next.valor_bruto) || 0;
        const taxaPercent = Number(next.cartao_taxa) || 0;
        const taxaValor = Number(((bruto * taxaPercent) / 100).toFixed(2));
        const liquido = Number((bruto - taxaValor).toFixed(2));
        next.cartao_taxa_valor = taxaValor;
        next.valor_liquido = liquido;
      }
      else if ('cartao_taxa_valor' in updates) {
        const bruto = Number(next.valor_bruto) || 0;
        const taxaValor = Number(updates.cartao_taxa_valor) || 0;
        const liquido = Number((bruto - taxaValor).toFixed(2));
        const taxaPercent = bruto ? Number(((taxaValor / bruto) * 100).toFixed(2)) : 0;
        next.cartao_taxa = taxaPercent;
        next.valor_liquido = liquido;
      }

      return next;
    });
  };

  const handleSaveRecebivel = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Sincroniza bandeira e valor no PDV e recarrega taxa/líquido no financeiro
      await api.put(`/pdv/recebiveis/${recebivelForm.id}`, {
        bandeira: recebivelForm.bandeira,
        valor: Number(recebivelForm.valor_bruto),
        data: recebivelForm.data_venda
      });

      setShowEditRecebivelDrawer(false);
      await fetchAgenda();
      alert('Recebível atualizado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao atualizar recebível:', err);
      const detail = err?.response?.data?.detail || 'Erro ao atualizar recebível.';
      alert(`⚠️ ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRecebivel = async () => {
    if (!recebivelForm.id) return;
    
    let confirmMsg = 'Deseja realmente excluir este recebível?';
    let url = `/lancamentos/${recebivelForm.id}`;
    
    if (recebivelForm.status === 'PAGO') {
      confirmMsg = '⚠️ ATENÇÃO: Este recebível já está marcado como PAGO! A exclusão de lançamentos pagos pode alterar o saldo das suas contas bancárias. Tem certeza de que deseja continuar?';
      url += '?confirmar_exclusao_pagos=true';
    }
    
    if (!confirm(confirmMsg)) return;
    
    setSaving(true);
    try {
      await api.delete(url);
      setShowEditRecebivelDrawer(false);
      await fetchAgenda();
      alert('Recebível excluído com sucesso!');
    } catch (err) {
      console.error('Erro ao excluir recebível:', err);
      alert('Erro ao excluir recebível.');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncFinanceiro = async (dayStr: string) => {
    if (!confirm(`Deseja atualizar os valores financeiros deste dia (${formatSafeDate(dayStr)}) baseados nas sub-vendas?`)) return;
    setSyncing(true);
    try {
      await api.post('/pdv/recebiveis/sync', { data: dayStr });
      setCopyToast('Valores Financeiros Sincronizados com Sucesso!');
      setTimeout(() => setCopyToast(null), 4000);
      await fetchAgenda();
    } catch (err: any) {
      console.error('Erro ao sincronizar financeiro:', err);
      const detail = err?.response?.data?.detail || 'Erro ao sincronizar.';
      alert(`⚠️ ${detail}`);
    } finally {
      setSyncing(false);
    }
  };

  // Load auto-match suggestions when a deposit is selected
  useEffect(() => {
    if (!selectedDeposito) {
      setSugestoes([]);
      return;
    }
    const loadSuggestions = async () => {
      setLoadingSugestoes(true);
      try {
        const res = await api.post(`/pdv/conciliacao/auto-match?lancamento_deposito_id=${selectedDeposito.id}`);
        setSugestoes(normalizeListResponse<SugestaoConciliacao>(res.data));
      } catch (e) {
        console.error('Erro ao carregar sugestões:', e);
        setSugestoes([]);
      } finally {
        setLoadingSugestoes(false);
      }
    };
    void loadSuggestions();
  }, [selectedDeposito]);

  // Grouped Rule Form Actions
  const handleOpenConfigureBrand = (brandName: string) => {
    setGroupedRegraForm({
      bandeira: brandName,
      data_inicio: '',
      original_data_inicio: '',
      conta_destino_id: contas.length > 0 ? String(contas[0].id) : '',
      plano_contas_taxa_id: categoriasDespesa.length > 0 ? String(categoriasDespesa[0].id) : '',
      debito: { ...initialModalityState('cartao_debito'), active: true },
      credito_vista: initialModalityState('cartao_credito_vista'),
      credito_parcelado: initialModalityState('cartao_credito_parcelado'),
    });
    setDrawerSubTab('debito');
    setIsEditingRegra(false);
    setShowRegraDrawer(true);
  };

  const handleOpenCreateRegra = () => {
    handleOpenConfigureBrand('VISA');
  };

  const handleOpenEditGroupedRegra = (g: GroupedBandeira) => {
    const commonRule = g.debito || g.credito_vista || g.credito_parcelado;

    const mapRuleToState = (r?: RegraCartao, defaultTipo?: string): ModalityFormState => {
      if (!r) return { ...initialModalityState(defaultTipo || ''), active: false };
      return {
        active: true,
        id: r.id,
        taxa_porcentagem: Number(r.taxa_porcentagem),
        taxa_antecipacao: Number(r.taxa_antecipacao || 0),
        dias_payout: Number(r.dias_payout || 0),
        tipo_prazo: r.tipo_prazo || 'DIAS_CORRIDOS',
        dia_fixo: r.dia_fixo !== null && r.dia_fixo !== undefined ? String(r.dia_fixo) : '',
        modo_parcelamento: r.modo_parcelamento || 'PRO_RATA',
        fds_proximo_dia_util: r.fds_proximo_dia_util !== false,
      };
    };

    setGroupedRegraForm({
      bandeira: g.bandeira,
      data_inicio: g.data_inicio || '',
      original_data_inicio: g.data_inicio || '',
      conta_destino_id: commonRule ? String(commonRule.conta_destino_id) : (contas.length > 0 ? String(contas[0].id) : ''),
      plano_contas_taxa_id: commonRule ? String(commonRule.plano_contas_taxa_id) : (categoriasDespesa.length > 0 ? String(categoriasDespesa[0].id) : ''),
      debito: mapRuleToState(g.debito, 'cartao_debito'),
      credito_vista: mapRuleToState(g.credito_vista, 'cartao_credito_vista'),
      credito_parcelado: mapRuleToState(g.credito_parcelado, 'cartao_credito_parcelado'),
    });

    // Auto-select first active sub-tab or default to debito
    if (g.debito) setDrawerSubTab('debito');
    else if (g.credito_vista) setDrawerSubTab('credito_vista');
    else if (g.credito_parcelado) setDrawerSubTab('credito_parcelado');
    else setDrawerSubTab('debito');

    setIsEditingRegra(true);
    setShowRegraDrawer(true);
  };

  const handleSaveRegra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupedRegraForm.debito.active && !groupedRegraForm.credito_vista.active && !groupedRegraForm.credito_parcelado.active) {
      alert('Ative pelo menos uma forma de pagamento (Débito, Crédito à Vista ou Crédito Parcelado) para salvar os parâmetros.');
      return;
    }

    setSaving(true);
    try {
      const promises: Promise<any>[] = [];

      const handleModality = (modality: ModalityFormState, tipo: string) => {
        const isNewVersion = Boolean(
          groupedRegraForm.original_data_inicio && 
          groupedRegraForm.data_inicio && 
          groupedRegraForm.data_inicio !== groupedRegraForm.original_data_inicio
        );
        const targetId = isNewVersion ? null : modality.id;
        
        const payload = {
          tipo_pagamento: tipo,
          bandeira: groupedRegraForm.bandeira.toUpperCase(),
          data_inicio: groupedRegraForm.data_inicio || null,
          taxa_porcentagem: Number(modality.taxa_porcentagem),
          taxa_antecipacao: Number(modality.taxa_antecipacao),
          dias_payout: Number(modality.dias_payout),
          tipo_prazo: modality.tipo_prazo,
          dia_fixo: modality.tipo_prazo === 'DIA_FIXO' && modality.dia_fixo !== '' ? Number(modality.dia_fixo) : null,
          modo_parcelamento: modality.modo_parcelamento,
          fds_proximo_dia_util: modality.fds_proximo_dia_util,
          conta_destino_id: Number(groupedRegraForm.conta_destino_id),
          plano_contas_taxa_id: Number(groupedRegraForm.plano_contas_taxa_id)
        };

        if (modality.active) {
          if (targetId) {
            promises.push(api.put(`/pdv/regras-cartao/${targetId}`, payload));
          } else {
            promises.push(api.post('/pdv/regras-cartao', payload));
          }
        } else {
          if (targetId) {
            promises.push(api.delete(`/pdv/regras-cartao/${targetId}`));
          }
        }
      };

      handleModality(groupedRegraForm.debito, 'cartao_debito');
      handleModality(groupedRegraForm.credito_vista, 'cartao_credito_vista');
      handleModality(groupedRegraForm.credito_parcelado, 'cartao_credito_parcelado');

      await Promise.all(promises);
      setShowRegraDrawer(false);
      await loadData();
      alert('Parâmetros da bandeira salvos com sucesso!');
    } catch (err) {
      console.error('Erro ao salvar regras:', err);
      alert('Erro ao salvar parâmetros da bandeira. Verifique as informações.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroupedRegra = async (g: GroupedBandeira) => {
    if (!confirm(`Deseja realmente excluir todos os parâmetros da bandeira ${g.bandeira}?`)) return;
    setSaving(true);
    try {
      const promises: Promise<any>[] = [];
      if (g.debito?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.debito.id}`));
      if (g.credito_vista?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.credito_vista.id}`));
      if (g.credito_parcelado?.id) promises.push(api.delete(`/pdv/regras-cartao/${g.credito_parcelado.id}`));

      await Promise.all(promises);
      await loadData();
      alert('Parâmetros da bandeira excluídos com sucesso!');
    } catch (e) {
      console.error('Erro ao deletar regras:', e);
      alert('Erro ao excluir parâmetros da bandeira.');
    } finally {
      setSaving(false);
    }
  };

  // Reconcile Batch Action
  const handleOpenConfirmConciliacao = (sug: SugestaoConciliacao) => {
    if (!selectedDeposito) return;
    setSelectedSugestao(sug);
    setConfirmData({
      data_pagamento: selectedDeposito.data_pagamento || selectedDeposito.data_vencimento || new Date().toISOString().split('T')[0],
      conta_destino_id: String(selectedDeposito.conta_id)
    });
    setShowConfirmModal(true);
  };

  const handleConfirmConciliacao = async () => {
    if (!selectedDeposito || !selectedSugestao) return;
    setSaving(true);
    try {
      const payload = {
        data_pagamento: confirmData.data_pagamento,
        conta_destino_id: Number(confirmData.conta_destino_id),
        lancamento_deposito_id: selectedDeposito.id,
        lancamento_ids: selectedSugestao.lancamentos
      };

      await api.post('/pdv/conciliacao/lotes', payload);
      setShowConfirmModal(false);
      setSelectedDeposito(null);
      setSelectedSugestao(null);
      await fetchDepositos();
      alert('Lote de cartões conciliado e liquidado com sucesso!');
    } catch (e) {
      console.error('Erro ao conciliar lote:', e);
      alert('Erro ao conciliar lote. Verifique se os dados são válidos.');
    } finally {
      setSaving(false);
    }
  };

  const handleEfetivarAntecipacao = async (credFuturos: Recebivel[], valorLiquido: number, despesaTaxa: number) => {
    if (credFuturos.length === 0) {
      alert('Não há recebíveis futuros de crédito abertos para antecipar.');
      return;
    }

    const contaUsada = contas.find(c => String(c.id) === (antecipacaoContaId || String(contas[0]?.id)));
    const nomeConta = contaUsada ? contaUsada.nome : 'Conta Financeira';

    const confirmMsg = `⚡ CONFIRMAÇÃO DE ANTECIPAÇÃO DE CARTÕES\n\n` +
      `Deseja efetivar a antecipação de ${credFuturos.length} lote(s) de crédito futuro?\n\n` +
      `• Valor Bruto Futuro: ${BRL.format(credFuturos.reduce((a, c) => a + Number(c.valor_bruto || 0), 0))}\n` +
      `• Taxa de Antecipação (${antecipacaoTaxaPct}%): ${BRL.format(despesaTaxa)}\n` +
      `• Valor Líquido: ${BRL.format(valorLiquido)}\n\n` +
      (antecipacaoLancarFinanceiro 
        ? `• O valor de ${BRL.format(valorLiquido)} SERÁ CREDITADO na conta "${nomeConta}".`
        : `• Os recebíveis serão BAIXADOS/QUITADOS no sistema SEM criar novo lançamento no extrato (ideal para antecipação avulsa já depositada).`);

    if (!confirm(confirmMsg)) return;

    setAntecipandoEfetivo(true);
    try {
      // 1. Mark future credit receivables as ANTECIPADO in batches
      const updatePromises = credFuturos.map(r => 
        api.put(`/pdv/recebiveis/${r.id}`, {
          status: 'ANTECIPADO',
          valor_liquido: Number(r.valor_liquido || 0)
        })
      );

      await Promise.all(updatePromises);

      // 2. If launching financial deposit
      if (antecipacaoLancarFinanceiro && (antecipacaoContaId || (contas.length > 0 && contas[0].id))) {
        const targetContaId = Number(antecipacaoContaId || contas[0].id);
        await api.post('/lancamentos/', {
          tipo: 'RECEITA',
          descricao: `Antecipação Avulsa de Cartões (${credFuturos.length} lote/s)`,
          valor: valorLiquido,
          conta_id: targetContaId,
          data_vencimento: new Date().toISOString().split('T')[0],
          data_pagamento: new Date().toISOString().split('T')[0],
          pago: true,
          origem: 'ANTECIPACAO_CARTAO'
        });
      }

      setShowAntecipacaoModal(false);
      await fetchAgenda();
      alert(`⚡ Antecipação de ${credFuturos.length} recebíveis efetuada e baixada com sucesso!`);
    } catch (e) {
      console.error('Erro ao efetivar antecipação:', e);
      alert('Erro ao efetivar antecipação. Verifique os dados e tente novamente.');
    } finally {
      setAntecipandoEfetivo(false);
    }
  };

  // WhatsApp Summary Copy Helper
  const handleCopyWhatsAppSummary = (dayStr: string, dayItems: Recebivel[]) => {
    const formattedDate = formatSafeDate(dayStr, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const bruto = dayItems.reduce((acc, curr) => acc + Number(curr.valor_bruto || 0), 0);
    const taxa = dayItems.reduce((acc, curr) => acc + Number(curr.valor_taxa || 0), 0);
    const liquido = dayItems.reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
    const debito = dayItems.filter(r => r.tipo_pagamento === 'cartao_debito').reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
    const credito = dayItems.filter(r => r.tipo_pagamento !== 'cartao_debito').reduce((acc, curr) => acc + Number(curr.valor_liquido || 0), 0);
    const avgTaxa = bruto > 0 ? (taxa / bruto) * 100 : 0;

    const text = `📊 *RESUMO DE CARTÕES - ${formattedDate.toUpperCase()}*\n` +
                 `--------------------------------------\n` +
                 `💵 *Total Bruto:* ${BRL.format(bruto)}\n` +
                 `📉 *Taxas Estimadas:* ${BRL.format(taxa)} (${avgTaxa.toFixed(2)}%)\n` +
                 `💰 *Líquido a Receber:* ${BRL.format(liquido)}\n` +
                 `--------------------------------------\n` +
                 `• *Débito:* ${BRL.format(debito)}\n` +
                 `• *Crédito:* ${BRL.format(credito)}\n` +
                 `📦 *Total Lotes:* ${dayItems.length} recebível(eis)\n` +
                 `--------------------------------------\n` +
                 `_Gerado via KyrusERP_`;

    navigator.clipboard.writeText(text);
    setCopyToast('Resumo formatado copiado para a área de transferência!');
    setTimeout(() => setCopyToast(null), 3000);
  };

  // Agenda Filters and Calculations
  const filteredAgenda = useMemo(() => {
    return recebiveis.filter(r => {
      const matchSearch = !filterSearch ||
        (r.descricao || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (r.rv || '').toLowerCase().includes(filterSearch.toLowerCase());

      const matchBrand = !filterBrand || (r.bandeira || '') === filterBrand;
      const matchStatus = !filterStatus || (r.status || '') === filterStatus;
      const matchModality = modalityFilter === 'ALL' ||
        (modalityFilter === 'DEBITO' && r.tipo_pagamento === 'cartao_debito') ||
        (modalityFilter === 'CREDITO' && r.tipo_pagamento !== 'cartao_debito');

      let matchDate = true;
      if (r.data_vencimento) {
        if (startDate) {
          matchDate = matchDate && r.data_vencimento >= startDate;
        }
        if (endDate) {
          matchDate = matchDate && r.data_vencimento <= endDate;
        }
      } else if (startDate || endDate) {
        matchDate = false;
      }

      return matchSearch && matchBrand && matchStatus && matchModality && matchDate;
    });
  }, [recebiveis, filterSearch, filterBrand, filterStatus, modalityFilter, startDate, endDate]);

  const calendarFilteredAgenda = useMemo(() => {
    return recebiveis.filter(r => {
      const matchSearch = !filterSearch ||
        (r.descricao || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (r.rv || '').toLowerCase().includes(filterSearch.toLowerCase());

      const matchBrand = !filterBrand || (r.bandeira || '') === filterBrand;
      const matchStatus = !filterStatus || (r.status || '') === filterStatus;

      return matchSearch && matchBrand && matchStatus;
    });
  }, [recebiveis, filterSearch, filterBrand, filterStatus]);

  const agendaSummary = useMemo(() => {
    let bruto = 0;
    let taxa = 0;
    let liquido = 0;
    filteredAgenda.forEach(r => {
      bruto += Number(r.valor_bruto);
      taxa += Number(r.valor_taxa);
      liquido += Number(r.valor_liquido);
    });
    return { bruto, taxa, liquido };
  }, [filteredAgenda]);

  // Group agenda items by date for timeline view
  const agendaGroupedByDate = useMemo(() => {
    const groups: Record<string, Recebivel[]> = {};
    filteredAgenda.forEach(r => {
      const d = r.data_vencimento;
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    });
    // Sort dates descending
    return Object.keys(groups).sort().reverse().map(d => ({
      data: d,
      itens: groups[d],
      bruto: groups[d].reduce((sum, item) => sum + Number(item.valor_bruto), 0),
      liquido: groups[d].reduce((sum, item) => sum + Number(item.valor_liquido), 0)
    }));
  }, [filteredAgenda]);

  // Group rules by brand
  interface GroupedBandeira {
  data_inicio?: string | null;
    bandeira: string;
    debito?: RegraCartao;
    credito_vista?: RegraCartao;
    credito_parcelado?: RegraCartao;
    pix?: RegraCartao;
  }

  const groupedRegras = useMemo(() => {
    const defaultBrands = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'CABAL', 'PIX'];
    const groups: Record<string, GroupedBandeira> = {};
    
    // Initialize groups for default brands
    defaultBrands.forEach(b => {
      groups[b] = { bandeira: b, data_inicio: null };
    });

    // Sort regras by data_inicio descending so we process the newest first
    const sortedRegras = [...regras].sort((a, b) => {
      const aTime = a.data_inicio ? new Date(a.data_inicio).getTime() : 0;
      const bTime = b.data_inicio ? new Date(b.data_inicio).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.id - a.id;
    });

    sortedRegras.forEach(r => {
      const brand = r.bandeira.toUpperCase();
      
      if (!groups[brand]) {
        groups[brand] = { bandeira: brand, data_inicio: r.data_inicio };
      } else if (!groups[brand].data_inicio && r.data_inicio) {
        groups[brand].data_inicio = r.data_inicio;
      }
      
      if (r.tipo_pagamento === 'cartao_debito' && !groups[brand].debito) {
        groups[brand].debito = r;
      } else if (r.tipo_pagamento === 'cartao_credito_vista' && !groups[brand].credito_vista) {
        groups[brand].credito_vista = r;
      } else if (r.tipo_pagamento === 'cartao_credito_parcelado' && !groups[brand].credito_parcelado) {
        groups[brand].credito_parcelado = r;
      } else if (r.tipo_pagamento === 'pix' && !groups[brand].pix) {
        groups[brand].pix = r;
      }
    });

    return Object.values(groups).sort((a, b) => {
      const aIdx = defaultBrands.indexOf(a.bandeira);
      const bIdx = defaultBrands.indexOf(b.bandeira);
      if (aIdx !== -1 && bIdx !== -1) {
          return aIdx - bIdx;
      }
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      
      return a.bandeira.localeCompare(b.bandeira);
    });
  }, [regras]);

  // Manual Reconciliation Memos
  const pendingReceivables = useMemo(() => {
    return recebiveis.filter(r => r.status === 'A RECEBER');
  }, [recebiveis]);

  const filteredManualReceivables = useMemo(() => {
    return pendingReceivables.filter(r => {
      const matchBrand = !manualFilterBrand || r.bandeira === manualFilterBrand;
      const matchSearch = !manualSearch ||
        (r.descricao || '').toLowerCase().includes(manualSearch.toLowerCase()) ||
        (r.rv || '').toLowerCase().includes(manualSearch.toLowerCase());
      return matchBrand && matchSearch;
    });
  }, [pendingReceivables, manualFilterBrand, manualSearch]);

  const manualSummary = useMemo(() => {
    let bruto = 0;
    let taxaAdm = 0;

    selectedManualIds.forEach(id => {
      const item = recebiveis.find(r => r.id === id);
      if (item) {
        bruto += Number(item.valor_bruto || 0);
        taxaAdm += Number(item.valor_taxa || 0);
      }
    });

    const antecipacao = bruto * (anticipationRate / 100);
    const liquido = bruto - taxaAdm - antecipacao;

    const target = selectedDeposito ? (selectedDeposito.valor_pago || selectedDeposito.valor_previsto || 0) : 0;
    const diferenca = target - liquido;

    return {
      bruto,
      taxaAdm,
      antecipacao,
      liquido,
      diferenca
    };
  }, [selectedManualIds, recebiveis, anticipationRate, selectedDeposito]);

  const handleBatchManualReconcile = async () => {
    if (!selectedDeposito || selectedManualIds.length === 0) return;
    if (!manualReconcileContaId) {
      alert('Selecione a conta bancária destino para o lote.');
      return;
    }
    if (!manualReconcileDate) {
      alert('Informe a data real do depósito.');
      return;
    }

    if (!confirm(`Deseja conciliar as ${selectedManualIds.length} parcelas selecionadas contra o depósito de ${BRL.format(selectedDeposito.valor_pago || selectedDeposito.valor_previsto)}?`)) return;

    setSaving(true);
    try {
      const putPromises = selectedManualIds.map(async (id) => {
        const resGet = await api.get(`/lancamentos/${id}`);
        const lancamentoAtual = resGet.data;

        let meta: Record<string, any> = {};
        if (lancamentoAtual.observacao) {
          try {
            meta = JSON.parse(lancamentoAtual.observacao);
          } catch (err) {
            meta = {};
          }
        }

        const valorBruto = Number(lancamentoAtual.valor_previsto || 0);
        const originalTaxa = Number(meta.cartao_taxa || 0);
        const originalTaxaValor = Number(meta.cartao_taxa_valor || 0);

        const anticipationFeeVal = valorBruto * (anticipationRate / 100);
        const newTaxaValor = Number((originalTaxaValor + anticipationFeeVal).toFixed(2));
        const newLiquido = Number((valorBruto - newTaxaValor).toFixed(2));

        const updatedMeta = {
          ...meta,
          cartao_taxa: Number((originalTaxa + anticipationRate).toFixed(2)),
          cartao_taxa_valor: newTaxaValor,
          cartao_liquido_previsto: newLiquido,
          taxa_antecipacao_aplicada: anticipationRate,
          valor_antecipacao_aplicada: anticipationFeeVal
        };

        const payload = {
          descricao: lancamentoAtual.descricao,
          valor_previsto: valorBruto,
          valor_pago: lancamentoAtual.valor_pago,
          data_pagamento: lancamentoAtual.data_pagamento,
          data_vencimento: manualReconcileDate,
          data_competencia: lancamentoAtual.data_competencia,
          conta_id: lancamentoAtual.conta_id,
          plano_contas_id: lancamentoAtual.plano_contas_id,
          entidade_id: lancamentoAtual.entidade_id,
          status: lancamentoAtual.status,
          observacao: JSON.stringify(updatedMeta)
        };

        await api.put(`/lancamentos/${id}`, payload);
      });

      await Promise.all(putPromises);

      const payloadLote = {
        data_pagamento: manualReconcileDate,
        conta_destino_id: Number(manualReconcileContaId),
        lancamento_deposito_id: selectedDeposito.id,
        lancamento_ids: selectedManualIds
      };

      await api.post('/pdv/conciliacao/lotes', payloadLote);

      setSelectedDeposito(null);
      setSelectedManualIds([]);
      setAnticipationRate(0);
      setRightPanelTab('sugestoes');
      await Promise.all([
        fetchDepositos(),
        fetchAgenda()
      ]);

      alert('Lote manual de cartões conciliado e liquidado com sucesso!');
    } catch (err) {
      console.error('Erro ao realizar conciliação manual:', err);
      alert('Erro ao realizar conciliação manual de recebíveis.');
    } finally {
      setSaving(false);
    }
  };

  // Helper Labels
  const formatTipoPagamento = (tipo: string) => {
    if (tipo === 'cartao_credito_vista') return 'Crédito à Vista';
    if (tipo === 'cartao_credito_parcelado') return 'Crédito Parcelado';
    if (tipo === 'cartao_debito') return 'Débito';
    return tipo;
  };

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
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col xl:flex-row gap-4 items-center justify-between">
              <div className="relative w-full xl:w-72">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={filterSearch}
                  onChange={e => setFilterSearch(e.target.value)}
                  placeholder="Pesquisar venda ou ID... (Atalho: /)"
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
              </div>

              {/* Modality Quick Filters */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700/80 shrink-0">
                <button
                  type="button"
                  onClick={() => setModalityFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${modalityFilter === 'ALL' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'}`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setModalityFilter('DEBITO')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${modalityFilter === 'DEBITO' ? 'bg-blue-600 text-white shadow-xs' : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'}`}
                >
                  💳 Somente Débito
                </button>
                <button
                  type="button"
                  onClick={() => setModalityFilter('CREDITO')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${modalityFilter === 'CREDITO' ? 'bg-violet-600 text-white shadow-xs' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40'}`}
                >
                  💳 Somente Crédito
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                <select
                  value={filterBrand}
                  onChange={e => setFilterBrand(e.target.value)}
                  className="p-2 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Todas Bandeiras</option>
                  <option value="VISA">VISA</option>
                  <option value="MASTERCARD">MASTERCARD</option>
                  <option value="ELO">ELO</option>
                  <option value="AMEX">AMEX</option>
                  <option value="HIPERCARD">HIPERCARD</option>
                  <option value="IFOOD">IFOOD</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="p-2 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Todos Status</option>
                  <option value="A RECEBER">A RECEBER</option>
                  <option value="PAGO">PAGO</option>
                </select>

                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="p-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-700 dark:text-white" />
                  <span>até</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="p-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-700 dark:text-white" />
                </div>

                <button
                  onClick={() => {
                    setFilterSearch('');
                    setFilterBrand('');
                    setFilterStatus('');
                    setStartDate('');
                    setEndDate('');
                    setSelectedDay(null);
                  }}
                  className="px-3 py-2 text-slate-400 hover:text-slate-600 dark:hover:text-white text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition mr-2"
                >
                  Limpar Filtros
                </button>

                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'list' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500'}`}
                  >
                    Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('calendar')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500'}`}
                  >
                    Calendário
                  </button>
                </div>
              </div>
            </div>

            {/* Main Content (List vs Calendar) */}
            {loading ? (
              <div className="py-20 text-center text-slate-400 flex flex-col items-center gap-3">
                <Loader2 className="animate-spin text-blue-500 w-10 h-10" />
                <span>Carregando agenda...</span>
              </div>
            ) : viewMode === 'list' ? (
              filteredAgenda.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl py-16 text-center text-slate-500">
                  <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <h4 className="font-bold text-slate-900 dark:text-white">Nenhum recebível previsto</h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">Nenhum lançamento no financeiro corresponde às regras e filtros aplicados.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {agendaGroupedByDate.map((grupo) => {
                    return (
                      <div key={grupo.data} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                        <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-2">
                          <div className="flex items-center gap-3">
                            <div className="text-left">
                              <span className="font-black text-slate-900 dark:text-white text-sm">
                                {formatSafeDate(grupo.data, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </span>
                              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold uppercase tracking-wider px-2 py-0.5 rounded ml-2">
                                {grupo.itens.length} Recebível(eis)
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-slate-400">Total Previsto: <b className="text-slate-700 dark:text-slate-300 font-mono font-bold">{BRL.format(grupo.bruto)}</b></span>
                            <span className="text-slate-400">Líquido do dia: <b className="text-emerald-600 dark:text-emerald-400 font-mono font-black">{BRL.format(grupo.liquido)}</b></span>
                          </div>
                        </div>

                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {[...grupo.itens].sort((a, b) => Number(b.valor_liquido || 0) - Number(a.valor_liquido || 0)).map(item => {
                            const brandObj = inferCardBrand(item.bandeira);
                            return (
                              <div key={`${item.id}-${item.venda_id_uuid || ''}`} onClick={() => handleOpenEditRecebivel(item)} className="p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 cursor-pointer transition">
                                <div className="flex items-center gap-4 min-w-0 flex-1">
                                  <BrandAvatar visual={brandObj} size="sm" className="shrink-0" />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-slate-900 dark:text-white text-sm truncate">{item.descricao}</span>
                                      <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono shrink-0">{item.rv}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                                      <span>Venda: {formatSafeDate(item.data_venda)}</span>
                                      <span>•</span>
                                      <span>Forma: {formatTipoPagamento(item.tipo_pagamento)}</span>
                                      {item.numero_parcela && (
                                        <>
                                          <span>•</span>
                                          <span>Parcela {item.numero_parcela}/{item.total_parcelas}</span>
                                        </>
                                      )}
                                      {item.vendedor && (
                                        <>
                                          <span>•</span>
                                          <span>Vendedor: <b className="text-slate-600 dark:text-slate-350 font-semibold">{item.vendedor}</b></span>
                                        </>
                                      )}
                                      {item.cliente && (
                                        <>
                                          <span>•</span>
                                          <span>Cliente: <b className="text-slate-600 dark:text-slate-350 font-semibold">{item.cliente}</b></span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-6 justify-between md:justify-end w-full md:w-auto shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 dark:border-slate-800">
                                  <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Bruto</span>
                                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{BRL.format(item.valor_bruto)}</span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Taxa</span>
                                    <span className="font-mono text-xs text-rose-500">-{BRL.format(item.valor_taxa)}</span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Líquido</span>
                                    <span className="font-mono text-sm font-black text-slate-900 dark:text-white">{BRL.format(item.valor_liquido)}</span>
                                  </div>
                                  <div className="text-center w-24">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${item.status === 'PAGO' ? 'bg-emerald-100 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900' : 'bg-amber-100 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900'}`}>
                                      {item.status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              /* Calendar View Grid */
              <div className="space-y-6">
                {/* Month Selector Header */}
                <div className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-4 rounded-2xl shadow-sm flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrevMonth}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition text-slate-600 dark:text-slate-400 font-bold text-xs flex items-center gap-1"
                      title="Navegar para o mês anterior (Atalho: ←)"
                    >
                      ◀ Mês Anterior
                    </button>
                    <button
                      onClick={() => {
                        setCurrentMonth(new Date());
                        const y = new Date().getFullYear();
                        const m = String(new Date().getMonth() + 1).padStart(2, '0');
                        const d = String(new Date().getDate()).padStart(2, '0');
                        setSelectedDay(`${y}-${m}-${d}`);
                      }}
                      className="px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg text-xs font-bold transition border border-blue-200 dark:border-blue-800/60 flex items-center gap-1"
                      title="Ir para a data de hoje (Atalho: T)"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Hoje (T)
                    </button>
                  </div>
                  <h3 className="text-base font-black text-slate-950 dark:text-white capitalize">
                    {currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                  </h3>
                  <button
                    onClick={handleNextMonth}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition text-slate-600 dark:text-slate-400 font-bold text-xs flex items-center gap-1"
                    title="Navegar para o próximo mês (Atalho: →)"
                  >
                    Próximo Mês ▶
                  </button>
                </div>

                {/* Calendar Grid */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                  {/* Days of week header */}
                  <div className="grid grid-cols-7 text-center bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">
                    <div>Dom</div>
                    <div>Seg</div>
                    <div>Ter</div>
                    <div>Qua</div>
                    <div>Qui</div>
                    <div>Sex</div>
                    <div>Sáb</div>
                  </div>

                  {/* Day Slots */}
                  <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-slate-800 border-l border-t border-slate-100 dark:border-slate-800">
                    {calendarDays.map((slot, index) => {
                      const isSelected = selectedDay === slot.dateStr;
                      const dayItems = calendarFilteredAgenda.filter(r => r.data_vencimento === slot.dateStr);

                      // Group day items by brand, then by tipo (debito / credito)
                      const brandGrouped: Record<string, {
                        bruto: number;
                        liquido: number;
                        itens: Recebivel[];
                        debito: { bruto: number; liquido: number; count: number };
                        credito: { bruto: number; liquido: number; count: number };
                      }> = {};
                      dayItems.forEach(item => {
                        const brand = item.bandeira || 'OUTROS';
                        if (!brandGrouped[brand]) {
                          brandGrouped[brand] = {
                            bruto: 0, liquido: 0, itens: [],
                            debito: { bruto: 0, liquido: 0, count: 0 },
                            credito: { bruto: 0, liquido: 0, count: 0 }
                          };
                        }
                        brandGrouped[brand].bruto += Number(item.valor_bruto);
                        brandGrouped[brand].liquido += Number(item.valor_liquido);
                        brandGrouped[brand].itens.push(item);
                        const isDebito = item.tipo_pagamento === 'cartao_debito';
                        const bucket = isDebito ? brandGrouped[brand].debito : brandGrouped[brand].credito;
                        bucket.bruto += Number(item.valor_bruto);
                        bucket.liquido += Number(item.valor_liquido);
                        bucket.count += 1;
                      });

                      const totalLiquido = Object.keys(brandGrouped).reduce((sum, b) => sum + brandGrouped[b].liquido, 0);

                      return (
                        <div
                          key={`${slot.dateStr}-${index}`}
                          onClick={() => {
                            setSelectedDay(slot.dateStr);
                          }}
                          className={`min-h-[110px] p-2.5 flex flex-col justify-between cursor-pointer transition hover:bg-blue-50/20 dark:hover:bg-blue-950/5 ${!slot.isCurrentMonth ? 'bg-slate-50/50 dark:bg-slate-950/20 opacity-40' : ''} ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30 dark:bg-blue-950/10' : ''}`}
                        >
                          {/* Day Number and Total Day Value badge */}
                          <div className="flex justify-between items-start">
                            <span className={`text-xs font-bold ${slot.isCurrentMonth ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'}`}>
                              {slot.dayNum}
                            </span>
                            {totalLiquido > 0 && (
                              <span className="text-[9px] bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 px-1 py-0.5 rounded font-mono font-bold">
                                {BRL.format(totalLiquido)}
                              </span>
                            )}
                          </div>

                          {/* Brand + Débito/Crédito Lines */}
                          <div className="space-y-0.5 mt-2 overflow-y-auto max-h-[80px] custom-scrollbar">
                            {Object.keys(brandGrouped).map(brand => {
                              const info = brandGrouped[brand];
                              const brandObj = inferCardBrand(brand);
                              return (
                                <div key={brand}>
                                  {/* Brand label */}
                                  <div className="flex items-center gap-1 px-1 pt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: brandObj.accent }}></span>
                                    <span className="text-[8px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wide">{brand}</span>
                                  </div>
                                  {/* Debito row */}
                                  {info.debito.count > 0 && (
                                    <div
                                      className="flex items-center justify-between text-[8px] bg-blue-50/70 dark:bg-blue-950/20 px-1.5 py-0.5 rounded border border-blue-100/60 dark:border-blue-900/40 font-semibold ml-2"
                                      title={`${info.debito.count} recebível(eis) de ${brand} - Débito`}
                                    >
                                      <span className="text-blue-500 dark:text-blue-400 font-bold">DEB</span>
                                      <span className="font-mono text-blue-700 dark:text-blue-300 font-bold">{BRL.format(info.debito.liquido)}</span>
                                    </div>
                                  )}
                                  {/* Crédito row */}
                                  {info.credito.count > 0 && (
                                    <div
                                      className="flex items-center justify-between text-[8px] bg-violet-50/70 dark:bg-violet-950/20 px-1.5 py-0.5 rounded border border-violet-100/60 dark:border-violet-900/40 font-semibold ml-2"
                                      title={`${info.credito.count} recebível(eis) de ${brand} - Crédito`}
                                    >
                                      <span className="text-violet-500 dark:text-violet-400 font-bold">CRÉ</span>
                                      <span className="font-mono text-violet-700 dark:text-violet-300 font-bold">{BRL.format(info.credito.liquido)}</span>
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
                </div>

                {/* Selected Day Details Panel */}
                {selectedDay && (
                  <div ref={detailsRef} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 animate-in slide-in-from-bottom-2 duration-200">
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
                            setStartDate('');
                            setEndDate('');
                          }}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white font-bold"
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
                                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${
                                          group.status === 'ANTECIPADO'
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
                                              <span className="font-bold text-slate-850 dark:text-slate-200 text-xs">{item.descricao}</span>
                                              <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono shrink-0">{item.rv}</span>
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
                                              <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase border ${
                                                item.status === 'ANTECIPADO'
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
                )}
              </div>
            )}
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
                                <select
                                  value={manualFilterBrand}
                                  onChange={e => setManualFilterBrand(e.target.value)}
                                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="">Todas Bandeiras</option>
                                  <option value="VISA">VISA</option>
                                  <option value="MASTERCARD">MASTERCARD</option>
                                  <option value="ELO">ELO</option>
                                  <option value="AMEX">AMEX</option>
                                  <option value="HIPERCARD">HIPERCARD</option>
                                  <option value="CABAL">CABAL</option>
                                  <option value="IFOOD">IFOOD</option>
                                </select>
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
                                            <span className="font-bold text-slate-900 dark:text-white text-xs truncate">{item.descricao}</span>
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
                              <select
                                value={manualReconcileContaId}
                                onChange={e => setManualReconcileContaId(e.target.value)}
                                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">Selecione...</option>
                                {contas.map(c => <option key={c.id} value={c.id}>{c.nome} {c.banco ? `(${c.banco})` : ''}</option>)}
                              </select>
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
                              onClick={handleBatchManualReconcile}
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
                        <select
                          value={regraForm.tipo_pagamento}
                          onChange={e => setRegraForm({ ...regraForm, tipo_pagamento: e.target.value })}
                          className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        >
                          <option value="cartao_credito_vista">Crédito à Vista</option>
                          <option value="cartao_credito_parcelado">Crédito Parcelado</option>
                          <option value="cartao_debito">Débito</option>
                        </select>
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
                        <select
                          value={regraForm.tipo_prazo}
                          onChange={e => setRegraForm({ ...regraForm, tipo_prazo: e.target.value as any })}
                          className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="DIAS_CORRIDOS">Dias Corridos (ex: D+30)</option>
                          <option value="DIAS_UTEIS">Dias Úteis (ex: D+30 úteis)</option>
                          <option value="DIA_FIXO">Dia Fixo do Mês</option>
                        </select>
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
                        <select
                          value={regraForm.conta_destino_id}
                          onChange={e => setRegraForm({ ...regraForm, conta_destino_id: e.target.value })}
                          className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione...</option>
                          {contas.map(c => <option key={c.id} value={c.id}>{c.nome} {c.banco ? `(${c.banco})` : ''}</option>)}
                        </select>
                      </div>

                      {/* Plano de contas taxa */}
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Categoria de Despesa de Taxa</label>
                        <select
                          value={regraForm.plano_contas_taxa_id}
                          onChange={e => setRegraForm({ ...regraForm, plano_contas_taxa_id: e.target.value })}
                          className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione...</option>
                          {categoriasDespesa.map(d => <option key={d.id} value={d.id}>{d.codigo} - {d.nome}</option>)}
                        </select>
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
                      <select
                        value={confirmData.conta_destino_id}
                        onChange={e => setConfirmData({ ...confirmData, conta_destino_id: e.target.value })}
                        className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Selecione...</option>
                        {contas.map(c => <option key={c.id} value={c.id}>{c.nome} {c.banco ? `(${c.banco})` : ''}</option>)}
                      </select>
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
                        <select
                          value={recebivelForm.status}
                          onChange={e => handleRecebivelFormChange({ status: e.target.value as any })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        >
                          <option value="A RECEBER">A RECEBER</option>
                          <option value="PAGO">PAGO</option>
                        </select>
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
                        <select
                          value={recebivelForm.bandeira}
                          onChange={e => handleRecebivelFormChange({ bandeira: e.target.value })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="VISA">VISA</option>
                          <option value="MASTERCARD">MASTERCARD</option>
                          <option value="ELO">ELO</option>
                          <option value="AMEX">AMEX</option>
                          <option value="HIPERCARD">HIPERCARD</option>
                          <option value="IFOOD">IFOOD</option>
                          <option value="OUTROS">OUTROS</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Forma de Pagamento</label>
                        <select
                          value={recebivelForm.tipo_pagamento}
                          onChange={e => handleRecebivelFormChange({ tipo_pagamento: e.target.value })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="cartao_credito_vista">Crédito à Vista</option>
                          <option value="cartao_credito_parcelado">Crédito Parcelado</option>
                          <option value="cartao_debito">Débito</option>
                        </select>
                      </div>
                    </div>

                    {/* CLIENT & SELLER */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cliente</label>
                        <select
                          value={recebivelForm.entidade_id}
                          onChange={e => handleRecebivelFormChange({ entidade_id: e.target.value })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Cliente Final (Nenhum)</option>
                          {entidades.map(ent => (
                            <option key={ent.id} value={ent.id}>{ent.nome || ent.nome_fantasia}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Vendedor (Criador)</label>
                        <select
                          value={recebivelForm.vendedor_id}
                          disabled
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-500 cursor-not-allowed outline-none"
                        >
                          <option value="">Sem vendedor</option>
                          {vendedores.map(v => (
                            <option key={v.id} value={v.id}>{v.nome || v.email}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* FINANCIAL BREAKDOWN */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Conta Financeira Destino</label>
                        <select
                          value={recebivelForm.conta_id}
                          onChange={e => handleRecebivelFormChange({ conta_id: e.target.value })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione...</option>
                          {contas.map(c => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Categoria de Receita</label>
                        <select
                          value={recebivelForm.plano_contas_id}
                          onChange={e => handleRecebivelFormChange({ plano_contas_id: e.target.value })}
                          className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Selecione...</option>
                          {categoriasReceita.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.codigo} - {cat.nome}</option>
                          ))}
                        </select>
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
                              {recebivelForm.itens.map((it, idx) => (
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
                            <select
                              value={antecipacaoDias}
                              onChange={(e) => setAntecipacaoDias(Number(e.target.value))}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                            >
                              <option value={15}>15 dias de antecedência</option>
                              <option value={30}>30 dias de antecedência (1 mês)</option>
                              <option value={60}>60 dias de antecedência (2 meses)</option>
                              <option value={90}>90 dias de antecedência (3 meses)</option>
                            </select>
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
                              <select
                                value={antecipacaoContaId || (contas.length > 0 ? String(contas[0].id) : '')}
                                onChange={(e) => setAntecipacaoContaId(e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                              >
                                {contas.map(c => (
                                  <option key={c.id} value={c.id}>{c.nome}</option>
                                ))}
                              </select>
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
