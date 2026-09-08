// kyrus-web/src/pages/MovimentacaoPDV.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Calendar, DollarSign, Trash2, Edit, CheckCircle, AlertCircle,
  RefreshCw, ChevronLeft, ChevronRight, X, PlusCircle, MinusCircle,
  Search, Download, Printer, TrendingUp, TrendingDown,
  User, Mail, Clock
} from 'lucide-react';
import { SearchableSelect } from '../components/SearchableSelect';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useKyrusWsListener } from '../hooks/useKyrusWebSocket';

import { usePdvMovimentacaoStore, type MovimentacaoPDV } from '../store/pdvMovimentacaoStore';

type FilterTipo = 'TODOS' | 'ENTRADA' | 'SAIDA';
type FilterForma = 'TODOS' | 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
type FilterConciliado = 'TODOS' | 'SIM' | 'NAO';

function formatAuditDateTime(dataCriacao?: string | null, horaCriacao?: string | null, fallbackDate?: string | null) {
  if (dataCriacao) {
    const parts = dataCriacao.split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dataCriacao;
    const timeStr = horaCriacao ? ` às ${horaCriacao}` : '';
    return `${dateStr}${timeStr}`;
  }
  if (fallbackDate) {
    try {
      const d = new Date(fallbackDate);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
      }
    } catch {}
    return fallbackDate;
  }
  return 'Data não disponível';
}

function formatExpressionCentsFirst(input: string): string {
  if (!input) return '';
  const tokens = input.split(/([+\-*/()])/g);
  const formattedTokens = tokens.map((token) => {
    if (/^[0-9]+$/.test(token)) {
      const padded = token.padStart(3, '0');
      const integerPart = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
      const decimalPart = padded.slice(-2);
      return `${integerPart},${decimalPart}`;
    }
    return token;
  });
  return formattedTokens.join('');
}

export function MovimentacaoPDV() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const printRef = useRef<HTMLDivElement>(null);

  const fetchMovimentacoesAction = usePdvMovimentacaoStore((state) => state.fetchMovimentacoes);
  const invalidateStore = usePdvMovimentacaoStore((state) => state.invalidate);
  const [saving, setSaving] = useState(false);

  const fetchWsSyncItems = usePdvMovimentacaoStore((state) => state.fetchWsSyncItems);
  const removeMovimentacao = usePdvMovimentacaoStore((state) => state.removeMovimentacao);

  // Selection & Dates
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return sessionStorage.getItem('pdv_selectedDate') || '';
  });
  const [currentYearMonth, setCurrentYearMonth] = useState(() => {
    const saved = sessionStorage.getItem('pdv_currentYearMonth');
    if (saved) return saved;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // WebSocket listeners para atualizar a lista em tempo real sem recarregar o mês inteiro
  const handleWsUpsert = useCallback((payload: any, eventName: string) => {
    const refId = payload?.id || payload?.id_parcelamento;
    if (refId) fetchWsSyncItems(eventName, refId);
  }, [fetchWsSyncItems]);

  const handleWsDelete = useCallback((payload: any) => {
    const refId = payload?.id || payload?.id_parcelamento;
    if (refId) removeMovimentacao(refId);
  }, [removeMovimentacao]);

  useKyrusWsListener('VENDA_CREATED', (payload) => handleWsUpsert(payload, 'VENDA_CREATED'));
  useKyrusWsListener('VENDA_UPDATED', (payload) => handleWsUpsert(payload, 'VENDA_UPDATED'));
  useKyrusWsListener('VENDA_DELETED', handleWsDelete);
  useKyrusWsListener('MOVIMENTACAO_PDV_CREATED', (payload) => handleWsUpsert(payload, 'MOVIMENTACAO_PDV_CREATED'));
  useKyrusWsListener('MOVIMENTACAO_PDV_UPDATED', (payload) => handleWsUpsert(payload, 'MOVIMENTACAO_PDV_UPDATED'));
  useKyrusWsListener('MOVIMENTACAO_PDV_DELETED', handleWsDelete);
  // Lançamentos comuns vinculados a centro de custos ou com "sangria" podem aparecer aqui:
  useKyrusWsListener('LANCAMENTO_CREATED', (payload) => handleWsUpsert(payload, 'MOVIMENTACAO_PDV_CREATED'));
  useKyrusWsListener('LANCAMENTO_UPDATED', (payload) => handleWsUpsert(payload, 'MOVIMENTACAO_PDV_UPDATED'));
  useKyrusWsListener('LANCAMENTO_DELETED', handleWsDelete);

  const monthCache = usePdvMovimentacaoStore((state) => state.monthCache);
  const loadingMonths = usePdvMovimentacaoStore((state) => state.loadingMonths);

  const movimentacoes = useMemo(() => monthCache[currentYearMonth] || [], [monthCache, currentYearMonth]);
  const loading = loadingMonths[currentYearMonth] || false;

  const getLocalTodayString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // --- Filtros ---
  const [filterTipo, setFilterTipo] = useState<FilterTipo>(() => {
    return (sessionStorage.getItem('pdv_filterTipo') as FilterTipo) || 'TODOS';
  });
  const [filterForma, setFilterForma] = useState<FilterForma>(() => {
    return (sessionStorage.getItem('pdv_filterForma') as FilterForma) || 'TODOS';
  });
  const [filterConciliado, setFilterConciliado] = useState<FilterConciliado>(() => {
    return (sessionStorage.getItem('pdv_filterConciliado') as FilterConciliado) || 'TODOS';
  });
  const [filterBandeira, setFilterBandeira] = useState<string>(() => {
    return sessionStorage.getItem('pdv_filterBandeira') || 'TODOS';
  });
  const [searchText, setSearchText] = useState(() => {
    return sessionStorage.getItem('pdv_searchText') || '';
  });

  useEffect(() => {
    sessionStorage.setItem('pdv_selectedDate', selectedDate);
    sessionStorage.setItem('pdv_currentYearMonth', currentYearMonth);
    sessionStorage.setItem('pdv_filterTipo', filterTipo);
    sessionStorage.setItem('pdv_filterForma', filterForma);
    sessionStorage.setItem('pdv_filterConciliado', filterConciliado);
    sessionStorage.setItem('pdv_filterBandeira', filterBandeira);
    sessionStorage.setItem('pdv_searchText', searchText);
  }, [selectedDate, currentYearMonth, filterTipo, filterForma, filterConciliado, filterBandeira, searchText]);

  // --- Seleção múltipla ---
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Drawer Form State
  const [showDrawer, setShowDrawer] = useState(false);
  const [editingMov, setEditingMov] = useState<MovimentacaoPDV | null>(null);

  const [formTipo, setFormTipo] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [formDescricao, setFormDescricao] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formValorText, setFormValorText] = useState('');
  const [formFormaPagamento, setFormFormaPagamento] = useState('DINHEIRO');
  const [formBandeira, setFormBandeira] = useState('OUTROS');
  const [formParcelas, setFormParcelas] = useState(1);
  const [formData, setFormData] = useState('');
  const [formCentroCustoId, setFormCentroCustoId] = useState('');
  const [formContaId, setFormContaId] = useState('');

  // Sangria State
  const [showSangriaDrawer, setShowSangriaDrawer] = useState(false);
  const [sangriaValor, setSangriaValor] = useState('');
  const [sangriaValorText, setSangriaValorText] = useState('');
  const [sangriaData, setSangriaData] = useState('');
  const [sangriaContaDestinoId, setSangriaContaDestinoId] = useState<number | ''>('');

  // Dropdowns Lists
  const [centrosCusto, setCentrosCusto] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [pdvConfig, setPdvConfig] = useState<any>(null);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const [companyName, setCompanyName] = useState('');

  // ---------- DERIVED STATE ----------

  const activeFilterCount = [
    filterTipo !== 'TODOS',
    filterForma !== 'TODOS',
    filterConciliado !== 'TODOS',
    filterBandeira !== 'TODOS',
    searchText.trim() !== '',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setFilterTipo('TODOS');
    setFilterForma('TODOS');
    setFilterConciliado('TODOS');
    setFilterBandeira('TODOS');
    setSearchText('');
    setSelectedIds(new Set());
  };

  // ---------- DATA FETCHING ----------

  const fetchMetadata = async () => {
    try {
      const [resCc, resContas, resConfig] = await Promise.all([
        api.get('/centro-custo/'),
        api.get('/contas/', { params: { include_saldo: false } }),
        api.get('/pdv/config')
      ]);
      const ccData = normalizeListResponse<any>(resCc.data);
      setCentrosCusto(ccData);

      const configData = resConfig.data;
      setPdvConfig(configData);

      const pdvCcId = configData?.pdv_centro_custo_padrao_id ?? configData?.centro_custo_padrao_id;
      if (pdvCcId) setFormCentroCustoId(String(pdvCcId));
      else if (ccData.length > 0) setFormCentroCustoId(String(ccData[0].id));

      const contasData = normalizeListResponse<any>(resContas.data);
      setContas(contasData);

      if (configData?.pdv_conta_padrao_id) setFormContaId(String(configData.pdv_conta_padrao_id));
      else if (contasData.length > 0) setFormContaId(String(contasData[0].id));

      if (user?.empresa_id) {
        const resEmp = await api.get(`/empresas/${user.empresa_id}`);
        if (resEmp.data?.nome_fantasia) setCompanyName(resEmp.data.nome_fantasia);
      }
    } catch (err) {
      console.error('Erro ao buscar dados auxiliares:', err);
    }
  };

  useEffect(() => {
    const handleWsUpdate = () => {
      usePdvMovimentacaoStore.getState().invalidate();
      fetchMovimentacoes(currentYearMonth, undefined, true);
    };
    
    const onEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (
        customEvent.detail?.type === 'MOVIMENTACAO_PDV_CREATED' ||
        customEvent.detail?.type === 'MOVIMENTACAO_PDV_UPDATED' ||
        customEvent.detail?.type === 'MOVIMENTACAO_PDV_DELETED'
      ) {
        handleWsUpdate();
      }
    };
    
    window.addEventListener('kyrus-ws-event', onEvent);
    return () => {
      window.removeEventListener('kyrus-ws-event', onEvent);
    };
  }, [currentYearMonth]);

  const fetchMovimentacoes = async (monthStr?: string, forceSelectedDate?: string, forceFetch = false) => {
    try {
      const targetMonth = monthStr || currentYearMonth;
      await fetchMovimentacoesAction(targetMonth, forceFetch);

      const targetSelectedDate = forceSelectedDate !== undefined ? forceSelectedDate : selectedDate;

      if (!targetSelectedDate) {
        const todayStr = getLocalTodayString();
        setSelectedDate(todayStr);
        setCurrentYearMonth(todayStr.substring(0, 7));
      } else {
        setSelectedDate(targetSelectedDate);
        if (monthStr) setCurrentYearMonth(monthStr);
      }
    } catch (err) {
      console.error('Erro ao carregar movimentações:', err);
    }
  };

  useEffect(() => {
    setSelectedDate('');
    void fetchMetadata();
    void fetchMovimentacoes(undefined, '');
  }, [user?.empresa_id]);

  // ---------- MEMOS ----------

  const monthlyDates = useMemo(() => {
    const datesMap: Record<string, { entradas: number; saidas: number; count: number }> = {};
    const [year, month] = currentYearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    for (let day = 1; day <= lastDay; day++) {
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      datesMap[dStr] = { entradas: 0, saidas: 0, count: 0 };
    }

    movimentacoes.forEach(m => {
      if (m.data.startsWith(currentYearMonth)) {
        if (!datesMap[m.data]) datesMap[m.data] = { entradas: 0, saidas: 0, count: 0 };
        if (m.tipo === 'ENTRADA') datesMap[m.data].entradas += Number(m.valor);
        else datesMap[m.data].saidas += Number(m.valor);
        datesMap[m.data].count += 1;
      }
    });

    const todayStr = getLocalTodayString();
    
    return Object.entries(datesMap)
      .map(([date, info]) => ({
        date,
        entradas: info.entradas,
        saidas: info.saidas,
        saldo: info.entradas - info.saidas,
        count: info.count
      }))
      .filter(info => info.count > 0 || info.date === todayStr)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [movimentacoes, currentYearMonth]);

  // Map date → category totals for variation calculation
  const dateCategoryTotalsMap = useMemo(() => {
    const map: Record<string, { dinheiro: number; pix: number; debito: number; credito: number; total: number }> = {};
    movimentacoes.forEach(m => {
      const val = Number(m.valor) || 0;
      if (!map[m.data]) {
        map[m.data] = { dinheiro: 0, pix: 0, debito: 0, credito: 0, total: 0 };
      }
      if (m.tipo === 'ENTRADA') {
        map[m.data].total += val;
        if (m.forma_pagamento === 'DINHEIRO') {
          map[m.data].dinheiro += val;
        } else if (m.forma_pagamento === 'PIX') {
          map[m.data].pix += val;
        } else if (m.forma_pagamento === 'DEBITO') {
          map[m.data].debito += val;
        } else if (m.forma_pagamento === 'CREDITO_AVISTA' || m.forma_pagamento === 'CREDITO_PARCELADO') {
          map[m.data].credito += val;
        }
      } else if (m.tipo === 'SAIDA') {
        map[m.data].total -= val;
      }
    });
    return map;
  }, [movimentacoes]);

  const getCategoryVariation = (category: 'dinheiro' | 'pix' | 'debito' | 'credito' | 'total', dateStr: string) => {
    if (!dateStr) return { variation: null, prevValue: 0 };
    const d = new Date(dateStr + 'T00:00:00');
    const prevDate = new Date(d);
    prevDate.setDate(prevDate.getDate() - 7);
    const prevStr = prevDate.toISOString().split('T')[0];
    
    const current = dateCategoryTotalsMap[dateStr]?.[category] ?? 0;
    const prev = dateCategoryTotalsMap[prevStr]?.[category] ?? 0;
    
    if (!prev) return { variation: null, prevValue: 0 };
    return {
      variation: ((current - prev) / prev) * 100,
      prevValue: prev
    };
  };

  const getDayVariation = (dateStr: string): number | null => {
    return getCategoryVariation('total', dateStr).variation;
  };

  const selectedDateEntries = useMemo(() => {
    if (!selectedDate) return [];
    return movimentacoes.filter(m => m.data === selectedDate);
  }, [movimentacoes, selectedDate]);

  // Structured daily totals for the new grid cards
  const dailyTotals = useMemo(() => {
    const totals = {
      dinheiro: { valor: 0, count: 0 },
      pix: { valor: 0, count: 0 },
      debito: { valor: 0, count: 0, brands: {} as Record<string, number> },
      credito: { valor: 0, count: 0, brands: {} as Record<string, number> },
      entradas: 0,
      saidas: 0,
      saldo: 0,
    };

    selectedDateEntries.forEach(m => {
      const val = Number(m.valor) || 0;
      if (m.tipo === 'ENTRADA') {
        totals.entradas += val;
        if (m.forma_pagamento === 'DINHEIRO') {
          totals.dinheiro.valor += val;
          totals.dinheiro.count++;
        } else if (m.forma_pagamento === 'PIX') {
          totals.pix.valor += val;
          totals.pix.count++;
        } else if (m.forma_pagamento === 'DEBITO') {
          totals.debito.valor += val;
          totals.debito.count++;
          const brand = (m.bandeira || 'OUTROS').toUpperCase();
          totals.debito.brands[brand] = (totals.debito.brands[brand] || 0) + val;
        } else if (m.forma_pagamento === 'CREDITO_AVISTA' || m.forma_pagamento === 'CREDITO_PARCELADO') {
          totals.credito.valor += val;
          totals.credito.count++;
          const brand = (m.bandeira || 'OUTROS').toUpperCase();
          totals.credito.brands[brand] = (totals.credito.brands[brand] || 0) + val;
        }
      } else if (m.tipo === 'SAIDA') {
        totals.saidas += val;
      }
    });

    totals.saldo = totals.entradas - totals.saidas;
    return totals;
  }, [selectedDateEntries]);

  const renderTrend = (category: 'dinheiro' | 'pix' | 'debito' | 'credito' | 'total') => {
    const { variation, prevValue } = getCategoryVariation(category, selectedDate);
    if (variation === null) return null;
    const isUp = variation >= 0;
    const tooltipText = `vs. mesmo dia da semana anterior (${BRL.format(prevValue)})`;
    return (
      <span 
        title={tooltipText}
        className={`text-[9px] font-black inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full select-none cursor-help ${
          isUp 
            ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-450 border border-emerald-200 dark:border-emerald-900/50' 
            : 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-450 border border-rose-200 dark:border-rose-900/50'
        }`}
      >
        {isUp ? '↑' : '↓'} {Math.abs(variation).toFixed(0)}%
      </span>
    );
  };

  // Available bandeiras from entries in selected date (só de cartão)
  const availableBandeiras = useMemo(() => {
    const set = new Set<string>();
    selectedDateEntries.forEach(m => {
      if (m.tipo === 'ENTRADA' && m.bandeira && m.bandeira !== 'OUTROS' &&
        (m.forma_pagamento === 'DEBITO' || m.forma_pagamento === 'CREDITO_AVISTA' || m.forma_pagamento === 'CREDITO_PARCELADO')) {
        set.add(m.bandeira.toUpperCase());
      }
    });
    return Array.from(set).sort();
  }, [selectedDateEntries]);

  // Filtered entries (client-side, instant)
  const filteredEntries = useMemo(() => {
    let items = selectedDateEntries;

    if (filterTipo !== 'TODOS')
      items = items.filter(m => m.tipo === filterTipo);

    if (filterForma !== 'TODOS') {
      if (filterForma === 'CREDITO')
        items = items.filter(m => m.forma_pagamento === 'CREDITO_AVISTA' || m.forma_pagamento === 'CREDITO_PARCELADO');
      else
        items = items.filter(m => m.forma_pagamento === filterForma);
    }

    if (filterBandeira !== 'TODOS') {
      items = items.filter(m => (m.bandeira || '').toUpperCase() === filterBandeira);
    }

    if (filterConciliado === 'SIM') items = items.filter(m => m.conciliado);
    else if (filterConciliado === 'NAO') items = items.filter(m => !m.conciliado);

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      items = items.filter(m =>
        m.descricao.toLowerCase().includes(q) ||
        (m.bandeira || '').toLowerCase().includes(q)
      );
    }

    return items;
  }, [selectedDateEntries, filterTipo, filterForma, filterBandeira, filterConciliado, searchText]);

  // Sticky totals
  const stickyTotals = useMemo(() => {
    const entradas = filteredEntries.filter(m => m.tipo === 'ENTRADA').reduce((s, m) => s + Number(m.valor), 0);
    const saidas = filteredEntries.filter(m => m.tipo === 'SAIDA').reduce((s, m) => s + Number(m.valor), 0);
    return { entradas, saidas, saldo: entradas - saidas };
  }, [filteredEntries]);

  // Batch totals for selected items
  const batchTotal = useMemo(() => {
    return filteredEntries
      .filter(m => selectedIds.has(m.id) && m.tipo === 'ENTRADA')
      .reduce((s, m) => s + Number(m.valor), 0);
  }, [filteredEntries, selectedIds]);

  // ---------- NAVIGATION ----------

  const handlePrevMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1);
    const newYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    setCurrentYearMonth(newYm);
    setSelectedDate(`${newYm}-01`);
    resetFilters();
    void fetchMovimentacoes(newYm, `${newYm}-01`);
  };

  const handleNextMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const nextDate = new Date(year, month, 1);
    const newYm = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    setCurrentYearMonth(newYm);
    setSelectedDate(`${newYm}-01`);
    resetFilters();
    void fetchMovimentacoes(newYm, `${newYm}-01`);
  };

  const formattedMonthLabel = useMemo(() => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  }, [currentYearMonth]);

  // ---------- SELECTION ----------

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEntries.length && filteredEntries.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEntries.map(m => m.id)));
    }
    setShowDrawer(true);
  };

  const handleOpenSangriaDrawer = () => {
    const availableCash = dailyTotals?.dinheiro?.valor ?? 0;
    setSangriaValor(availableCash > 0 ? String(availableCash) : '');
    setSangriaValorText(availableCash > 0 ? formatExpressionCentsFirst(String(availableCash)) : '');
    setSangriaData(selectedDate || new Date().toISOString().split('T')[0]);
    
    const sourceAccountId = pdvConfig?.pdv_conta_padrao_id;
    const validDestinations = contas.filter(c => c.id !== sourceAccountId);
    
    const lastUsed = localStorage.getItem('kyrus_last_sangria_destination_id');
    if (lastUsed && validDestinations.some(c => c.id === Number(lastUsed))) {
      setSangriaContaDestinoId(Number(lastUsed));
    } else {
      const targetFrequency: Record<number, number> = {};
      filteredEntries.forEach(item => {
        if (item.tipo === 'SAIDA' && item.descricao.toLowerCase().includes('sangria')) {
          const match = item.descricao.match(/Destino:\s*(.+)$/i);
          if (match) {
            const bankName = match[1].trim().toLowerCase();
            const matchingConta = validDestinations.find(c => c.nome.toLowerCase().includes(bankName) || bankName.includes(c.nome.toLowerCase()));
            if (matchingConta) {
              targetFrequency[matchingConta.id] = (targetFrequency[matchingConta.id] || 0) + 1;
            }
          }
        }
      });
      
      let mostFrequentId: number | '' = '';
      let maxCount = 0;
      Object.entries(targetFrequency).forEach(([idStr, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mostFrequentId = Number(idStr);
        }
      });
      
      if (mostFrequentId !== '') {
        setSangriaContaDestinoId(mostFrequentId);
      } else if (validDestinations.length > 0) {
        setSangriaContaDestinoId(validDestinations[0].id);
      } else {
        setSangriaContaDestinoId('');
      }
    }
    setShowSangriaDrawer(true);
  };

  const handleSaveSangria = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(sangriaValor);
    if (isNaN(val) || val <= 0) {
      alert('Informe um valor válido maior que zero.');
      return;
    }
    if (!sangriaContaDestinoId) {
      alert('Selecione uma conta bancária de destino.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        data: sangriaData,
        valor: val,
        conta_destino_id: Number(sangriaContaDestinoId),
        descricao: 'Sangria de Caixa'
      };
      
      await api.post('/pdv/sangrias', payload);
      
      localStorage.setItem('kyrus_last_sangria_destination_id', String(sangriaContaDestinoId));
      setShowSangriaDrawer(false);
      invalidateStore();
      await fetchMovimentacoes(currentYearMonth, selectedDate, true);
    } catch (err: any) {
      console.error('Erro ao salvar sangria:', err);
      alert(err?.response?.data?.detail || 'Erro ao registrar sangria.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- FORM ----------

  
  const handleFormValorBlur = () => {
    if (!formValorText) {
      setFormValor('');
      return;
    }
    const cleanExpr = formValorText.replace(/\./g, '').replace(/,/g, '.');
    if (/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
      try {
        const result = Function(`"use strict"; return (${cleanExpr})`)();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setFormValorText(formatted);
          setFormValor(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handleSangriaValorBlur = () => {
    if (!sangriaValorText) {
      setSangriaValor('');
      return;
    }
    const cleanExpr = sangriaValorText.replace(/\./g, '').replace(/,/g, '.');
    if (/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
      try {
        const result = Function(`"use strict"; return (${cleanExpr})`)();
        if (Number.isFinite(result) && result >= 0) {
          const formatted = result.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          setSangriaValorText(formatted);
          setSangriaValor(String(result.toFixed(2)));
        }
      } catch (err) {
        console.error("Invalid math expression", err);
      }
    }
  };

  const handleOpenDrawer = (tipo: 'ENTRADA' | 'SAIDA', editItem?: MovimentacaoPDV) => {
    if (editItem) {
      if (editItem.conciliado) {
        alert('Esta movimentação já foi conciliada no extrato bancário e não pode ser editada.');
        return;
      }
      setEditingMov(editItem);
      setFormTipo(editItem.tipo);
      setFormDescricao(editItem.descricao);
      setFormValor(String(editItem.valor));
      setFormValorText(formatExpressionCentsFirst(String(editItem.valor)));
      setFormFormaPagamento(editItem.forma_pagamento);
      setFormBandeira(editItem.bandeira);
      setFormParcelas(editItem.parcelas);
      setFormData(editItem.data);
      setFormCentroCustoId(editItem.centro_custo_id ? String(editItem.centro_custo_id) : '');
      setFormContaId(editItem.conta_id ? String(editItem.conta_id) : '');
    } else {
      setEditingMov(null);
      setFormTipo(tipo);
      setFormDescricao(tipo === 'ENTRADA' ? 'Venda Frente de Caixa' : 'Sangria / Retirada');
      setFormValor('');
      setFormValorText('');
      setFormFormaPagamento('DINHEIRO');
      setFormBandeira('OUTROS');
      setFormParcelas(1);
      setFormData(selectedDate || new Date().toISOString().split('T')[0]);
      const pdvCcId = pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id;
      if (pdvCcId) setFormCentroCustoId(String(pdvCcId));
      else if (centrosCusto.length > 0) setFormCentroCustoId(String(centrosCusto[0].id));
      if (pdvConfig?.pdv_conta_padrao_id) setFormContaId(String(pdvConfig.pdv_conta_padrao_id));
      else if (contas.length > 0) setFormContaId(String(contas[0].id));
    }
    setShowDrawer(true);
  };

  const handleSaveMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(formValor);
    if (isNaN(val) || val <= 0) {
      alert('Informe um valor válido maior que zero.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        tipo: formTipo,
        descricao: formDescricao,
        valor: val,
        forma_pagamento: formTipo === 'SAIDA' ? 'DINHEIRO' : formFormaPagamento,
        bandeira: formTipo === 'SAIDA' ? 'OUTROS' : formBandeira,
        parcelas: formTipo === 'SAIDA' ? 1 : formParcelas,
        data: formData,
        centro_custo_id: (pdvConfig?.pdv_centro_custo_flexivel ?? pdvConfig?.centro_custo_flexivel) !== false
          ? (formCentroCustoId ? Number(formCentroCustoId) : null)
          : ((pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id) ? Number(pdvConfig.pdv_centro_custo_padrao_id ?? pdvConfig.centro_custo_padrao_id) : null),
        conta_id: formContaId ? Number(formContaId) : null
      };
      if (editingMov) {
        await api.put(`/pdv/movimentacoes/${editingMov.id}`, payload);
      } else {
        await api.post('/pdv/movimentacoes', payload);
      }
      setShowDrawer(false);
      const targetMonth = formData.substring(0, 7);
      setSelectedDate(formData);
      setCurrentYearMonth(targetMonth);
      invalidateStore();
      await fetchMovimentacoes(targetMonth, formData, true);
    } catch (err: any) {
      console.error('Erro ao salvar movimentação:', err);
      alert(err?.response?.data?.detail || 'Erro ao registrar movimentação.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMovimentacao = async (item: MovimentacaoPDV) => {
    if (item.conciliado) {
      alert('Esta movimentação já foi conciliada no extrato bancário e não pode ser excluída.');
      return;
    }
    if (!confirm('Deseja realmente excluir esta movimentação?')) return;
    setSaving(true);
    try {
      await api.delete(`/pdv/movimentacoes/${item.id}`);
      invalidateStore();
      await fetchMovimentacoes(currentYearMonth, selectedDate, true);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao excluir movimentação.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- BATCH ACTIONS ----------

  const handleBatchDelete = async () => {
    const toDelete = filteredEntries.filter(m => selectedIds.has(m.id) && !m.conciliado);
    const skipped = filteredEntries.filter(m => selectedIds.has(m.id) && m.conciliado).length;

    if (toDelete.length === 0) {
      alert('Nenhum item selecionado pode ser excluído (todos estão conciliados).');
      return;
    }

    const msg = skipped > 0
      ? `Excluir ${toDelete.length} movimentações? (${skipped} conciliadas serão ignoradas)`
      : `Excluir ${toDelete.length} movimentações selecionadas?`;

    if (!confirm(msg)) return;

    setSaving(true);
    try {
      await Promise.all(toDelete.map(m => api.delete(`/pdv/movimentacoes/${m.id}`)));
      setSelectedIds(new Set());
      invalidateStore();
      await fetchMovimentacoes(currentYearMonth, selectedDate, true);
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Erro ao excluir movimentações.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCSV = () => {
    const items = selectedIds.size > 0
      ? filteredEntries.filter(m => selectedIds.has(m.id))
      : filteredEntries;

    const header = 'Data,Tipo,Descricao,Forma Pagamento,Bandeira,Parcelas,Valor,Conciliado';
    const rows = items.map(m =>
      `${m.data},${m.tipo},"${m.descricao}",${m.forma_pagamento},${m.bandeira || ''},${m.parcelas},${Number(m.valor).toFixed(2)},${m.conciliado ? 'Sim' : 'Nao'}`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimentacoes_${selectedDate || currentYearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintFechamento = () => {
    const dayEntries = selectedDateEntries;
    const totalEntradaDinheiro = dayEntries.filter(m => m.tipo === 'ENTRADA' && m.forma_pagamento === 'DINHEIRO').reduce((s, m) => s + Number(m.valor), 0);
    const totalSaidas = dayEntries.filter(m => m.tipo === 'SAIDA').reduce((s, m) => s + Number(m.valor), 0);
    const saldoFisico = totalEntradaDinheiro - totalSaidas;

    // Group non-cash entries by forma+bandeira
    const cardMap: Record<string, number> = {};
    dayEntries.forEach(m => {
      if (m.tipo !== 'ENTRADA' || m.forma_pagamento === 'DINHEIRO') return;
      const isCredito = m.forma_pagamento === 'CREDITO_AVISTA' || m.forma_pagamento === 'CREDITO_PARCELADO';
      const key = isCredito ? `${m.bandeira} Crédito` : m.forma_pagamento === 'PIX' ? 'PIX' : `${m.bandeira} Débito`;
      cardMap[key] = (cardMap[key] || 0) + Number(m.valor);
    });

    const totalGeral = dayEntries.filter(m => m.tipo === 'ENTRADA').reduce((s, m) => s + Number(m.valor), 0);
    const fmtDate = selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>Fechamento de Caixa</title>
      <style>
        body { font-family: monospace; font-size: 13px; padding: 24px; max-width: 400px; }
        h2 { text-align: center; font-size: 15px; margin-bottom: 4px; }
        p { text-align: center; margin: 0 0 16px; font-size: 12px; color: #666; }
        hr { border: none; border-top: 1px dashed #999; margin: 10px 0; }
        .row { display: flex; justify-content: space-between; margin: 4px 0; }
        .total { font-weight: bold; font-size: 14px; }
        .sign { color: #888; }
        .footer { margin-top: 32px; }
        .footer .line { border-top: 1px solid #000; margin-top: 36px; font-size: 11px; color: #666; }
      </style></head><body>
      <h2>FECHAMENTO DE CAIXA</h2>
      <p>${fmtDate.toUpperCase()}<br>${companyName}</p>
      <hr>
      <div class="row"><span>Entradas em Dinheiro</span><span>${BRL.format(totalEntradaDinheiro)}</span></div>
      <div class="row sign"><span>Sangrias (Saídas)</span><span>- ${BRL.format(totalSaidas)}</span></div>
      <div class="row total"><span>SALDO FÍSICO ESPERADO</span><span>${BRL.format(saldoFisico)}</span></div>
      <hr>
      ${Object.entries(cardMap).map(([k, v]) => `<div class="row"><span>${k}</span><span>${BRL.format(v)}</span></div>`).join('')}
      <hr>
      <div class="row total"><span>TOTAL GERAL ENTRADAS</span><span>${BRL.format(totalGeral)}</span></div>
      <hr>
      <div class="footer">
        <div class="row"><span>Operador:</span><span>_______________________</span></div>
        <div class="row"><span>Assinatura:</span><span>_____________________</span></div>
      </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // ---------- COLOR HELPERS ----------

  const cardColorClasses: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    emerald: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/20',
      border: 'border-emerald-200 dark:border-emerald-900/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    },
    sky: {
      bg: 'bg-sky-50 dark:bg-sky-950/20',
      border: 'border-sky-200 dark:border-sky-900/40',
      text: 'text-sky-700 dark:text-sky-300',
      badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
    },
    blue: {
      bg: 'bg-blue-50 dark:bg-blue-950/20',
      border: 'border-blue-200 dark:border-blue-900/40',
      text: 'text-blue-700 dark:text-blue-300',
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    },
    violet: {
      bg: 'bg-violet-50 dark:bg-violet-950/20',
      border: 'border-violet-200 dark:border-violet-900/40',
      text: 'text-violet-700 dark:text-violet-300',
      badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
    },
    slate: {
      bg: 'bg-slate-50 dark:bg-slate-950/20',
      border: 'border-slate-200 dark:border-slate-800',
      text: 'text-slate-700 dark:text-slate-300',
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    },
  };

  const allSelected = filteredEntries.length > 0 && selectedIds.size === filteredEntries.length;

  // ---------- RENDER ----------

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/apps')}
            className="p-1.5 border border-slate-250 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 text-slate-700 dark:text-slate-300 transition cursor-pointer rounded-none bg-transparent"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <DollarSign className="w-5.5 h-5.5 text-slate-600 dark:text-slate-400" />
              <span>Movimentação PDV</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-455 text-xs">
              Lançamentos rápidos de caixa, fechamento de turno e vendas{companyName ? ` na filial ${companyName}` : ''}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleOpenSangriaDrawer}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition rounded-none cursor-pointer flex items-center gap-1.5 border-none shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Sangria</span>
          </button>
          <button
            onClick={() => handleOpenDrawer('ENTRADA')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition rounded-none cursor-pointer flex items-center gap-1.5 border-none shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Movimentação</span>
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-slate-200 dark:border-slate-800 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-none shadow-none">

        {/* Left Column: Calendar Date List */}
        <div className="lg:col-span-4 flex flex-col h-[700px] overflow-hidden">
          {/* Month Selector */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/20 shrink-0">
            <button
              onClick={handlePrevMonth}
              className="p-1 border border-slate-200 dark:border-slate-850 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-none transition cursor-pointer bg-transparent text-slate-700 dark:text-slate-350"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono tracking-wider">
              {formattedMonthLabel}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1 border border-slate-200 dark:border-slate-850 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-none transition cursor-pointer bg-transparent text-slate-700 dark:text-slate-350"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Dates List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-150 dark:divide-slate-850">
            {monthlyDates.map((item) => {
              const formattedDate = new Date(item.date + 'T00:00:00');
              const dayNum = String(formattedDate.getDate()).padStart(2, '0');
              const dayName = formattedDate.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase();
              const isSelected = selectedDate === item.date;
              const variation = getDayVariation(item.date);

              return (
                <div
                  key={item.date}
                  onClick={() => { setSelectedDate(item.date); setSelectedIds(new Set()); }}
                  className={`p-3 flex items-center justify-between cursor-pointer transition border-l-4 ${
                    isSelected
                      ? 'bg-slate-50 border-l-slate-900 dark:bg-slate-800/40 dark:border-l-slate-400 font-semibold'
                      : 'border-l-transparent hover:bg-slate-50/50 dark:hover:bg-slate-950/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 border flex flex-col items-center justify-center rounded-none font-mono ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-700 dark:border-slate-700'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-750 dark:text-slate-350 border-slate-205 dark:border-slate-800'
                    }`}>
                      <span className="text-sm font-black -mb-1">{dayNum}</span>
                      <span className="text-[8px] font-bold text-slate-450">{dayName}</span>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        {item.count} Lançamento(s)
                      </div>
                      <div className="text-xs font-mono text-slate-850 dark:text-slate-200">
                        {BRL.format(item.entradas)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end gap-0.5">
                    {item.saldo !== 0 ? (
                      <span className={`text-xs font-mono font-bold ${item.saldo > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {item.saldo > 0 ? '+' : ''}{BRL.format(item.saldo)}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-slate-400">—</span>
                    )}
                    {variation !== null && (
                      <span className={`text-[10px] font-bold flex items-center gap-0.5 ${variation >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>
                        {variation >= 0
                          ? <TrendingUp className="w-2.5 h-2.5" />
                          : <TrendingDown className="w-2.5 h-2.5" />
                        }
                        {Math.abs(variation).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-8 flex flex-col h-[700px] overflow-hidden bg-slate-50/15 dark:bg-slate-950/5">

          {/* Right Header */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 space-y-2.5">
            {/* Top row: date label + actions */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-450" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                  {selectedDate
                    ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase()
                    : 'SELECIONE UMA DATA'}
                </span>
                {loading && <RefreshCw className="w-3.5 h-3.5 text-slate-450 animate-spin" />}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {selectedDate && (
                  <button
                    onClick={handlePrintFechamento}
                    title="Imprimir Fechamento do Dia"
                    className="p-1.5 border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 transition rounded-none cursor-pointer bg-white dark:bg-slate-900"
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={handleExportCSV}
                  title="Exportar CSV"
                  className="p-1.5 border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900 transition rounded-none cursor-pointer bg-white dark:bg-slate-900"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Macro Totalizers Grid */}
            {selectedDateEntries.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                {/* 1. DINHEIRO */}
                <button
                  type="button"
                  onClick={() => {
                    setFilterForma(prev => prev === 'DINHEIRO' ? 'TODOS' : 'DINHEIRO');
                    setFilterBandeira('TODOS');
                  }}
                  className={`flex flex-col items-start p-3 border rounded-xl text-left transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${
                    filterForma === 'DINHEIRO'
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                      : 'border-slate-100 bg-slate-50/40 dark:border-slate-800/20 dark:bg-slate-900/10 hover:border-emerald-200'
                  }`}
                >
                  <div className="flex justify-between items-center w-full text-slate-450 dark:text-slate-500">
                    <span className="text-[9px] font-black uppercase tracking-wider">Dinheiro</span>
                    <span className="text-xs">💵</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-1.5 w-full justify-between">
                    <span className="text-base font-mono font-black text-slate-900 dark:text-white font-semibold">
                      {BRL.format(dailyTotals.dinheiro.valor)}
                    </span>
                    {renderTrend('dinheiro')}
                  </div>
                  <span className="text-[9px] text-slate-400 font-semibold mt-1">
                    {dailyTotals.dinheiro.count} {dailyTotals.dinheiro.count === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                </button>

                {/* 2. PIX */}
                <button
                  type="button"
                  onClick={() => {
                    setFilterForma(prev => prev === 'PIX' ? 'TODOS' : 'PIX');
                    setFilterBandeira('TODOS');
                  }}
                  className={`flex flex-col items-start p-3 border rounded-xl text-left transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${
                    filterForma === 'PIX'
                      ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/30'
                      : 'border-slate-100 bg-slate-50/40 dark:border-slate-800/20 dark:bg-slate-900/10 hover:border-sky-200'
                  }`}
                >
                  <div className="flex justify-between items-center w-full text-slate-450 dark:text-slate-500">
                    <span className="text-[9px] font-black uppercase tracking-wider">PIX</span>
                    <span className="text-xs">📱</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-1.5 w-full justify-between">
                    <span className="text-base font-mono font-black text-slate-900 dark:text-white font-semibold">
                      {BRL.format(dailyTotals.pix.valor)}
                    </span>
                    {renderTrend('pix')}
                  </div>
                  <span className="text-[9px] text-slate-400 font-semibold mt-1">
                    {dailyTotals.pix.count} {dailyTotals.pix.count === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                </button>

                {/* 3. DÉBITO */}
                <div
                  onClick={() => {
                    setFilterForma(prev => prev === 'DEBITO' ? 'TODOS' : 'DEBITO');
                    setFilterBandeira('TODOS');
                  }}
                  className={`flex flex-col items-start p-3 border rounded-xl text-left transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${
                    filterForma === 'DEBITO'
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                      : 'border-slate-100 bg-slate-50/40 dark:border-slate-800/20 dark:bg-slate-900/10 hover:border-blue-200'
                  }`}
                >
                  <div className="flex justify-between items-center w-full text-slate-450 dark:text-slate-500">
                    <span className="text-[9px] font-black uppercase tracking-wider">Cartão Débito</span>
                    <span className="text-xs">💳</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-1.5 w-full justify-between">
                    <span className="text-base font-mono font-black text-slate-900 dark:text-white font-semibold">
                      {BRL.format(dailyTotals.debito.valor)}
                    </span>
                    {renderTrend('debito')}
                  </div>
                  <span className="text-[9px] text-slate-400 font-semibold mt-1">
                    {dailyTotals.debito.count} {dailyTotals.debito.count === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                  
                  {/* Brand Breakdown for Debit */}
                  {Object.entries(dailyTotals.debito.brands).length > 0 && (
                    <div className="w-full mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 flex flex-wrap gap-1">
                      {Object.entries(dailyTotals.debito.brands).map(([brand, val]) => {
                        const isSelectedBrand = filterForma === 'DEBITO' && filterBandeira === brand;
                        return (
                          <button
                            key={brand}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterForma('DEBITO');
                              setFilterBandeira(prev => prev === brand ? 'TODOS' : brand);
                            }}
                            className={`px-1.5 py-0.5 text-[8px] font-black rounded uppercase transition ${
                              isSelectedBrand
                                ? 'bg-blue-600 text-white dark:bg-blue-500'
                                : 'bg-blue-50 hover:bg-blue-100 text-blue-750 dark:bg-blue-950/40 dark:text-blue-300'
                            }`}
                          >
                            {brand} {BRL.format(val)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. CRÉDITO */}
                <div
                  onClick={() => {
                    setFilterForma(prev => prev === 'CREDITO' ? 'TODOS' : 'CREDITO');
                    setFilterBandeira('TODOS');
                  }}
                  className={`flex flex-col items-start p-3 border rounded-xl text-left transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer ${
                    filterForma === 'CREDITO'
                      ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/30'
                      : 'border-slate-100 bg-slate-50/40 dark:border-slate-800/20 dark:bg-slate-900/10 hover:border-violet-200'
                  }`}
                >
                  <div className="flex justify-between items-center w-full text-slate-450 dark:text-slate-500">
                    <span className="text-[9px] font-black uppercase tracking-wider">Cartão Crédito</span>
                    <span className="text-xs">💳</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-1.5 w-full justify-between">
                    <span className="text-base font-mono font-black text-slate-900 dark:text-white font-semibold">
                      {BRL.format(dailyTotals.credito.valor)}
                    </span>
                    {renderTrend('credito')}
                  </div>
                  <span className="text-[9px] text-slate-400 font-semibold mt-1">
                    {dailyTotals.credito.count} {dailyTotals.credito.count === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                  
                  {/* Brand Breakdown for Credit */}
                  {Object.entries(dailyTotals.credito.brands).length > 0 && (
                    <div className="w-full mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 flex flex-wrap gap-1">
                      {Object.entries(dailyTotals.credito.brands).map(([brand, val]) => {
                        const isSelectedBrand = filterForma === 'CREDITO' && filterBandeira === brand;
                        return (
                          <button
                            key={brand}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterForma('CREDITO');
                              setFilterBandeira(prev => prev === brand ? 'TODOS' : brand);
                            }}
                            className={`px-1.5 py-0.5 text-[8px] font-black rounded uppercase transition ${
                              isSelectedBrand
                                ? 'bg-violet-600 text-white dark:bg-violet-500'
                                : 'bg-violet-50 hover:bg-violet-100 text-violet-750 dark:bg-violet-950/40 dark:text-violet-300'
                            }`}
                          >
                            {brand} {BRL.format(val)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 5. SALDO DO DIA */}
                <button
                  type="button"
                  onClick={() => {
                    setFilterTipo('TODOS');
                    setFilterForma('TODOS');
                    setFilterBandeira('TODOS');
                  }}
                  className={`flex flex-col items-start p-3 border rounded-xl text-left transition-all hover:-translate-y-0.5 hover:shadow-sm cursor-pointer col-span-2 lg:col-span-1 ${
                    filterTipo === 'TODOS' && filterForma === 'TODOS'
                      ? 'border-slate-400 bg-slate-100/50 dark:bg-slate-800/40 dark:border-slate-700'
                      : 'border-slate-100 bg-slate-50/40 dark:border-slate-800/20 dark:bg-slate-900/10 hover:border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-center w-full text-slate-450 dark:text-slate-500">
                    <span className="text-[9px] font-black uppercase tracking-wider">Saldo do Dia</span>
                    <span className="text-xs">📈</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mt-1.5 w-full justify-between">
                    <span className={`text-base font-mono font-black ${dailyTotals.saldo >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-450'}`}>
                      {BRL.format(dailyTotals.saldo)}
                    </span>
                    {renderTrend('total')}
                  </div>
                  <div className="text-[9px] text-slate-400 font-semibold mt-1 space-y-0.5">
                    <div>Entradas: {BRL.format(dailyTotals.entradas)}</div>
                    {dailyTotals.saidas > 0 && <div className="text-rose-500">Saídas: -{BRL.format(dailyTotals.saidas)}</div>}
                  </div>
                </button>
              </div>
            )}

            {/* Search + Filter chips */}
            <div className="space-y-1.5">
              {/* Search bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por descrição ou bandeira..."
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 text-xs border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-white outline-none focus:border-slate-400 rounded-none"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Chip rows */}
              <div className="flex flex-wrap gap-1.5 items-center">
                {/* Tipo */}
                {(['TODOS', 'ENTRADA', 'SAIDA'] as FilterTipo[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setFilterTipo(t)}
                    className={`px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer ${
                      filterTipo === t
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                        : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                    }`}
                  >
                    {t === 'TODOS' ? 'Tipo: Todos' : t === 'ENTRADA' ? 'Entrada' : 'Saída'}
                  </button>
                ))}

                <span className="text-slate-300 dark:text-slate-700 text-xs">|</span>

                {/* Forma */}
                {([
                  ['TODOS', 'Forma: Todas'],
                  ['DINHEIRO', 'Dinheiro'],
                  ['PIX', 'PIX'],
                  ['DEBITO', 'Débito'],
                  ['CREDITO', 'Crédito'],
                ] as [FilterForma, string][]).map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setFilterForma(f)}
                    className={`px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer ${
                      filterForma === f
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                        : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <span className="text-slate-300 dark:text-slate-700 text-xs">|</span>

                {/* Conciliado */}
                {([
                  ['TODOS', 'Status: Todos'],
                  ['SIM', '✅ Conciliado'],
                  ['NAO', '⏳ Pendente'],
                ] as [FilterConciliado, string][]).map(([c, label]) => (
                  <button
                    key={c}
                    onClick={() => setFilterConciliado(c)}
                    className={`px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer ${
                      filterConciliado === c
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:border-slate-200'
                        : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                {activeFilterCount > 0 && (
                  <button
                    onClick={resetFilters}
                    className="px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900"
                  >
                    × {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''} ativos
                  </button>
                )}
              </div>

              {/* Bandeira chips dinâmicos, só aparecem quando há cartões */}
              {availableBandeiras.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center pt-1 border-t border-slate-100 dark:border-slate-800/40">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Bandeira:</span>
                  <button
                    onClick={() => setFilterBandeira('TODOS')}
                    className={`px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer ${
                      filterBandeira === 'TODOS'
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900'
                        : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                    }`}
                  >
                    Todas
                  </button>
                  {availableBandeiras.map(brand => (
                    <button
                      key={brand}
                      onClick={() => setFilterBandeira(prev => prev === brand ? 'TODOS' : brand)}
                      className={`px-2 py-0.5 text-[10px] font-bold border rounded-full transition cursor-pointer ${
                        filterBandeira === brand
                          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-200 dark:text-slate-900'
                          : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-800 hover:border-slate-400'
                      }`}
                    >
                      {brand}
                    </button>
                  ))}
                </div>
              )}

              {/* Summary row */}
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <div className="flex items-center gap-2">
                  {/* Select all checkbox */}
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 transition"
                  >
                    <div className={`w-3.5 h-3.5 border flex items-center justify-center rounded-[2px] ${allSelected ? 'bg-slate-900 border-slate-900 dark:bg-slate-200 dark:border-slate-200' : 'border-slate-300 dark:border-slate-700'}`}>
                      {allSelected && <span className="text-white dark:text-slate-900 text-[9px] font-black leading-none">✓</span>}
                    </div>
                    <span>Selecionar todos</span>
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <span>Exibindo {filteredEntries.length} de {selectedDateEntries.length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Transaction List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredEntries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-none">
                <AlertCircle className="w-8 h-8 text-slate-350" />
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  {selectedDateEntries.length > 0 ? 'Nenhum resultado para os filtros ativos' : 'Nenhum lançamento registrado'}
                </h3>
                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="text-xs text-blue-500 underline cursor-pointer">
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              filteredEntries.map((item) => {
                const isChecked = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2.5 p-3 border bg-white dark:bg-slate-900 rounded-none hover:border-slate-300 dark:hover:border-slate-700 transition ${
                      isChecked ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-800'
                    } ${item.conciliado ? 'border-l-4 border-l-emerald-500' : ''}`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleSelect(item.id)}
                      className="shrink-0 cursor-pointer"
                    >
                      <div className={`w-4 h-4 border flex items-center justify-center rounded-[2px] transition ${
                        isChecked
                          ? 'bg-slate-900 border-slate-900 dark:bg-slate-200 dark:border-slate-200'
                          : 'border-slate-300 dark:border-slate-700 hover:border-slate-500'
                      }`}>
                        {isChecked && <span className="text-white dark:text-slate-900 text-[10px] font-black leading-none">✓</span>}
                      </div>
                    </button>

                    {/* Content */}
                    <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border rounded-none shrink-0 ${
                          item.tipo === 'ENTRADA'
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-200 dark:border-emerald-900/50'
                            : 'bg-rose-50 dark:bg-rose-950/20 text-rose-500 border-rose-200 dark:border-rose-900/50'
                        }`}>
                          {item.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'}
                        </span>
                        <div className="space-y-0.5 min-w-0">
                          <h4 className="text-sm font-bold text-slate-850 dark:text-white leading-none truncate">
                            {item.descricao}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-slate-450 flex-wrap">
                            <span className="font-mono bg-slate-105 dark:bg-slate-800 px-1 py-0.5 text-[10px]">{item.forma_pagamento}</span>
                            {(item.forma_pagamento.includes('CREDITO') || item.forma_pagamento.includes('DEBITO')) && (
                              <>
                                <span className="font-semibold uppercase">{item.bandeira}</span>
                                {item.parcelas > 1 && <span>{item.parcelas}x</span>}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 justify-between md:justify-end">
                        <span className="text-sm font-mono font-bold text-slate-850 dark:text-white">
                          {BRL.format(item.valor)}
                        </span>

                        <div className="flex items-center gap-1.5 border-l border-slate-150 dark:border-slate-850 pl-3">
                          {item.conciliado ? (
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 border border-emerald-200 dark:border-emerald-900/50 rounded-none">
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>CONCILIADO</span>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenDrawer(item.tipo, item)}
                                className="p-1.5 border border-slate-205 dark:border-slate-800 text-slate-550 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-950 transition rounded-none cursor-pointer bg-white dark:bg-slate-900"
                                title="Editar"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMovimentacao(item)}
                                className="p-1.5 border border-slate-205 dark:border-slate-800 text-rose-500 hover:bg-slate-50 dark:hover:bg-slate-950 transition rounded-none cursor-pointer bg-white dark:bg-slate-900"
                                title="Excluir"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Sticky Totals Footer */}
          <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 shrink-0">
            <div className="flex items-center justify-between text-[11px] font-mono flex-wrap gap-2">
              <div className="flex items-center gap-4">
                <span className="text-slate-400">
                  {activeFilterCount > 0 ? `Filtrando ${filteredEntries.length}/${selectedDateEntries.length}` : `${filteredEntries.length} lançamentos`}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-emerald-600 font-bold">
                  Ent: {BRL.format(stickyTotals.entradas)}
                </span>
                <span className="text-rose-500 font-bold">
                  Saí: {BRL.format(stickyTotals.saidas)}
                </span>
                <span className={`font-black ${stickyTotals.saldo >= 0 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-500'}`}>
                  Saldo: {BRL.format(stickyTotals.saldo)}
                </span>
              </div>
            </div>
          </div>

          {/* Batch Action Bar */}
          {selectedIds.size > 0 && (
            <div className="border-t-2 border-slate-900 dark:border-slate-300 bg-slate-900 dark:bg-slate-100 px-4 py-2.5 shrink-0 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-slate-400 hover:text-white dark:hover:text-slate-900 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-white dark:text-slate-900">
                  {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
                  {batchTotal > 0 && <span className="text-slate-400 dark:text-slate-600 ml-2 font-mono">{BRL.format(batchTotal)}</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 text-[11px] font-bold border border-slate-600 dark:border-slate-400 text-slate-300 dark:text-slate-700 hover:bg-slate-800 dark:hover:bg-slate-200 transition rounded-none cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  Exportar
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={saving}
                  className="px-3 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white border-none transition rounded-none cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Drawer: Registrar Sangria */}
      {showSangriaDrawer && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 transition-opacity"
            onClick={() => !saving && setShowSangriaDrawer(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250 rounded-none">

            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/20 dark:bg-slate-950/10">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Registrar Sangria do Caixa
                </h2>
                <p className="text-slate-500 dark:text-slate-455 text-[11px]">
                  Retirada de caixa e transferência para conta bancária
                </p>
              </div>
              <button
                type="button"
                onClick={() => !saving && setShowSangriaDrawer(false)}
                className="p-1.5 rounded-none border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-655 cursor-pointer bg-transparent"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveSangria} className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* Data da Sangria */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Data da Sangria *</label>
                <div className="relative">
                  <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    required
                    disabled={saving}
                    value={sangriaData}
                    onChange={(e) => setSangriaData(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-rose-500 transition disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Valor */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Valor *</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">R$</span>
                  <input
                    type="text"
                    required
                    placeholder="0,00 ou 10+5"
                    disabled={saving}
                    value={sangriaValorText}
                    onChange={(e) => {
                      const cleanExpr = e.target.value.replace(/\./g, '').replace(/,/g, '');
                      setSangriaValorText(formatExpressionCentsFirst(cleanExpr));
                    }}
                    onBlur={handleSangriaValorBlur}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSangriaValorBlur(); }}
                    className="w-full pl-9 pr-4 py-3 rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-rose-500 transition disabled:opacity-50 font-mono"
                  />
                </div>
              </div>

              {/* Saldo de Caixa */}
              {dailyTotals && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-350">
                  <span>Dinheiro em Caixa (Hoje):</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-450">{BRL.format(dailyTotals.dinheiro.valor)}</span>
                </div>
              )}

              {/* Aviso de Saldo Insuficiente */}
              {dailyTotals && Number(sangriaValor) > dailyTotals.dinheiro.valor && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-250 dark:border-amber-900/50 rounded-2xl flex items-start gap-2.5 text-[11px] font-bold text-amber-800 dark:text-amber-400">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
                  <span className="leading-relaxed">Atenção: O valor informado é maior que o saldo de dinheiro físico disponível em caixa hoje ({BRL.format(dailyTotals.dinheiro.valor)}).</span>
                </div>
              )}

              {/* Conta / Banco de Destino (Botões) */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Conta / Banco de Destino *</label>
                <div className="grid grid-cols-2 gap-2">
                  {contas.filter(c => c.id !== pdvConfig?.pdv_conta_padrao_id).map((c) => {
                    const isSelected = sangriaContaDestinoId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSangriaContaDestinoId(c.id)}
                        className={`p-3.5 border rounded-2xl flex flex-col items-center justify-center transition cursor-pointer text-center select-none ${
                          isSelected
                            ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/20 dark:border-rose-500 dark:text-rose-450 font-black ring-2 ring-rose-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-350 dark:bg-slate-950 dark:border-slate-800 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 font-bold'
                        }`}
                      >
                        <span className="text-xs">{c.nome}</span>
                        {c.banco && <span className="text-[10px] opacity-60 mt-0.5">{c.banco}</span>}
                      </button>
                    );
                  })}
                </div>
                {contas.filter(c => c.id !== pdvConfig?.pdv_conta_padrao_id).length === 0 && (
                  <p className="text-xs text-rose-500 font-bold">Nenhum banco ou conta cadastrada de destino (excluindo a conta caixa do PDV).</p>
                )}
              </div>

            </form>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0 bg-slate-50/20 dark:bg-slate-950/10">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowSangriaDrawer(false)}
                className="px-5 py-2.5 text-xs font-bold text-slate-655 dark:text-slate-455 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border-none bg-transparent disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveSangria}
                className="px-6 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-sm border-none cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Registrando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Salvar Sangria</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </>
      )}

      {/* Drawer: Add/Edit Entry Form */}
      {showDrawer && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 transition-opacity"
            onClick={() => !saving && setShowDrawer(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250 rounded-none">

            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/20 dark:bg-slate-950/10">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {editingMov ? 'Editar Movimentação' : `Registrar ${formTipo === 'ENTRADA' ? 'Entrada / Venda' : 'Saída / Sangria'}`}
                </h2>
                <p className="text-slate-500 dark:text-slate-450 text-[11px]">
                  Frente de Caixa{companyName ? ` — Filial ${companyName}` : ''}
                </p>
              </div>
              <button
                onClick={() => !saving && setShowDrawer(false)}
                className="p-1.5 rounded-none border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-slate-655 cursor-pointer bg-transparent"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveMovimentacao} className="flex-1 overflow-y-auto p-6 space-y-5">

              {/* Informações de Auditoria: Criador da Venda / Movimentação */}
              {editingMov && (editingMov.criador_nome || editingMov.data_criacao || editingMov.created_at || editingMov.id_parcelamento) && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-none space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-blue-500" />
                      Auditoria de Criação
                    </span>
                    {editingMov.id_parcelamento ? (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50 rounded-none">
                        Origem: Venda PDV
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-none">
                        Lançamento Manual
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 text-xs">
                    {/* Criado por (Nome e Email) */}
                    <div className="flex items-start gap-2.5 bg-white dark:bg-slate-900 p-2.5 border border-slate-150 dark:border-slate-800/80">
                      <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                        {editingMov.criador_nome ? editingMov.criador_nome.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-800 dark:text-white truncate">
                          {editingMov.criador_nome || 'Usuário não identificado'}
                        </div>
                        {editingMov.criador_email ? (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate font-mono">
                            <Mail className="w-3 h-3 shrink-0 text-slate-400" />
                            {editingMov.criador_email}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 italic">Email não disponível</div>
                        )}
                      </div>
                    </div>

                    {/* Data e Hora */}
                    <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-2.5 py-2 border border-slate-150 dark:border-slate-800/80 text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1 font-medium">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Criado em:
                      </span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        {formatAuditDateTime(editingMov.data_criacao, editingMov.hora_criacao, editingMov.created_at || editingMov.data)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tipo */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tipo *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setFormTipo('ENTRADA'); if (formDescricao === 'Sangria / Retirada') setFormDescricao('Venda Frente de Caixa'); }}
                    className={`py-3 flex items-center justify-center gap-2 border font-bold text-xs cursor-pointer rounded-none transition ${
                      formTipo === 'ENTRADA'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-700 dark:text-emerald-400'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-850'
                    }`}
                  >
                    <PlusCircle className="w-4 h-4 text-emerald-650" />
                    <span>Entrada</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setFormTipo('SAIDA'); if (formDescricao === 'Venda Frente de Caixa') setFormDescricao('Sangria / Retirada'); }}
                    className={`py-3 flex items-center justify-center gap-2 border font-bold text-xs cursor-pointer rounded-none transition ${
                      formTipo === 'SAIDA'
                        ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/20 dark:border-rose-700 dark:text-rose-400'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-850'
                    }`}
                  >
                    <MinusCircle className="w-4 h-4 text-rose-650" />
                    <span>Saída</span>
                  </button>
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Descrição *</label>
                <input
                  type="text"
                  value={formDescricao}
                  onChange={(e) => setFormDescricao(e.target.value)}
                  className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                  required
                />
              </div>

              {/* Valor */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Valor R$ *</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formValor}
                  onChange={(e) => setFormValor(e.target.value)}
                  className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono font-bold"
                  required
                />
              </div>

              {/* Data */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Data do Registro *</label>
                <input
                  type="date"
                  value={formData}
                  onChange={(e) => setFormData(e.target.value)}
                  className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                  required
                />
              </div>

              {/* Centro de Custo */}
              {(!pdvConfig || (pdvConfig.pdv_centro_custo_flexivel ?? pdvConfig.centro_custo_flexivel) !== false || !(pdvConfig.pdv_centro_custo_padrao_id ?? pdvConfig.centro_custo_padrao_id)) && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Centro de Custo *</label>
                  {(pdvConfig?.pdv_centro_custo_flexivel ?? pdvConfig?.centro_custo_flexivel) ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {centrosCusto.map((cc) => {
                        const isSelected = String(formCentroCustoId) === String(cc.id);
                        return (
                          <button
                            key={cc.id}
                            type="button"
                            onClick={() => setFormCentroCustoId(String(cc.id))}
                            className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                              isSelected
                                ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/20 dark:border-rose-700 dark:text-rose-400'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-350 dark:hover:bg-slate-900'
                            }`}
                          >
                            {cc.nome}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <SearchableSelect
                      options={[{ label: 'Centros', options: centrosCusto.map(cc => ({ id: String(cc.id), label: cc.nome })) }]}
                      value={formCentroCustoId}
                      onChange={(v) => setFormCentroCustoId(String(v))}
                      placeholder="Selecione..."
                    />
                  )}
                </div>
              )}

              {/* Conta */}
              {!pdvConfig?.pdv_conta_padrao_id && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Conta / Caixa *</label>
                  <SearchableSelect
                    options={[{ label: 'Contas', options: contas.map(c => ({ id: String(c.id), label: c.nome })) }]}
                    value={formContaId}
                    onChange={(v) => setFormContaId(String(v))}
                    placeholder="Selecione..."
                  />
                </div>
              )}

              {/* Forma de Pagamento (apenas ENTRADA) */}
              {formTipo === 'ENTRADA' && (
                <>
                  <div className="space-y-2 mt-4">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Forma de Pagamento *</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'DINHEIRO', label: 'Dinheiro' },
                        { id: 'PIX', label: 'Pix' },
                        { id: 'DEBITO', label: 'Cartão de Débito' },
                        { id: 'CREDITO_AVISTA', label: 'Crédito à Vista' },
                        { id: 'CREDITO_PARCELADO', label: 'Crédito Parcelado' }
                      ].map(forma => (
                        <button
                          key={forma.id}
                          type="button"
                          onClick={() => {
                            const val = forma.id;
                            setFormFormaPagamento(val);
                            if (!val.includes('CREDITO') && !val.includes('DEBITO')) {
                              setFormBandeira('');
                              setFormParcelas(1);
                            }
                          }}
                          className={`px-3 py-2 border rounded-md text-xs font-medium transition-all ${
                            formFormaPagamento === forma.id 
                              ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 ring-1 ring-blue-500' 
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {forma.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(formFormaPagamento === 'DEBITO' || formFormaPagamento.startsWith('CREDITO')) && (
                    <div className="space-y-2 mt-4">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Bandeira *</label>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {[
                          { id: 'VISA', label: 'Visa' },
                          { id: 'MASTERCARD', label: 'Mastercard' },
                          { id: 'ELO', label: 'Elo' },
                          { id: 'HIPERCARD', label: 'Hipercard' },
                          { id: 'AMEX', label: 'Amex' }
                        ].map(bandeira => (
                          <button
                            key={bandeira.id}
                            type="button"
                            onClick={() => setFormBandeira(bandeira.id)}
                            className={`px-3 py-2 border rounded-md text-xs font-medium transition-all ${
                              formBandeira === bandeira.id 
                                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400 ring-1 ring-blue-500' 
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                            }`}
                          >
                            {bandeira.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {formFormaPagamento === 'CREDITO_PARCELADO' && (
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Número de Parcelas *</label>
                      <input
                        type="number"
                        min="2"
                        max="12"
                        value={formParcelas}
                        onChange={(e) => setFormParcelas(Number(e.target.value))}
                        className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white font-mono"
                        required
                      />
                    </div>
                  )}
                </>
              )}
            </form>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/20 dark:bg-slate-950/10 shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowDrawer(false)}
                className="px-5 py-2.5 border border-slate-205 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-400 hover:bg-slate-50 transition cursor-pointer rounded-none font-bold text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                onClick={handleSaveMovimentacao}
                className="px-6 py-2.5 bg-slate-900 text-white hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 border-none transition rounded-none font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Gravando...' : 'Salvar Registro'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
