import { useEffect, useState, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fetchLancamentosPaged, normalizeListResponse } from '../../services/api';
import { useAssistentePage } from '../../components/AssistentePageContext';
import { useLookupStore } from '../../store/lookupStore';
import { useAuthStore } from '../../store/authStore';
import { buildOperationalCategoriaIds } from '../../utils/planoContas';
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
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

  // --- DADOS ---
  const [loading, setLoading] = useState(true);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [cartoes, setCartoes] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);

  // --- UI STATE ---
  const [mesAtual, setMesAtual] = useState(new Date());
  const [filtroTexto, setFiltroTexto] = useState('');
  const [centroCustoFiltro, setCentroCustoFiltro] = useState<string>('');

  const [filtrosAvancados, setFiltrosAvancados] = useState({
    tipo: 'TODOS' as 'TODOS' | 'RECEITA' | 'DESPESA',
    status: [] as string[],
    contaIds: new Set<number>(),
    categoriaIds: new Set<number>(),
    centroCustoPresenca: 'TODOS' as 'TODOS' | 'COM' | 'SEM',
    dataModo: 'VENCIMENTO' as 'VENCIMENTO' | 'PAGAMENTO',
    dataInicio: '',
    dataFim: '',
    ocultarVendasCartaoPendentes: true,
  });
  const [filtroRapido, setFiltroRapido] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosRailCollapsed] = useState(true);
  const [headerHeightPx, setHeaderHeightPx] = useState(0);
  const lancamentosHeaderRef = useRef<HTMLElement | null>(null);
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
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectedEditarId, setSelectedEditarId] = useState<number | null>(null);
  const [selectedContaId, setSelectedContaId] = useState<number | null>(null);
  const [selectedCartaoId, setSelectedCartaoId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

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
  const invalidateEntidades = useLookupStore((state) => state.invalidateEntidades);
  const invalidateEntidadesLookup = useLookupStore((state) => state.invalidateEntidadesLookup);
  const invalidatePlanoContas = useLookupStore((state) => state.invalidatePlanoContas);



  useEffect(() => {
    localStorage.setItem('lancamentos.filtrosRailCollapsed', filtrosRailCollapsed ? '1' : '0');
  }, [filtrosRailCollapsed]);

  useEffect(() => {
    const headerEl = lancamentosHeaderRef.current;
    if (!headerEl) return;

    const updateHeaderHeight = () => {
      setHeaderHeightPx(Math.ceil(headerEl.getBoundingClientRect().height));
    };

    updateHeaderHeight();

    const observer = new ResizeObserver(() => {
      updateHeaderHeight();
    });

    observer.observe(headerEl);
    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  const pushToast = (type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const getVisibleRange = () => {
    if (filtrosAvancados.dataModo === 'VENCIMENTO' && filtrosAvancados.dataInicio && filtrosAvancados.dataFim) {
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
    if (filtrosAvancados.dataModo === 'PAGAMENTO' && (filtrosAvancados.dataInicio || filtrosAvancados.dataFim)) {
      loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
    } else if (!filtrosAvancados.dataInicio && !filtrosAvancados.dataFim) {
      const ano = mesAtual.getFullYear();
      const mes = mesAtual.getMonth() + 1;
      const ini = new Date(ano, mes - 1, 1).toISOString().split('T')[0];
      const fim = new Date(ano, mes, 0).toISOString().split('T')[0];
      loadLancamentos(ini, fim);
    } else {
      loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim);
    }
  }, [currentEmpresaId, mesAtual, filtrosAvancados.dataInicio, filtrosAvancados.dataFim, filtrosAvancados.dataModo, filtrosAvancados.ocultarVendasCartaoPendentes]);

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
  }, [searchParams]);

  async function loadAuxData() {
    if (auxLoadedRef.current) return;
    try {
      const [rC, rCt, rCC, rE, rCat] = await Promise.all([
        api.get('/contas/', { params: { include_saldo: true } }),
        api.get('/cartoes/'),
        api.get('/centro-custo/'),
        fetchEntidadesLookup(),
        fetchPlanoContas(),
      ]);
      setContas(normalizeListResponse<any>(rC.data));
      setCartoes(normalizeListResponse<any>(rCt.data));
      setCentros(normalizeListResponse<any>(rCC.data));
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
    invalidateEntidades();
    invalidateEntidadesLookup();
    invalidatePlanoContas();

    void loadAuxData();
  }, [currentEmpresaId, invalidateEntidades, invalidateEntidadesLookup, invalidatePlanoContas]);

  async function syncCadastros(options?: { silent?: boolean }) {
    try {
      const [rE, rCat, rC] = await Promise.all([
        fetchEntidadesLookup(true),
        fetchPlanoContas(true),
        api.get('/contas/', { params: { include_saldo: true } }),
      ]);
      setEntidades(normalizeListResponse<any>(rE));
      setCategorias(normalizeListResponse<any>(rCat));
      setContas(normalizeListResponse<any>(rC.data));
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



  async function loadLancamentos(ini?: string, fim?: string, opts?: { force?: boolean; skipFallback?: boolean }) {
    const key = `${currentEmpresaId ?? ''}|${ini || ''}|${fim || ''}|${filtrosAvancados.ocultarVendasCartaoPendentes}`;
    if (!opts?.force && key === lastLancamentosKeyRef.current && lancamentos.length > 0) return;
    lastLancamentosKeyRef.current = key;

    if (lancamentosAbortRef.current) {
      lancamentosAbortRef.current.abort();
    }
    const controller = new AbortController();
    lancamentosAbortRef.current = controller;

    setLoading(true);
    try {
      const params: any = {};
      if (ini) params.data_inicio = ini;
      if (fim) params.data_fim = fim;
      if (filtrosAvancados.ocultarVendasCartaoPendentes) {
        params.ocultar_vendas_cartao_pendentes = true;
      }
      const rows = await fetchLancamentosPaged<Lancamento>(params, { pageSize: 1500, signal: controller.signal });
      setLancamentos(rows);
    } catch (e: any) {
      if (e?.code === 'ERR_CANCELED') return;
      console.error(e);
    } finally {
      if (lancamentosAbortRef.current === controller) {
        lancamentosAbortRef.current = null;
        setLoading(false);
      }
    }
  }

  async function toggleIpp(l: Lancamento) {
    const next = !l.ipp;
    setLancamentos((prev) => prev.map((item) => (item.id === l.id ? { ...item, ipp: next } : item)));
    try {
      await api.put(`/lancamentos/${l.id}`, { ipp: next });
    } catch (e) {
      console.error(e);
      setLancamentos((prev) => prev.map((item) => (item.id === l.id ? { ...item, ipp: l.ipp } : item)));
      pushToast('error', 'Não foi possível marcar/desmarcar IPP.');
    }
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
    const categoriasPorId = new Map(categorias.map((categoria: any) => [Number(categoria.id), String(categoria.nome || '')]));
    const entidadesPorId = new Map(
      entidades.map((entidade: any) => [Number(entidade.id), String(entidade.nome || entidade.razao_social || '')])
    );

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

      // 3. Filtros Rápidos
      const hoje = getTodayLocalYmd();
      const amanha = getTomorrowLocalYmd();
      const pago = isLancamentoPago(l);
      if (filtroRapido === 'HOJE' && (l.data_vencimento !== hoje || pago)) return false;
      if (filtroRapido === 'AMANHA' && l.data_vencimento !== amanha) return false;
      if (filtroRapido === 'IPP' && !l.ipp) return false;
      if (filtroRapido === 'ATRASADO' && !isLancamentoAtrasado(l)) return false;
      if (filtroRapido === 'PAGO' && !pago) return false;
      if (filtroRapido === 'NAO_PAGO' && pago) return false;
      if (filtroRapido === 'EM_ABERTO' && (pago || isLancamentoAtrasado(l))) return false;

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

      return true;
    });
  }, [
    lancamentos,
    boletimIdsFiltro,
    filtroTexto,
    centroCustoFiltro,
    filtroRapido,
    filtrosAvancados,
    contaExtratoAtivaId,
    categorias,
    entidades,
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
    const interessadosPorId = new Map(
      entidades.map((entidade: any) => [
        Number(entidade.id),
        String(entidade.nome || entidade.razao_social || ''),
      ])
    );

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
      if (!groups[l.data_vencimento]) groups[l.data_vencimento] = [];
      groups[l.data_vencimento].push(l);
      const origem = String((l as any).origem || '').toUpperCase();
      const contaNosResultados = categoriasOperacionaisResultado.has(Number(l.plano_contas_id));
      if (origem !== 'TRANSFERENCIA' && contaNosResultados) {
        if (l.tipo === 'RECEITA') r += Number(l.valor_previsto);
        else d += Number(l.valor_previsto);
      }
    });

    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    sortedDates.forEach((date) => groups[date].sort(compareLancamentos));

    return { grouped: { groups, sortedDates }, kpis: { r, d, s: r - d } };
  }, [filteredList, categorias, entidades, listaSort]);

  const aiContexto = useMemo(() => {
    return {
      mesReferencia: mesAtual.toISOString().slice(0, 7),
      filtros: {
        texto: filtroTexto,
        centroCusto: centroCustoFiltro || null,
        possuiCentroCusto: filtrosAvancados.centroCustoPresenca,
        filtroRapido,
        tipo: filtrosAvancados.tipo,
        dataModo: filtrosAvancados.dataModo,
        dataInicio: filtrosAvancados.dataInicio || null,
        dataFim: filtrosAvancados.dataFim || null,
        contasSelecionadas: Array.from(filtrosAvancados.contaIds),
        categoriasSelecionadas: Array.from(filtrosAvancados.categoriaIds),
      },
      metricas: {
        totalFiltrado: filteredList.length,
        totalDiasComLancamento: grouped.sortedDates.length,
        receitas: kpis.r,
        despesas: kpis.d,
        saldo: kpis.s,
      },
      lookups: {
        categorias: categorias.slice(0, 200).map((c: any) => ({ id: c.id, nome: c.nome, tipo: c.tipo })),
        contas: contas.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome })),
        centros: centros.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome })),
        entidades: entidades.slice(0, 200).map((e: any) => ({ id: e.id, nome: e.nome })),
        cartoes: cartoes.slice(0, 120).map((c: any) => ({ id: c.id, nome: c.nome_cartao })),
      },
      extratoContaAtivaId: contaExtratoAtivaId,
    };
  }, [
    mesAtual,
    filtroTexto,
    centroCustoFiltro,
    filtroRapido,
    filtrosAvancados,
    filteredList.length,
    grouped.sortedDates.length,
    kpis,
    categorias,
    contas,
    centros,
    entidades,
    cartoes,
    contaExtratoAtivaId,
  ]);

  const assistenteConfig = useMemo(
    () => ({
      tela: 'lancamentos' as const,
      titulo: 'Assistente KyrusTECH',
      contexto: aiContexto,
      lookups: {
        categorias: categorias.slice(0, 200).map((item: any) => ({ id: item.id, nome: item.nome, tipo: item.tipo })),
        contas: contas.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome })),
        centros: centros.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome })),
        entidades: entidades.slice(0, 200).map((item: any) => ({ id: item.id, nome: item.nome })),
        cartoes: cartoes.slice(0, 120).map((item: any) => ({ id: item.id, nome: item.nome_cartao })),
      },
      sugestoes: [
        'O que os lancamentos desta tela mostram?',
        'Como reduzir pendencias e atrasos?',
        'Leia este comprovante e sugira a classificacao.',
        'Qual filtro usar para investigar melhor o resultado?',
      ],
    }),
    [aiContexto, categorias, contas, centros, entidades, cartoes]
  );

  useAssistentePage(assistenteConfig);

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

  const openDrawer = (item?: Lancamento, defaultContaId?: number | null, defaultCartaoId?: number | null) => {
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
      ocultarVendasCartaoPendentes: true,
    });
    setFiltroTexto('');
    setCentroCustoFiltro('');
    setFiltroRapido(null);
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
  ];

  const filtrosAtivosCount = [
    filtroTexto ? 1 : 0,
    centroCustoFiltro ? 1 : 0,
    filtroRapido ? 1 : 0,
    filtrosAvancados.tipo !== 'TODOS' ? 1 : 0,
    filtrosAvancados.centroCustoPresenca !== 'TODOS' ? 1 : 0,
    filtrosAvancados.dataInicio || filtrosAvancados.dataFim ? 1 : 0,
    filtrosAvancados.contaIds.size > 0 ? 1 : 0,
    filtrosAvancados.categoriaIds.size > 0 ? 1 : 0,
    contaExtratoAtivaId !== null ? 1 : 0,
  ].filter(Boolean).length;



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
                onClick={() => setFiltroRapido((prev) => (prev === 'ATRASADO' ? null : 'ATRASADO'))}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  filtroRapido === 'ATRASADO'
                    ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
                title="Atrasados"
              >
                <AlertCircle className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFiltroRapido((prev) => (prev === 'EM_ABERTO' ? null : 'EM_ABERTO'))}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  filtroRapido === 'EM_ABERTO'
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
          ref={lancamentosHeaderRef}
          className="fixed top-[66px] left-0 right-0 md:left-[76px] bg-white/95 dark:bg-slate-800/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 z-20 shadow-md"
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
                onClick={() => loadLancamentos(undefined, undefined, { force: true })}
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
                type="text"
                placeholder="Pesquisar descrição, data, categoria, interessado ou valor"
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none transition"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-48">
              <select
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-white outline-none focus:border-blue-500"
                value={centroCustoFiltro}
                onChange={(e) => setCentroCustoFiltro(e.target.value)}
              >
                <option value="">Todos Centros</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 overflow-x-auto lg:w-auto lg:justify-end lg:overflow-visible">
            <div className="hidden shrink-0 lg:block lg:w-56">
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                value={centroCustoFiltro}
                onChange={(e) => setCentroCustoFiltro(e.target.value)}
              >
                <option value="">Centro de custo</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
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
          style={{ paddingTop: headerHeightPx > 0 ? `${headerHeightPx}px` : undefined }}
        >
          <div className="px-4 sm:px-6 pt-3 pb-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
            <div className="flex gap-2 overflow-x-auto custom-scrollbar">
              {quickFilterOptions.map((f) => (
                <button
                  key={String(f.id)}
                  onClick={() => setFiltroRapido(f.id as any)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap ${
                    filtroRapido === f.id
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
          </div>

          <KpiCards kpis={kpis} />

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
        filtroRapido={filtroRapido}
        setFiltroRapido={setFiltroRapido}
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
        onClose={() => {
          setShowDrawer(false);
          setSelectedContaId(null);
          setSelectedCartaoId(null);
        }}
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
      />

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
