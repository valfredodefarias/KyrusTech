import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { AiAssistente } from '../components/AiAssistente';
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
  competencia?: string;
  previsto?: boolean;
  origem?: string;
  tipo: 'RECEITA' | 'DESPESA' | string;
  status: 'PAGO' | 'PENDENTE' | 'EM ABERTO' | string;
  plano_contas_id?: number;
  centro_custo_id?: number;
}

interface Categoria {
  id: number;
  nome: string;
  tipo: string;
  considerar_nos_resultados?: boolean;
}

interface CentroCusto {
  id: number;
  nome: string;
}

interface TodoItem {
  id: number;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO' | string;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const toDateOnly = (d: Date) => d.toISOString().split('T')[0];
const toDateOnlyStr = (s?: string) => (s ? s.split('T')[0] : '');
const toCompetencia = (s?: string) => {
  if (!s) return '';
  const [y, m] = s.split('-');
  if (!y || !m) return '';
  return `${m}-${y}`;
};
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

const buildExcludedCategoriaIds = (categorias: Categoria[]) => {
  const filhosPorPai = new Map<number, number[]>();
  const excluidas = new Set<number>();

  categorias.forEach((cat) => {
    const catId = Number(cat.id);
    const parentId = Number((cat as any).conta_pai_id);
    if (Number.isFinite(parentId) && parentId > 0) {
      const filhos = filhosPorPai.get(parentId) || [];
      filhos.push(catId);
      filhosPorPai.set(parentId, filhos);
    }
    if (cat.considerar_nos_resultados === false) {
      excluidas.add(catId);
    }
  });

  const fila = Array.from(excluidas);
  while (fila.length > 0) {
    const atual = fila.shift()!;
    const filhos = filhosPorPai.get(atual) || [];
    filhos.forEach((filhoId) => {
      if (!excluidas.has(filhoId)) {
        excluidas.add(filhoId);
        fila.push(filhoId);
      }
    });
  }

  return excluidas;
};

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
  const [lancamentosAno, setLancamentosAno] = useState<Lancamento[]>([]);
  const [lancamentosAnoAnterior, setLancamentosAnoAnterior] = useState<Lancamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [periodoTipo, setPeriodoTipo] = useState<'MES' | 'ANO' | 'PERSONALIZADO'>('MES');
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [periodoIni, setPeriodoIni] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedCategorias, setSelectedCategorias] = useState<Set<number>>(new Set());
  const [selectedCentro, setSelectedCentro] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<'TODOS' | 'PAGO' | 'PENDENTE'>('TODOS');
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | 'RECEITA' | 'DESPESA'>('TODOS');
  const [previstoFiltro, setPrevistoFiltro] = useState<'TODOS' | 'SIM' | 'NAO'>('TODOS');
  const [competenciaFiltro, setCompetenciaFiltro] = useState('');
  const [filtroHojeAtivo, setFiltroHojeAtivo] = useState(false);

  useEffect(() => {
    const handler = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', handler);
    return () => window.removeEventListener('theme-change', handler);
  }, []);

  const categoriasExcluidasResultado = useMemo(() => buildExcludedCategoriaIds(categorias), [categorias]);

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
      let yearBase: number;
      if (periodoTipo === 'ANO') {
        ({ start, end } = getYearRange(ano));
        yearBase = ano;
      } else if (periodoTipo === 'PERSONALIZADO') {
        start = periodoIni;
        end = periodoFim;
        yearBase = new Date(periodoIni).getFullYear();
      } else {
        ({ start, end } = getMonthRange(mes));
        yearBase = Number(mes.slice(0, 4));
      }
      const { start: startYear, end: endYear } = getYearRange(yearBase);
      const { start: startPrev, end: endPrev } = getYearRange(yearBase - 1);
      const [rLanc, rCats, rCentros, rTodos] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 5000, data_inicio: start, data_fim: end } }),
        api.get('/plano-contas/'),
        api.get('/centro-custo/'),
        api.get('/todos/me')
      ]);
      const [rLancAno, rLancAnoAnterior] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 10000, data_inicio: startYear, data_fim: endYear } }),
        api.get('/lancamentos/', { params: { limit: 10000, data_inicio: startPrev, data_fim: endPrev } })
      ]);
      setLancamentos(rLanc.data || []);
      setLancamentosAno(rLancAno.data || []);
      setLancamentosAnoAnterior(rLancAnoAnterior.data || []);
      setCategorias(rCats.data || []);
      setCentros(rCentros.data || []);
      setTodos(rTodos.data || []);
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
    const hoje = toDateOnly(new Date());
    return lancamentos.filter(l => {
      if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
      if (categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
      if (filtroHojeAtivo && toDateOnlyStr(l.data_vencimento) !== hoje) return false;
      const isPrevisto = l.previsto !== false;
      if (previstoFiltro === 'SIM' && !isPrevisto) return false;
      if (previstoFiltro === 'NAO' && isPrevisto) return false;
      if (competenciaFiltro) {
        const comp = l.competencia || toCompetencia(l.data_vencimento);
        if (comp !== competenciaFiltro) return false;
      }
      if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
      if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
      if (statusFiltro !== 'TODOS' && String(l.status).toUpperCase() !== statusFiltro) return false;
      if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
      if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
      return true;
    });
  }, [lancamentos, categoriasExcluidasResultado, selectedCategorias, selectedCentro, selectedDate, selectedMonth, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo]);

  const baseFilteredNoDate = useMemo(() => {
    const hoje = toDateOnly(new Date());
    return lancamentosAno.filter(l => {
      if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
      if (categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
      if (filtroHojeAtivo && toDateOnlyStr(l.data_vencimento) !== hoje) return false;
      const isPrevisto = l.previsto !== false;
      if (previstoFiltro === 'SIM' && !isPrevisto) return false;
      if (previstoFiltro === 'NAO' && isPrevisto) return false;
      if (competenciaFiltro) {
        const comp = l.competencia || toCompetencia(l.data_vencimento);
        if (comp !== competenciaFiltro) return false;
      }
      if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (statusFiltro !== 'TODOS' && String(l.status).toUpperCase() !== statusFiltro) return false;
      if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
      if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
      return true;
    });
  }, [lancamentosAno, categoriasExcluidasResultado, selectedCategorias, selectedCentro, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo]);

  const baseFilteredAnoAnterior = useMemo(() => {
    const hoje = toDateOnly(new Date());
    return lancamentosAnoAnterior.filter(l => {
      if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
      if (categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
      if (filtroHojeAtivo && toDateOnlyStr(l.data_vencimento) !== hoje) return false;
      const isPrevisto = l.previsto !== false;
      if (previstoFiltro === 'SIM' && !isPrevisto) return false;
      if (previstoFiltro === 'NAO' && isPrevisto) return false;
      if (competenciaFiltro) {
        const comp = l.competencia || toCompetencia(l.data_vencimento);
        if (comp !== competenciaFiltro) return false;
      }
      if (selectedCategorias.size > 0 && !selectedCategorias.has(Number(l.plano_contas_id))) return false;
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (statusFiltro !== 'TODOS' && String(l.status).toUpperCase() !== statusFiltro) return false;
      if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
      if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
      return true;
    });
  }, [lancamentosAnoAnterior, categoriasExcluidasResultado, selectedCategorias, selectedCentro, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo]);

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

  const aiContexto = useMemo(() => {
    return {
      periodo: { tipo: periodoTipo, mes, ano, inicio: periodoIni, fim: periodoFim },
      filtros: {
        status: statusFiltro,
        tipo: tipoFiltro,
        previsto: previstoFiltro,
        competencia: competenciaFiltro,
        hoje: filtroHojeAtivo,
        categoriasSelecionadas: Array.from(selectedCategorias),
        centroCustoSelecionado: selectedCentro,
      },
      metricas: {
        totalLancamentosFiltrados: filteredLancamentos.length,
        receitas: kpis.receitas,
        despesas: kpis.despesas,
        saldo: kpis.saldo,
        pagos: kpis.pagos,
        pendentes: kpis.pendentes,
      },
    };
  }, [periodoTipo, mes, ano, periodoIni, periodoFim, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, selectedCategorias, selectedCentro, filteredLancamentos.length, kpis]);

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

  const resultadoMensal = useMemo(() => {
    const map = new Map<string, { rec: number; desp: number }>();
    filteredLancamentos.forEach(l => {
      const date = toDateOnlyStr(l.data_vencimento);
      if (!date) return;
      const key = date.slice(0, 7);
      if (!map.has(key)) map.set(key, { rec: 0, desp: 0 });
      const val = Number(l.valor_previsto || 0);
      const bucket = map.get(key)!;
      if (isReceita(l.tipo)) bucket.rec += val;
      else bucket.desp += val;
    });
    const keys = Array.from(map.keys()).sort();
    const values = keys.map(k => {
      const v = map.get(k)!;
      return v.rec - v.desp;
    });
    return { keys, labels: keys.map(formatMonthLabel), values };
  }, [filteredLancamentos]);

  const resultadoMensalAno = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() : Number(mes.slice(0, 4)));

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    baseFilteredNoDate.forEach(l => {
      const d = parseDateLocal(l.data_vencimento);
      if (!d || d.getFullYear() !== yearBase) return;
      const idx = d.getMonth();
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val; else desp[idx] += val;
    });

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const values = rec.map((r, i) => r - desp[i]);
    const margem = rec.map((r, i) => r > 0 ? Math.round(((r - desp[i]) / r) * 100) : 0);
    return { year: yearBase, labels, rec, desp, values, margem };
  }, [baseFilteredNoDate, periodoTipo, ano, periodoIni, mes]);

  const resultadoMensalAnoAnterior = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano - 1
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() - 1 : Number(mes.slice(0, 4)) - 1);

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    baseFilteredAnoAnterior.forEach(l => {
      const d = parseDateLocal(l.data_vencimento);
      if (!d || d.getFullYear() !== yearBase) return;
      const idx = d.getMonth();
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val; else desp[idx] += val;
    });

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const values = rec.map((r, i) => r - desp[i]);
    return { year: yearBase, labels, values };
  }, [baseFilteredAnoAnterior, periodoTipo, ano, periodoIni, mes]);

  const sazonalidadeIndice = useMemo(() => {
    const totalMes = resultadoMensalAno.rec.map((r, i) => r + resultadoMensalAno.desp[i]);
    const avg = totalMes.reduce((acc, v) => acc + v, 0) / (totalMes.length || 1);
    const values = totalMes.map(v => avg > 0 ? Math.round((v / avg) * 100) : 0);
    return { labels: resultadoMensalAno.labels, values };
  }, [resultadoMensalAno]);

  const resultadoAcumulado = useMemo(() => {
    const values = fluxoDiario.rec.map((rec, idx) => rec - (fluxoDiario.desp[idx] || 0));
    const acum: number[] = [];
    values.reduce((acc, v) => {
      const next = acc + v;
      acum.push(next);
      return next;
    }, 0);
    return { labels: fluxoDiario.labels, values: acum };
  }, [fluxoDiario]);

  const acumuladoRecDesp = useMemo(() => {
    const rec: number[] = [];
    const desp: number[] = [];
    fluxoDiario.rec.reduce((acc, v) => {
      const next = acc + v;
      rec.push(next);
      return next;
    }, 0);
    fluxoDiario.desp.reduce((acc, v) => {
      const next = acc + v;
      desp.push(next);
      return next;
    }, 0);
    return { labels: fluxoDiario.labels, rec, desp };
  }, [fluxoDiario]);

  const statusDistrib = useMemo(() => {
    const pagos = filteredLancamentos.filter(l => isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const pendentes = filteredLancamentos.filter(l => !isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    return { pagos, pendentes };
  }, [filteredLancamentos]);

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

  const receitasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    const base = lancamentos.filter(l => {
      if (selectedCentro && Number(l.centro_custo_id) !== Number(selectedCentro)) return false;
      if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
      if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
      return true;
    });

    base.forEach(l => {
      if (!isReceita(l.tipo)) return;
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

  const lancamentosContasDetalhe = useMemo(() => {
    const sorted = [...filteredLancamentos].sort((a, b) => {
      const da = parseDateLocal(a.data_vencimento)?.getTime() || 0;
      const db = parseDateLocal(b.data_vencimento)?.getTime() || 0;
      return db - da;
    });
    return {
      pagar: sorted.filter((l) => isDespesa(l.tipo)).slice(0, 20),
      receber: sorted.filter((l) => isReceita(l.tipo)).slice(0, 20),
    };
  }, [filteredLancamentos]);

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
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      colors: ['#10b981', '#ef4444'],
      fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
      xaxis: { categories: fluxoDiario.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
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
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      legend: { position: 'bottom' },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      plotOptions: { pie: { donut: { size: '70%' } } }
    } as any
  };

  const chartReceitasCategorias = {
    series: receitasPorCategoria.map(r => r.total),
    options: {
      labels: receitasPorCategoria.map(r => r.label),
      chart: {
        type: 'donut',
        height: 320,
        events: {
          dataPointSelection: (_: any, __: any, opts: any) => {
            const idx = opts.dataPointIndex;
            const item = receitasPorCategoria[idx];
            if (!item || item.id === -1) return;
            setSelectedCategorias(prev => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
              return next;
            });
          }
        }
      },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      legend: { position: 'bottom' },
      dataLabels: { enabled: false },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
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
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: despesasPorCentro.map(r => r.label) },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      colors: ['#6366f1']
    } as any
  };

  const totalPrevisto = kpis.receitas + kpis.despesas;
  const execucaoPct = totalPrevisto > 0 ? Math.round((kpis.pagos / totalPrevisto) * 100) : 0;
  const todoPendentesPct = useMemo(() => {
    const total = todos.length;
    if (!total) return 0;
    const pendentes = todos.filter(t => t.status !== 'CONCLUIDO' && t.status !== 'CANCELADO').length;
    return Math.round((pendentes / total) * 100);
  }, [todos]);
  const mediaResultado = resultadoMensal.values.length
    ? resultadoMensal.values.reduce((acc, v) => acc + v, 0) / resultadoMensal.values.length
    : 0;

  const chartProdutividade = {
    series: [execucaoPct],
    options: {
      chart: { type: 'radialBar', height: 240 },
      plotOptions: {
        radialBar: {
          hollow: { size: '62%' },
          dataLabels: {
            name: { show: true, color: '#94a3b8', fontSize: '11px' },
            value: { show: true, fontSize: '22px', fontWeight: 700 }
          }
        }
      },
      labels: ['Execução'],
      colors: ['#6366f1'],
      theme: { mode: isDark ? 'dark' : 'light' }
    } as any
  };

  const chartResultadoOperacional = {
    series: [{ name: 'Resultado Operacional', data: resultadoMensalAno.values }],
    options: {
      chart: { type: 'bar', height: 320, toolbar: { show: false } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      plotOptions: {
        bar: {
          borderRadius: 8,
          columnWidth: '55%',
          colors: {
            ranges: [
              { from: -999999999, to: -0.01, color: '#ef4444' },
              { from: 0, to: 999999999, color: '#10b981' }
            ]
          }
        }
      },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartComparativoAno = {
    series: [
      { name: String(resultadoMensalAno.year), data: resultadoMensalAno.values },
      { name: String(resultadoMensalAnoAnterior.year), data: resultadoMensalAnoAnterior.values }
    ],
    options: {
      chart: { type: 'line', height: 280, toolbar: { show: false }, zoom: { enabled: true } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#6366f1', '#f59e0b'],
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartSazonalidade = {
    series: [{ name: 'Índice Sazonal (%)', data: sazonalidadeIndice.values }],
    options: {
      chart: { type: 'bar', height: 260, toolbar: { show: false } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: sazonalidadeIndice.labels },
      yaxis: { labels: { formatter: (val: number) => `${val}%` } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val}%` } },
      plotOptions: { bar: { borderRadius: 8, columnWidth: '60%' } },
      colors: ['#06b6d4'],
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const cenarios = useMemo(() => {
    const valores = resultadoMensalAno.values;
    const media = valores.reduce((acc, v) => acc + v, 0) / (valores.length || 1);
    const variancia = valores.reduce((acc, v) => acc + Math.pow(v - media, 2), 0) / (valores.length || 1);
    const desvio = Math.sqrt(variancia);
    return {
      pessimista: kpis.saldo - desvio,
      realista: kpis.saldo,
      otimista: kpis.saldo + desvio
    };
  }, [resultadoMensalAno.values, kpis.saldo]);

  const chartReceitasDespesasAno = {
    series: [
      { name: 'Receitas', data: resultadoMensalAno.rec },
      { name: 'Despesas', data: resultadoMensalAno.desp }
    ],
    options: {
      chart: { type: 'bar', height: 320, stacked: true, toolbar: { show: false } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      colors: ['#10b981', '#ef4444'],
      legend: { position: 'top' },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartMargemAno = {
    series: [{ name: 'Margem Operacional %', data: resultadoMensalAno.margem }],
    options: {
      chart: { type: 'line', height: 280, toolbar: { show: false } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#6366f1'],
      xaxis: { categories: resultadoMensalAno.labels },
      yaxis: { labels: { formatter: (val: number) => `${val}%` } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => `${val}%` } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartResultadoAcumulado = {
    series: [{ name: 'Resultado Acumulado', data: resultadoAcumulado.values }],
    options: {
      chart: { type: 'line', height: 280, toolbar: { show: false }, animations: { enabled: true } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#22c55e'],
      xaxis: { categories: resultadoAcumulado.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartAcumuladoRecDesp = {
    series: [
      { name: 'Receitas Acumuladas', data: acumuladoRecDesp.rec },
      { name: 'Despesas Acumuladas', data: acumuladoRecDesp.desp }
    ],
    options: {
      chart: { type: 'line', height: 280, toolbar: { show: false }, animations: { enabled: true } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      colors: ['#10b981', '#ef4444'],
      xaxis: { categories: acumuladoRecDesp.labels },
      yaxis: { labels: { formatter: (val: number) => BRL.format(val) } },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } },
      grid: { borderColor: isDark ? '#1f2a44' : '#e2e8f0' }
    } as any
  };

  const chartStatus = {
    series: [statusDistrib.pagos, statusDistrib.pendentes],
    options: {
      labels: ['Pagos', 'Pendentes'],
      chart: { type: 'donut', height: 260 },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      dataLabels: { enabled: false },
      colors: ['#10b981', '#f59e0b'],
      legend: { position: 'bottom' },
      tooltip: { theme: isDark ? 'dark' : 'light', y: { formatter: (val: number) => BRL.format(val) } }
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
      {statusFiltro !== 'TODOS' && (
        <button
          onClick={() => setStatusFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center gap-1"
        >
          <Filter className="w-3 h-3" />
          {statusFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {tipoFiltro !== 'TODOS' && (
        <button
          onClick={() => setTipoFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1"
        >
          <TrendingUp className="w-3 h-3" />
          {tipoFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {previstoFiltro !== 'TODOS' && (
        <button
          onClick={() => setPrevistoFiltro('TODOS')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1"
        >
          <Filter className="w-3 h-3" />
          Previsto: {previstoFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {competenciaFiltro && (
        <button
          onClick={() => setCompetenciaFiltro('')}
          className="px-3 py-1 text-xs font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          {competenciaFiltro}
          <X className="w-3 h-3" />
        </button>
      )}
      {filtroHojeAtivo && (
        <button
          onClick={() => setFiltroHojeAtivo(false)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 flex items-center gap-1"
        >
          <CalendarRange className="w-3 h-3" />
          Hoje
          <X className="w-3 h-3" />
        </button>
      )}
      {!selectedCategorias.size && !selectedCentro && !selectedDate && !selectedMonth && statusFiltro === 'TODOS' && tipoFiltro === 'TODOS' && previstoFiltro === 'TODOS' && !competenciaFiltro && !filtroHojeAtivo && (
        <span className="text-xs text-slate-400">Clique nos gráficos para filtrar</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 sm:px-8 py-5 flex flex-col lg:flex-row lg:items-center justify-between shadow-sm gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">Relatórios interativos e conectados</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 w-full sm:w-auto">
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
          <div className="flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 w-full sm:w-auto">
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
              <div className="flex flex-wrap items-center gap-2">
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

      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/80 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
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
          <div className="bg-white/80 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
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
          <div className="bg-white/80 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
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
          <div className="bg-white/80 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:shadow-md">
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

        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'HOJE', label: 'Hoje' },
            { key: 'TODOS', label: 'Todos status' },
            { key: 'PAGO', label: 'Pagos' },
            { key: 'PENDENTE', label: 'Pendentes' }
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => {
                if (f.key === 'HOJE') {
                  setFiltroHojeAtivo((prev) => !prev);
                } else {
                  setStatusFiltro(f.key);
                }
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${f.key === 'HOJE' ? (filtroHojeAtivo ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-white/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700') : (statusFiltro === f.key ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700')}`}
            >
              {f.label}
            </button>
          ))}
          {([
            { key: 'TODOS', label: 'Todos tipos' },
            { key: 'RECEITA', label: 'Receitas' },
            { key: 'DESPESA', label: 'Despesas' }
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setTipoFiltro(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${tipoFiltro === f.key ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-white/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'TODOS', label: 'Previsto (Todos)' },
            { key: 'SIM', label: 'Previsto' },
            { key: 'NAO', label: 'Não previsto' }
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setPrevistoFiltro(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${previstoFiltro === f.key ? 'bg-amber-600 text-white border-amber-500' : 'bg-white/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5">
            <CalendarRange className="w-4 h-4 text-slate-400" />
            <input
              value={competenciaFiltro}
              onChange={(e) => setCompetenciaFiltro(e.target.value)}
              placeholder="Competência MM-AAAA"
              className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 outline-none w-36"
            />
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-700 dark:text-slate-200">Produtividade</h3>
            <span className="text-xs text-slate-400">Eficiência de execução financeira</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div className="lg:col-span-1">
              <ReactApexChart type="radialBar" height={240} series={chartProdutividade.series} options={chartProdutividade.options} />
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Execução</p>
                <p className="text-xl font-bold text-indigo-600">{execucaoPct}%</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Tarefas pendentes</p>
                <p className="text-xl font-bold text-amber-600">{todoPendentesPct}%</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Resultado no período</p>
                <p className={`text-xl font-bold ${kpis.saldo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(kpis.saldo)}</p>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos • Contas a Pagar</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.pagar.length} item(ns)</span>
            </div>
            <div className="overflow-auto max-h-80 rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="p-2 text-left">Descrição</th>
                    <th className="p-2 text-left">Venc.</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosContasDetalhe.pagar.length === 0 ? (
                    <tr><td className="p-3 text-slate-400" colSpan={4}>Sem lançamentos de contas a pagar no filtro atual.</td></tr>
                  ) : (
                    lancamentosContasDetalhe.pagar.map((l) => (
                      <tr key={`pagar-${l.id}`} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="p-2 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className="p-2 text-slate-500">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="p-2"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isPago(l.status) ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'}`}>{l.status}</span></td>
                        <td className="p-2 text-right font-bold text-red-500">{BRL.format(Number(l.valor_previsto || 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos • Contas a Receber</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.receber.length} item(ns)</span>
            </div>
            <div className="overflow-auto max-h-80 rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="p-2 text-left">Descrição</th>
                    <th className="p-2 text-left">Venc.</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosContasDetalhe.receber.length === 0 ? (
                    <tr><td className="p-3 text-slate-400" colSpan={4}>Sem lançamentos de contas a receber no filtro atual.</td></tr>
                  ) : (
                    lancamentosContasDetalhe.receber.map((l) => (
                      <tr key={`receber-${l.id}`} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="p-2 text-slate-700 dark:text-slate-200">{l.descricao}</td>
                        <td className="p-2 text-slate-500">{parseDateLocal(l.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                        <td className="p-2"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isPago(l.status) ? 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' : 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800'}`}>{l.status}</span></td>
                        <td className="p-2 text-right font-bold text-emerald-600">{BRL.format(Number(l.valor_previsto || 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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
              <div className="h-80 flex items-center justify-center text-sm text-slate-400">
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
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Receitas por Categoria</h3>
              <span className="text-xs text-slate-400">Clique para filtrar</span>
            </div>
            {chartReceitasCategorias.series.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-sm text-slate-400">
                Sem dados de receitas no período.
              </div>
            ) : (
              <ReactApexChart type="donut" height={320} series={chartReceitasCategorias.series} options={chartReceitasCategorias.options} />
            )}
          </div>
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Acumulado: Receitas x Despesas</h3>
              <span className="text-xs text-slate-400">Evolução no período</span>
            </div>
            <ReactApexChart type="line" height={280} series={chartAcumuladoRecDesp.series} options={chartAcumuladoRecDesp.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Operacional ({resultadoMensalAno.year})</h3>
              <span className="text-xs text-slate-400">Jan → Dez</span>
            </div>
            {chartResultadoOperacional.series[0].data.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-sm text-slate-400">
                Sem dados suficientes para o período.
              </div>
            ) : (
              <ReactApexChart type="bar" height={320} series={chartResultadoOperacional.series} options={chartResultadoOperacional.options} />
            )}
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resumo Operacional</h3>
              <span className="text-xs text-slate-400">Média mensal</span>
            </div>
            <div className="space-y-3">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Média por mês</p>
                <p className={`text-lg font-bold ${mediaResultado >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(mediaResultado)}</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Melhor cenário</p>
                <p className="text-lg font-bold text-emerald-600">
                  {resultadoMensal.values.length ? BRL.format(Math.max(...resultadoMensal.values)) : '—'}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Pior cenário</p>
                <p className="text-lg font-bold text-red-500">
                  {resultadoMensal.values.length ? BRL.format(Math.min(...resultadoMensal.values)) : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Receitas x Despesas ({resultadoMensalAno.year})</h3>
              <span className="text-xs text-slate-400">Comparativo anual</span>
            </div>
            <ReactApexChart type="bar" height={320} series={chartReceitasDespesasAno.series} options={chartReceitasDespesasAno.options} />
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Margem Operacional</h3>
              <span className="text-xs text-slate-400">% mês a mês</span>
            </div>
            <ReactApexChart type="line" height={280} series={chartMargemAno.series} options={chartMargemAno.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Comparativo Ano a Ano</h3>
              <span className="text-xs text-slate-400">{resultadoMensalAnoAnterior.year} vs {resultadoMensalAno.year}</span>
            </div>
            <ReactApexChart type="line" height={280} series={chartComparativoAno.series} options={chartComparativoAno.options} />
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Sazonalidade</h3>
              <span className="text-xs text-slate-400">Índice mensal</span>
            </div>
            <ReactApexChart type="bar" height={260} series={chartSazonalidade.series} options={chartSazonalidade.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Cenários</h3>
              <span className="text-xs text-slate-400">Baseado na volatilidade</span>
            </div>
            <div className="space-y-3">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Pessimista</p>
                <p className="text-lg font-bold text-red-500">{BRL.format(cenarios.pessimista)}</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Realista</p>
                <p className="text-lg font-bold text-slate-800 dark:text-white">{BRL.format(cenarios.realista)}</p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-400">Otimista</p>
                <p className="text-lg font-bold text-emerald-600">{BRL.format(cenarios.otimista)}</p>
              </div>
            </div>
          </div>
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Acumulado</h3>
              <span className="text-xs text-slate-400">Evolução do caixa</span>
            </div>
            <ReactApexChart type="line" height={280} series={chartResultadoAcumulado.series} options={chartResultadoAcumulado.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Acumulado</h3>
              <span className="text-xs text-slate-400">Evolução do caixa</span>
            </div>
            <ReactApexChart type="line" height={280} series={chartResultadoAcumulado.series} options={chartResultadoAcumulado.options} />
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Distribuição por Status</h3>
              <span className="text-xs text-slate-400">Valor por status</span>
            </div>
            <ReactApexChart type="donut" height={260} series={chartStatus.series} options={chartStatus.options} />
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

      <AiAssistente
        tela="dashboard"
        contexto={aiContexto}
        titulo="Assistente do Dashboard"
        sugestoes={[
          'Quais indicadores merecem atencao imediata?',
          'O que explica meu saldo no periodo?',
          'Quais acoes priorizar para melhorar o resultado?',
        ]}
      />
    </div>
  );
}
