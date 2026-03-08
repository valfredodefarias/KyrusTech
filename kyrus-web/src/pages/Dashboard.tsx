import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAssistentePage } from '../components/AssistentePageContext';
import { AsyncApexChart } from '../components/AsyncApexChart';
import {
  TrendingUp, TrendingDown, Wallet, RefreshCw, Filter,
  CalendarRange, Layers, Building2, List, X, Landmark,
  Sparkles, Download, Search, Activity
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

interface Conta {
  id: number;
  nome: string;
  banco?: string | null;
  saldo_atual?: number;
}

interface TodoItem {
  id: number;
  status: 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO' | string;
}

type FinanceDrilldown =
  | 'PAGAR_HOJE'
  | 'PAGAR_AMANHA'
  | 'PAGAR_ATRASADAS'
  | 'PAGAR_REALIZADAS'
  | 'PAGAR_ABERTO'
  | 'PAGAR_TOTAL'
  | 'RECEBER_HOJE'
  | 'RECEBER_AMANHA'
  | 'RECEBER_ATRASADAS'
  | 'RECEBER_REALIZADAS'
  | 'RECEBER_ABERTO'
  | 'RECEBER_TOTAL'
  | null;

type DashboardHelpKey =
  | 'RECEITAS'
  | 'DESPESAS'
  | 'SALDO'
  | 'PAGOS'
  | 'MARGEM_CORRENTE'
  | 'TICKET_MEDIO'
  | 'COBERTURA_FINANCEIRA'
  | 'MAIOR_PRESSAO'
  | 'MAIOR_MOTOR_RECEITA'
  | 'FLUXO_CAIXA'
  | 'DESPESAS_CATEGORIA'
  | 'RECEITAS_CATEGORIA'
  | 'ACUMULADO_REC_DESP'
  | 'RESULTADO_OPERACIONAL'
  | 'RESUMO_OPERACIONAL'
  | 'RECEITAS_DESPESAS_ANO'
  | 'MARGEM_OPERACIONAL_PAINEL'
  | 'COMPARATIVO_ANO'
  | 'SAZONALIDADE'
  | 'CENARIOS'
  | 'RESULTADO_ACUMULADO'
  | 'PULSO_ACUMULADO'
  | 'FECHAMENTO_ACUMULADO'
  | 'PICO_ACUMULADO'
  | 'VALE_ACUMULADO'
  | 'AMPLITUDE_ACUMULADO'
  | 'STATUS_DISTRIB'
  | 'PRODUTIVIDADE'
  | 'DESPESAS_CENTRO'
  | 'ULTIMOS_LANCAMENTOS';

type KpiTooltipState = {
  key: DashboardHelpKey;
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INTERACTIVE_PANEL_CLASS = 'group relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.1),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))] dark:hover:shadow-black/20';
const DASHBOARD_SECTION_CLASS = 'group relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.96))] p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-900/5 dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.12),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))] dark:hover:shadow-black/20';
const FINANCE_DRILLDOWN_LABELS: Record<Exclude<FinanceDrilldown, null>, string> = {
  PAGAR_HOJE: 'Contas a pagar hoje',
  PAGAR_AMANHA: 'Contas a pagar amanha',
  PAGAR_ATRASADAS: 'Contas a pagar atrasadas',
  PAGAR_REALIZADAS: 'Contas a pagar realizadas',
  PAGAR_ABERTO: 'Contas a pagar em aberto',
  PAGAR_TOTAL: 'Total contas a pagar',
  RECEBER_HOJE: 'Contas a receber hoje',
  RECEBER_AMANHA: 'Contas a receber amanha',
  RECEBER_ATRASADAS: 'Contas a receber atrasadas',
  RECEBER_REALIZADAS: 'Contas a receber realizadas',
  RECEBER_ABERTO: 'Contas a receber em aberto',
  RECEBER_TOTAL: 'Total contas a receber',
};

const DASHBOARD_HELP: Record<DashboardHelpKey, { titulo: string; significado: string; calculo: string; utilidade: string }> = {
  RECEITAS: {
    titulo: 'Receitas',
    significado: 'Soma de todas as entradas filtradas no recorte atual.',
    calculo: 'Soma de valor_previsto de todos os lançamentos classificados como receita após aplicar período, conta, centro, categoria e demais filtros.',
    utilidade: 'Mostra o tamanho da geração de caixa e permite comparar rapidamente contra despesas e saldo.'
  },
  DESPESAS: {
    titulo: 'Despesas',
    significado: 'Soma de todas as saídas filtradas no recorte atual.',
    calculo: 'Soma de valor_previsto de todos os lançamentos classificados como despesa dentro do recorte ativo.',
    utilidade: 'Ajuda a localizar pressão de custo e entender quanto da operação está consumindo caixa.'
  },
  SALDO: {
    titulo: 'Saldo',
    significado: 'Diferença entre receitas e despesas dentro do recorte analisado.',
    calculo: 'Receitas menos despesas no recorte filtrado.',
    utilidade: 'Resume se o período está gerando ou destruindo caixa após todos os filtros aplicados.'
  },
  PAGOS: {
    titulo: 'Pagos',
    significado: 'Total financeiro já executado com status pago.',
    calculo: 'Soma dos lançamentos com status PAGO dentro do recorte atual.',
    utilidade: 'Mede o quanto do planejamento virou execução real e ajuda a comparar previsto contra realizado.'
  },
  MARGEM_CORRENTE: {
    titulo: 'Margem corrente',
    significado: 'Percentual do saldo sobre a receita no período filtrado.',
    calculo: 'Saldo dividido por receitas, multiplicado por 100.',
    utilidade: 'Indica se a operação está preservando resultado depois de absorver as despesas.'
  },
  TICKET_MEDIO: {
    titulo: 'Ticket médio',
    significado: 'Valor médio por lançamento dentro do recorte atual.',
    calculo: 'Soma de receitas e despesas dividida pela quantidade de lançamentos filtrados.',
    utilidade: 'Ajuda a distinguir volume operacional de concentração em poucos lançamentos grandes.'
  },
  COBERTURA_FINANCEIRA: {
    titulo: 'Cobertura financeira',
    significado: 'Percentual das despesas do recorte que já encontra cobertura no valor executado/pago.',
    calculo: 'Pagos divididos pelas despesas, multiplicado por 100.',
    utilidade: 'Mostra quão protegido o caixa está para sustentar as saídas já mapeadas. Se cair, o risco operacional sobe.'
  },
  MAIOR_PRESSAO: {
    titulo: 'Maior pressão',
    significado: 'Categoria de despesa mais pesada no recorte atual.',
    calculo: 'Maior total agregado entre as categorias de despesa filtradas.',
    utilidade: 'Aponta onde vale agir primeiro para renegociar, cortar ou redistribuir esforço financeiro.'
  },
  MAIOR_MOTOR_RECEITA: {
    titulo: 'Maior motor de receita',
    significado: 'Categoria que mais impulsiona entradas no recorte atual.',
    calculo: 'Maior total agregado entre as categorias de receita filtradas.',
    utilidade: 'Mostra a alavanca comercial ou operacional mais relevante para proteger crescimento.'
  },
  FLUXO_CAIXA: {
    titulo: 'Fluxo de caixa',
    significado: 'Compara entradas e saídas ao longo do tempo no período selecionado.',
    calculo: 'Agrupa receitas e despesas por dia ou mês e plota as duas curvas lado a lado.',
    utilidade: 'Ajuda a localizar quando o caixa aperta, onde há concentração e em quais datas vale agir primeiro.'
  },
  DESPESAS_CATEGORIA: {
    titulo: 'Despesas por categoria',
    significado: 'Ranking das categorias que mais consomem caixa.',
    calculo: 'Soma das despesas por plano de contas, ordenadas do maior para o menor valor.',
    utilidade: 'Mostra onde cortar, renegociar ou acompanhar com mais disciplina.'
  },
  RECEITAS_CATEGORIA: {
    titulo: 'Receitas por categoria',
    significado: 'Ranking das categorias que mais geram entrada.',
    calculo: 'Soma das receitas por plano de contas, ordenadas do maior para o menor valor.',
    utilidade: 'Mostra de onde vem a força da operação e o que deve ser protegido para manter crescimento.'
  },
  ACUMULADO_REC_DESP: {
    titulo: 'Acumulado de receitas x despesas',
    significado: 'Evolução acumulada das entradas e saídas no período.',
    calculo: 'Faz a soma corrida de receitas e de despesas separadamente ao longo do tempo.',
    utilidade: 'Ajuda a ver se a operação compensa a saída ao longo do período ou apenas em pontos isolados.'
  },
  RESULTADO_OPERACIONAL: {
    titulo: 'Resultado operacional',
    significado: 'Saldo mensal ou anual após confrontar receitas e despesas.',
    calculo: 'Para cada mês, calcula receitas menos despesas.',
    utilidade: 'Mostra quais meses sustentam o resultado e quais meses drenam margem.'
  },
  RESUMO_OPERACIONAL: {
    titulo: 'Resumo operacional',
    significado: 'Resumo rápido da média, melhor e pior desempenho do recorte.',
    calculo: 'Usa a série de resultado operacional para extrair média, máximo e mínimo.',
    utilidade: 'Dá uma leitura executiva sem precisar percorrer todo o gráfico principal.'
  },
  RECEITAS_DESPESAS_ANO: {
    titulo: 'Receitas x despesas do ano',
    significado: 'Comparação mensal da composição do resultado.',
    calculo: 'Empilha receitas e despesas por mês dentro do ano selecionado.',
    utilidade: 'Mostra se o problema é falta de venda, excesso de custo ou os dois.'
  },
  MARGEM_OPERACIONAL_PAINEL: {
    titulo: 'Margem operacional',
    significado: 'Percentual de sobra operacional em cada mês.',
    calculo: 'Para cada mês: (receita - despesa) dividido por receita, em percentual.',
    utilidade: 'Mostra a qualidade do resultado, não só o tamanho absoluto dele.'
  },
  COMPARATIVO_ANO: {
    titulo: 'Comparativo ano a ano',
    significado: 'Confronta o comportamento do ano atual com o anterior.',
    calculo: 'Plota as duas séries anuais de resultado operacional na mesma linha do tempo.',
    utilidade: 'Ajuda a separar piora estrutural de variação pontual.'
  },
  SAZONALIDADE: {
    titulo: 'Sazonalidade',
    significado: 'Índice de quanto cada mês fica acima ou abaixo da média de atividade.',
    calculo: 'Compara o volume total do mês com a média anual e converte em índice percentual.',
    utilidade: 'Ajuda a planejar caixa, estoque, equipe e cobrança com antecedência.'
  },
  CENARIOS: {
    titulo: 'Cenários',
    significado: 'Faixa estimada de resultado considerando a volatilidade histórica do período.',
    calculo: 'Parte do saldo atual e soma ou subtrai o desvio padrão da série de resultados mensais para formar pessimista, realista e otimista.',
    utilidade: 'Serve para planejamento e proteção de caixa, mostrando um intervalo plausível em vez de um único número.'
  },
  RESULTADO_ACUMULADO: {
    titulo: 'Resultado acumulado',
    significado: 'Curva do saldo acumulado ao longo do período.',
    calculo: 'Soma progressiva dos resultados parciais de cada ponto temporal.',
    utilidade: 'Mostra quando a empresa entrou em tração ou quando começou a perder fôlego.'
  },
  PULSO_ACUMULADO: {
    titulo: 'Pulso do acumulado',
    significado: 'Snapshot executivo da curva acumulada em quatro leituras.',
    calculo: 'Extrai o fechamento final, o maior pico, o menor vale e a amplitude da série acumulada.',
    utilidade: 'Ajuda a explicar rapidamente estabilidade, stress e volatilidade do caixa sem ler o gráfico inteiro.'
  },
  FECHAMENTO_ACUMULADO: {
    titulo: 'Fechamento',
    significado: 'Valor final da curva acumulada no período.',
    calculo: 'Último ponto do resultado acumulado.',
    utilidade: 'Resume como o caixa terminou o recorte.'
  },
  PICO_ACUMULADO: {
    titulo: 'Pico',
    significado: 'Maior nível atingido pela curva acumulada.',
    calculo: 'Maior valor observado na série de resultado acumulado.',
    utilidade: 'Mostra o melhor momento de folga do caixa.'
  },
  VALE_ACUMULADO: {
    titulo: 'Vale',
    significado: 'Menor nível atingido pela curva acumulada.',
    calculo: 'Menor valor observado na série de resultado acumulado.',
    utilidade: 'Mostra o ponto de maior aperto ou risco de caixa.'
  },
  AMPLITUDE_ACUMULADO: {
    titulo: 'Amplitude',
    significado: 'Distância entre o pico e o vale do acumulado.',
    calculo: 'Pico menos vale.',
    utilidade: 'Mede a oscilação do caixa e ajuda a dimensionar a volatilidade operacional.'
  },
  STATUS_DISTRIB: {
    titulo: 'Distribuição por status',
    significado: 'Divide o valor entre o que já foi pago e o que continua pendente.',
    calculo: 'Separa o valor total dos lançamentos em dois blocos: pagos e pendentes.',
    utilidade: 'Ajuda a medir execução versus fila financeira pendente.'
  },
  PRODUTIVIDADE: {
    titulo: 'Produtividade',
    significado: 'Painel de execução financeira e carga operacional.',
    calculo: 'Combina percentual executado, tarefas pendentes e resultado do período.',
    utilidade: 'Mostra se a operação está performando, atrasando ou entregando resultado com eficiência.'
  },
  DESPESAS_CENTRO: {
    titulo: 'Despesas por centro',
    significado: 'Ranking dos centros de custo mais pesados.',
    calculo: 'Soma as despesas por centro de custo e ordena do maior para o menor.',
    utilidade: 'Permite cobrar dono, meta e retorno por área ou unidade operacional.'
  },
  ULTIMOS_LANCAMENTOS: {
    titulo: 'Últimos lançamentos',
    significado: 'Lista analítica do recorte já filtrado.',
    calculo: 'Ordena os lançamentos por data mais recente e exibe os primeiros itens.',
    utilidade: 'Serve para validar o que está explicando os gráficos e exportar o recorte final.'
  }
};

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

const getHeatCellClass = (ratio: number, tone: 'receita' | 'despesa') => {
  if (ratio <= 0) {
    return 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500';
  }

  if (tone === 'receita') {
    if (ratio > 0.75) return 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20';
    if (ratio > 0.5) return 'border-emerald-300 bg-emerald-200 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-500/40 dark:text-emerald-100';
    if (ratio > 0.25) return 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200';
    return 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';
  }

  if (ratio > 0.75) return 'border-rose-500 bg-rose-500 text-white shadow-lg shadow-rose-500/20';
  if (ratio > 0.5) return 'border-rose-300 bg-rose-200 text-rose-900 dark:border-rose-500 dark:bg-rose-500/40 dark:text-rose-100';
  if (ratio > 0.25) return 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-700 dark:bg-rose-500/20 dark:text-rose-200';
  return 'border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-500/10 dark:text-rose-300';
};

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

const formatTreemapLabel = (label: string, value: number, total: number) => {
  if (!label || total <= 0) return '';
  const ratio = value / total;
  if (ratio >= 0.18) return label;
  if (ratio >= 0.1) return label.length > 14 ? `${label.slice(0, 14)}...` : label;
  return '';
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
  const [contas, setContas] = useState<Conta[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [periodoTipo, setPeriodoTipo] = useState<'MES' | 'ANO' | 'PERSONALIZADO'>('MES');
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [periodoIni, setPeriodoIni] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodoFim, setPeriodoFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedCategorias, setSelectedCategorias] = useState<Set<number>>(new Set());
  const [includeNaoOperacionaisCategorias, setIncludeNaoOperacionaisCategorias] = useState(false);
  const [selectedCentro, setSelectedCentro] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<'TODOS' | 'PAGO' | 'PENDENTE'>('TODOS');
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | 'RECEITA' | 'DESPESA'>('TODOS');
  const [previstoFiltro, setPrevistoFiltro] = useState<'TODOS' | 'SIM' | 'NAO'>('TODOS');
  const [competenciaFiltro, setCompetenciaFiltro] = useState('');
  const [filtroHojeAtivo, setFiltroHojeAtivo] = useState(false);
  const [selectedConta, setSelectedConta] = useState<number | null>(null);
  const [analysisQuery, setAnalysisQuery] = useState('');
  const [financeDrilldown, setFinanceDrilldown] = useState<FinanceDrilldown>(null);
  const [visibleKpiMeaning, setVisibleKpiMeaning] = useState<KpiTooltipState | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = () => setIsDark(document.documentElement.classList.contains('dark'));
    window.addEventListener('theme-change', handler);
    return () => window.removeEventListener('theme-change', handler);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const categoriasExcluidasResultado = useMemo(() => buildExcludedCategoriaIds(categorias), [categorias]);

  const matchesDashboardFilters = (l: Lancamento, includeOperational = false) => {
    const hoje = toDateOnly(new Date());
    if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
    if (includeOperational && categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
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
    if (selectedConta && Number((l as any).conta_id) !== Number(selectedConta)) return false;
    if (selectedDate && toDateOnlyStr(l.data_vencimento) !== selectedDate) return false;
    if (!selectedDate && selectedMonth && !toDateOnlyStr(l.data_vencimento).startsWith(selectedMonth)) return false;
    if (statusFiltro !== 'TODOS' && String(l.status).toUpperCase() !== statusFiltro) return false;
    if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
    if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
    return true;
  };

  const matchesDashboardFiltersNoDate = (l: Lancamento, includeOperational = false) => {
    const hoje = toDateOnly(new Date());
    if ((l.origem || '').toUpperCase() === 'TRANSFERENCIA') return false;
    if (includeOperational && categoriasExcluidasResultado.has(Number(l.plano_contas_id))) return false;
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
    if (selectedConta && Number((l as any).conta_id) !== Number(selectedConta)) return false;
    if (statusFiltro !== 'TODOS' && String(l.status).toUpperCase() !== statusFiltro) return false;
    if (tipoFiltro === 'RECEITA' && !isReceita(l.tipo)) return false;
    if (tipoFiltro === 'DESPESA' && !isDespesa(l.tipo)) return false;
    return true;
  };

  useEffect(() => {
    loadDashboard();
  }, [mes, ano, periodoIni, periodoFim, periodoTipo]);

  useEffect(() => {
    setSelectedDate(null);
    setSelectedMonth(null);
    setFinanceDrilldown(null);
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
      const [rLanc, rCats, rCentros, rTodos, rContas] = await Promise.all([
        api.get('/lancamentos/', { params: { limit: 5000, data_inicio: start, data_fim: end } }),
        api.get('/plano-contas/'),
        api.get('/centro-custo/'),
        api.get('/todos/me'),
        api.get('/contas/', { params: { include_saldo: false } })
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
      setContas(rContas.data || []);
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

  const hojeIso = toDateOnly(new Date());
  const amanhaIso = toDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const toggleFinanceDrilldown = (next: Exclude<FinanceDrilldown, null>) => {
    setFinanceDrilldown((prev) => prev === next ? null : next);
  };

  const scheduleKpiMeaning = (key: DashboardHelpKey, ...args: [HTMLElement?, number?]) => {
    const delay = typeof args[1] === 'number' ? args[1] : 650;
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setVisibleKpiMeaning({ key });
    }, delay);
  };

  const hideKpiMeaning = () => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setVisibleKpiMeaning(null);
  };

  const matchesFinanceDrilldown = (lancamento: Lancamento, scope: 'PAGAR' | 'RECEBER') => {
    if (scope === 'PAGAR' && !isDespesa(lancamento.tipo)) return false;
    if (scope === 'RECEBER' && !isReceita(lancamento.tipo)) return false;
    if (!financeDrilldown || !financeDrilldown.startsWith(scope)) return true;

    const vencimento = toDateOnlyStr(lancamento.data_vencimento);
    const pago = isPago(lancamento.status);

    switch (financeDrilldown) {
      case 'PAGAR_HOJE':
      case 'RECEBER_HOJE':
        return !pago && vencimento === hojeIso;
      case 'PAGAR_AMANHA':
      case 'RECEBER_AMANHA':
        return !pago && vencimento === amanhaIso;
      case 'PAGAR_ATRASADAS':
      case 'RECEBER_ATRASADAS':
        return !pago && vencimento < hojeIso;
      case 'PAGAR_REALIZADAS':
      case 'RECEBER_REALIZADAS':
        return pago;
      case 'PAGAR_ABERTO':
      case 'RECEBER_ABERTO':
        return !pago;
      case 'PAGAR_TOTAL':
      case 'RECEBER_TOTAL':
      default:
        return true;
    }
  };

  const filteredLancamentos = useMemo(() => {
    return lancamentos.filter((l) => matchesDashboardFilters(l, false));
  }, [lancamentos, selectedCategorias, selectedCentro, selectedConta, selectedDate, selectedMonth, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalFilteredLancamentos = useMemo(() => {
    return lancamentos.filter((l) => matchesDashboardFilters(l, true));
  }, [lancamentos, selectedCategorias, selectedCentro, selectedConta, selectedDate, selectedMonth, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalBaseFilteredNoDate = useMemo(() => {
    return lancamentosAno.filter((l) => matchesDashboardFiltersNoDate(l, true));
  }, [lancamentosAno, selectedCategorias, selectedCentro, selectedConta, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

  const operationalBaseFilteredAnoAnterior = useMemo(() => {
    return lancamentosAnoAnterior.filter((l) => matchesDashboardFiltersNoDate(l, true));
  }, [lancamentosAnoAnterior, selectedCategorias, selectedCentro, selectedConta, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, categoriasExcluidasResultado]);

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

  const operationalKpis = useMemo(() => {
    let receitas = 0; let despesas = 0; let pagos = 0; let pendentes = 0;
    operationalFilteredLancamentos.forEach(l => {
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) receitas += val;
      else despesas += val;
      if (isPago(l.status)) pagos += val; else pendentes += val;
    });
    return { receitas, despesas, saldo: receitas - despesas, pagos, pendentes };
  }, [operationalFilteredLancamentos]);

  const categoriaPorId = useMemo(() => new Map(categorias.map((categoria) => [Number(categoria.id), categoria.nome])), [categorias]);
  const centroPorId = useMemo(() => new Map(centros.map((centro) => [Number(centro.id), centro.nome])), [centros]);
  const contaPorId = useMemo(() => new Map(contas.map((conta) => [Number(conta.id), conta])), [contas]);

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
        contaSelecionada: selectedConta,
        drilldownFinanceiro: financeDrilldown,
      },
      metricas: {
        totalLancamentosFiltrados: filteredLancamentos.length,
        receitas: kpis.receitas,
        despesas: kpis.despesas,
        saldo: kpis.saldo,
        pagos: kpis.pagos,
        pendentes: kpis.pendentes,
      },
      metricas_operacionais: {
        totalLancamentosOperacionais: operationalFilteredLancamentos.length,
        receitas: operationalKpis.receitas,
        despesas: operationalKpis.despesas,
        saldo: operationalKpis.saldo,
        pagos: operationalKpis.pagos,
        pendentes: operationalKpis.pendentes,
      },
    };
  }, [periodoTipo, mes, ano, periodoIni, periodoFim, statusFiltro, tipoFiltro, previstoFiltro, competenciaFiltro, filtroHojeAtivo, selectedCategorias, selectedCentro, selectedConta, financeDrilldown, filteredLancamentos.length, kpis, operationalFilteredLancamentos.length, operationalKpis]);

  const fluxoDiario = useMemo(() => {
    if (periodoTipo === 'ANO') {
      const rec: number[] = Array(12).fill(0);
      const desp: number[] = Array(12).fill(0);
      operationalFilteredLancamentos.forEach(l => {
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
  }, [operationalFilteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo]);

  const resultadoMensal = useMemo(() => {
    const map = new Map<string, { rec: number; desp: number }>();
    operationalFilteredLancamentos.forEach(l => {
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
  }, [operationalFilteredLancamentos]);

  const resultadoMensalAno = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() : Number(mes.slice(0, 4)));

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    operationalBaseFilteredNoDate.forEach(l => {
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
  }, [operationalBaseFilteredNoDate, periodoTipo, ano, periodoIni, mes]);

  const resultadoMensalAnoAnterior = useMemo(() => {
    const yearBase = periodoTipo === 'ANO'
      ? ano - 1
      : (periodoTipo === 'PERSONALIZADO' ? new Date(periodoIni).getFullYear() - 1 : Number(mes.slice(0, 4)) - 1);

    const rec = Array(12).fill(0);
    const desp = Array(12).fill(0);
    operationalBaseFilteredAnoAnterior.forEach(l => {
      const d = parseDateLocal(l.data_vencimento);
      if (!d || d.getFullYear() !== yearBase) return;
      const idx = d.getMonth();
      const val = Number(l.valor_previsto || 0);
      if (isReceita(l.tipo)) rec[idx] += val; else desp[idx] += val;
    });

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const values = rec.map((r, i) => r - desp[i]);
    return { year: yearBase, labels, values };
  }, [operationalBaseFilteredAnoAnterior, periodoTipo, ano, periodoIni, mes]);

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
    const atrasados = operationalFilteredLancamentos
      .filter(l => !isPago(l.status) && toDateOnlyStr(l.data_vencimento) < hojeIso)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const pagos = operationalFilteredLancamentos.filter(l => isPago(l.status)).reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const pendentes = operationalFilteredLancamentos
      .filter(l => !isPago(l.status) && toDateOnlyStr(l.data_vencimento) >= hojeIso)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    return { pagos, pendentes, atrasados };
  }, [hojeIso, operationalFilteredLancamentos]);

  const categoryChartLancamentos = useMemo(() => {
    return includeNaoOperacionaisCategorias ? filteredLancamentos : operationalFilteredLancamentos;
  }, [filteredLancamentos, includeNaoOperacionaisCategorias, operationalFilteredLancamentos]);

  const despesasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    categoryChartLancamentos.forEach(l => {
      if (!isDespesa(l.tipo)) return;
      const catId = Number(l.plano_contas_id);
      if (!catId) return;
      map.set(catId, (map.get(catId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cat = categorias.find(c => Number(c.id) === Number(id));
      return { id, label: cat?.nome || `Categoria ${id}`, total };
    }).sort((a, b) => b.total - a.total);

    const top = rows.slice(0, 12);
    const others = rows.slice(12).reduce((acc, r) => acc + r.total, 0);
    if (others > 0) top.push({ id: -1, label: 'Outros', total: others });
    return top;
  }, [categoryChartLancamentos, categorias]);

  const receitasPorCategoria = useMemo(() => {
    const map = new Map<number, number>();
    categoryChartLancamentos.forEach(l => {
      if (!isReceita(l.tipo)) return;
      const catId = Number(l.plano_contas_id);
      if (!catId) return;
      map.set(catId, (map.get(catId) || 0) + Number(l.valor_previsto || 0));
    });
    const rows = Array.from(map.entries()).map(([id, total]) => {
      const cat = categorias.find(c => Number(c.id) === Number(id));
      return { id, label: cat?.nome || `Categoria ${id}`, total };
    }).sort((a, b) => b.total - a.total);

    const top = rows.slice(0, 8);
    const others = rows.slice(8).reduce((acc, r) => acc + r.total, 0);
    if (others > 0) top.push({ id: -1, label: 'Outros', total: others });
    return top;
  }, [categoryChartLancamentos, categorias]);

  const despesasTreemapData = useMemo(() => despesasPorCategoria.map(r => ({ x: r.label, y: r.total })), [despesasPorCategoria]);
  const receitasTreemapData = useMemo(() => receitasPorCategoria.map(r => ({ x: r.label, y: r.total })), [receitasPorCategoria]);
  const totalDespesasTreemap = useMemo(() => despesasTreemapData.reduce((acc, item) => acc + item.y, 0), [despesasTreemapData]);
  const totalReceitasTreemap = useMemo(() => receitasTreemapData.reduce((acc, item) => acc + item.y, 0), [receitasTreemapData]);

  const despesasPorCentro = useMemo(() => {
    const map = new Map<number, number>();
    operationalFilteredLancamentos.forEach(l => {
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
  }, [operationalFilteredLancamentos, centros]);

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

    const base = operationalFilteredLancamentos.filter(l => l.data_vencimento && l.data_vencimento >= start && l.data_vencimento <= end);

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
  }, [operationalFilteredLancamentos, mes, ano, periodoIni, periodoFim, periodoTipo, selectedDate]);

  const lancamentosContasDetalhe = useMemo(() => {
    const sorted = [...filteredLancamentos].sort((a, b) => {
      const da = parseDateLocal(a.data_vencimento)?.getTime() || 0;
      const db = parseDateLocal(b.data_vencimento)?.getTime() || 0;
      return db - da;
    });
    return {
      pagar: sorted.filter((l) => matchesFinanceDrilldown(l, 'PAGAR')).slice(0, 20),
      receber: sorted.filter((l) => matchesFinanceDrilldown(l, 'RECEBER')).slice(0, 20),
    };
  }, [filteredLancamentos, financeDrilldown]);

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

  const heatmapReferenceMonth = useMemo(() => {
    if (selectedDate) return selectedDate.slice(0, 7);
    if (selectedMonth) return selectedMonth;
    if (periodoTipo === 'MES') return mes;
    if (periodoTipo === 'ANO') {
      const month = ano === new Date().getFullYear() ? String(new Date().getMonth() + 1).padStart(2, '0') : '01';
      return `${ano}-${month}`;
    }
    return periodoIni.slice(0, 7);
  }, [selectedDate, selectedMonth, periodoTipo, mes, ano, periodoIni]);

  const heatmapCalendario = useMemo(() => {
    const { start, end } = getMonthRange(heatmapReferenceMonth);
    const startDate = parseDateLocal(start) || new Date();
    const endDate = parseDateLocal(end) || new Date();
    const weekLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const receitasMap = new Map<string, number>();
    const despesasMap = new Map<string, number>();

    filteredLancamentos.forEach((lancamento) => {
      const date = toDateOnlyStr(lancamento.data_vencimento);
      if (!date.startsWith(heatmapReferenceMonth)) return;
      const value = Number(lancamento.valor_previsto || 0);
      if (isReceita(lancamento.tipo)) {
        receitasMap.set(date, (receitasMap.get(date) || 0) + value);
      } else {
        despesasMap.set(date, (despesasMap.get(date) || 0) + value);
      }
    });

    const firstCell = new Date(startDate);
    firstCell.setDate(startDate.getDate() - startDate.getDay());
    const lastCell = new Date(endDate);
    lastCell.setDate(endDate.getDate() + (6 - endDate.getDay()));

    const cells: Array<{ date: string; dayLabel: string; isCurrentMonth: boolean; receita: number; despesa: number; weekIndex: number; weekdayIndex: number }> = [];
    let cursor = new Date(firstCell);
    let weekIndex = 0;
    while (cursor <= lastCell) {
      const currentDate = toDateOnly(cursor);
      cells.push({
        date: currentDate,
        dayLabel: String(cursor.getDate()).padStart(2, '0'),
        isCurrentMonth: currentDate.startsWith(heatmapReferenceMonth),
        receita: receitasMap.get(currentDate) || 0,
        despesa: despesasMap.get(currentDate) || 0,
        weekIndex,
        weekdayIndex: cursor.getDay(),
      });
      if (cursor.getDay() === 6) weekIndex += 1;
      cursor.setDate(cursor.getDate() + 1);
    }

    const maxReceita = Math.max(...cells.map((cell) => cell.receita), 0);
    const maxDespesa = Math.max(...cells.map((cell) => cell.despesa), 0);

    return {
      monthLabel: formatMonthLabel(heatmapReferenceMonth),
      weekLabels,
      weeks: Array.from({ length: Math.max(...cells.map((cell) => cell.weekIndex), 0) + 1 }, (_, index) => ({
        label: `S${index + 1}`,
        cells: cells.filter((cell) => cell.weekIndex === index),
      })),
      maxReceita,
      maxDespesa,
    };
  }, [filteredLancamentos, heatmapReferenceMonth]);

  const bancosEmFoco = useMemo(() => {
    const grouped = new Map<number, { contaId: number; nome: string; banco: string; total: number; saldo: number; quantidade: number }>();

    filteredLancamentos.forEach((lancamento) => {
      const contaId = Number((lancamento as any).conta_id);
      if (!Number.isFinite(contaId) || contaId <= 0) return;

      const conta = contaPorId.get(contaId);
      const current = grouped.get(contaId) || {
        contaId,
        nome: conta?.nome || `Conta ${contaId}`,
        banco: conta?.banco || 'Banco não informado',
        total: 0,
        saldo: 0,
        quantidade: 0,
      };
      const valor = Number(lancamento.valor_previsto || 0);
      current.total += valor;
      current.saldo += isReceita(lancamento.tipo) ? valor : -valor;
      current.quantidade += 1;
      grouped.set(contaId, current);
    });

    return Array.from(grouped.values())
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 6);
  }, [filteredLancamentos, contaPorId]);

  const margemPercentual = operationalKpis.receitas > 0 ? (operationalKpis.saldo / operationalKpis.receitas) * 100 : 0;
  const ticketMedio = operationalFilteredLancamentos.length > 0 ? (operationalKpis.receitas + operationalKpis.despesas) / operationalFilteredLancamentos.length : 0;
  const coberturaPagamentos = operationalKpis.despesas > 0 ? (operationalKpis.pagos / operationalKpis.despesas) * 100 : 0;
  const mixFinanceiro = useMemo(() => {
    const total = operationalKpis.receitas + operationalKpis.despesas;
    if (total <= 0) {
      return { receitaPct: 50, despesaPct: 50 };
    }
    return {
      receitaPct: (operationalKpis.receitas / total) * 100,
      despesaPct: (operationalKpis.despesas / total) * 100,
    };
  }, [operationalKpis.despesas, operationalKpis.receitas]);

  const sinaisExecutivos = useMemo(() => {
    const receitaDominante = receitasPorCategoria[0];
    const despesaDominante = despesasPorCategoria[0];
    return [
      {
        key: 'MARGEM_CORRENTE' as const,
        titulo: 'Margem corrente',
        valor: `${margemPercentual.toFixed(1)}%`,
        apoio: margemPercentual >= 0 ? 'Resultado operacional saudável no recorte.' : 'Despesas comprimindo o caixa no recorte.',
        destaque: margemPercentual >= 0 ? 'text-emerald-600' : 'text-rose-500',
      },
      {
        key: 'TICKET_MEDIO' as const,
        titulo: 'Ticket médio',
        valor: BRL.format(ticketMedio),
        apoio: `${filteredLancamentos.length} lançamentos considerados após os filtros.`,
        destaque: 'text-slate-900 dark:text-white',
      },
      {
        key: 'COBERTURA_FINANCEIRA' as const,
        titulo: 'Cobertura financeira',
        valor: `${coberturaPagamentos.toFixed(1)}%`,
        apoio: 'Percentual do valor filtrado já executado/pago.',
        destaque: 'text-indigo-600',
      },
      {
        key: 'MAIOR_PRESSAO' as const,
        titulo: 'Maior pressão',
        valor: despesaDominante ? despesaDominante.label : 'Sem destaque',
        apoio: despesaDominante ? BRL.format(despesaDominante.total) : 'Sem despesas relevantes no período.',
        destaque: 'text-rose-500',
      },
      {
        key: 'MAIOR_MOTOR_RECEITA' as const,
        titulo: 'Maior motor de receita',
        valor: receitaDominante ? receitaDominante.label : 'Sem destaque',
        apoio: receitaDominante ? BRL.format(receitaDominante.total) : 'Sem receitas relevantes no período.',
        destaque: 'text-emerald-600',
      },
    ];
  }, [coberturaPagamentos, despesasPorCategoria, filteredLancamentos.length, margemPercentual, receitasPorCategoria, ticketMedio]);

  const linhasAnaliticas = useMemo(() => {
    const query = analysisQuery.trim().toLowerCase();
    return [...filteredLancamentos]
      .sort((a, b) => (parseDateLocal(b.data_vencimento)?.getTime() || 0) - (parseDateLocal(a.data_vencimento)?.getTime() || 0))
      .map((lancamento) => ({
        ...lancamento,
        categoriaId: Number(lancamento.plano_contas_id),
        categoriaNome: categoriaPorId.get(Number(lancamento.plano_contas_id)) || 'Sem categoria',
        centroNome: centroPorId.get(Number(lancamento.centro_custo_id)) || 'Sem centro',
        contaNome: contaPorId.get(Number((lancamento as any).conta_id))?.nome || 'Sem conta',
        bancoNome: contaPorId.get(Number((lancamento as any).conta_id))?.banco || 'Sem banco',
        naoOperacional: categoriasExcluidasResultado.has(Number(lancamento.plano_contas_id)),
      }))
      .filter((lancamento) => {
        if (!query) return true;
        const haystack = [
          lancamento.descricao,
          lancamento.categoriaNome,
          lancamento.centroNome,
          lancamento.contaNome,
          lancamento.bancoNome,
          lancamento.status,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
  }, [analysisQuery, categoriaPorId, centroPorId, contaPorId, filteredLancamentos, categoriasExcluidasResultado]);

  const linhasAnaliticasResumo = useMemo(() => {
    const receitasOperacionais = linhasAnaliticas
      .filter((l) => isReceita(l.tipo) && !l.naoOperacional)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const despesasOperacionais = linhasAnaliticas
      .filter((l) => isDespesa(l.tipo) && !l.naoOperacional)
      .reduce((acc, l) => acc + Number(l.valor_previsto || 0), 0);
    const movimentosNaoOperacionais = linhasAnaliticas
      .filter((l) => l.naoOperacional)
      .reduce((acc, l) => acc + (isReceita(l.tipo) ? Number(l.valor_previsto || 0) : -Number(l.valor_previsto || 0)), 0);
    const saldoConsolidado = linhasAnaliticas
      .reduce((acc, l) => acc + (isReceita(l.tipo) ? Number(l.valor_previsto || 0) : -Number(l.valor_previsto || 0)), 0);

    return {
      receitasOperacionais,
      despesasOperacionais,
      movimentosNaoOperacionais,
      saldoConsolidado,
    };
  }, [linhasAnaliticas]);

  const resumoExecutivoDashboard = useMemo(() => {
    const topDespesas = despesasPorCategoria.slice(0, 3).map((item) => ({ categoria: item.label, total: item.total }));
    const topReceitas = receitasPorCategoria.slice(0, 3).map((item) => ({ categoria: item.label, total: item.total }));
    const topCentros = despesasPorCentro.slice(0, 3).map((item) => ({ centro: item.label, total: item.total }));
    const ultimosLancamentosResumo = topLancamentos.slice(0, 5).map((item) => ({
      data: item.data_vencimento,
      descricao: item.descricao,
      tipo: item.tipo,
      valor: item.valor_previsto,
      status: item.status,
    }));

    const mediaMensal = resultadoMensal.values.length
      ? resultadoMensal.values.reduce((acc, value) => acc + value, 0) / resultadoMensal.values.length
      : 0;
    const mediaAno = resultadoMensalAno.values.reduce((acc, value) => acc + value, 0) / (resultadoMensalAno.values.length || 1);
    const varianciaAno = resultadoMensalAno.values.reduce((acc, value) => acc + Math.pow(value - mediaAno, 2), 0) / (resultadoMensalAno.values.length || 1);
    const desvioAno = Math.sqrt(varianciaAno);

    return {
      resultado_operacional: {
        media_mensal: mediaMensal,
        melhor_mes: resultadoMensalAno.values.length ? Math.max(...resultadoMensalAno.values) : 0,
        pior_mes: resultadoMensalAno.values.length ? Math.min(...resultadoMensalAno.values) : 0,
        resultado_acumulado_final: resultadoAcumulado.values.at(-1) || 0,
      },
      cenarios: {
        pessimista: operationalKpis.saldo - desvioAno,
        realista: operationalKpis.saldo,
        otimista: operationalKpis.saldo + desvioAno,
      },
      contas_a_pagar: contasHoje.pagar,
      contas_a_receber: contasHoje.receber,
      distribuicao_status: statusDistrib,
      top_despesas_categoria: topDespesas,
      top_receitas_categoria: topReceitas,
      top_centros_custo: topCentros,
      ultimos_lancamentos: ultimosLancamentosResumo,
      variacao_ano_contra_ano: {
        ano_atual: resultadoMensalAno.year,
        ano_anterior: resultadoMensalAnoAnterior.year,
        resultado_atual: resultadoMensalAno.values.reduce((acc, value) => acc + value, 0),
        resultado_anterior: resultadoMensalAnoAnterior.values.reduce((acc, value) => acc + value, 0),
      },
    };
  }, [contasHoje, despesasPorCategoria, despesasPorCentro, operationalKpis.saldo, receitasPorCategoria, resultadoAcumulado.values, resultadoMensal, resultadoMensalAno, resultadoMensalAnoAnterior, statusDistrib, topLancamentos]);

  const exportRows = (rows: Lancamento[]) => rows.map((l) => ({
      data_vencimento: l.data_vencimento,
      data_pagamento: l.data_pagamento || '',
      descricao: l.descricao,
      tipo: l.tipo,
      categoria: categoriaPorId.get(Number(l.plano_contas_id)) || '',
      entidade: '',
      banco: contaPorId.get(Number((l as any).conta_id))?.banco || '',
      conta: contaPorId.get(Number((l as any).conta_id))?.nome || '',
      centro_custo: centroPorId.get(Number(l.centro_custo_id)) || '',
      valor_previsto: l.valor_previsto,
      valor_pago: l.valor_pago,
      status: l.status
    }));

  const exportLancamentos = async (rows: Lancamento[], format: 'csv' | 'xlsx', fileName: string) => {
    const exportData = exportRows(rows);

    if (format === 'csv') {
      const header = 'data_vencimento,data_pagamento,descricao,tipo,categoria,centro_custo,conta,banco,valor_previsto,valor_pago,status\n';
      const csv = header + exportData.map(r => `${r.data_vencimento},${r.data_pagamento},"${String(r.descricao).replace(/"/g, '""')}",${r.tipo},"${String(r.categoria).replace(/"/g, '""')}","${String(r.centro_custo).replace(/"/g, '""')}","${String(r.conta).replace(/"/g, '""')}","${String(r.banco).replace(/"/g, '""')}",${r.valor_previsto},${r.valor_pago},${r.status}`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Lancamentos');
    ws.columns = [
      { header: 'Data Vencimento', key: 'data_vencimento', width: 14 },
      { header: 'Data Pagamento', key: 'data_pagamento', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 40 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Categoria', key: 'categoria', width: 22 },
      { header: 'Centro de Custo', key: 'centro_custo', width: 22 },
      { header: 'Conta', key: 'conta', width: 22 },
      { header: 'Banco', key: 'banco', width: 18 },
      { header: 'Valor Previsto', key: 'valor_previsto', width: 16 },
      { header: 'Valor Pago', key: 'valor_pago', width: 14 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    exportData.forEach(r => ws.addRow(r));

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportUltimosLancamentos = async (format: 'csv' | 'xlsx') => {
    await exportLancamentos(topLancamentos, format, `ultimos_lancamentos_${mes}`);
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
    series: [{ name: 'Despesas Operacionais', data: despesasTreemapData }],
    options: {
      chart: {
        type: 'treemap',
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
      legend: { show: false },
      dataLabels: {
        enabled: true,
        style: { fontSize: '11px', fontWeight: 700 },
        formatter: (_: string, opts: any) => {
          const point = despesasTreemapData[opts.dataPointIndex];
          if (!point) return '';
          return formatTreemapLabel(point.x, point.y, totalDespesasTreemap);
        },
      },
      plotOptions: { treemap: { distributed: true, enableShades: true, shadeIntensity: 0.18, borderRadius: 8 } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { formatter: (_: string, opts: any) => despesasTreemapData[opts.dataPointIndex]?.x || '' },
        y: { formatter: (val: number) => BRL.format(val) }
      },
      colors: ['#ef4444', '#f97316', '#f59e0b', '#fb7185', '#e11d48', '#c2410c', '#a855f7']
    } as any
  };

  const chartReceitasCategorias = {
    series: [{ name: 'Receitas Operacionais', data: receitasTreemapData }],
    options: {
      chart: {
        type: 'treemap',
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
      legend: { show: false },
      dataLabels: {
        enabled: true,
        style: { fontSize: '11px', fontWeight: 700 },
        formatter: (_: string, opts: any) => {
          const point = receitasTreemapData[opts.dataPointIndex];
          if (!point) return '';
          return formatTreemapLabel(point.x, point.y, totalReceitasTreemap);
        },
      },
      plotOptions: { treemap: { distributed: true, enableShades: true, shadeIntensity: 0.18, borderRadius: 8 } },
      tooltip: {
        theme: isDark ? 'dark' : 'light',
        x: { formatter: (_: string, opts: any) => receitasTreemapData[opts.dataPointIndex]?.x || '' },
        y: { formatter: (val: number) => BRL.format(val) }
      },
      colors: ['#10b981', '#14b8a6', '#22c55e', '#06b6d4', '#0ea5e9', '#84cc16', '#3b82f6']
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

  const totalPrevisto = operationalKpis.receitas + operationalKpis.despesas;
  const execucaoPct = totalPrevisto > 0 ? Math.round((operationalKpis.pagos / totalPrevisto) * 100) : 0;
  const todoPendentesPct = useMemo(() => {
    const total = todos.length;
    if (!total) return 0;
    const pendentes = todos.filter(t => t.status !== 'CONCLUIDO' && t.status !== 'CANCELADO').length;
    return Math.round((pendentes / total) * 100);
  }, [todos]);
  const mediaResultado = resultadoMensal.values.length
    ? resultadoMensal.values.reduce((acc, v) => acc + v, 0) / resultadoMensal.values.length
    : 0;

  const produtividadeIndicadores = [
    { key: 'execucao', label: 'Execução financeira', valor: `${execucaoPct}%`, percentual: execucaoPct, tone: 'bg-indigo-500', apoio: 'Volume financeiro já executado.' },
    { key: 'pendencias', label: 'Pendências operacionais', valor: `${todoPendentesPct}%`, percentual: todoPendentesPct, tone: 'bg-amber-500', apoio: 'Percentual de tarefas ainda abertas.' },
    { key: 'cobertura', label: 'Cobertura de despesas', valor: `${coberturaPagamentos.toFixed(1)}%`, percentual: Math.max(0, Math.min(100, coberturaPagamentos)), tone: 'bg-emerald-500', apoio: 'Quanto das despesas já encontra cobertura financeira.' },
  ];

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
      pessimista: operationalKpis.saldo - desvio,
      realista: operationalKpis.saldo,
      otimista: operationalKpis.saldo + desvio
    };
  }, [resultadoMensalAno.values, operationalKpis.saldo]);

  const resultadoAcumuladoSnapshot = useMemo(() => {
    if (!resultadoAcumulado.values.length) {
      return { final: 0, pico: 0, vale: 0, amplitude: 0 };
    }

    const final = resultadoAcumulado.values[resultadoAcumulado.values.length - 1] || 0;
    const pico = Math.max(...resultadoAcumulado.values);
    const vale = Math.min(...resultadoAcumulado.values);
    return {
      final,
      pico,
      vale,
      amplitude: pico - vale,
    };
  }, [resultadoAcumulado.values]);

  const dashboardGlossario = useMemo(() => (Object.entries(DASHBOARD_HELP).map(([key, value]) => ({
    chave: key,
    titulo: value.titulo,
    significado: value.significado,
    calculo: value.calculo,
    utilidade: value.utilidade,
  }))), []);

  const assistenteConfig = useMemo(() => ({
    tela: 'dashboard' as const,
    titulo: 'Assistente KyrusTECH',
    contexto: {
      ...aiContexto,
      modo_consultoria: 'financeira_empresarial',
      resumo_executivo: resumoExecutivoDashboard,
      sinais_executivos: sinaisExecutivos,
      bancos_em_foco: bancosEmFoco,
      glossario_dashboard: dashboardGlossario,
      recorte_interativo: {
        dataSelecionada: selectedDate,
        mesSelecionado: selectedMonth,
        drilldownFinanceiro: financeDrilldown,
      },
      instrucao_analise: 'Explique o dashboard em profundidade e entregue a analise agora, sem responder que vai analisar depois. Quando a pergunta for vaga, descubra o painel mais provavel pelo contexto e use o glossario do dashboard para explicar significado, calculo e utilidade pratica. Aponte causas, riscos, oportunidades e prioridades de melhoria viaveis. Estruture a resposta com: resumo executivo, sinais positivos, sinais de alerta, causas provaveis, impacto no caixa e lucro, acoes imediatas, acoes estruturais e perguntas de acompanhamento.',
    },
    sugestoes: [
      'Analise este dashboard como meu consultor financeiro e empresarial.',
      'Explique detalhadamente o que esta acontecendo nos indicadores.',
      'Quais melhorias praticas podem elevar resultado, caixa e previsibilidade?',
    ],
  }), [aiContexto, bancosEmFoco, dashboardGlossario, financeDrilldown, resumoExecutivoDashboard, selectedDate, selectedMonth, sinaisExecutivos]);

  useAssistentePage(assistenteConfig);

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
    series: [statusDistrib.pagos, statusDistrib.pendentes, statusDistrib.atrasados],
    options: {
      chart: { type: 'donut', height: 220, toolbar: { show: false } },
      theme: { mode: isDark ? 'dark' : 'light' },
      foreColor: isDark ? '#cbd5f5' : '#475569',
      labels: ['Pagos', 'Pendentes', 'Atrasados'],
      dataLabels: { enabled: false },
      colors: ['#10b981', '#f59e0b', '#ef4444'],
      legend: { position: 'top' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: 'Total',
                formatter: () => BRL.format(statusDistrib.pagos + statusDistrib.pendentes + statusDistrib.atrasados),
              },
            },
          },
        },
      },
      stroke: { width: 0 },
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
      {selectedConta && (
        <button
          onClick={() => setSelectedConta(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 flex items-center gap-1"
        >
          <Landmark className="w-3 h-3" />
          {contaPorId.get(selectedConta)?.nome || 'Conta'}
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
      {financeDrilldown && (
        <button
          onClick={() => setFinanceDrilldown(null)}
          className="px-3 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-700 border border-rose-200 flex items-center gap-1"
        >
          <Wallet className="w-3 h-3" />
          {FINANCE_DRILLDOWN_LABELS[financeDrilldown]}
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
      {!selectedCategorias.size && !selectedCentro && !selectedConta && !selectedDate && !selectedMonth && statusFiltro === 'TODOS' && tipoFiltro === 'TODOS' && previstoFiltro === 'TODOS' && !competenciaFiltro && !filtroHojeAtivo && (
        <span className="text-xs text-slate-400">Clique nos gráficos para filtrar</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 px-4 sm:px-8 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-800 dark:text-white">Dashboard</h2>
          <p className="text-sm text-slate-400">Operação financeira conectada, filtrável e pronta para exportação</p>
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
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_38%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.22),transparent_28%),linear-gradient(135deg,#ffffff_0%,#f8fafc_48%,#ecfeff_100%)] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_38%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.95)_48%,rgba(8,47,73,0.92)_100%)]">
          <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="absolute -bottom-16 left-10 h-44 w-44 rounded-full bg-sky-400/10 blur-3xl" />
          <div className="relative grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                    Sala de controle financeira
                  </div>
                  <h3 className="max-w-3xl text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                    Visão integrada do caixa, pressão de despesas e resposta por banco.
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Todos os painéis abaixo reagem aos filtros, aos cliques nos gráficos e ao banco selecionado. Use o heatmap para abrir dias críticos e a base analítica para exportar exatamente o recorte em tela.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/75 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Período ativo</p>
                  <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    {periodoTipo === 'MES' ? formatMonthLabel(mes) : periodoTipo === 'ANO' ? String(ano) : `${parseDateLocal(periodoIni)?.toLocaleDateString('pt-BR')} → ${parseDateLocal(periodoFim)?.toLocaleDateString('pt-BR')}`}
                  </p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{filteredLancamentos.length} lançamentos após filtros ativos</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {sinaisExecutivos.slice(0, 3).map((sinal) => (
                  <div
                    key={sinal.key}
                    className="relative rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/40"
                    onMouseEnter={(event) => scheduleKpiMeaning(sinal.key, event.currentTarget)}
                    onMouseLeave={hideKpiMeaning}
                  >
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{sinal.titulo}</p>
                    <p className={`mt-3 text-2xl font-black ${sinal.destaque}`}>{sinal.valor}</p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">{sinal.apoio}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Pulsos rápidos</p>
                    <h4 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Indicadores que merecem atenção</h4>
                  </div>
                  <Activity className="h-5 w-5 text-sky-500" />
                </div>
                <div className="mt-4 space-y-3">
                  {sinaisExecutivos.slice(3).map((sinal) => (
                    <div
                      key={sinal.key}
                      className="relative rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40"
                      onMouseEnter={(event) => scheduleKpiMeaning(sinal.key, event.currentTarget)}
                      onMouseLeave={hideKpiMeaning}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-100">{sinal.titulo}</p>
                        <span className={`text-sm font-black ${sinal.destaque}`}>{sinal.valor}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{sinal.apoio}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/75 p-5 backdrop-blur dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Bancos em foco</p>
                    <h4 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Selecione uma conta e propague o filtro</h4>
                  </div>
                  <Landmark className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="mt-4 space-y-2">
                  {bancosEmFoco.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-400 dark:border-slate-700">Nenhuma conta com movimentação no recorte atual.</div>
                  ) : (
                    bancosEmFoco.map((item) => (
                      <button
                        key={item.contaId}
                        onClick={() => setSelectedConta((prev) => prev === item.contaId ? null : item.contaId)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selectedConta === item.contaId ? 'border-cyan-500 bg-cyan-50 shadow-sm dark:border-cyan-400 dark:bg-cyan-500/10' : 'border-slate-200 bg-white/70 hover:border-cyan-300 hover:bg-cyan-50/60 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-cyan-500 dark:hover:bg-cyan-500/10'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-800 dark:text-slate-100">{item.nome}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-300">{item.banco}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900 dark:text-white">{BRL.format(item.total)}</p>
                            <p className={`text-xs font-bold ${item.saldo >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{item.quantidade} mov. • {BRL.format(item.saldo)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              key: 'RECEITAS' as const,
              label: 'Receitas',
              value: BRL.format(operationalKpis.receitas),
              icon: TrendingUp,
              iconWrap: 'bg-emerald-100 dark:bg-emerald-900/30',
              iconTone: 'text-emerald-600',
              active: tipoFiltro === 'RECEITA',
              activeClass: 'border-emerald-400 bg-emerald-50/80 dark:border-emerald-500 dark:bg-emerald-500/10',
              onClick: () => setTipoFiltro((prev) => prev === 'RECEITA' ? 'TODOS' : 'RECEITA'),
            },
            {
              key: 'DESPESAS' as const,
              label: 'Despesas',
              value: BRL.format(operationalKpis.despesas),
              icon: TrendingDown,
              iconWrap: 'bg-rose-100 dark:bg-rose-900/30',
              iconTone: 'text-rose-500',
              active: tipoFiltro === 'DESPESA',
              activeClass: 'border-rose-400 bg-rose-50/80 dark:border-rose-500 dark:bg-rose-500/10',
              onClick: () => setTipoFiltro((prev) => prev === 'DESPESA' ? 'TODOS' : 'DESPESA'),
            },
            {
              key: 'SALDO' as const,
              label: 'Saldo',
              value: BRL.format(operationalKpis.saldo),
              icon: Wallet,
              iconWrap: 'bg-slate-100 dark:bg-slate-700/50',
              iconTone: 'text-slate-600 dark:text-slate-200',
              active: !selectedCategorias.size && !selectedCentro && !selectedConta && !selectedDate && !selectedMonth && !financeDrilldown && statusFiltro === 'TODOS' && tipoFiltro === 'TODOS',
              activeClass: 'border-sky-400 bg-sky-50/80 dark:border-sky-500 dark:bg-sky-500/10',
              onClick: () => {
                setStatusFiltro('TODOS');
                setTipoFiltro('TODOS');
                setSelectedCategorias(new Set());
                setSelectedCentro(null);
                setSelectedConta(null);
                setSelectedDate(null);
                setSelectedMonth(null);
                setFinanceDrilldown(null);
              },
            },
            {
              key: 'PAGOS' as const,
              label: 'Pagos',
              value: BRL.format(operationalKpis.pagos),
              icon: Filter,
              iconWrap: 'bg-indigo-100 dark:bg-indigo-900/30',
              iconTone: 'text-indigo-600',
              active: statusFiltro === 'PAGO',
              activeClass: 'border-indigo-400 bg-indigo-50/80 dark:border-indigo-500 dark:bg-indigo-500/10',
              onClick: () => setStatusFiltro((prev) => prev === 'PAGO' ? 'TODOS' : 'PAGO'),
            },
          ].map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              onMouseEnter={(event) => scheduleKpiMeaning(card.key, event.currentTarget)}
              onMouseLeave={hideKpiMeaning}
              onFocus={(event) => scheduleKpiMeaning(card.key, event.currentTarget)}
              onBlur={hideKpiMeaning}
              className={`relative rounded-2xl border p-5 text-left shadow-sm backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-lg ${card.active ? card.activeClass : 'border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-800'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-slate-400">{card.label}</p>
                  <p className={`text-2xl font-black ${card.label === 'Saldo' && operationalKpis.saldo < 0 ? 'text-rose-500' : card.iconTone}`}>{card.value}</p>
                </div>
                <div className={`rounded-lg p-2 ${card.iconWrap}`}>
                  <card.icon className={`h-5 w-5 ${card.iconTone}`} />
                </div>
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-400">Clique para cruzar o dashboard por este KPI</p>
            </button>
          ))}
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
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5">
            <Landmark className="w-4 h-4 text-slate-400" />
            <select
              value={selectedConta ?? ''}
              onChange={(e) => setSelectedConta(e.target.value ? Number(e.target.value) : null)}
              className="bg-transparent text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="">Todas as contas</option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>{conta.nome}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Heatmaps reativos</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Mapa de calor por receita e despesa</h3>
              </div>
              <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-300">{heatmapCalendario.monthLabel}</span>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {([
                { key: 'receita', label: 'Receitas', max: heatmapCalendario.maxReceita },
                { key: 'despesa', label: 'Despesas', max: heatmapCalendario.maxDespesa },
              ] as const).map((mapa) => (
                <div key={mapa.key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className={`text-sm font-bold ${mapa.key === 'receita' ? 'text-emerald-600' : 'text-rose-500'}`}>{mapa.label}</h4>
                    <span className="text-xs text-slate-400">Clique para abrir o dia</span>
                  </div>
                  <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    {heatmapCalendario.weekLabels.map((label) => <div key={label}>{label}</div>)}
                  </div>
                  <div className="mt-2 space-y-2">
                    {heatmapCalendario.weeks.map((week) => (
                      <div key={week.label} className="grid grid-cols-7 gap-2">
                        {week.cells.map((cell) => {
                          const amount = mapa.key === 'receita' ? cell.receita : cell.despesa;
                          const ratio = mapa.max > 0 ? amount / mapa.max : 0;
                          return (
                            <button
                              key={`${mapa.key}-${cell.date}`}
                              onClick={() => cell.isCurrentMonth && setSelectedDate((prev) => prev === cell.date ? null : cell.date)}
                              className={`aspect-square rounded-2xl border text-[11px] font-bold transition hover:-translate-y-0.5 ${cell.isCurrentMonth ? getHeatCellClass(ratio, mapa.key) : 'border-slate-100 bg-slate-50 text-slate-300 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-600'} ${selectedDate === cell.date ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-800' : ''}`}
                              title={`${parseDateLocal(cell.date)?.toLocaleDateString('pt-BR')} • ${BRL.format(amount)}`}
                            >
                              {cell.dayLabel}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Conexão dos painéis</p>
                <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Leituras executivas do recorte</h3>
              </div>
              <Sparkles className="h-5 w-5 text-amber-500" />
            </div>
            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Saldo atual</p>
                <p className={`mt-2 text-3xl font-black ${operationalKpis.saldo >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>{BRL.format(operationalKpis.saldo)}</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">O saldo reage ao período, tipo, centro, categoria, conta e cortes vindos dos gráficos.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-100">Mix financeiro</p>
                  <span className="text-xs text-slate-400">Receita {mixFinanceiro.receitaPct.toFixed(1)}% x despesa {mixFinanceiro.despesaPct.toFixed(1)}%</span>
                </div>
                <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700/60">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${mixFinanceiro.receitaPct}%` }}
                    title={`Receitas ${mixFinanceiro.receitaPct.toFixed(1)}%`}
                  />
                  <div
                    className="h-full bg-rose-500 transition-all duration-500"
                    style={{ width: `${mixFinanceiro.despesaPct}%` }}
                    title={`Despesas ${mixFinanceiro.despesaPct.toFixed(1)}%`}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Receitas: {BRL.format(operationalKpis.receitas)} ({mixFinanceiro.receitaPct.toFixed(1)}%)</div>
                  <div className="rounded-xl bg-rose-50 px-3 py-2 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Despesas: {BRL.format(operationalKpis.despesas)} ({mixFinanceiro.despesaPct.toFixed(1)}%)</div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-100">Preparação para exportação</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">A base do fim da página replica exatamente estes filtros. Você pode buscar um termo e baixar CSV/XLSX do resultado consolidado.</p>
              </div>
            </div>
          </div>
        </div>

        <div className={`${INTERACTIVE_PANEL_CLASS} bg-white/80 backdrop-blur`} onMouseEnter={(event) => scheduleKpiMeaning('PRODUTIVIDADE', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-700 dark:text-slate-200">Produtividade</h3>
            <span className="text-xs text-slate-400">Eficiência de execução financeira</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div className="lg:col-span-1 rounded-3xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Leitura rápida</p>
              <p className="mt-3 text-3xl font-black text-slate-900 dark:text-white">{execucaoPct}%</p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">Quanto do financeiro já saiu do planejado e virou execução dentro do recorte atual.</p>
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
                <p className={`text-xl font-bold ${operationalKpis.saldo >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(operationalKpis.saldo)}</p>
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {produtividadeIndicadores.map((item) => (
              <div key={item.key} className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-100">{item.label}</p>
                  <span className="text-sm font-black text-slate-900 dark:text-white">{item.valor}</span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className={`h-full ${item.tone}`} style={{ width: `${Math.max(6, Math.min(100, item.percentual))}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">{item.apoio}</p>
              </div>
            ))}
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
          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Pagar</h3>
              <span className="text-xs text-slate-400">Vencimentos reativos</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_HOJE')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_HOJE' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}>
                <p className="text-xs text-slate-400">Para hoje</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.hoje)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_AMANHA')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_AMANHA' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}>
                <p className="text-xs text-slate-400">Para amanhã</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.amanha)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_ATRASADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_ATRASADAS' ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-rose-300 dark:hover:border-rose-500/60'}`}>
                <p className="text-xs text-slate-400">Atrasadas</p>
                <p className="font-bold text-red-600">{BRL.format(contasHoje.pagar.atrasadas)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_TOTAL')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_TOTAL' ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-700/30' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-500/60'}`}>
                <p className="text-xs text-slate-400">Total do mês</p>
                <p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.pagar.totalMes)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_REALIZADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_REALIZADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}>
                <p className="text-xs text-slate-400">Realizadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.pagar.realizadas)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('PAGAR_ABERTO')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'PAGAR_ABERTO' ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-amber-300 dark:hover:border-amber-500/60'}`}>
                <p className="text-xs text-slate-400">Em aberto</p>
                <p className="font-bold text-amber-600">{BRL.format(contasHoje.pagar.emAberto)}</p>
              </button>
            </div>
          </div>

          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Contas a Receber</h3>
              <span className="text-xs text-slate-400">Vencimentos reativos</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_HOJE')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_HOJE' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}>
                <p className="text-xs text-slate-400">Para hoje</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.hoje)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_AMANHA')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_AMANHA' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}>
                <p className="text-xs text-slate-400">Para amanhã</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.amanha)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_ATRASADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_ATRASADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}>
                <p className="text-xs text-slate-400">Atrasadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.atrasadas)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_TOTAL')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_TOTAL' ? 'border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-slate-700/30' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-500/60'}`}>
                <p className="text-xs text-slate-400">Total do mês</p>
                <p className="font-bold text-slate-700 dark:text-slate-100">{BRL.format(contasHoje.receber.totalMes)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_REALIZADAS')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_REALIZADAS' ? 'border-emerald-400 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-emerald-300 dark:hover:border-emerald-500/60'}`}>
                <p className="text-xs text-slate-400">Realizadas</p>
                <p className="font-bold text-emerald-600">{BRL.format(contasHoje.receber.realizadas)}</p>
              </button>
              <button type="button" onClick={() => toggleFinanceDrilldown('RECEBER_ABERTO')} className={`p-3 rounded-2xl border text-left transition ${financeDrilldown === 'RECEBER_ABERTO' ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-700 hover:-translate-y-0.5 hover:border-amber-300 dark:hover:border-amber-500/60'}`}>
                <p className="text-xs text-slate-400">Em aberto</p>
                <p className="font-bold text-amber-600">{BRL.format(contasHoje.receber.emAberto)}</p>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos • Contas a Pagar</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.pagar.length} item(ns){financeDrilldown?.startsWith('PAGAR') ? ' no recorte ativo' : ''}</span>
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

          <div className={INTERACTIVE_PANEL_CLASS}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Lançamentos • Contas a Receber</h3>
              <span className="text-xs text-slate-400">{lancamentosContasDetalhe.receber.length} item(ns){financeDrilldown?.startsWith('RECEBER') ? ' no recorte ativo' : ''}</span>
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

        <div className="grid grid-cols-1 gap-6">
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('FLUXO_CAIXA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">
                {periodoTipo === 'ANO' ? 'Fluxo de Caixa Mensal' : 'Fluxo de Caixa Diário'}
              </h3>
              <span className="text-xs text-slate-400">
                {periodoTipo === 'ANO' ? 'Interativo por mês' : 'Interativo por dia'}
              </span>
            </div>
            <AsyncApexChart type="area" height={320} series={chartFluxo.series} options={chartFluxo.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('DESPESAS_CATEGORIA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200">{includeNaoOperacionaisCategorias ? 'Despesas por Categoria' : 'Despesas Operacionais por Categoria'}</h3>
                <span className="text-xs text-slate-400">Treemap proporcional • clique para filtrar</span>
              </div>
              <button
                type="button"
                onClick={() => setIncludeNaoOperacionaisCategorias((prev) => !prev)}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold transition ${includeNaoOperacionaisCategorias ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/70'}`}
              >
                {includeNaoOperacionaisCategorias ? 'Ocultar não operacionais' : 'Incluir não operacionais'}
              </button>
            </div>
            {chartCategorias.series.length === 0 ? (
              <div className="h-96 flex items-center justify-center text-sm text-slate-400">
                Sem dados de despesas no período.
              </div>
            ) : (
              <AsyncApexChart type="treemap" height={420} series={chartCategorias.series} options={chartCategorias.options} />
            )}
            <p className="mt-3 text-xs text-slate-400">{includeNaoOperacionaisCategorias ? 'Visualização ampliada: categorias não operacionais entram apenas neste treemap para comparação visual, sem alterar os KPIs operacionais do dashboard.' : 'Categorias não operacionais continuam visíveis nos lançamentos e no consolidado, mas ficam fora desta leitura operacional.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RECEITAS_CATEGORIA', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">{includeNaoOperacionaisCategorias ? 'Receitas por Categoria' : 'Receitas Operacionais por Categoria'}</h3>
              <span className="text-xs text-slate-400">Treemap proporcional • clique para filtrar</span>
            </div>
            {chartReceitasCategorias.series.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-sm text-slate-400">
                Sem dados de receitas no período.
              </div>
            ) : (
              <AsyncApexChart type="treemap" height={320} series={chartReceitasCategorias.series} options={chartReceitasCategorias.options} />
            )}
            <p className="mt-3 text-xs text-slate-400">{includeNaoOperacionaisCategorias ? 'Ao incluir não operacionais, este painel vira uma visão comparativa ampliada por categoria.' : 'O maior motor de receita agora considera apenas categorias operacionais marcadas para resultado.'}</p>
          </div>
          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('ACUMULADO_REC_DESP', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Acumulado: Receitas x Despesas</h3>
              <span className="text-xs text-slate-400">Evolução no período</span>
            </div>
            <AsyncApexChart type="line" height={280} series={chartAcumuladoRecDesp.series} options={chartAcumuladoRecDesp.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('RESULTADO_OPERACIONAL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Operacional ({resultadoMensalAno.year})</h3>
              <span className="text-xs text-slate-400">Jan → Dez</span>
            </div>
            {chartResultadoOperacional.series[0].data.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-sm text-slate-400">
                Sem dados suficientes para o período.
              </div>
            ) : (
              <AsyncApexChart type="bar" height={320} series={chartResultadoOperacional.series} options={chartResultadoOperacional.options} />
            )}
          </div>
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('RESUMO_OPERACIONAL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resumo Operacional</h3>
              <span className="text-xs text-slate-400">Média mensal</span>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10">
                <p className="text-xs text-slate-400">Média por mês</p>
                <p className={`text-lg font-bold ${mediaResultado >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{BRL.format(mediaResultado)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 dark:border-sky-900/40 dark:bg-sky-500/10">
                <p className="text-xs text-slate-400">Melhor cenário</p>
                <p className="text-lg font-bold text-emerald-600">
                  {resultadoMensal.values.length ? BRL.format(Math.max(...resultadoMensal.values)) : '—'}
                </p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10">
                <p className="text-xs text-slate-400">Pior cenário</p>
                <p className="text-lg font-bold text-red-500">
                  {resultadoMensal.values.length ? BRL.format(Math.min(...resultadoMensal.values)) : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('RECEITAS_DESPESAS_ANO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Receitas x Despesas ({resultadoMensalAno.year})</h3>
              <span className="text-xs text-slate-400">Comparativo anual</span>
            </div>
            <AsyncApexChart type="bar" height={320} series={chartReceitasDespesasAno.series} options={chartReceitasDespesasAno.options} />
          </div>
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('MARGEM_OPERACIONAL_PAINEL', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Margem Operacional</h3>
              <span className="text-xs text-slate-400">% mês a mês</span>
            </div>
            <AsyncApexChart type="line" height={280} series={chartMargemAno.series} options={chartMargemAno.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('COMPARATIVO_ANO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Comparativo Ano a Ano</h3>
              <span className="text-xs text-slate-400">{resultadoMensalAnoAnterior.year} vs {resultadoMensalAno.year}</span>
            </div>
            <AsyncApexChart type="line" height={280} series={chartComparativoAno.series} options={chartComparativoAno.options} />
          </div>
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('SAZONALIDADE', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Sazonalidade</h3>
              <span className="text-xs text-slate-400">Índice mensal</span>
            </div>
            <AsyncApexChart type="bar" height={260} series={chartSazonalidade.series} options={chartSazonalidade.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('CENARIOS', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Cenários</h3>
              <span className="text-xs text-slate-400">Baseado na volatilidade</span>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10">
                <p className="text-xs text-slate-400">Pessimista</p>
                <p className="text-lg font-bold text-red-500">{BRL.format(cenarios.pessimista)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <p className="text-xs text-slate-400">Realista</p>
                <p className="text-lg font-bold text-slate-800 dark:text-white">{BRL.format(cenarios.realista)}</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10">
                <p className="text-xs text-slate-400">Otimista</p>
                <p className="text-lg font-bold text-emerald-600">{BRL.format(cenarios.otimista)}</p>
              </div>
            </div>
          </div>
          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('RESULTADO_ACUMULADO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Resultado Acumulado</h3>
              <span className="text-xs text-slate-400">Evolução do caixa</span>
            </div>
            <AsyncApexChart type="line" height={280} series={chartResultadoAcumulado.series} options={chartResultadoAcumulado.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.99),rgba(248,250,252,0.96))] p-6 shadow-sm dark:border-slate-700 dark:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))]" onMouseEnter={(event) => scheduleKpiMeaning('PULSO_ACUMULADO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Pulso do Acumulado</h3>
              <span className="text-xs text-slate-400">Resumo instantâneo do caixa</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white/85 p-4 dark:border-slate-700 dark:bg-slate-900/50" onMouseEnter={(event) => scheduleKpiMeaning('FECHAMENTO_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Fechamento</p>
                <p className={`mt-3 text-xl font-black ${resultadoAcumuladoSnapshot.final >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{BRL.format(resultadoAcumuladoSnapshot.final)}</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 dark:border-emerald-900/40 dark:bg-emerald-500/10" onMouseEnter={(event) => scheduleKpiMeaning('PICO_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Pico</p>
                <p className="mt-3 text-xl font-black text-emerald-600">{BRL.format(resultadoAcumuladoSnapshot.pico)}</p>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-900/40 dark:bg-rose-500/10" onMouseEnter={(event) => scheduleKpiMeaning('VALE_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Vale</p>
                <p className="mt-3 text-xl font-black text-rose-500">{BRL.format(resultadoAcumuladoSnapshot.vale)}</p>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 dark:border-sky-900/40 dark:bg-sky-500/10" onMouseEnter={(event) => scheduleKpiMeaning('AMPLITUDE_ACUMULADO', event.currentTarget, 400)} onMouseLeave={hideKpiMeaning}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Amplitude</p>
                <p className="mt-3 text-xl font-black text-sky-600">{BRL.format(resultadoAcumuladoSnapshot.amplitude)}</p>
              </div>
            </div>
          </div>
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('STATUS_DISTRIB', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Distribuição por Status</h3>
              <span className="text-xs text-slate-400">Valor por status</span>
            </div>
            <AsyncApexChart type="donut" height={220} series={chartStatus.series} options={chartStatus.options} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={DASHBOARD_SECTION_CLASS} onMouseEnter={(event) => scheduleKpiMeaning('DESPESAS_CENTRO', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200">Despesas por Centro</h3>
              <span className="text-xs text-slate-400">Clique para filtrar</span>
            </div>
            <AsyncApexChart type="bar" height={320} series={chartCentros.series} options={chartCentros.options} />
          </div>

          <div className={`lg:col-span-2 ${DASHBOARD_SECTION_CLASS}`} onMouseEnter={(event) => scheduleKpiMeaning('ULTIMOS_LANCAMENTOS', event.currentTarget, 500)} onMouseLeave={hideKpiMeaning}>
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
                  onClick={() => exportLancamentos(filteredLancamentos, 'csv', `lancamentos_${mes}`)}
                  className="px-3 py-1 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  Exportar CSV
                </button>
                <button
                  onClick={() => exportLancamentos(filteredLancamentos, 'xlsx', `lancamentos_${mes}`)}
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

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Base analítica final</p>
              <h3 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Resultado consolidado dos lançamentos filtrados</h3>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Ideal para análise fina, conferência antes de conciliação e exportação do financeiro conforme o recorte que você montou no dashboard.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => exportLancamentos(linhasAnaliticas, 'csv', `analise_financeira_${mes}`)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"
              >
                <Download className="h-4 w-4" />
                Exportar CSV
              </button>
              <button
                onClick={() => exportLancamentos(linhasAnaliticas, 'xlsx', `analise_financeira_${mes}`)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"
              >
                <Download className="h-4 w-4" />
                Exportar XLSX
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={analysisQuery}
                onChange={(e) => setAnalysisQuery(e.target.value)}
                placeholder="Buscar por descrição, categoria, centro, conta, banco ou status"
                className="w-full bg-transparent outline-none text-slate-700 dark:text-slate-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Linhas</p>
                <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{linhasAnaliticas.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Receitas operacionais</p>
                <p className="mt-2 text-xl font-black text-emerald-600">{BRL.format(linhasAnaliticasResumo.receitasOperacionais)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Despesas operacionais</p>
                <p className="mt-2 text-xl font-black text-rose-500">{BRL.format(linhasAnaliticasResumo.despesasOperacionais)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Não operacionais</p>
                <p className={`mt-2 text-xl font-black ${linhasAnaliticasResumo.movimentosNaoOperacionais >= 0 ? 'text-sky-600' : 'text-amber-600'}`}>
                  {BRL.format(linhasAnaliticasResumo.movimentosNaoOperacionais)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Saldo consolidado</p>
                <p className={`mt-2 text-xl font-black ${linhasAnaliticasResumo.saldoConsolidado >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-500'}`}>
                  {BRL.format(linhasAnaliticasResumo.saldoConsolidado)}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-400 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Descrição</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Centro</th>
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Banco</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {linhasAnaliticas.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">Nenhum lançamento encontrado para os filtros e a busca informada.</td>
                  </tr>
                ) : (
                  linhasAnaliticas.slice(0, 120).map((lancamento) => (
                    <tr key={`analitico-${lancamento.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-3 font-mono text-slate-500">{parseDateLocal(lancamento.data_vencimento)?.toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-100">{lancamento.descricao}</td>
                      <td className="px-4 py-3 text-slate-500">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{lancamento.categoriaNome}</span>
                          {lancamento.naoOperacional && (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                              Não operacional
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{lancamento.centroNome}</td>
                      <td className="px-4 py-3 text-slate-500">{lancamento.contaNome}</td>
                      <td className="px-4 py-3 text-slate-500">{lancamento.bancoNome}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isPago(lancamento.status) ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                          {lancamento.status}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${isReceita(lancamento.tipo) ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {isDespesa(lancamento.tipo) ? '-' : ''}{BRL.format(Number(lancamento.valor_previsto || 0))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {linhasAnaliticas.length > 120 && (
            <p className="mt-3 text-xs text-slate-400">Mostrando os 120 lançamentos mais recentes. A exportação leva todas as linhas filtradas.</p>
          )}
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

      {visibleKpiMeaning && (
        <div
          className="pointer-events-none fixed bottom-4 right-4 z-120 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-left shadow-2xl shadow-slate-950/30 dark:border-slate-700 lg:bottom-6 lg:right-6"
        >
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-300">{DASHBOARD_HELP[visibleKpiMeaning.key].titulo}</p>
          <p className="mt-2 text-sm font-semibold text-white">{DASHBOARD_HELP[visibleKpiMeaning.key].significado}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Como é calculado</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{DASHBOARD_HELP[visibleKpiMeaning.key].calculo}</p>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Utilidade real</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{DASHBOARD_HELP[visibleKpiMeaning.key].utilidade}</p>
        </div>
      )}
    </div>
  );
}
