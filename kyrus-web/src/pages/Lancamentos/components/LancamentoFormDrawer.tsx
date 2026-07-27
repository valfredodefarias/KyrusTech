import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  Plus,
  Trash2,
  Download,
  UploadCloud,
  Loader2,
  Check,
  Wallet,
  CreditCard,
  Image as ImageIcon,
  FileSpreadsheet,
  Presentation,
  FileText,
  ArrowRightLeft,
  Lock,
  CheckCircle2,
  AlertCircle,
  Info,
  Layers,
} from 'lucide-react';
import { SearchableSelect } from '../../../components/SearchableSelect';
import { BankAvatar } from '../../../components/BrandAvatar';
import { toPublicAssetUrl, api, normalizeListResponse } from '../../../services/api';
import { InputDark, CurrencyInputDark, ToggleSimNao } from './InputDark';
import type { Lancamento, Anexo, ToastItem } from '../types';
import {
  computeCartaoVencimento,
  parseDescricaoParcela,
  resolveAnexoUrl,
  formatDateShort,
  formatCompetencia,
  getTodayLocalYmd,
  getLocalYmdDaysAgo,
  toNextBusinessDay,
} from '../utils';
import { useLookupStore } from '../../../store/lookupStore';
import { QuickEntityDrawer } from './QuickEntityDrawer';

function formatExpressionCentsFirst(input: string): string {
  if (!input) return '';
  const tokens = input.split(/([+\-*/()])/g);
  const formattedTokens = tokens.map((token) => {
    const digits = token.replace(/\D/g, '');
    if (digits.length > 0) {
      const num = parseFloat(digits) / 100;
      return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return token;
  });
  return formattedTokens.join('');
}

const ANOMALY_TRANSLATIONS: Record<string, string> = {
  DUPLICIDADE_OFX: 'Movimento OFX Duplicado',
  PAGAMENTO_DUPLO: 'Pagamento Duplo Realizado',
  VALOR_ATIPICO: 'Desvio de Valor Atípico',
  EXCLUSAO_SUSPEITA: 'Exclusão Suspeita de Lançamento',
  DESVIO_PLANO_CONTAS: 'Desvio de Plano de Contas',
  HORARIO_ATIPICO: 'Operação em Horário Atípico',
  CONTA_DIVERGENTE: 'Divergência de Conta Bancária',
  LANCAMENTO_SEM_COMPROVANTE: 'Lançamento sem Comprovante',
  LOGIN_BRUTE_FORCE: 'Força Bruta no Login',
  ALTERACAO_DADOS_BANCARIOS: 'Alteração de Dados Bancários',
  SILENCIAMENTO_SUSPEITO: 'Silenciamento Suspeito',
};

interface LancamentoFormDrawerProps {
  showDrawer: boolean;
  onClose: () => void;
  editarId?: number | null;
  contaId?: number | null;
  cartaoId?: number | null;
  onSaveSuccess?: (createdId?: number) => void;
  isBoletimEmbed?: boolean;
  embedFullscreenDrawer?: boolean;
  drawerPanelClassName?: string;
  // Opcionais para injetar lookups externamente:
  categorias?: any[];
  entidades?: any[];
  contas?: any[];
  cartoes?: any[];
  centros?: any[];
  pushToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  isCaixaMode?: boolean;
  lancamentos?: Lancamento[];
  prefilledData?: Partial<any>;
  onEntityCreated?: (entity: any) => void;
}

export const LancamentoFormDrawer = ({
  showDrawer,
  onClose,
  editarId = null,
  contaId = null,
  cartaoId = null,
  onSaveSuccess,
  isBoletimEmbed = false,
  embedFullscreenDrawer = false,
  drawerPanelClassName,
  categorias: categoriasProp,
  entidades: entidadesProp,
  contas: contasProp,
  cartoes: cartoesProp,
  centros: centrosProp,
  pushToast: pushToastProp,
  isCaixaMode = false,
  lancamentos,
  prefilledData,
  onEntityCreated,
}: LancamentoFormDrawerProps) => {
  // --- ESTADOS INTERNOS ---
  const selectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const [formData, setFormData] = useState<any>({
    id: null,
    descricao: '',
    valor_previsto: '',
    data_vencimento: '',
    tipo: 'DESPESA',
    plano_contas_id: '',
    centro_custo_id: selectedCentroCustoId === 'ALL' ? '' : String(selectedCentroCustoId),
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
    tipo_intervalo: 'MENSAL',
    intervalo_dias: 30,
    ajustar_vencimento_dia_util: true,
    anexos: [],
  });

  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<FileList | null>(null);
  const [initialDrawerFormSnapshot, setInitialDrawerFormSnapshot] = useState('');
  const [initialScopedFields, setInitialScopedFields] = useState({
    descricao: '',
    plano_contas_id: '',
    data_vencimento: '',
  });

  const [amountText, setAmountText] = useState('');
  const [paidAmountText, setPaidAmountText] = useState('');

  useEffect(() => {
    if (formData.valor_previsto !== undefined) {
      const num = Number(formData.valor_previsto);
      if (Number.isFinite(num) && num > 0) {
        setAmountText(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      } else {
        setAmountText(String(formData.valor_previsto || ''));
      }
    }
  }, [formData.valor_previsto]);

  useEffect(() => {
    if (formData.valor_pago !== undefined) {
      const num = Number(formData.valor_pago);
      if (Number.isFinite(num) && num > 0) {
        setPaidAmountText(num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      } else {
        setPaidAmountText(String(formData.valor_pago || ''));
      }
    }
  }, [formData.valor_pago]);

  const handleAmountBlur = () => {
    if (!amountText) {
      handleValorPrevistoChange('');
      return;
    }
    const cleanExpr = amountText.replace(/\./g, '').replace(/,/g, '.');
    if (/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
      try {
        const result = Function(`"use strict"; return (${cleanExpr})`)();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setAmountText(formatted);
          handleValorPrevistoChange(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handlePaidAmountBlur = () => {
    if (!paidAmountText) {
      handleValorPagoChange('');
      return;
    }
    const cleanExpr = paidAmountText.replace(/\./g, '').replace(/,/g, '.');
    if (/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
      try {
        const result = Function(`"use strict"; return (${cleanExpr})`)();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setPaidAmountText(formatted);
          handleValorPagoChange(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const [parcelasSerie, setParcelasSerie] = useState<Lancamento[]>([]);
  const [parcelasSerieLoading, setParcelasSerieLoading] = useState(false);
  const [parcelasVencimentosEdit, setParcelasVencimentosEdit] = useState<Record<number, string>>({});
  const [ajustarParaDiaUtil, setAjustarParaDiaUtil] = useState(false);
  const [showParcelasSeriePanel, setShowParcelasSeriePanel] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showEntityDrawer, setShowEntityDrawer] = useState(false);
  const [showScopeModal, setShowScopeModal] = useState(false);
  const [scopeModalResolver, setScopeModalResolver] = useState<((value: 'ESTA' | 'PROXIMAS' | 'TODAS' | null) => void) | null>(null);

  // --- compliance / auditoria states ---
  const [activeAlerts, setActiveAlerts] = useState<any[]>([]);
  const [inlineSilencing, setInlineSilencing] = useState(false);

  useEffect(() => {
    if (showDrawer && editarId) {
      api.get('/auditoria/alertas', {
        params: { objeto_id: editarId, tipo_objeto: 'lancamento', status: 'PENDENTE' }
      }).then(res => {
        setActiveAlerts(normalizeListResponse<any>(res.data.items ?? res.data));
      }).catch(err => console.error(err));
    } else {
      setActiveAlerts([]);
    }
  }, [showDrawer, editarId]);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    resolver: ((value: boolean) => void) | null;
  }>({
    show: false,
    title: '',
    message: '',
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    resolver: null,
  });

  const showConfirm = (title: string, message: string, confirmText = 'Confirmar', cancelText = 'Cancelar') => {
    return new Promise<boolean>((resolve) => {
      setConfirmModal({
        show: true,
        title,
        message,
        confirmText,
        cancelText,
        resolver: resolve,
      });
    });
  };

  // --- LOOKUPS INTERNOS ---
  const [localCategorias, setLocalCategorias] = useState<any[]>([]);
  const [localEntidades, setLocalEntidades] = useState<any[]>(entidadesProp || []);
  const [localContas, setLocalContas] = useState<any[]>([]);
  const [localCartoes, setLocalCartoes] = useState<any[]>([]);
  const [localCentros, setLocalCentros] = useState<any[]>([]);

  useEffect(() => {
    if (entidadesProp) {
      setLocalEntidades(entidadesProp);
    }
  }, [entidadesProp]);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidades = useLookupStore((state) => state.fetchEntidades);
  const setEntidadesCache = useLookupStore((state) => state.setEntidades);
  const setEntidadesLookupCache = useLookupStore((state) => state.setEntidadesLookup);

  const categorias = categoriasProp || localCategorias;
  const entidades = localEntidades;
  const contas = contasProp || localContas;
  const cartoes = cartoesProp || localCartoes;
  const centros = centrosProp || localCentros;

  const autoPagamentoRef = useRef(true);
  const autoCompetenciaRef = useRef(true);
  const pagamentoSectionRef = useRef<HTMLDivElement | null>(null);
  const [desconciliando, setDesconciliando] = useState(false);

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

  const shouldShowParcelasSerie = !isBoletimEmbed && (isEditingParcelado || showParcelasSeriePanel);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const pushToast = (type: 'success' | 'error' | 'info', message: string) => {
    if (pushToastProp) {
      pushToastProp(type, message);
      return;
    }
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

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
      tipo_intervalo: data.tipo_intervalo || 'MENSAL',
      intervalo_dias: Number(data.intervalo_dias || 30),
      ajustar_vencimento_dia_util: data.ajustar_vencimento_dia_util ?? true,
    });

  const loadLookups = async () => {
    try {
      const promises = [];
      if (!categoriasProp || categoriasProp.length === 0) {
        promises.push(fetchPlanoContas().then((data) => setLocalCategorias(normalizeListResponse(data))));
      }
      if (!entidadesProp || entidadesProp.length === 0) {
        promises.push(fetchEntidadesLookup().then((data) => setLocalEntidades(normalizeListResponse(data))));
      }
      if (!contasProp || contasProp.length === 0) {
        promises.push(api.get('/contas/', { params: { include_saldo: true } }).then((res) => setLocalContas(normalizeListResponse(res.data))));
      }
      if (!cartoesProp || cartoesProp.length === 0) {
        promises.push(api.get('/cartoes/').then((res) => setLocalCartoes(normalizeListResponse(res.data))));
      }
      if (!centrosProp || centrosProp.length === 0) {
        promises.push(api.get('/centro-custo/').then((res) => setLocalCentros(normalizeListResponse(res.data))));
      }
      await Promise.all(promises);
    } catch (error) {
      console.error('Erro ao carregar lookups do formulário:', error);
    }
  };

  useEffect(() => {
    if (showDrawer) {
      void loadLookups();
    }
  }, [showDrawer, categoriasProp, entidadesProp, contasProp, cartoesProp, centrosProp]);

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

      setParcelasSerieLoading(true);
      try {
        const refYear = Number(String(ref?.data_vencimento || '').slice(0, 4)) || new Date().getFullYear();
        const res = await api.get('/lancamentos/', {
          params: {
            data_inicio: `${refYear - 2}-01-01`,
            data_fim: `${refYear + 2}-12-31`,
          },
        });
        const rows = normalizeListResponse<Lancamento>(res.data);
        const withRef = buildSerieFromDataset(rows);
        setParcelasSerie(withRef);
        setParcelasVencimentosEdit(
          withRef.reduce((acc: Record<number, string>, item: Lancamento) => {
            acc[item.id] = item.data_vencimento;
            return acc;
          }, {})
        );
      } catch {
        // Fallback
      } finally {
        setParcelasSerieLoading(false);
      }
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

  useEffect(() => {
    if (!showDrawer) {
      setShowEntityDrawer(false);
      return;
    }

    if (editarId) {
      setIsEditing(true);
      autoPagamentoRef.current = false;
      autoCompetenciaRef.current = false;

      const fetchLancamentoDetails = async () => {
        try {
          const res = await api.get(`/lancamentos/${editarId}`);
          const l = res.data;
          if (l) {
            autoPagamentoRef.current = !l.data_pagamento;
            autoCompetenciaRef.current = !l.competencia;
            const nextFormData: any = {
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
              tipo_intervalo: l.tipo_intervalo || 'MENSAL',
              intervalo_dias: l.intervalo_dias || 30,
              ajustar_vencimento_dia_util: l.ajustar_vencimento_dia_util ?? true,
              baixas: l.baixas || [],
            };
            setFormData(nextFormData);
            setInitialScopedFields({
              descricao: String(l.descricao || ''),
              plano_contas_id: String(l.plano_contas_id || ''),
              data_vencimento: String(l.data_vencimento || ''),
            });
            setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(nextFormData));
            setFilesToUpload(null);
            setAjustarParaDiaUtil(false);
            setShowParcelasSeriePanel(false);

            void loadParcelasSerie(l.id_parcelamento, l);
          }
        } catch (error) {
          console.error('Erro ao buscar detalhes do lançamento:', error);
          pushToast('error', 'Não foi possível carregar os detalhes do lançamento.');
        }
      };

      void fetchLancamentoDetails();
    } else {
      setIsEditing(false);
      autoPagamentoRef.current = true;
      autoCompetenciaRef.current = true;
      const todayStr = getTodayLocalYmd();
      const defaultFormData: any = {
        id: null,
        descricao: '',
        valor_previsto: '',
        data_vencimento: todayStr,
        tipo: 'DESPESA',
        plano_contas_id: '',
        centro_custo_id: selectedCentroCustoId === 'ALL' ? '' : String(selectedCentroCustoId),
        entidade_id: '',
        conta_id: contaId || '',
        cartao_id: cartaoId || '',
        status: isCaixaMode ? 'PAGO' : 'PENDENTE',
        valor_pago: '',
        data_pagamento: todayStr,
        ipp: false,
        previsto: false,
        observacao: '',
        competencia: formatCompetencia(todayStr),
        is_parcelado: false,
        qtd_parcelas: 2,
        modo_calculo: 'TOTAL',
        competencia_modo_parcelamento: 'POR_PARCELA',
        tipo_intervalo: 'MENSAL',
        intervalo_dias: 30,
        ajustar_vencimento_dia_util: true,
        anexos: [],
        baixas: [],
        ...prefilledData,
      };
      setFormData(defaultFormData);
      setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
      setInitialDrawerFormSnapshot(buildDrawerFormSnapshot(defaultFormData));
      setFilesToUpload(null);
      setParcelasSerie([]);
      setParcelasVencimentosEdit({});
      setAjustarParaDiaUtil(false);
      setShowParcelasSeriePanel(false);
    }
  }, [showDrawer, editarId, contaId, cartaoId, prefilledData]);

  useEffect(() => {
    if (!showDrawer) return;

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSave();
      } else if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [showDrawer, formData, handleSave, onClose]);

  useEffect(() => {
    if (!editarId && !formData.id && !formData.centro_custo_id) {
      if (centros.length === 1) {
        setFormData((prev: any) => ({ ...prev, centro_custo_id: String(centros[0].id) }));
      } else {
        const activeContaId = formData.conta_id || contaId;
        if (activeContaId) {
          const found = contas.find((c) => Number(c.id) === Number(activeContaId));
          if (found && found.centro_custo_id) {
            setFormData((prev: any) => ({ ...prev, centro_custo_id: String(found.centro_custo_id) }));
          }
        } else if (formData.cartao_id) {
          const found = cartoes.find((c) => Number(c.id) === Number(formData.cartao_id));
          if (found && found.centro_custo_id) {
            setFormData((prev: any) => ({ ...prev, centro_custo_id: String(found.centro_custo_id) }));
          }
        }
      }
    }
  }, [centros, contas, cartoes, editarId, formData.id, formData.conta_id, formData.cartao_id, formData.centro_custo_id, contaId]);

  const closeDrawerDirect = () => {
    onClose();
    setInitialDrawerFormSnapshot('');
    setFilesToUpload(null);
    setParcelasSerie([]);
    setParcelasVencimentosEdit({});
    setAjustarParaDiaUtil(false);
    setShowParcelasSeriePanel(false);
    setInitialScopedFields({ descricao: '', plano_contas_id: '', data_vencimento: '' });
  };

  const requestCloseDrawer = async () => {
    if (saving) return;
    if (!hasUnsavedDrawerChanges) {
      closeDrawerDirect();
      return;
    }
    const shouldSave = await showConfirm(
      'Aviso',
      'Você alterou informações e ainda não salvou. Você deseja salvar a informação antes de sair?'
    );
    if (shouldSave) {
      await handleSave();
      return;
    }
    closeDrawerDirect();
  };

  const hasUnsavedDrawerChanges = useMemo(() => {
    if (!showDrawer) return false;
    if (!initialDrawerFormSnapshot) return false;
    if (filesToUpload && filesToUpload.length > 0) return true;
    return buildDrawerFormSnapshot(formData) !== initialDrawerFormSnapshot;
  }, [showDrawer, initialDrawerFormSnapshot, formData, filesToUpload]);



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

  const handleRemoverAnexo = async (anexo: Anexo) => {
    if (!anexo?.id) return;

    const ok = await showConfirm('Remover Anexo', `Remover o anexo "${anexo.nome_arquivo}"?`);
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

      pushToast('success', 'Anexo removido com sucesso.');
    } catch {
      pushToast('error', 'Não foi possível remover o anexo.');
    }
  };

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
      if (!isEditing && (autoCompetenciaRef.current || !prev.competencia || prev.competencia === prevCompetencia)) {
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

  const handleDataPagamentoChange = (value: string) => {
    autoPagamentoRef.current = false;
    setFormData((prev: any) => ({ ...prev, data_pagamento: value }));
  };

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
        const confirmarRetroativo = await showConfirm(
          'Confirmação de Data',
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
      let finalCentroCustoId = formData.centro_custo_id;
      if (!formData.id && !finalCentroCustoId) {
        const activeContaId = formData.conta_id || contaId;
        if (activeContaId) {
          const found = contas.find((c) => Number(c.id) === Number(activeContaId));
          if (found && found.centro_custo_id) {
            finalCentroCustoId = String(found.centro_custo_id);
          }
        } else if (formData.cartao_id) {
          const found = cartoes.find((c) => Number(c.id) === Number(formData.cartao_id));
          if (found && found.centro_custo_id) {
            finalCentroCustoId = String(found.centro_custo_id);
          }
        }
      }

      if (!formData.id && !finalCentroCustoId) {
        pushToast('info', 'Selecione um centro de custo antes de salvar.');
        setSaving(false);
        return;
      }

      const finalContaId = formData.conta_id || contaId;
      const isPago = isCaixaMode || formData.status === 'PAGO';

      if (isPago && !finalContaId) {
        pushToast('info', 'Selecione o banco antes de salvar um lançamento já pago/recebido.');
        setSaving(false);
        return;
      }

      const computedCardDue = formData.cartao_id ? computeCartaoVencimento(formData.data_vencimento, formData.cartao_id, cartoes) : null;
      const dataCompetencia = formData.cartao_id ? formData.data_vencimento : undefined;
      const dataVencimento = computedCardDue || formData.data_vencimento;
      const payload = {
        ...formData,
        status: isPago ? 'PAGO' : formData.status,
        valor_previsto: parseFloat(formData.valor_previsto),
        plano_contas_id: parseInt(formData.plano_contas_id),
        centro_custo_id: finalCentroCustoId ? parseInt(finalCentroCustoId) : null,
        entidade_id: formData.entidade_id ? parseInt(formData.entidade_id) : null,
        conta_id: finalContaId ? parseInt(String(finalContaId)) : null,
        cartao_id: formData.cartao_id ? parseInt(formData.cartao_id) : null,
        valor_pago: isPago ? parseFloat(formData.valor_pago || formData.valor_previsto) : 0,
        data_pagamento: isPago ? (formData.data_pagamento || formData.data_vencimento) : null,
        data_competencia: dataCompetencia,
        data_vencimento: dataVencimento,
        competencia: formData.competencia || formatCompetencia(dataVencimento),
        previsto: isCaixaMode ? false : (formData.previsto ?? false),
      };

      let id = formData.id;
      if (formData.is_parcelado && !id) {
        const idParcelamento = crypto.randomUUID();
        const lista = [];
        const qtd = formData.qtd_parcelas;
        const [ano, mes, dia] = formData.data_vencimento.split('-').map(Number);
        let val = formData.modo_calculo === 'TOTAL' ? payload.valor_previsto / qtd : payload.valor_previsto;

        for (let i = 0; i < qtd; i++) {
          let dataParcela = '';
          if (formData.tipo_intervalo === 'DIAS') {
            const dt = new Date(ano, mes - 1, dia);
            const intervalo = Number(formData.intervalo_dias || 30);
            dt.setDate(dt.getDate() + i * intervalo);
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const d = String(dt.getDate()).padStart(2, '0');
            dataParcela = `${y}-${m}-${d}`;
          } else {
            const dt = new Date(ano, mes - 1 + i, dia);
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const d = String(dt.getDate()).padStart(2, '0');
            dataParcela = `${y}-${m}-${d}`;
          }

          let vencimentoParcela = formData.cartao_id
            ? computeCartaoVencimento(dataParcela, formData.cartao_id, cartoes) || dataParcela
            : dataParcela;

          if (formData.ajustar_vencimento_dia_util !== false) {
            vencimentoParcela = toNextBusinessDay(vencimentoParcela);
          }

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
            data_pagamento: i === 0 && payload.status === 'PAGO' ? payload.data_pagamento : null,
          });
        }

        const parcelasRetroativas = lista.filter((item: any) => String(item.data_vencimento || '') < dataLimiteRetroativa).length;
        if (parcelasRetroativas > 0) {
          const confirmarParcelasRetroativas = await showConfirm(
            'Confirmação de Datas',
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

          const comicBookSet = sortedParcelasSerie.length > 0 ? sortedParcelasSerie : [formData as Lancamento];
          const shouldApplyScoped = hasScopedChange && comicBookSet.length > 1;

          if (!shouldApplyScoped) {
            await api.put(`/lancamentos/${id}`, payload);
          } else {
            const escopoEscolhido = await new Promise<'ESTA' | 'PROXIMAS' | 'TODAS' | null>((resolve) => {
              setShowScopeModal(true);
              setScopeModalResolver(() => resolve);
            });
            setShowScopeModal(false);
            setScopeModalResolver(null);

            if (escopoEscolhido === null) {
              pushToast('info', 'Salvar cancelado.');
              setSaving(false);
              return;
            }

            const parcelaAtual = Number(currentParcelaNumber || 1);
            const parcelasAlvo = comicBookSet.filter((item) => {
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

        // Registrar regra de silenciamento inline se selecionado
        if (inlineSilencing && formData.plano_contas_id) {
          try {
            await api.post('/auditoria/silenciamento', {
              tipo_anomalia: 'VALOR_ATIPICO',
              plano_contas_id: Number(formData.plano_contas_id),
              entidade_id: formData.entidade_id ? Number(formData.entidade_id) : undefined
            });
          } catch (ruleErr) {
            console.error('Erro ao registrar regra de silenciamento inline:', ruleErr);
          }
        }
      }
      closeDrawerDirect();
      if (formData.cartao_id && dataVencimento !== formData.data_vencimento) {
        pushToast('info', `Lançamento salvo com sucesso. O vencimento foi ajustado para a fatura de ${formatDateShort(dataVencimento)}.`);
      } else {
        pushToast('success', isEditing ? 'Lançamento atualizado com sucesso.' : 'Lançamento salvo com sucesso.');
      }
      if (onSaveSuccess) {
        onSaveSuccess(id || undefined);
      }
    } catch (e: any) {
      console.error('Erro ao salvar lançamento:', e);
      let errorMsg = 'Erro ao salvar lançamento.';
      if (e?.response?.data?.detail) {
        if (typeof e.response.data.detail === 'string') {
          errorMsg = e.response.data.detail;
        } else if (Array.isArray(e.response.data.detail)) {
          errorMsg = e.response.data.detail
            .map((err: any) => {
              const field = err.loc ? err.loc.filter((x: any) => x !== 'body').join('.') : '';
              return `${field ? `Campo [${field}]: ` : ''}${err.msg}`;
            })
            .join('; ');
        } else if (typeof e.response.data.detail === 'object') {
          errorMsg = JSON.stringify(e.response.data.detail);
        }
      }
      pushToast('error', errorMsg);
    } finally {
      setSaving(false);
    }
  }

  const handleDelete = async () => {
    if (!formData?.id) return;

    const isPago = formData.status === 'PAGO';
    const message = isPago
      ? 'Aviso: Este lançamento está PAGO. Tem certeza que deseja excluí-lo? Esta ação removerá a baixa e o lançamento definitivamente.'
      : 'Tem certeza que deseja excluir este lançamento? Esta ação não poderá ser desfeita.';

    const ok = await showConfirm('Excluir Lançamento', message);
    if (!ok) return;

    setSaving(true);
    try {
      await api.delete(`/lancamentos/${formData.id}`, {
        params: { confirmar_exclusao_pagos: true }
      });
      pushToast('success', 'Lançamento excluído com sucesso.');
      closeDrawerDirect();
      if (onSaveSuccess) {
        onSaveSuccess();
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Erro ao excluir lançamento.';
      pushToast('error', `Falha ao excluir: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDesconciliar = async () => {
    if (!formData?.id) return;
    const confirmDesconciliar = await showConfirm(
      'Desfazer Conciliação',
      'Tem certeza que deseja desfazer a conciliação deste lançamento? Isso removerá a baixa vinculada, reabrirá o movimento correspondente no extrato OFX e permitirá editar todos os campos novamente.'
    );
    if (!confirmDesconciliar) return;

    setDesconciliando(true);
    try {
      await api.post(`/importacao/ofx/desconciliar/${formData.id}`);
      pushToast('success', 'Conciliação desfeita com sucesso. Os campos de conciliação foram liberados.');
      setFormData((prev: any) => ({
        ...prev,
        conciliado: false,
        baixas: [],
        valor_pago: '',
        status: 'EM ABERTO',
        data_pagamento: null,
      }));
      if (onSaveSuccess) {
        await onSaveSuccess(formData?.id || undefined);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Erro ao desfazer conciliação.';
      pushToast('error', `Falha ao desconciliar: ${msg}`);
    } finally {
      setDesconciliando(false);
    }
  };

  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);



  const getFileIcon = (nome: string) => {
    const ext = nome.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext || '')) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (['ppt', 'pptx'].includes(ext || '')) return <Presentation className="w-4 h-4 text-orange-400" />;
    return <FileText className="w-4 h-4 text-blue-400" />;
  };

  const catOptions = useMemo(() => [
    {
      label: 'SAIDAS',
      options: categorias
        .filter((c) => (c.tipo || '').trim().toUpperCase().startsWith('D'))
        .map((c) => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          grupo: 'SAIDAS',
          disabled: c.eh_cabecalho || c.permite_lancamentos === false,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
        })),
    },
    {
      label: 'ENTRADAS',
      options: categorias
        .filter((c) => (c.tipo || '').trim().toUpperCase().startsWith('R'))
        .map((c) => ({
          id: c.id,
          label: c.nome,
          tipo: c.tipo,
          grupo: 'ENTRADAS',
          disabled: c.eh_cabecalho || c.permite_lancamentos === false,
          eh_cabecalho: c.eh_cabecalho,
          permite_lancamentos: c.permite_lancamentos,
        })),
    },
  ], [categorias]);

  const entidadeOptions = useMemo(() => [
    {
      label: 'Interessados',
      options: [
        { id: '', label: 'Selecione...' },
        ...entidades
          .slice()
          .sort((a: any, b: any) => {
            const nameA = String(a?.nome || '').replace(/&nbsp;/g, ' ').trim();
            const nameB = String(b?.nome || '').replace(/&nbsp;/g, ' ').trim();
            return nameA.localeCompare(nameB, 'pt-BR');
          })
          .map((e: any) => {
            const rawLabel = e.nome || e.razao_social || `Interessado ${e.id}`;
            const cleanLabel = rawLabel.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            return { id: e.id, label: cleanLabel };
          }),
      ],
    },
  ], [entidades]);

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

  const getContasAtivasByCentro = (centroCustoId?: string | number | null) => {
    return contasAtivas.filter(
      (conta) => !centroCustoId || String(conta.centro_custo_id) === String(centroCustoId)
    );
  };

  if (!showDrawer) return null;

  const drawerElement = (
    <div
      className={`${
        embedFullscreenDrawer
          ? 'absolute inset-0 z-10 flex justify-end bg-slate-50 dark:bg-slate-900'
          : 'fixed inset-0 z-50 flex justify-end'
      }`}
    >
      {!embedFullscreenDrawer && (
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => void requestCloseDrawer()}></div>
      )}
      <div className={`${embedFullscreenDrawer ? 'relative z-10 flex h-full w-full' : 'relative z-10 flex h-full'}`}>
        {shouldShowParcelasSerie && (
          <aside className="hidden h-full w-[33vw] min-w-[420px] max-w-[560px] flex-col border-r border-slate-200 bg-white p-4 shadow-2xl backdrop-blur lg:flex dark:border-slate-700 dark:bg-slate-900/98">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-700 dark:text-slate-200">
                  Série de Parcelas
                </p>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Parcela atual {currentParcelaNumber}/{currentParcelaTotal}
                </p>
              </div>
            </div>

            <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={ajustarParaDiaUtil}
                onChange={(e) => setAjustarParaDiaUtil(e.target.checked)}
                className="accent-blue-500"
              />
              Ajustar vencimentos para próximo dia útil ao salvar
            </label>

            <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/70">
              {parcelasSerieLoading ? (
                <div className="p-3 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Carregando parcelas...
                </div>
              ) : sortedParcelasSerie.length === 0 ? (
                <div className="p-3 text-xs text-slate-600 dark:text-slate-300">
                  Não há outras parcelas identificadas para esta série.
                </div>
              ) : (
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Parcela</th>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                        <th className="px-2 py-2 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                        <th className="px-2 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedParcelasSerie.map((item) => {
                        const isCurrent = Number(item.id) === Number(formData.id);
                        return (
                          <tr
                            key={item.id}
                            onClick={() => handleSelecionarParcelaSerie(item)}
                            className={`cursor-pointer border-t border-slate-200 transition dark:border-slate-800 ${
                              isCurrent ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                            }`}
                          >
                            <td className="px-2 py-2 text-xs font-black text-slate-700 dark:text-slate-300">
                              {item.numero_parcela || '-'}
                            </td>
                            <td className="px-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                              <p className="truncate">{item.descricao || 'Sem descrição'}</p>
                            </td>
                            <td className="px-2 py-2 text-right text-xs font-black text-slate-700 dark:text-slate-100 whitespace-nowrap">
                              {BRL.format(Number(item.valor_previsto || 0))}
                            </td>
                            <td className="px-2 py-2">
                              <input
                                type="date"
                                value={parcelasVencimentosEdit[item.id] || item.data_vencimento || ''}
                                onChange={(e) =>
                                  setParcelasVencimentosEdit((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 outline-none"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </aside>
        )}

        <div
          className={`relative bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col animate-slide-in-right border-l border-slate-200 dark:border-slate-700 ${
            drawerPanelClassName || (embedFullscreenDrawer ? 'w-full max-w-none' : 'w-full max-w-xl')
          }`}
        >
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">{isEditing ? 'Editar' : 'Novo'} Lançamento</h2>
            <div className="flex items-center gap-1">
              {isEditing && (
                <>
                  <button
                    type="button"
                    title="Excluir este lançamento"
                    onClick={handleDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Excluir
                  </button>
                  <button
                    type="button"
                    title="Duplicar este lançamento"
                    onClick={() => {
                      setIsEditing(false);
                      setFormData((prev: any) => ({
                        ...prev,
                        id: null,
                        status: 'PENDENTE',
                        data_pagamento: prev.data_vencimento,
                        valor_pago: '',
                        is_parcelado: false,
                        anexos: [],
                        conciliado: false,
                        import_hash: null,
                        movimento_uid: null,
                        referencia_externa: null,
                        ofx_bank_id: null,
                      }));
                      setFilesToUpload(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                </>
              )}
              {isEditing && formData.conciliado && (
                <button
                  type="button"
                  title="Desfazer a conciliação bancária deste lançamento"
                  disabled={desconciliando}
                  onClick={handleDesconciliar}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition disabled:opacity-50 cursor-pointer"
                >
                  {desconciliando ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  )}
                  Desconciliar
                </button>
              )}
              <button
                onClick={() => void requestCloseDrawer()}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400 outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
            {formData.conciliado && (
              <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20 text-xs text-blue-700 dark:text-blue-300 animate-in fade-in duration-300">
                <Lock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Lançamento Conciliado com o Extrato</p>
                  <p className="mt-0.5 text-slate-500 dark:text-slate-400 leading-relaxed">
                    A edição de campos críticos (valor, datas, status e conta) está bloqueada. Para editá-los, clique no botão <strong>Desconciliar</strong> acima.
                  </p>
                </div>
              </div>
            )}
            {/* INTERESSADO */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Interessado</label>
                <button
                  onClick={() => setShowEntityDrawer(true)}
                  className="text-[10px] text-blue-400 font-bold hover:text-blue-300 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Nova
                </button>
              </div>
              <SearchableSelect
                placeholder="Selecione..."
                options={entidadeOptions}
                value={formData.entidade_id}
                onChange={(id: any) => {
                  const eid = String(id || '');
                  const last = lancamentos?.find((l: Lancamento) => String(l.entidade_id) === eid);
                  setFormData((prev: any) => {
                    const hasCategoriaSelecionada = Boolean(prev.plano_contas_id);
                    if (!last || hasCategoriaSelecionada) {
                      return { ...prev, entidade_id: eid };
                    }
                    return {
                      ...prev,
                      entidade_id: eid,
                      plano_contas_id: last.plano_contas_id,
                      tipo: last.tipo,
                    };
                  });
                }}
              />
            </div>

            {/* DESCRIÇÃO E VALORES */}
            <InputDark
              label="Descrição"
              autoFocus
              value={formData.descricao}
              onChange={(e: any) => setFormData((prev: any) => ({ ...prev, descricao: e.target.value }))}
              placeholder="Ex: Conta de Luz"
            />
            <div className="grid grid-cols-2 gap-4">
              <InputDark
                label={formData.cartao_id ? 'Data da compra' : 'Vencimento'}
                type="date"
                disabled={formData.conciliado}
                value={formData.data_vencimento}
                onChange={(e: any) => handleVencimentoChange(e.target.value)}
              />
              <div className="w-full">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Valor (R$)</label>
                <input
                  type="text"
                  disabled={formData.conciliado}
                  value={amountText}
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    const cleanExpr = rawVal.replace(/\./g, '').replace(/,/g, '');
                    const formatted = formatExpressionCentsFirst(cleanExpr);
                    setAmountText(formatted);
                  }}
                  onBlur={handleAmountBlur}
                  placeholder="0,00 ou 150+300"
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 font-bold text-lg text-blue-400"
                />
              </div>
            </div>

            {/* PARCELAMENTO */}
            {!isCaixaMode && (
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao
                  label="Pagamento parcelado"
                  value={!!formData.is_parcelado}
                  onChange={(next) => setFormData((prev: any) => ({ ...prev, is_parcelado: next }))}
                />

                {formData.is_parcelado && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <InputDark
                        label="Qtd. de parcelas"
                        type="number"
                        min={2}
                        value={formData.qtd_parcelas}
                        onChange={(e: any) =>
                          setFormData((prev: any) => ({
                            ...prev,
                            qtd_parcelas: Math.max(2, Number(e.target.value) || 2),
                          }))
                        }
                      />
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Cálculo</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'TOTAL' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.modo_calculo === 'TOTAL'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            Total
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, modo_calculo: 'PARCELA' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.modo_calculo === 'PARCELA'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            Por parcela
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Frequência</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, tipo_intervalo: 'MENSAL' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.tipo_intervalo !== 'DIAS'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            Mensal
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormData((prev: any) => ({ ...prev, tipo_intervalo: 'DIAS' }))}
                            className={`py-2 rounded-lg text-xs font-bold border transition ${
                              formData.tipo_intervalo === 'DIAS'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                          >
                            A cada X dias
                          </button>
                        </div>
                      </div>
                      <div>
                        {formData.tipo_intervalo === 'DIAS' ? (
                          <InputDark
                            label="Intervalo (dias)"
                            type="number"
                            min={1}
                            value={formData.intervalo_dias || 30}
                            onChange={(e: any) =>
                              setFormData((prev: any) => ({
                                ...prev,
                                intervalo_dias: Math.max(1, Number(e.target.value) || 30),
                              }))
                            }
                          />
                        ) : (
                          <div className="opacity-50 select-none">
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Intervalo</label>
                            <div className="py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-400 bg-white dark:bg-slate-900 h-[38px] flex items-center">
                              30 dias (Aprox.)
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <ToggleSimNao
                        label="Ajustar vencimentos para dia útil?"
                        value={formData.ajustar_vencimento_dia_util !== false}
                        onChange={(next) => setFormData((prev: any) => ({ ...prev, ajustar_vencimento_dia_util: next }))}
                      />
                      <p className="mt-1 text-[11px] text-slate-400">
                        Se ativado, parcelas que caírem em finais de semana serão movidas para a próxima segunda-feira.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Competência das parcelas</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'POR_PARCELA' }))}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            formData.competencia_modo_parcelamento === 'POR_PARCELA'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Por parcela
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormData((prev: any) => ({ ...prev, competencia_modo_parcelamento: 'MES_COMPRA' }))}
                          className={`py-2 rounded-lg text-xs font-bold border transition ${
                            formData.competencia_modo_parcelamento === 'MES_COMPRA'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          Mês da compra
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        Por parcela: cada parcela entra no mês correspondente. Mês da compra: todas as parcelas ficam na competência
                        da compra.
                      </p>
                    </div>

                    {formData.valor_previsto && formData.qtd_parcelas && (
                      <div className="text-xs text-slate-400">
                        {formData.modo_calculo === 'TOTAL' ? (
                          <>
                            {formData.qtd_parcelas}x de{' '}
                            <strong className="text-blue-300">
                              {BRL.format(Number(formData.valor_previsto) / Number(formData.qtd_parcelas || 1))}
                            </strong>
                          </>
                        ) : (
                          <>
                            {formData.qtd_parcelas}x de <strong className="text-blue-300">{BRL.format(Number(formData.valor_previsto))}</strong>{' '}
                            • Total {BRL.format(Number(formData.valor_previsto) * Number(formData.qtd_parcelas || 1))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <InputDark
                label="Competência (MM-AAAA)"
                placeholder="02-2026"
                value={formData.competencia}
                onChange={(e: any) => handleCompetenciaChange(e.target.value)}
              />
               {!isCaixaMode && (
                <ToggleSimNao
                  label="Esse valor é previsto?"
                  disabled={formData.conciliado}
                  value={!!formData.previsto}
                  onChange={(next) => setFormData((prev: any) => ({ ...prev, previsto: next }))}
                />
              )}
            </div>

            {/* CATEGORIA */}
            <div>
              <SearchableSelect
                label="Categoria"
                placeholder="Selecione..."
                options={catOptions}
                value={formData.plano_contas_id}
                onChange={(id: any) => {
                  const cat = categorias.find((c) => String(c.id) === String(id));
                  const tipoCat = String(cat?.tipo || '').trim().toUpperCase();
                  setFormData((prev: any) => ({
                    ...prev,
                    plano_contas_id: id,
                    tipo: tipoCat.startsWith('R') ? 'RECEITA' : 'DESPESA',
                  }));
                }}
              />
            </div>

            {formData.cartao_id && formData.data_vencimento && (
              <div className="text-xs text-slate-400">
                Vencimento da fatura:{' '}
                <strong className="text-blue-300">
                  {computeCartaoVencimento(formData.data_vencimento, formData.cartao_id, cartoes) || '—'}
                </strong>
              </div>
            )}

            {/* PAGAMENTO */}
            {!isCaixaMode && (
              <div ref={pagamentoSectionRef} className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <ToggleSimNao
                  label="Já foi pago/recebido?"
                  disabled={formData.conciliado}
                  value={formData.status === 'PAGO'}
                  onChange={handleStatusPagoChange}
                />
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    formData.status === 'PAGO' ? 'max-h-48 opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
                  }`}
                >
                  <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <InputDark
                      label="Data da Baixa"
                      type="date"
                      disabled={formData.conciliado}
                      value={formData.data_pagamento}
                      onChange={(e: any) => handleDataPagamentoChange(e.target.value)}
                    />
                    <div className="w-full">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Valor Pago (R$)</label>
                      <input
                        type="text"
                        disabled={formData.conciliado}
                        value={paidAmountText}
                        onChange={(e) => {
                          const rawVal = e.target.value;
                          const cleanExpr = rawVal.replace(/\./g, '').replace(/,/g, '');
                          const formatted = formatExpressionCentsFirst(cleanExpr);
                          setPaidAmountText(formatted);
                        }}
                        onBlur={handlePaidAmountBlur}
                        placeholder="0,00 ou 150+300"
                        className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 text-emerald-400 font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CENTRO DE CUSTO E ORIGEM DOS RECURSOS (COM FILTRAGEM INTELIGENTE) */}
            {!isCaixaMode && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Centro de Custo</label>
                <div className="mb-3">
                  <select
                    className="w-full p-2 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={formData.conciliado}
                    value={formData.centro_custo_id}
                    onChange={(e) =>
                      setFormData((prev: any) => ({
                        ...prev,
                        centro_custo_id: e.target.value,
                        conta_id: '',
                        cartao_id: '',
                      }))
                    }
                  >
                    <option value="">Selecione um centro de custo</option>
                    {centros.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-3 bg-slate-50 dark:bg-slate-800/30 space-y-4">
                  {(() => {
                    const contasAtivasNoCentro = getContasAtivasByCentro(formData.centro_custo_id);
                    return (
                      <>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${
                            formData.status === 'PAGO' ? 'max-h-[55vh] opacity-100' : 'max-h-0 opacity-0'
                          }`}
                        >
                          <div className="pb-1 max-h-[52vh] overflow-y-auto pr-1 custom-scrollbar">
                            <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                              <Wallet className="w-3 h-3" /> Contas Bancárias
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {contasAtivasNoCentro.length === 0 && (
                                <span className="text-xs text-slate-500 italic col-span-2">
                                  Nenhuma conta ativa neste centro.
                                </span>
                              )}
                              {contasAtivasNoCentro.map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => {
                                    if (!formData.conciliado) {
                                      toggleConta(c.id);
                                    }
                                  }}
                                  className={`p-2 rounded border text-xs font-bold flex gap-2 items-center transition ${
                                    formData.conciliado
                                      ? 'cursor-not-allowed opacity-60'
                                      : 'cursor-pointer'
                                  } ${
                                    formData.conta_id === c.id
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  <div
                                    className={`p-1 rounded ${
                                      formData.conta_id === c.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-emerald-500'
                                    }`}
                                  >
                                    <BankAvatar
                                      logoUrl={getFullLogoUrl(c.logo_url)}
                                      bankName={c.banco}
                                      accountName={c.nome}
                                      integrationType={c.tipo_integracao}
                                      size="sm"
                                      className="h-4 w-4"
                                      imageClassName="rounded-sm"
                                      fallbackClassName="rounded-sm border-0 shadow-none"
                                    />
                                  </div>
                                  {c.nome}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* CARTÕES */}
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                            <CreditCard className="w-3 h-3" /> Cartões de Crédito
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {cartoes.filter(
                              (c) => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id)
                            ).length === 0 && (
                              <span className="text-xs text-slate-500 italic col-span-2">Nenhum cartão neste centro.</span>
                            )}
                            {cartoes
                              .filter((c) => !formData.centro_custo_id || String(c.centro_custo_id) === String(formData.centro_custo_id))
                              .map((c) => (
                                <div
                                  key={c.id}
                                  onClick={() => {
                                    if (!formData.conciliado) {
                                      toggleCartao(c.id);
                                    }
                                  }}
                                  className={`p-2 rounded border text-xs font-bold flex gap-2 items-center transition ${
                                    formData.conciliado
                                      ? 'cursor-not-allowed opacity-60'
                                      : 'cursor-pointer'
                                  } ${
                                    formData.cartao_id === c.id
                                      ? 'bg-purple-600 text-white border-purple-500 shadow-md'
                                      : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  <div
                                    className={`p-1 rounded ${
                                      formData.cartao_id === c.id ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-700 text-purple-500'
                                    }`}
                                  >
                                    <CreditCard className="w-3 h-3" />
                                  </div>{' '}
                                  {c.nome_cartao}
                                </div>
                              ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <InputDark
                label="Código de barras"
                value={formData.observacao || ''}
                onChange={(e: any) => setFormData((prev: any) => ({ ...prev, observacao: e.target.value }))}
                placeholder="Cole aqui o código de barras para facilitar copiar e colar no pagamento"
              />
              {formData.observacao && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(String(formData.observacao || ''));
                        pushToast('success', 'Código de barras copiado.');
                      } catch {
                        pushToast('error', 'Não foi possível copiar o código de barras.');
                      }
                    }}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copiar código
                  </button>
                </div>
              )}
            </div>

            {/* DETALHAMENTO DE VENDAS DE ORIGEM (RECEBÍVEL AGRUPADO DE CARTÃO) */}
            {(() => {
              if (!formData.observacao) return null;
              try {
                const meta = JSON.parse(formData.observacao);
                if (!meta.grouped_card_launch || !meta.contribuicoes) return null;
                const contribuicoesList = Object.entries(meta.contribuicoes).map(([vendaId, val]: [string, any]) => ({
                  vendaId,
                  ...(typeof val === 'object' ? val : { valor: val, rv: 'N/A', vendedor: 'N/A', cliente: 'N/A' })
                }));

                return (
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <label className="block text-xs font-bold text-slate-400 uppercase flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-extrabold">
                        <Layers className="w-3.5 h-3.5" />
                        Vendas de Origem Agrupadas ({meta.bandeira} {meta.modalidade})
                      </span>
                      <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-bold">
                        {contribuicoesList.length} venda(s)
                      </span>
                    </label>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-400 font-bold uppercase text-[10px]">
                            <th className="py-1.5 px-2">RV</th>
                            <th className="py-1.5 px-2">Vendedor</th>
                            <th className="py-1.5 px-2">Cliente</th>
                            <th className="py-1.5 px-2 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                          {contribuicoesList.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/60">
                              <td className="py-1.5 px-2 font-bold text-slate-800 dark:text-white">{item.rv || 'N/A'}</td>
                              <td className="py-1.5 px-2 text-slate-600 dark:text-slate-300">{item.vendedor || 'N/A'}</td>
                              <td className="py-1.5 px-2 text-slate-600 dark:text-slate-300">{item.cliente || 'N/A'}</td>
                              <td className="py-1.5 px-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                {BRL.format(Number(item.valor || 0))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              } catch {
                return null;
              }
            })()}

            {/* HISTÓRICO DE CONCILIAÇÃO (BAIXAS) */}
            {isEditing && formData.baixas && formData.baixas.length > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" />
                  Histórico de Conciliação / Baixas
                </label>
                <div className="space-y-2.5">
                  {formData.baixas.map((baixa: any) => {
                    const mov = baixa.movimento;
                    return (

                      <div key={baixa.id} className="flex justify-between items-start text-xs border-b border-slate-200 dark:border-slate-700/60 pb-2 last:border-0 last:pb-0">
                        <div>
                          <p className="font-semibold text-slate-700 dark:text-slate-200">
                            {mov ? mov.descricao : `Baixa avulsa (${baixa.tipo_baixa})`}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {mov ? `Movimento em ${formatDateShort(mov.data)}` : `Data da baixa: ${formatDateShort(baixa.data_baixa)}`}
                            {baixa.tipo_baixa !== 'PRINCIPAL' && ` • Tipo: ${baixa.tipo_baixa}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-slate-700 dark:text-slate-100">
                            {BRL.format(Number(baixa.valor_pago))}
                          </p>
                          {mov && (
                            <span className="text-[9px] font-black uppercase text-blue-500 bg-blue-50 dark:bg-blue-950/40 px-1 py-0.2 rounded">
                              OFX
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ANEXOS */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Anexos</label>

              {formData.anexos && formData.anexos.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {formData.anexos.map((anexo: Anexo) => {
                    const anexoUrl = resolveAnexoUrl(anexo.url);
                    return (
                      <div
                        key={anexo.id}
                        className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-xs group hover:border-blue-500 transition"
                      >
                        {getFileIcon(anexo.nome_arquivo)}
                        <a
                          href={anexoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate text-slate-700 dark:text-slate-200 hover:text-blue-400 font-medium"
                        >
                          {anexo.nome_arquivo}
                        </a>
                        <a
                          href={anexoUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-500 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Download className="w-3 h-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleRemoverAnexo(anexo)}
                          className="p-1 text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30"
                          title="Remover anexo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-2xl p-8 text-center hover:border-blue-500 relative cursor-pointer bg-slate-100 dark:bg-slate-800/40 hover:bg-slate-200 dark:hover:bg-slate-800 transition group shadow-sm">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.xls,.xlsx,.ppt,.pptx"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) => setFilesToUpload(e.target.files)}
                />
                <UploadCloud className="w-10 h-10 mx-auto text-slate-500 mb-3 group-hover:text-blue-500 transition-colors" />
                <p className="text-base font-semibold text-slate-600 dark:text-slate-300">Arraste ou clique para anexar</p>
                <p className="text-xs text-slate-500 mt-1">PDF, Imagens, Excel, PowerPoint</p>
                <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-slate-600 dark:bg-slate-700 text-slate-100 text-sm font-bold group-hover:bg-blue-600 transition-colors">
                  Selecionar arquivos
                </div>
                {filesToUpload && <p className="text-xs text-blue-400 font-bold mt-2">{filesToUpload.length} novos arquivos</p>}
              </div>
            </div>

            {/* INLINE SILENCING CHECKBOX */}
            {isEditing && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={inlineSilencing}
                    onChange={(e) => setInlineSilencing(e.target.checked)}
                    className="rounded border-slate-200 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                  />
                  <span>Ignorar alertas futuros similares</span>
                </label>
                {inlineSilencing && (
                  <p className="text-[10px] text-slate-400 leading-relaxed pl-6 text-left">
                    Ao marcar esta opção, o sistema criará automaticamente uma regra de silenciamento para a categoria selecionada e este favorecido, evitando alertas de desvio de valor.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex justify-end gap-3">
            <button
              onClick={() => void requestCloseDrawer()}
              className="px-5 py-2.5 rounded-lg text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-8 py-2.5 rounded-lg font-bold shadow-lg flex items-center gap-2 transition disabled:opacity-50 ${
                hasUnsavedDrawerChanges
                  ? 'bg-yellow-400 text-slate-950 hover:bg-yellow-300 ring-2 ring-yellow-300/70 animate-pulse'
                  : 'bg-slate-200 text-slate-800 hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600'
              }`}
            >
              {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Check className="w-4 h-4" />} Salvar
            </button>
          </div>
        </div>
      </div>
      {showEntityDrawer && (
        <QuickEntityDrawer
          showEntityDrawer={showEntityDrawer}
          onClose={() => setShowEntityDrawer(false)}
          onSuccess={(newEntity) => {
            setLocalEntidades((prev) => {
              if (prev.some((e) => e.id === newEntity.id)) return prev;
              return [...prev, newEntity];
            });
            setFormData((prev: any) => ({ ...prev, entidade_id: String(newEntity.id) }));
            if (onEntityCreated) {
              onEntityCreated(newEntity);
            }
            // Update Zustand lookup store caches immediately
            const currentEntidades = useLookupStore.getState().entidades;
            if (!currentEntidades.some((e) => e.id === newEntity.id)) {
              setEntidadesCache([...currentEntidades, newEntity]);
            }
            const currentLookup = useLookupStore.getState().entidadesLookup;
            if (!currentLookup.some((e) => e.id === newEntity.id)) {
              setEntidadesLookupCache([...currentLookup, newEntity]);
            }
            // Background silent sync
            void fetchEntidades(true).catch(() => {});
            void fetchEntidadesLookup(true).catch(() => {});
          }}
          pushToast={pushToast}
        />
      )}

      {confirmModal.show && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => {
              confirmModal.resolver?.(false);
              setConfirmModal((prev) => ({ ...prev, show: false }));
            }}
          ></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
            <h3 className="font-extrabold text-xl text-slate-800 dark:text-white mb-2 tracking-tight">
              {confirmModal.title}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  confirmModal.resolver?.(false);
                  setConfirmModal((prev) => ({ ...prev, show: false }));
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                {confirmModal.cancelText || 'Cancelar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.resolver?.(true);
                  setConfirmModal((prev) => ({ ...prev, show: false }));
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition duration-150 cursor-pointer border-0 shadow-lg shadow-blue-500/10"
              >
                {confirmModal.confirmText || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showScopeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => scopeModalResolver?.(null)}></div>
          <div className="relative bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
            <h3 className="font-extrabold text-xl text-slate-800 dark:text-white mb-2 tracking-tight">
              Aplicar alterações
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              Você alterou campos que afetam a recorrência das parcelas. Escolha em qual escopo deseja aplicar estas alterações:
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => scopeModalResolver?.('ESTA')}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 transition duration-150 text-left flex justify-between items-center group cursor-pointer border-0"
              >
                <span>Só esta parcela</span>
                <span className="text-[10px] text-slate-400 group-hover:text-slate-300">Apenas a parcela atual</span>
              </button>
              <button
                type="button"
                onClick={() => scopeModalResolver?.('PROXIMAS')}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-100 transition duration-150 text-left flex justify-between items-center group cursor-pointer border-0"
              >
                <span>Esta e as próximas</span>
                <span className="text-[10px] text-slate-400 group-hover:text-slate-300">Da atual em diante</span>
              </button>
              <button
                type="button"
                onClick={() => scopeModalResolver?.('TODAS')}
                className="w-full py-3 px-4 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white transition duration-150 text-left flex justify-between items-center group shadow-lg shadow-blue-500/10 cursor-pointer border-0"
              >
                <span>Todas as parcelas</span>
                <span className="text-[10px] text-blue-200 group-hover:text-white">A série completa</span>
              </button>
            </div>
            <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => scopeModalResolver?.(null)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700/50 transition cursor-pointer border-0"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
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

  if (embedFullscreenDrawer) {
    return drawerElement;
  }

  return createPortal(drawerElement, document.body);
};
