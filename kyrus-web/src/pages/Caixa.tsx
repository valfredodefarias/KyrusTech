import { useEffect, useState, useMemo, useRef } from 'react';
import { api, fetchLancamentosPaged, normalizeListResponse } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { useAuthStore } from '../store/authStore';
import {
  Banknote,
  Plus,
  RefreshCw,
  Printer,
  Calendar,
  AlertCircle,
  Info,
  Search,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  CreditCard,
  QrCode,
  FileText,
} from 'lucide-react';

import type { Lancamento, ToastItem } from './Lancamentos/types';
import {
  getTodayLocalYmd,
} from './Lancamentos/utils';

import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';

export function Caixa() {
  const formatNumberBRL = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const user = useAuthStore((state) => state.user);
  const currentEmpresaId = user?.empresa_id ?? null;
  const permissions = user?.permissions || [];
  const hasAccess = permissions.includes('*') || permissions.includes('page:caixa:view');

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center min-h-[60vh] text-slate-500">
        <AlertCircle className="h-12 w-12 text-rose-500 mb-4" />
        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Acesso Negado</h3>
        <p className="text-sm max-w-md">
          Você não tem permissão para visualizar o movimento de caixa físico. Entre em contato com o administrador para solicitar acesso.
        </p>
      </div>
    );
  }

  // --- FILTERS & STATE ---
  const [dataInicio, setDataInicio] = useState(getTodayLocalYmd());
  const [dataFim, setDataFim] = useState(getTodayLocalYmd());
  const [loading, setLoading] = useState(true);
  const [selectedContaId, setSelectedContaId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'fechamento' | 'extrato'>('fechamento');
  const [textFiltroExtrato, setTextFiltroExtrato] = useState('');

  const [contas, setContas] = useState<any[]>([]);
  const [cartoes, setCartoes] = useState<any[]>([]);
  const [centros, setCentros] = useState<any[]>([]);
  const [entidades, setEntidades] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [dailyLancamentos, setDailyLancamentos] = useState<Lancamento[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [empresa, setEmpresa] = useState<any>(null);

  // --- MODALS & DRAWERS ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [selectedEditarId, setSelectedEditarId] = useState<number | null>(null);

  const auxLoadedRef = useRef(false);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const invalidateEntidades = useLookupStore((state) => state.invalidateEntidades);
  const invalidateEntidadesLookup = useLookupStore((state) => state.invalidateEntidadesLookup);
  const invalidatePlanoContas = useLookupStore((state) => state.invalidatePlanoContas);

  // --- FILTER OUT PHYSICAL REGISTERS ---
  const caixasFisicos = useMemo(() => {
    return contas.filter(
      (c) => c.tipo === 'CAIXA' && String(c.status || 'ATIVO').toUpperCase() === 'ATIVO'
    );
  }, [contas]);

  const selectedConta = useMemo(() => {
    return caixasFisicos.find((c) => Number(c.id) === selectedContaId) || null;
  }, [caixasFisicos, selectedContaId]);

  // Fallback and Auto-select first cashier
  useEffect(() => {
    if (caixasFisicos.length > 0 && selectedContaId === null) {
      setSelectedContaId(Number(caixasFisicos[0].id));
    }
  }, [caixasFisicos, selectedContaId]);

  // --- NOTIFICATION HANDLER ---
  const pushToast = (type: ToastItem['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  // --- DATA LOADING ---
  async function loadAuxData() {
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
      pushToast('error', 'Erro ao carregar dados de suporte.');
    }
  }

  async function loadCaixaData() {
    if (!selectedContaId) return;
    setLoading(true);
    try {
      // Fetch daily transactions for selected cashier
      const rows = await fetchLancamentosPaged<Lancamento>(
        {
          conta_id: selectedContaId,
          data_inicio: dataInicio,
          data_fim: dataFim,
          somente_pagos: true,
        },
        { pageSize: 1500 }
      );
      setDailyLancamentos(rows);
    } catch (e) {
      console.error(e);
      pushToast('error', 'Erro ao carregar lançamentos do caixa.');
    } finally {
      setLoading(false);
    }
  }

  // Load company data for pdv_config
  useEffect(() => {
    async function loadCompany() {
      if (currentEmpresaId) {
        try {
          const { data: emp } = await api.get(`/empresas/${currentEmpresaId}`);
          setEmpresa(emp);
        } catch (error) {
          console.error('Erro ao buscar dados da empresa:', error);
        }
      }
    }
    void loadCompany();
  }, [currentEmpresaId]);

  // Reload cache when company changes
  useEffect(() => {
    auxLoadedRef.current = false;
    setContas([]);
    setDailyLancamentos([]);
    setSelectedContaId(null);
    invalidateEntidades();
    invalidateEntidadesLookup();
    invalidatePlanoContas();
    void loadAuxData();
  }, [currentEmpresaId]);

  // Reload caixa data when filters change
  useEffect(() => {
    if (selectedContaId) {
      void loadCaixaData();
    }
  }, [selectedContaId, dataInicio, dataFim]);

  // Sync bank balances
  const refreshSaldos = async () => {
    try {
      const rC = await api.get('/contas/', { params: { include_saldo: true } });
      setContas(normalizeListResponse<any>(rC.data));
    } catch (e) {
      console.error(e);
    }
  };

  // --- GROUPING & STATISTICS ---
  // Default forms of payment configuration
  const formasPagamentoConfig = useMemo(() => {
    let list = [
      { key: 'dinheiro', label: 'Dinheiro' },
      { key: 'pix_chave', label: 'Pix chave' },
      { key: 'pix_qr', label: 'Pix QRS' },
      { key: 'cartao_debito', label: 'Débito' },
      { key: 'cartao_credito_vista', label: 'Crédito à vista' },
      { key: 'cartao_credito_parcelado', label: 'Crédito parcelado' },
      { key: 'boleto', label: 'Boleto' },
    ];

    if (empresa && empresa.pdv_config) {
      try {
        const parsed = JSON.parse(empresa.pdv_config);
        if (parsed.formas_pagamento && Array.isArray(parsed.formas_pagamento)) {
          list = parsed.formas_pagamento.map((item: any) => ({
            key: item.key,
            label: item.label,
          }));
        }
      } catch (e) {
        console.error('Erro ao ler formas de pagamento do pdv_config', e);
      }
    }
    return list;
  }, [empresa]);

  // Helper to resolve payment method key
  const getPaymentMethod = (l: Lancamento) => {
    // 1. Prioritize category name mapping
    const catName = categorias.find((c) => String(c.id) === String(l.plano_contas_id))?.nome || '';
    const normalizedCat = catName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // removes accents
    
    if (normalizedCat.includes('debito')) return 'cartao_debito';
    if (normalizedCat.includes('credito') || normalizedCat.includes('cartao')) {
      if (normalizedCat.includes('parcelado')) return 'cartao_credito_parcelado';
      return 'cartao_credito_vista';
    }
    if (normalizedCat.includes('pix')) return 'pix_chave';
    if (normalizedCat.includes('cheque')) return 'cheque';
    if (normalizedCat.includes('boleto')) return 'boleto';
    if (normalizedCat.includes('dinheiro')) return 'dinheiro';

    // 2. If category doesn't specify, fall back to JSON parsed tipo_pagamento
    if (l.observacao) {
      try {
        const parsed = JSON.parse(l.observacao);
        if (parsed && parsed.tipo_pagamento) {
          return parsed.tipo_pagamento;
        }
      } catch {
        // Fallback
      }
    }

    if (l.cartao_id) return 'cartao_credito_vista';
    return 'dinheiro'; // Default to cash for registers
  };

  // Helper to map payment method to label
  const getPaymentMethodLabel = (methodKey: string) => {
    const config = formasPagamentoConfig.find((f) => f.key === methodKey);
    if (config) return config.label;
    switch (methodKey) {
      case 'dinheiro': return 'Dinheiro';
      case 'pix_chave': return 'Pix chave';
      case 'pix_qr': return 'Pix QRS';
      case 'cartao_debito': return 'Débito';
      case 'cartao_credito_vista': return 'Crédito à vista';
      case 'cartao_credito_parcelado': return 'Crédito parcelado';
      case 'boleto': return 'Boleto';
      case 'cheque': return 'Cheque';
      default: return methodKey;
    }
  };

  // Left panel: "MOVIMENTO CAIXA DO DIA" -> Sum of RECEITAS by payment method
  const totalReceitasPorForma = useMemo(() => {
    const groups: Record<string, number> = {};
    dailyLancamentos.forEach((l) => {
      if (l.tipo === 'RECEITA') {
        const method = getPaymentMethod(l);
        groups[method] = (groups[method] || 0) + Number(l.valor_pago || l.valor_previsto || 0);
      }
    });

    const list = Object.keys(groups).map((key) => ({
      key,
      label: getPaymentMethodLabel(key),
      value: groups[key],
    }));

    // Sort by value desc
    list.sort((a, b) => b.value - a.value);

    // Sum overall total of receipts
    const totalGeral = list.reduce((sum, item) => sum + item.value, 0);

    return { list, totalGeral };
  }, [dailyLancamentos, formasPagamentoConfig, categorias]);

  // Right panel: "MOVIMENTAÇÃO" -> List of all paid/realized movements
  const movimentacoes = useMemo(() => {
    const list = dailyLancamentos.map((l) => {
      const isReceita = l.tipo === 'RECEITA';
      const valor = Number(l.valor_pago || l.valor_previsto || 0);
      const saldo = isReceita ? valor : -valor;

      const catName = categorias.find((c) => String(c.id) === String(l.plano_contas_id))?.nome || 'Sem Categoria';
      const entName = entidades.find((e) => e.id === l.entidade_id)?.nome || 'CLIENTE/FORNECEDOR';

      return {
        id: l.id,
        classificacao: catName,
        cliente: entName,
        historico: l.descricao || 'Lançamento',
        saldo,
        raw: l,
      };
    });

    // Calculate sum of net movements
    const totalGeral = list.reduce((sum, item) => sum + item.saldo, 0);

    return { list, totalGeral };
  }, [dailyLancamentos, categorias, entidades]);

  // Group dailyLancamentos for Extrato View
  const groupedExtrato = useMemo(() => {
    const searchVal = textFiltroExtrato.trim().toLowerCase();
    const filtered = dailyLancamentos.filter((l) => {
      if (!searchVal) return true;
      const catName = categorias.find((c) => String(c.id) === String(l.plano_contas_id))?.nome || '';
      const entName = entidades.find((e) => e.id === l.entidade_id)?.nome || '';
      return (
        l.descricao.toLowerCase().includes(searchVal) ||
        catName.toLowerCase().includes(searchVal) ||
        entName.toLowerCase().includes(searchVal) ||
        String(l.valor_previsto).includes(searchVal) ||
        String(l.valor_pago).includes(searchVal)
      );
    });

    const groups: Record<string, Lancamento[]> = {};
    filtered.forEach((l) => {
      const dateKey = l.data_pagamento || l.data_vencimento;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(l);
    });

    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return { groups, sortedDates };
  }, [dailyLancamentos, textFiltroExtrato, categorias, entidades]);

  const dailyKpis = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    dailyLancamentos.forEach((l) => {
      const valor = Number(l.valor_pago || l.valor_previsto || 0);
      if (l.tipo === 'RECEITA') {
        entradas += valor;
      } else {
        saidas += valor;
      }
    });
    return {
      entradas,
      saidas,
      saldo: entradas - saidas,
    };
  }, [dailyLancamentos]);

  const getPaymentIcon = (methodKey: string) => {
    switch (methodKey) {
      case 'dinheiro':
        return <DollarSign className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case 'cartao_debito':
      case 'cartao_credito_vista':
      case 'cartao_credito_parcelado':
        return <CreditCard className="h-3.5 w-3.5 text-indigo-500 shrink-0" />;
      case 'pix_chave':
      case 'pix_qr':
        return <QrCode className="h-3.5 w-3.5 text-teal-500 shrink-0" />;
      case 'cheque':
        return <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
      default:
        return <Wallet className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
    }
  };

  // Launch drawer in new entry mode
  const handleOpenNewEntry = () => {
    if (!selectedContaId) {
      pushToast('info', 'Selecione um caixa físico antes de criar um lançamento.');
      return;
    }
    setSelectedEditarId(null);
    setShowDrawer(true);
  };

  // Launch drawer to edit a transaction
  const handleOpenEdit = (l: Lancamento) => {
    setSelectedEditarId(l.id);
    setShowDrawer(true);
  };

  return (
    <div className="min-h-screen text-slate-800 dark:text-slate-100">
      {/* Toast notifications */}
      <div className="fixed right-4 top-4 z-[9999] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-bold text-white shadow-xl animate-slide-in-right ${
              t.type === 'success' ? 'bg-emerald-600' : t.type === 'error' ? 'bg-rose-600' : 'bg-blue-600'
            }`}
          >
            {t.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
            {t.message}
          </div>
        ))}
      </div>

      {/* PAGE HEADER */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800/80 px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2 uppercase tracking-tight">
            <Banknote className="h-6 w-6 text-blue-500" />
            Movimento de Caixa
          </h1>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">
            Registro de Caixa: <span className="text-slate-600 dark:text-slate-200">{selectedConta?.nome || '—'}</span>
          </p>
        </div>
        
        {/* REFRESH & NEW ENTRY BUTTONS */}
        <div className="flex gap-2">
          {activeTab === 'fechamento' && selectedContaId !== null && !loading && (
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 shadow-sm transition"
            >
              <Printer className="h-4 w-4" />
              Imprimir Fechamento
            </button>
          )}
          <button
            onClick={() => {
              void loadCaixaData();
              void refreshSaldos();
            }}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-sm"
            title="Recarregar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleOpenNewEntry()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs font-bold text-white transition shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            + Lançamento
          </button>
        </div>
      </header>

      {/* MAIN CONTENT CONTAINER */}
      <div className="p-4 sm:p-6 md:p-8 space-y-6">
        {/* FILTER BAR & TABS SELECTOR */}
        <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-3">
            {/* DATE FILTER */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Calendar className="h-4 w-4 text-slate-400" />
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="bg-transparent font-bold outline-none"
              />
              <span className="text-slate-300 dark:text-slate-600 font-normal">até</span>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="bg-transparent font-bold outline-none"
              />
            </div>

            {/* CASHIER SELECTOR */}
            {caixasFisicos.length > 0 ? (
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Banknote className="h-4 w-4 text-slate-400" />
                <span className="text-slate-400 font-normal">Caixa:</span>
                <select
                  value={selectedContaId === null ? '' : String(selectedContaId)}
                  onChange={(e) => setSelectedContaId(Number(e.target.value))}
                  className="bg-transparent font-black text-slate-700 dark:text-white outline-none"
                >
                  {caixasFisicos.map((c) => (
                    <option key={c.id} value={c.id} className="text-slate-900">
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-xs italic text-rose-500 font-bold">Nenhum caixa físico ativo cadastrado.</span>
            )}
          </div>

          {/* TABS SELECTOR */}
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 w-fit print:hidden">
            <button
              onClick={() => setActiveTab('fechamento')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                activeTab === 'fechamento'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Resumo / Fechamento
            </button>
            <button
              onClick={() => setActiveTab('extrato')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                activeTab === 'extrato'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Extrato Completo
            </button>
          </div>
        </section>

        {selectedContaId === null ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
            <Banknote className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mt-4 text-lg font-black text-slate-800 dark:text-white">Nenhum Caixa Selecionado</h3>
            <p className="mt-2 text-sm text-slate-500">
              Cadastre uma conta com tipo "Caixa Físico" nas configurações financeiras para começar.
            </p>
          </div>
        ) : loading ? (
          <div className="p-12 text-center text-sm font-semibold text-slate-400">Carregando dados do caixa...</div>
        ) : (
          <div className="space-y-6">

          {activeTab === 'fechamento' ? (
            <div className="space-y-6 animate-in fade-in duration-300">

              {/* KPI CARDS */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* ENTRADAS */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Entradas</span>
                    <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                      R$ {formatNumberBRL(dailyKpis.entradas)}
                    </p>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl text-emerald-500">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                </div>

                {/* SAÍDAS */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Saídas</span>
                    <p className="text-xl font-extrabold text-rose-600 dark:text-rose-400 font-mono">
                      R$ {formatNumberBRL(dailyKpis.saidas)}
                    </p>
                  </div>
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl text-rose-500">
                    <TrendingDown className="h-5 w-5" />
                  </div>
                </div>

                {/* SALDO DO DIA */}
                <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Saldo do Dia</span>
                    <p className={`text-xl font-extrabold font-mono ${dailyKpis.saldo >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      R$ {formatNumberBRL(dailyKpis.saldo)}
                    </p>
                  </div>
                  <div className={`p-3 rounded-xl ${dailyKpis.saldo >= 0 ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-500' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-500'}`}>
                    <DollarSign className="h-5 w-5" />
                  </div>
                </div>
              </div>

              {/* DASHBOARD TABLES GRID */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* LEFT COLUMN: MOVIMENTO CAIXA DO DIA */}
                <div className="lg:col-span-4 flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 transition-all hover:shadow-md">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-blue-500" />
                    Movimento Caixa do Dia
                  </h3>

                  <div className="flex-1 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <th className="px-3 py-3 text-left">Forma Pagto</th>
                          <th className="px-3 py-3 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {totalReceitasPorForma.list.length === 0 ? (
                          <tr>
                            <td colSpan={2} className="px-3 py-6 text-center text-slate-400 italic font-semibold">
                              Nenhum recebimento registrado.
                            </td>
                          </tr>
                        ) : (
                          totalReceitasPorForma.list.map((item) => (
                            <tr key={item.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                              <td className="px-3 py-3 text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
                                {getPaymentIcon(item.key)}
                                {item.label}
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-extrabold text-slate-800 dark:text-white">
                                R$ {formatNumberBRL(item.value)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 dark:border-slate-700 font-bold">
                          <td className="px-3 py-4 text-slate-800 dark:text-white uppercase font-black">Total geral</td>
                          <td className="px-3 py-4 text-right font-mono font-black text-slate-900 dark:text-white">
                            R$ {formatNumberBRL(totalReceitasPorForma.totalGeral)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* RIGHT COLUMN: MOVIMENTAÇÃO */}
                <div className="lg:col-span-8 flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 transition-all hover:shadow-md">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Movimentação do Dia
                  </h3>

                  <div className="flex-1 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                          <th className="px-3 py-3 text-left">Classificação</th>
                          <th className="px-3 py-3 text-left">Cliente</th>
                          <th className="px-3 py-3 text-left">Histórico</th>
                          <th className="px-3 py-3 text-right">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {movimentacoes.list.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-400 italic font-semibold">
                              Nenhuma movimentação registrada.
                            </td>
                          </tr>
                        ) : (
                          movimentacoes.list.map((item) => (
                            <tr
                              key={item.id}
                              onClick={() => handleOpenEdit(item.raw)}
                              className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition border-b border-slate-50 dark:border-slate-800/40 last:border-0"
                            >
                              <td className="px-3 py-3 font-bold text-slate-800 dark:text-white truncate max-w-[150px]" title={item.classificacao}>
                                {item.classificacao}
                              </td>
                              <td className="px-3 py-3 text-slate-600 dark:text-slate-400 truncate max-w-[120px]" title={item.cliente}>
                                {item.cliente}
                              </td>
                              <td className="px-3 py-3 text-slate-500 dark:text-slate-500 truncate max-w-[200px]" title={item.historico}>
                                {item.historico}
                              </td>
                              <td className={`px-3 py-3 text-right font-mono font-extrabold ${item.saldo < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                {item.saldo < 0 ? '-' : '+'} R$ {formatNumberBRL(Math.abs(item.saldo))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 dark:border-slate-700 font-bold">
                          <td colSpan={3} className="px-3 py-4 text-slate-800 dark:text-white uppercase font-black">Total geral</td>
                          <td className={`px-3 py-4 text-right font-mono font-black ${movimentacoes.totalGeral < 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                            R$ {formatNumberBRL(movimentacoes.totalGeral)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              {/* FOOTER BALANCES */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center border-t border-slate-100 dark:border-slate-800 pt-5">
                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/50 p-4 shrink-0 shadow-inner">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4 text-emerald-500" />
                    Disponível no caixa:
                  </span>
                  <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-5 py-2.5 shadow-sm">
                    <span className="font-mono text-lg font-black text-slate-800 dark:text-white leading-none">
                      R$ {selectedConta ? formatNumberBRL(selectedConta.saldo_atual ?? selectedConta.saldo_inicial ?? 0) : '0,00'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                
                {/* SEARCH INPUT */}
                <div className="relative max-w-md w-full">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                    <Search className="h-4 w-4 text-slate-400" />
                  </span>
                  <input
                    type="text"
                    placeholder="Buscar por descrição, interessado, categoria ou valor..."
                    value={textFiltroExtrato}
                    onChange={(e) => setTextFiltroExtrato(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {groupedExtrato.sortedDates.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
                  <Search className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <h3 className="mt-4 text-lg font-black text-slate-800 dark:text-white">Nenhum lançamento</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Nenhum lançamento foi encontrado para os filtros selecionados.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedExtrato.sortedDates.map((date) => (
                    <div key={date} className="space-y-2 text-[15px]">
                      <div className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider pl-1">
                        {(() => {
                          const [y, m, d] = date.split('-');
                          return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('pt-BR', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          });
                        })()}
                      </div>
                      
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <table className="min-w-full text-xs text-left">
                          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:bg-slate-800/40">
                            <tr>
                              <th className="px-4 py-3">Descrição</th>
                              <th className="px-4 py-3">Interessado</th>
                              <th className="px-4 py-3">Categoria</th>
                              <th className="px-4 py-3 text-right">Valor</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {groupedExtrato.groups[date].map((l) => {
                              const isReceita = l.tipo === 'RECEITA';
                              const valor = Number(l.valor_pago || l.valor_previsto || 0);
                              
                              const catName = categorias.find((c) => String(c.id) === String(l.plano_contas_id))?.nome || 'Sem Categoria';
                              const entName = entidades.find((e) => e.id === l.entidade_id)?.nome || '—';

                              return (
                                <tr
                                  key={l.id}
                                  onClick={() => handleOpenEdit(l)}
                                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                                >
                                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white">
                                    {l.descricao}
                                  </td>
                                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                    {entName}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500 dark:text-slate-500">
                                    {catName}
                                  </td>
                                  <td className={`px-4 py-3 text-right font-mono font-bold ${isReceita ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {isReceita ? '+' : '-'} {formatNumberBRL(valor)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* TRANSACTION DRAWER FORM */}
      <LancamentoFormDrawer
        showDrawer={showDrawer}
        editarId={selectedEditarId}
        contaId={selectedContaId}
        onClose={() => {
          setShowDrawer(false);
          setSelectedEditarId(null);
        }}
        onSaveSuccess={async () => {
          setShowDrawer(false);
          setSelectedEditarId(null);
          await loadCaixaData();
          await refreshSaldos();
        }}
        categorias={categorias}
        entidades={entidades}
        contas={contas}
        cartoes={cartoes}
        centros={centros}
        pushToast={pushToast}
        isCaixaMode={true}
        lancamentos={dailyLancamentos}
      />
    </div>
  );
}
export default Caixa;
