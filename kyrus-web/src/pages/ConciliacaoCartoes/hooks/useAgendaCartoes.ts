import { useState, useEffect, useMemo, useRef } from 'react';
import { api, normalizeListResponse } from '../../../services/api';
import { formatSafeDate } from '../types';
import type { Recebivel, Conta } from '../types';

export function useAgendaCartoes(contas: Conta[]) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Calendar view states
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});

  const [modalityFilter, setModalityFilter] = useState<'ALL' | 'DEBITO' | 'CREDITO'>('ALL');
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const [recebiveis, setRecebiveis] = useState<Recebivel[]>([]);

  // Filters for Agenda
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  
  const getInitialMonthRange = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const format = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    return { start: format(firstDay), end: format(lastDay) };
  };
  
  const initialRange = getInitialMonthRange();
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);

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

  const handlePrevMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

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

  const fetchAgenda = async () => {
    if (recebiveis.length === 0) setLoading(true);
    else setSyncing(true);
    
    try {
      const params: Record<string, string> = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const res = await api.get('/pdv/recebiveis', { params });
      setRecebiveis(normalizeListResponse<Recebivel>(res.data));
    } catch (e) {
      console.error('Erro ao carregar recebíveis:', e);
    } finally {
      setLoading(false);
      setSyncing(false);
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

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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
      const updatePromises = credFuturos.map(r => 
        api.put(`/pdv/recebiveis/${r.id}`, {
          status: 'ANTECIPADO',
          valor_liquido: Number(r.valor_liquido || 0)
        })
      );
      await Promise.all(updatePromises);

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
        if (startDate) matchDate = matchDate && r.data_vencimento >= startDate;
        if (endDate) matchDate = matchDate && r.data_vencimento <= endDate;
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
    let bruto = 0, taxa = 0, liquido = 0;
    filteredAgenda.forEach(r => {
      bruto += Number(r.valor_bruto);
      taxa += Number(r.valor_taxa);
      liquido += Number(r.valor_liquido);
    });
    return { bruto, taxa, liquido };
  }, [filteredAgenda]);

  const agendaGroupedByDate = useMemo(() => {
    const groups: Record<string, Recebivel[]> = {};
    filteredAgenda.forEach(r => {
      const d = r.data_vencimento;
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    });
    return Object.keys(groups).sort().reverse().map(d => ({
      data: d,
      itens: groups[d],
      bruto: groups[d].reduce((sum, item) => sum + Number(item.valor_bruto), 0),
      liquido: groups[d].reduce((sum, item) => sum + Number(item.valor_liquido), 0)
    }));
  }, [filteredAgenda]);

  return {
    loading, syncing, viewMode, setViewMode, currentMonth, setCurrentMonth, selectedDay, setSelectedDay,
    expandedBrands, setExpandedBrands, modalityFilter, setModalityFilter, copyToast, setCopyToast,
    searchInputRef, showAntecipacaoModal, setShowAntecipacaoModal, antecipacaoTaxaPct, setAntecipacaoTaxaPct,
    antecipacaoDias, setAntecipacaoDias, antecipacaoLancarFinanceiro, setAntecipacaoLancarFinanceiro,
    antecipacaoContaId, setAntecipacaoContaId, antecipandoEfetivo, setAntecipandoEfetivo,
    antecipacaoDataInicio, setAntecipacaoDataInicio, antecipacaoDataFim, setAntecipacaoDataFim,
    modalRecebiveis, loadingModalRecebiveis, recebiveis, setRecebiveis, filterBrand, setFilterBrand,
    filterStatus, setFilterStatus, filterSearch, setFilterSearch, startDate, setStartDate, endDate, setEndDate,
    fetchAgenda, handleSyncFinanceiro, handleCopyWhatsAppSummary, handleEfetivarAntecipacao,
    filteredAgenda, calendarFilteredAgenda, agendaSummary, agendaGroupedByDate, calendarDays,
    handlePrevMonth, handleNextMonth
  };
}
