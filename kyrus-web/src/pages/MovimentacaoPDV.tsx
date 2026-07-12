// kyrus-web/src/pages/MovimentacaoPDV.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Plus, Calendar, DollarSign, Trash2, Edit, CheckCircle, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
  X, PlusCircle, MinusCircle
} from 'lucide-react';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface MovimentacaoPDV {
  id: number;
  id_parcelamento?: string | null;
  tipo: 'ENTRADA' | 'SAIDA';
  descricao: string;
  valor: number;
  forma_pagamento: string;
  bandeira: string;
  parcelas: number;
  data: string;
  centro_custo_id?: number | null;
  conta_id?: number | null;
  conciliado: boolean;
}

export function MovimentacaoPDV() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [movimentacoes, setMovimentacoes] = useState<MovimentacaoPDV[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Selection & Dates
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentYearMonth, setCurrentYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
  });

  // Drawer Form State
  const [showDrawer, setShowDrawer] = useState(false);
  const [editingMov, setEditingMov] = useState<MovimentacaoPDV | null>(null);
  
  const [formTipo, setFormTipo] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [formDescricao, setFormDescricao] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formFormaPagamento, setFormFormaPagamento] = useState('DINHEIRO');
  const [formBandeira, setFormBandeira] = useState('OUTROS');
  const [formParcelas, setFormParcelas] = useState(1);
  const [formData, setFormData] = useState('');
  const [formCentroCustoId, setFormCentroCustoId] = useState('');
  const [formContaId, setFormContaId] = useState('');

  // Dropdowns Lists
  const [centrosCusto, setCentrosCusto] = useState<any[]>([]);
  const [contas, setContas] = useState<any[]>([]);
  const [pdvConfig, setPdvConfig] = useState<any>(null);

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  const [companyName, setCompanyName] = useState('Umarizal');

  // Load lists
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
      if (pdvCcId) {
        setFormCentroCustoId(String(pdvCcId));
      } else if (ccData.length > 0) {
        setFormCentroCustoId(String(ccData[0].id));
      }
      
      const contasData = normalizeListResponse<any>(resContas.data);
      setContas(contasData);
      
      // Default selections
      if (configData?.pdv_conta_padrao_id) {
        setFormContaId(String(configData.pdv_conta_padrao_id));
      } else if (contasData.length > 0) {
        setFormContaId(String(contasData[0].id));
      }

      if (user?.empresa_id) {
        const resEmp = await api.get(`/empresas/${user.empresa_id}`);
        if (resEmp.data && resEmp.data.nome_fantasia) {
          setCompanyName(resEmp.data.nome_fantasia);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar dados auxiliares:', err);
    }
  };

  const fetchMovimentacoes = async (monthStr?: string, forceSelectedDate?: string) => {
    setLoading(true);
    try {
      const res = await api.get('/pdv/movimentacoes', {
        params: monthStr ? { mes: monthStr } : {}
      });
      const list = normalizeListResponse<MovimentacaoPDV>(res.data);
      setMovimentacoes(list);

      const targetSelectedDate = forceSelectedDate !== undefined ? forceSelectedDate : selectedDate;

      // Select latest available date of active month if not set
      if (list.length > 0 && !targetSelectedDate) {
        const sorted = [...list].sort((a, b) => b.data.localeCompare(a.data));
        const latestDate = sorted[0].data;
        setSelectedDate(latestDate);
        setCurrentYearMonth(latestDate.substring(0, 7)); // YYYY-MM
      } else if (!targetSelectedDate) {
        const todayStr = new Date().toISOString().split('T')[0];
        setSelectedDate(todayStr);
        setCurrentYearMonth(todayStr.substring(0, 7));
      } else {
        setSelectedDate(targetSelectedDate);
        if (monthStr) {
          setCurrentYearMonth(monthStr);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar movimentações:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedDate('');
    void fetchMetadata();
    void fetchMovimentacoes(undefined, '');
  }, [user?.empresa_id]);

  // Filter dates of current month
  const monthlyDates = useMemo(() => {
    const datesMap: Record<string, { entradas: number; saidas: number; count: number }> = {};
    
    // Fill all dates in the selected month up to today
    const [year, month] = currentYearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    
    for (let day = 1; day <= lastDay; day++) {
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      datesMap[dStr] = { entradas: 0, saidas: 0, count: 0 };
    }

    movimentacoes.forEach(m => {
      if (m.data.startsWith(currentYearMonth)) {
        if (!datesMap[m.data]) {
          datesMap[m.data] = { entradas: 0, saidas: 0, count: 0 };
        }
        if (m.tipo === 'ENTRADA') {
          datesMap[m.data].entradas += Number(m.valor);
        } else {
          datesMap[m.data].saidas += Number(m.valor);
        }
        datesMap[m.data].count += 1;
      }
    });

    return Object.entries(datesMap)
      .map(([date, info]) => ({
        date,
        entradas: info.entradas,
        saidas: info.saidas,
        saldo: info.entradas - info.saidas,
        count: info.count
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [movimentacoes, currentYearMonth]);

  // Selected date entries
  const selectedDateEntries = useMemo(() => {
    if (!selectedDate) return [];
    return movimentacoes.filter(m => m.data === selectedDate);
  }, [movimentacoes, selectedDate]);

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1);
    const newYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    setCurrentYearMonth(newYm);
    setSelectedDate(`${newYm}-01`);
    void fetchMovimentacoes(newYm, `${newYm}-01`);
  };

  const handleNextMonth = () => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const nextDate = new Date(year, month, 1);
    const newYm = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    setCurrentYearMonth(newYm);
    setSelectedDate(`${newYm}-01`);
    void fetchMovimentacoes(newYm, `${newYm}-01`);
  };

  const formattedMonthLabel = useMemo(() => {
    const [year, month] = currentYearMonth.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  }, [currentYearMonth]);

  // Form submit handler
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
      setFormFormaPagamento('DINHEIRO');
      setFormBandeira('OUTROS');
      setFormParcelas(1);
      setFormData(selectedDate || new Date().toISOString().split('T')[0]);
      const pdvCcId = pdvConfig?.pdv_centro_custo_padrao_id ?? pdvConfig?.centro_custo_padrao_id;
      if (pdvCcId) {
        setFormCentroCustoId(String(pdvCcId));
      } else if (centrosCusto.length > 0) {
        setFormCentroCustoId(String(centrosCusto[0].id));
      }
      if (pdvConfig?.pdv_conta_padrao_id) {
        setFormContaId(String(pdvConfig.pdv_conta_padrao_id));
      } else if (contas.length > 0) {
        setFormContaId(String(contas[0].id));
      }
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
        alert('Movimentação atualizada com sucesso!');
      } else {
        await api.post('/pdv/movimentacoes', payload);
        alert('Movimentação registrada com sucesso!');
      }

      setShowDrawer(false);
      await fetchMovimentacoes(currentYearMonth, selectedDate);
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
    if (!confirm('Deseja realmente excluir esta movimentação? Todas as parcelas associadas também serão apagadas.')) {
      return;
    }

    setSaving(true);
    try {
      await api.delete(`/pdv/movimentacoes/${item.id}`);
      alert('Movimentação excluída com sucesso.');
      await fetchMovimentacoes(currentYearMonth, selectedDate);
    } catch (err: any) {
      console.error('Erro ao excluir:', err);
      alert(err?.response?.data?.detail || 'Erro ao excluir movimentação.');
    } finally {
      setSaving(false);
    }
  };

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
              Lançamentos rápidos de caixa, fechamento de turno e vendas na filial {companyName}.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
        <div className="lg:col-span-4 flex flex-col h-[650px] overflow-hidden">
          {/* Calendar Selector Header */}
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
              
              return (
                <div
                  key={item.date}
                  onClick={() => setSelectedDate(item.date)}
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

                  <div className="text-right">
                    {item.saldo !== 0 ? (
                      <span className={`text-xs font-mono font-bold ${item.saldo > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {item.saldo > 0 ? '+' : ''}{BRL.format(item.saldo)}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-slate-400">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Transaction List for selected date */}
        <div className="lg:col-span-8 flex flex-col h-[650px] overflow-hidden bg-slate-50/15 dark:bg-slate-950/5">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-450" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                MOVIMENTAÇÕES EM: {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR') : 'Selecione uma data'}
              </span>
            </div>
            {loading && <RefreshCw className="w-4 h-4 text-slate-450 animate-spin" />}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selectedDateEntries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-none">
                <AlertCircle className="w-8 h-8 text-slate-350" />
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Nenhum lançamento registrado</h3>
                <p className="text-slate-405 dark:text-slate-500 text-xs max-w-xs leading-relaxed">
                  Use os botões no topo para registrar as entradas e saídas de caixa da {companyName} para este dia.
                </p>
              </div>
            ) : (
              selectedDateEntries.map((item) => (
                <div 
                  key={item.id}
                  className={`flex flex-col md:flex-row md:items-center justify-between p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-none hover:border-slate-300 dark:hover:border-slate-700 transition gap-4 ${
                    item.conciliado ? 'border-l-4 border-l-emerald-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border rounded-none ${
                      item.tipo === 'ENTRADA'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border-emerald-200 dark:border-emerald-900/50'
                        : 'bg-rose-50 dark:bg-rose-950/20 text-rose-500 border-rose-200 dark:border-rose-900/50'
                    }`}>
                      {item.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'}
                    </span>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-slate-850 dark:text-white leading-none">
                        {item.descricao}
                      </h4>
                      <div className="flex items-center gap-3 text-[11px] text-slate-450 flex-wrap">
                        <span className="font-mono bg-slate-105 dark:bg-slate-800 px-1 py-0.5">{item.forma_pagamento}</span>
                        {item.forma_pagamento.includes('CREDITO') || item.forma_pagamento.includes('DEBITO') ? (
                          <>
                            <span className="font-semibold uppercase">{item.bandeira}</span>
                            {item.parcelas > 1 && <span>{item.parcelas} parcelas</span>}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end">
                    <span className="text-sm font-mono font-bold text-slate-850 dark:text-white">
                      {BRL.format(item.valor)}
                    </span>
                    
                    <div className="flex items-center gap-2 border-l border-slate-150 dark:border-slate-850 pl-4">
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
              ))
            )}
          </div>
        </div>

      </div>

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
                  Frente de Caixa — Filial {companyName}
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
              
              {/* Tipo (Entrada ou Saída) */}
              <div className="space-y-1">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Tipo *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormTipo('ENTRADA');
                      if (formDescricao === 'Sangria / Retirada') {
                        setFormDescricao('Venda Frente de Caixa');
                      }
                    }}
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
                    onClick={() => {
                      setFormTipo('SAIDA');
                      if (formDescricao === 'Venda Frente de Caixa') {
                        setFormDescricao('Sangria / Retirada');
                      }
                    }}
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

              {/* Data Lançamento */}
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
                    <select
                      value={formCentroCustoId}
                      onChange={(e) => setFormCentroCustoId(e.target.value)}
                      className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      required
                    >
                      <option value="">Selecione...</option>
                      {centrosCusto.map(cc => (
                        <option key={cc.id} value={cc.id}>{cc.nome}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Conta Caixa de Destino */}
              {!pdvConfig?.pdv_conta_padrao_id && (
                <div className="space-y-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Conta / Caixa de Registro *</label>
                  <select
                    value={formContaId}
                    onChange={(e) => setFormContaId(e.target.value)}
                    className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                    required
                  >
                    <option value="">Selecione...</option>
                    {contas.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Se for entrada: Forma de Pagamento */}
              {formTipo === 'ENTRADA' && (
                <>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Forma de Pagamento *</label>
                    <select
                      value={formFormaPagamento}
                      onChange={(e) => {
                        setFormFormaPagamento(e.target.value);
                        if (!e.target.value.includes('CREDITO') && !e.target.value.includes('DEBITO')) {
                          setFormBandeira('OUTROS');
                          setFormParcelas(1);
                        }
                      }}
                      className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                      required
                    >
                      <option value="DINHEIRO">Dinheiro</option>
                      <option value="PIX">Pix</option>
                      <option value="DEBITO">Cartão de Débito</option>
                      <option value="CREDITO_AVISTA">Cartão de Crédito à Vista</option>
                      <option value="CREDITO_PARCELADO">Cartão de Crédito Parcelado</option>
                    </select>
                  </div>

                  {/* Conditional: Bandeira (if card) */}
                  {(formFormaPagamento === 'DEBITO' || formFormaPagamento.startsWith('CREDITO')) && (
                    <div className="space-y-1">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider">Bandeira do Cartão *</label>
                      <select
                        value={formBandeira}
                        onChange={(e) => setFormBandeira(e.target.value)}
                        className="w-full rounded-none border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-slate-500 dark:border-slate-750 dark:bg-slate-950 dark:text-white"
                        required
                      >
                        <option value="VISA">Visa</option>
                        <option value="MASTERCARD">Mastercard</option>
                        <option value="ELO">Elo</option>
                        <option value="HIPERCARD">Hipercard</option>
                        <option value="AMEX">American Express</option>
                        <option value="OUTROS">Outros</option>
                      </select>
                    </div>
                  )}

                  {/* Conditional: Parcelas (if credit parcelado) */}
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

            {/* Footer buttons */}
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

// Simple internal icon component helper to prevent import clashes
function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
