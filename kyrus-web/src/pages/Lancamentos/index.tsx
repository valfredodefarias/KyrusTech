import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { useSearchParams, useLocation } from 'react-router-dom';
import { api, fetchLancamentosPaged, normalizeListResponse } from '../../services/api';
import { useLookupStore } from '../../store/lookupStore';
import { useAuthStore } from '../../store/authStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useTabStore } from '../../store/tabStore';
import { useKyrusWsListener } from '../../hooks/useKyrusWebSocket';
import { buildOperationalCategoriaIds } from '../../utils/planoContas';
import { SearchableSelect } from '../../components/SearchableSelect';
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowRightLeft,
  Layers,
  Info,
  X,
  LayoutGrid,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

import type { Lancamento, ToastItem, ListaSortKey, ListaSortDirection, LancamentosProps } from './types';
import {
  formatDateExtenso,
  formatDateShort,
  getTodayLocalYmd,
  getTomorrowLocalYmd,
  isLancamentoAtrasado,
  isLancamentoPago,
} from './utils';

import { KpiCards } from './components/KpiCards';
import { FiltrosSidebar } from './components/FiltrosSidebar';
import { TransferModal } from './components/TransferModal';
import { BulkActionsBar } from './components/BulkActionsBar';
import { BulkPayModal } from './components/BulkPayModal';
import { BulkDeleteModal } from './components/BulkDeleteModal';
import { LancamentosTable } from './components/LancamentosTable';
import { LancamentoFormDrawer } from './components/LancamentoFormDrawer';
import { FaturaVirtualDrawer } from './components/FaturaVirtualDrawer';

export function Lancamentos({
  forcedSearchParams = null,
  onRequestCloseEmbed,
  drawerPanelClassName,
}: LancamentosProps = {}) {
  const [urlSearchParams, setUrlSearchParams] = useSearchParams();
  const [embeddedSearchParams, setEmbeddedSearchParams] = useState<URLSearchParams | null>(
    forcedSearchParams ? new URLSearchParams(forcedSearchParams.toString()) : null
  );
  const searchParams = embeddedSearchParams ?? urlSearchParams;
  const setSearchParams = (next: URLSearchParams, options?: { replace?: boolean }) => {
    if (embeddedSearchParams !== null) {
      setEmbeddedSearchParams(new URLSearchParams(next.toString()));
      return;
    }
    setUrlSearchParams(next, options);
  };

  const isBoletimEmbed = searchParams.get('embed_boletim') === '1';
  const isContasExtratoEmbed = isBoletimEmbed && searchParams.get('origem') === 'contas_extrato';
  const embedFullscreenDrawer = isBoletimEmbed && !isContasExtratoEmbed;
  const currentEmpresaId = useAuthStore((state) => state.user?.empresa_id ?? null);
  const refreshCount = useTransactionStore((state) => state.refreshCount);

  // --- DADOS ---
  const pagedLancamentos = useTransactionStore((state) => state.pagedLancamentos);
  const pagedCacheKey = useTransactionStore((state) => state.pagedCacheKey);
  const setPagedLancamentos = useTransactionStore((state) => state.setPagedLancamentos);
  const removeTransactionFromCache = useTransactionStore((state) => state.removeTransactionFromCache);
  const fetchWsSyncItem = useTransactionStore((state) => state.fetchWsSyncItem);

  // WebSocket Listeners for real-time Sync
  const handleWsUpsert = useCallback((payload: any) => {
    if (payload?.id) fetchWsSyncItem(payload.id);
  }, [fetchWsSyncItem]);

  const handleWsDelete = useCallback((payload: any) => {
    if (payload?.id) removeTransactionFromCache(payload.id);
  }, [removeTransactionFromCache]);

  useKyrusWsListener('LANCAMENTO_CREATED', handleWsUpsert);
  useKyrusWsListener('LANCAMENTO_UPDATED', handleWsUpsert);
  useKyrusWsListener('LANCAMENTO_DELETED', handleWsDelete);

  const lancamentos = pagedLancamentos;

  const setLancamentos = useCallback((val: Lancamento[] | ((prev: Lancamento[]) => Lancamento[])) => {
    const current = useTransactionStore.getState().pagedLancamentos;
    const next = typeof val === 'function' ? val(current) : val;
    setPagedLancamentos(useTransactionStore.getState().pagedCacheKey, next);
  }, [setPagedLancamentos]);

  const [loading, setLoading] = useState(() => {
    const today = new Date();
    const ano = today.getFullYear();
    const mes = today.getMonth() + 1;
    const ini = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
    const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
    const expectedKey = `${currentEmpresaId ?? ''}|${ini}|${fim}|false`;
    return useTransactionStore.getState().pagedCacheKey !== expectedKey;
  });
  const [contas, setContas] = useState<any[]>([]);
  const [cartoes, setCartoes] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);

  const categoriasPorId = useMemo(() => {
    return new Map(categorias.map((categoria: any) => [Number(categoria.id), String(categoria.nome || '')]));
  }, [categorias]);

  const entidadesPorId = useMemo(() => {
    return new Map(
      entidades.map((entidade: any) => [Number(entidade.id), String(entidade.nome || entidade.razao_social || '')])
    );
  }, [entidades]);

  // --- UI STATE ---
  const [mesAtual, setMesAtual] = useState(new Date());
  const [filtroTexto, setFiltroTexto] = useState('');
  const globalSelectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const setSelectedCentroCustoIdGlobally = useLookupStore((state) => state.setSelectedCentroCustoId);

  const centroCustoFiltro = React.useMemo(() => {
    return globalSelectedCentroCustoId === 'ALL' ? '' : String(globalSelectedCentroCustoId);
  }, [globalSelectedCentroCustoId]);

  const setCentroCustoFiltro = React.useCallback((val: string | ((prev: string) => string)) => {
    const computedVal = typeof val === 'function' ? val(globalSelectedCentroCustoId === 'ALL' ? '' : String(globalSelectedCentroCustoId)) : val;
    setSelectedCentroCustoIdGlobally(computedVal === '' ? 'ALL' : Number(computedVal));
  }, [globalSelectedCentroCustoId, setSelectedCentroCustoIdGlobally]);

  const [filtrosAvancados, setFiltrosAvancados] = useState({
    tipo: 'TODOS' as 'TODOS' | 'RECEITA' | 'DESPESA',
    status: [] as string[],
    contaIds: new Set<number>(),
    categoriaIds: new Set<number>(),
    centroCustoPresenca: 'TODOS' as 'TODOS' | 'COM' | 'SEM',
    dataModo: 'VENCIMENTO' as 'VENCIMENTO' | 'PAGAMENTO',
    dataInicio: '',
    dataFim: '',
    ocultarVendasCartaoPendentes: false,
    origem: 'TODOS' as 'TODOS' | 'OFX' | 'MANUAL',
    conciliado: 'TODOS' as 'TODOS' | 'SIM' | 'NAO',
  });
  const [filtroRapidoTipo, setFiltroRapidoTipo] = useState<'TODOS' | 'RECEITA' | 'DESPESA'>('TODOS');
  const [filtroRapidoStatus, setFiltroRapidoStatus] = useState<'TODOS' | 'PAGO' | 'NAO_PAGO'>('TODOS');
  const [filtroRapidoPrazo, setFiltroRapidoPrazo] = useState<'TODOS' | 'HOJE' | 'AMANHA' | 'ATRASADO' | 'EM_ABERTO'>('TODOS');
  const [filtroRapidoIpp, setFiltroRapidoIpp] = useState<boolean>(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosRailCollapsed] = useState(true);

  const [listaSort, setListaSort] = useState<{ key: ListaSortKey; direction: ListaSortDirection }>({
    key: 'valor',
    direction: 'desc',
  });
  const [boletimIdsFiltro, setBoletimIdsFiltro] = useState<Set<number> | null>(null);

  // Barra/ações em lote
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [contaExtratoAtivaId, setContaExtratoAtivaId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [deleteStep, setDeleteStep] = useState(1);
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deletePaidPhrase, setDeletePaidPhrase] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  
  const todayISO = new Date().toISOString().split('T')[0];
  const yesterdayISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [bulkPayData, setBulkPayData] = useState({ conta_id: '', modoData: 'HOJE', data: todayISO });

  const selectedLancamentos = useMemo(
    () => lancamentos.filter((item) => selectedIds.has(Number(item.id))),
    [lancamentos, selectedIds]
  );
  const selectedCompensados = useMemo(
    () =>
      selectedLancamentos.filter(
        (item) => String(item.status).toUpperCase() === 'PAGO' || !!item.data_pagamento || !!item.conciliado
      ),
    [selectedLancamentos]
  );
  const hasSelectedCompensados = selectedCompensados.length > 0;

  // --- MODAIS ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [showFaturaDrawer, setShowFaturaDrawer] = useState(false);
  const [selectedFaturaVirtual, setSelectedFaturaVirtual] = useState<Lancamento | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectedEditarId, setSelectedEditarId] = useState<number | null>(null);
  const [selectedContaId, setSelectedContaId] = useState<number | null>(null);
  const [selectedCartaoId, setSelectedCartaoId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingIppIds, setSavingIppIds] = useState<Set<number>>(new Set());
  
  const [showResumoKpis, setShowResumoKpis] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [transferData, setTransferData] = useState({
    valor: '',
    data: new Date().toISOString().split('T')[0],
    conta_origem_id: '',
    conta_destino_id: '',
    observacao: '',
    centro_custo_id: '',
  });

  const auxLoadedRef = useRef(false);
  const lancamentosAbortRef = useRef<AbortController | null>(null);
  const lastLancamentosKeyRef = useRef<string>('');
  const lastEmpresaIdRef = useRef<number | null>(null);
  const quickOpenNovoHandledRef = useRef(false);
  const embedDrawerOpenedRef = useRef(false);
  const requestIdCounterRef = useRef<number>(0);


  useEffect(() => {
    if (forcedSearchParams) {
      setEmbeddedSearchParams(new URLSearchParams(forcedSearchParams.toString()));
    } else {
      setEmbeddedSearchParams(null);
    }
  }, [forcedSearchParams]);

  useEffect(() => {
    if (!isBoletimEmbed) return;
    if (showDrawer) {
      embedDrawerOpenedRef.current = true;
      return;
    }
    if (embedDrawerOpenedRef.current) {
      embedDrawerOpenedRef.current = false;
      onRequestCloseEmbed?.();
    }
  }, [isBoletimEmbed, showDrawer, onRequestCloseEmbed]);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);



  useEffect(() => {
    localStorage.setItem('lancamentos.filtrosRailCollapsed', filtrosRailCollapsed ? '1' : '0');
  }, [filtrosRailCollapsed]);



  const pushToast = (type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const getVisibleRange = () => {
    if (filtrosAvancados.dataInicio && filtrosAvancados.dataFim) {
      return { ini: filtrosAvancados.dataInicio, fim: filtrosAvancados.dataFim };
    }
    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth() + 1;
    return {
      ini: new Date(ano, mes - 1, 1).toISOString().split('T')[0],
      fim: new Date(ano, mes, 0).toISOString().split('T')[0],
    };
  };

  const refreshLancamentosVisiveis = async () => {
    const { ini, fim } = getVisibleRange();
    await loadLancamentos(ini, fim, { force: true, skipFallback: true });
  };

  const refreshContasComSaldo = async () => {
    try {
      const rC = await api.get('/contas/', { params: { include_saldo: true } });
      setContas(normalizeListResponse<any>(rC.data));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const { ini, fim } = getVisibleRange();
    loadLancamentos(ini, fim, { silent: true });
  }, [
    currentEmpresaId,
    mesAtual,
    filtrosAvancados.dataInicio,
    filtrosAvancados.dataFim,
    filtrosAvancados.dataModo,
    filtrosAvancados.ocultarVendasCartaoPendentes,
    refreshCount,
    searchParams.get('boletim_ids'),
  ]);

  useEffect(() => {
    return () => {
      setContas([]);
      setCartoes([]);
      setCentros([]);
      setEntidades([]);
      setCategorias([]);
    };
  }, []);



  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setCentroCustoFiltro((prev) => prev || onlyId);
      setTransferData((prev) => (prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId }));
    }
  }, [centros]);

  useEffect(() => {
    if (quickOpenNovoHandledRef.current) return;
    if (searchParams.get('novo') !== '1') return;
    if (!auxLoadedRef.current || contas.length === 0) return;

    const cartaoIdParam = Number(searchParams.get('cartao_id') || '');
    const contaIdParam = Number(searchParams.get('conta_id') || '');
    openDrawer(
      undefined,
      Number.isFinite(contaIdParam) && contaIdParam > 0 ? contaIdParam : null,
      Number.isFinite(cartaoIdParam) && cartaoIdParam > 0 ? cartaoIdParam : null
    );

    quickOpenNovoHandledRef.current = true;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('novo');
    nextParams.delete('cartao_id');
    nextParams.delete('conta_id');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, contas.length]);

  useEffect(() => {
    const editarIdParam = Number(searchParams.get('editar_id') || '');
    if (!Number.isFinite(editarIdParam) || editarIdParam <= 0) return;

    let cancelled = false;
    const openEditById = async () => {
      try {
        await loadAuxData();
        if (cancelled) return;
        const res = await api.get(`/lancamentos/${editarIdParam}`);
        if (cancelled) return;
        openDrawer(res.data);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          pushToast('error', 'Não foi possível abrir o lançamento para edição.');
        }
      } finally {
        if (cancelled) return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('editar_id');
        setSearchParams(nextParams, { replace: true });
      }
    };

    void openEditById();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const rawIds = String(searchParams.get('boletim_ids') || '').trim();
    if (!rawIds) {
      setBoletimIdsFiltro(null);
      return;
    }

    const parsedIds = rawIds
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);

    setBoletimIdsFiltro(parsedIds.length > 0 ? new Set(parsedIds) : null);

    setFiltrosAvancados((prev) => ({
      ...prev,
      ocultarVendasCartaoPendentes: false,
    }));
  }, [searchParams]);

  async function loadAuxData() {
    if (auxLoadedRef.current) return;
    try {
      const fetchContas = useLookupStore.getState().fetchContas;
      const fetchCentrosCusto = useLookupStore.getState().fetchCentrosCusto;
      const [rC, rCt, rCC, rE, rCat] = await Promise.all([
        fetchContas(),
        api.get('/cartoes/'),
        fetchCentrosCusto(),
        fetchEntidadesLookup(),
        fetchPlanoContas(),
      ]);
      setContas(normalizeListResponse<any>(rC));
      setCartoes(normalizeListResponse<any>(rCt.data));
      setCentros(normalizeListResponse<any>(rCC));
      setEntidades(normalizeListResponse<any>(rE));
      setCategorias(normalizeListResponse<any>(rCat));
      auxLoadedRef.current = true;
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (lastEmpresaIdRef.current === currentEmpresaId) return;

    lastEmpresaIdRef.current = currentEmpresaId;
    auxLoadedRef.current = false;
    lastLancamentosKeyRef.current = '';
    setLancamentos([]);
    setSelectedIds(new Set());
    setBoletimIdsFiltro(null);

    void loadAuxData();
  }, [currentEmpresaId]);

  async function syncCadastros(options?: { silent?: boolean }) {
    try {
      const fetchContas = useLookupStore.getState().fetchContas;
      const [rE, rCat, rC] = await Promise.all([
        fetchEntidadesLookup(true),
        fetchPlanoContas(true),
        fetchContas(true),
      ]);
      setEntidades(normalizeListResponse<any>(rE));
      setCategorias(normalizeListResponse<any>(rCat));
      setContas(normalizeListResponse<any>(rC));
      if (!options?.silent) {
        pushToast('success', 'Cadastros e saldos sincronizados.');
      }
    } catch (e) {
      console.error(e);
      if (!options?.silent) {
        pushToast('error', 'Erro ao sincronizar cadastros.');
      }
    }
  }

  async function loadLancamentos(
    ini?: string,
    fim?: string,
    opts?: { force?: boolean; skipFallback?: boolean; silent?: boolean }
  ) {
    const rawIds = searchParams.get('boletim_ids') || '';
    if (!ini && !fim && !rawIds && !opts?.skipFallback) {
      const range = getVisibleRange();
      ini = range.ini;
      fim = range.fim;
    }
    const thisRequestId = ++requestIdCounterRef.current;
    const key = `${currentEmpresaId ?? ''}|${ini || ''}|${fim || ''}|${filtrosAvancados.dataModo}|${filtrosAvancados.ocultarVendasCartaoPendentes}|${rawIds}`;
    const isCacheMatch = key === useTransactionStore.getState().pagedCacheKey;
    const hasCachedItems = useTransactionStore.getState().pagedLancamentos.length > 0;

    if (!opts?.force && !opts?.silent && key === lastLancamentosKeyRef.current && hasCachedItems) {
      setLoading(false);
      return;
    }
    lastLancamentosKeyRef.current = key;

    if (lancamentosAbortRef.current) {
      lancamentosAbortRef.current.abort();
    }
    const controller = new AbortController();
    lancamentosAbortRef.current = controller;

    const shouldShowLoader = opts?.force || (!isCacheMatch && !hasCachedItems);
    if (shouldShowLoader) {
      setLoading(true);
      if (!isCacheMatch && !hasCachedItems) {
        setPagedLancamentos(key, []);
      }
    }

    try {
      const params: any = {
        minimized: true,
        sem_paginacao: true,
        data_modo: filtrosAvancados.dataModo ? filtrosAvancados.dataModo.toLowerCase() : 'vencimento',
      };
      if (rawIds) {
        params.ids = rawIds;
      } else {
        if (ini) params.data_inicio = ini;
        if (fim) params.data_fim = fim;
        if (filtrosAvancados.ocultarVendasCartaoPendentes) {
          params.ocultar_vendas_cartao_pendentes = true;
        }
      }
      const rows = await fetchLancamentosPaged<Lancamento>(params, { pageSize: 1500, signal: controller.signal });
      
      // Sequence Guard: Discard stale response if a newer request was dispatched
      if (thisRequestId < requestIdCounterRef.current) {
        console.warn(`[Out-of-Order Guard] Resposta obsoleta ignorada (req #${thisRequestId} vs atual #${requestIdCounterRef.current})`);
        return;
      }

      setPagedLancamentos(key, rows);
    } catch (e: any) {
      if (axios.isCancel(e)) return;
      console.error(e);
    } finally {
      if (lancamentosAbortRef.current === controller) {
        lancamentosAbortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function toggleIpp(l: Lancamento) {
    if (savingIppIds.has(l.id)) return;
    setSavingIppIds((prev) => {
      const nextSet = new Set(prev);
      nextSet.add(l.id);
      return nextSet;
    });

    const currentIpp = !!l.ipp;
    const next = !currentIpp;
    setLancamentos((prev) => prev.map((item) => (item.id === l.id ? { ...item, ipp: next } : item)));

    try {
      await api.put(`/lancamentos/${l.id}`, { ipp: next });
    } catch (e) {
      console.error(e);
      setLancamentos((prev) => prev.map((item) => (item.id === l.id ? { ...item, ipp: currentIpp } : item)));
      pushToast('error', 'Não foi possível atualizar o status IPP.');
    } finally {
      setSavingIppIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(l.id);
        return nextSet;
      });
    }
  }

  function toggleSelectAllVisible(allIds: number[]) {
    if (selectedIds.size >= allIds.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(allIds));
  }

  function toggleSelectId(id: number) {
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }

  function openBulkPay() {
    if (selectedIds.size === 0) return;
    setBulkPayData({
      conta_id: contasFiltradas.length > 0 ? String(contasFiltradas[0].id) : '',
      modoData: 'HOJE',
      data: todayISO,
    });
    setShowBulkPay(true);
  }

  async function handleBulkPay() {
    if (selectedIds.size === 0) return;
    if (!bulkPayData.conta_id) {
      pushToast('info', 'Selecione uma conta para baixar em lote.');
      return;
    }
    setSaving(true);
    try {
      const payDate =
        bulkPayData.modoData === 'HOJE' ? todayISO : bulkPayData.modoData === 'ONTEM' ? yesterdayISO : bulkPayData.data;
      await api.post('/lancamentos/bulk-pay', {
        ids: Array.from(selectedIds),
        data_pagamento: payDate,
        conta_id: bulkPayData.conta_id ? parseInt(bulkPayData.conta_id) : null,
      });
      setShowBulkPay(false);
      setSelectedIds(new Set());
      await refreshLancamentosVisiveis();
      await refreshContasComSaldo();
      pushToast('success', 'Baixa em lote concluída.');
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao baixar em lote.');
    } finally {
      setSaving(false);
    }
  }

  function openBulkDelete() {
    setDeleteStep(1);
    setDeletePhrase('');
    setDeletePaidPhrase('');
    setDeleteReason('');
    setShowBulkDelete(true);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const confirmarExclusaoPagos = hasSelectedCompensados && deletePaidPhrase.trim().toUpperCase() === 'EXCLUIR PAGOS';
    setSaving(true);
    try {
      await api.post('/lancamentos/bulk-delete', {
        ids: Array.from(selectedIds),
        confirmar_exclusao_pagos: confirmarExclusaoPagos,
      });
      setShowBulkDelete(false);
      setSelectedIds(new Set());
      await refreshLancamentosVisiveis();
      await refreshContasComSaldo();
      pushToast('success', 'Lançamentos apagados com sucesso.');
    } catch (e: any) {
      console.error(e);
      const msg = String(e?.response?.data?.detail || '').trim();
      pushToast('error', msg || 'Erro ao apagar em lote.');
    } finally {
      setSaving(false);
    }
  }

  const filteredList = useMemo(() => {
    const termoBusca = filtroTexto.trim().toLowerCase();

    return lancamentos.filter((l) => {
      if (boletimIdsFiltro && boletimIdsFiltro.size > 0 && !boletimIdsFiltro.has(Number(l.id))) {
        return false;
      }

      // 1. Texto Global
      if (termoBusca) {
        const categoriaNome = categoriasPorId.get(Number(l.plano_contas_id)) || '';
        const interessadoNome = entidadesPorId.get(Number(l.entidade_id || 0)) || '';
        const blocoBusca = [
          l.descricao,
          categoriaNome,
          interessadoNome,
          l.data_vencimento,
          l.data_pagamento || '',
          formatDateShort(l.data_vencimento),
          formatDateShort(l.data_pagamento),
          formatDateExtenso(l.data_vencimento),
          l.data_pagamento ? formatDateExtenso(l.data_pagamento) : '',
          String(l.valor_previsto || ''),
          String(l.valor_pago || ''),
        ]
          .join(' ')
          .toLowerCase();

        if (!blocoBusca.includes(termoBusca)) return false;
      }

      // 2. Centro de Custo (Header)
      if (centroCustoFiltro && String(l.centro_custo_id) !== centroCustoFiltro) return false;

      // 2.5. Extrato por banco selecionado (somente pagos/recebidos)
      if (contaExtratoAtivaId !== null) {
        if (Number(l.conta_id || 0) !== contaExtratoAtivaId) return false;
        if (!isLancamentoPago(l)) return false;
      }

      // 3. Filtros Rápidos Combinados
      const hoje = getTodayLocalYmd();
      const amanha = getTomorrowLocalYmd();
      const pago = isLancamentoPago(l);

      // Tipo (Entradas / Saídas)
      if (filtroRapidoTipo === 'RECEITA' && l.tipo !== 'RECEITA') return false;
      if (filtroRapidoTipo === 'DESPESA' && l.tipo !== 'DESPESA') return false;

      // Status (Pagos / Não Pagos)
      if (filtroRapidoStatus === 'PAGO' && !pago) return false;
      if (filtroRapidoStatus === 'NAO_PAGO' && pago) return false;

      // Prazo (Hoje / Amanhã / Atrasados / Em Aberto)
      if (filtroRapidoPrazo === 'HOJE' && (l.data_vencimento !== hoje || pago)) return false;
      if (filtroRapidoPrazo === 'AMANHA' && l.data_vencimento !== amanha) return false;
      if (filtroRapidoPrazo === 'ATRASADO' && !isLancamentoAtrasado(l)) return false;
      if (filtroRapidoPrazo === 'EM_ABERTO' && (pago || isLancamentoAtrasado(l))) return false;

      // IPP
      if (filtroRapidoIpp && !l.ipp) return false;

      // 4. Filtros Avançados
      if (filtrosAvancados.tipo !== 'TODOS' && l.tipo !== filtrosAvancados.tipo) return false;
      if (filtrosAvancados.status.length > 0 && !filtrosAvancados.status.includes(l.status)) return false;

      if (filtrosAvancados.centroCustoPresenca === 'COM' && !l.centro_custo_id) return false;
      if (filtrosAvancados.centroCustoPresenca === 'SEM' && !!l.centro_custo_id) return false;

      const dataComparacao =
        filtrosAvancados.dataModo === 'PAGAMENTO' ? (l.data_pagamento || '') : (l.data_vencimento || '');
      if (filtrosAvancados.dataInicio && (!dataComparacao || dataComparacao < filtrosAvancados.dataInicio)) return false;
      if (filtrosAvancados.dataFim && (!dataComparacao || dataComparacao > filtrosAvancados.dataFim)) return false;

      // Filtro de Contas (Multi)
      if (filtrosAvancados.contaIds.size > 0 && (!l.conta_id || !filtrosAvancados.contaIds.has(l.conta_id))) return false;
      // Filtro de Categorias (Multi)
      if (filtrosAvancados.categoriaIds.size > 0 && !filtrosAvancados.categoriaIds.has(l.plano_contas_id)) return false;

      // Filtro por Origem (OFX vs Manual)
      if (filtrosAvancados.origem === 'OFX' && !l.origem?.includes('OFX') && !l.conciliado) return false;
      if (filtrosAvancados.origem === 'MANUAL' && (l.origem?.includes('OFX') || l.conciliado)) return false;

      // Filtro por Conciliado
      if (filtrosAvancados.conciliado === 'SIM' && !l.conciliado) return false;
      if (filtrosAvancados.conciliado === 'NAO' && l.conciliado) return false;

      return true;
    });
  }, [
    lancamentos,
    boletimIdsFiltro,
    filtroTexto,
    centroCustoFiltro,
    filtroRapidoTipo,
    filtroRapidoStatus,
    filtroRapidoPrazo,
    filtroRapidoIpp,
    filtrosAvancados,
    contaExtratoAtivaId,
    categoriasPorId,
    entidadesPorId,
  ]);

  const contasFiltradas = useMemo(() => {
    return contas.filter((c) => !centroCustoFiltro || String(c.centro_custo_id) === String(centroCustoFiltro));
  }, [contas, centroCustoFiltro]);

  const contasAtivas = useMemo(
    () => contas.filter((conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'),
    [contas]
  );

  useEffect(() => {
    const activeIds = new Set(contasAtivas.map((item) => Number(item.id)));
    setFiltrosAvancados((prev) => {
      if (prev.contaIds.size === 0) return prev;
      const filteredContaIds = new Set(Array.from(prev.contaIds).filter((id) => activeIds.has(Number(id))));
      if (filteredContaIds.size === prev.contaIds.size) return prev;
      return { ...prev, contaIds: filteredContaIds };
    });
  }, [contasAtivas]);

  useEffect(() => {
    if (bulkPayData.conta_id && !contasFiltradas.some((c) => String(c.id) === String(bulkPayData.conta_id))) {
      setBulkPayData((prev) => ({ ...prev, conta_id: '' }));
    }
  }, [contasFiltradas, bulkPayData.conta_id]);

  useEffect(() => {
    if (contaExtratoAtivaId !== null && !contasFiltradas.some((c) => Number(c.id) === contaExtratoAtivaId)) {
      setContaExtratoAtivaId(null);
    }
  }, [contasFiltradas, contaExtratoAtivaId]);

  // Agrupamento
  const { grouped, kpis } = useMemo(() => {
    const groups: Record<string, Lancamento[]> = {};
    let r = 0,
      d = 0;
    const categoriasOperacionaisResultado = buildOperationalCategoriaIds(categorias);
    const interessadosPorId = entidadesPorId;

    const statusRank = (item: Lancamento) => {
      const pago = String(item.status).toUpperCase() === 'PAGO';
      const atrasado = isLancamentoAtrasado(item);
      if (atrasado) return 0;
      if (!pago && String(item.status).toUpperCase() === 'PENDENTE') return 1;
      if (!pago && String(item.status).toUpperCase() === 'EM ABERTO') return 2;
      if (pago) return 3;
      return 4;
    };

    const compareLancamentos = (a: Lancamento, b: Lancamento) => {
      let result = 0;

      if (listaSort.key === 'descricao') {
        result = String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR');
      } else if (listaSort.key === 'interessado') {
        const interessadoA = String(interessadosPorId.get(Number(a.entidade_id || 0)) || '');
        const interessadoB = String(interessadosPorId.get(Number(b.entidade_id || 0)) || '');
        result = interessadoA.localeCompare(interessadoB, 'pt-BR');
      } else if (listaSort.key === 'status') {
        result = statusRank(a) - statusRank(b);
      } else {
        result = Number(a.valor_previsto || 0) - Number(b.valor_previsto || 0);
      }

      if (result === 0) {
        result = Number(a.id || 0) - Number(b.id || 0);
      }

      return listaSort.direction === 'asc' ? result : -result;
    };

    filteredList.forEach((l) => {
      const dataGroup =
        filtrosAvancados.dataModo === 'PAGAMENTO'
          ? (l.data_pagamento || l.data_vencimento)
          : l.data_vencimento;
      if (!groups[dataGroup]) groups[dataGroup] = [];
      groups[dataGroup].push(l);

      const val =
        filtrosAvancados.dataModo === 'PAGAMENTO' && l.valor_pago
          ? Number(l.valor_pago)
          : Number(l.valor_previsto);

      if (l.tipo === 'RECEITA') {
        r += val;
      } else {
        d += val;
      }
    });

    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    sortedDates.forEach((date) => groups[date].sort(compareLancamentos));

    return { grouped: { groups, sortedDates }, kpis: { r, d, s: r - d } };
  }, [filteredList, categorias, entidadesPorId, listaSort, filtrosAvancados.dataModo]);



  // --- ACTIONS ---

  const toggleMainSidebar = () => {
    window.dispatchEvent(new CustomEvent('kyrus:sidebar-toggle'));
  };

  const toggleListaSort = (key: ListaSortKey) => {
    setListaSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'valor' ? 'desc' : 'asc' };
    });
  };

  const location = useLocation();

  const handleCloseDrawer = useCallback(() => {
    setShowDrawer(false);
    setSelectedContaId(null);
    setSelectedCartaoId(null);
    useTabStore.getState().setTabDirty(location.pathname, false);
    onRequestCloseEmbed?.();
  }, [location.pathname, onRequestCloseEmbed]);

  const openDrawer = (item?: Lancamento, defaultContaId?: number | null, defaultCartaoId?: number | null) => {
    if (item && item.origem === 'FATURA_VIRTUAL') {
      setSelectedFaturaVirtual(item);
      setShowFaturaDrawer(true);
      return;
    }
    setSelectedEditarId(item?.id || null);
    setSelectedContaId(defaultContaId || null);
    setSelectedCartaoId(defaultCartaoId || null);
    setShowDrawer(true);
  };

  const resetFiltros = () => {
    setFiltrosAvancados({
      tipo: 'TODOS',
      status: [],
      contaIds: new Set(),
      categoriaIds: new Set(),
      centroCustoPresenca: 'TODOS',
      dataModo: 'VENCIMENTO',
      dataInicio: '',
      dataFim: '',
      ocultarVendasCartaoPendentes: false,
      origem: 'TODOS',
      conciliado: 'TODOS',
    });
    setFiltroTexto('');
    setCentroCustoFiltro('');
    setFiltroRapidoTipo('TODOS');
    setFiltroRapidoStatus('TODOS');
    setFiltroRapidoPrazo('TODOS');
    setFiltroRapidoIpp(false);
    setContaExtratoAtivaId(null);
    setMesAtual(new Date());
  };

  async function handleTransferencia() {
    if (!transferData.valor || !transferData.conta_origem_id || !transferData.conta_destino_id) {
      pushToast('info', 'Preencha os campos obrigatórios da transferência.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/lancamentos/transferir', {
        ...transferData,
        valor: parseFloat(transferData.valor),
        centro_custo_id: transferData.centro_custo_id ? parseInt(transferData.centro_custo_id) : null,
      });
      pushToast('success', 'Transferência realizada com sucesso!');
      setShowTransfer(false);
      await refreshLancamentosVisiveis();
      await refreshContasComSaldo();
    } catch (e) {
      pushToast('error', 'Erro na transferência.');
    } finally {
      setSaving(false);
    }
  }

  const quickFilterOptions = [
    { id: null, label: 'Todos' },
    { id: 'HOJE', label: 'Vcto Hoje', icon: ChevronRight },
    { id: 'AMANHA', label: 'Vcto Amanhã', icon: ChevronRight },
    { id: 'ATRASADO', label: 'Atrasados', icon: ChevronRight },
    { id: 'PAGO', label: 'Pagos', icon: ChevronRight },
    { id: 'NAO_PAGO', label: 'Não pagos', icon: ChevronRight },
    { id: 'IPP', label: 'IPP', icon: ChevronRight },
    { id: 'EM_ABERTO', label: 'Em Aberto', icon: ChevronRight },
    { id: 'ENTRADAS', label: 'Entradas', icon: ChevronRight },
    { id: 'SAIDAS', label: 'Saídas', icon: ChevronRight },
  ];

  const filtrosAtivosCount = [
    filtroTexto ? 1 : 0,
    centroCustoFiltro ? 1 : 0,
    (filtroRapidoTipo !== 'TODOS' || filtroRapidoStatus !== 'TODOS' || filtroRapidoPrazo !== 'TODOS' || filtroRapidoIpp) ? 1 : 0,
    filtrosAvancados.tipo !== 'TODOS' ? 1 : 0,
    filtrosAvancados.centroCustoPresenca !== 'TODOS' ? 1 : 0,
    filtrosAvancados.dataInicio || filtrosAvancados.dataFim ? 1 : 0,
    filtrosAvancados.contaIds.size > 0 ? 1 : 0,
    filtrosAvancados.categoriaIds.size > 0 ? 1 : 0,
    contaExtratoAtivaId !== null ? 1 : 0,
  ].filter(Boolean).length;

  // Focus search input on page load
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputActive = activeEl && (
          activeEl.tagName === 'INPUT' || 
          activeEl.tagName === 'SELECT' || 
          activeEl.tagName === 'TEXTAREA' || 
          activeEl.getAttribute('contenteditable') === 'true'
      );

      // 1. Esc key closes modals
      if (e.key === 'Escape') {
        if (showDrawer) {
          e.preventDefault();
          handleCloseDrawer();
        } else if (showTransfer) {
          e.preventDefault();
          setShowTransfer(false);
        } else if (showBulkPay) {
          e.preventDefault();
          setShowBulkPay(false);
        } else if (showBulkDelete) {
          e.preventDefault();
          setShowBulkDelete(false);
        }
        return;
      }

      if (isInputActive) return;

      // 2. Tecla N para novo
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openDrawer();
      }
      
      // 3. Tecla / para buscar
      else if (e.key === '/') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
      }



      // 5. PageUp / PageDown para trocar mês
      else if (e.key === 'PageUp') {
        e.preventDefault();
        setMesAtual((prev) => {
          const d = new Date(prev.getTime());
          d.setMonth(d.getMonth() - 1);
          return d;
        });
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        setMesAtual((prev) => {
          const d = new Date(prev.getTime());
          d.setMonth(d.getMonth() + 1);
          return d;
        });
      }

      // 6. Ctrl + A para selecionar tudo visível, Ctrl + Shift + A para desmarcar tudo
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (e.shiftKey) {
          setSelectedIds(new Set());
        } else {
          const visibleIds = filteredList.filter(l => !l.conciliado).map(l => l.id);
          setSelectedIds(new Set(visibleIds));
        }
      }

      // 7. P para pagar lote e Delete/D para excluir lote
      else if (selectedIds.size > 0) {
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          setShowBulkPay(true);
        } else if (e.key === 'Delete' || e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          openBulkDelete();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeys);
    };
  }, [
    showDrawer,
    showTransfer,
    showBulkPay,
    showBulkDelete,
    quickFilterOptions,
    filteredList,
    selectedIds,
    onRequestCloseEmbed,
  ]);

  const handleQuickFilterClick = (id: string | null) => {
    if (id === null) {
      setFiltroRapidoTipo('TODOS');
      setFiltroRapidoStatus('TODOS');
      setFiltroRapidoPrazo('TODOS');
      setFiltroRapidoIpp(false);
      return;
    }

    if (id === 'HOJE' || id === 'AMANHA' || id === 'ATRASADO' || id === 'EM_ABERTO') {
      setFiltroRapidoPrazo((prev) => (prev === id ? 'TODOS' : (id as any)));
    } else if (id === 'PAGO' || id === 'NAO_PAGO') {
      setFiltroRapidoStatus((prev) => (prev === id ? 'TODOS' : (id as any)));
    } else if (id === 'ENTRADAS') {
      setFiltroRapidoTipo((prev) => (prev === 'RECEITA' ? 'TODOS' : 'RECEITA'));
    } else if (id === 'SAIDAS') {
      setFiltroRapidoTipo((prev) => (prev === 'DESPESA' ? 'TODOS' : 'DESPESA'));
    } else if (id === 'IPP') {
      setFiltroRapidoIpp((prev) => !prev);
    }
  };

  const isQuickFilterActive = (id: string | null) => {
    if (id === null) {
      return (
        filtroRapidoTipo === 'TODOS' &&
        filtroRapidoStatus === 'TODOS' &&
        filtroRapidoPrazo === 'TODOS' &&
        !filtroRapidoIpp
      );
    }
    if (id === 'HOJE' || id === 'AMANHA' || id === 'ATRASADO' || id === 'EM_ABERTO') {
      return filtroRapidoPrazo === id;
    }
    if (id === 'PAGO' || id === 'NAO_PAGO') {
      return filtroRapidoStatus === id;
    }
    if (id === 'ENTRADAS') {
      return filtroRapidoTipo === 'RECEITA';
    }
    if (id === 'SAIDAS') {
      return filtroRapidoTipo === 'DESPESA';
    }
    if (id === 'IPP') {
      return filtroRapidoIpp;
    }
    return false;
  };

  if (isContasExtratoEmbed) {
    return (
      <>
        <LancamentoFormDrawer
          showDrawer={showDrawer}
          editarId={selectedEditarId}
          contaId={selectedContaId}
          cartaoId={selectedCartaoId}
          onClose={handleCloseDrawer}
          onSaveSuccess={async () => {
            onRequestCloseEmbed?.();
          }}
          isBoletimEmbed={isBoletimEmbed}
          embedFullscreenDrawer={embedFullscreenDrawer}
          drawerPanelClassName={drawerPanelClassName}
          categorias={categorias}
          entidades={entidades}
          contas={contas}
          cartoes={cartoes}
          centros={centros}
          pushToast={pushToast}
          lancamentos={lancamentos}
          onEntityCreated={(newEntity) => {
            setEntidades((prev) => {
              if (prev.some((e) => e.id === newEntity.id)) return prev;
              return [...prev, newEntity];
            });
          }}
        />

        {toasts.length > 0 && (
          <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={`px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold flex items-center gap-2 ${
                  toast.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300'
                    : toast.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300'
                      : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'
                }`}
              >
                {toast.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : toast.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <Info className="w-4 h-4 shrink-0" />
                )}
                <span className="flex-1">{toast.message}</span>
                <button onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))} className="opacity-70 hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`flex h-full text-slate-800 dark:text-slate-100 overflow-hidden relative ${
        isContasExtratoEmbed ? 'bg-transparent' : 'bg-slate-50 dark:bg-slate-900'
      }`}
    >
      {!isBoletimEmbed && (
        <aside className="hidden">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 p-3">
            <div className="flex w-full flex-col items-center gap-2">
              <button
                type="button"
                onClick={toggleMainSidebar}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Recolher ou expandir menu principal"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowFiltrosSidebar((prev) => !prev)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title={showFiltrosSidebar ? 'Fechar painel de filtros' : 'Abrir painel de filtros'}
              >
                {showFiltrosSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {filtrosRailCollapsed ? (
            <div className="flex flex-1 flex-col items-center gap-3 px-3 py-4">
              <button
                type="button"
                onClick={() => handleQuickFilterClick('ATRASADO')}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  isQuickFilterActive('ATRASADO')
                    ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
                title="Atrasados"
              >
                <AlertCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleQuickFilterClick('EM_ABERTO')}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  isQuickFilterActive('EM_ABERTO')
                    ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
                title="Em aberto"
              >
                <Layers className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetFiltros}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Limpar filtros"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <div className="mt-2 flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 px-2 py-3 text-center dark:border-slate-700">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Ativos</span>
                <span className="text-lg font-black text-slate-700 dark:text-slate-200">{filtrosAtivosCount}</span>
              </div>
            </div>
          ) : null}
        </aside>
      )}

      <div className="min-w-0 flex-1 flex flex-col h-full overflow-hidden">
        {/* 1. TOP HEADER */}
        <header
          className="sticky top-0 bg-white/95 dark:bg-slate-800/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 z-20 shadow-md"
        >
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 shadow-inner border border-slate-200 dark:border-transparent">
                <button
                  onClick={() => setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth() - 1)))}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="w-32 text-center text-xs font-bold uppercase pt-1 text-slate-800 dark:text-white">
                  {mesAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  onClick={() => setMesAtual(new Date(mesAtual.setMonth(mesAtual.getMonth() + 1)))}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => refreshLancamentosVisiveis()}
                className="p-2 text-slate-500 hover:text-blue-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-blue-500 transition-colors"
                title="Sincronizar lançamentos"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => syncCadastros()}
                className="p-2 text-slate-500 hover:text-emerald-500 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-emerald-500 transition-colors"
                title="Sincronizar cadastros"
              >
                <Layers className="w-4 h-4" />
              </button>
            </div>
            <div className="relative hidden min-w-0 flex-1 lg:block lg:max-w-xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar descrição, data, categoria, interessado ou valor"
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 w-full flex flex-col sm:flex-row gap-2 sm:items-center lg:hidden">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Pesquisar descrição, data, categoria, interessado ou valor"
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none transition"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-48">
              <SearchableSelect
                value={centroCustoFiltro}
                onChange={(val: any) => setCentroCustoFiltro(String(val))}
                options={[{
                  label: 'Centro de custo',
                  options: [
                    { id: '', label: 'Todos Centros' },
                    ...centros.map((c) => ({ id: c.id, label: c.nome }))
                  ]
                }]}
              />
            </div>
          </div>

          <div className="flex w-full items-center gap-2 overflow-x-auto lg:w-auto lg:justify-end lg:overflow-visible">
            <div className="hidden shrink-0 lg:block lg:w-56">
              <SearchableSelect
                value={centroCustoFiltro}
                onChange={(val: any) => setCentroCustoFiltro(String(val))}
                options={[{
                  label: 'Centro de custo',
                  options: [
                    { id: '', label: 'Centro de custo' },
                    ...centros.map((c) => ({ id: c.id, label: c.nome }))
                  ]
                }]}
              />
            </div>
            <button
              onClick={() => setShowTransfer(true)}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <ArrowRightLeft className="w-4 h-4" /> <span className="hidden lg:inline">Transf.</span>
            </button>
            <button
              onClick={() => setShowFiltrosSidebar((prev) => !prev)}
              className={`hidden shrink-0 lg:inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold transition-all dark:border-slate-700 ${
                showFiltrosSidebar ? 'border-blue-600 bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Filter className="w-4 h-4" /> Filtros
            </button>
            <button
              onClick={() => setShowFiltrosSidebar(true)}
              className={`lg:hidden shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold transition-all dark:border-slate-600 ${
                showFiltrosSidebar ? 'border-blue-600 bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Filter className="w-4 h-4" /> Filtros
            </button>
            <button
              onClick={() => openDrawer()}
              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 hover:brightness-110"
            >
              <Plus className="w-4 h-4" /> Novo
            </button>
          </div>
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-4 sm:px-6 pt-3 pb-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div className="flex gap-2 overflow-x-auto custom-scrollbar">
              {quickFilterOptions.map((f) => (
                <button
                  key={String(f.id)}
                  onClick={() => handleQuickFilterClick(f.id as string | null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    isQuickFilterActive(f.id as string | null)
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {contaExtratoAtivaId !== null && (
                <button
                  onClick={() => setContaExtratoAtivaId(null)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold border border-cyan-300 bg-cyan-50 text-cyan-700 dark:bg-cyan-900/25 dark:border-cyan-700 dark:text-cyan-300 flex items-center gap-1.5 whitespace-nowrap"
                >
                  Extrato: {contas.find((c) => Number(c.id) === contaExtratoAtivaId)?.nome || `Conta ${contaExtratoAtivaId}`}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="shrink-0 flex items-center">
              <button
                type="button"
                onClick={() => setShowResumoKpis((prev) => !prev)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition whitespace-nowrap ${showResumoKpis ? 'border-blue-600 bg-blue-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showResumoKpis ? 'rotate-180' : ''}`} />
                KPI de receitas e despesas
              </button>
            </div>
          </div>

          <KpiCards kpis={kpis} showResumoKpis={showResumoKpis} />

          <LancamentosTable
            grouped={grouped}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            toggleIpp={toggleIpp}
            openDrawer={openDrawer}
            entidades={entidades}
            categorias={categorias}
            listaSort={listaSort}
            toggleListaSort={toggleListaSort}
            contaExtratoAtivaId={contaExtratoAtivaId}
            savingIppIds={savingIppIds}
            filtroTexto={filtroTexto}
          />
        </div>
      </div>

      <BulkActionsBar
        selectedIds={selectedIds}
        setShowBulkPay={setShowBulkPay}
        openBulkDelete={openBulkDelete}
        setSelectedIds={setSelectedIds}
      />

      <FiltrosSidebar
        showFiltrosSidebar={showFiltrosSidebar}
        setShowFiltrosSidebar={setShowFiltrosSidebar}
        filtrosAvancados={filtrosAvancados}
        setFiltrosAvancados={setFiltrosAvancados}
        isQuickFilterActive={isQuickFilterActive}
        handleQuickFilterClick={handleQuickFilterClick}
        resetFiltros={resetFiltros}
        categorias={categorias}
        contas={contas}
        centros={centros}
        centroCustoFiltro={centroCustoFiltro}
        setCentroCustoFiltro={setCentroCustoFiltro}
        contaExtratoAtivaId={contaExtratoAtivaId}
        setContaExtratoAtivaId={setContaExtratoAtivaId}
      />

      <TransferModal
        showTransfer={showTransfer}
        setShowTransfer={setShowTransfer}
        transferData={transferData}
        setTransferData={setTransferData}
        contas={contas}
        centros={centros}
        handleTransferencia={handleTransferencia}
        saving={saving}
      />

      <BulkPayModal
        showBulkPay={showBulkPay}
        setShowBulkPay={setShowBulkPay}
        bulkPayData={bulkPayData}
        setBulkPayData={setBulkPayData}
        contas={contas}
        handleBulkPay={handleBulkPay}
        saving={saving}
      />

      <BulkDeleteModal
        showBulkDelete={showBulkDelete}
        setShowBulkDelete={setShowBulkDelete}
        selectedIds={selectedIds}
        hasSelectedCompensados={hasSelectedCompensados}
        selectedCompensadosCount={selectedCompensados.length}
        deleteStep={deleteStep}
        setDeleteStep={setDeleteStep}
        deleteReason={deleteReason}
        setDeleteReason={setDeleteReason}
        deletePhrase={deletePhrase}
        setDeletePhrase={setDeletePhrase}
        deletePaidPhrase={deletePaidPhrase}
        setDeletePaidPhrase={setDeletePaidPhrase}
        handleBulkDelete={handleBulkDelete}
        saving={saving}
      />

      <LancamentoFormDrawer
        showDrawer={showDrawer}
        editarId={selectedEditarId}
        contaId={selectedContaId}
        cartaoId={selectedCartaoId}
        onClose={handleCloseDrawer}
        onSaveSuccess={async () => {
          if (filtrosAvancados.dataModo === 'PAGAMENTO' && (filtrosAvancados.dataInicio || filtrosAvancados.dataFim)) {
            await loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
          } else if (filtrosAvancados.dataInicio) {
            await loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
          } else {
            const ano = mesAtual.getFullYear();
            const mes = mesAtual.getMonth() + 1;
            await loadLancamentos(
              new Date(ano, mes - 1, 1).toISOString().split('T')[0],
              new Date(ano, mes, 0).toISOString().split('T')[0],
              { force: true }
            );
          }
          await refreshContasComSaldo();
        }}
        isBoletimEmbed={isBoletimEmbed}
        embedFullscreenDrawer={embedFullscreenDrawer}
        drawerPanelClassName={drawerPanelClassName}
        categorias={categorias}
        entidades={entidades}
        contas={contas}
        cartoes={cartoes}
        centros={centros}
        pushToast={pushToast}
        lancamentos={lancamentos}
        onEntityCreated={(newEntity) => {
          setEntidades((prev) => {
            if (prev.some((e) => e.id === newEntity.id)) return prev;
            return [...prev, newEntity];
          });
        }}
      />
      
      {showFaturaDrawer && selectedFaturaVirtual && (
        <FaturaVirtualDrawer
          isOpen={showFaturaDrawer}
          onClose={() => {
            setShowFaturaDrawer(false);
            setSelectedFaturaVirtual(null);
          }}
          fatura={selectedFaturaVirtual}
          contas={contas}
          onSuccess={() => {
            refreshLancamentosVisiveis();
          }}
        />
      )}

      {isBoletimEmbed && !isContasExtratoEmbed && !showDrawer && (
        <div className="flex h-full w-full items-center justify-center bg-slate-50 text-center dark:bg-slate-900">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-44 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-11 w-full rounded-lg bg-slate-100 dark:bg-slate-700/70" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-700/70" />
                <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-700/70" />
              </div>
              <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-700/70" />
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold flex items-center gap-2 ${
                toast.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300'
                  : toast.type === 'error'
                    ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300'
                    : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <Info className="w-4 h-4 shrink-0" />
              )}
              <span className="flex-1">{toast.message}</span>
              <button onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))} className="opacity-70 hover:opacity-100">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
