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

import type { Lancamento, Anexo, ToastItem, ListaSortKey, ListaSortDirection, LancamentosProps } from './types';
import {
  formatDateExtenso,
  formatDateShort,
  getTodayLocalYmd,
  getTomorrowLocalYmd,
  getLocalYmdDaysAgo,
  toNextBusinessDay,
  parseDescricaoParcela,
  isLancamentoAtrasado,
  isLancamentoPago,
  formatCompetencia,
  isTransferencia,
  computeCartaoVencimento,
} from './utils';

import { KpiCards } from './components/KpiCards';
import { FiltrosSidebar } from './components/FiltrosSidebar';
import { TransferModal } from './components/TransferModal';
import { BulkActionsBar } from './components/BulkActionsBar';
import { BulkPayModal } from './components/BulkPayModal';
import { BulkDeleteModal } from './components/BulkDeleteModal';
import { QuickEntityDrawer } from './components/QuickEntityDrawer';
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
  const [showEntityDrawer, setShowEntityDrawer] = useState(false);

  // --- FORMS ---
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<FileList | null>(null);
  const [initialDrawerFormSnapshot, setInitialDrawerFormSnapshot] = useState('');
  const [initialScopedFields, setInitialScopedFields] = useState({
    descricao: '',
    plano_contas_id: '',
    data_vencimento: '',
  });
  const [parcelasSerie, setParcelasSerie] = useState<Lancamento[]>([]);
  const [parcelasSerieLoading, setParcelasSerieLoading] = useState(false);
  const [parcelasVencimentosEdit, setParcelasVencimentosEdit] = useState<Record<number, string>>({});
  const [ajustarParaDiaUtil, setAjustarParaDiaUtil] = useState(false);
  const [showParcelasSeriePanel, setShowParcelasSeriePanel] = useState(false);

  const [formData, setFormData] = useState<any>({
    id: null,
    descricao: '',
    valor_previsto: '',
    data_vencimento: '',
    tipo: 'DESPESA',
    plano_contas_id: '',
    centro_custo_id: '',
    entidade_id: '',
    conta_id: '',
    cartao_id: '',
    status: 'PENDENTE',
    valor_pago: '',
    data_pagamento: '',
    ipp: false,
    previsto: false,
    competencia: '',
    observacao: '',
    is_parcelado: false,
    qtd_parcelas: 2,
    modo_calculo: 'TOTAL',
    competencia_modo_parcelamento: 'POR_PARCELA',
    anexos: [],
  });

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
  const autoPagamentoRef = useRef(true);
  const autoCompetenciaRef = useRef(true);
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

  const buildDrawerFormSnapshot = (data: any) =>
    JSON.stringify({
      id: data.id || null,
      descricao: data.descricao || '',
      valor_previsto: String(data.valor_previsto || ''),
      data_vencimento: data.data_vencimento || '',
      tipo: data.tipo || 'DESPESA',
      plano_contas_id: String(data.plano_contas_id || ''),
      centro_custo_id: String(data.centro_custo_id || ''),
      entidade_id: String(data.entidade_id || ''),
      conta_id: String(data.conta_id || ''),
      cartao_id: String(data.cartao_id || ''),
      status: data.status || 'PENDENTE',
      valor_pago: String(data.valor_pago || ''),
      data_pagamento: data.data_pagamento || '',
      previsto: data.previsto ?? false,
      competencia: data.competencia || '',
      observacao: data.observacao || '',
      is_parcelado: Boolean(data.is_parcelado),
      qtd_parcelas: Number(data.qtd_parcelas || 2),
      modo_calculo: data.modo_calculo || 'TOTAL',
      competencia_modo_parcelamento: data.competencia_modo_parcelamento || 'POR_PARCELA',
    });

  const hasUnsavedDrawerChanges = useMemo(() => {
    if (!showDrawer) return false;
    if (!initialDrawerFormSnapshot) return false;
    if (filesToUpload && filesToUpload.length > 0) return true;
    return buildDrawerFormSnapshot(formData) !== initialDrawerFormSnapshot;
  }, [showDrawer, initialDrawerFormSnapshot, formData, filesToUpload]);

  const closeDrawerDirect = () => {
    setShowDrawer(false);
    setInitialDrawerFormSnapshot('');
    setFilesToUpload(null);
    setParcelasSerie([]);
    setParcelasVencimentosEdit({});
    setAjustarParaDiaUtil(false);
    setShowParcelasSeriePanel(false);
    setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
  };

  const sortedParcelasSerie = useMemo(() => {
    return [...parcelasSerie].sort((a, b) => {
      const parcelaA = Number(a.numero_parcela || 0);
      const parcelaB = Number(b.numero_parcela || 0);
      if (parcelaA !== parcelaB) return parcelaA - parcelaB;
      return String(a.data_vencimento || '').localeCompare(String(b.data_vencimento || ''));
    });
  }, [parcelasSerie]);

  const currentParcelaNumber = useMemo(() => {
    if (formData?.numero_parcela) return Number(formData.numero_parcela);
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.numero) return parsed.numero;
    const idx = sortedParcelasSerie.findIndex((p) => Number(p.id) === Number(formData?.id));
    return idx >= 0 ? idx + 1 : 1;
  }, [formData?.id, formData?.numero_parcela, formData?.descricao, sortedParcelasSerie]);

  const currentParcelaTotal = useMemo(() => {
    if (sortedParcelasSerie.length > 1) return sortedParcelasSerie.length;
    const parsed = parseDescricaoParcela(formData?.descricao);
    if (parsed?.total && parsed.total > 1) return parsed.total;
    if (formData?.qtd_parcelas && Number(formData.qtd_parcelas) > 1) return Number(formData.qtd_parcelas);
    return 1;
  }, [sortedParcelasSerie.length, formData?.descricao, formData?.qtd_parcelas]);

  const isEditingParcelado = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return currentParcelaTotal > 1;
    if (Number(formData?.numero_parcela || 0) > 0 && currentParcelaTotal > 1) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao, currentParcelaTotal]);

  const canOpenParcelasSerie = useMemo(() => {
    if (!isEditing) return false;
    if (Boolean(formData?.id_parcelamento)) return true;
    if (Number(formData?.numero_parcela || 0) > 0) return true;
    return Boolean(parseDescricaoParcela(formData?.descricao));
  }, [isEditing, formData?.id_parcelamento, formData?.numero_parcela, formData?.descricao]);

  const loadParcelasSerie = async (parcelamentoId?: string, referencia?: Lancamento) => {
    if (!parcelamentoId) {
      const ref = referencia || (formData as Lancamento | undefined);
      const parsedRef = parseDescricaoParcela(ref?.descricao);
      if (!parsedRef) {
        setParcelasSerie([]);
        setParcelasVencimentosEdit({});
        return;
      }

      const buildSerieFromDataset = (dataset: Lancamento[]) => {
        const similares = (dataset || [])
          .filter((item) => {
            const parsedItem = parseDescricaoParcela(item.descricao);
            if (!parsedItem) return false;
            if (parsedItem.base !== parsedRef.base || parsedItem.total !== parsedRef.total) return false;
            if (String(item.tipo || '') !== String(ref?.tipo || '')) return false;
            if (Number(item.plano_contas_id || 0) !== Number(ref?.plano_contas_id || 0)) return false;

            const contaRef = Number(ref?.conta_id || 0);
            const contaItem = Number(item.conta_id || 0);
            const cartaoRef = Number(ref?.cartao_id || 0);
            const cartaoItem = Number(item.cartao_id || 0);

            if (contaRef && contaItem && contaRef !== contaItem) return false;
            if (cartaoRef && cartaoItem && cartaoRef !== cartaoItem) return false;
            return true;
          })
          .map((item) => {
            const parsedItem = parseDescricaoParcela(item.descricao);
            return {
              ...item,
              numero_parcela: item.numero_parcela || parsedItem?.numero,
            };
          });

        return ref && !similares.some((item) => Number(item.id) === Number(ref.id))
          ? [...similares, { ...ref, numero_parcela: ref.numero_parcela || parsedRef.numero }]
          : similares;
      };

      let withRef = buildSerieFromDataset(lancamentos || []);

      if (withRef.length < parsedRef.total) {
        setParcelasSerieLoading(true);
        try {
          const refYear = Number(String(ref?.data_vencimento || '').slice(0, 4)) || new Date().getFullYear();
          const rows = await fetchLancamentosPaged<Lancamento>(
            {
              data_inicio: `${refYear - 2}-01-01`,
              data_fim: `${refYear + 2}-12-31`,
              include_anexos: false,
            },
            { pageSize: 1500 }
          );
          withRef = buildSerieFromDataset(rows);
        } catch {
          // Mantém a série local se a busca ampla não responder.
        } finally {
          setParcelasSerieLoading(false);
        }
      }

      setParcelasSerie(withRef);
      setParcelasVencimentosEdit(
        withRef.reduce((acc: Record<number, string>, item: Lancamento) => {
          acc[item.id] = item.data_vencimento;
          return acc;
        }, {})
      );
      return;
    }
    setParcelasSerieLoading(true);
    try {
      const res = await api.get(`/lancamentos/parcelamento/${parcelamentoId}`);
      const serie = Array.isArray(res.data) ? res.data : [];
      setParcelasSerie(serie);
      setParcelasVencimentosEdit(
        serie.reduce((acc: Record<number, string>, item: Lancamento) => {
          acc[item.id] = item.data_vencimento;
          return acc;
        }, {})
      );
    } catch {
      setParcelasSerie([]);
      setParcelasVencimentosEdit({});
      pushToast('error', 'Não foi possível carregar as parcelas desta série.');
    } finally {
      setParcelasSerieLoading(false);
    }
  };

  const requestCloseDrawer = async () => {
    if (saving) return;
    if (!hasUnsavedDrawerChanges) {
      closeDrawerDirect();
      return;
    }
    const shouldSave = window.confirm(
      'Você alterou informações e ainda não salvou. Você deseja salvar a informação antes de sair?'
    );
    if (shouldSave) {
      await handleSave();
      return;
    }
    closeDrawerDirect();
  };

  const handleVerTodasParcelas = async () => {
    if (!canOpenParcelasSerie) {
      pushToast('info', 'Este lançamento não possui série de parcelamento identificada.');
      return;
    }
    setShowParcelasSeriePanel(true);
    await loadParcelasSerie(formData?.id_parcelamento, formData as Lancamento);
  };

  const handleSelecionarParcelaSerie = (item: Lancamento) => {
    if (Number(item.id) === Number(formData?.id)) return;
    autoPagamentoRef.current = !item.data_pagamento;
    autoCompetenciaRef.current = !item.competencia;

    const nextFormData: any = {
      ...item,
      data_vencimento: item.cartao_id ? (item.data_competencia || item.data_vencimento) : item.data_vencimento,
      conta_id: item.conta_id || '',
      cartao_id: item.cartao_id || '',
      centro_custo_id: item.centro_custo_id || '',
      entidade_id: item.entidade_id || '',
      plano_contas_id: item.plano_contas_id,
      valor_previsto: item.valor_previsto,
      valor_pago: item.valor_pago || item.valor_previsto,
      data_pagamento: item.data_pagamento || item.data_vencimento,
      previsto: item.previsto ?? true,
      observacao: item.observacao || '',
      competencia: item.competencia || formatCompetencia(item.data_competencia || item.data_vencimento),
      competencia_modo_parcelamento: 'POR_PARCELA',
    };

    setIsEditing(true);
    setFormData(nextFormData);
    setInitialScopedFields({
      descricao: String(item.descricao || ''),
      plano_contas_id: String(item.plano_contas_id || ''),
      data_vencimento: String(item.data_vencimento || ''),
    });
    setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(nextFormData));
    setShowParcelasSeriePanel(true);
    setFilesToUpload(null);
  };

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
  }, [currentEmpresaId, mesAtual, filtrosAvancados.dataInicio, filtrosAvancados.dataFim, filtrosAvancados.dataModo]);

  useEffect(() => {
    if (centros.length === 1) {
      const onlyId = String(centros[0].id);
      setCentroCustoFiltro((prev) => prev || onlyId);
      setFormData((prev: typeof formData) => (prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId }));
      setTransferData((prev) => (prev.centro_custo_id ? prev : { ...prev, centro_custo_id: onlyId }));
    }
  }, [centros]);

  useEffect(() => {
    if (quickOpenNovoHandledRef.current) return;
    if (searchParams.get('novo') !== '1') return;
    if (!auxLoadedRef.current || contas.length === 0) return;

    openDrawer();
    const cartaoIdParam = Number(searchParams.get('cartao_id') || '');
    const contaIdParam = Number(searchParams.get('conta_id') || '');
    if (Number.isFinite(cartaoIdParam) && cartaoIdParam > 0) {
      setFormData((prev: any) => ({ ...prev, cartao_id: String(cartaoIdParam), conta_id: '' }));
    } else if (Number.isFinite(contaIdParam) && contaIdParam > 0) {
      setFormData((prev: any) => ({ ...prev, conta_id: String(contaIdParam), cartao_id: '' }));
    }

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

  const recoverLancamentoState = async () => {
    await syncCadastros({ silent: true });
    await refreshLancamentosVisiveis();
    await refreshContasComSaldo();
  };

  async function loadLancamentos(ini?: string, fim?: string, opts?: { force?: boolean; skipFallback?: boolean }) {
    const key = `${currentEmpresaId ?? ''}|${ini || ''}|${fim || ''}`;
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
      if (filtroRapido === 'HOJE' && l.data_vencimento !== hoje) return false;
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

  const toggleConta = (id: number) => {
    setFormData((prev: any) => ({ ...prev, conta_id: prev.conta_id === id ? '' : id, cartao_id: '' }));
  };

  const toggleCartao = (id: number) => {
    setFormData((prev: any) => ({ ...prev, cartao_id: prev.cartao_id === id ? '' : id, conta_id: '' }));
  };

  const handleVencimentoChange = (value: string) => {
    setFormData((prev: any) => {
      const next = { ...prev, data_vencimento: value };
      const prevCompetencia = formatCompetencia(prev.data_vencimento);
      const nextCompetencia = formatCompetencia(value);
      if (autoCompetenciaRef.current || !prev.competencia || prev.competencia === prevCompetencia) {
        next.competencia = nextCompetencia;
        autoCompetenciaRef.current = true;
      }
      if (
        prev.status === 'PAGO' &&
        (autoPagamentoRef.current || !prev.data_pagamento || prev.data_pagamento === prev.data_vencimento)
      ) {
        next.data_pagamento = value;
        autoPagamentoRef.current = true;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!formData?.id || !formData?.data_vencimento || sortedParcelasSerie.length === 0) return;
    setParcelasVencimentosEdit((prev) => ({ ...prev, [formData.id]: formData.data_vencimento }));
  }, [formData?.id, formData?.data_vencimento, sortedParcelasSerie.length]);

  const handleCompetenciaChange = (value: string) => {
    autoCompetenciaRef.current = false;
    setFormData((prev: any) => ({ ...prev, competencia: value }));
  };

  const handleStatusPagoChange = (checked: boolean) => {
    setFormData((prev: any) => {
      const next = { ...prev, status: checked ? 'PAGO' : 'PENDENTE' };
      if (checked && (autoPagamentoRef.current || !prev.data_pagamento)) {
        next.data_pagamento = prev.data_vencimento;
        autoPagamentoRef.current = true;
      }
      if (checked && (!prev.valor_pago || Number(prev.valor_pago) === 0)) {
        next.valor_pago = prev.valor_previsto;
      }
      if (!checked) {
        next.conta_id = '';
      }
      return next;
    });
  };

  const handleValorPrevistoChange = (value: string) => {
    setFormData((prev: any) => {
      const next = { ...prev, valor_previsto: value };
      const valorPagoAtual = Number(prev.valor_pago || 0);
      const valorPrevistoAnterior = Number(prev.valor_previsto || 0);

      if (prev.status === 'PAGO' && (!prev.valor_pago || valorPagoAtual === 0 || valorPagoAtual === valorPrevistoAnterior)) {
        next.valor_pago = value;
      }

      return next;
    });
  };

  const handleValorPagoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, valor_pago: value }));
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
    });
    setFiltroTexto('');
    setCentroCustoFiltro('');
    setFiltroRapido(null);
    setContaExtratoAtivaId(null);
    setMesAtual(new Date());
  };

  const toggleMainSidebar = () => {
    window.dispatchEvent(new CustomEvent('kyrus:sidebar-toggle'));
  };

  const handleDataPagamentoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, data_pagamento: value }));
  };

  function openDrawer(l?: Lancamento, options?: { preserveSeriePanel?: boolean }) {
    let nextFormData: any;
    if (l) {
      if (isTransferencia(l)) return;
      setIsEditing(true);
      autoPagamentoRef.current = !l.data_pagamento;
      autoCompetenciaRef.current = !l.competencia;
      nextFormData = {
        ...l,
        data_vencimento: l.cartao_id ? (l.data_competencia || l.data_vencimento) : l.data_vencimento,
        conta_id: l.conta_id || '',
        cartao_id: l.cartao_id || '',
        centro_custo_id: l.centro_custo_id || '',
        entidade_id: l.entidade_id || '',
        plano_contas_id: l.plano_contas_id,
        valor_previsto: l.valor_previsto,
        valor_pago: l.valor_pago || l.valor_previsto,
        data_pagamento: l.data_pagamento || l.data_vencimento,
        previsto: l.previsto ?? true,
        observacao: l.observacao || '',
        competencia: l.competencia || formatCompetencia(l.data_competencia || l.data_vencimento),
        competencia_modo_parcelamento: 'POR_PARCELA',
      };
      setInitialScopedFields({
        descricao: String(l.descricao || ''),
        plano_contas_id: String(l.plano_contas_id || ''),
        data_vencimento: String(l.data_vencimento || ''),
      });
      setShowParcelasSeriePanel(Boolean(options?.preserveSeriePanel));
      setAjustarParaDiaUtil(false);
      void loadParcelasSerie(l.id_parcelamento, l);

      if (l.entidade_id && !entidades.some((item: any) => Number(item.id) === Number(l.entidade_id))) {
        void (async () => {
          try {
            const response = await api.get(`/entidades/${l.entidade_id}`);
            const entidade = response?.data;
            if (!entidade?.id) return;
            setEntidades((prev: any[]) =>
              prev.some((item) => Number(item.id) === Number(entidade.id)) ? prev : [...prev, entidade]
            );
          } catch {
            // No-op: mantém o formulário abrindo mesmo se o lookup falhar.
          }
        })();
      }
    } else {
      setIsEditing(false);
      autoPagamentoRef.current = true;
      autoCompetenciaRef.current = true;
      nextFormData = {
        id: null,
        descricao: '',
        valor_previsto: '',
        data_vencimento: new Date().toISOString().split('T')[0],
        tipo: 'DESPESA',
        plano_contas_id: '',
        centro_custo_id: centroCustoFiltro || '',
        entidade_id: '',
        conta_id: '',
        cartao_id: '',
        status: 'PENDENTE',
        valor_pago: '',
        data_pagamento: new Date().toISOString().split('T')[0],
        ipp: false,
        previsto: false,
        observacao: '',
        competencia: formatCompetencia(new Date().toISOString().split('T')[0]),
        is_parcelado: false,
        qtd_parcelas: 2,
        modo_calculo: 'TOTAL',
        competencia_modo_parcelamento: 'POR_PARCELA',
        anexos: [],
      };
      setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
      setShowParcelasSeriePanel(false);
      setParcelasSerie([]);
      setParcelasVencimentosEdit({});
      setAjustarParaDiaUtil(false);
    }
    setFormData(nextFormData);
    setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(nextFormData));
    setFilesToUpload(null);
    setShowDrawer(true);
  }

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

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!formData.descricao || !formData.valor_previsto || !formData.plano_contas_id) {
      pushToast('info', 'Preencha os campos obrigatórios.');
      return;
    }
    if (!formData.entidade_id) {
      pushToast('info', 'Interessado é obrigatório.');
      return;
    }
    const isNovoLancamento = !formData.id;
    const dataLimiteRetroativa = getLocalYmdDaysAgo(2);

    if (isNovoLancamento) {
      const dataBaseNovo = formData.status === 'PAGO' ? formData.data_pagamento || formData.data_vencimento : formData.data_vencimento;
      if (dataBaseNovo && dataBaseNovo < dataLimiteRetroativa) {
        const confirmarRetroativo = window.confirm(
          'Este lançamento possui data anterior a 2 dias atrás. Verifique se a data está correta e, se sim, confirme para lançar.'
        );
        if (!confirmarRetroativo) {
          pushToast('info', 'Lançamento cancelado para revisão da data.');
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (!formData.id && !formData.centro_custo_id) {
        pushToast('info', 'Selecione um centro de custo antes de salvar.');
        setSaving(false);
        return;
      }

      if (formData.status === 'PAGO' && !formData.conta_id) {
        pushToast('info', 'Selecione o banco antes de salvar um lançamento já pago/recebido.');
        setSaving(false);
        return;
      }

      const computedCardDue = formData.cartao_id ? computeCartaoVencimento(formData.data_vencimento, formData.cartao_id, cartoes) : null;
      const dataCompetencia = formData.cartao_id ? formData.data_vencimento : undefined;
      const dataVencimento = computedCardDue || formData.data_vencimento;
      const payload = {
        ...formData,
        valor_previsto: parseFloat(formData.valor_previsto),
        plano_contas_id: parseInt(formData.plano_contas_id),
        centro_custo_id: formData.centro_custo_id ? parseInt(formData.centro_custo_id) : null,
        entidade_id: formData.entidade_id ? parseInt(formData.entidade_id) : null,
        conta_id: formData.conta_id ? parseInt(formData.conta_id) : null,
        cartao_id: formData.cartao_id ? parseInt(formData.cartao_id) : null,
        valor_pago: formData.status === 'PAGO' ? parseFloat(formData.valor_pago || formData.valor_previsto) : 0,
        data_pagamento: formData.status === 'PAGO' ? formData.data_pagamento : null,
        data_competencia: dataCompetencia,
        data_vencimento: dataVencimento,
        competencia: formData.competencia || formatCompetencia(dataVencimento),
        previsto: formData.previsto ?? false,
      };

      let id = formData.id;
      if (formData.is_parcelado && !id) {
        const idParcelamento = crypto.randomUUID();
        const lista = [];
        const qtd = formData.qtd_parcelas;
        const [ano, mes, dia] = formData.data_vencimento.split('-').map(Number);
        let val = formData.modo_calculo === 'TOTAL' ? payload.valor_previsto / qtd : payload.valor_previsto;

        for (let i = 0; i < qtd; i++) {
          const dt = new Date(ano, mes - 1 + i, dia);
          const dataParcela = dt.toISOString().split('T')[0];
          const vencimentoParcela = formData.cartao_id
            ? computeCartaoVencimento(dataParcela, formData.cartao_id, cartoes) || dataParcela
            : dataParcela;
          const competenciaBase = formData.competencia_modo_parcelamento === 'MES_COMPRA' ? formData.data_vencimento : dataParcela;
          lista.push({
            ...payload,
            valor_previsto: val,
            data_vencimento: vencimentoParcela,
            data_competencia: competenciaBase,
            competencia: formatCompetencia(competenciaBase),
            id_parcelamento: idParcelamento,
            descricao: `${payload.descricao} (${i + 1}/${qtd})`,
            numero_parcela: i + 1,
            status: i === 0 && payload.status === 'PAGO' ? 'PAGO' : 'PENDENTE',
            valor_pago: i === 0 && payload.status === 'PAGO' ? payload.valor_pago : 0,
          });
        }

        const parcelasRetroativas = lista.filter((item: any) => String(item.data_vencimento || '') < dataLimiteRetroativa).length;
        if (parcelasRetroativas > 0) {
          const confirmarParcelasRetroativas = window.confirm(
            `${parcelasRetroativas} parcela(s) possuem data anterior a 2 dias atrás. Verifique se as datas estão corretas e, se sim, confirme para lançar.`
          );
          if (!confirmarParcelasRetroativas) {
            pushToast('info', 'Lançamento parcelado cancelado para revisão das datas.');
            setSaving(false);
            return;
          }
        }

        await api.post('/lancamentos/bulk', lista);
      } else {
        if (id && isEditingParcelado) {
          const scopedDescricaoChanged = String(formData.descricao || '') !== String(initialScopedFields.descricao || '');
          const scopedCategoriaChanged =
            String(formData.plano_contas_id || '') !== String(initialScopedFields.plano_contas_id || '');
          const scopedVencimentoChanged = String(formData.data_vencimento || '') !== String(initialScopedFields.data_vencimento || '');
          const hasScopedChange = scopedDescricaoChanged || scopedCategoriaChanged || scopedVencimentoChanged;

          const serieOrdenada = sortedParcelasSerie.length > 0 ? sortedParcelasSerie : [formData as Lancamento];
          const shouldApplyScoped = hasScopedChange && serieOrdenada.length > 1;

          if (!shouldApplyScoped) {
            await api.put(`/lancamentos/${id}`, payload);
          } else {
            const scopeAnswer = window.prompt(
              'Aplicar alterações em qual escopo?\n1 - Só esta parcela\n2 - Esta e próximas\n3 - Todas',
              '1'
            );
            if (scopeAnswer === null) {
              pushToast('info', 'Salvar cancelado.');
              setSaving(false);
              return;
            }

            const escopoEscolhido: 'ESTA' | 'PROXIMAS' | 'TODAS' =
              scopeAnswer.trim() === '3' ? 'TODAS' : scopeAnswer.trim() === '2' ? 'PROXIMAS' : 'ESTA';

            const parcelaAtual = Number(currentParcelaNumber || 1);
            const parcelasAlvo = serieOrdenada.filter((item) => {
              const numero = Number(item.numero_parcela || 0);
              if (escopoEscolhido === 'TODAS') return true;
              if (escopoEscolhido === 'PROXIMAS') return numero >= parcelaAtual;
              return Number(item.id) === Number(id);
            });

            const updatePromises = parcelasAlvo.map(async (item) => {
              const rowVencimento = parcelasVencimentosEdit[item.id] || item.data_vencimento;
              const nextVencimento = scopedVencimentoChanged
                ? ajustarParaDiaUtil
                  ? toNextBusinessDay(rowVencimento)
                  : rowVencimento
                : item.data_vencimento;

              const fallbackContaId = item.conta_id || payload.conta_id || null;
              const fallbackCartaoId = item.cartao_id || payload.cartao_id || null;
              const fallbackCentroCustoId = item.centro_custo_id || payload.centro_custo_id || null;
              const fallbackEntidadeId = item.entidade_id || payload.entidade_id || null;

              const rowPayload: any = {
                conta_id: fallbackContaId,
                centro_custo_id: fallbackCentroCustoId,
                entidade_id: fallbackEntidadeId,
                cartao_id: fallbackCartaoId,
                tipo: item.tipo,
                previsto: item.previsto ?? false,
                status: item.status,
                valor_previsto: Number(item.valor_previsto || 0),
                valor_pago: Number(item.valor_pago || 0),
                data_pagamento: item.data_pagamento || null,
                descricao: scopedDescricaoChanged ? payload.descricao : item.descricao,
                plano_contas_id: scopedCategoriaChanged ? payload.plano_contas_id : item.plano_contas_id,
                data_vencimento: nextVencimento,
                competencia: formatCompetencia(nextVencimento),
                data_competencia: nextVencimento,
                observacao: item.observacao || null,
                conciliado: item.conciliado ?? false,
                ipp: item.ipp ?? false,
                id_parcelamento: item.id_parcelamento || formData.id_parcelamento || null,
                numero_parcela: item.numero_parcela || null,
              };

              if (Number(item.id) === Number(id)) {
                rowPayload.status = payload.status;
                rowPayload.valor_pago = payload.valor_pago;
                rowPayload.data_pagamento = payload.data_pagamento;
                rowPayload.conta_id = payload.conta_id;
                rowPayload.cartao_id = payload.cartao_id;
                rowPayload.centro_custo_id = payload.centro_custo_id;
                rowPayload.entidade_id = payload.entidade_id;
                rowPayload.previsto = payload.previsto;
                rowPayload.ipp = payload.ipp;
                rowPayload.observacao = payload.observacao;
              }

              await api.put(`/lancamentos/${item.id}`, rowPayload);
            });

            await Promise.all(updatePromises);
          }
        } else if (id) {
          await api.put(`/lancamentos/${id}`, payload);
        } else {
          const r = await api.post('/lancamentos/', payload);
          id = r.data.id;
        }

        if (filesToUpload && id) {
          const fd = new FormData();
          for (let i = 0; i < filesToUpload.length; i++) fd.append('files', filesToUpload[i]);
          await api.post(`/lancamentos/${id}/anexos`, fd);
        }
      }
      closeDrawerDirect();
      if (filtrosAvancados.dataModo === 'PAGAMENTO' && (filtrosAvancados.dataInicio || filtrosAvancados.dataFim)) {
        loadLancamentos(undefined, undefined, { force: true, skipFallback: true });
      } else if (filtrosAvancados.dataInicio) {
        loadLancamentos(filtrosAvancados.dataInicio, filtrosAvancados.dataFim, { force: true });
      } else {
        const ano = mesAtual.getFullYear();
        const mes = mesAtual.getMonth() + 1;
        loadLancamentos(
          new Date(ano, mes - 1, 1).toISOString().split('T')[0],
          new Date(ano, mes, 0).toISOString().split('T')[0],
          { force: true }
        );
      }
      await refreshContasComSaldo();
      pushToast('success', isEditing ? 'Lançamento atualizado com sucesso.' : 'Lançamento salvo com sucesso.');
    } catch (e: any) {
      const isDbValidationError = Number(e?.response?.status) === 400;
      if (isDbValidationError) {
        const backendDetail = typeof e?.response?.data?.detail === 'string' ? e.response.data.detail.trim() : '';
        try {
          await recoverLancamentoState();
        } catch (refreshError) {
          console.error(refreshError);
        }
        if (backendDetail) {
          pushToast('error', backendDetail);
        }
        pushToast('info', 'Alguns dados foram recarregados. Revise o lançamento e tente salvar novamente.');
      } else {
        const backendDetail = typeof e?.response?.data?.detail === 'string' ? e.response.data.detail.trim() : '';
        pushToast('error', backendDetail || 'Erro ao salvar lançamento.');
      }
    } opacityRef: { setSaving(false); }
  }

  const handleRemoverAnexo = async (anexo: Anexo) => {
    if (!anexo?.id) return;

    const ok = window.confirm(`Remover o anexo "${anexo.nome_arquivo}"?`);
    if (!ok) return;

    const lancamentoId = Number(formData?.id || 0);
    if (!lancamentoId) {
      setFormData((prev: any) => ({
        ...prev,
        anexos: (prev?.anexos || []).filter((item: Anexo) => Number(item.id) !== Number(anexo.id)),
      }));
      pushToast('success', 'Anexo removido do formulário.');
      return;
    }

    try {
      try {
        await api.delete(`/lancamentos/${lancamentoId}/anexos/${anexo.id}`);
      } catch {
        await api.post(`/lancamentos/${lancamentoId}/anexos/${anexo.id}/delete`);
      }

      setFormData((prev: any) => {
        const next = {
          ...prev,
          anexos: (prev?.anexos || []).filter((item: Anexo) => Number(item.id) !== Number(anexo.id)),
        };
        setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(next));
        return next;
      });

      setLancamentos((prev) =>
        prev.map((item) =>
          Number(item.id) === lancamentoId
            ? { ...item, anexos: (item.anexos || []).filter((current) => Number(current.id) !== Number(anexo.id)) }
            : item
        )
      );

      pushToast('success', 'Anexo removido com sucesso.');
    } catch {
      pushToast('error', 'Não foi possível remover o anexo.');
    }
  };

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

  const toggleListaSort = (key: ListaSortKey) => {
    setListaSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'valor' ? 'desc' : 'asc' };
    });
  };

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

      <QuickEntityDrawer
        showEntityDrawer={showEntityDrawer}
        onClose={() => setShowEntityDrawer(false)}
        onSuccess={(newEntity) => {
          setEntidades((prev) => [...prev, newEntity]);
          setFormData((prev: any) => ({ ...prev, entidade_id: String(newEntity.id) }));
        }}
        pushToast={pushToast}
      />

      <LancamentoFormDrawer
        showDrawer={showDrawer}
        isBoletimEmbed={isBoletimEmbed}
        embedFullscreenDrawer={embedFullscreenDrawer}
        drawerPanelClassName={drawerPanelClassName}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        saving={saving}
        formData={formData}
        setFormData={setFormData}
        filesToUpload={filesToUpload}
        setFilesToUpload={setFilesToUpload}
        hasUnsavedDrawerChanges={hasUnsavedDrawerChanges}
        parcelasSerie={parcelasSerie}
        parcelasSerieLoading={parcelasSerieLoading}
        parcelasVencimentosEdit={parcelasVencimentosEdit}
        setParcelasVencimentosEdit={setParcelasVencimentosEdit}
        ajustarParaDiaUtil={ajustarParaDiaUtil}
        setAjustarParaDiaUtil={setAjustarParaDiaUtil}
        showParcelasSeriePanel={showParcelasSeriePanel}
        categorias={categorias}
        entidades={entidades}
        contas={contas}
        cartoes={cartoes}
        centros={centros}
        lancamentos={lancamentos}
        openEntityDrawer={() => setShowEntityDrawer(true)}
        requestCloseDrawer={requestCloseDrawer}
        handleSave={handleSave}
        handleVerTodasParcelas={handleVerTodasParcelas}
        handleSelecionarParcelaSerie={handleSelecionarParcelaSerie}
        handleRemoverAnexo={handleRemoverAnexo}
        pushToast={pushToast}
        toggleConta={toggleConta}
        toggleCartao={toggleCartao}
        handleVencimentoChange={handleVencimentoChange}
        handleCompetenciaChange={handleCompetenciaChange}
        handleStatusPagoChange={handleStatusPagoChange}
        handleValorPrevistoChange={handleValorPrevistoChange}
        handleValorPagoChange={handleValorPagoChange}
        handleDataPagamentoChange={handleDataPagamentoChange}
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
