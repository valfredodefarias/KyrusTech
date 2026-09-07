import { type MouseEvent as ReactMouseEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Building2, Receipt, Search, CreditCard, Banknote, Calendar, 
  ArrowRight, FileText, CheckCircle2, TrendingUp, TrendingDown,
  Activity, ArrowDownCircle, ArrowUpCircle, AlertCircle, Maximize2, Minimize2,
  MoreHorizontal, Download, LayoutDashboard, CalendarDays, Filter, ChevronDown, ChevronRight, Sigma, X
} from 'lucide-react';

import axios from 'axios';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { SearchableSelect } from '../components/SearchableSelect';
import { useTransactionStore } from '../store/transactionStore';
import type { LancamentoResumo } from '../store/transactionStore';
import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';
import Chart from 'react-apexcharts';

interface PlanoConta {
  id: number;
  nome: string;
  tipo: string;
  codigo?: string | null;
  eh_operacional?: boolean;
  eh_cabecalho?: boolean;
  considerar_nos_resultados?: boolean;
  dre_grupo?: string;
  permite_lancamentos?: boolean;
  conta_pai_id?: number | null;
}



interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
}

interface EntidadeResumo {
  id: number;
  nome: string;
  nome_fantasia?: string | null;
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

interface DreAuditPanel {
  title: string;
  subtitle: string;
  monthIndex: number | null;
  rows: LancamentoResumo[];
  context?: {
    type: 'group' | 'resultado' | 'conta';
    contaIds?: number[];
    contaId?: number;
    label: string;
  };
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

const EXCLUDED_DRE_GROUPS = new Set([
  'NAO_OPERACIONAL',
  'NAO OPERACIONAL',
  'NAO OPERACIONAL / FORA DA DRE',
  'NAO OP.',
  'FORA_DRE',
  'FORA DRE',
  'FORA DA DRE',
]);

const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const moneyDetailFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
  return status === 'PAGO' || status.startsWith('PARCIAL') || Boolean(lancamento.data_pagamento) || valorPago !== 0;
}

function resolveCompetenciaDate(lancamento: LancamentoResumo, somentePagos = false) {
  if (somentePagos) return lancamento.data_pagamento || null;
  return lancamento.data_competencia || null;
}

function resolveMonthIndex(lancamento: LancamentoResumo, somentePagos = false) {
  if (!somentePagos) {
    const competenciaIndex = parseCompetenciaMonthIndex(lancamento.competencia);
    if (competenciaIndex >= 0) return competenciaIndex;
    return parseMonthIndex(lancamento.data_competencia || null);
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
  if (!value) return '';
  const parts = value.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return value;
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
      className={`rounded-xl border px-4 py-3 ${toneClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-60">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
        </div>
        <div className={`rounded-lg border border-current/10 p-3 ${isDark ? 'bg-white/5' : 'bg-white/80'}`}>{icon}</div>
      </div>
    </div>
  );
}

function renderMoneyCell(value: number, tone?: 'receita' | 'despesa' | 'resultado', isSolidBg: boolean = false) {
  if (Math.abs(value) < 0.009) {
    return <span className={isSolidBg ? "opacity-60 font-medium" : "text-slate-400 dark:text-slate-600 font-medium"}>-</span>;
  }
  if (value < -0.009) {
    const display = moneyFormatter.format(Math.abs(value));
    return (
      <span className={`whitespace-nowrap tabular-nums font-bold ${isSolidBg ? 'text-white' : 'text-rose-600 dark:text-rose-450'}`}>
        ({display})
      </span>
    );
  }
  const display = moneyFormatter.format(tone === 'resultado' ? value : Math.abs(value));
  return <span className="whitespace-nowrap tabular-nums">{display}</span>;
}

function renderOptionalMoney(value?: number | null, tone?: 'receita' | 'despesa' | 'resultado', isSolidBg: boolean = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={isSolidBg ? "opacity-60 font-medium" : "text-slate-400 dark:text-slate-600 font-medium"}>-</span>;
  }
  return renderMoneyCell(value, tone, isSolidBg);
}

function renderPercentCell(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="whitespace-nowrap tabular-nums">-</span>;
  return <span className="whitespace-nowrap tabular-nums">{percentFormatter.format(value)}</span>;
}

const EMPTY_ARRAY: any[] = [];

export function Dre() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const currentMonth = useMemo(() => new Date().getMonth(), []);
  const [ano, setAno] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);

  const [somentePagos, setSomentePagos] = useState(true);
  const [dreAnualData, setDreAnualData] = useState<{
    ano: number;
    somente_pagos: boolean;
    valores_categorias: Record<string, number[]>;
    totais?: Record<string, number[]>;
  } | null>(null);

  const [auditMetaLoading, setAuditMetaLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  const selectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const setSelectedCentroCustoId = useLookupStore((state) => state.setSelectedCentroCustoId);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(currentMonth);
  const [auditPanel, setAuditPanel] = useState<DreAuditPanel | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [collapsedAccounts, setCollapsedAccounts] = useState<Record<number, boolean>>({});
  const [showChart, setShowChart] = useState(false);
  const [isLancamentoDrawerOpen, setIsLancamentoDrawerOpen] = useState(false);
  const [editingLancamentoId, setEditingLancamentoId] = useState<number | null>(null);
  const refreshCount = useTransactionStore((state) => state.refreshCount);
  const [flashCellId, setFlashCellId] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const handledSpotlightRef = useRef('');
  const auditMetaLoadedRef = useRef(false);
  const isDark = useIsDarkMode();
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [,, dreRes] = await Promise.all([
          fetchPlanoContas(),
          fetchCentrosCusto(),
          api.get('/dre/anual', {
            params: {
              ano,
              centro_custo_id: selectedCentroCustoId !== 'ALL' && selectedCentroCustoId ? selectedCentroCustoId : undefined,
              somente_pagos: somentePagos,
            }
          }),
        ]);

        if (active) {
          setDreAnualData(dreRes.data);
          auditMetaLoadedRef.current = false;
        }
      } catch (err: any) {
        if (axios.isCancel(err)) return;
        console.error('Erro ao carregar DRE:', err);
        if (active) {
          setError(err?.response?.data?.detail || 'Não foi possível carregar a DRE.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [ano, refreshCount, selectedCentroCustoId, somentePagos]);



  useEffect(() => {
    const tableEl = tableRef.current;
    if (!tableEl) return;

    const mainEl = tableEl.closest('main');
    if (!mainEl) return;

    const theadEl = tableEl.querySelector('thead');
    if (!theadEl) return;

    const thElements = theadEl.querySelectorAll('th');

    let ticking = false;

    const updateHeaderPosition = () => {
      const mainRect = mainEl.getBoundingClientRect();
      const tableRect = tableEl.getBoundingClientRect();

      const stickyHeaderEl = document.getElementById('dre-sticky-header');
      const stickyHeight = stickyHeaderEl ? stickyHeaderEl.offsetHeight : 0;

      // Calculate how far the table top is above the main container viewport top + sticky header height.
      const offset = (mainRect.top + stickyHeight) - tableRect.top;

      const headerHeight = theadEl.offsetHeight;
      const maxOffset = tableRect.height - headerHeight;

      // Translate the headers vertically
      const translateY = Math.max(0, Math.min(offset, maxOffset));

      thElements.forEach((th) => {
        th.style.transform = `translateY(${translateY}px)`;
      });
    };

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateHeaderPosition();
          ticking = false;
        });
        ticking = true;
      }
    };

    // Initialize position
    updateHeaderPosition();

    // Listen on vertical scroll of main container and window resize
    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      mainEl.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      // Reset translation on unmount
      thElements.forEach((th) => {
        th.style.transform = '';
      });
    };
  }, [loading]);

  const ensureAuditMetaLoaded = async () => {
    if (auditMetaLoadedRef.current || auditMetaLoading) return;
    setAuditMetaLoading(true);
    try {
      await Promise.all([
        fetchContas(),
        fetchEntidadesLookup(),
      ]);
      auditMetaLoadedRef.current = true;
    } catch (err: any) {
      if (axios.isCancel(err)) return;
      console.error('Erro ao carregar lookups de auditoria na DRE:', err);
    } finally {
      setAuditMetaLoading(false);
    }
  };

  const fetchAuditRows = async (contaIds: number[], monthIndex: number | null) => {
    if (!contaIds || contaIds.length === 0) return [];
    setAuditLoading(true);
    try {
      void ensureAuditMetaLoaded();
      let dataInicio: string | undefined;
      let dataFim: string | undefined;
      if (monthIndex !== null && Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11) {
        const m = String(monthIndex + 1).padStart(2, '0');
        const lastDay = new Date(ano, monthIndex + 1, 0).getDate();
        dataInicio = `${ano}-${m}-01`;
        dataFim = `${ano}-${m}-${String(lastDay).padStart(2, '0')}`;
      } else {
        dataInicio = `${ano}-01-01`;
        dataFim = `${ano}-12-31`;
      }

      const res = await api.get('/lancamentos/', {
        params: {
          data_inicio: dataInicio,
          data_fim: dataFim,
          plano_contas_ids: contaIds.join(','),
          centro_custo_id: selectedCentroCustoId !== 'ALL' && selectedCentroCustoId ? selectedCentroCustoId : undefined,
          somente_pagos: somentePagos,
          sem_paginacao: true,
          minimized: true,
        },
      });
      const items = normalizeListResponse<LancamentoResumo>(res.data);
      return items.filter((item) => {
        const isPaid = isLancamentoPago(item);
        const bankId = Number(item.conta_id || (item as any).conta_bancaria_id || 0);
        if (somentePagos && (!isPaid || bankId <= 0)) return false;
        return true;
      });
    } catch (err) {
      console.error('Erro ao carregar lançamentos de auditoria:', err);
      return [];
    } finally {
      setAuditLoading(false);
    }
  };

  const entidadeNomePorId = useMemo(() => {
    return new Map(entidades.map((entidade) => [entidade.id, entidade.nome_fantasia || entidade.nome || 'Sem interessado']));
  }, [entidades]);

  const groupedAuditRows = useMemo(() => {
    if (!auditPanel || !auditPanel.rows) return { groups: {}, sortedDates: [] };
    const groups: { [date: string]: LancamentoResumo[] } = {};
    auditPanel.rows.forEach((row) => {
      const dateStr = resolveCompetenciaDate(row, somentePagos) || row.data_vencimento || 'Sem data';
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(row);
    });
    const sortedDates = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    return { groups, sortedDates };
  }, [auditPanel, somentePagos]);

  const dre = useMemo(() => {
    const relevantes = categorias.filter((conta) => {
      if (!isReceita(conta.tipo) && !isDespesa(conta.tipo)) return false;
      const grupo = String(conta.dre_grupo || '').trim().toUpperCase();
      return !EXCLUDED_DRE_GROUPS.has(grupo);
    });

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

    const cachedDreGrupo = new Map<number, string>();
    const cachedGrupoExibicao = new Map<number, DreDisplayGroupKey>();
    
    relevantes.forEach((conta) => {
      cachedDreGrupo.set(conta.id, resolverDreGrupo(conta.id));
      cachedGrupoExibicao.set(conta.id, resolverGrupoExibicao(conta.id));
    });

    if (dreAnualData?.valores_categorias) {
      Object.entries(dreAnualData.valores_categorias).forEach(([idStr, monthlyVals]) => {
        const contaId = Number(idStr);
        if (!contaPorId.has(contaId)) return;
        const conta = contaPorId.get(contaId);
        if (!conta) return;
        const dreGrupo = cachedDreGrupo.get(contaId) || 'DESPESAS_OPERACIONAIS';
        if (EXCLUDED_DRE_GROUPS.has(dreGrupo)) return;

        const vals = (monthlyVals as number[]).map((v) => Number(v) || 0);
        valoresDiretos.set(contaId, vals);

        vals.forEach((value, monthIndex) => {
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
            } else if (dreGrupo !== 'NAO_OPERACIONAL') {
              despesaOperacionalCoreMonthly[monthIndex] += value;
            }
          }
        });
      });
    }

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
        grupoExibicao: cachedGrupoExibicao.get(conta.id) || 'DESPESAS_OPERACIONAIS',
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
        if (raiz.grupoExibicao !== 'RECEITAS_NAO_OPERACIONAIS') {
          branch.monthly.forEach((value, index) => {
            receitaMonthly[index] += value;
          });
        }
      } else {
        despesaRows.push(...branch.rows);
        if (raiz.grupoExibicao !== 'DESPESAS_NAO_OPERACIONAIS') {
          branch.monthly.forEach((value, index) => {
            despesaMonthly[index] += value;
          });
        }
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
  }, [categorias, dreAnualData]);

  const isAccountVisible = (node: DreNode) => {
    let currentId = node.id;
    let current = dre.contaPorId.get(currentId);
    while (current && current.conta_pai_id) {
      const parentId = Number(current.conta_pai_id);
      if (collapsedAccounts[parentId]) {
        return false;
      }
      current = dre.contaPorId.get(parentId);
    }
    return true;
  };

  const chartSeries = useMemo(() => {
    return [
      {
        name: 'Receitas',
        type: 'column',
        data: dre.receitaMonthly,
      },
      {
        name: 'Despesas',
        type: 'column',
        data: dre.despesaMonthly,
      },
      {
        name: 'Resultado Final',
        type: 'line',
        data: dre.resultadoFinalMonthly,
      },
    ];
  }, [dre.receitaMonthly, dre.despesaMonthly, dre.resultadoFinalMonthly]);

  const chartOptions = useMemo(() => {
    return {
      chart: {
        id: 'dre-evolution-chart',
        toolbar: { show: false },
        parentHeightOffset: 0,
        background: 'transparent',
      },
      theme: {
        mode: (isDark ? 'dark' : 'light') as 'dark' | 'light',
      },
      colors: ['#10b981', '#f43f5e', '#3b82f6'],
      stroke: {
        width: [0, 0, 3],
        curve: 'smooth' as const,
      },
      plotOptions: {
        bar: {
          columnWidth: '50%',
          borderRadius: 4,
        },
      },
      fill: {
        opacity: [0.85, 0.85, 1],
      },
      labels: MONTH_SHORT.map(m => m.charAt(0).toUpperCase() + m.slice(1)),
      markers: {
        size: 4,
      },
      xaxis: {
        type: 'category' as const,
      },
      yaxis: {
        labels: {
          formatter: (value: number) => {
            if (Math.abs(value) < 1) return 'R$ 0';
            return moneyFormatter.format(value);
          },
        },
      },
      tooltip: {
        shared: true,
        intersect: false,
        y: {
          formatter: (value: number) => moneyDetailFormatter.format(value),
        },
      },
      legend: {
        position: 'top' as const,
        horizontalAlign: 'center' as const,
      },
      grid: {
        borderColor: isDark ? '#334155' : '#e2e8f0',
      },
    };
  }, [isDark]);

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

  const sortByCompetenciaDesc = (rows: LancamentoResumo[]) => {
    return [...rows].sort((left, right) => {
      const rightDate = resolveCompetenciaDate(right, somentePagos) || '1900-01-01';
      const leftDate = resolveCompetenciaDate(left, somentePagos) || '1900-01-01';
      return new Date(`${rightDate.slice(0, 10)}T00:00:00`).getTime() - new Date(`${leftDate.slice(0, 10)}T00:00:00`).getTime();
    });
  };

  const openAuditRows = (title: string, subtitle: string, monthIndex: number | null, rows: LancamentoResumo[], context?: any) => {
    void ensureAuditMetaLoaded();
    setSelectedMonth(monthIndex);
    setAuditPanel({ title, subtitle, monthIndex, rows: sortByCompetenciaDesc(rows), context });
  };

  const buildLancamentosDestino = (lancamentoId: number, includeEmbed: boolean) => {
    const params = new URLSearchParams();
    params.set('editar_id', String(lancamentoId));
    params.set('origem', 'dre');

    if (includeEmbed) {
      params.set('embed_boletim', '1');
    }

    if (auditPanel?.rows?.length) {
      const idsUnicos = Array.from(new Set(auditPanel.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0)));
      if (idsUnicos.length > 0) {
        params.set('dre_ids', idsUnicos.join(','));
      }
    }

    if (selectedMonth !== null && Number.isInteger(selectedMonth) && selectedMonth >= 0 && selectedMonth <= 11) {
      params.set('mes', String(selectedMonth));
    }

    return `/lancamentos?${params.toString()}`;
  };

  const openLancamentoEdicao = (lancamentoId: number, event?: ReactMouseEvent<HTMLElement>) => {
    const destino = buildLancamentosDestino(lancamentoId, false);
    if (event?.metaKey || event?.ctrlKey) {
      navigate(destino);
      return;
    }
    setEditingLancamentoId(lancamentoId);
    setIsLancamentoDrawerOpen(true);
  };

  const openContaAudit = async (contaId: number, monthIndex: number | null) => {
    const conta = dre.contaPorId.get(contaId);
    if (!conta) return;
    const ids = Array.from(new Set(dre.descendantsById.get(contaId) || [contaId]));

    openAuditRows(
      conta.codigo ? `${conta.codigo} ${conta.nome}` : conta.nome,
      monthIndex === null ? 'Lançamentos do ano inteiro para a categoria selecionada.' : `Lançamentos da categoria em ${monthLabels[monthIndex]}.`,
      monthIndex,
      [],
      { type: 'conta', contaId: conta.id, contaIds: ids, label: conta.nome },
    );

    const rows = await fetchAuditRows(ids, monthIndex);
    setAuditPanel((prev) => (prev ? { ...prev, rows: sortByCompetenciaDesc(rows) } : null));
  };

  const openGroupAudit = async (groupLabel: string, contaIds: number[], monthIndex: number | null) => {
    openAuditRows(
      groupLabel,
      monthIndex === null ? 'Lançamentos do ano inteiro deste grupo da DRE.' : `Lançamentos do grupo em ${monthLabels[monthIndex]}.`,
      monthIndex,
      [],
      { type: 'group', contaIds, label: groupLabel },
    );

    const rows = await fetchAuditRows(contaIds, monthIndex);
    setAuditPanel((prev) => (prev ? { ...prev, rows: sortByCompetenciaDesc(rows) } : null));
  };

  const openResultadoAudit = async (title: string, contaIds: number[], monthIndex: number | null) => {
    openAuditRows(
      title,
      monthIndex === null ? 'Composição do ano inteiro.' : `Composição de ${monthLabels[monthIndex]}.`,
      monthIndex,
      [],
      { type: 'resultado', label: title, contaIds },
    );

    const rows = await fetchAuditRows(contaIds, monthIndex);
    setAuditPanel((prev) => (prev ? { ...prev, rows: sortByCompetenciaDesc(rows) } : null));
  };

  useEffect(() => {
    if (!auditPanel) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAuditPanel(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [auditPanel]);

  useEffect(() => {
    if (!auditPanel?.context) return;
    const { contaIds } = auditPanel.context;
    if (contaIds && contaIds.length > 0) {
      void fetchAuditRows(contaIds, auditPanel.monthIndex).then((rows) => {
        setAuditPanel((prev) => (prev ? { ...prev, rows: sortByCompetenciaDesc(rows) } : null));
      });
    }
  }, [refreshCount]);

  useEffect(() => {
    const foco = String(searchParams.get('focus_kpi') || '').toLowerCase();
    if (foco !== 'resultado_operacional' && foco !== 'resultado_final') return;

    const mesParam = searchParams.get('mes');
    const mes = mesParam === null ? null : Number(mesParam);
    if (mes !== null && Number.isInteger(mes) && mes >= 0 && mes <= 11 && selectedMonth !== mes) {
      setSelectedMonth(mes);
    }
  }, [searchParams, selectedMonth]);

  useEffect(() => {
    if (loading || error) return;

    const foco = String(searchParams.get('focus_kpi') || '').toLowerCase();
    if (foco !== 'resultado_operacional' && foco !== 'resultado_final') return;

    const mesParam = searchParams.get('mes');
    const token = `${foco}|${mesParam || 'ALL'}`;
    if (handledSpotlightRef.current === token) return;

    const mesNumero = mesParam === null ? null : Number(mesParam);
    const hasMesValido = mesNumero !== null && Number.isInteger(mesNumero) && mesNumero >= 0 && mesNumero <= 11;

    const targetElementId = foco === 'resultado_operacional'
      ? (hasMesValido ? `dre-resultado-operacional-valor-mes-${mesNumero}` : 'dre-resultado-operacional-valor-total')
      : (hasMesValido ? `dre-resultado-final-valor-mes-${mesNumero}` : 'dre-resultado-final-valor-total');

    const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const runSpotlight = async () => {
      await waitMs(120);
      const el = document.getElementById(targetElementId);
      if (!el) return;

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashCellId(targetElementId);

      for (let i = 0; i < 2; i += 1) {
        setFlashOn(true);
        await waitMs(220);
        setFlashOn(false);
        await waitMs(180);
      }

      handledSpotlightRef.current = token;
      const next = new URLSearchParams(searchParams);
      next.delete('focus_kpi');
      next.delete('mes');
      setSearchParams(next, { replace: true });
      setFlashCellId(null);
    };

    void runSpotlight();
  }, [loading, error, searchParams, setSearchParams]);

  const exportToXlsx = async () => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('DRE');

      // Define columns
      sheet.columns = [
        { header: 'Conta', key: 'conta', width: 45 },
        { header: 'Total', key: 'total', width: 18 },
        ...monthLabels.map((lbl, idx) => ({ header: lbl, key: `m_${idx}`, width: 15 }))
      ];

      // Format header row
      const headerRow = sheet.getRow(1);
      headerRow.height = 25;
      headerRow.eachCell((cell, colNumber) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF000000' } // Black
        };
        cell.font = {
          color: { argb: 'FFFFFFFF' }, // White
          bold: true,
          size: 11
        };
        if (colNumber === 1) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      });

      const getColorsForTone = (tone: string) => {
        const groupColors: Record<string, string> = {
          emerald: 'FFE6F4EA', // soft green
          amber: 'FFFEF7E0',   // soft yellow
          orange: 'FFFFF3E0',  // soft orange
          rose: 'FFFCE8E6',    // soft rose/red
          teal: 'FFE0F7FA',    // soft teal/cyan
          fuchsia: 'FFF3E5F5', // soft fuchsia/purple
        };
        const parentColors: Record<string, string> = {
          emerald: 'FFF4FBF7',
          amber: 'FFFFFDF0',
          orange: 'FFFFF9F2',
          rose: 'FFFFF5F5',
          teal: 'FFF2FDFD',
          fuchsia: 'FFFBF7FC',
        };
        return {
          group: groupColors[tone] || 'FFF1F5F9',
          parent: parentColors[tone] || 'FFFFFFFF'
        };
      };

      const addExportRow = (
        contaName: string,
        total: number | null,
        monthly: (number | null)[],
        options?: { isGroupHeader?: boolean; isSummary?: boolean; isPercentage?: boolean; indent?: number; bgColor?: string; isParentCategory?: boolean }
      ) => {
        const rowValues = [
          options?.indent ? '   '.repeat(options.indent) + contaName : contaName,
          total,
          ...monthly
        ];
        const row = sheet.addRow(rowValues);
        row.height = 20;

        const numCols = 2 + monthLabels.length;
        for (let colNumber = 1; colNumber <= numCols; colNumber++) {
          const cell = row.getCell(colNumber);

          if (options?.isGroupHeader) {
            cell.font = { bold: true, size: 11, color: { argb: 'FF000000' } };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: options.bgColor || 'FFF1F5F9' }
            };
          } else if (options?.isParentCategory) {
            cell.font = { bold: true, size: 10, color: { argb: 'FF1E293B' } }; // slate-800
            if (options.bgColor) {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: options.bgColor }
              };
            }
          } else if (options?.isSummary) {
            cell.font = { bold: true, size: 11 };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE2E8F0' } // Soft gray
            };
          } else {
            cell.font = { size: 10, color: { argb: 'FF334155' } }; // slate-700
          }

          if (colNumber === 1) {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }

          if (colNumber > 1) {
            if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
              if (options?.isPercentage) {
                cell.numFmt = '0.0%;[Red](0.0%)';
              } else {
                cell.numFmt = '"R$"#,##0;[Red]("(R$"#,##0")")';
              }
            }
          }
        }

        return row;
      };

      DRE_DISPLAY_GROUPS.forEach((group) => {
        const groupRows = dre.groupedRows[group.key] || [];
        const groupMonthly = dre.groupedMonthly[group.key] || Array.from({ length: 12 }, () => 0);
        const groupTotal = sumValues(groupMonthly);

        const colors = getColorsForTone(group.tone);

        // 1. Add group header row
        addExportRow(group.label, groupTotal, groupMonthly, { isGroupHeader: true, bgColor: colors.group });

        // 2. Add row for each item in the group
        groupRows.forEach((row) => {
          const displayName = row.codigo ? `${row.codigo} ${row.nome}` : row.nome;
          addExportRow(displayName, row.total, row.monthly, {
            indent: row.depth + 1,
            isParentCategory: row.hasChildren,
            bgColor: row.hasChildren ? colors.parent : undefined
          });
        });
      });

      addExportRow('Receita líquida', dre.receitaLiquidaTotal, dre.receitaLiquidaMonthly, { isSummary: true });
      addExportRow('Margem de contribuição', dre.margemContribuicaoTotal, dre.margemContribuicaoMonthly, { isSummary: true });
      addExportRow('Resultado operacional', dre.resultadoOperacionalTotal, dre.resultadoOperacionalMonthly, { isSummary: true });
      addExportRow('Resultado final', dre.resultadoFinalTotal, dre.resultadoFinalMonthly, { isSummary: true });
      addExportRow('% MC', dre.percentualMcTotal, dre.percentualMcMonthly, { isSummary: true, isPercentage: true });
      addExportRow('Lucratividade operacional', dre.lucratividadeOperacionalTotal, dre.lucratividadeOperacionalMonthly, { isSummary: true, isPercentage: true });
      addExportRow('Lucratividade final', dre.lucratividadeFinalTotal, dre.lucratividadeFinalMonthly, { isSummary: true, isPercentage: true });
      addExportRow('Ponto de equilíbrio', dre.pontoEquilibrioTotal, dre.pontoEquilibrioMonthly, { isSummary: true });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `DRE_${ano}_${somentePagos ? 'Caixa' : 'Competencia'}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Erro ao exportar DRE:', e);
    }
  };

  const pageBg = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.10),transparent_28%),linear-gradient(180deg,#020617_0%,#0f172a_48%,#111827_100%)] text-slate-100'
    : 'bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] text-slate-900';
  const selectedMonthSoftClass = isDark
    ? 'bg-orange-500/10 !text-orange-50 ring-1 ring-inset ring-orange-500/20'
    : 'bg-orange-500/10 !text-slate-900 ring-1 ring-inset ring-orange-400/20';
  const selectedMonthHeaderClass = isDark
    ? 'border-orange-500/30 bg-[#2d120a] !text-orange-200'
    : 'border-orange-500/20 bg-[#fed7aa] !text-slate-900';

  const handleMonthChange = (newMonth: number | null) => {
    if (!auditPanel?.context) return;
    const { type, contaIds, contaId, label } = auditPanel.context;
    if (type === 'conta' && contaId) {
      void openContaAudit(contaId, newMonth);
    } else if (type === 'group' && contaIds) {
      void openGroupAudit(label, contaIds, newMonth);
    } else if (type === 'resultado' && contaIds) {
      void openResultadoAudit(label, contaIds, newMonth);
    }
  };

  return (
    <div className={`min-h-full ${pageBg}`}>
      <div className="w-full space-y-6">
        <section 
          id="dre-sticky-header"
          className={`sticky top-0 z-30 rounded-none border-b px-4 py-4 shadow-[0_2px_8px_-3px_rgba(15,23,42,0.08)] md:px-6 transition-all duration-200 ${isDark ? 'border-slate-850 bg-slate-950/95 backdrop-blur-md' : 'border-slate-200 bg-white/95 backdrop-blur-md'}`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black tracking-tight md:text-3xl text-slate-900 dark:text-white">
                DRE
              </h1>
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white dark:bg-slate-100 dark:text-slate-900">
                Demonstrativo de Resultado - Regime de {somentePagos ? 'Caixa' : 'Competência'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 rounded-lg p-0.5 border border-slate-200 dark:border-slate-800 h-9">
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={ano}
                  onChange={(event) => {
                    setAno(Number(event.target.value) || currentYear);
                  }}
                  title="Ano"
                  className="h-full w-16 sm:w-20 rounded-md border-0 bg-transparent px-2 text-xs sm:text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-0 transition"
                />
              </div>
              
              <div className="w-24 sm:w-28 h-9">
                <SearchableSelect
                  className="!h-9"
                  value={selectedMonth === null ? 'ALL' : String(selectedMonth)}
                  onChange={(val) => {
                    setSelectedMonth(val === 'ALL' ? null : Number(val));
                  }}
                  options={[{
                    label: 'Mês',
                    options: [
                      { id: 'ALL', label: 'Ano todo' },
                      ...monthLabels.map((label, index) => ({ id: index, label }))
                    ]
                  }]}
                />
              </div>

              <div className="w-32 sm:w-44 h-9">
                <SearchableSelect
                  className="!h-9"
                  value={selectedCentroCustoId === 'ALL' ? 'ALL' : String(selectedCentroCustoId)}
                  onChange={(val) => {
                    setSelectedCentroCustoId(val === 'ALL' ? 'ALL' : Number(val));
                  }}
                  options={[{
                    label: 'Centro de custo',
                    options: [
                      { id: 'ALL', label: 'Todos CCs' },
                      ...centrosCusto.map((centro) => ({
                        id: centro.id,
                        label: `${centro.codigo ? `${centro.codigo} - ` : ''}${centro.nome}`
                      }))
                    ]
                  }]}
                />
              </div>

              <div className="flex items-center space-x-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-900 h-9 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    if (somentePagos) {
                      setSomentePagos(false);
                    }
                  }}
                  className={`rounded-md px-2.5 sm:px-3.5 py-1 text-xs font-bold transition cursor-pointer h-full flex items-center ${
                    !somentePagos
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white border border-slate-200/50 dark:border-slate-700/50'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  Competência
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!somentePagos) {
                      setSomentePagos(true);
                    }
                  }}
                  className={`rounded-md px-2.5 sm:px-3.5 py-1 text-xs font-bold transition cursor-pointer h-full flex items-center ${
                    somentePagos
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white border border-slate-200/50 dark:border-slate-700/50'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  Caixa
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowChart(!showChart)}
                className={`flex h-9 items-center justify-center gap-2 rounded-lg border px-2.5 sm:px-4 text-xs font-bold transition shadow-xs cursor-pointer ${showChart ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-850 dark:bg-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                Gráfico
              </button>

              <button
                type="button"
                onClick={exportToXlsx}
                className="flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 hover:bg-slate-800 px-3.5 sm:px-4 text-xs font-bold text-white transition shadow-sm cursor-pointer dark:bg-slate-800 dark:border-slate-700 dark:hover:bg-slate-700"
              >
                XLSX
              </button>
            </div>
          </div>
        </section>

        {showChart && (
          <section className={`rounded-xl border p-4 shadow-[0_2px_8px_-3px_rgba(15,23,42,0.08)] transition-all animate-tab-fade ${isDark ? 'border-slate-800 bg-slate-950/70' : 'border-slate-200 bg-white'}`}>
            <div className="h-64 sm:h-80 w-full">
              <Chart
                options={chartOptions}
                series={chartSeries}
                type="line"
                height="100%"
              />
            </div>
          </section>
        )}

        {error ? (
          <div className={`rounded-lg border px-5 py-4 text-sm font-semibold ${isDark ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {error}
          </div>
        ) : null}


        <section className={`rounded-none border shadow-[0_25px_90px_-65px_rgba(15,23,42,0.45)] ${isDark ? 'border-slate-800 bg-slate-950/75' : 'border-slate-200 bg-white'}`}>
          <div className="overflow-auto max-h-[75vh] custom-scrollbar">
            <table ref={tableRef} className="w-full min-w-[1520px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 border-b border-r border-slate-255 bg-black px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] !text-white shadow-sm">Conta</th>
                  <th className="sticky top-0 z-20 border-b border-r border-slate-255 bg-black px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.24em] !text-white shadow-sm">Total</th>
                  {monthLabels.map((label, index) => (
                    <th
                      key={label}
                      onClick={() => setSelectedMonth((prev) => (prev === index ? null : index))}
                      title={selectedMonth === index ? 'Clique para voltar ao ano inteiro' : `Clique para filtrar ${label}`}
                      className={`sticky top-0 z-20 cursor-pointer border-b border-r px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.18em] last:border-r-0 shadow-sm ${selectedMonth === index ? selectedMonthHeaderClass : 'border-slate-255 bg-black !text-white'}`}
                    >
                      {label}
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 w-3 border-b border-amber-300 bg-amber-200 px-0 py-0" />
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
                  const isGroupCollapsed = collapsedGroups[group.key];
                  const isReceita = group.key.includes('RECEITAS');
                  
                  const rowTone = isReceita 
                    ? (isDark ? 'border-blue-800 bg-blue-700 text-white' : 'border-blue-700 bg-blue-600 text-white')
                    : (isDark ? 'border-red-950 bg-red-900 text-white' : 'border-red-900 bg-red-800 text-white');

                  return (
                    <Fragment key={`group-${group.key}`}>
                      <tr 
                        key={`group-header-${group.key}`}
                        onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                        className="cursor-pointer select-none hover:opacity-95 transition-opacity"
                      >
                        <td className={`sticky left-0 z-10 border-b border-r px-5 py-3 text-sm font-black uppercase tracking-[0.16em] ${rowTone}`}>
                          <div className="flex items-center gap-2">
                            {isGroupCollapsed ? (
                              <ChevronRight size={14} />
                            ) : (
                              <ChevronDown size={14} />
                            )}
                            <span>{group.label}</span>
                          </div>
                        </td>
                        <td
                          onClick={(e) => {
                            e.stopPropagation();
                            openGroupAudit(group.label, groupRows.map((row) => row.id), null);
                          }}
                          className={`cursor-pointer border-b border-r px-4 py-3 text-right font-black ${rowTone}`}
                        >
                          {renderMoneyCell(groupTotal, group.key.includes('RECEITAS') ? 'receita' : 'despesa', true)}
                        </td>
                        {groupMonthly.map((value, index) => (
                          <td
                            key={`${group.key}-total-${index}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openGroupAudit(group.label, groupRows.map((row) => row.id), index);
                            }}
                            className={`cursor-pointer border-b border-r px-4 py-3 text-right font-bold last:border-r-0 ${selectedMonth === index ? `${rowTone} ring-2 ring-inset ring-white/60` : `${rowTone}`}`}
                          >
                            {renderMoneyCell(value, group.key.includes('RECEITAS') ? 'receita' : 'despesa', true)}
                          </td>
                        ))}
                        <td className="w-3 border-b border-yellow-500 bg-yellow-400 px-0 py-0" />
                      </tr>

                      {!isGroupCollapsed && (
                        groupRows.length === 0 ? (
                          <tr key={`group-empty-${group.key}`}>
                            <td colSpan={15} className={`px-5 py-6 text-center text-sm font-semibold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Sem lançamentos para {group.label.toLowerCase()} neste ano.</td>
                          </tr>
                        ) : groupRows.map((row, rowIndex) => {
                          if (!isAccountVisible(row)) return null;
                          
                          const parentRowClass = isReceita 
                            ? (isDark ? 'text-blue-300' : 'text-blue-700')
                            : (isDark ? 'text-red-300' : 'text-red-700');

                          return (
                            <tr key={`${group.key}-row-${row.id}`} className={`transition-colors ${rowIndex % 2 === 0 ? (isDark ? 'bg-slate-950/20' : 'bg-white') : (isDark ? 'bg-slate-900/30' : 'bg-slate-50/60')} hover:bg-slate-100/50 dark:hover:bg-slate-900/50`}>
                              <td
                                onClick={row.hasChildren ? (e) => {
                                  e.stopPropagation();
                                  setCollapsedAccounts(prev => ({ ...prev, [row.id]: !prev[row.id] }));
                                } : undefined}
                                className={`sticky left-0 z-10 border-b border-r px-5 py-3 shadow-[6px_0_12px_-10px_rgba(15,23,42,0.75)] transition ${row.hasChildren ? `border-slate-700 font-black cursor-pointer select-none ${parentRowClass}` : isDark ? rowIndex % 2 === 0 ? 'border-slate-800 bg-slate-950 font-semibold text-slate-300' : 'border-slate-800 bg-slate-900 font-semibold text-slate-300' : rowIndex % 2 === 0 ? 'border-slate-200 bg-white font-semibold text-slate-700' : 'border-slate-200 bg-slate-50 font-semibold text-slate-700'}`}
                              >
                                <div className="flex items-center gap-2 relative" style={{ paddingLeft: `${row.depth * 16}px` }}>
                                  {row.depth > 0 && Array.from({ length: row.depth }).map((_, i) => (
                                    <div
                                      key={i}
                                      className="absolute top-[-12px] bottom-[-12px] border-l border-slate-300 dark:border-slate-700 opacity-60 pointer-events-none"
                                      style={{ left: `${i * 16 + 6}px` }}
                                    />
                                  ))}
                                  {row.hasChildren ? (
                                    collapsedAccounts[row.id] 
                                      ? <ChevronRight size={13} className={isDark ? 'text-slate-350 hover:text-white' : 'text-slate-600 hover:text-slate-900'} />
                                      : <ChevronDown size={13} className={isDark ? 'text-slate-355' : 'text-slate-600'} />
                                  ) : (
                                    <span className="w-3.5" />
                                  )}
                                  <span className="min-w-0 truncate">{row.codigo ? `${row.codigo} ${row.nome}` : row.nome}</span>
                                  {row.isOperationalInherited ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Operacional herdado</span> : null}
                                </div>
                              </td>
                              <td
                                onClick={() => openContaAudit(row.id, null)}
                                className={`cursor-pointer border-b border-r px-4 py-3 text-right ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? `font-black ${parentRowClass}` : isDark ? 'font-medium text-slate-200' : 'font-medium text-slate-700'}`}
                              >
                                {renderMoneyCell(row.total, row.tipoCategoria === 'RECEITA' ? 'receita' : 'despesa')}
                              </td>
                              {row.monthly.map((value, index) => (
                                <td
                                  key={`${group.key}-value-${row.id}-${index}`}
                                  onClick={() => openContaAudit(row.id, index)}
                                  className={`cursor-pointer border-b border-r px-4 py-3 text-right transition last:border-r-0 ${isDark ? 'border-slate-800' : 'border-slate-200'} ${row.hasChildren ? `font-bold ${parentRowClass} ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50' : ''}` : isDark ? 'font-medium text-slate-200' : 'font-medium text-slate-700'} ${selectedMonth === index && !row.hasChildren ? `${selectedMonthSoftClass} font-black` : ''}`}
                                >
                                  {renderMoneyCell(value, row.tipoCategoria === 'RECEITA' ? 'receita' : 'despesa')}
                                </td>
                              ))}
                              <td className="w-3 border-b border-yellow-500 bg-yellow-400 px-0 py-0" />
                            </tr>
                          );
                        })
                      )}
                    </Fragment>
                  );
                })}

                <tr>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-850 bg-slate-200/50 dark:bg-slate-900/60 px-5 py-2 text-sm font-black text-slate-950">&nbsp;</td>
                  <td className="border-r border-slate-200 dark:border-slate-850 bg-slate-200/50 dark:bg-slate-900/60 px-4 py-2">&nbsp;</td>
                  {monthLabels.map((label) => (
                    <td key={`separator-${label}`} className="border-r border-slate-200 dark:border-slate-850 bg-slate-200/50 dark:bg-slate-900/60 px-4 py-2 last:border-r-0">&nbsp;</td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Receita líquida */}
                <tr className={`${isDark ? 'bg-slate-900/40' : 'bg-slate-50/70'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 font-bold border-t border-b border-slate-300 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-slate-850 dark:text-slate-100">Receita líquida</td>
                  <td
                    onClick={() => openResultadoAudit('Receita líquida', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id)], null)}
                    className="cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black text-slate-850 dark:text-slate-100"
                  >
                    {renderMoneyCell(dre.receitaLiquidaTotal, 'resultado')}
                  </td>
                  {dre.receitaLiquidaMonthly.map((value, index) => (
                    <td
                      key={`receita-liquida-${index}`}
                      onClick={() => openResultadoAudit('Receita líquida', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id)], index)}
                      className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 text-slate-850 dark:text-slate-100 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}
                    >
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Margem de contribuição */}
                <tr className={`${isDark ? 'bg-slate-900/40' : 'bg-slate-50/70'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 font-bold border-b border-slate-300 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-slate-850 dark:text-slate-100">Margem de contribuição</td>
                  <td
                    onClick={() => openResultadoAudit('Margem de contribuição', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id)], null)}
                    className="cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black text-slate-850 dark:text-slate-100"
                  >
                    {renderMoneyCell(dre.margemContribuicaoTotal, 'resultado')}
                  </td>
                  {dre.margemContribuicaoMonthly.map((value, index) => (
                    <td
                      key={`mc-${index}`}
                      onClick={() => openResultadoAudit('Margem de contribuição', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id)], index)}
                      className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 text-slate-850 dark:text-slate-100 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}
                    >
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Resultado operacional */}
                <tr className={`${isDark ? 'bg-slate-900/40' : 'bg-slate-50/70'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 font-bold border-b border-slate-300 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-slate-850 dark:text-slate-100">Resultado operacional</td>
                  <td
                    id="dre-resultado-operacional-valor-total"
                    onClick={() => openResultadoAudit('Resultado operacional', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id), ...dre.groupedRows.DESPESAS_OPERACIONAIS.map((row) => row.id)], null)}
                    className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black text-slate-850 dark:text-slate-100 ${(flashCellId === 'dre-resultado-operacional-valor-total' && flashOn) ? 'ring-4 ring-inset ring-amber-300' : ''}`}
                  >
                    {renderMoneyCell(dre.resultadoOperacionalTotal, 'resultado')}
                  </td>
                  {dre.resultadoOperacionalMonthly.map((value, index) => (
                    <td
                      key={`resultado-operacional-${index}`}
                      id={`dre-resultado-operacional-valor-mes-${index}`}
                      onClick={() => openResultadoAudit('Resultado operacional', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id), ...dre.groupedRows.DESPESAS_OPERACIONAIS.map((row) => row.id)], index)}
                      className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 text-slate-850 dark:text-slate-100 ${(flashCellId === `dre-resultado-operacional-valor-mes-${index}` && flashOn) ? 'ring-4 ring-inset ring-amber-300' : ''} ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}
                    >
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Resultado final */}
                <tr className={`${isDark ? 'bg-slate-900/40' : 'bg-slate-50/70'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 font-bold border-b border-slate-300 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-slate-850 dark:text-slate-100">Resultado final</td>
                  <td
                    id="dre-resultado-final-valor-total"
                    onClick={() => openResultadoAudit('Resultado final', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id), ...dre.groupedRows.DESPESAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.RECEITAS_NAO_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.DESPESAS_NAO_OPERACIONAIS.map((row) => row.id)], null)}
                    className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black text-slate-850 dark:text-slate-100 ${(flashCellId === 'dre-resultado-final-valor-total' && flashOn) ? 'ring-4 ring-inset ring-amber-300' : ''}`}
                  >
                    {renderMoneyCell(dre.resultadoFinalTotal, 'resultado')}
                  </td>
                  {dre.resultadoFinalMonthly.map((value, index) => (
                    <td
                      key={`resultado-final-${index}`}
                      id={`dre-resultado-final-valor-mes-${index}`}
                      onClick={() => openResultadoAudit('Resultado final', [...dre.groupedRows.RECEITAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.ABATIMENTO_VENDAS.map((row) => row.id), ...dre.groupedRows.CUSTOS.map((row) => row.id), ...dre.groupedRows.DESPESAS_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.RECEITAS_NAO_OPERACIONAIS.map((row) => row.id), ...dre.groupedRows.DESPESAS_NAO_OPERACIONAIS.map((row) => row.id)], index)}
                      className={`cursor-pointer border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-black last:border-r-0 text-slate-850 dark:text-slate-100 ${(flashCellId === `dre-resultado-final-valor-mes-${index}` && flashOn) ? 'ring-4 ring-inset ring-amber-300' : ''} ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}
                    >
                      {renderMoneyCell(value, 'resultado')}
                    </td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* % MC */}
                <tr className={`${isDark ? 'bg-slate-900/30' : 'bg-slate-50/40'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-bold text-slate-650 dark:text-slate-350">% MC</td>
                  <td className="border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold text-slate-650 dark:text-slate-355">{renderPercentCell(dre.percentualMcTotal)}</td>
                  {dre.percentualMcMonthly.map((value, index) => (
                    <td key={`pmc-${index}`} className={`border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold last:border-r-0 text-slate-650 dark:text-slate-355 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Lucratividade operacional */}
                <tr className={`${isDark ? 'bg-slate-900/30' : 'bg-slate-50/40'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-bold text-slate-650 dark:text-slate-350">Lucratividade operacional</td>
                  <td className="border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold text-slate-650 dark:text-slate-355">{renderPercentCell(dre.lucratividadeOperacionalTotal)}</td>
                  {dre.lucratividadeOperacionalMonthly.map((value, index) => (
                    <td key={`lucr-op-${index}`} className={`border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold last:border-r-0 text-slate-650 dark:text-slate-355 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Lucratividade final */}
                <tr className={`${isDark ? 'bg-slate-900/30' : 'bg-slate-50/40'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-bold text-slate-650 dark:text-slate-350">Lucratividade final</td>
                  <td className="border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold text-slate-650 dark:text-slate-355">{renderPercentCell(dre.lucratividadeFinalTotal)}</td>
                  {dre.lucratividadeFinalMonthly.map((value, index) => (
                    <td key={`lucr-final-${index}`} className={`border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold last:border-r-0 text-slate-650 dark:text-slate-355 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}>{renderPercentCell(value)}</td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>

                {/* Ponto de equilíbrio */}
                <tr className={`${isDark ? 'bg-slate-900/30' : 'bg-slate-50/40'} hover:bg-slate-100/50 dark:hover:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800`}>
                  <td className="sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 px-5 py-4 text-sm font-bold text-slate-650 dark:text-slate-350">Ponto de equilíbrio</td>
                  <td className="border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold text-slate-650 dark:text-slate-355">{renderOptionalMoney(dre.pontoEquilibrioTotal, 'resultado')}</td>
                  {dre.pontoEquilibrioMonthly.map((value, index) => (
                    <td key={`pe-${index}`} className={`border-r border-slate-200 dark:border-slate-800 px-4 py-4 text-right text-sm font-bold last:border-r-0 text-slate-650 dark:text-slate-355 ${selectedMonth === index ? 'ring-2 ring-inset ring-orange-500/40 dark:ring-orange-400/50 bg-orange-500/5' : ''}`}>{renderOptionalMoney(value, 'resultado')}</td>
                  ))}
                  <td className="w-3 border-r border-yellow-500 bg-yellow-400 px-0 py-0" />
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {auditPanel ? createPortal(
          <div className="fixed inset-0 z-[100] flex justify-end">
            <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity" onClick={() => setAuditPanel(null)} />
            <aside className={`relative z-10 flex h-full w-[850px] max-w-full flex-col shadow-2xl ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
              <div className={`shrink-0 border-b px-6 py-5 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className={`text-xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{auditPanel.title}</h2>
                    <p className={`mt-1 text-sm font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{auditPanel.subtitle}</p>
                    
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button 
                        onClick={() => handleMonthChange(null)} 
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-full border transition-colors ${auditPanel.monthIndex === null ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'}`}
                      >
                        Anual
                      </button>
                      {MONTH_SHORT.map((m, idx) => (
                        <button 
                          key={m} 
                          onClick={() => handleMonthChange(idx)} 
                          className={`px-3 py-1.5 text-[11px] font-bold rounded-full border capitalize transition-colors ${auditPanel.monthIndex === idx ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'}`}
                        >
                          {m.replace('.', '')}
                        </button>
                      ))}
                    </div>
                    
                    {auditPanel.context && (
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md font-medium tracking-wide">
                          CONTEXTO: {auditPanel.context.label}
                        </span>
                        
                        {(auditPanel.context.type === 'group' || auditPanel.context.type === 'conta') && (
                          <button
                            onClick={() => {
                              if (auditPanel.context?.type === 'group' && auditPanel.context.contaIds) {
                                setShowChart(true);
                                // setChartMode('group');
                                // setChartContextIds(auditPanel.context.contaIds);
                                // setChartContextLabel(auditPanel.context.label);
                                setAuditPanel(null);
                              } else if (auditPanel.context?.type === 'conta' && auditPanel.context.contaId) {
                                setShowChart(true);
                                // setChartMode('single');
                                // setChartContextIds([auditPanel.context.contaId]);
                                // setChartContextLabel(auditPanel.context.label);
                                setAuditPanel(null);
                              }
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                              isDark 
                                ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' 
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }`}
                          >
                            <Activity className="w-3.5 h-3.5" />
                            Gerar Gráfico de Barras
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setAuditPanel(null)} className={`rounded-lg p-2 transition ${isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-900'}`}>
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className={`min-h-0 flex-1 overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className={isDark ? 'bg-white/5' : 'bg-slate-50'}>
                      <tr>
                        <th className="px-3 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em] !text-slate-500 dark:!text-slate-400">Valor</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em] !text-slate-500 dark:!text-slate-400">Interessado / Descrição</th>
                        <th className="px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em] !text-slate-500 dark:!text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLoading ? (
                        <tr>
                          <td colSpan={3} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Carregando lançamentos...</td>
                        </tr>
                      ) : auditPanel.rows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Sem itens para esse recorte.</td>
                        </tr>
                      ) : auditMetaLoading && contas.length === 0 && entidades.length === 0 ? (
                        <tr>
                          <td colSpan={3} className={`px-3 py-8 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Carregando detalhes de banco e interessado...</td>
                        </tr>
                      ) : (
                        groupedAuditRows.sortedDates.map((dateStr) => {
                          const groupRows = groupedAuditRows.groups[dateStr];
                          const dayTotal = groupRows.reduce((sum, r) => sum + resolveLancamentoValue(r, somentePagos), 0);
                          return (
                            <Fragment key={dateStr}>
                              <tr className="bg-slate-100/70 dark:bg-slate-800/60 select-none">
                                <td colSpan={3} className="px-3 py-2 border-t border-b border-slate-200/50 dark:border-slate-800">
                                  <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <span>Dia {formatDate(dateStr)}</span>
                                    <span>Total: <span className={groupRows.length > 0 && isReceita(groupRows[0].tipo) ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-rose-400' : 'text-rose-600')}>{moneyDetailFormatter.format(Math.abs(dayTotal))}</span></span>
                                  </div>
                                </td>
                              </tr>
                              {groupRows.map((item) => {
                                const interessadoNome = entidadeNomePorId.get(Number(item.entidade_id)) || 'Sem interessado';
                                const valor = resolveLancamentoValue(item, somentePagos);
                                const statusLabel = String(item.status || '').trim() || (isLancamentoPago(item) ? 'PAGO' : 'EM ABERTO');
                                const statusKey = statusLabel.toUpperCase();

                                return (
                                  <tr
                                    key={item.id}
                                    onClick={(event) => openLancamentoEdicao(item.id, event)}
                                    className={`${isDark ? 'border-t border-white/8 text-white hover:bg-white/5' : 'border-t border-slate-100 text-slate-800 hover:bg-slate-50'} cursor-pointer transition`}
                                    title="Abrir edição do lançamento"
                                  >
                                    <td className={`px-3 py-2.5 text-right font-bold whitespace-nowrap ${isReceita(item.tipo) ? (isDark ? 'text-blue-400' : 'text-blue-600') : (isDark ? 'text-rose-400' : 'text-rose-600')}`}>{moneyDetailFormatter.format(Math.abs(valor))}</td>
                                    <td className="px-3 py-2.5">
                                      <div className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-72">{interessadoNome}</div>
                                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-72" title={item.descricao}>{item.descricao}</div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${statusKey === 'PAGO' ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700' : statusKey === 'ATRASADO' ? isDark ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700' : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                        {statusLabel}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </aside>
          </div>,
          document.body
        ) : null}

        <LancamentoFormDrawer
          showDrawer={isLancamentoDrawerOpen}
          editarId={editingLancamentoId}
          onClose={() => {
            setIsLancamentoDrawerOpen(false);
            setEditingLancamentoId(null);
          }}
          onSaveSuccess={async () => {
            setIsLancamentoDrawerOpen(false);
            setEditingLancamentoId(null);
            useTransactionStore.getState().incrementRefreshCount();
          }}
          categorias={categorias}
          entidades={entidades}
          contas={contas}
          centros={centrosCusto}
        />
      </div>
    </div>
  );
}