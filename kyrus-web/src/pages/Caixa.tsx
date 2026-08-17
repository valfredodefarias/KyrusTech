import { useEffect, useState, useMemo, useRef } from 'react';
import axios from 'axios';
import { api, fetchLancamentosPaged, normalizeListResponse } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { useAuthStore } from '../store/authStore';
import { useTransactionStore } from '../store/transactionStore';
import {
  Banknote,
  Plus,
  RefreshCw,
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

import { SearchableSelect } from '../components/SearchableSelect';
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
  const refreshCount = useTransactionStore((state) => state.refreshCount);
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

  const caixaAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      setContas([]);
      setCartoes([]);
      setCentros([]);
      setEntidades([]);
      setCategorias([]);
      setDailyLancamentos([]);
      caixaAbortRef.current?.abort();
    };
  }, []);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [empresa, setEmpresa] = useState<any>(null);

  // --- MODALS & DRAWERS ---
  const [showDrawer, setShowDrawer] = useState(false);
  const [selectedEditarId, setSelectedEditarId] = useState<number | null>(null);

  const auxLoadedRef = useRef(false);

  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);

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
    } catch (e: any) {
      if (axios.isCancel(e)) return;
      console.error(e);
      pushToast('error', 'Erro ao carregar dados de suporte.');
    }
  }

  async function loadCaixaData() {
    if (!selectedContaId) return;
    if (caixaAbortRef.current) {
      caixaAbortRef.current.abort();
    }
    const controller = new AbortController();
    caixaAbortRef.current = controller;

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
        { pageSize: 1500, signal: controller.signal }
      );
      setDailyLancamentos(rows);
    } catch (e: any) {
      if (axios.isCancel(e)) return;
      console.error(e);
      pushToast('error', 'Erro ao carregar lançamentos do caixa.');
    } finally {
      if (caixaAbortRef.current === controller) {
        caixaAbortRef.current = null;
        setLoading(false);
      }
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
    void loadAuxData();
  }, [currentEmpresaId]);

  // Reload caixa data when filters or refreshCount change
  useEffect(() => {
    if (selectedContaId) {
      void loadCaixaData();
      void refreshSaldos();
    }
  }, [selectedContaId, dataInicio, dataFim, refreshCount]);

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
          const parsedKeys = new Set(parsed.formas_pagamento.map((f: any) => f.key));
          const dbList = parsed.formas_pagamento.map((item: any) => ({
            key: item.key,
            label: item.label,
          }));
          list = [
            ...dbList,
            ...list.filter((df) => !parsedKeys.has(df.key))
          ];
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
    <div className="h-[calc(100vh-66px)] w-full flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
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
      <header className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800/80 px-4 sm:px-6 py-1.5 flex flex-wrap items-center justify-between shadow-sm gap-2 print:hidden">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-1.5 uppercase tracking-tight">
              <Banknote className="h-4.5 w-4.5 text-blue-500" />
              Movimento de Caixa
            </h1>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
              Registro de Caixa: <span className="text-slate-600 dark:text-slate-200">{selectedConta?.nome || '—'}</span>
            </p>
          </div>
          
          {/* TABS SELECTOR */}
          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 w-fit">
            <button
              onClick={() => setActiveTab('fechamento')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
                activeTab === 'fechamento'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Resumo
            </button>
            <button
              onClick={() => setActiveTab('extrato')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
                activeTab === 'extrato'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Extrato
            </button>
          </div>
        </div>

        {/* FILTERS & ACTIONS */}
        <div className="flex items-center gap-2">
          {/* DATE FILTER */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="bg-transparent font-bold outline-none cursor-pointer w-[110px]"
            />
            <span className="text-slate-300 dark:text-slate-650 font-normal">até</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="bg-transparent font-bold outline-none cursor-pointer w-[110px]"
            />
          </div>

          {/* CASHIER SELECTOR */}
          {caixasFisicos.length > 0 ? (
            <label className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
              <Banknote className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-400 font-normal">Caixa:</span>
              <SearchableSelect
                value={selectedContaId === null ? '' : String(selectedContaId)}
                onChange={(val) => setSelectedContaId(Number(val))}
                options={[{
                  label: 'Caixa',
                  options: caixasFisicos.map((c) => ({ id: String(c.id), label: c.nome }))
                }]}
              />
            </label>
          ) : (
            <span className="text-[11px] italic text-rose-500 font-bold">Nenhum caixa ativo.</span>
          )}

          {/* ACTION BUTTONS */}
          <button
            onClick={() => {
              void loadCaixaData();
              void refreshSaldos();
            }}
            className="p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 shadow-sm"
            title="Recarregar"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleOpenNewEntry()}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 px-2.5 py-1 text-[11px] font-bold text-white transition shadow-sm"
          >
            <Plus className="h-3 w-3" />
            + Lançamento
          </button>
        </div>
      </header>

      {/* MAIN CONTENT CONTAINER */}
      <div className="flex-1 p-3 sm:p-4 min-h-0 flex flex-col overflow-hidden">
        {selectedContaId === null ? (
          <div className="flex-1 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
            <Banknote className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
            <h3 className="mt-3 text-base font-black text-slate-800 dark:text-white">Nenhum Caixa Selecionado</h3>
            <p className="mt-1 text-xs text-slate-500">
              Cadastre uma conta com tipo "Caixa Físico" nas configurações financeiras para começar.
            </p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center text-xs font-semibold text-slate-400">Carregando dados do caixa...</div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col space-y-3">

          {activeTab === 'fechamento' ? (
            <div className="flex-1 min-h-0 flex flex-col space-y-3 animate-in fade-in duration-300">

              {/* KPI CARDS */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 shrink-0">
                {/* ENTRADAS */}
                <div className="rounded-xl border border-slate-200/80 bg-white py-2 px-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Entradas</span>
                    <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                       R$ {formatNumberBRL(dailyKpis.entradas)}
                    </p>
                  </div>
                  <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg text-emerald-500">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>

                {/* SAÍDAS */}
                <div className="rounded-xl border border-slate-200/80 bg-white py-2 px-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Total Saídas</span>
                    <p className="text-base font-extrabold text-rose-600 dark:text-rose-400 font-mono">
                      R$ {formatNumberBRL(dailyKpis.saidas)}
                    </p>
                  </div>
                  <div className="p-1.5 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-rose-500">
                    <TrendingDown className="h-4 w-4" />
                  </div>
                </div>

                {/* SALDO DO DIA */}
                <div className="rounded-xl border border-slate-200/80 bg-white py-2 px-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 flex items-center justify-between transition-all hover:shadow-md">
                  <div className="space-y-0.5">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Saldo do Dia</span>
                    <p className={`text-base font-extrabold font-mono ${dailyKpis.saldo >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      R$ {formatNumberBRL(dailyKpis.saldo)}
                    </p>
                  </div>
                  <div className={`p-1.5 rounded-lg ${dailyKpis.saldo >= 0 ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-500' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-500'}`}>
                    <DollarSign className="h-4 w-4" />
                  </div>
                </div>
              </div>

              {/* DASHBOARD TABLES GRID */}
              <div className="flex-1 min-h-0 grid grid-cols-1 gap-3 lg:grid-cols-12">
                {/* LEFT COLUMN: MOVIMENTO CAIXA DO DIA */}
                <div className="lg:col-span-4 flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 transition-all hover:shadow-md">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-blue-500" />
                    Movimento Caixa do Dia
                  </h3>

                  <div className="flex-1 overflow-y-auto pr-1">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                          <th className="px-1 py-1.5 text-left">Forma Pagto</th>
                          <th className="px-1 py-1.5 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {totalReceitasPorForma.list.length === 0 ? (
                          <tr>
                            <td colSpan={2} className="px-1 py-3 text-center text-slate-400 italic font-semibold text-[11px]">
                              Nenhum recebimento registrado.
                            </td>
                          </tr>
                        ) : (
                          totalReceitasPorForma.list.map((item) => (
                            <tr key={item.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                              <td className="px-1 py-1 text-slate-700 dark:text-slate-300 font-bold flex items-center gap-1.5 text-[11px]">
                                {getPaymentIcon(item.key)}
                                {item.label}
                              </td>
                              <td className="px-1 py-1 text-right font-mono font-extrabold text-slate-800 dark:text-white text-[11px]">
                                R$ {formatNumberBRL(item.value)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 dark:border-slate-700 font-bold text-[11px]">
                          <td className="px-1 py-2 text-slate-800 dark:text-white uppercase font-black">Total geral</td>
                          <td className="px-1 py-2 text-right font-mono font-black text-slate-900 dark:text-white">
                            R$ {formatNumberBRL(totalReceitasPorForma.totalGeral)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* RIGHT COLUMN: MOVIMENTAÇÃO */}
                <div className="lg:col-span-8 flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 transition-all hover:shadow-md">
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                    Movimentação do Dia
                  </h3>

                  <div className="flex-1 overflow-y-auto border border-slate-100 dark:border-slate-800/60 rounded-lg relative">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-white dark:bg-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)] z-10">
                        <tr className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                          <th className="px-2 py-1.5 text-left bg-white dark:bg-slate-900">Classificação</th>
                          <th className="px-2 py-1.5 text-left bg-white dark:bg-slate-900">Cliente</th>
                          <th className="px-2 py-1.5 text-left bg-white dark:bg-slate-900">Histórico</th>
                          <th className="px-2 py-1.5 text-right bg-white dark:bg-slate-900">Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {movimentacoes.list.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-4 text-center text-slate-400 italic font-semibold text-[11px]">
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
                              <td className="px-2 py-1 font-bold text-slate-800 dark:text-white truncate max-w-[150px] text-[11px]" title={item.classificacao}>
                                {item.classificacao}
                              </td>
                              <td className="px-2 py-1 text-slate-600 dark:text-slate-400 truncate max-w-[120px] text-[11px]" title={item.cliente}>
                                {item.cliente}
                              </td>
                              <td className="px-2 py-1 text-slate-500 dark:text-slate-500 truncate max-w-[200px] text-[11px]" title={item.historico}>
                                {item.historico}
                              </td>
                              <td className={`px-2 py-1 text-right font-mono font-extrabold text-[11px] ${item.saldo < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                {item.saldo < 0 ? '-' : '+'} R$ {formatNumberBRL(Math.abs(item.saldo))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-white dark:bg-slate-900 shadow-[0_-1px_0_rgba(0,0,0,0.1)] dark:shadow-[0_-1px_0_rgba(255,255,255,0.1)] z-10">
                        <tr className="font-bold text-[11px]">
                          <td colSpan={3} className="px-2 py-2 text-slate-800 dark:text-white uppercase font-black bg-white dark:bg-slate-900">Total geral</td>
                          <td className={`px-2 py-2 text-right font-mono font-black bg-white dark:bg-slate-900 ${movimentacoes.totalGeral < 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                            R$ {formatNumberBRL(movimentacoes.totalGeral)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              {/* FOOTER BALANCES */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center border-t border-slate-100 dark:border-slate-800 pt-2.5 shrink-0">
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/50 py-1 px-2.5 shrink-0 shadow-inner">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                    Disponível no caixa:
                  </span>
                  <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-700/80 rounded-lg px-3 py-1 shadow-sm">
                    <span className="font-mono text-sm font-black text-slate-800 dark:text-white leading-none">
                      R$ {selectedConta ? formatNumberBRL(selectedConta.saldo_atual ?? selectedConta.saldo_inicial ?? 0) : '0,00'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center shrink-0">
                
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
                <div className="flex-1 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
                  <Search className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
                  <h3 className="mt-4 text-lg font-black text-slate-800 dark:text-white">Nenhum lançamento</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Nenhum lançamento foi encontrado para os filtros selecionados.
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto pr-1 space-y-6">
                  {groupedExtrato.sortedDates.map((date) => (
                    <div key={date} className="space-y-2 text-[15px]">
                      <div className="text-xs font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider pl-1">
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
                        <table className="min-w-full text-xs text-left table-fixed">
                          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:bg-slate-800/40">
                            <tr>
                              <th className="px-4 py-3 w-[40%]">Descrição</th>
                              <th className="px-4 py-3 w-[20%]">Interessado</th>
                              <th className="px-4 py-3 w-[25%]">Categoria</th>
                              <th className="px-4 py-3 text-right w-[15%]">Valor</th>
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
                                  <td className="px-4 py-3 font-semibold text-slate-800 dark:text-white truncate" title={l.descricao}>
                                    {l.descricao}
                                  </td>
                                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400 truncate" title={entName}>
                                    {entName}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500 dark:text-slate-500 truncate" title={catName}>
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
