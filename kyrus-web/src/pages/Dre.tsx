import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Sigma, TrendingDown, TrendingUp } from 'lucide-react';

import { api } from '../services/api';

interface PlanoConta {
  id: number;
  nome: string;
  tipo: string;
  codigo?: string | null;
  considerar_nos_resultados?: boolean;
  permite_lancamentos?: boolean;
  conta_pai_id?: number | null;
}

interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status?: string;
  plano_contas_id?: number | null;
  valor_previsto: number;
  valor_pago?: number | null;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia?: string | null;
}

interface DreNode {
  id: number;
  nome: string;
  codigo: string;
  depth: number;
  monthly: number[];
  total: number;
  hasChildren: boolean;
}

type DreBranch = {
  rows: DreNode[];
  monthly: number[];
};

const MONTH_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

function isReceita(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('R');
}

function isDespesa(tipo?: string | null) {
  return String(tipo || '').toUpperCase().startsWith('D');
}

function parseMonthIndex(dateValue?: string | null) {
  if (!dateValue) return -1;
  const month = Number(dateValue.slice(5, 7));
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month - 1 : -1;
}

function sumValues(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

function hasAnyValue(values: number[]) {
  return values.some((value) => Math.abs(value) > 0.009);
}

function buildMonthLabels(ano: number) {
  return MONTH_SHORT.map((label) => `${label}/${ano}`);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const syncTheme = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', syncTheme);
    return () => window.removeEventListener('theme-change', syncTheme);
  }, []);

  return isDark;
}

function MetricCard({
  label,
  value,
  tone,
  icon,
  isDark,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'slate';
  icon: React.ReactNode;
  isDark: boolean;
}) {
  const toneClass = {
    emerald: isDark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700',
    slate: isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div className={`rounded-3xl border px-5 py-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-60">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className={`rounded-2xl border border-current/10 p-3 ${isDark ? 'bg-white/5' : 'bg-white/80'}`}>{icon}</div>
      </div>
    </div>
  );
}

function renderMoneyCell(value: number, tone?: 'receita' | 'despesa' | 'resultado') {
  if (Math.abs(value) < 0.009) return 'R$ 0';
  if (tone === 'resultado') return moneyFormatter.format(value);
  return moneyFormatter.format(Math.abs(value));
}

export function Dre() {
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [ano, setAno] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<PlanoConta[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [selectedContaId, setSelectedContaId] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const isDark = useIsDarkMode();

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const inicio = `${ano}-01-01`;
        const fim = `${ano}-12-31`;
        const [categoriasRes, lancamentosRes] = await Promise.all([
          api.get<PlanoConta[]>('/plano-contas/'),
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 10000, data_inicio: inicio, data_fim: fim } }),
        ]);

        if (!active) return;

        setCategorias(categoriasRes.data || []);
        setLancamentos(lancamentosRes.data || []);
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.detail || 'Nao foi possivel montar a DRE.');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [ano]);

  const dre = useMemo(() => {
    const relevantes = categorias.filter((conta) => {
      if (conta.considerar_nos_resultados === false) return false;
      return isReceita(conta.tipo) || isDespesa(conta.tipo);
    });

    const contaPorId = new Map<number, PlanoConta>();
    const filhosPorPai = new Map<number | null, PlanoConta[]>();
    const valoresDiretos = new Map<number, number[]>();

    relevantes.forEach((conta) => {
      contaPorId.set(conta.id, conta);
      const parentId = conta.conta_pai_id ?? null;
      const list = filhosPorPai.get(parentId) || [];
      list.push(conta);
      filhosPorPai.set(parentId, list);
    });

    lancamentos.forEach((lancamento) => {
      const contaId = Number(lancamento.plano_contas_id);
      if (!contaPorId.has(contaId)) return;
      const monthIndex = parseMonthIndex(lancamento.data_vencimento);
      if (monthIndex < 0) return;
      const values = valoresDiretos.get(contaId) || Array.from({ length: 12 }, () => 0);
      values[monthIndex] += Number(lancamento.valor_previsto || 0);
      valoresDiretos.set(contaId, values);
    });

    const sortAccounts = (accounts: PlanoConta[]) => [...accounts].sort((left, right) => {
      const codeCompare = String(left.codigo || '').localeCompare(String(right.codigo || ''), 'pt-BR', { numeric: true });
      if (codeCompare !== 0) return codeCompare;
      return left.nome.localeCompare(right.nome, 'pt-BR');
    });

    const roots = sortAccounts(relevantes.filter((conta) => !conta.conta_pai_id || !contaPorId.has(Number(conta.conta_pai_id))));

    const descendantsById = new Map<number, number[]>();
    const collectDescendants = (contaId: number): number[] => {
      const cached = descendantsById.get(contaId);
      if (cached) return cached;
      const children = filhosPorPai.get(contaId) || [];
      const ids = [contaId, ...children.flatMap((child) => collectDescendants(child.id))];
      descendantsById.set(contaId, ids);
      return ids;
    };
    relevantes.forEach((conta) => collectDescendants(conta.id));

    const buildBranch = (conta: PlanoConta, depth: number): DreBranch | null => {
      const ownValues = [...(valoresDiretos.get(conta.id) || Array.from({ length: 12 }, () => 0))];
      const children = sortAccounts(filhosPorPai.get(conta.id) || []);
      const childRows: DreNode[] = [];
      const totalValues = [...ownValues];

      children.forEach((child) => {
        const branch = buildBranch(child, depth + 1);
        if (!branch) return;
        branch.monthly.forEach((value, index) => {
          totalValues[index] += value;
        });
        childRows.push(...branch.rows);
      });

      if (!hasAnyValue(totalValues) && childRows.length === 0) return null;

      const row: DreNode = {
        id: conta.id,
        nome: conta.nome,
        codigo: conta.codigo || '',
        depth,
        monthly: totalValues,
        total: sumValues(totalValues),
        hasChildren: childRows.length > 0,
      };

      return { rows: [row, ...childRows], monthly: totalValues };
    };

    const receitaRoots = roots.filter((conta) => isReceita(conta.tipo));
    const despesaRoots = roots.filter((conta) => isDespesa(conta.tipo));

    const receitaBranches = receitaRoots.map((conta) => buildBranch(conta, 0)).filter(Boolean) as DreBranch[];
    const despesaBranches = despesaRoots.map((conta) => buildBranch(conta, 0)).filter(Boolean) as DreBranch[];

    const receitaRows = receitaBranches.flatMap((branch) => branch.rows);
    const despesaRows = despesaBranches.flatMap((branch) => branch.rows);

    const receitaMonthly = Array.from({ length: 12 }, () => 0);
    const despesaMonthly = Array.from({ length: 12 }, () => 0);

    receitaBranches.forEach((branch) => {
      branch.monthly.forEach((value, index) => {
        receitaMonthly[index] += value;
      });
    });

    despesaBranches.forEach((branch) => {
      branch.monthly.forEach((value, index) => {
        despesaMonthly[index] += value;
      });
    });

    const resultadoMonthly = receitaMonthly.map((value, index) => value - despesaMonthly[index]);

    return {
      contaPorId,
      descendantsById,
      receitaRows,
      despesaRows,
      receitaMonthly,
      despesaMonthly,
      resultadoMonthly,
      receitaTotal: sumValues(receitaMonthly),
      despesaTotal: sumValues(despesaMonthly),
      resultadoTotal: sumValues(resultadoMonthly),
    };
  }, [categorias, lancamentos]);

  useEffect(() => {
    if (!selectedContaId) return;
    if (!dre.contaPorId.has(selectedContaId)) {
      setSelectedContaId(null);
      setSelectedMonth(null);
    }
  }, [dre.contaPorId, selectedContaId]);

  const monthLabels = useMemo(() => buildMonthLabels(ano), [ano]);

  const selectedConta = selectedContaId ? dre.contaPorId.get(selectedContaId) || null : null;

  const selectedRows = useMemo(() => {
    if (!selectedContaId) return [] as LancamentoResumo[];
    const ids = new Set(dre.descendantsById.get(selectedContaId) || [selectedContaId]);
    return lancamentos
      .filter((item) => ids.has(Number(item.plano_contas_id)) && (selectedMonth === null || parseMonthIndex(item.data_vencimento) === selectedMonth))
      .sort((left, right) => new Date(`${right.data_vencimento.slice(0, 10)}T00:00:00`).getTime() - new Date(`${left.data_vencimento.slice(0, 10)}T00:00:00`).getTime());
  }, [dre.descendantsById, lancamentos, selectedContaId, selectedMonth]);

  const selectedMonthly = useMemo(() => {
    if (!selectedContaId) return Array.from({ length: 12 }, () => 0);
    const ids = new Set(dre.descendantsById.get(selectedContaId) || [selectedContaId]);
    const monthly = Array.from({ length: 12 }, () => 0);
    lancamentos.forEach((item) => {
      if (!ids.has(Number(item.plano_contas_id))) return;
      const monthIndex = parseMonthIndex(item.data_vencimento);
      if (monthIndex < 0) return;
      monthly[monthIndex] += Number(item.valor_previsto || 0);
    });
    return monthly;
  }, [dre.descendantsById, lancamentos, selectedContaId]);

  const pageBg = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_48%,#111827_100%)] text-slate-100'
    : 'bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-900';

  return (
    <div className={`min-h-full px-3 py-6 sm:px-4 lg:px-6 ${pageBg}`}>
      <div className="w-full space-y-6">
        <section className={`rounded-[30px] border px-6 py-6 shadow-[0_30px_90px_-60px_rgba(15,23,42,0.45)] md:px-8 ${isDark ? 'border-slate-800 bg-slate-950/70' : 'border-slate-200 bg-white'}`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className={`text-[11px] font-black uppercase tracking-[0.3em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Demonstrativo</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">DRE</h1>
              <p className={`mt-2 text-sm font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Clique em uma categoria ou em um mês para abrir os lançamentos relacionados logo abaixo.</p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className={`rounded-[22px] border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <label className={`block text-[10px] font-black uppercase tracking-[0.24em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Ano</label>
                <div className="mt-2 flex items-center gap-3">
                  <CalendarDays className={`h-4 w-4 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={ano}
                    onChange={(event) => {
                      setAno(Number(event.target.value) || currentYear);
                      setSelectedMonth(null);
                    }}
                    className={`w-28 border-none bg-transparent p-0 text-lg font-black outline-none ${isDark ? 'text-white' : 'text-slate-900'}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className={`rounded-3xl border px-5 py-4 text-sm font-semibold ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <MetricCard label="Receita total" value={moneyFormatter.format(dre.receitaTotal)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} isDark={isDark} />
          <MetricCard label="Despesa total" value={moneyFormatter.format(dre.despesaTotal)} tone="rose" icon={<TrendingDown className="h-5 w-5" />} isDark={isDark} />
          <MetricCard label="Resultado" value={moneyFormatter.format(dre.resultadoTotal)} tone="slate" icon={<Sigma className="h-5 w-5" />} isDark={isDark} />
        </section>

        <section className={`overflow-hidden rounded-[30px] border shadow-[0_25px_90px_-65px_rgba(15,23,42,0.45)] ${isDark ? 'border-slate-800 bg-slate-950/75' : 'border-slate-200 bg-white'}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1520px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-slate-800 bg-slate-950 px-5 py-4 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white">Conta</th>
                  <th className="border-b border-r border-slate-800 bg-slate-950 px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white">Total</th>
                  {monthLabels.map((label) => (
                    <th key={label} className="border-b border-r border-slate-800 bg-slate-950 px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white last:border-r-0">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-emerald-300/30 bg-emerald-600 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white">Receitas</td>
                  <td className={`border-b border-r border-emerald-300/30 px-4 py-3 text-right font-black ${isDark ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>{renderMoneyCell(dre.receitaTotal, 'receita')}</td>
                  {dre.receitaMonthly.map((value, index) => (
                    <td key={`receita-total-${index}`} className={`border-b border-r border-emerald-300/30 px-4 py-3 text-right font-bold last:border-r-0 ${isDark ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>{renderMoneyCell(value, 'receita')}</td>
                  ))}
                </tr>

                {loading ? (
                  <tr>
                    <td colSpan={14} className={`px-5 py-12 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Carregando demonstrativo...</td>
                  </tr>
                ) : dre.receitaRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className={`px-5 py-12 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Sem receitas classificadas para este ano.</td>
                  </tr>
                ) : dre.receitaRows.map((row, rowIndex) => {
                  const isSelected = selectedContaId === row.id;
                  return (
                    <tr key={`receita-row-${row.id}`} className={rowIndex % 2 === 0 ? (isDark ? 'bg-slate-950/20' : 'bg-white') : (isDark ? 'bg-slate-900/30' : 'bg-slate-50/60')}>
                      <td
                        onClick={() => {
                          setSelectedContaId((prev) => prev === row.id ? null : row.id);
                          setSelectedMonth(null);
                        }}
                        className={`sticky left-0 z-1 cursor-pointer border-b border-r px-5 py-3 transition ${isSelected ? 'ring-1 ring-inset ring-sky-400/60' : ''} ${row.hasChildren ? isDark ? 'border-slate-700 bg-emerald-500/10 font-black text-white' : 'border-slate-200 bg-emerald-50 font-black text-slate-900' : isDark ? rowIndex % 2 === 0 ? 'border-slate-800 bg-slate-950/20 font-semibold text-slate-300' : 'border-slate-800 bg-slate-900/30 font-semibold text-slate-300' : rowIndex % 2 === 0 ? 'border-slate-200 bg-white font-semibold text-slate-600' : 'border-slate-200 bg-slate-50/60 font-semibold text-slate-600'}`}
                      >
                        <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 18}px` }}>
                          <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                        </div>
                      </td>
                      <td
                        onClick={() => {
                          setSelectedContaId(row.id);
                          setSelectedMonth(null);
                        }}
                        className={`cursor-pointer border-b border-r px-4 py-3 text-right ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? isDark ? 'font-black text-white' : 'font-black text-slate-900' : isDark ? 'font-medium text-slate-300' : 'font-medium text-slate-600'}`}
                      >
                        {renderMoneyCell(row.total, 'receita')}
                      </td>
                      {row.monthly.map((value, index) => (
                        <td
                          key={`receita-value-${row.id}-${index}`}
                          onClick={() => {
                            setSelectedContaId(row.id);
                            setSelectedMonth(index);
                          }}
                          className={`cursor-pointer border-b border-r px-4 py-3 text-right transition last:border-r-0 ${selectedContaId === row.id && selectedMonth === index ? isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-700' : ''} ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? isDark ? 'font-bold text-slate-100' : 'font-bold text-slate-800' : isDark ? 'font-medium text-slate-400' : 'font-medium text-slate-500'}`}
                        >
                          {renderMoneyCell(value, 'receita')}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-rose-300/30 bg-rose-600 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white">Despesas</td>
                  <td className={`border-b border-r border-rose-300/30 px-4 py-3 text-right font-black ${isDark ? 'bg-rose-500/10 text-rose-200' : 'bg-rose-50 text-rose-700'}`}>{renderMoneyCell(dre.despesaTotal, 'despesa')}</td>
                  {dre.despesaMonthly.map((value, index) => (
                    <td key={`despesa-total-${index}`} className={`border-b border-r border-rose-300/30 px-4 py-3 text-right font-bold last:border-r-0 ${isDark ? 'bg-rose-500/10 text-rose-200' : 'bg-rose-50 text-rose-700'}`}>{renderMoneyCell(value, 'despesa')}</td>
                  ))}
                </tr>

                {loading ? null : dre.despesaRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className={`px-5 py-12 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Sem despesas classificadas para este ano.</td>
                  </tr>
                ) : dre.despesaRows.map((row, rowIndex) => {
                  const isSelected = selectedContaId === row.id;
                  return (
                    <tr key={`despesa-row-${row.id}`} className={rowIndex % 2 === 0 ? (isDark ? 'bg-slate-950/20' : 'bg-white') : (isDark ? 'bg-slate-900/30' : 'bg-slate-50/60')}>
                      <td
                        onClick={() => {
                          setSelectedContaId((prev) => prev === row.id ? null : row.id);
                          setSelectedMonth(null);
                        }}
                        className={`sticky left-0 z-1 cursor-pointer border-b border-r px-5 py-3 transition ${isSelected ? 'ring-1 ring-inset ring-sky-400/60' : ''} ${row.hasChildren ? isDark ? 'border-slate-700 bg-rose-500/10 font-black text-white' : 'border-slate-200 bg-rose-50 font-black text-slate-900' : isDark ? rowIndex % 2 === 0 ? 'border-slate-800 bg-slate-950/20 font-semibold text-slate-300' : 'border-slate-800 bg-slate-900/30 font-semibold text-slate-300' : rowIndex % 2 === 0 ? 'border-slate-200 bg-white font-semibold text-slate-600' : 'border-slate-200 bg-slate-50/60 font-semibold text-slate-600'}`}
                      >
                        <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 18}px` }}>
                          <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                        </div>
                      </td>
                      <td
                        onClick={() => {
                          setSelectedContaId(row.id);
                          setSelectedMonth(null);
                        }}
                        className={`cursor-pointer border-b border-r px-4 py-3 text-right ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? isDark ? 'font-black text-white' : 'font-black text-slate-900' : isDark ? 'font-medium text-slate-300' : 'font-medium text-slate-600'}`}
                      >
                        {renderMoneyCell(row.total, 'despesa')}
                      </td>
                      {row.monthly.map((value, index) => (
                        <td
                          key={`despesa-value-${row.id}-${index}`}
                          onClick={() => {
                            setSelectedContaId(row.id);
                            setSelectedMonth(index);
                          }}
                          className={`cursor-pointer border-b border-r px-4 py-3 text-right transition last:border-r-0 ${selectedContaId === row.id && selectedMonth === index ? isDark ? 'bg-sky-500/15 text-sky-200' : 'bg-sky-50 text-sky-700' : ''} ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? isDark ? 'font-bold text-slate-100' : 'font-bold text-slate-800' : isDark ? 'font-medium text-slate-400' : 'font-medium text-slate-500'}`}
                        >
                          {renderMoneyCell(value, 'despesa')}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Resultado</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black ${dre.resultadoTotal >= 0 ? isDark ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-100 text-emerald-700' : isDark ? 'bg-rose-500/10 text-rose-200' : 'bg-rose-100 text-rose-700'}`}>
                    {renderMoneyCell(dre.resultadoTotal, 'resultado')}
                  </td>
                  {dre.resultadoMonthly.map((value, index) => (
                    <td key={`resultado-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${value >= 0 ? isDark ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-50 text-emerald-700' : isDark ? 'bg-rose-500/10 text-rose-200' : 'bg-rose-50 text-rose-700'}`}>
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {selectedConta ? (
          <section className={`rounded-[30px] border px-5 py-5 shadow-[0_25px_90px_-70px_rgba(15,23,42,0.45)] md:px-6 ${isDark ? 'border-slate-800 bg-slate-950/70' : 'border-slate-200 bg-white'}`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.28em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Drilldown DRE</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight">{selectedConta.codigo ? `${selectedConta.codigo} ${selectedConta.nome}` : selectedConta.nome}</h2>
                <p className={`mt-1 text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{selectedMonth === null ? 'Todos os meses do ano selecionado.' : `Lançamentos de ${monthLabels[selectedMonth]}.`}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedContaId(null);
                  setSelectedMonth(null);
                }}
                className={`rounded-2xl border px-4 py-2 text-sm font-bold transition ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                Fechar detalhe
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedMonth(null)}
                className={`rounded-2xl px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${selectedMonth === null ? 'bg-sky-600 text-white' : isDark ? 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800' : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                Ano inteiro
              </button>
              {monthLabels.map((label, index) => (
                <button
                  key={label}
                  onClick={() => setSelectedMonth(index)}
                  className={`rounded-2xl px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition ${selectedMonth === index ? 'bg-sky-600 text-white' : isDark ? 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800' : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                >
                  {label} • {renderMoneyCell(selectedMonthly[index], selectedConta.tipo?.toUpperCase().startsWith('R') ? 'receita' : 'despesa')}
                </button>
              ))}
            </div>

            <div className={`mt-5 overflow-hidden rounded-[24px] border ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className={isDark ? 'bg-slate-900 text-slate-400' : 'bg-slate-50 text-slate-500'}>
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em]">Data</th>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em]">Descrição</th>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em]">Categoria</th>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em]">Status</th>
                      <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className={isDark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-100'}>
                    {selectedRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className={`px-4 py-10 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Nenhum lançamento encontrado para este recorte.</td>
                      </tr>
                    ) : selectedRows.map((item) => {
                      const itemConta = dre.contaPorId.get(Number(item.plano_contas_id));
                      return (
                        <tr key={item.id} className={isDark ? 'bg-slate-950/20 hover:bg-slate-900/40' : 'bg-white hover:bg-slate-50'}>
                          <td className={`px-4 py-3 font-mono text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{formatDate(item.data_pagamento || item.data_vencimento)}</td>
                          <td className={`px-4 py-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>{item.descricao}</td>
                          <td className={`px-4 py-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{itemConta?.nome || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${item.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                              {item.status || 'PENDENTE'}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-right font-black ${isReceita(item.tipo) ? 'text-emerald-500' : 'text-rose-500'}`}>{moneyFormatter.format(Number(item.valor_previsto || item.valor_pago || 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}