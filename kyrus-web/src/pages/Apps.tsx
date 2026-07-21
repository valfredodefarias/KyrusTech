import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, ArrowRight, Store, CreditCard, Users, Megaphone, 
  Plus, Calendar, DollarSign, Clock, HelpCircle, Check, X, 
  Trash2, AlertCircle, Percent, ArrowUpRight, TrendingUp, CheckCircle, Package,
  Lock, Settings, Edit, Sparkles, ShieldAlert, Calculator, Utensils
} from 'lucide-react';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';

// Type definitions
interface iFoodTransaction {
  id: number;
  forma_recebimento: string;
  valor_bruto: number;
  valor_liquido: number;
  data_venda: string;
  hora_venda: string;
  data_recebimento_ajustada: string;
  despesas_extras: string[];
  status_conciliado: boolean;
}

export function Apps() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  const [activeApp, setActiveApp] = useState<'marketplace' | 'ifood'>('marketplace');
  const [transactions, setTransactions] = useState<iFoodTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  
  // Apps settings & configuration states
  const [activeApps, setActiveApps] = useState<string[]>([]);
  const [ifoodTaxa, setIfoodTaxa] = useState<number>(12.0);
  const [ifoodMerchantName, setIfoodMerchantName] = useState<string>('');
  const [centroCustoPadraoId, setCentroCustoPadraoId] = useState<number | ''>('');
  const [centroCustoFlexivel, setCentroCustoFlexivel] = useState<boolean>(false);
  const [ifoodCentroCustoPadraoId, setIfoodCentroCustoPadraoId] = useState<number | ''>('');
  const [ifoodCentroCustoFlexivel, setIfoodCentroCustoFlexivel] = useState<boolean>(false);
  const [pdvCentroCustoPadraoId, setPdvCentroCustoPadraoId] = useState<number | ''>('');
  const [pdvCentroCustoFlexivel, setPdvCentroCustoFlexivel] = useState<boolean>(false);
  
  // Modal configurations
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTaxa, setSettingsTaxa] = useState('12.0');
  const [settingsMerchantName, setSettingsMerchantName] = useState('');
  const [settingsIfoodCentroCustoPadraoId, setSettingsIfoodCentroCustoPadraoId] = useState<number | ''>('');
  const [settingsIfoodCentroCustoFlexivel, setSettingsIfoodCentroCustoFlexivel] = useState<boolean>(false);
  const [settingsActiveToggle, setSettingsActiveToggle] = useState(false);

  // PDV settings modal configurations
  const [showPdvSettingsModal, setShowPdvSettingsModal] = useState(false);
  const [settingsPdvCentroCustoPadraoId, setSettingsPdvCentroCustoPadraoId] = useState<number | ''>('');
  const [settingsPdvCentroCustoFlexivel, setSettingsPdvCentroCustoFlexivel] = useState<boolean>(false);
  const [pdvConfigMarcadoPago, setPdvConfigMarcadoPago] = useState<Record<string, boolean>>({});
  const [formasPagamento, setFormasPagamento] = useState<any[]>([]);
  const [pdvConfigCategorias, setPdvConfigCategorias] = useState<Record<string, string>>({});
  const [pdvConfigContas, setPdvConfigContas] = useState<Record<string, string>>({});
  const [settingsPdvCategorias, setSettingsPdvCategorias] = useState<Record<string, string>>({});
  
  // Default accounts configurations
  const [pdvContaPadraoId, setPdvContaPadraoId] = useState<number | ''>('');
  const [ifoodContaPadraoId, setIfoodContaPadraoId] = useState<number | ''>('');
  const [settingsPdvContaPadraoId, setSettingsPdvContaPadraoId] = useState<number | ''>('');
  const [settingsIfoodContaPadraoId, setSettingsIfoodContaPadraoId] = useState<number | ''>('');

  // Sangria categories
  const [pdvSangriaSaidaPlanoContasId, setPdvSangriaSaidaPlanoContasId] = useState<number | ''>('');
  const [pdvSangriaEntradaPlanoContasId, setPdvSangriaEntradaPlanoContasId] = useState<number | ''>('');
  const [settingsPdvSangriaSaidaPlanoContasId, setSettingsPdvSangriaSaidaPlanoContasId] = useState<number | ''>('');
  const [settingsPdvSangriaEntradaPlanoContasId, setSettingsPdvSangriaEntradaPlanoContasId] = useState<number | ''>('');

  // Consolidação Financeira
  const [showConsolidateModal, setShowConsolidateModal] = useState(false);
  const [selectedContaId, setSelectedContaId] = useState<number | ''>('');
  const [contas, setContas] = useState<any[]>([]);

  // Delete transaction confirmation
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [txToDelete, setTxToDelete] = useState<iFoodTransaction | null>(null);

  // Edit transaction state
  const [editingTransaction, setEditingTransaction] = useState<iFoodTransaction | null>(null);
  const [showDateConfig, setShowDateConfig] = useState(false);

  // Toast feedback state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Search and filter state
  const [dateSearch, setDateSearch] = useState('');

  // Drawer Form State
  const [formFormaRecebimento, setFormFormaRecebimento] = useState('Pix Ifood');
  const [formValorBruto, setFormValorBruto] = useState('R$ 0,00');
  const [formDespesasExtras, setFormDespesasExtras] = useState<string[]>([]);
  const [formDataVenda, setFormDataVenda] = useState(new Date().toISOString().split('T')[0]);
  const [formDataRecebimento, setFormDataRecebimento] = useState(new Date().toISOString().split('T')[0]);
  const [formHoraVenda, setFormHoraVenda] = useState(new Date().toLocaleTimeString('pt-BR', { hour12: false }));
  const [submitting, setSubmitting] = useState(false);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const showToastMessage = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  // Fetch configs and active apps
  const fetchConfig = async () => {
    try {
      const response = await api.get('/pdv/config');
      if (response.data) {
        setActiveApps(response.data.active_apps || []);
        setIfoodTaxa(response.data.ifood_comissao_taxa ?? 12.0);
        setIfoodMerchantName(response.data.ifood_merchant_name || '');
        setCentroCustoPadraoId(response.data.centro_custo_padrao_id ?? '');
        setCentroCustoFlexivel(response.data.centro_custo_flexivel ?? false);
        setIfoodCentroCustoPadraoId(response.data.ifood_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setIfoodCentroCustoFlexivel(response.data.ifood_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvCentroCustoPadraoId(response.data.pdv_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setPdvCentroCustoFlexivel(response.data.pdv_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvContaPadraoId(response.data.pdv_conta_padrao_id ?? '');
        setIfoodContaPadraoId(response.data.ifood_conta_padrao_id ?? '');
        setPdvSangriaSaidaPlanoContasId(response.data.pdv_sangria_saida_plano_contas_id ?? '');
        setPdvSangriaEntradaPlanoContasId(response.data.pdv_sangria_entrada_plano_contas_id ?? '');
        setPdvConfigMarcadoPago(response.data.marcar_como_pago || {});
        let loadedFormas = [
          { key: 'dinheiro', label: 'Dinheiro', parcelada: false, ativa: true },
          { key: 'pix_chave', label: 'PIX (Chave)', parcelada: false, ativa: true },
          { key: 'pix_qr', label: 'PIX (QR Code)', parcelada: false, ativa: true },
          { key: 'cartao_debito', label: 'Cartão de Débito', parcelada: false, ativa: true },
          { key: 'cartao_credito_vista', label: 'Cartão de Crédito (À Vista)', parcelada: false, ativa: true },
          { key: 'cartao_credito_parcelado', label: 'Cartão de Crédito (Parcelado)', parcelada: true, ativa: true },
          { key: 'boleto', label: 'Boleto', parcelada: true, ativa: true }
        ];
        if (response.data.formas_pagamento && response.data.formas_pagamento.length > 0) {
          const parsedKeys = new Set(response.data.formas_pagamento.map((f: any) => f.key));
          loadedFormas = [
            ...response.data.formas_pagamento,
            ...loadedFormas.filter((df) => !parsedKeys.has(df.key))
          ];
        }
        setFormasPagamento(loadedFormas);
        setPdvConfigCategorias(response.data.categorias || {});
        setPdvConfigContas(response.data.contas || {});
      }
    } catch (err) {
      console.error('Erro ao buscar configurações do PDV:', err);
    }
  };

  // Fetch bank accounts
  const fetchContas = async () => {
    try {
      const response = await api.get('/contas/');
      setContas(normalizeListResponse(response.data));
    } catch (err) {
      console.error('Erro ao buscar contas:', err);
    }
  };

  // Fetch transactions from API
  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const response = await api.get('/pdv/ifood/transacoes');
      setTransactions(normalizeListResponse<iFoodTransaction>(response.data));
    } catch (error) {
      console.error('Erro ao carregar transações iFood:', error);
    } finally {
      setLoading(false);
    }
  };

  const activeCompany = useAuthStore((state) => state.empresa);
  const user = useAuthStore((state) => state.user);
  const empresaId = activeCompany?.id ?? user?.empresa_id;

  const centrosCusto = useLookupStore((state) => state.centrosCusto);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const planoContas = useLookupStore((state) => state.planoContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);

  // Load configs on mount or company change
  useEffect(() => {
    if (empresaId) {
      void fetchConfig();
      void fetchContas();
      void fetchCentrosCusto();
      void fetchPlanoContas();
    }
  }, [empresaId]);

  // Sync route and check for deactivation fallback
  useEffect(() => {
    if (tab === 'ifood') {
      setActiveApp('ifood');
    } else {
      setActiveApp('marketplace');
    }
  }, [tab]);

  // Load transactions when entering active ifood board
  useEffect(() => {
    if (activeApp === 'ifood' && activeApps.includes('ifood')) {
      void fetchTransactions();
    }
  }, [activeApp, activeApps]);

  // Handle toast timeout
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Aggregate transactions by date
  const dailyConsolidated = useMemo(() => {
    const map: Record<string, { total_bruto: number; count: number }> = {};
    transactions.forEach((tx) => {
      const date = tx.data_venda;
      if (!map[date]) {
        map[date] = { total_bruto: 0, count: 0 };
      }
      const valBruto = Number(tx.valor_bruto) > 0 ? Number(tx.valor_bruto) : Number(tx.valor_liquido);
      map[date].total_bruto += valBruto;
      map[date].count += 1;
    });

    return Object.entries(map)
      .map(([date, info]) => ({
        date,
        total: info.total_bruto,
        count: info.count
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions]);

  // Set default selected date once aggregated list loads
  useEffect(() => {
    if (dailyConsolidated.length > 0 && !selectedDate) {
      setSelectedDate(dailyConsolidated[0].date);
    }
  }, [dailyConsolidated, selectedDate]);

  // Filtered dates on sidebar search
  const filteredDailyConsolidated = useMemo(() => {
    if (!dateSearch.trim()) return dailyConsolidated;
    return dailyConsolidated.filter((d) => {
      const formattedDate = new Date(d.date + 'T00:00:00').toLocaleDateString('pt-BR');
      return formattedDate.includes(dateSearch) || d.date.includes(dateSearch);
    });
  }, [dailyConsolidated, dateSearch]);

  // Selected date details
  const selectedDateTransactions = useMemo(() => {
    if (!selectedDate) return [];
    return transactions.filter((tx) => tx.data_venda === selectedDate);
  }, [transactions, selectedDate]);

  // Selected date summary metrics
  const selectedDateMetrics = useMemo(() => {
    let bruto = 0;
    let liquido = 0;
    selectedDateTransactions.forEach((tx) => {
      const valBruto = Number(tx.valor_bruto) > 0 ? Number(tx.valor_bruto) : Number(tx.valor_liquido);
      bruto += valBruto;
      liquido += Number(tx.valor_liquido);
    });
    return {
      bruto,
      taxa: bruto - liquido,
      liquido
    };
  }, [selectedDateTransactions]);

  // Group transactions of selected date by payment method
  const groupedTransactions = useMemo(() => {
    const groups: Record<string, { total: number; list: iFoodTransaction[] }> = {};
    selectedDateTransactions.forEach((tx) => {
      const mode = tx.forma_recebimento;
      if (!groups[mode]) {
        groups[mode] = { total: 0, list: [] };
      }
      const valBruto = Number(tx.valor_bruto) > 0 ? Number(tx.valor_bruto) : Number(tx.valor_liquido);
      groups[mode].total += valBruto;
      groups[mode].list.push(tx);
    });
    return Object.entries(groups).map(([name, val]) => ({
      name,
      total: val.total,
      list: val.list.sort((a, b) => b.hora_venda.localeCompare(a.hora_venda))
    }));
  }, [selectedDateTransactions]);

  // Handle value formatting for currency input
  const handleCurrencyChange = (valueStr: string) => {
    const cleanVal = valueStr.replace(/\D/g, '');
    if (!cleanVal) {
      setFormValorBruto('R$ 0,00');
      return;
    }
    const numValue = parseInt(cleanVal) / 100;
    setFormValorBruto(formatCurrency(numValue));
  };

  const parseCurrency = (valStr: string) => {
    const clean = valStr.replace(/\D/g, '');
    if (!clean) return 0;
    return parseInt(clean) / 100;
  };

  // Adjust input value using +/- controls
  const adjustFormValue = (delta: number) => {
    const current = parseCurrency(formValorBruto);
    const updated = Math.max(0, current + delta);
    setFormValorBruto(formatCurrency(updated));
  };

  // Auto adjust due dates based on selected payment method and payout rules
  useEffect(() => {
    if (!formDataVenda) return;
    const baseDate = new Date(formDataVenda + 'T00:00:00');
    
    // Check if it is a Dinheiro payment (immediate D+0)
    if (formFormaRecebimento.includes('Dinheiro')) {
      setFormDataRecebimento(baseDate.toISOString().split('T')[0]);
      return;
    }
    
    // If it is an online payment processed by iFood (ends with Ifood or is Carteira digital)
    const isOnlineIfood = formFormaRecebimento.endsWith('Ifood') || formFormaRecebimento === 'Carteira digital';
    
    if (isOnlineIfood) {
      // iFood online payments are paid on weekly Wednesday repasses after 7 days
      baseDate.setDate(baseDate.getDate() + 7);
      const dayOfWeek = baseDate.getDay(); // 0 is Sunday, 1 is Monday, etc.
      let daysToWednesday = 0;
      if (dayOfWeek !== 3) {
        daysToWednesday = (10 - dayOfWeek) % 7;
      }
      baseDate.setDate(baseDate.getDate() + daysToWednesday);
    } else {
      // Offline payments processed on restaurant's own machines
      let offsetDays = 0;
      if (formFormaRecebimento.includes('Crédito') || formFormaRecebimento === 'Crédito à vista') {
        offsetDays = 30;
      } else if (formFormaRecebimento.includes('Débito')) {
        offsetDays = 1;
      } else if (formFormaRecebimento.includes('Pix')) {
        offsetDays = 0;
      }
      
      baseDate.setDate(baseDate.getDate() + offsetDays);
      
      // Roll forward to Monday if it falls on Saturday (+2) or Sunday (+1)
      const dayOfWeek = baseDate.getDay();
      if (dayOfWeek === 6) { // Saturday
        baseDate.setDate(baseDate.getDate() + 2);
      } else if (dayOfWeek === 0) { // Sunday
        baseDate.setDate(baseDate.getDate() + 1);
      }
    }
    
    setFormDataRecebimento(baseDate.toISOString().split('T')[0]);
  }, [formFormaRecebimento, formDataVenda]);

  // Handle extra expenses toggle
  const toggleExtraExpense = (key: string) => {
    setFormDespesasExtras((prev) => 
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Form submission handler
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const brutoNum = parseCurrency(formValorBruto);
    if (brutoNum <= 0) {
      showToastMessage('Por favor, informe um valor bruto maior que zero.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        forma_recebimento: formFormaRecebimento,
        valor_bruto: brutoNum,
        data_venda: formDataVenda,
        hora_venda: formHoraVenda || "00:00:00",
        data_recebimento_ajustada: formDataRecebimento,
        despesas_extras: formDespesasExtras
      };

      if (editingTransaction) {
        await api.put(`/pdv/ifood/transacoes/${editingTransaction.id}`, payload);
        showToastMessage('Lançamento iFood atualizado com sucesso!', 'success');
      } else {
        await api.post('/pdv/ifood/transacoes', payload);
        showToastMessage('Lançamento iFood registrado com sucesso!', 'success');
      }
      
      // Reset form
      setFormValorBruto('R$ 0,00');
      setFormDespesasExtras([]);
      setFormHoraVenda(new Date().toLocaleTimeString('pt-BR', { hour12: false }));
      setEditingTransaction(null);
      
      // Refresh board
      await fetchTransactions();
      setShowDrawer(false);
    } catch (error: any) {
      showToastMessage(error?.response?.data?.detail || 'Erro ao salvar lançamento iFood.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditTransaction = (tx: iFoodTransaction) => {
    setEditingTransaction(tx);
    setFormFormaRecebimento(tx.forma_recebimento);
    setFormValorBruto(formatCurrency(Number(tx.valor_bruto)));
    setFormDespesasExtras(tx.despesas_extras || []);
    setFormDataVenda(tx.data_venda);
    setFormDataRecebimento(tx.data_recebimento_ajustada);
    setFormHoraVenda(tx.hora_venda);
    setShowDateConfig(false);
    setShowDrawer(true);
  };

  const handleSaveConfig = async (
    active: boolean, 
    customTaxa: number, 
    merchantName: string, 
    ifoodCcId: number | '', 
    ifoodCcFlex: boolean,
    ifoodAccId: number | ''
  ) => {
    try {
      const nextActiveApps = active 
        ? [...activeApps.filter(a => a !== 'ifood'), 'ifood']
        : activeApps.filter(a => a !== 'ifood');

      const response = await api.put('/pdv/config', {
        marcar_como_pago: {},
        active_apps: nextActiveApps,
        ifood_comissao_taxa: customTaxa,
        ifood_merchant_name: merchantName,
        centro_custo_padrao_id: ifoodCcId === '' ? null : ifoodCcId,
        centro_custo_flexivel: ifoodCcFlex,
        ifood_centro_custo_padrao_id: ifoodCcId === '' ? null : ifoodCcId,
        ifood_centro_custo_flexivel: ifoodCcFlex,
        pdv_centro_custo_padrao_id: pdvCentroCustoPadraoId === '' ? null : pdvCentroCustoPadraoId,
        pdv_centro_custo_flexivel: pdvCentroCustoFlexivel,
        pdv_conta_padrao_id: pdvContaPadraoId === '' ? null : pdvContaPadraoId,
        ifood_conta_padrao_id: ifoodAccId === '' ? null : ifoodAccId,
        pdv_sangria_saida_plano_contas_id: pdvSangriaSaidaPlanoContasId === '' ? null : pdvSangriaSaidaPlanoContasId,
        pdv_sangria_entrada_plano_contas_id: pdvSangriaEntradaPlanoContasId === '' ? null : pdvSangriaEntradaPlanoContasId
      });

      if (response.data) {
        setActiveApps(response.data.active_apps || []);
        setIfoodTaxa(response.data.ifood_comissao_taxa ?? 12.0);
        setIfoodMerchantName(response.data.ifood_merchant_name || '');
        setCentroCustoPadraoId(response.data.centro_custo_padrao_id ?? '');
        setCentroCustoFlexivel(response.data.centro_custo_flexivel ?? false);
        setIfoodCentroCustoPadraoId(response.data.ifood_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setIfoodCentroCustoFlexivel(response.data.ifood_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvCentroCustoPadraoId(response.data.pdv_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setPdvCentroCustoFlexivel(response.data.pdv_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvContaPadraoId(response.data.pdv_conta_padrao_id ?? '');
        setIfoodContaPadraoId(response.data.ifood_conta_padrao_id ?? '');
        showToastMessage(
          active ? 'Integração do iFood ativada e configurada!' : 'Integração do iFood desativada.',
          'success'
        );
        window.dispatchEvent(new Event('active-apps-changed'));
      }
      setShowSettingsModal(false);
    } catch (err: any) {
      showToastMessage('Erro ao atualizar configurações da integração.', 'error');
    }
  };

  const handleSavePdvConfig = async (
    pdvCcId: number | '', 
    pdvCcFlex: boolean,
    pdvAccId: number | '',
    sangriaSaidaPlanoId?: number | '',
    sangriaEntradaPlanoId?: number | ''
  ) => {
    try {
      const response = await api.put('/pdv/config', {
        marcar_como_pago: pdvConfigMarcadoPago,
        active_apps: activeApps,
        ifood_comissao_taxa: ifoodTaxa,
        ifood_merchant_name: ifoodMerchantName,
        pdv_centro_custo_padrao_id: pdvCcId === '' ? null : pdvCcId,
        pdv_centro_custo_flexivel: pdvCcFlex,
        pdv_conta_padrao_id: pdvAccId === '' ? null : pdvAccId,
        pdv_sangria_saida_plano_contas_id: sangriaSaidaPlanoId === '' ? null : sangriaSaidaPlanoId,
        pdv_sangria_entrada_plano_contas_id: sangriaEntradaPlanoId === '' ? null : sangriaEntradaPlanoId,
        ifood_centro_custo_padrao_id: ifoodCentroCustoPadraoId === '' ? null : ifoodCentroCustoPadraoId,
        ifood_centro_custo_flexivel: ifoodCentroCustoFlexivel,
        ifood_conta_padrao_id: ifoodContaPadraoId === '' ? null : ifoodContaPadraoId,
        formas_pagamento: formasPagamento,
        categorias: settingsPdvCategorias,
        contas: pdvConfigContas
      });

      if (response.data) {
        setCentroCustoPadraoId(response.data.centro_custo_padrao_id ?? '');
        setCentroCustoFlexivel(response.data.centro_custo_flexivel ?? false);
        setIfoodCentroCustoPadraoId(response.data.ifood_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setIfoodCentroCustoFlexivel(response.data.ifood_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvCentroCustoPadraoId(response.data.pdv_centro_custo_padrao_id ?? response.data.centro_custo_padrao_id ?? '');
        setPdvCentroCustoFlexivel(response.data.pdv_centro_custo_flexivel ?? response.data.centro_custo_flexivel ?? false);
        setPdvContaPadraoId(response.data.pdv_conta_padrao_id ?? '');
        setIfoodContaPadraoId(response.data.ifood_conta_padrao_id ?? '');
        setPdvSangriaSaidaPlanoContasId(response.data.pdv_sangria_saida_plano_contas_id ?? '');
        setPdvSangriaEntradaPlanoContasId(response.data.pdv_sangria_entrada_plano_contas_id ?? '');
        setPdvConfigCategorias(response.data.categorias || {});
        showToastMessage('Configurações de Movimentação PDV atualizadas!', 'success');
      }
      setShowPdvSettingsModal(false);
    } catch (err: any) {
      showToastMessage('Erro ao atualizar configurações do PDV.', 'error');
    }
  };

  const handleToggleApp = async (appKey: string, enable: boolean) => {
    try {
      const nextActiveApps = enable
        ? [...activeApps.filter(a => a !== appKey), appKey]
        : activeApps.filter(a => a !== appKey);

      const response = await api.put('/pdv/config', {
        marcar_como_pago: pdvConfigMarcadoPago,
        active_apps: nextActiveApps,
        ifood_comissao_taxa: ifoodTaxa,
        ifood_merchant_name: ifoodMerchantName,
        pdv_sangria_saida_plano_contas_id: pdvSangriaSaidaPlanoContasId === '' ? null : pdvSangriaSaidaPlanoContasId,
        pdv_sangria_entrada_plano_contas_id: pdvSangriaEntradaPlanoContasId === '' ? null : pdvSangriaEntradaPlanoContasId,
        formas_pagamento: formasPagamento,
        categorias: pdvConfigCategorias,
        contas: pdvConfigContas
      });

      if (response.data) {
        setActiveApps(response.data.active_apps || []);
        showToastMessage(
          enable ? `Aplicativo ativado com sucesso!` : `Aplicativo desativado.`,
          'success'
        );
        window.dispatchEvent(new Event('active-apps-changed'));
      }
    } catch (err) {
      showToastMessage('Erro ao alternar status do aplicativo.', 'error');
    }
  };

  const handleDeleteTransaction = async () => {
    if (!txToDelete) return;
    try {
      await api.delete(`/pdv/ifood/transacoes/${txToDelete.id}`);
      showToastMessage('Transação iFood excluída com sucesso!', 'success');
      await fetchTransactions();
      setTxToDelete(null);
      setShowDeleteModal(false);
    } catch (err: any) {
      showToastMessage(err?.response?.data?.detail || 'Erro ao excluir transação.', 'error');
    }
  };

  const handleConsolidateDay = async () => {
    if (!selectedDate || !selectedContaId) {
      showToastMessage('Selecione uma conta de destino.', 'error');
      return;
    }
    try {
      const response = await api.post('/pdv/ifood/consolidar', {
        data_venda: selectedDate,
        conta_id: Number(selectedContaId)
      });
      if (response.data) {
        showToastMessage(`Dia consolidado com sucesso no Caixa Geral!`, 'success');
        await fetchTransactions();
        setShowConsolidateModal(false);
      }
    } catch (err: any) {
      showToastMessage(err?.response?.data?.detail || 'Erro ao consolidar vendas do dia.', 'error');
    }
  };

  return (
    <div className="p-6 space-y-6">
      
      {/* View 1: Marketplace Panel */}
      {activeApp === 'marketplace' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-6 h-6 text-slate-700 dark:text-slate-300" />
              <span>Aplicativos e Integrações</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              Ative, desative e gerencie canais de vendas, faturamento e ferramentas adicionais integradas ao seu retaguarda comercial.
            </p>
          </div>

          <div className="flex flex-col border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-none shadow-none">
            
            {/* Card: PDV & Estoque */}
            {(() => {
              const isActivated = activeApps.includes('pdv_estoque');
              return (
                <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded-none">
                      <Store className="w-5.5 h-5.5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">PDV & Estoque</h3>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded-none ${
                          isActivated 
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-450 border-emerald-250 dark:border-emerald-900/50' 
                            : 'bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-450 border-slate-200 dark:border-slate-800'
                        }`}>
                          {isActivated ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-450 text-xs max-w-2xl leading-relaxed">
                        Frente de Caixa (PDV), Fechamento de Caixa e Gestão de Produtos/Estoque unificados em um único ambiente de retaguarda.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end">
                    {isActivated && (
                      <button
                        type="button"
                        onClick={() => navigate('/pdv')}
                        className="px-3.5 py-1.5 bg-slate-900 text-white hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700 text-xs font-bold transition rounded-none cursor-pointer"
                      >
                        Acessar PDV
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                      <button
                        type="button"
                        onClick={() => handleToggleApp('pdv_estoque', !isActivated)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-none border border-transparent transition-colors duration-200 ease-in-out outline-none ${
                          isActivated ? 'bg-emerald-600' : 'bg-slate-350 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            isActivated ? 'translate-x-[18px]' : 'translate-x-0.5'
                          } mt-0.5`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Card: Movimentação PDV (Umarizal) */}
            {(() => {
              const isActivated = activeApps.includes('movimentacao_pdv');
              return (
                <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded-none">
                      <Calculator className="w-5.5 h-5.5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Movimentação PDV</h3>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded-none ${
                          isActivated 
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-450 border-emerald-250 dark:border-emerald-900/50' 
                            : 'bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-455 border-slate-200 dark:border-slate-800'
                        }`}>
                          {isActivated ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-455 text-xs max-w-2xl leading-relaxed">
                        Fluxo simplificado de lançamento de movimentações diárias de vendas e retiradas. Ideal para registro de caixa e agenda de recebíveis na filial Umarizal.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end">
                    {isActivated && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSettingsPdvCentroCustoPadraoId(pdvCentroCustoPadraoId);
                            setSettingsPdvCentroCustoFlexivel(pdvCentroCustoFlexivel);
                            setSettingsPdvContaPadraoId(pdvContaPadraoId);
                            setSettingsPdvSangriaSaidaPlanoContasId(pdvSangriaSaidaPlanoContasId);
                            setSettingsPdvSangriaEntradaPlanoContasId(pdvSangriaEntradaPlanoContasId);
                            setSettingsPdvCategorias({ ...pdvConfigCategorias });
                            setShowPdvSettingsModal(true);
                          }}
                          className="p-1.5 bg-white hover:bg-slate-55 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700 text-slate-650 dark:text-slate-350 transition rounded-none cursor-pointer"
                          title="Configurar Movimentações"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/apps/movimentacao-pdv')}
                          className="px-3.5 py-1.5 bg-slate-900 text-white hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700 text-xs font-bold transition rounded-none cursor-pointer"
                        >
                          Acessar Movimentações
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                      <button
                        type="button"
                        onClick={() => handleToggleApp('movimentacao_pdv', !isActivated)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-none border border-transparent transition-colors duration-200 ease-in-out outline-none ${
                          isActivated ? 'bg-emerald-600' : 'bg-slate-350 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            isActivated ? 'translate-x-[18px]' : 'translate-x-0.5'
                          } mt-0.5`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Card: iFood Delivery */}
            {(() => {
              const isActivated = activeApps.includes('ifood');
              return (
                <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded-none">
                      <Utensils className="w-5.5 h-5.5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">iFood Delivery</h3>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded-none ${
                          isActivated 
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-450 border-emerald-250 dark:border-emerald-900/50' 
                            : 'bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-455 border-slate-200 dark:border-slate-800'
                        }`}>
                          {isActivated ? 'Ativo' : 'Inativo'}
                        </span>
                        {ifoodMerchantName && isActivated && (
                          <span className="text-[9px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 px-2 py-0.5 font-mono">
                            {ifoodMerchantName}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-500 dark:text-slate-455 text-xs max-w-2xl leading-relaxed">
                        Acompanhe e concilie suas vendas de delivery, taxas de comissão retida e datas estimadas de repasse direto na agenda de recebíveis.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end">
                    {isActivated && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSettingsActiveToggle(true);
                            setSettingsTaxa(String(ifoodTaxa));
                            setSettingsMerchantName(ifoodMerchantName);
                            setSettingsIfoodCentroCustoPadraoId(ifoodCentroCustoPadraoId);
                            setSettingsIfoodCentroCustoFlexivel(ifoodCentroCustoFlexivel);
                            setSettingsIfoodContaPadraoId(ifoodContaPadraoId);
                            setShowSettingsModal(true);
                          }}
                          className="p-1.5 bg-white hover:bg-slate-55 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700 text-slate-650 dark:text-slate-350 transition rounded-none cursor-pointer"
                          title="Configurar Integração"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/apps/ifood')}
                          className="px-3.5 py-1.5 bg-slate-900 text-white hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-250 dark:border-slate-700 text-xs font-bold transition rounded-none cursor-pointer"
                        >
                          Conciliar iFood
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                      <button
                        type="button"
                        onClick={() => handleToggleApp('ifood', !isActivated)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-none border border-transparent transition-colors duration-200 ease-in-out outline-none ${
                          isActivated ? 'bg-emerald-600' : 'bg-slate-350 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            isActivated ? 'translate-x-[18px]' : 'translate-x-0.5'
                          } mt-0.5`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Card: Asaas Gateway (INACTIVE) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 opacity-50 bg-slate-50/20 dark:bg-slate-950/5">
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-slate-100 dark:bg-slate-850 text-slate-400 border border-slate-200 dark:border-slate-800 rounded-none">
                  <CreditCard className="w-5.5 h-5.5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">Asaas Gateway</h3>
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-800 text-slate-400 rounded-none">
                      Em Breve
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-500 text-xs max-w-2xl leading-relaxed">
                    Sincronização automática de contas a receber, faturamento via Pix/boleto e conciliação bancária de forma nativa e integrada.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                <button
                  type="button"
                  disabled
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed rounded-none border border-transparent bg-slate-200 dark:bg-slate-800 outline-none"
                >
                  <span className="pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 translate-x-0.5 mt-0.5" />
                </button>
              </div>
            </div>

            {/* Card: CRM de Vendas (INACTIVE) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 opacity-50 bg-slate-50/20 dark:bg-slate-950/5">
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-slate-100 dark:bg-slate-850 text-slate-400 border border-slate-200 dark:border-slate-800 rounded-none">
                  <Users className="w-5.5 h-5.5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">CRM de Vendas</h3>
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-800 text-slate-400 rounded-none">
                      Em Breve
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-500 text-xs max-w-2xl leading-relaxed">
                    Gestão de leads, funil de atendimento comercial integrado a contatos e histórico financeiro completo de clientes.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                <button
                  type="button"
                  disabled
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed rounded-none border border-transparent bg-slate-200 dark:bg-slate-800 outline-none"
                >
                  <span className="pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 translate-x-0.5 mt-0.5" />
                </button>
              </div>
            </div>

            {/* Card: Campanhas SMS (INACTIVE) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between p-5 gap-4 opacity-50 bg-slate-50/20 dark:bg-slate-950/5">
              <div className="flex items-start gap-4">
                <div className="p-2.5 bg-slate-100 dark:bg-slate-850 text-slate-400 border border-slate-200 dark:border-slate-800 rounded-none">
                  <Megaphone className="w-5.5 h-5.5" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400">Campanhas SMS</h3>
                    <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-800 text-slate-400 rounded-none">
                      Em Breve
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-500 text-xs max-w-2xl leading-relaxed">
                    Disparos e envios em massa baseados no histórico de compras para ofertas exclusivas e retenção de clientes.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Habilitar</span>
                <button
                  type="button"
                  disabled
                  className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed rounded-none border border-transparent bg-slate-200 dark:bg-slate-800 outline-none"
                >
                  <span className="pointer-events-none inline-block h-4 w-4 transform rounded-none bg-white shadow-sm ring-0 translate-x-0.5 mt-0.5" />
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* View 2: iFood Conciliation Board */}
      {activeApp === 'ifood' && (
        !activeApps.includes('ifood') ? (
          /* Deactivated Fallback Screen */
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <button 
                onClick={() => navigate('/apps')}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 bg-white dark:bg-slate-950 dark:hover:bg-slate-900 transition text-slate-600 dark:text-slate-350 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h1 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Store className="w-5.5 h-5.5 text-rose-500" />
                  <span>iFood Delivery</span>
                </h1>
                <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                  Esta integração comercial não está ativa no momento.
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center max-w-xl mx-auto shadow-sm space-y-6 mt-12 flex flex-col items-center">
              <div className="w-20 h-20 bg-rose-50 dark:bg-rose-950/30 rounded-2xl flex items-center justify-center text-rose-500 border border-rose-100 dark:border-rose-900/50">
                <Lock className="w-10 h-10" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Integração do iFood Inativa</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
                  Para utilizar a conciliação diária de faturamento do iFood, ratear taxas de comissão e habilitar a consolidação com o contas a receber e caixa geral, ative a integração em suas configurações.
                </p>
              </div>
              <button
                onClick={() => {
                  setSettingsActiveToggle(true);
                  setSettingsTaxa(String(ifoodTaxa));
                  setSettingsMerchantName(ifoodMerchantName);
                  setSettingsIfoodCentroCustoPadraoId(ifoodCentroCustoPadraoId);
                  setSettingsIfoodCentroCustoFlexivel(ifoodCentroCustoFlexivel);
                  setSettingsIfoodContaPadraoId(ifoodContaPadraoId);
                  setShowSettingsModal(true);
                }}
                className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-md transition duration-200 hover:-translate-y-0.5 border-none cursor-pointer"
              >
                Ativar e Configurar Integração
              </button>
            </div>
          </div>
        ) : (
          /* Active Conciliator Board */
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => navigate('/apps')}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-55 bg-white dark:bg-slate-950 dark:hover:bg-slate-900 transition text-slate-600 dark:text-slate-350 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h1 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Store className="w-5.5 h-5.5 text-rose-500" />
                    <span>iFood Delivery: Conciliação Diária</span>
                  </h1>
                  {ifoodMerchantName && (
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded font-mono font-bold block w-fit mt-0.5">
                      {ifoodMerchantName}
                    </span>
                  )}
                  <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                    Painel de conferência física, provisão de recebíveis e rateio de taxas retidas.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSettingsActiveToggle(true);
                    setSettingsTaxa(String(ifoodTaxa));
                    setSettingsMerchantName(ifoodMerchantName);
                    setSettingsIfoodCentroCustoPadraoId(ifoodCentroCustoPadraoId);
                    setSettingsIfoodCentroCustoFlexivel(ifoodCentroCustoFlexivel);
                    setSettingsIfoodContaPadraoId(ifoodContaPadraoId);
                    setShowSettingsModal(true);
                  }}
                  className="flex items-center gap-2 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-800 transition duration-200 cursor-pointer"
                  title="Configurações da Integração"
                >
                  <Settings className="w-4 h-4" />
                  <span>Configurar</span>
                </button>

                <button
                  onClick={() => {
                    setEditingTransaction(null);
                    setFormFormaRecebimento('Pix Ifood');
                    setFormValorBruto('R$ 0,00');
                    setFormDespesasExtras([]);
                    setFormHoraVenda(new Date().toLocaleTimeString('pt-BR', { hour12: false }));
                    if (selectedDate) {
                      setFormDataVenda(selectedDate);
                    }
                    setShowDateConfig(false);
                    setShowDrawer(true);
                  }}
                  className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition duration-200 shadow-sm cursor-pointer border-none shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar Lançamento iFood</span>
                </button>
              </div>
            </div>

            {/* Split Screen Container */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Sidebar: Dates list */}
              <div className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    placeholder="Pesquisar data..."
                    value={dateSearch}
                    onChange={(e) => setDateSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded-xl text-slate-700 dark:text-slate-250 placeholder-slate-400 focus:border-rose-500 outline-none"
                  />
                </div>

                <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {loading ? (
                    <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                      <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
                      Carregando datas...
                    </div>
                  ) : filteredDailyConsolidated.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      Nenhuma data encontrada.
                    </div>
                  ) : (
                    filteredDailyConsolidated.map((d) => {
                      const isSelected = selectedDate === d.date;
                      const dateObj = new Date(d.date + 'T00:00:00');
                      
                      // Check if all transactions are reconciled for this day
                      const dayTxs = transactions.filter(tx => tx.data_venda === d.date);
                      const isReconciled = dayTxs.length > 0 && dayTxs.every(tx => tx.status_conciliado);

                      return (
                        <button
                          key={d.date}
                          onClick={() => setSelectedDate(d.date)}
                          className={`w-full flex items-center justify-between p-3 border text-left transition cursor-pointer border-l-4 ${
                            isSelected 
                              ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-350 border-l-rose-600 text-rose-700 dark:text-rose-400 font-semibold' 
                              : 'bg-white dark:bg-slate-950 border-slate-150 dark:border-slate-850 hover:bg-slate-55 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <div>
                            <span className="flex items-center gap-1.5 text-xs font-bold">
                              {dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                              {isReconciled && (
                                <span title="Fechamento integrado no financeiro">
                                  <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                                </span>
                              )}
                            </span>
                            <span className="block text-[10px] text-slate-450 mt-0.5">
                              {d.count} {d.count === 1 ? 'lançamento' : 'lançamentos'}
                            </span>
                          </div>
                          <span className={`text-xs font-black ${isSelected ? 'text-rose-600 dark:text-rose-450' : 'text-slate-900 dark:text-slate-100'}`}>
                            {formatCurrency(d.total)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Panel: Daily Transactions and Summary */}
              <div className="lg:col-span-9 space-y-6">
                
                {/* Daily Consolidated Cards */}
                {selectedDate && (
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                    
                    {/* Gross Total Card */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                      <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center text-indigo-500 border border-indigo-100 dark:border-indigo-900/40">
                        <DollarSign className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Faturamento Bruto</span>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{formatCurrency(selectedDateMetrics.bruto)}</h3>
                      </div>
                    </div>

                    {/* Retained Fees Card */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                      <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/40 rounded-xl flex items-center justify-center text-rose-550 border border-rose-100 dark:border-rose-900/40">
                        <Percent className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Taxa Retida Est. ({ifoodTaxa}%)</span>
                        <h3 className="text-lg font-black text-rose-600 dark:text-rose-450 mt-0.5">{formatCurrency(selectedDateMetrics.taxa)}</h3>
                      </div>
                    </div>

                    {/* Net Payout Card */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                      <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-500 border border-emerald-100 dark:border-emerald-900/40">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Valor Líquido Previsto</span>
                        <h3 className="text-lg font-black text-emerald-600 dark:text-emerald-450 mt-0.5">{formatCurrency(selectedDateMetrics.liquido)}</h3>
                      </div>
                    </div>

                  </div>
                )}

                {/* Transactions List */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                  <div className="px-6 py-4.5 border-b border-slate-150 dark:border-slate-800 flex items-center justify-between bg-slate-50/40 dark:bg-slate-900/40">
                    <div className="flex items-center flex-wrap gap-2">
                      <h3 className="text-sm font-black text-slate-800 dark:text-white">
                        Histórico de Pedidos iFood - {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR') : '--/--/----'}
                      </h3>
                      
                      {/* Financial Consolidation Trigger Button */}
                      {selectedDate && selectedDateTransactions.length > 0 && (
                        selectedDateTransactions.every(tx => tx.status_conciliado) ? (
                          <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-black border border-emerald-200/50">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                            Consolidado no Financeiro
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedContaId('');
                              setShowConsolidateModal(true);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition duration-200 shadow-sm border-none cursor-pointer ml-2"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Consolidar Dia no Financeiro</span>
                          </button>
                        )
                      )}
                    </div>
                    <span className="text-xs text-slate-450 font-bold shrink-0">
                      {selectedDateTransactions.length} {selectedDateTransactions.length === 1 ? 'lançamento' : 'lançamentos'}
                    </span>
                  </div>

                  {loading ? (
                    <div className="py-16 text-center text-slate-450 text-xs flex flex-col items-center gap-2">
                      <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Carregando detalhes do dia...</span>
                    </div>
                  ) : selectedDateTransactions.length === 0 ? (
                    <div className="py-16 text-center text-slate-450 text-xs">
                      Nenhum lançamento registrado nesta data. Clique no botão de adicionar para cadastrar transações.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-150 dark:divide-slate-800">
                      
                      {groupedTransactions.map((group) => (
                        <div key={group.name} className="p-0">
                          
                          {/* Group Header */}
                          <div className="px-6 py-3.5 bg-slate-50/20 dark:bg-slate-950/20 flex items-center justify-between text-xs font-black text-slate-800 dark:text-slate-300 border-b border-slate-150 dark:border-slate-800/80">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-rose-450 inline-block"></span>
                              <span>{group.name}</span>
                            </div>
                            <span>Total Bruto: {formatCurrency(group.total)}</span>
                          </div>

                          {/* Group List Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-850 text-slate-400 bg-slate-50/10 dark:bg-slate-950/10 font-bold uppercase tracking-wider text-[10px]">
                                  <th className="px-6 py-2.5">Hora</th>
                                  <th className="px-4 py-2.5 text-right">Valor Bruto</th>
                                  <th className="px-4 py-2.5 text-right">Valor Líquido</th>
                                  <th className="px-4 py-2.5">Previsão Repasse</th>
                                  <th className="px-4 py-2.5">Despesas Extras</th>
                                  <th className="px-4 py-2.5 text-center">Conciliado</th>
                                  <th className="px-6 py-2.5 text-center">Ações</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                                {group.list.map((tx) => (
                                  <tr key={tx.id} className="hover:bg-slate-55/35 dark:hover:bg-slate-950/10 transition">
                                    <td className="px-6 py-3.5 font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                      <span>{tx.hora_venda.slice(0, 5)}</span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-bold text-slate-900 dark:text-white font-mono">
                                      {formatCurrency(tx.valor_bruto)}
                                    </td>
                                    <td className="px-4 py-3.5 text-right font-black text-emerald-600 dark:text-emerald-450 font-mono">
                                      {formatCurrency(tx.valor_liquido)}
                                    </td>
                                    <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400">
                                      {new Date(tx.data_recebimento_ajustada + 'T00:00:00').toLocaleDateString('pt-BR')}
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="flex flex-wrap gap-1">
                                        {tx.despesas_extras && tx.despesas_extras.length > 0 ? (
                                          tx.despesas_extras.map((tag) => (
                                            <span 
                                              key={tag} 
                                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-450 border border-rose-100/35"
                                            >
                                              {tag.replace('_', ' ')}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-slate-350 dark:text-slate-600 font-mono">-</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                      <div className="flex items-center justify-center">
                                        {tx.status_conciliado ? (
                                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-black border border-emerald-250/20" title="Consolidado no financeiro">
                                            Sim
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded-full bg-slate-50 dark:bg-slate-950/20 text-slate-400 dark:text-slate-600 flex items-center justify-center text-[10px] font-black" title="Apenas provisionado">
                                            Não
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-6 py-3.5 text-center">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (tx.status_conciliado) {
                                              const confirmEdit = window.confirm("Atenção: Esta transação já foi consolidada no financeiro. Deseja prosseguir com a edição? (Nota: os lançamentos de repasse já gerados no financeiro não serão alterados automaticamente)");
                                              if (!confirmEdit) return;
                                            }
                                            openEditTransaction(tx);
                                          }}
                                          className="p-1.5 rounded bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800 text-slate-550 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition disabled:opacity-30 cursor-pointer border-none"
                                          title="Editar Lançamento"
                                        >
                                          <Edit className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (tx.status_conciliado) {
                                              const confirmDelete = window.confirm("Atenção: Esta transação já foi consolidada no financeiro. Deseja prosseguir com a exclusão? (Nota: os lançamentos de repasse já gerados no financeiro não serão alterados automaticamente)");
                                              if (!confirmDelete) return;
                                            }
                                            setTxToDelete(tx);
                                            setShowDeleteModal(true);
                                          }}
                                          className="p-1.5 rounded bg-rose-50/50 hover:bg-rose-50 dark:bg-rose-950/10 dark:hover:bg-rose-950/30 text-rose-550 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-350 transition disabled:opacity-30 cursor-pointer border-none"
                                          title="Excluir Lançamento"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                        </div>
                      ))}
                      
                    </div>
                  )}
                </div>

              </div>

            </div>

          </div>
        )
      )}

      {/* Drawer Form: Manual Entry */}
      {showDrawer && (
        <>
          {/* Backdrop Overlay */}
          <div 
            onClick={() => setShowDrawer(false)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[90] animate-in fade-in"
          />

          {/* Form Drawer */}
          <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl z-[100] transform transition-transform duration-300 ease-out translate-x-0 border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right">
            
            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/20 dark:bg-slate-950/10">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Store className="w-5 h-5 text-rose-500" />
                  <span>{editingTransaction ? 'Editar Lançamento iFood' : 'Novo Lançamento iFood'}</span>
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-[10px] mt-0.5">
                  {editingTransaction ? 'Altere os valores da transação do delivery selecionada.' : 'Preencha os valores consolidados da transação do delivery.'}
                </p>
              </div>
              
              <button 
                onClick={() => setShowDrawer(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-650 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Payment Method / Forma de recebimento */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Forma de Recebimento *</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    'Crédito à vista', 'Crédito Ifood', 'Débito', 
                    'Débito Ifood', 'Pix QRS', 'Pix Chave', 
                    'Pix Ifood', 'Dinheiro', 'Carteira digital'
                  ].map((mode) => {
                    const isSelected = formFormaRecebimento === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setFormFormaRecebimento(mode)}
                        className={`px-3 py-2.5 rounded-xl border text-[11px] font-bold text-center transition cursor-pointer leading-tight ${
                          isSelected
                            ? 'bg-rose-50 border-rose-450 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400'
                            : 'bg-white border-slate-200 hover:border-slate-350 hover:bg-slate-50 dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gross Value Input with modificators */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Valor Bruto do Pedido (R$) *</label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">R$</span>
                    <input
                      type="text"
                      value={formValorBruto.replace('R$', '').trim()}
                      onChange={(e) => handleCurrencyChange(e.target.value)}
                      placeholder="0,00"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 bg-white font-mono font-bold text-base text-slate-800 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      required
                    />
                  </div>
                  
                  {/* Modificators */}
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => adjustFormValue(-10)}
                      className="w-11 h-11 border border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-750 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-350 rounded-xl flex items-center justify-center font-black text-sm cursor-pointer select-none"
                    >
                      -10
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustFormValue(10)}
                      className="w-11 h-11 border border-slate-300 bg-slate-50 hover:bg-slate-100 dark:border-slate-750 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-350 rounded-xl flex items-center justify-center font-black text-sm cursor-pointer select-none"
                    >
                      +10
                    </button>
                  </div>
                </div>

                {/* Simulated Net Value Summary */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between text-xs mt-2">
                  <div className="space-y-0.5">
                    <span className="text-slate-450 font-semibold block">Valor Líquido Previsto (Menos Taxa {ifoodTaxa}%)</span>
                    <span className="text-[10px] text-rose-500 block">Comissão Estimada: {formatCurrency(parseCurrency(formValorBruto) * (ifoodTaxa / 100))}</span>
                  </div>
                  <span className="font-black text-sm text-emerald-650 dark:text-emerald-450">
                    {formatCurrency(parseCurrency(formValorBruto) * (1 - ifoodTaxa / 100))}
                  </span>
                </div>
              </div>

              {/* Extra Expenses checkboxes */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Despesas / Subsídios Extras</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'cupom_descontos', label: 'Cupom de descontos' },
                    { key: 'patrocinado', label: 'Patrocinado' },
                    { key: 'entrega_gratis', label: 'Entrega grátis' },
                    { key: 'motoboy_ifood', label: 'Motoboy iFood' }
                  ].map((exp) => {
                    const isSelected = formDespesasExtras.includes(exp.key);
                    return (
                      <button
                        key={exp.key}
                        type="button"
                        onClick={() => toggleExtraExpense(exp.key)}
                        className={`flex items-center justify-between px-3.5 py-3 rounded-xl border text-xs font-bold text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-rose-50/50 border-rose-350 text-rose-600 dark:bg-rose-950/20 dark:text-rose-450'
                            : 'bg-white border-slate-200 hover:border-slate-350 dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 text-slate-650 dark:text-slate-350'
                        }`}
                      >
                        <span>{exp.label}</span>
                        {isSelected ? (
                          <Check className="w-4 h-4 text-rose-550 shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-800 shrink-0"></div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Collapsible advanced date configurations */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowDateConfig(!showDateConfig)}
                  className="text-xs font-bold text-slate-500 hover:text-rose-500 transition flex items-center gap-1 cursor-pointer border-none bg-transparent"
                >
                  <span>{showDateConfig ? 'Ocultar configurações de data' : 'Ajustar data/hora manualmente...'}</span>
                </button>

                {showDateConfig && (
                  <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Data Venda */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data da Venda *</label>
                      <input
                        type="date"
                        value={formDataVenda}
                        onChange={(e) => setFormDataVenda(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                        required
                      />
                    </div>

                    {/* Hora Venda */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hora da Venda</label>
                      <input
                        type="text"
                        placeholder="00:00:00"
                        value={formHoraVenda}
                        onChange={(e) => setFormHoraVenda(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition focus:border-rose-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                      />
                    </div>

                    {/* Data Recebimento Ajustada */}
                    <div className="col-span-2 space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Estimada de Recebimento (Ajustada) *</label>
                      <input
                        type="date"
                        value={formDataRecebimento}
                        readOnly
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 font-mono font-bold cursor-not-allowed"
                        required
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Calculado automaticamente baseando-se nas regras de payout do iFood (+7 dias rolando para a quarta-feira seguinte).
                      </span>
                    </div>
                  </div>
                )}

              </div>

            </form>

            {/* Footer buttons */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/20 dark:bg-slate-950/10">
              <button
                type="button"
                onClick={() => setShowDrawer(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                onClick={handleFormSubmit}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 transition disabled:opacity-50 cursor-pointer border-none shadow-sm flex items-center gap-1.5"
              >
                {submitting ? 'Salvando...' : editingTransaction ? 'Salvar Alterações' : 'Confirmar e Salvar'}
              </button>
            </div>

          </div>
        </>
      )}

      {/* Settings / Configuration Modal */}
      {showSettingsModal && (
        <>
          <div onClick={() => setShowSettingsModal(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] animate-in fade-in" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 z-[210] animate-in zoom-in-95 duration-200 space-y-6">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/40 rounded-xl flex items-center justify-center text-rose-500 border border-rose-100 dark:border-rose-900/40">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Parâmetros iFood</h3>
                  <p className="text-slate-450 text-[10px] uppercase font-bold tracking-wider">Integração Comercial</p>
                </div>
              </div>
              <button onClick={() => setShowSettingsModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 cursor-pointer border-none bg-transparent">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Active/Inactive toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-350 block">Status da Integração</span>
                  <span className="text-[10px] text-slate-450 block">Ative ou inative o portal na sidebar</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsActiveToggle(!settingsActiveToggle)}
                  className={`w-14 h-7.5 rounded-full p-1 transition duration-200 cursor-pointer relative border-none ${
                    settingsActiveToggle ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span className={`w-5.5 h-5.5 rounded-full bg-white block shadow transition-transform ${
                    settingsActiveToggle ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Merchant name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Nome da Loja / Estabelecimento</label>
                <input
                  type="text"
                  value={settingsMerchantName}
                  onChange={(e) => setSettingsMerchantName(e.target.value)}
                  placeholder="Ex: Pizzaria Bella Italia"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500"
                />
              </div>

              {/* Custom commission rate */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Taxa de Comissão (%)</label>
                <div className="relative">
                  <input
                    type="text"
                    value={settingsTaxa}
                    onChange={(e) => setSettingsTaxa(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="12.0"
                    className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none font-mono font-bold transition focus:border-rose-500"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                </div>
              </div>

              {/* Centro de Custo Padrão */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Centro de Custo Padrão</label>
                <select
                  value={settingsIfoodCentroCustoPadraoId}
                  onChange={(e) => setSettingsIfoodCentroCustoPadraoId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500"
                >
                  <option value="">Sem centro de custo padrão</option>
                  {centrosCusto.map((cc) => (
                    <option key={cc.id} value={cc.id}>{cc.nome}</option>
                  ))}
                </select>
              </div>

              {/* Centro de Custo Flexível toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-350 block">Centro de Custo Flexível</span>
                  <span className="text-[10px] text-slate-450 block">Permite selecionar outras opções nos formulários</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsIfoodCentroCustoFlexivel(!settingsIfoodCentroCustoFlexivel)}
                  className={`w-14 h-7.5 rounded-full p-1 transition duration-200 cursor-pointer relative border-none ${
                    settingsIfoodCentroCustoFlexivel ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span className={`w-5.5 h-5.5 rounded-full bg-white block shadow transition-transform ${
                    settingsIfoodCentroCustoFlexivel ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Conta / Caixa de Registro Padrão */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Conta / Caixa de Registro Padrão</label>
                <select
                  value={settingsIfoodContaPadraoId}
                  onChange={(e) => setSettingsIfoodContaPadraoId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                >
                  <option value="">Sem conta padrão</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-450 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none bg-transparent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const rate = parseFloat(settingsTaxa) || 12.0;
                  void handleSaveConfig(
                    settingsActiveToggle, 
                    rate, 
                    settingsMerchantName, 
                    settingsIfoodCentroCustoPadraoId, 
                    settingsIfoodCentroCustoFlexivel,
                    settingsIfoodContaPadraoId
                  );
                }}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 transition shadow-sm border-none cursor-pointer"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </>
      )}

      {/* PDV Settings / Configuration Modal */}
      {showPdvSettingsModal && (
        <>
          <div onClick={() => setShowPdvSettingsModal(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] animate-in fade-in" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 z-[210] animate-in zoom-in-95 duration-200 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-500 border border-emerald-100 dark:border-emerald-900/40">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Parâmetros Movimentação PDV</h3>
                  <p className="text-slate-450 text-[10px] uppercase font-bold tracking-wider">Frente de Caixa</p>
                </div>
              </div>
              <button onClick={() => setShowPdvSettingsModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-650 cursor-pointer border-none bg-transparent">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Centro de Custo Padrão */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Centro de Custo Padrão</label>
                <select
                  value={settingsPdvCentroCustoPadraoId}
                  onChange={(e) => setSettingsPdvCentroCustoPadraoId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                >
                  <option value="">Sem centro de custo padrão</option>
                  {centrosCusto.map((cc) => (
                    <option key={cc.id} value={cc.id}>{cc.nome}</option>
                  ))}
                </select>
              </div>

              {/* Centro de Custo Flexível toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-955 border border-slate-150 dark:border-slate-850 rounded-2xl">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-350 block">Centro de Custo Flexível</span>
                  <span className="text-[10px] text-slate-450 block">Permite selecionar outras opções nos formulários</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsPdvCentroCustoFlexivel(!settingsPdvCentroCustoFlexivel)}
                  className={`w-14 h-7.5 rounded-full p-1 transition duration-200 cursor-pointer relative border-none ${
                    settingsPdvCentroCustoFlexivel ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span className={`w-5.5 h-5.5 rounded-full bg-white block shadow transition-transform ${
                    settingsPdvCentroCustoFlexivel ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Conta / Caixa de Registro Padrão */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Conta / Caixa de Registro Padrão</label>
                <select
                  value={settingsPdvContaPadraoId}
                  onChange={(e) => setSettingsPdvContaPadraoId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                >
                  <option value="">Sem conta padrão</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              {/* Categoria Padrão Saída (Sangria) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Categoria Padrão Saída (Sangria)</label>
                <select
                  value={settingsPdvSangriaSaidaPlanoContasId}
                  onChange={(e) => setSettingsPdvSangriaSaidaPlanoContasId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-955 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                >
                  <option value="">Sem categoria padrão de saída</option>
                  {planoContas.filter(pc => (pc.tipo === 'D' || pc.tipo === 'DESPESA') && !pc.eh_cabecalho && pc.permite_lancamentos).map((pc) => (
                    <option key={pc.id} value={pc.id}>{pc.codigo} - {pc.nome}</option>
                  ))}
                </select>
              </div>

              {/* Categoria Padrão Entrada (Banco Destino) */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Categoria Padrão Entrada (Banco Destino)</label>
                <select
                  value={settingsPdvSangriaEntradaPlanoContasId}
                  onChange={(e) => setSettingsPdvSangriaEntradaPlanoContasId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-955 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                >
                  <option value="">Sem categoria padrão de entrada</option>
                  {planoContas.filter(pc => (pc.tipo === 'R' || pc.tipo === 'RECEITA') && !pc.eh_cabecalho && pc.permite_lancamentos).map((pc) => (
                    <option key={pc.id} value={pc.id}>{pc.codigo} - {pc.nome}</option>
                  ))}
                </select>
              </div>

              {/* Categoria por Forma de Pagamento */}
              {formasPagamento.length > 0 && (
                <div className="border-t border-slate-150 dark:border-slate-800 pt-4 space-y-3">
                  <span className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Categorias por Forma de Pagamento</span>
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                    {formasPagamento.map((forma) => (
                      <div key={forma.key} className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{forma.label}</span>
                        <select
                          value={settingsPdvCategorias[forma.key] || ''}
                          onChange={(e) => setSettingsPdvCategorias({
                            ...settingsPdvCategorias,
                            [forma.key]: e.target.value
                          })}
                          className="w-1/2 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-955 text-xs text-slate-850 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                        >
                          <option value="">Automático</option>
                          {planoContas.filter(pc => (pc.tipo === 'R' || pc.tipo === 'RECEITA') && !pc.eh_cabecalho && pc.permite_lancamentos).map((pc) => (
                            <option key={pc.id} value={pc.id}>{pc.nome}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowPdvSettingsModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-655 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none bg-transparent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSavePdvConfig(
                    settingsPdvCentroCustoPadraoId, 
                    settingsPdvCentroCustoFlexivel,
                    settingsPdvContaPadraoId,
                    settingsPdvSangriaSaidaPlanoContasId,
                    settingsPdvSangriaEntradaPlanoContasId
                  );
                }}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-sm border-none cursor-pointer"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && txToDelete && (
        <>
          <div onClick={() => setShowDeleteModal(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] animate-in fade-in" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 z-[210] animate-in zoom-in-95 duration-205 text-center space-y-5">
            <div className="w-14 h-14 bg-rose-50 dark:bg-rose-950/40 rounded-2xl flex items-center justify-center text-rose-500 border border-rose-100 dark:border-rose-900/40 mx-auto">
              <ShieldAlert className="w-7 h-7 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-black text-slate-900 dark:text-white">Excluir Lançamento?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">
                Deseja mesmo excluir o lançamento de <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(txToDelete.valor_bruto)}</span>? Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-655 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none bg-transparent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteTransaction}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 transition shadow-sm border-none cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </>
      )}

      {/* Ledger Consolidation Modal */}
      {showConsolidateModal && (
        <>
          <div onClick={() => setShowConsolidateModal(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] animate-in fade-in" />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 z-[210] animate-in zoom-in-95 duration-200 space-y-6">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-500 border border-emerald-100 dark:border-emerald-900/40">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Consolidar Dia</h3>
                  <p className="text-slate-450 text-[10px] uppercase font-bold tracking-wider">Enviar para o Caixa Geral</p>
                </div>
              </div>
              <button onClick={() => setShowConsolidateModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-650 cursor-pointer border-none bg-transparent">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-4 border border-slate-150 dark:border-slate-850 rounded-2xl space-y-2">
              <div className="flex justify-between text-xs text-slate-550">
                <span>Data Selecionada:</span>
                <span className="font-bold text-slate-800 dark:text-white">
                  {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-550">
                <span>Pedidos:</span>
                <span className="font-bold text-slate-850 dark:text-white">{selectedDateTransactions.length}</span>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 my-1 pt-1 flex justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-white">Total Líquido Consolidado:</span>
                <span className="font-black text-emerald-600 dark:text-emerald-450">{formatCurrency(selectedDateMetrics.liquido)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-450 uppercase tracking-wider">Conta Bancária / Caixa Destino *</label>
              <select
                value={selectedContaId}
                onChange={(e) => setSelectedContaId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-750 bg-white dark:bg-slate-950 text-sm text-slate-800 dark:text-white outline-none transition focus:border-rose-500 font-bold"
                required
              >
                <option value="">Selecione uma conta...</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConsolidateModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-650 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none bg-transparent"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConsolidateDay}
                disabled={!selectedContaId}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-sm border-none cursor-pointer disabled:opacity-50"
              >
                Consolidar e Enviar
              </button>
            </div>
          </div>
        </>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[999] p-4 rounded-xl shadow-lg border flex items-center gap-3 transition animate-in slide-in-from-top duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-250 text-emerald-800 dark:text-emerald-300' 
            : toast.type === 'error'
            ? 'bg-rose-50 dark:bg-rose-950 border-rose-250 text-rose-800 dark:text-rose-350'
            : 'bg-indigo-50 dark:bg-indigo-950 border-indigo-250 text-indigo-800 dark:text-indigo-300'
        }`}>
          {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-500" />}
          {toast.type === 'info' && <AlertCircle className="w-5 h-5 text-indigo-550" />}
          <span className="text-sm font-bold">{toast.message}</span>
        </div>
      )}

    </div>
  );
}
