import { Fragment, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Sigma, TrendingDown, TrendingUp } from 'lucide-react';

import { api } from '../services/api';
import { buildOperationalCategoriaIds } from '../utils/planoContas';

interface PlanoConta {
  id: number;
  nome: string;
  tipo: string;
  codigo?: string | null;
  eh_operacional?: boolean;
  considerar_nos_resultados?: boolean;
  dre_grupo?: string;
  permite_lancamentos?: boolean;
  conta_pai_id?: number | null;
}

interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status?: string;
  plano_contas_id?: number | null;
  centro_custo_id?: number | null;
  valor_previsto: number;
  valor_pago?: number | null;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia?: string | null;
  competencia?: string | null;
}

interface CentroCustoResumo {
  id: number;
  nome: string;
  codigo?: string | null;
}

interface DreNode {
  id: number;
  nome: string;
  codigo: string;
  depth: number;
  monthly: number[];
  total: number;
  hasChildren: boolean;
  isOperationalInherited: boolean;
  grupoExibicao: DreDisplayGroupKey;
  tipoCategoria: 'RECEITA' | 'DESPESA';
}

type DreBranch = {
  rows: DreNode[];
  monthly: number[];
};

type DreDisplayGroupKey =
  | 'RECEITAS_OPERACIONAIS'
  | 'ABATIMENTO_VENDAS'
  | 'CUSTOS'
  | 'DESPESAS_OPERACIONAIS'
  | 'RECEITAS_NAO_OPERACIONAIS'
  | 'DESPESAS_NAO_OPERACIONAIS';

const DRE_DISPLAY_GROUPS: Array<{ key: DreDisplayGroupKey; label: string; tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'teal' | 'fuchsia' }> = [
  { key: 'RECEITAS_OPERACIONAIS', label: 'Receitas Operacionais', tone: 'emerald' },
  { key: 'ABATIMENTO_VENDAS', label: 'Abatimento de vendas', tone: 'amber' },
  { key: 'CUSTOS', label: 'Custos', tone: 'orange' },
  { key: 'DESPESAS_OPERACIONAIS', label: 'Despesas Operacionais', tone: 'rose' },
  { key: 'RECEITAS_NAO_OPERACIONAIS', label: 'Receitas não operacionais', tone: 'teal' },
  { key: 'DESPESAS_NAO_OPERACIONAIS', label: 'Despesas não operacionais', tone: 'fuchsia' },
];

const MONTH_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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

function parseCompetenciaMonthIndex(competencia?: string | null) {
  if (!competencia) return -1;
  const match = String(competencia).trim().match(/^(\d{2})-(\d{4})$/);
  if (!match) return -1;
  const month = Number(match[1]);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month - 1 : -1;
}

function isLancamentoPago(lancamento: LancamentoResumo) {
  const status = String(lancamento.status || '').toUpperCase();
  const valorPago = Number(lancamento.valor_pago || 0);
  return status === 'PAGO' || Boolean(lancamento.data_pagamento) || valorPago !== 0;
}

function resolveCompetenciaDate(lancamento: LancamentoResumo, somentePagos = false) {
  if (somentePagos) return lancamento.data_pagamento || null;
  return lancamento.data_competencia || lancamento.data_vencimento || null;
}

function resolveMonthIndex(lancamento: LancamentoResumo, somentePagos = false) {
  if (!somentePagos) {
    const competenciaIndex = parseCompetenciaMonthIndex(lancamento.competencia);
    if (competenciaIndex >= 0) return competenciaIndex;
  }
  return parseMonthIndex(resolveCompetenciaDate(lancamento, somentePagos));
}

function resolveLancamentoValue(lancamento: LancamentoResumo, somentePagos = false) {
  const valorPago = Number(lancamento.valor_pago || 0);
  if (somentePagos) return valorPago;
  if (lancamento.data_pagamento || valorPago !== 0) {
    return valorPago !== 0 ? valorPago : Number(lancamento.valor_previsto || 0);
  }
  return Number(lancamento.valor_previsto || 0);
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

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
  onMouseEnter,
  onMouseLeave,
}: {
  label: string;
  value: React.ReactNode;
  tone: 'emerald' | 'rose' | 'slate';
  icon: React.ReactNode;
  isDark: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const toneClass = {
    emerald: isDark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
    rose: isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700',
    slate: isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];

  return (
    <div
      className={`rounded-3xl border px-5 py-4 ${toneClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
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
  let display = 'R$ 0';
  if (Math.abs(value) >= 0.009) {
    if (tone === 'resultado' && value < 0) {
      display = `-\u00A0${moneyFormatter.format(Math.abs(value))}`;
    } else {
      display = moneyFormatter.format(tone === 'resultado' ? value : Math.abs(value));
    }
  }
  return <span className="whitespace-nowrap tabular-nums">{display}</span>;
}

function renderOptionalMoney(value?: number | null, tone?: 'receita' | 'despesa' | 'resultado') {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="whitespace-nowrap tabular-nums">-</span>;
  return renderMoneyCell(value, tone);
}

function renderPercentCell(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="whitespace-nowrap tabular-nums">-</span>;
  return <span className="whitespace-nowrap tabular-nums">{percentFormatter.format(value)}</span>;
}

export function Dre() {
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentMonth = useMemo(() => new Date().getMonth(), []);
  const [ano, setAno] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<PlanoConta[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoResumo[]>([]);
  const [selectedCentroCustoId, setSelectedCentroCustoId] = useState<number | 'ALL'>('ALL');
  const [selectedContaId, setSelectedContaId] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(currentMonth);
  const [hoveredKpi, setHoveredKpi] = useState<string | null>(null);
  const [somentePagos, setSomentePagos] = useState(true);
  const isDark = useIsDarkMode();

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const inicio = `${ano}-01-01`;
        const fim = `${ano}-12-31`;
        const [categoriasRes, lancamentosRes, centrosCustoRes] = await Promise.all([
          api.get<PlanoConta[]>('/plano-contas/'),
          api.get<LancamentoResumo[]>('/lancamentos/', { params: { limit: 10000, data_inicio: inicio, data_fim: fim } }),
          api.get<CentroCustoResumo[]>('/centro-custo/'),
        ]);

        if (!active) return;

        setCategorias(categoriasRes.data || []);
        setLancamentos(lancamentosRes.data || []);
        setCentrosCusto(centrosCustoRes.data || []);
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

  const lancamentosFiltrados = useMemo(() => {
    return lancamentos.filter((item) => {
      if (selectedCentroCustoId !== 'ALL' && Number(item.centro_custo_id) !== selectedCentroCustoId) return false;
      if (somentePagos && !isLancamentoPago(item)) return false;
      return true;
    });
  }, [lancamentos, selectedCentroCustoId, somentePagos]);

  const dre = useMemo(() => {
    const relevantes = categorias.filter((conta) => isReceita(conta.tipo) || isDespesa(conta.tipo));
    const categoriasOperacionais = buildOperationalCategoriaIds(relevantes);

    const contaPorId = new Map<number, PlanoConta>();
    const filhosPorPai = new Map<number | null, PlanoConta[]>();
    const valoresDiretos = new Map<number, number[]>();
    const receitaOperacionalMonthly = Array.from({ length: 12 }, () => 0);
    const deducoesMonthly = Array.from({ length: 12 }, () => 0);
    const custosVariaveisMonthly = Array.from({ length: 12 }, () => 0);
    const despesaOperacionalCoreMonthly = Array.from({ length: 12 }, () => 0);
    const outrasReceitasMonthly = Array.from({ length: 12 }, () => 0);
    const outrasDespesasMonthly = Array.from({ length: 12 }, () => 0);

    relevantes.forEach((conta) => {
      contaPorId.set(conta.id, conta);
      const parentId = conta.conta_pai_id ?? null;
      const list = filhosPorPai.get(parentId) || [];
      list.push(conta);
      filhosPorPai.set(parentId, list);
    });

    const classificarHeuristicaLegada = (contaId: number): 'DEDUCOES_RECEITA' | 'CUSTOS_VARIAVEIS' | 'DESPESAS_OPERACIONAIS' => {
      const partes: string[] = [];
      const visitados = new Set<number>();
      let atual = contaPorId.get(contaId);

      while (atual && !visitados.has(Number(atual.id))) {
        visitados.add(Number(atual.id));
        partes.push(normalizeText(atual.nome));
        const parentId = atual.conta_pai_id ? Number(atual.conta_pai_id) : 0;
        atual = parentId > 0 ? contaPorId.get(parentId) : undefined;
      }

      const trilha = partes.join(' ');
      if (/(abatimento|deducao|deducoes|devolucao|devolucoes|imposto sobre faturamento|impostos de faturamento)/.test(trilha)) {
        return 'DEDUCOES_RECEITA';
      }
      if (/(custos|custo|cmv|cpv|custo dos produtos|custo dos servicos|fornecedores|materia prima|mercadoria vendida)/.test(trilha)) {
        return 'CUSTOS_VARIAVEIS';
      }
      return 'DESPESAS_OPERACIONAIS';
    };

    const resolverDreGrupo = (contaId: number): string => {
      const conta = contaPorId.get(contaId);
      const grupoNormalizado = String(conta?.dre_grupo || '').trim().toUpperCase();
      if (grupoNormalizado) return grupoNormalizado;

      if (conta && isReceita(conta.tipo)) return 'RECEITA_BRUTA';
      return classificarHeuristicaLegada(contaId);
    };

    const resolverGrupoExibicao = (contaId: number): DreDisplayGroupKey => {
      const conta = contaPorId.get(contaId);
      const tipoReceita = Boolean(conta && isReceita(conta.tipo));
      const grupo = resolverDreGrupo(contaId);

      if (grupo === 'DEDUCOES_RECEITA') return 'ABATIMENTO_VENDAS';
      if (grupo === 'CUSTOS_VARIAVEIS') return 'CUSTOS';
      if (grupo === 'DESPESAS_OPERACIONAIS') return 'DESPESAS_OPERACIONAIS';
      if (grupo === 'OUTRAS_RECEITAS') return 'RECEITAS_NAO_OPERACIONAIS';
      if (grupo === 'OUTRAS_DESPESAS') return 'DESPESAS_NAO_OPERACIONAIS';
      if (grupo === 'NAO_OPERACIONAL') return tipoReceita ? 'RECEITAS_NAO_OPERACIONAIS' : 'DESPESAS_NAO_OPERACIONAIS';
      return tipoReceita ? 'RECEITAS_OPERACIONAIS' : 'DESPESAS_OPERACIONAIS';
    };

    lancamentosFiltrados.forEach((lancamento) => {
      const contaId = Number(lancamento.plano_contas_id);
      if (!contaPorId.has(contaId)) return;
      const monthIndex = resolveMonthIndex(lancamento, somentePagos);
      if (monthIndex < 0) return;
      const conta = contaPorId.get(contaId);
      if (!conta) return;
      const dreGrupo = resolverDreGrupo(contaId);
      if (dreGrupo === 'NAO_OPERACIONAL') return;
      const value = resolveLancamentoValue(lancamento, somentePagos);
      const values = valoresDiretos.get(contaId) || Array.from({ length: 12 }, () => 0);
      values[monthIndex] += value;
      valoresDiretos.set(contaId, values);

      if (isReceita(conta.tipo)) {
        if (dreGrupo === 'OUTRAS_RECEITAS') {
          outrasReceitasMonthly[monthIndex] += value;
        } else if (dreGrupo !== 'NAO_OPERACIONAL') {
          receitaOperacionalMonthly[monthIndex] += value;
        }
      }

      if (isDespesa(conta.tipo)) {
        if (dreGrupo === 'DEDUCOES_RECEITA') {
          deducoesMonthly[monthIndex] += value;
        } else if (dreGrupo === 'CUSTOS_VARIAVEIS') {
          custosVariaveisMonthly[monthIndex] += value;
        } else if (dreGrupo === 'OUTRAS_DESPESAS') {
          outrasDespesasMonthly[monthIndex] += value;
        } else if (dreGrupo !== 'NAO_OPERACIONAL' && categoriasOperacionais.has(contaId)) {
          despesaOperacionalCoreMonthly[monthIndex] += value;
        }
      }
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

    const buildBranch = (conta: PlanoConta, depth: number, parentOperational: boolean): DreBranch | null => {
      const ownValues = [...(valoresDiretos.get(conta.id) || Array.from({ length: 12 }, () => 0))];
      const children = sortAccounts(filhosPorPai.get(conta.id) || []);
      const childRows: DreNode[] = [];
      const totalValues = [...ownValues];
      const ownOperational = conta.eh_operacional !== false;
      const effectiveOperational = parentOperational || ownOperational;
      const inheritedOnly = parentOperational && conta.eh_operacional === false;

      children.forEach((child) => {
        const branch = buildBranch(child, depth + 1, effectiveOperational);
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
        isOperationalInherited: inheritedOnly,
        grupoExibicao: resolverGrupoExibicao(conta.id),
        tipoCategoria: isReceita(conta.tipo) ? 'RECEITA' : 'DESPESA',
      };

      return { rows: [row, ...childRows], monthly: totalValues };
    };

    const allBranches = roots.map((conta) => buildBranch(conta, 0, false)).filter(Boolean) as DreBranch[];

    const groupedRows: Record<DreDisplayGroupKey, DreNode[]> = {
      RECEITAS_OPERACIONAIS: [],
      ABATIMENTO_VENDAS: [],
      CUSTOS: [],
      DESPESAS_OPERACIONAIS: [],
      RECEITAS_NAO_OPERACIONAIS: [],
      DESPESAS_NAO_OPERACIONAIS: [],
    };

    const groupedMonthly: Record<DreDisplayGroupKey, number[]> = {
      RECEITAS_OPERACIONAIS: Array.from({ length: 12 }, () => 0),
      ABATIMENTO_VENDAS: Array.from({ length: 12 }, () => 0),
      CUSTOS: Array.from({ length: 12 }, () => 0),
      DESPESAS_OPERACIONAIS: Array.from({ length: 12 }, () => 0),
      RECEITAS_NAO_OPERACIONAIS: Array.from({ length: 12 }, () => 0),
      DESPESAS_NAO_OPERACIONAIS: Array.from({ length: 12 }, () => 0),
    };

    const receitaRows: DreNode[] = [];
    const despesaRows: DreNode[] = [];

    const receitaMonthly = Array.from({ length: 12 }, () => 0);
    const despesaMonthly = Array.from({ length: 12 }, () => 0);

    allBranches.forEach((branch) => {
      const raiz = branch.rows[0];
      if (!raiz) return;
      groupedRows[raiz.grupoExibicao].push(...branch.rows);
      branch.monthly.forEach((value, index) => {
        groupedMonthly[raiz.grupoExibicao][index] += value;
      });

      if (raiz.tipoCategoria === 'RECEITA') {
        receitaRows.push(...branch.rows);
        branch.monthly.forEach((value, index) => {
          receitaMonthly[index] += value;
        });
      } else {
        despesaRows.push(...branch.rows);
        branch.monthly.forEach((value, index) => {
          despesaMonthly[index] += value;
        });
      }
    });

    const receitaLiquidaMonthly = receitaMonthly.map((value, index) => value - deducoesMonthly[index]);
    const margemContribuicaoMonthly = receitaLiquidaMonthly.map((value, index) => value - custosVariaveisMonthly[index]);
    const resultadoOperacionalMonthly = margemContribuicaoMonthly.map((value, index) => value - despesaOperacionalCoreMonthly[index]);
    const resultadoFinalMonthly = resultadoOperacionalMonthly.map((value, index) => value + outrasReceitasMonthly[index] - outrasDespesasMonthly[index]);
    const percentualMcMonthly = receitaLiquidaMonthly.map((value, index) => (value > 0 ? margemContribuicaoMonthly[index] / value : null));
    const lucratividadeOperacionalMonthly = receitaLiquidaMonthly.map((value, index) => (value > 0 ? resultadoOperacionalMonthly[index] / value : null));
    const lucratividadeFinalMonthly = receitaLiquidaMonthly.map((value, index) => (value > 0 ? resultadoFinalMonthly[index] / value : null));
    const pontoEquilibrioMonthly = percentualMcMonthly.map((value, index) => {
      if (value === null || value <= 0) return null;
      return despesaOperacionalCoreMonthly[index] / value;
    });

    const receitaTotal = sumValues(receitaMonthly);
    const despesaTotal = sumValues(despesaMonthly);
    const deducoesTotal = sumValues(deducoesMonthly);
    const custosVariaveisTotal = sumValues(custosVariaveisMonthly);
    const despesaOperacionalCoreTotal = sumValues(despesaOperacionalCoreMonthly);
    const outrasReceitasTotal = sumValues(outrasReceitasMonthly);
    const outrasDespesasTotal = sumValues(outrasDespesasMonthly);
    const receitaLiquidaTotal = sumValues(receitaLiquidaMonthly);
    const margemContribuicaoTotal = sumValues(margemContribuicaoMonthly);
    const resultadoOperacionalTotal = sumValues(resultadoOperacionalMonthly);
    const resultadoFinalTotal = sumValues(resultadoFinalMonthly);
    const percentualMcTotal = receitaLiquidaTotal > 0 ? margemContribuicaoTotal / receitaLiquidaTotal : null;
    const lucratividadeOperacionalTotal = receitaLiquidaTotal > 0 ? resultadoOperacionalTotal / receitaLiquidaTotal : null;
    const lucratividadeFinalTotal = receitaLiquidaTotal > 0 ? resultadoFinalTotal / receitaLiquidaTotal : null;
    const pontoEquilibrioTotal = percentualMcTotal && percentualMcTotal > 0
      ? despesaOperacionalCoreTotal / percentualMcTotal
      : null;

    return {
      contaPorId,
      descendantsById,
      receitaRows,
      despesaRows,
      groupedRows,
      groupedMonthly,
      receitaOperacionalMonthly,
      deducoesMonthly,
      custosVariaveisMonthly,
      despesaOperacionalCoreMonthly,
      outrasReceitasMonthly,
      outrasDespesasMonthly,
      receitaMonthly,
      despesaMonthly,
      deducoesTotal,
      custosVariaveisTotal,
      despesaOperacionalCoreTotal,
      receitaLiquidaMonthly,
      margemContribuicaoMonthly,
      resultadoOperacionalMonthly,
      resultadoFinalMonthly,
      percentualMcMonthly,
      lucratividadeOperacionalMonthly,
      lucratividadeFinalMonthly,
      pontoEquilibrioMonthly,
      receitaTotal,
      despesaTotal,
      outrasReceitasTotal,
      outrasDespesasTotal,
      receitaLiquidaTotal,
      margemContribuicaoTotal,
      resultadoOperacionalTotal,
      resultadoFinalTotal,
      percentualMcTotal,
      lucratividadeOperacionalTotal,
      lucratividadeFinalTotal,
      pontoEquilibrioTotal,
    };
  }, [categorias, lancamentosFiltrados, somentePagos]);

  const kpiBreakdown = useMemo(() => {
    const mcPercent = dre.percentualMcTotal;
    const peExplanation = mcPercent && mcPercent > 0
      ? `${moneyFormatter.format(dre.despesaOperacionalCoreTotal)} / ${percentFormatter.format(mcPercent)}`
      : 'Sem %MC positivo. Revise classificacao em Receita Liquida, Deducoes e Custos Variaveis.';

    return {
      receitaLiquida: {
        title: 'Receita liquida',
        formula: 'Receita bruta - Deducoes da receita',
        detail: `${moneyFormatter.format(dre.receitaTotal)} - ${moneyFormatter.format(dre.deducoesTotal)}`,
      },
      margemContribuicao: {
        title: 'Margem de contribuicao',
        formula: 'Receita liquida - Custos variaveis',
        detail: `${moneyFormatter.format(dre.receitaLiquidaTotal)} - ${moneyFormatter.format(dre.custosVariaveisTotal)}`,
      },
      resultadoOperacional: {
        title: 'Resultado operacional',
        formula: 'Margem de contribuicao - Despesas operacionais',
        detail: `${moneyFormatter.format(dre.margemContribuicaoTotal)} - ${moneyFormatter.format(dre.despesaOperacionalCoreTotal)}`,
      },
      resultadoFinal: {
        title: 'Resultado final',
        formula: 'Resultado operacional + Outras receitas - Outras despesas',
        detail: `${moneyFormatter.format(dre.resultadoOperacionalTotal)} + ${moneyFormatter.format(dre.outrasReceitasTotal)} - ${moneyFormatter.format(dre.outrasDespesasTotal)}`,
      },
      lucratividadeOperacional: {
        title: 'Lucratividade operacional',
        formula: 'Resultado operacional / Receita liquida',
        detail: `${moneyFormatter.format(dre.resultadoOperacionalTotal)} / ${moneyFormatter.format(dre.receitaLiquidaTotal)}`,
      },
      lucratividadeFinal: {
        title: 'Lucratividade final',
        formula: 'Resultado final / Receita liquida',
        detail: `${moneyFormatter.format(dre.resultadoFinalTotal)} / ${moneyFormatter.format(dre.receitaLiquidaTotal)}`,
      },
      percentualMc: {
        title: '% MC',
        formula: 'Margem de contribuicao / Receita liquida',
        detail: `${moneyFormatter.format(dre.margemContribuicaoTotal)} / ${moneyFormatter.format(dre.receitaLiquidaTotal)}`,
      },
      pontoEquilibrio: {
        title: 'Ponto de equilibrio',
        formula: 'Despesas operacionais / %MC',
        detail: peExplanation,
      },
    };
  }, [dre]);

  useEffect(() => {
    if (!selectedContaId) return;
    if (!dre.contaPorId.has(selectedContaId)) {
      setSelectedContaId(null);
      setSelectedMonth(null);
    }
  }, [dre.contaPorId, selectedContaId]);

  const monthLabels = useMemo(() => buildMonthLabels(ano), [ano]);

  const pickMonthlyValue = (monthly: number[], total: number) => {
    if (selectedMonth === null) return total;
    return monthly[selectedMonth] ?? 0;
  };

  const pickMonthlyOptional = (monthly: Array<number | null>, total: number | null) => {
    if (selectedMonth === null) return total;
    return monthly[selectedMonth] ?? null;
  };

  const receitaLiquidaKpi = pickMonthlyValue(dre.receitaLiquidaMonthly, dre.receitaLiquidaTotal);
  const margemContribuicaoKpi = pickMonthlyValue(dre.margemContribuicaoMonthly, dre.margemContribuicaoTotal);
  const resultadoOperacionalKpi = pickMonthlyValue(dre.resultadoOperacionalMonthly, dre.resultadoOperacionalTotal);
  const resultadoFinalKpi = pickMonthlyValue(dre.resultadoFinalMonthly, dre.resultadoFinalTotal);
  const lucratividadeOperacionalKpi = pickMonthlyOptional(dre.lucratividadeOperacionalMonthly, dre.lucratividadeOperacionalTotal);
  const lucratividadeFinalKpi = pickMonthlyOptional(dre.lucratividadeFinalMonthly, dre.lucratividadeFinalTotal);
  const percentualMcKpi = pickMonthlyOptional(dre.percentualMcMonthly, dre.percentualMcTotal);
  const pontoEquilibrioKpi = pickMonthlyOptional(dre.pontoEquilibrioMonthly, dre.pontoEquilibrioTotal);

  const selectedConta = selectedContaId ? dre.contaPorId.get(selectedContaId) || null : null;

  const selectedRows = useMemo(() => {
    if (!selectedContaId) return [] as LancamentoResumo[];
    const ids = new Set(dre.descendantsById.get(selectedContaId) || [selectedContaId]);
    return lancamentosFiltrados
      .filter((item) => ids.has(Number(item.plano_contas_id)) && (selectedMonth === null || resolveMonthIndex(item, somentePagos) === selectedMonth))
      .sort((left, right) => {
        const rightDate = resolveCompetenciaDate(right, somentePagos) || right.data_vencimento || right.data_pagamento || '1900-01-01';
        const leftDate = resolveCompetenciaDate(left, somentePagos) || left.data_vencimento || left.data_pagamento || '1900-01-01';
        return new Date(`${rightDate.slice(0, 10)}T00:00:00`).getTime() - new Date(`${leftDate.slice(0, 10)}T00:00:00`).getTime();
      });
  }, [dre.descendantsById, lancamentosFiltrados, selectedContaId, selectedMonth, somentePagos]);

  const selectedMonthly = useMemo(() => {
    if (!selectedContaId) return Array.from({ length: 12 }, () => 0);
    const ids = new Set(dre.descendantsById.get(selectedContaId) || [selectedContaId]);
    const monthly = Array.from({ length: 12 }, () => 0);
    lancamentosFiltrados.forEach((item) => {
      if (!ids.has(Number(item.plano_contas_id))) return;
      const monthIndex = resolveMonthIndex(item, somentePagos);
      if (monthIndex < 0) return;
      monthly[monthIndex] += resolveLancamentoValue(item, somentePagos);
    });
    return monthly;
  }, [dre.descendantsById, lancamentosFiltrados, selectedContaId, somentePagos]);

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
              <p className={`mt-1 text-xs font-semibold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>KPIs filtrados por: {selectedMonth === null ? 'Ano inteiro' : monthLabels[selectedMonth]}</p>
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
                      setSelectedMonth(currentMonth);
                    }}
                    className={`w-28 border-none bg-transparent p-0 text-lg font-black outline-none ${isDark ? 'text-white' : 'text-slate-900'}`}
                  />
                </div>
              </div>

              <div className={`rounded-[22px] border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <label className={`block text-[10px] font-black uppercase tracking-[0.24em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Mes</label>
                <select
                  value={selectedMonth === null ? 'ALL' : String(selectedMonth)}
                  onChange={(event) => {
                    setSelectedMonth(event.target.value === 'ALL' ? null : Number(event.target.value));
                  }}
                  className="mt-2 w-32 rounded-xl border border-slate-300 bg-white p-2.5 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="ALL">Ano inteiro</option>
                  {monthLabels.map((label, index) => (
                    <option key={`month-select-${label}`} value={index}>{label}</option>
                  ))}
                </select>
              </div>

              <div className={`rounded-[22px] border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <label className={`block text-[10px] font-black uppercase tracking-[0.24em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Centro de custo</label>
                <select
                  value={selectedCentroCustoId === 'ALL' ? 'ALL' : String(selectedCentroCustoId)}
                  onChange={(event) => {
                    setSelectedCentroCustoId(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value));
                    setSelectedContaId(null);
                    setSelectedMonth(currentMonth);
                  }}
                  className="mt-2 w-64 rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="ALL">Todos os centros de custo</option>
                  {centrosCusto.map((centro) => (
                    <option key={centro.id} value={centro.id}>
                      {centro.codigo ? `${centro.codigo} - ` : ''}{centro.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className={`rounded-[22px] border px-4 py-3 ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <label className={`block text-[10px] font-black uppercase tracking-[0.24em] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Lançamentos</label>
                <button
                  type="button"
                  onClick={() => {
                    setSomentePagos((prev) => !prev);
                    setSelectedContaId(null);
                    setSelectedMonth(currentMonth);
                  }}
                  className={`mt-2 w-44 rounded-xl border px-3 py-2 text-sm font-black transition ${somentePagos ? 'border-emerald-600 bg-emerald-600 text-white' : isDark ? 'border-slate-600 bg-slate-800 text-slate-200' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  {somentePagos ? 'Somente pagos' : 'Pagos + previstos'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className={`rounded-3xl border px-5 py-4 text-sm font-semibold ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Receita líquida" value={moneyFormatter.format(receitaLiquidaKpi)} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('receitaLiquida')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Margem de contribuição" value={moneyFormatter.format(margemContribuicaoKpi)} tone="slate" icon={<Sigma className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('margemContribuicao')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Resultado operacional" value={moneyFormatter.format(resultadoOperacionalKpi)} tone="slate" icon={<CalendarDays className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('resultadoOperacional')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Resultado final" value={moneyFormatter.format(resultadoFinalKpi)} tone="slate" icon={<TrendingDown className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('resultadoFinal')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Lucratividade operacional" value={renderPercentCell(lucratividadeOperacionalKpi)} tone="slate" icon={<Sigma className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('lucratividadeOperacional')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Lucratividade final" value={renderPercentCell(lucratividadeFinalKpi)} tone="slate" icon={<Sigma className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('lucratividadeFinal')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="% MC" value={renderPercentCell(percentualMcKpi)} tone="slate" icon={<Sigma className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('percentualMc')} onMouseLeave={() => setHoveredKpi(null)} />
          <MetricCard label="Ponto de equilíbrio" value={renderOptionalMoney(pontoEquilibrioKpi, 'resultado')} tone="slate" icon={<CalendarDays className="h-5 w-5" />} isDark={isDark} onMouseEnter={() => setHoveredKpi('pontoEquilibrio')} onMouseLeave={() => setHoveredKpi(null)} />
        </section>

        {somentePagos ? (
          <p className={`text-xs font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
            DRE calculada somente com lancamentos pagos (competencia pela data de pagamento).
          </p>
        ) : null}

        {hoveredKpi && kpiBreakdown[hoveredKpi as keyof typeof kpiBreakdown] ? (
          <aside className={`fixed bottom-5 right-5 z-50 w-[min(92vw,430px)] rounded-2xl border px-4 py-3 shadow-2xl ${isDark ? 'border-slate-700 bg-slate-950/95 text-slate-100' : 'border-slate-200 bg-white/95 text-slate-900'}`}>
            <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Formula KPI</p>
            <h3 className="mt-1 text-sm font-black">{kpiBreakdown[hoveredKpi as keyof typeof kpiBreakdown].title}</h3>
            <p className="mt-2 text-sm font-semibold">{kpiBreakdown[hoveredKpi as keyof typeof kpiBreakdown].formula}</p>
            <p className={`mt-2 text-xs ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{kpiBreakdown[hoveredKpi as keyof typeof kpiBreakdown].detail}</p>
          </aside>
        ) : null}

        <section className={`overflow-hidden rounded-[30px] border shadow-[0_25px_90px_-65px_rgba(15,23,42,0.45)] ${isDark ? 'border-slate-800 bg-slate-950/75' : 'border-slate-200 bg-white'}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1520px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 border-b border-r border-slate-800 bg-slate-950 px-5 py-4 text-left text-[10px] font-black uppercase tracking-[0.24em] text-white">Conta</th>
                  <th className="border-b border-r border-slate-800 bg-slate-950 px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.24em] text-white">Total</th>
                  {monthLabels.map((label, index) => (
                    <th key={label} className={`border-b border-r px-4 py-4 text-right text-[10px] font-black uppercase tracking-[0.18em] last:border-r-0 ${selectedMonth === index ? 'border-amber-300 bg-amber-200 text-amber-950' : 'border-slate-800 bg-slate-950 text-white'}`}>{label}</th>
                  ))}
                  <th className="w-3 border-b border-amber-300 bg-amber-200 px-0 py-0" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={15} className={`px-5 py-12 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Carregando demonstrativo...</td>
                  </tr>
                ) : DRE_DISPLAY_GROUPS.map((group) => {
                  const groupRows = dre.groupedRows[group.key] || [];
                  const groupMonthly = dre.groupedMonthly[group.key] || Array.from({ length: 12 }, () => 0);
                  const groupTotal = sumValues(groupMonthly);
                  const rowTone =
                    group.tone === 'emerald' ? (isDark ? 'border-emerald-300/35 bg-emerald-800/65' : 'border-emerald-200 bg-emerald-600') :
                    group.tone === 'amber' ? (isDark ? 'border-amber-300/35 bg-amber-800/65' : 'border-amber-200 bg-amber-600') :
                    group.tone === 'orange' ? (isDark ? 'border-orange-300/35 bg-orange-800/65' : 'border-orange-200 bg-orange-600') :
                    group.tone === 'rose' ? (isDark ? 'border-rose-300/35 bg-rose-800/65' : 'border-rose-200 bg-rose-600') :
                    group.tone === 'teal' ? (isDark ? 'border-teal-300/35 bg-teal-800/65' : 'border-teal-200 bg-teal-600') :
                    (isDark ? 'border-fuchsia-300/35 bg-fuchsia-800/65' : 'border-fuchsia-200 bg-fuchsia-600');

                  const cellTone =
                    group.tone === 'emerald' ? (isDark ? 'bg-emerald-500/12 text-emerald-100' : 'bg-emerald-50 text-emerald-800') :
                    group.tone === 'amber' ? (isDark ? 'bg-amber-500/12 text-amber-100' : 'bg-amber-50 text-amber-800') :
                    group.tone === 'orange' ? (isDark ? 'bg-orange-500/12 text-orange-100' : 'bg-orange-50 text-orange-800') :
                    group.tone === 'rose' ? (isDark ? 'bg-rose-500/12 text-rose-100' : 'bg-rose-50 text-rose-800') :
                    group.tone === 'teal' ? (isDark ? 'bg-teal-500/12 text-teal-100' : 'bg-teal-50 text-teal-800') :
                    (isDark ? 'bg-fuchsia-500/12 text-fuchsia-100' : 'bg-fuchsia-50 text-fuchsia-800');

                  return (
                    <Fragment key={`group-${group.key}`}>
                      <tr key={`group-header-${group.key}`}>
                        <td className={`sticky left-0 z-10 border-b border-r px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-white ${rowTone}`}>{group.label}</td>
                        <td className={`border-b border-r px-4 py-3 text-right font-black ${cellTone}`}>{renderMoneyCell(groupTotal, group.key.includes('RECEITAS') ? 'receita' : 'despesa')}</td>
                        {groupMonthly.map((value, index) => (
                          <td key={`${group.key}-total-${index}`} className={`border-b border-r px-4 py-3 text-right font-bold last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : cellTone}`}>{renderMoneyCell(value, group.key.includes('RECEITAS') ? 'receita' : 'despesa')}</td>
                        ))}
                        <td className="w-3 border-b border-amber-300 bg-amber-100 px-0 py-0" />
                      </tr>

                      {groupRows.length === 0 ? (
                        <tr key={`group-empty-${group.key}`}>
                          <td colSpan={15} className={`px-5 py-6 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Sem lançamentos para {group.label.toLowerCase()} neste ano.</td>
                        </tr>
                      ) : groupRows.map((row, rowIndex) => {
                        const isSelected = selectedContaId === row.id;
                        const parentRowClass =
                          group.tone === 'emerald' ? (isDark ? 'bg-emerald-900/35 text-white' : 'bg-emerald-100/60 text-slate-900') :
                          group.tone === 'amber' ? (isDark ? 'bg-amber-900/35 text-white' : 'bg-amber-100/60 text-slate-900') :
                          group.tone === 'orange' ? (isDark ? 'bg-orange-900/35 text-white' : 'bg-orange-100/60 text-slate-900') :
                          group.tone === 'rose' ? (isDark ? 'bg-rose-900/35 text-white' : 'bg-rose-100/60 text-slate-900') :
                          group.tone === 'teal' ? (isDark ? 'bg-teal-900/35 text-white' : 'bg-teal-100/60 text-slate-900') :
                          (isDark ? 'bg-fuchsia-900/35 text-white' : 'bg-fuchsia-100/60 text-slate-900');

                        return (
                          <tr key={`${group.key}-row-${row.id}`} className={rowIndex % 2 === 0 ? (isDark ? 'bg-slate-950/20' : 'bg-white') : (isDark ? 'bg-slate-900/30' : 'bg-slate-50/60')}>
                            <td
                              onClick={() => {
                                setSelectedContaId((prev) => prev === row.id ? null : row.id);
                                setSelectedMonth(null);
                              }}
                              className={`sticky left-0 z-10 cursor-pointer border-b border-r px-5 py-3 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.75)] transition ${isSelected ? 'ring-1 ring-inset ring-sky-400/60' : ''} ${row.hasChildren ? `border-slate-700 font-black ${parentRowClass}` : isDark ? rowIndex % 2 === 0 ? 'border-slate-800 bg-slate-950 font-semibold text-slate-300' : 'border-slate-800 bg-slate-900 font-semibold text-slate-300' : rowIndex % 2 === 0 ? 'border-slate-200 bg-white font-semibold text-slate-700' : 'border-slate-200 bg-slate-50 font-semibold text-slate-700'}`}
                            >
                              <div className="flex items-center gap-3" style={{ paddingLeft: `${row.depth * 18}px` }}>
                                <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                                {row.isOperationalInherited ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Operacional herdado</span> : null}
                              </div>
                            </td>
                            <td
                              onClick={() => {
                                setSelectedContaId(row.id);
                                setSelectedMonth(null);
                              }}
                              className={`cursor-pointer border-b border-r px-4 py-3 text-right ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? `font-black ${parentRowClass}` : isDark ? 'font-medium text-slate-200' : 'font-medium text-slate-700'}`}
                            >
                              {renderMoneyCell(row.total, row.tipoCategoria === 'RECEITA' ? 'receita' : 'despesa')}
                            </td>
                            {row.monthly.map((value, index) => (
                              <td
                                key={`${group.key}-value-${row.id}-${index}`}
                                onClick={() => {
                                  setSelectedContaId(row.id);
                                  setSelectedMonth(index);
                                }}
                                className={`cursor-pointer border-b border-r px-4 py-3 text-right transition last:border-r-0 ${selectedContaId === row.id && selectedMonth === index ? isDark ? 'bg-sky-500/15 text-sky-100' : 'bg-sky-50 text-sky-800' : ''} ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : ''} ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? `font-bold ${parentRowClass}` : isDark ? 'font-medium text-slate-200' : 'font-medium text-slate-700'}`}
                              >
                                {renderMoneyCell(value, row.tipoCategoria === 'RECEITA' ? 'receita' : 'despesa')}
                              </td>
                            ))}
                            <td className="w-3 border-b border-amber-300 bg-amber-100 px-0 py-0" />
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Receita líquida</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black bg-emerald-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}>{renderMoneyCell(dre.receitaLiquidaTotal, 'resultado')}</td>
                  {dre.receitaLiquidaMonthly.map((value, index) => (
                    <td key={`receita-liquida-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : `bg-emerald-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}`}>{renderMoneyCell(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Margem de contribuição</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] ${dre.margemContribuicaoTotal >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(dre.margemContribuicaoTotal, 'resultado')}</td>
                  {dre.margemContribuicaoMonthly.map((value, index) => (
                    <td key={`mc-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : value >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Resultado operacional</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] ${dre.resultadoOperacionalTotal >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(dre.resultadoOperacionalTotal, 'resultado')}</td>
                  {dre.resultadoOperacionalMonthly.map((value, index) => (
                    <td key={`resultado-operacional-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : value >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Resultado final</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)] ${dre.resultadoFinalTotal >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(dre.resultadoFinalTotal, 'resultado')}</td>
                  {dre.resultadoFinalMonthly.map((value, index) => (
                    <td key={`resultado-final-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : value >= 0 ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}>{renderMoneyCell(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">% MC</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}>{renderPercentCell(dre.percentualMcTotal)}</td>
                  {dre.percentualMcMonthly.map((value, index) => (
                    <td key={`pmc-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : `bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Lucratividade operacional</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}>{renderPercentCell(dre.lucratividadeOperacionalTotal)}</td>
                  {dre.lucratividadeOperacionalMonthly.map((value, index) => (
                    <td key={`lucr-op-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : `bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Lucratividade final</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}>{renderPercentCell(dre.lucratividadeFinalTotal)}</td>
                  {dre.lucratividadeFinalMonthly.map((value, index) => (
                    <td key={`lucr-final-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : `bg-cyan-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
                </tr>

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-800 bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white">Ponto de equilíbrio</td>
                  <td className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black bg-fuchsia-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}>{renderOptionalMoney(dre.pontoEquilibrioTotal, 'resultado')}</td>
                  {dre.pontoEquilibrioMonthly.map((value, index) => (
                    <td key={`pe-${index}`} className={`border-r border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 ${selectedMonth === index ? 'bg-amber-100 text-amber-950' : `bg-fuchsia-500/10 ${isDark ? 'text-white' : 'text-slate-900'}`}`}>{renderOptionalMoney(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-amber-300 bg-amber-100 px-0 py-0" />
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
                          <td className={`px-4 py-3 font-mono text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{formatDate(resolveCompetenciaDate(item))}</td>
                          <td className={`px-4 py-3 font-semibold ${isDark ? 'text-slate-100' : 'text-slate-700'}`}>{item.descricao}</td>
                          <td className={`px-4 py-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{itemConta?.nome || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${item.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                              {item.status || 'PENDENTE'}
                            </span>
                          </td>
                          <td className={`px-4 py-3 text-right font-black ${isReceita(item.tipo) ? 'text-emerald-500' : 'text-rose-500'}`}>{moneyFormatter.format(resolveLancamentoValue(item))}</td>
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