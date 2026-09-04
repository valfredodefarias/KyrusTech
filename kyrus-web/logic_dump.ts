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

