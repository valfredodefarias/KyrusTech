import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import ReactApexChart from 'react-apexcharts';
import ExcelJS from 'exceljs';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, Filter,
  CalendarRange, Layers, Building2, List, X
} from 'lucide-react';

interface Lancamento {
  id: number;
  descricao: string;
  valor_previsto: number;
  valor_pago: number;
  data_vencimento: string;
  data_pagamento?: string;
  tipo: 'RECEITA' | 'DESPESA' | string;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO' | string;
  plano_contas_id?: number;
  centro_custo_id?: number;
}

interface Categoria {
  id: number;
  nome: string;
  tipo: string;
}

interface CentroCusto {
  id: number;
  nome: string;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const toDateOnly = (d: Date) => d.toISOString().split('T')[0];
const toDateOnlyStr = (s?: string) => (s ? s.split('T')[0] : '');
const parseDateLocal = (s?: string) => {
  const raw = toDateOnlyStr(s);
  if (!raw) return null;
  const [y, m, d] = raw.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const formatMonthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const isReceita = (tipo?: string) => (tipo || '').toUpperCase().startsWith('R');
const isDespesa = (tipo?: string) => (tipo || '').toUpperCase().startsWith('D');
const isPago = (status?: string) => (status || '').toUpperCase() === 'PAGO';

function getMonthRange(yyyymm: string) {
  const [yearStr, monthStr] = yyyymm.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const toISO = (d: Date) => d.toISOString().split('T')[0];
  return { start: toISO(start), end: toISO(end), days: end.getDate() };
}

function getYearRange(year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const toISO = (d: Date) => d.toISOString().split('T')[0];
  return { start: toISO(start), end: toISO(end) };
}

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);

  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [periodoTipo, setPeriodoTipo] = useState<'MES' | 'ANO' | 'PERSONALIZADO'>('MES');
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [periodoIni, setPeriodoIni] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedCategorias, setSelectedCategorias] = useState<Set<number>>(new Set());
  const [selectedCentro, setSelectedCentro] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, [mes, ano, periodoIni, periodoFim, periodoTipo]);

  useEffect(() => {
    setSelectedDate(null);
    setSelectedMonth(null);
  }, [mes, ano, periodoIni, periodoFim, periodoTipo]);

  async function loadDashboard() {
    setLoading(true);
    try {
      let start: string;
      let end: string;
      if (periodoTipo === 'ANO') {
        ({ start, end } = getYearRange(ano));
      } else if (periodoTipo === 'PERSONALIZADO') {
        start = periodoIni;
        end = periodoFim;
      } else {
        ({ start, end } = getMonthRange(mes));
      }
      const [rLanc, rCats, rCentros] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 5000, data_inicio: start, data_fim: end } }),
        api.get('/plano-contas/'),
        api.get('/centro-custo/')
      ]);
      setLancamentos(rLanc.data || []);
      setCategorias(rCats.data || []);
      setCentros(rCentros.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await loadDashboard();
    } finally {
      setSyncing(false);
    }
  }

  const filteredLancamentos = useMemo(() => {
    return lancamentos.filter(l => {
      if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
      if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
      return true;
    });
  }, [lancamentos, selectedCategorias, selectedCentro, selectedDate, selectedMonth]);

  const kpis = useMemo(() => {
    let receitas = 0; let despesas = 0; let pagos = 0; let pendentes = 0;
    filteredLancamentos.forEach(l => {
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) receitas += val;
      else despesas += val;
      if (isPago(l.status)) pagos += val; else pendentes += val;
    });
    return { receitas, despesas, saldo: receitas - despesas, pagos, pendentes };
  }, [filteredLancamentos]);

  const fluxoDiario = useMemo(() => {
    if (periodoTipo === 'ANO') {
      const rec: number[] = Array(12).fill(0);
      const desp: number[] = Array(12).fill(0);
      filteredLancamentos.forEach(l => {
        const d = parseDateLocal(l.data_vencimento);
        if (!d) return;
        const idx = d.getMonth();
        const val = Number(l.valor_previsto || 0);
        if (isReceita(l.tipo)) rec[idx] += val;
        else desp[idx] += val;
      });
      const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const indexToDate = labels.map((_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
      return { labels, rec, desp, indexToDate, mode: 'MONTH' as const };
    }

    let dates: string[] = [];
    if (periodoTipo === 'PERSONALIZADO') {
      const start = new Date(periodoIni);
      const end = new Date(periodoFim);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(toDateOnly(new Date(d)));
      }
    } else {
      const { days } = getMonthRange(mes);
      dates = Array.from({ length: days }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
    }

    const rec: number[] = Array(dates.length).fill(0);
    const desp: number[] = Array(dates.length).fill(0);
    const idxMap = new Map(dates.map((d, i) => [d, i] as const));

    filteredLancamentos.forEach(l => {
      const date = toDateOnlyStr(l.data_vencimento);
      const idx = idxMap.get(date);
      if (idx === undefined) return;
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val;
      else desp[idx] += val;
    });

    const labels = dates.map(d => d.split('-')[2]);
    return { labels, rec, desp, indexToDate: dates, mode: 'DAY' as const };
  }, [filteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo]);

  const despesasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    const base = lancamentos.filter(l => {
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
      if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
      return true;
    });

    base.forEach(l => {
      if (!isDespesa(l.tipo)) return;
      const catId = Number(l.plano_contas_id);
      if (!catId) return;
      map.set(catId, (map.get(catId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cat = categorias.find(c => Number(c.id) === Number(id));
      return { id, label: cat?.nome || `Categoria ${id}`, total };
    }).sort((a, b) => b.total - a.total);

    const top = rows.slice(0, 6);
    const others = rows.slice(6).reduce((acc, r) => acc + r.total, 0);
    if (others > 0) top.push({ id: -1, label: 'Outros', total: others });
    return top;
  }, [lancamentos, categorias, selectedCentro, selectedDate, selectedMonth]);

  const despesasPorCentro = useMemo(() => {
    const map = new Map<number, number>();
    filteredLancamentos.forEach(l => {
      if (!isDespesa(l.tipo)) return;
      const ccId = Number(l.centro_custo_id);
      if (!ccId) return;
      map.set(ccId, (map.get(ccId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cc = centros.find(c => Number(c.id) === Number(id));
      return { id, label: cc?.nome || `Centro ${id}`, total };
    }).sort((a, b) => b.total - a.total);
    return rows.slice(0, 8);
  }, [filteredLancamentos, centros]);

  const contasHoje = useMemo(() => {
    const hoje = toDateOnly(new Date());
    const amanha = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));
    let start: string;
    let end: string;
    if (periodoTipo === 'ANO') {
      ({ start, end } = getYearRange(ano));
    } else if (periodoTipo === 'PERSONALIZADO') {
      start = periodoIni;
      end = periodoFim;
    } else {
      ({ start, end } = getMonthRange(mes));
    }

    const base = filteredLancamentos.filter(l => l.data_vencimento && l.data_vencimento >= start && l.data_vencimento <= end);

    const calc = (tipoCheck: (t?: string) => boolean) => {
      const hojeList = base.filter(l => l.data_vencimento === hoje && tipoCheck(l.tipo) && !isPago(l.status));
      const amanhaList = base.filter(l => l.data_vencimento === amanha && tipoCheck(l.tipo) && !isPago(l.status));
      const atrasadasList = base.filter(l => l.data_vencimento < hoje && tipoCheck(l.tipo) && !isPago(l.status));
      const totalMes = base.filter(l => tipoCheck(l.tipo)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
      const realizadas = base.filter(l => tipoCheck(l.tipo) && isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
      const emAberto = base.filter(l => tipoCheck(l.tipo) && !isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);

      return {
        hoje: hojeList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        amanha: amanhaList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        atrasadas: atrasadasList.reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0),
        totalMes,
        realizadas,
        emAberto
      };
    };

    return {
      pagar: calc(isDespesa),
      receber: calc(isReceita)
    };
  }, [filteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo, selectedDate]);

  const categoriaLancamentos = useMemo(() => {
    if (selectedCategorias.size === 0) return [] as Lancamento[];
    return filteredLancamentos
      .filter(l => selectedCategorias.has(Number(l.plano_contas_id)))
      .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 50);
  }, [filteredLancamentos, selectedCategorias]);

  const diaLancamentos = useMemo(() => {
    if (!selectedDate) return [] as Lancamento[];
    return lancamentos
      .filter(l => {
        if (toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
        if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
        if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
        return true;
      })
        .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 50);
  }, [lancamentos, selectedDate, selectedCentro, selectedCategorias]);

  const categoriasList = useMemo(() => {
    return despesasPorCategoria.map(item => ({
      ...item,
      active: selectedCategorias.has(item.id)
    }));
  }, [despesasPorCategoria, selectedCategorias]);

  const topLancamentos = useMemo(() => {
    const base = selectedDate
      ? filteredLancamentos.filter(l => toDateOnlyStr(l.data_vencimento) === selectedDate)
      : selectedMonth
        ? filteredLancamentos.filter(l => toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth))
        : filteredLancamentos;

    return [...base]
        .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .slice(0, 12);
  }, [filteredLancamentos, selectedDate, selectedMonth]);

  const exportUltimosLancamentos = async (format: 'csv' | 'xlsx') => {
    const rows = topLancamentos.map(l => ({
      data_vencimento: l.data_vencimento,
      data_pagamento: l.data_pagamento || '',
      descricao: l.descricao,
      tipo: l.tipo,
      categoria: categorias.find(c => Number(c.id) === Number(l.plano_contas_id))?.nome || '',
      entidade: '',
      banco: '',
      valor_previsto: l.valor_previsto,
      valor_pago: l.valor_pago,
      status: l.status
    }));

    if (format === 'csv') {
      const header = 'data_vencimento,data_pagamento,descricao,tipo,categoria,entidade,banco,valor_previsto,valor_pago,status\n';
      const csv = header + rows.map(r => `${r.data_vencimento},${r.data_pagamento},"${String(r.descricao).replace(/"/g, '""')}",${r.tipo},"${String(r.categoria).replace(/"/g, '""')}","${String(r.entidade).replace(/"/g, '""')}","${String(r.banco).replace(/"/g, '""')}",${r.valor_previsto},${r.valor_pago},${r.status}`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ultimos_lancamentos_${mes}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lancamentos');
    ws.columns = [
      { header: 'Data Vencimento', key: 'data_vencimento', width: 14 },
      { header: 'Data Pagamento', key: 'data_pagamento', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 40 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Categoria', key: 'categoria', width: 22 },
      { header: 'Entidade', key: 'entidade', width: 22 },
      { header: 'Banco', key: 'banco', width: 18 },
      { header: 'Valor Previsto', key: 'valor_previsto', width: 16 },
      { header: 'Valor Pago', key: 'valor_pago', width: 14 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    rows.forEach(r => ws.addRow(r));

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ultimos_lancamentos_${mes}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chartFluxo = {
    series: [
      { name: 'Entradas', data: fluxoDiario.rec },
      { name: 'Saídas', data: fluxoDiario.desp }
    ],
    options: {
      chart: {
        type: 'area',
        height: 320,
        toolbar: { show: false },
        animations: { enabled: true },
        selection: { enabled: true },
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const day = (opts.dataPointIndex ?? -1) + 1;
            if (day > 0) {
              if (fluxoDiario.mode === 'MONTH') {
                const month = fluxoDiario.indexToDate?.[day - 1];
                if (!month) return;
                setSelectedDate(null);
                setSelectedMonth(prev => prev === month ? null : month);
              } else {
                const date = fluxoDiario.indexToDate?.[day - 1];
                if (!date) return;
                setSelectedMonth(null);
                setSelectedDate(prev => prev === date ? null : date);
              }
            }
          },
          markerClick: (_: any, __: any, opts: any) => {
            const day = (opts.dataPointIndex ?? -1) + 1;
            if (day > 0) {
              if (fluxoDiario.mode === 'MONTH') {
                const month = fluxoDiario.indexToDate?.[day - 1];
                if (!month) return;
                setSelectedDate(null);
                setSelectedMonth(prev => prev === month ? null : month);
              } else {
                const date = fluxoDiario.indexToDate?.[day - 1];
                if (!date) return;
                setSelectedMonth(null);
                setSelectedDate(prev => prev === date ? null : date);
              }
            }
          },
          click: (_: any, chartContext: any, config: any) => {
            const idx = config?.dataPointIndex ?? chartContext?.globals?.lastHoveredDataPointIndex ?? -1;
            const day = idx + 1;
            if (day > 0) {
              if (fluxoDiario.mode === 'MONTH') {
                const month = fluxoDiario.indexToDate?.[day - 1];
                if (!month) return;
                setSelectedDate(null);
                setSelectedMonth(prev => prev === month ? null : month);
              } else {
                const date = fluxoDiario.indexToDate?.[day - 1];
                if (!date) return;
                setSelectedMonth(null);
                setSelectedDate(prev => prev === date ? null : date);
              }
            }
          }
        }
      },
      markers: {
        size: 4,
        strokeWidth: 0,
        hover: { size: 6 }
      },
      grid: { borderColor: '#1f2a44' },
      theme: { mode: 'dark' },
      foreColor: '#cbd5f5',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      colors: ['#10b981', '#ef4444'],
      fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
      xaxis: { categories: fluxoDiario.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: 'dark', y: { formatter: (val: number) => BRL.format(val) } },
      legend: { show: true }
    } as any
  };

  const chartCategorias = {
    series: despesasPorCategoria.map(r => r.total),
    options: {
      labels: despesasPorCategoria.map(r => r.label),
      chart: {
        type: 'donut',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = despesasPorCategoria[idx];
            if (!item || item.id === -1) return;
            setSelectedCategorias(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          }
        }
      },
      theme: { mode: 'dark' },
      foreColor: '#cbd5f5',
      legend: { position: 'bottom' },
      dataLabels: { enabled: false },
      tooltip: { theme: 'dark', y: { formatter: (val: number) => BRL.format(val) } },
      plotOptions: { pie: { donut: { size: '70%' } } }
    } as any
  };

  const chartCentros = {
    series: [{ name: 'Despesas', data: despesasPorCentro.map(r => r.total) }],
    options: {
      chart: {
        type: 'bar',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = despesasPorCentro[idx];
            if (!item) return;
            setSelectedCentro(prev => prev === item.id ? null : item.id);
          }
        }
      },
      theme: { mode: 'dark' },
      foreColor: '#cbd5f5',
      dataLabels: { enabled: false },
      xaxis: { categories: despesasPorCentro.map(r => r.label) },
      tooltip: { theme: 'dark', y: { formatter: (val: number) => BRL.format(val) } },
      colors: ['#6366f1']
    } as any
  };

  const selectedChips = (
    <div className="flex flex-wrap gap-2">
      {selectedCategorias.size > 0 && (
        <button
          onClick={() => setSelectedCategorias(new Set())}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <Layers className="w-3 h-3" />
          {selectedCategorias.size} categoria(s)
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedCentro && (
        <button
          onClick={() => setSelectedCentro(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <Building2 className="w-3 h-3" />
          {centros.find(c => c.id === selectedCentro)?.nome || 'Centro'}
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedDate && (
        <button
          onClick={() => setSelectedDate(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {parseDateLocal(selectedDate)?.toLocaleDateString('pt-BR')}
          <X className="w-3 h-3" />
        </button>
      )}
      {selectedMonth && (
        <button
          onClick={() => setSelectedMonth(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {formatMonthLabel(selectedMonth)}
          <X className="w-3 h-3" />
        </button>
      )}
      {!selectedCategorias.size && !selectedCentro && !selectedDate && !selectedMonth && (
        <span className="text-xs text-slate-400">Clique nos gráficos para filtrar</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">Relatórios interativos e conectados</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2">
            <select
              value={periodoTipo}
              onChange={(e) => setPeriodoTipo(e.target.value as any)}
              className="bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none [&>option]:text-slate-900 [&>option]:bg-white dark:[&>option]:text-slate-100 dark:[&>option]:bg-slate-800"
            >
              <option value="MES">Mês</option>
              <option value="ANO">Ano</option>
              <option value="PERSONALIZADO">Período</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2">
            <CalendarRange className="w-4 h-4 text-slate-400" />
            {periodoTipo === 'MES' && (
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
              />
            )}
            {periodoTipo === 'ANO' && (
              <input
                type="number"
                min={2000}
                max={2100}
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="w-24 bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
              />
            )}
            {periodoTipo === 'PERSONALIZADO' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={periodoIni}
                  onChange={(e) => setPeriodoIni(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
                />
                <span className="text-xs text-slate-400">→</span>
                <input
                  type="date"
                  value={periodoFim}
                  onChange={(e) => setPeriodoFim(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-800 dark:text-white outline-none"
                />
              </div>
            )}
          </div>
          <button
            onClick={handleSync}
            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700 rounded-lg transition"
            title="Atualizar"
          >
            <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Receitas</p>
                <p className="text-2xl font-black text-emerald-600">{BRL.format(kpis.receitas)}</p>
              </div>
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Despesas</p>
                <p className="text-2xl font-black text-red-500">{BRL.format(kpis.despesas)}</p>
              </div>
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <TrendingDown className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Saldo</p>
                <p className={`text-2xl font-black ${kpis.saldo >= 0 ? 'text-slate-800 dark:text-white' : 'text-red-500'}`}>{BRL.format(kpis.saldo)}</p>
              </div>
              <div className="p-2 bg-slate-100 dark:bg-slate-700/50 rounded-lg">
                <Wallet className="w-5 h-5 text-slate-600 dark:text-slate-200" />
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Pagos</p>
                <p className="text-2xl font-black text-indigo-600">{BRL.format(kpis.pagos)}</p>
              </div>
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                <Filter className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-500">
            <List className="w-4 h-4" />
            <span className="text-xs font-bold uppercase">Filtros Ativos</span>
          </div>
          {selectedChips}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Pagar</h3>
              <span className="text-xs text-slate-400">Vencimentos do mês</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Para hoje</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.hoje)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Para amanhã</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.amanha)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Atrasadas</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.atrasadas)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Total do mês</p>
                <p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.pagar.totalMes)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Realizadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.pagar.realizadas)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Em aberto</p>
                <p className="font-bold text-amber-600">{BRL.format(contasHoje.pagar.emAberto)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Receber</h3>
              <span className="text-xs text-slate-400">Vencimentos do mês</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Para hoje</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.hoje)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Para amanhã</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.amanha)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Atrasadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.atrasadas)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Total do mês</p>
                <p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.receber.totalMes)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Realizadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.realizadas)}</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Em aberto</p>
                <p className="font-bold text-amber-600">{BRL.format(contasHoje.receber.emAberto)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">
                {periodoTipo === 'ANO' ? 'Fluxo de Caixa Mensal' : 'Fluxo de Caixa Diário'}
              </h3>
              <span className="text-xs text-slate-400">
                {periodoTipo === 'ANO' ? 'Interativo por mês' : 'Interativo por dia'}
              </span>
            </div>
            <ReactApexChart type="area" height={320} series={chartFluxo.series} options={chartFluxo.options} />
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Despesas por Categoria</h3>
              <span className="text-xs text-slate-400">Clique para filtrar</span>
            </div>
            {chartCategorias.series.length === 0 ? (
              <div className="h-[320px] flex items-center justify-center text-sm text-slate-400">
                Sem dados de despesas no período.
              </div>
            ) : (
              <ReactApexChart type="donut" height={320} series={chartCategorias.series} options={chartCategorias.options} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Despesas por Centro</h3>
              <span className="text-xs text-slate-400">Clique para filtrar</span>
            </div>
            <ReactApexChart type="bar" height={320} series={chartCentros.series} options={chartCentros.options} />
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Últimos Lançamentos</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Atualiza com filtros</span>
                <button
                  onClick={() => exportUltimosLancamentos('csv')}
                  className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  CSV
                </button>
                <button
                  onClick={() => exportUltimosLancamentos('xlsx')}
                  className="px-2 py-1 text-[11px] font-bold rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  XLSX
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 text-left">Data</th>
                    <th className="py-2 text-left">Descrição</th>
                    <th className="py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {loading ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Carregando...</td></tr>
                  ) : topLancamentos.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lançamentos no período.</td></tr>
                  ) : (
                    topLancamentos.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className={`py-3 text-right font-bold ${String(l.tipo).toUpperCase().startsWith('R') ? 'text-emerald-600' : 'text-red-500'}`}>
                          {String(l.tipo).toUpperCase().startsWith('D') ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Gastos por Categoria</h3>
              <span className="text-xs text-slate-400">Clique para filtrar</span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
              {categoriasList.length === 0 ? (
                <div className="text-sm text-slate-400">Sem despesas no período.</div>
              ) : (
                categoriasList.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedCategorias(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                      return next;
                    })}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition ${item.active ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                  >
                    <span className="text-sm text-slate-700 dark:text-slate-100 truncate pr-2">{item.label}</span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{BRL.format(item.total)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos da Categoria</h3>
              <span className="text-xs text-slate-400">Mostra quando categoria está selecionada</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-400">Exportação inclui filtros atuais</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const rows = filteredLancamentos.map(l => ({
                      data_vencimento: l.data_vencimento,
                      data_pagamento: l.data_pagamento || '',
                      descricao: l.descricao,
                      tipo: l.tipo,
                      categoria: categorias.find(c => Number(c.id) === Number(l.plano_contas_id))?.nome || '',
                      entidade: '',
                      banco: '',
                      valor_previsto: l.valor_previsto,
                      valor_pago: l.valor_pago,
                      status: l.status
                    }));
                    const header = 'data_vencimento,data_pagamento,descricao,tipo,categoria,entidade,banco,valor_previsto,valor_pago,status\n';
                    const csv = header + rows.map(r => `${r.data_vencimento},${r.data_pagamento},"${String(r.descricao).replace(/"/g, '""')}",${r.tipo},"${String(r.categoria).replace(/"/g, '""')}","${String(r.entidade).replace(/"/g, '""')}","${String(r.banco).replace(/"/g, '""')}",${r.valor_previsto},${r.valor_pago},${r.status}`).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `lancamentos_${mes}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  Exportar CSV
                </button>
                <button
                  onClick={async () => {
                    const rows = filteredLancamentos.map(l => ({
                      data_vencimento: l.data_vencimento,
                      data_pagamento: l.data_pagamento || '',
                      descricao: l.descricao,
                      tipo: l.tipo,
                      categoria: categorias.find(c => Number(c.id) === Number(l.plano_contas_id))?.nome || '',
                      entidade: '',
                      banco: '',
                      valor_previsto: l.valor_previsto,
                      valor_pago: l.valor_pago,
                      status: l.status
                    }));
                    const wb = new ExcelJS.Workbook();
                    const ws = wb.addWorksheet('Lancamentos');
                    ws.columns = [
                      { header: 'Data Vencimento', key: 'data_vencimento', width: 14 },
                      { header: 'Data Pagamento', key: 'data_pagamento', width: 14 },
                      { header: 'Descrição', key: 'descricao', width: 40 },
                      { header: 'Tipo', key: 'tipo', width: 12 },
                      { header: 'Categoria', key: 'categoria', width: 22 },
                      { header: 'Entidade', key: 'entidade', width: 22 },
                      { header: 'Banco', key: 'banco', width: 18 },
                      { header: 'Valor Previsto', key: 'valor_previsto', width: 16 },
                      { header: 'Valor Pago', key: 'valor_pago', width: 14 },
                      { header: 'Status', key: 'status', width: 12 }
                    ];
                    rows.forEach(r => ws.addRow(r));
                    const buffer = await wb.xlsx.writeBuffer();
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `lancamentos_${mes}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  Exportar XLSX
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 text-left">Data</th>
                    <th className="py-2 text-left">Descrição</th>
                    <th className="py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {selectedCategorias.size === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Selecione uma ou mais categorias para ver os lançamentos.</td></tr>
                  ) : categoriaLancamentos.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lançamentos para esta categoria.</td></tr>
                  ) : (
                    categoriaLancamentos.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className={`py-3 text-right font-bold ${isReceita(l.tipo) ? 'text-emerald-600' : 'text-red-500'}`}>
                          {isDespesa(l.tipo) ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selectedDate && (
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos do Dia {parseDateLocal(selectedDate)?.toLocaleDateString('pt-BR')}</h3>
              <span className="text-xs text-slate-400">Vencimento no dia selecionado</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-400 uppercase">
                  <tr>
                    <th className="py-2 text-left">Data</th>
                    <th className="py-2 text-left">Descrição</th>
                    <th className="py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {diaLancamentos.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">Sem lançamentos para este dia.</td></tr>
                  ) : (
                    diaLancamentos.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                        <td className="py-3 text-slate-500 font-mono">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="py-3 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className={`py-3 text-right font-bold ${isReceita(l.tipo) ? 'text-emerald-600' : 'text-red-500'}`}>
                          {isDespesa(l.tipo) ? '-' : ''}{BRL.format(Number(l.valor_previsto || 0))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
