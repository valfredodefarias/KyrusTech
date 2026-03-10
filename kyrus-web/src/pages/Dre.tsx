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
  tipo: string;
  plano_contas_id?: number | null;
  valor_previsto: number;
  data_vencimento: string;
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

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'slate';
  icon: React.ReactNode;
}) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div className={`rounded-3xl border px-5 py-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-60">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className="rounded-2xl border border-current/10 bg-white/80 p-3">{icon}</div>
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

    const buildBranch = (conta: PlanoConta, depth: number): { rows: DreNode[]; monthly: number[] } | null => {
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

    const receitaBranches = receitaRoots.map((conta) => buildBranch(conta, 0)).filter(Boolean) as Array<{ rows: DreNode[]; monthly: number[] }>;
    const despesaBranches = despesaRoots.map((conta) => buildBranch(conta, 0)).filter(Boolean) as Array<{ rows: DreNode[]; monthly: number[] }>;

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

  const monthLabels = useMemo(() => buildMonthLabels(ano), [ano]);

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-screen-2xl space-y-6">
        <section className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_30px_90px_-60px_rgba(15,23,42,0.45)] md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Demonstrativo</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">DRE</h1>
              <p className="mt-2 text-sm font-medium text-slate-500">Jan a dez com totais por conta e subtotal por estrutura.</p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                <label className="block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Ano</label>
                <div className="mt-2 flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={ano}
                    onChange={(event) => setAno(Number(event.target.value) || currentYear)}
                    className="w-28 border-none bg-transparent p-0 text-lg font-black text-slate-900 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-3">
          <MetricCard label="Receita total" value={moneyFormatter.format(dre.receitaTotal)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
          <MetricCard label="Despesa total" value={moneyFormatter.format(dre.despesaTotal)} tone="rose" icon={<TrendingDown className="h-5 w-5" />} />
          <MetricCard label="Resultado" value={moneyFormatter.format(dre.resultadoTotal)} tone="slate" icon={<Sigma className="h-5 w-5" />} />
        </section>

        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_25px_90px_-65px_rgba(15,23,42,0.45)]">
          <div className="overflow-x-auto">
            <table className="min-w-max w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-slate-200 bg-slate-950 px-5 py-4 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white">Conta</th>
                  <th className="border-b border-r border-slate-200 bg-slate-950 px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white">Total</th>
                  {monthLabels.map((label) => (
                    <th key={label} className="border-b border-r border-slate-200 bg-slate-950 px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.18em] text-white last:border-r-0">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-emerald-200 bg-emerald-600 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white">Receitas</td>
                  <td className="border-b border-r border-emerald-200 bg-emerald-50 px-4 py-3 text-right font-black text-emerald-700">{renderMoneyCell(dre.receitaTotal, 'receita')}</td>
                  {dre.receitaMonthly.map((value, index) => (
                    <td key={`receita-total-${index}`} className="border-b border-r border-emerald-200 bg-emerald-50 px-4 py-3 text-right font-bold text-emerald-700 last:border-r-0">{renderMoneyCell(value, 'receita')}</td>
                  ))}
                </tr>

                {loading ? (
                  <tr>
                    <td colSpan={14} className="px-5 py-12 text-center text-sm font-semibold text-slate-400">Carregando demonstrativo...</td>
                  </tr>
                ) : dre.receitaRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-5 py-12 text-center text-sm font-semibold text-slate-400">Sem receitas classificadas para este ano.</td>
                  </tr>
                ) : dre.receitaRows.map((row, rowIndex) => (
                  <tr key={`receita-row-${row.id}`} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className={`sticky left-0 z-1 border-b border-r border-slate-200 px-5 py-3 ${row.hasChildren ? 'bg-emerald-50 font-black text-slate-900' : rowIndex % 2 === 0 ? 'bg-white font-semibold text-slate-600' : 'bg-slate-50/60 font-semibold text-slate-600'}`}>
                      <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 18}px` }}>
                        <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                      </div>
                    </td>
                    <td className={`border-b border-r border-slate-200 px-4 py-3 text-right ${row.hasChildren ? 'font-black text-slate-900' : 'font-medium text-slate-600'}`}>{renderMoneyCell(row.total, 'receita')}</td>
                    {row.monthly.map((value, index) => (
                      <td key={`receita-value-${row.id}-${index}`} className={`border-b border-r border-slate-200 px-4 py-3 text-right ${row.hasChildren ? 'font-bold text-slate-800' : 'font-medium text-slate-500'} last:border-r-0`}>
                        {renderMoneyCell(value, 'receita')}
                      </td>
                    ))}
                  </tr>
                ))}

                <tr>
                  <td className="sticky left-0 z-10 border-b border-r border-rose-200 bg-rose-600 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white">Despesas</td>
                  <td className="border-b border-r border-rose-200 bg-rose-50 px-4 py-3 text-right font-black text-rose-700">{renderMoneyCell(dre.despesaTotal, 'despesa')}</td>
                  {dre.despesaMonthly.map((value, index) => (
                    <td key={`despesa-total-${index}`} className="border-b border-r border-rose-200 bg-rose-50 px-4 py-3 text-right font-bold text-rose-700 last:border-r-0">{renderMoneyCell(value, 'despesa')}</td>
                  ))}
                </tr>

                {loading ? null : dre.despesaRows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-5 py-12 text-center text-sm font-semibold text-slate-400">Sem despesas classificadas para este ano.</td>
                  </tr>
                ) : dre.despesaRows.map((row, rowIndex) => (
                  <tr key={`despesa-row-${row.id}`} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className={`sticky left-0 z-1 border-b border-r border-slate-200 px-5 py-3 ${row.hasChildren ? 'bg-rose-50 font-black text-slate-900' : rowIndex % 2 === 0 ? 'bg-white font-semibold text-slate-600' : 'bg-slate-50/60 font-semibold text-slate-600'}`}>
                      <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 18}px` }}>
                        <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                      </div>
                    </td>
                    <td className={`border-b border-r border-slate-200 px-4 py-3 text-right ${row.hasChildren ? 'font-black text-slate-900' : 'font-medium text-slate-600'}`}>{renderMoneyCell(row.total, 'despesa')}</td>
                    {row.monthly.map((value, index) => (
                      <td key={`despesa-value-${row.id}-${index}`} className={`border-b border-r border-slate-200 px-4 py-3 text-right ${row.hasChildren ? 'font-bold text-slate-800' : 'font-medium text-slate-500'} last:border-r-0`}>
                        {renderMoneyCell(value, 'despesa')}
                      </td>
                    ))}
                  </tr>
                ))}

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Resultado</td>
                  <td className={`border-r border-slate-200 px-4 py-4 text-right text-sm font-black ${dre.resultadoTotal >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                    {renderMoneyCell(dre.resultadoTotal, 'resultado')}
                  </td>
                  {dre.resultadoMonthly.map((value, index) => (
                    <td key={`resultado-${index}`} className={`border-r border-slate-200 px-4 py-4 text-right text-sm font-black last:border-r-0 ${value >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}