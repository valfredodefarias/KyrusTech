import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  ChevronDown,
  FileSpreadsheet,
  Filter,
  Landmark,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react';

import { useAssistentePage } from '../components/AssistentePageContext';
import { BankAvatar } from '../components/BrandAvatar';
import { api, normalizeListResponse } from '../services/api';

function normalizarDescricao(texto?: string | null) {
  if (!texto) return '';
  return texto
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function encontrarEntidadeIdPorNome(nome?: string | null, entidades: EntidadeItem[] = []) {
  const chave = normalizarDescricao(nome);
  if (!chave) return null;

  const exata = entidades.find((entidade) => normalizarDescricao(entidade.nome) === chave);
  if (exata) return exata.id;

  const contida = entidades.find((entidade) => {
    const candidato = normalizarDescricao(entidade.nome);
    return candidato && (candidato.includes(chave) || chave.includes(candidato));
  });

  return contida?.id ?? null;
}

function formatCurrency(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function formatDate(valor?: string | null) {
  if (!valor) return '-';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T00:00:00` : valor;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleDateString('pt-BR');
}

interface ContaItem {
  id: number;
  nome: string;
  banco?: string | null;
  logo_url?: string | null;
  tipo_integracao?: string | null;
  centro_custo_id?: number | null;
  status?: 'ATIVO' | 'INATIVO' | string;
}

interface CartaoItem {
  id: number;
  nome_cartao: string;
  bandeira?: string | null;
  dia_fechamento: number;
  dia_vencimento: number;
  centro_custo_id?: number | null;
  status?: 'ATIVO' | 'INATIVO' | string;
}

interface CentroCustoItem {
  id: number;
  nome: string;
}

interface CategoriaItem {
  id: number;
  nome: string;
  tipo?: string;
  codigo?: string | null;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
}

interface EntidadeItem {
  id: number;
  nome: string;
}

interface LancamentoSugestao {
  plano_contas_id?: number | null;
  entidade_id?: number | null;
  entidade_nome?: string | null;
}

interface RelacionamentoResumo {
  id?: number | null;
  descricao: string;
  interessado?: string | null;
  data_vencimento: string;
  valor_previsto: number;
  centro_custo_id?: number | null;
  centro_custo_nome?: string | null;
  score: number;
  motivo: string;
}

interface DuplicataResumo {
  descricao: string;
  data_pagamento?: string | null;
  valor_pago?: number | null;
  origem?: string | null;
  motivo?: string | null;
}

interface LancamentoDisponivel {
  id: number;
  descricao: string;
  interessado?: string | null;
  data_vencimento: string;
  valor_previsto: number;
  centro_custo_id?: number | null;
  centro_custo_nome?: string | null;
  status?: string | null;
  tipo?: string | null;
}

interface LancamentoImportado {
  data: string;
  data_hora?: string | null;
  descricao: string;
  razao_social: string;
  cpf_cnpj: string;
  referencia?: string | null;
  referencia_externa?: string | null;
  movimento_uid?: string | null;
  ofx_bank_id?: string | null;
  ofx_agencia?: string | null;
  ofx_conta_numero?: string | null;
  valor: number;
  tipo: 'RECEITA' | 'DESPESA' | string;
  origem: string;
  linha_arquivo: number;
  import_hash?: string | null;
  lancamento_previsto_id?: number | null;
  lancamentos_atrasados_ids?: number[];
  duplicata_id?: number | null;
  plano_contas_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
  era_previsto?: boolean;
  sugestao_acao?: 'BAIXAR_PREVISTO' | 'RELACIONAR_ATRASADOS' | 'CRIAR_NOVO' | 'IGNORAR_DUPLICATA' | 'DESCARTAR';
  score_conciliacao?: number;
  motivo_conciliacao?: string | null;
  motivo_classificacao?: string | null;
  interessado_sugerido?: string | null;
  lancamento_previsto_resumo?: RelacionamentoResumo | null;
  lancamentos_atrasados_resumo?: RelacionamentoResumo[];
  duplicata_resumo?: DuplicataResumo | null;
}

interface LancamentoEditado extends LancamentoImportado {
  lancamentos_atrasados_relacionados: number[];
  auto_preenchido: boolean;
  sugestao_acao_original: NonNullable<LancamentoImportado['sugestao_acao']>;
  sugestao_confirmada: boolean;
}

type FeedbackState = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

interface ProcessarArquivoResponse {
  lancamentos: LancamentoImportado[];
  total_processado: number;
  duplicatas_encontradas: number;
  lancamentos_previstos_encontrados: number;
  lancamentos_atrasados_encontrados: number;
}

interface ConfirmacaoProgressState {
  currentBatch: number;
  totalBatches: number;
  processedItems: number;
  totalItems: number;
  criados: number;
  atualizados: number;
}

interface DivergenciaSaldoOfx {
  conta_id: number;
  saldo_ofx: number;
  saldo_sistema: number;
  diferenca: number;
  data_referencia?: string | null;
}

interface ConfirmarLancamentosResponse {
  sucesso: boolean;
  lancamentos_criados: number;
  lancamentos_atualizados: number;
  erros?: string[];
  divergencia_saldo_ofx?: DivergenciaSaldoOfx | null;
}

type FiltroStatus = 'todos' | 'conciliar' | 'novo' | 'duplicado' | 'descartado';

const ACAO_META = {
  BAIXAR_PREVISTO: {
    label: 'Baixar previsto',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/60',
  },
  RELACIONAR_ATRASADOS: {
    label: 'Relacionar atrasados',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/60',
  },
  CRIAR_NOVO: {
    label: 'Criar novo lançamento',
    tone: 'bg-lime-100 text-lime-800 border-lime-300 dark:bg-lime-950/35 dark:text-lime-300 dark:border-lime-800/70',
  },
  IGNORAR_DUPLICATA: {
    label: 'Ignorar duplicata',
    tone: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  DESCARTAR: {
    label: 'Descartado',
    tone: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700',
  },
} as const;

const OFX_CONFIRM_CHUNK_SIZE = 300;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function categoriaCompativel(cat: CategoriaItem, tipo: string) {
  if (!cat.tipo) return true;
  const categoriaTipo = String(cat.tipo).trim().toUpperCase();
  if (tipo === 'RECEITA') return categoriaTipo.startsWith('R');
  if (tipo === 'DESPESA') return categoriaTipo.startsWith('D');
  return true;
}

function isConciliacaoAutomatica(acao?: LancamentoImportado['sugestao_acao']) {
  return acao === 'BAIXAR_PREVISTO' || acao === 'RELACIONAR_ATRASADOS';
}

function mapDisponivelToResumo(item: LancamentoDisponivel, motivo: string): RelacionamentoResumo {
  return {
    id: item.id,
    descricao: item.descricao,
    interessado: item.interessado ?? null,
    data_vencimento: item.data_vencimento,
    valor_previsto: item.valor_previsto,
    centro_custo_id: item.centro_custo_id ?? null,
    centro_custo_nome: item.centro_custo_nome ?? null,
    score: 0,
    motivo,
  };
}

function getSugestaoInicial(lanc: LancamentoImportado): NonNullable<LancamentoImportado['sugestao_acao']> {
  if (lanc.sugestao_acao && lanc.sugestao_acao !== 'DESCARTAR') return lanc.sugestao_acao;
  if (lanc.lancamento_previsto_id) return 'BAIXAR_PREVISTO';
  if ((lanc.lancamentos_atrasados_ids || []).length > 0) return 'RELACIONAR_ATRASADOS';
  if (lanc.duplicata_id) return 'IGNORAR_DUPLICATA';
  return 'CRIAR_NOVO';
}

type SearchableOption = {
  id: number;
  label: string;
  disabled?: boolean;
  searchText?: string;
};

function SearchableDropdown({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: number | null | undefined;
  options: SearchableOption[];
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = options.find((option) => Number(option.id) === Number(value));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = options.filter((option) => {
    if (!normalizedQuery) return true;
    const haystack = `${String(option.label || '').toLowerCase()} ${String(option.searchText || '').toLowerCase()}`;
    return haystack.includes(normalizedQuery);
  });

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm outline-none transition focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-slate-700 dark:text-slate-200">{selected?.label || placeholder}</span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen ? (
        <div className="absolute z-40 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className="w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              {placeholder}
            </button>
            {filtered.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={!!option.disabled}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.id);
                  setIsOpen(false);
                }}
                className={`w-full border-b border-slate-100 px-3 py-2 text-left text-sm transition last:border-b-0 dark:border-slate-800 ${option.disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900'}`}
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
            {filtered.length === 0 ? <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Nenhum resultado.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ImportacaoOfx() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [contas, setContas] = useState<ContaItem[]>([]);
  const [cartoes, setCartoes] = useState<CartaoItem[]>([]);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoItem[]>([]);
  const [modoImportacao, setModoImportacao] = useState<'CONTA' | 'CARTAO'>('CONTA');
  const [contaId, setContaId] = useState<number | ''>('');
  const [cartaoId, setCartaoId] = useState<number | ''>('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState<ConfirmacaoProgressState | null>(null);
  const [resultado, setResultado] = useState<ProcessarArquivoResponse | null>(null);
  const [lancamentosEditados, setLancamentosEditados] = useState<LancamentoEditado[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [sugestoes, setSugestoes] = useState<Record<string, LancamentoSugestao>>({});
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [categoriaAutofillAplicada, setCategoriaAutofillAplicada] = useState<Record<string, boolean>>({});
  const [buscaDisponiveis, setBuscaDisponiveis] = useState<{
    linhaArquivo: number | null;
    itens: LancamentoDisponivel[];
    incluirFuturos: boolean;
    loading: boolean;
    error: string | null;
    termo: string;
    tipo: string | null;
    dataBase: string | null;
    centroCustoId: number | null;
  }>({
    linhaArquivo: null,
    itens: [],
    incluirFuturos: false,
    loading: false,
    error: null,
    termo: '',
    tipo: null,
    dataBase: null,
    centroCustoId: null,
  });
  const [buscaSelecionados, setBuscaSelecionados] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const contaParam = searchParams.get('conta_id');
    if (contaParam && !Number.isNaN(Number(contaParam))) {
      setContaId(Number(contaParam));
    }
  }, [searchParams]);

  useEffect(() => {
    async function loadContas() {
      try {
        const [contasRes, cartoesRes, centrosRes] = await Promise.all([
          api.get<ContaItem[]>('/contas/?include_saldo=false'),
          api.get<CartaoItem[]>('/cartoes/'),
          api.get<CentroCustoItem[]>('/centro-custo/'),
        ]);
        setContas(normalizeListResponse<ContaItem>(contasRes.data));
        setCartoes(normalizeListResponse<CartaoItem>(cartoesRes.data));
        setCentrosCusto(normalizeListResponse<CentroCustoItem>(centrosRes.data));
      } catch (error) {
        console.error('Erro ao carregar contas/cartoes', error);
      }
    }
    loadContas();
  }, []);

  useEffect(() => {
    async function loadLookup() {
      try {
        const [catsRes, entRes, lancRes] = await Promise.all([
          api.get<CategoriaItem[]>('/plano-contas/'),
          api.get<EntidadeItem[]>('/entidades/lookup'),
          api.get<any[]>('/lancamentos/?limit=5000'),
        ]);
        setCategorias(normalizeListResponse<CategoriaItem>(catsRes.data));
        setEntidades(normalizeListResponse<EntidadeItem>(entRes.data));

        const entidadesPorId = new Map<number, string>();
        normalizeListResponse<EntidadeItem>(entRes.data).forEach((ent) => {
          entidadesPorId.set(Number(ent.id), String(ent.nome || ''));
        });

        const map: Record<string, LancamentoSugestao> = {};
        normalizeListResponse<any>(lancRes.data).forEach((lanc) => {
          const desc = normalizarDescricao(lanc.descricao);
          if (!desc) return;
          const key = `${lanc.tipo || ''}|${desc}`;
          if (!map[key]) {
            const entidadeId = lanc.entidade_id != null ? Number(lanc.entidade_id) : null;
            map[key] = {
              plano_contas_id: lanc.plano_contas_id ?? null,
              entidade_id: entidadeId,
              entidade_nome: entidadeId != null ? (entidadesPorId.get(entidadeId) || null) : null,
            };
          }
        });
        setSugestoes(map);
      } catch (error) {
        console.error('Erro ao carregar dados de apoio', error);
      }
    }

    loadLookup();
  }, []);

  const contaSelecionada = useMemo(
    () => contas.find((c) => c.id === contaId),
    [contaId, contas]
  );

  const cartaoSelecionado = useMemo(
    () => cartoes.find((c) => c.id === cartaoId),
    [cartaoId, cartoes]
  );

  const centroCustoPadraoBusca = useMemo(() => {
    if (modoImportacao === 'CONTA') {
      return contaSelecionada?.centro_custo_id ?? null;
    }
    return cartaoSelecionado?.centro_custo_id ?? null;
  }, [modoImportacao, contaSelecionada, cartaoSelecionado]);

  const contasAtivas = useMemo(
    () => contas.filter((conta) => String(conta.status || 'ATIVO').toUpperCase() !== 'INATIVO'),
    [contas],
  );

  const cartoesAtivos = useMemo(
    () => cartoes.filter((cartao) => String(cartao.status || 'ATIVO').toUpperCase() !== 'INATIVO'),
    [cartoes],
  );

  function handleArquivoSelecionado(file: File | null) {
    if (!file) return;
    const nome = String(file.name || '').toLowerCase();
    if (!nome.endsWith('.ofx') && !nome.endsWith('.qfx')) {
      setFeedback({ type: 'error', message: 'Selecione um arquivo OFX ou QFX válido.' });
      return;
    }
    setArquivo(file);
    setFeedback(null);
  }

  const resumo = useMemo(() => {
    const items = lancamentosEditados.filter((item) => item.sugestao_acao !== 'IGNORAR_DUPLICATA' && item.sugestao_acao !== 'DESCARTAR');
    const conciliaveis = items.filter((item) => isConciliacaoAutomatica(item.sugestao_acao)).length;
    const novos = items.filter((item) => item.sugestao_acao === 'CRIAR_NOVO').length;
    const receitas = items.filter((item) => item.tipo === 'RECEITA').reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const despesas = items.filter((item) => item.tipo === 'DESPESA').reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const semCategoria = items.filter((item) => item.sugestao_acao === 'CRIAR_NOVO' && !item.plano_contas_id).length;
    return { conciliaveis, novos, receitas, despesas, semCategoria };
  }, [lancamentosEditados]);

  const selecionadosConfirmadosPorId = useMemo(() => {
    const mapa = new Map<number, Set<number>>();
    for (const item of lancamentosEditados) {
      if (!item.sugestao_confirmada) continue;
      if (item.sugestao_acao === 'BAIXAR_PREVISTO' && item.lancamento_previsto_id) {
        const previstoId = Number(item.lancamento_previsto_id);
        if (previstoId > 0) {
          const set = mapa.get(previstoId) || new Set<number>();
          set.add(Number(item.linha_arquivo || 0));
          mapa.set(previstoId, set);
        }
      }

      if (item.sugestao_acao === 'RELACIONAR_ATRASADOS') {
        const selecionados = Array.isArray(item.lancamentos_atrasados_relacionados)
          ? item.lancamentos_atrasados_relacionados
          : [];
        const unicos = new Set<number>();
        for (const atrasoIdRaw of selecionados) {
          const atrasoId = Number(atrasoIdRaw || 0);
          if (atrasoId > 0) {
            unicos.add(atrasoId);
          }
        }
        for (const atrasoId of unicos) {
          const set = mapa.get(atrasoId) || new Set<number>();
          set.add(Number(item.linha_arquivo || 0));
          mapa.set(atrasoId, set);
        }
      }
    }
    return mapa;
  }, [lancamentosEditados]);

  const assistenteConfig = useMemo(() => ({
    tela: 'geral' as const,
    titulo: 'Assistente KyrusTECH',
    contexto: {
      pagina: 'importacao_ofx',
      destino_importacao: modoImportacao,
      conta_selecionada: contaSelecionada ? `${contaSelecionada.nome}${contaSelecionada.banco ? ` (${contaSelecionada.banco})` : ''}` : null,
      cartao_selecionado: cartaoSelecionado ? `${cartaoSelecionado.nome_cartao}${cartaoSelecionado.bandeira ? ` (${cartaoSelecionado.bandeira})` : ''}` : null,
      resumo_importacao_ofx: resultado ? {
        total_processado: resultado.total_processado,
        duplicatas: resultado.duplicatas_encontradas,
        previstos: resultado.lancamentos_previstos_encontrados,
        atrasados: resultado.lancamentos_atrasados_encontrados,
        conciliaveis: resumo.conciliaveis,
        novos: resumo.novos,
      } : null,
      instrucao_analise: 'Explique a importacao OFX como um operador financeiro senior. Destaque movimentos que podem baixar previstos, atrasados que merecem vinculacao e o que ainda precisa de classificacao antes da confirmacao.',
    },
    sugestoes: [
      'Quais movimentos deste OFX devem baixar previstos agora?',
      'Onde existem atrasos relevantes que merecem conciliação manual?',
      'O que ainda precisa de classificação antes de confirmar?',
    ],
  }), [modoImportacao, contaSelecionada, cartaoSelecionado, resultado, resumo.conciliaveis, resumo.novos]);

  useAssistentePage(assistenteConfig);

  const reloadEntidadesLookup = async () => {
    try {
      const { data } = await api.get<EntidadeItem[]>('/entidades/lookup');
      setEntidades(normalizeListResponse<EntidadeItem>(data));
    } catch (error) {
      console.error('Erro ao recarregar entidades', error);
    }
  };

  const carregarLancamentosDisponiveis = async (
    lanc: LancamentoEditado,
    incluirFuturos: boolean,
    centroCustoId: number | null,
  ) => {
    const tipo = String(lanc.tipo || '').toUpperCase();
    const dataBase = lanc.data;
    if (!tipo) {
      setBuscaDisponiveis((prev) => ({
        ...prev,
        loading: false,
        error: 'Tipo do movimento nao informado.',
        itens: [],
      }));
      return;
    }

    setBuscaDisponiveis((prev) => ({
      ...prev,
      loading: true,
      error: null,
      tipo,
      dataBase,
      incluirFuturos,
      centroCustoId,
    }));

    try {
      const params: Record<string, string | number | boolean> = {
        tipo,
        incluir_futuros: incluirFuturos,
        data_base: dataBase,
      };
      if (modoImportacao === 'CONTA' && contaId) {
        params.conta_id = Number(contaId);
      }
      if (centroCustoId) {
        params.centro_custo_id = Number(centroCustoId);
      }

      const { data } = await api.get<LancamentoDisponivel[]>('/importacao/ofx/lancamentos-disponiveis', { params });
      setBuscaDisponiveis((prev) => ({
        ...prev,
        itens: Array.isArray(data) ? data : [],
        loading: false,
      }));
    } catch (error: any) {
      setBuscaDisponiveis((prev) => ({
        ...prev,
        loading: false,
        itens: [],
        error: error?.response?.data?.detail || 'Erro ao buscar lancamentos disponiveis.',
      }));
    }
  };

  const abrirBuscaDisponiveis = (lanc: LancamentoEditado) => {
    const centroCustoInicial = lanc.centro_custo_id ?? centroCustoPadraoBusca;
    const selecionadosIniciais = (() => {
      if (lanc.sugestao_acao === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_id) {
        return [Number(lanc.lancamento_previsto_id)];
      }
      if (lanc.sugestao_acao === 'RELACIONAR_ATRASADOS') {
        return (lanc.lancamentos_atrasados_relacionados || []).map((id) => Number(id));
      }
      return [];
    })();

    setBuscaSelecionados(selecionadosIniciais);
    setBuscaDisponiveis((prev) => ({
      ...prev,
      linhaArquivo: lanc.linha_arquivo,
      termo: '',
      itens: prev.linhaArquivo === lanc.linha_arquivo ? prev.itens : [],
      incluirFuturos: prev.linhaArquivo === lanc.linha_arquivo ? prev.incluirFuturos : false,
      tipo: String(lanc.tipo || '').toUpperCase(),
      dataBase: lanc.data,
      centroCustoId: centroCustoInicial,
      error: null,
    }));

    carregarLancamentosDisponiveis(lanc, false, centroCustoInicial);
  };

  const handleUpload = async () => {
    if (loading) return;
    const missingTarget = modoImportacao === 'CONTA' ? !contaId : !cartaoId;
    if (!arquivo || missingTarget) {
      setFeedback({ type: 'error', message: modoImportacao === 'CONTA' ? 'Selecione uma conta e um arquivo OFX.' : 'Selecione um cartao e um arquivo OFX.' });
      return;
    }
    setFeedback(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      const params: Record<string, string | number> = {};
      if (modoImportacao === 'CONTA') params.conta_id = Number(contaId);
      if (modoImportacao === 'CARTAO') params.cartao_id = Number(cartaoId);
      const { data } = await api.post<ProcessarArquivoResponse>(
        '/importacao/ofx/upload',
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' }, params }
      );
      setResultado(data);
      await reloadEntidadesLookup();
      setFeedback({ type: 'success', message: 'Arquivo OFX processado com sucesso.' });
    } catch (error: any) {
      setResultado(null);
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao processar arquivo.' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmar = async () => {
    if (confirming) return;
    if (!resultado || resultado.lancamentos.length === 0) {
      setFeedback({ type: 'warning', message: 'Nenhum lançamento disponível para confirmar.' });
      return;
    }
    const missingTarget = modoImportacao === 'CONTA' ? !contaId : !cartaoId;
    if (missingTarget) {
      setFeedback({
        type: 'warning',
        message: modoImportacao === 'CONTA' ? 'Selecione uma conta antes de confirmar a importação.' : 'Selecione um cartao antes de confirmar a importação.',
      });
      return;
    }
    setConfirming(true);
    setConfirmProgress(null);
    setFeedback(null);
    try {
      const chunks = chunkArray(lancamentosEditados, OFX_CONFIRM_CHUNK_SIZE);
      const totalItems = lancamentosEditados.length;
      let criados = 0;
      let atualizados = 0;
      const erros: string[] = [];
      let processedItems = 0;

      for (let i = 0; i < chunks.length; i += 1) {
        const batchIndex = i + 1;
        const chunk = chunks[i];

        const payload = {
          lancamentos: chunk,
          conta_id: modoImportacao === 'CONTA' ? Number(contaId) : null,
          cartao_id: modoImportacao === 'CARTAO' ? Number(cartaoId) : null,
          modo_importacao: modoImportacao,
        };

        const { data } = await api.post<ConfirmarLancamentosResponse>('/importacao/confirmar-lancamentos', payload);
        criados += Number(data?.lancamentos_criados || 0);
        atualizados += Number(data?.lancamentos_atualizados || 0);
        const errosChunk = Array.isArray(data?.erros) ? data.erros.filter(Boolean) : [];
        if (errosChunk.length > 0) {
          erros.push(...errosChunk.slice(0, 20));
        }

        processedItems += chunk.length;
        setConfirmProgress({
          currentBatch: batchIndex,
          totalBatches: chunks.length,
          processedItems,
          totalItems,
          criados,
          atualizados,
        });
      }

      if (criados === 0 && atualizados === 0) {
        setFeedback({
          type: 'warning',
          message: `Confirmação finalizada, mas nenhum lançamento foi aplicado. ${erros.length ? `Erros: ${erros.join(' | ')}` : 'Verifique se os itens foram marcados como descartados/duplicados.'}`,
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Importação concluída. Criados: ${criados}, atualizados: ${atualizados}.${erros.length ? ` Erros: ${erros.join(' | ')}` : ''}`,
        });
      }
      setResultado(null);
      setLancamentosEditados([]);
      setCategoriaAutofillAplicada({});
      setArquivo(null);
      const contaImportadaId = modoImportacao === 'CONTA' ? Number(contaId) : null;
      const destinoPosImportacao = contaImportadaId
        ? `/contas?extrato_conta_id=${contaImportadaId}`
        : '/lancamentos';
      setTimeout(() => navigate(destinoPosImportacao), 900);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      if (detail && typeof detail === 'object') {
        const message = detail?.message || 'Erro ao confirmar importação.';
        const divergenciaDepois = (detail?.divergencia_saldo_ofx_depois || detail?.divergencia_saldo_ofx) as DivergenciaSaldoOfx | undefined;
        const divergenciaAntes = detail?.divergencia_saldo_ofx_antes as DivergenciaSaldoOfx | undefined;
        if (divergenciaDepois) {
          const blocoAntes = divergenciaAntes
            ? ` Antes: ${formatCurrency(divergenciaAntes.diferenca)}.`
            : '';
          const msgDivergencia = `${message}${blocoAntes} Depois: ${formatCurrency(divergenciaDepois.diferenca)}. Saldo OFX: ${formatCurrency(divergenciaDepois.saldo_ofx)} | Saldo sistema: ${formatCurrency(divergenciaDepois.saldo_sistema)}.`;
          setFeedback({ type: 'error', message: msgDivergencia });
        } else {
          setFeedback({ type: 'error', message });
        }
      } else {
        setFeedback({ type: 'error', message: detail || 'Erro ao confirmar importação.' });
      }
    } finally {
      setConfirming(false);
      setConfirmProgress(null);
    }
  };

  useEffect(() => {
    if (!resultado) {
      setLancamentosEditados([]);
      return;
    }

    const editados = resultado.lancamentos.map((lanc) => {
      const key = `${lanc.tipo || ''}|${normalizarDescricao(lanc.descricao)}`;
      const sugestao = sugestoes[key] || {};
      const plano_contas_id = lanc.plano_contas_id ?? sugestao.plano_contas_id ?? null;
      const entidadeSugestaoTexto = lanc.interessado_sugerido || sugestao.entidade_nome || lanc.razao_social || null;
      const entidade_id = lanc.entidade_id
        ?? sugestao.entidade_id
        ?? encontrarEntidadeIdPorNome(entidadeSugestaoTexto, entidades)
        ?? null;
      const auto_preenchido = plano_contas_id != null || entidade_id != null;

      const sugestaoOriginal = getSugestaoInicial(lanc);
      return {
        ...lanc,
        plano_contas_id,
        entidade_id,
        auto_preenchido,
        interessado_sugerido: entidadeSugestaoTexto,
        sugestao_acao_original: sugestaoOriginal,
        sugestao_acao: lanc.sugestao_acao || sugestaoOriginal,
        lancamentos_atrasados_relacionados: [],
        sugestao_confirmada: false,
      } as LancamentoEditado;
    });

    setLancamentosEditados(editados);
    setCategoriaAutofillAplicada({});
  }, [resultado, sugestoes, entidades]);

  const lancamentosFiltrados = useMemo(() => {
    const termo = normalizarDescricao(busca);
    return lancamentosEditados.filter((item) => {
      if (filtroStatus === 'conciliar' && (!item.sugestao_acao || !['BAIXAR_PREVISTO', 'RELACIONAR_ATRASADOS'].includes(item.sugestao_acao))) {
        return false;
      }
      if (filtroStatus === 'novo' && item.sugestao_acao !== 'CRIAR_NOVO') {
        return false;
      }
      if (filtroStatus === 'duplicado' && !item.duplicata_id && item.sugestao_acao !== 'IGNORAR_DUPLICATA') {
        return false;
      }
      if (filtroStatus === 'descartado' && item.sugestao_acao !== 'DESCARTAR') {
        return false;
      }
      if (!termo) return true;
      const bloco = normalizarDescricao(`${item.descricao} ${item.razao_social} ${item.motivo_conciliacao || ''}`);
      return bloco.includes(termo);
    });
  }, [busca, filtroStatus, lancamentosEditados]);

  const lancamentoBuscaAberto = useMemo(() => {
    if (buscaDisponiveis.linhaArquivo == null) {
      return null;
    }
    return lancamentosEditados.find((item) => item.linha_arquivo === buscaDisponiveis.linhaArquivo) || null;
  }, [buscaDisponiveis.linhaArquivo, lancamentosEditados]);

  const itensDisponiveisFiltrados = useMemo(() => {
    if (!lancamentoBuscaAberto) {
      return [] as LancamentoDisponivel[];
    }

    const termoBuscaDisponiveis = normalizarDescricao(buscaDisponiveis.termo);
    return buscaDisponiveis.itens.filter((item) => {
      if (!termoBuscaDisponiveis) return true;
      const haystack = normalizarDescricao(`${item.descricao} ${item.interessado || ''}`);
      return haystack.includes(termoBuscaDisponiveis);
    });
  }, [buscaDisponiveis.itens, buscaDisponiveis.termo, lancamentoBuscaAberto]);

  const updateLancamento = (linhaArquivo: number, patch: Partial<LancamentoEditado>) => {
    setLancamentosEditados((prev) => prev.map((item) => (
      item.linha_arquivo === linhaArquivo
        ? {
          ...item,
          ...patch,
          sugestao_confirmada: patch.sugestao_acao === 'DESCARTAR'
            ? false
            : (
              patch.sugestao_confirmada
              ?? (Object.prototype.hasOwnProperty.call(patch, 'sugestao_acao') ? false : (item.sugestao_confirmada ?? false))
            ),
        }
        : item
    )));
  };

  const applyCategoriaPorInteressado = (linhaArquivo: number, categoriaId: number | null) => {
    setLancamentosEditados((prev) => {
      const current = prev.find((item) => item.linha_arquivo === linhaArquivo);
      if (!current) return prev;

      const interessadoKey = normalizarDescricao(current.razao_social || current.interessado_sugerido || '');
      if (!interessadoKey || categoriaId == null) {
        return prev.map((item) => (item.linha_arquivo === linhaArquivo ? { ...item, plano_contas_id: categoriaId } : item));
      }

      const firstIndex = prev.findIndex(
        (item) => normalizarDescricao(item.razao_social || item.interessado_sugerido || '') === interessadoKey,
      );
      const currentIndex = prev.findIndex((item) => item.linha_arquivo === linhaArquivo);
      const devePropagar = firstIndex === currentIndex && !categoriaAutofillAplicada[interessadoKey];

      const next = prev.map((item, index) => {
        if (item.linha_arquivo === linhaArquivo) {
          return { ...item, plano_contas_id: categoriaId };
        }
        if (!devePropagar) return item;

        const itemKey = normalizarDescricao(item.razao_social || item.interessado_sugerido || '');
        if (itemKey !== interessadoKey) return item;
        if (index <= currentIndex) return item;
        if (item.plano_contas_id != null) return item;

        return { ...item, plano_contas_id: categoriaId };
      });

      if (devePropagar) {
        setCategoriaAutofillAplicada((state) => ({ ...state, [interessadoKey]: true }));
      }
      return next;
    });
  };

  const fecharBuscaDisponiveis = () => {
    setBuscaDisponiveis((prev) => ({
      ...prev,
      linhaArquivo: null,
      termo: '',
      error: null,
      loading: false,
    }));
    setBuscaSelecionados([]);
  };

  const aplicarSelecaoDisponiveis = (lanc: LancamentoEditado) => {
    const selecionados = buscaSelecionados.filter((id) => Number.isFinite(id));
    if (selecionados.length === 0) {
      fecharBuscaDisponiveis();
      return;
    }

    const itensSelecionados = buscaDisponiveis.itens.filter((item) => selecionados.includes(item.id));
    if (itensSelecionados.length === 1) {
      const resumo = mapDisponivelToResumo(itensSelecionados[0], 'Selecionado manualmente');
      updateLancamento(lanc.linha_arquivo, {
        sugestao_acao: 'BAIXAR_PREVISTO',
        lancamento_previsto_id: resumo.id ?? null,
        lancamento_previsto_resumo: resumo,
        lancamentos_atrasados_relacionados: [],
        lancamentos_atrasados_resumo: [],
      });
    } else {
      const resumos = itensSelecionados.map((item) => mapDisponivelToResumo(item, 'Selecionado manualmente'));
      updateLancamento(lanc.linha_arquivo, {
        sugestao_acao: 'RELACIONAR_ATRASADOS',
        lancamento_previsto_id: null,
        lancamento_previsto_resumo: null,
        lancamentos_atrasados_relacionados: itensSelecionados.map((item) => item.id),
        lancamentos_atrasados_resumo: resumos,
      });
    }

    fecharBuscaDisponiveis();
  };

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#0f172a,#111827_55%,#022c22)] px-6 py-7 text-white shadow-[0_25px_80px_-45px_rgba(15,23,42,0.9)] dark:border-slate-800 md:px-8 md:py-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-200">OFX</p>
            <h1 className="max-w-3xl text-3xl font-black tracking-tight md:text-4xl">Importe, revise e confirme.</h1>
            <p className="max-w-2xl text-sm text-slate-200/85">Escolha a conta por botão visual, envie o OFX por arrastar e soltar ou clique para selecionar, e depois revise as sugestões antes de confirmar.</p>

            <div className="pt-2 space-y-3">
              <div className="inline-flex rounded-full border border-white/15 bg-white/10 p-1">
                <button
                  type="button"
                  onClick={() => setModoImportacao('CONTA')}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition ${modoImportacao === 'CONTA' ? 'bg-emerald-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'}`}
                >
                  Importar para conta
                </button>
                <button
                  type="button"
                  onClick={() => setModoImportacao('CARTAO')}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition ${modoImportacao === 'CARTAO' ? 'bg-emerald-500 text-slate-950' : 'text-slate-200 hover:bg-white/10'}`}
                >
                  Importar para fatura
                </button>
              </div>

              <label className="mb-3 block text-xs font-bold uppercase tracking-[0.18em] text-slate-300">
                {modoImportacao === 'CONTA' ? 'Conta bancária' : 'Cartão de crédito'}
              </label>

              {modoImportacao === 'CONTA' ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {contasAtivas.map((conta) => {
                    const selected = Number(contaId) === conta.id;
                    return (
                      <button
                        key={conta.id}
                        type="button"
                        onClick={() => setContaId(conta.id)}
                        className={`rounded-3xl border px-4 py-4 text-left transition ${selected ? 'border-emerald-300 bg-emerald-400/15 shadow-lg shadow-emerald-950/15' : 'border-white/10 bg-white/8 hover:border-emerald-300/45 hover:bg-white/12'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                            <BankAvatar
                              logoUrl={conta.logo_url}
                              bankName={conta.banco}
                              accountName={conta.nome}
                              integrationType={conta.tipo_integracao}
                              size="md"
                              className="h-14 w-14"
                              imageClassName="rounded-2xl bg-white p-1"
                              fallbackClassName="rounded-2xl border-0 shadow-none"
                              imageFit="contain"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-white">{conta.nome}</div>
                            <div className="truncate text-xs uppercase tracking-[0.16em] text-slate-300">{conta.banco || 'Conta bancária'}</div>
                          </div>
                          {selected ? <Check className="h-4 w-4 shrink-0 text-emerald-200" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {cartoesAtivos.map((cartao) => {
                    const selected = Number(cartaoId) === cartao.id;
                    return (
                      <button
                        key={cartao.id}
                        type="button"
                        onClick={() => setCartaoId(cartao.id)}
                        className={`rounded-3xl border px-4 py-4 text-left transition ${selected ? 'border-emerald-300 bg-emerald-400/15 shadow-lg shadow-emerald-950/15' : 'border-white/10 bg-white/8 hover:border-emerald-300/45 hover:bg-white/12'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10 text-sm font-black text-white">
                            {String(cartao.bandeira || 'CC').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-white">{cartao.nome_cartao}</div>
                            <div className="truncate text-xs uppercase tracking-[0.16em] text-slate-300">Fecha dia {cartao.dia_fechamento} • Vence dia {cartao.dia_vencimento}</div>
                          </div>
                          {selected ? <Check className="h-4 w-4 shrink-0 text-emerald-200" /> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white/15 p-3 text-emerald-200">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Preparar arquivo</p>
                <p className="text-sm text-slate-200">Selecione a conta e envie o OFX ou QFX.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.18em] text-slate-300">Arquivo OFX</label>
                <div
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    handleArquivoSelecionado(event.dataTransfer.files?.[0] || null);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`cursor-pointer rounded-[28px] border border-dashed px-5 py-7 text-center transition ${dragActive ? 'border-emerald-300 bg-emerald-400/10' : 'border-white/20 bg-slate-950/25 hover:border-emerald-300/70 hover:bg-white/10'}`}
                >
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-emerald-200">
                    <UploadCloud className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-sm font-bold text-white">{arquivo ? arquivo.name : 'Arraste o arquivo OFX aqui'}</p>
                  <p className="mt-1 text-xs text-slate-300">ou clique para selecionar um arquivo .ofx ou .qfx</p>
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-200">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    OFX ou QFX
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ofx,.qfx"
                    onChange={(e) => handleArquivoSelecionado(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3 text-sm text-slate-200">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">
                  {modoImportacao === 'CONTA' ? 'Conta selecionada' : 'Cartao selecionado'}
                </div>
                <div className="mt-2 font-semibold text-white">
                  {modoImportacao === 'CONTA'
                    ? (contaSelecionada ? `${contaSelecionada.nome}${contaSelecionada.banco ? ` • ${contaSelecionada.banco}` : ''}` : 'Escolha uma conta para continuar')
                    : (cartaoSelecionado ? `${cartaoSelecionado.nome_cartao}${cartaoSelecionado.bandeira ? ` • ${cartaoSelecionado.bandeira}` : ''}` : 'Escolha um cartao para continuar')}
                </div>
              </div>

              <button
                onClick={handleUpload}
                disabled={loading || !(modoImportacao === 'CONTA' ? contaId : cartaoId) || !arquivo}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Processar arquivo
              </button>
            </div>
          </div>
        </div>
      </section>

      {feedback && (
        <div className={`flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm shadow-sm ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : feedback.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'}`}>
          {feedback.type === 'success' ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Destino</p>
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
            {modoImportacao === 'CONTA'
              ? (contaSelecionada ? `${contaSelecionada.nome}${contaSelecionada.banco ? ` • ${contaSelecionada.banco}` : ''}` : 'Selecione a conta')
              : (cartaoSelecionado ? `${cartaoSelecionado.nome_cartao}${cartaoSelecionado.bandeira ? ` • ${cartaoSelecionado.bandeira}` : ''}` : 'Selecione o cartao')}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Total processado</p>
          <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{resultado?.total_processado || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Conciliáveis</p>
          <p className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-300">{resumo.conciliaveis}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Receitas importadas</p>
          <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(resumo.receitas)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Despesas importadas</p>
          <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(resumo.despesas)}</p>
        </div>
      </section>

      {resultado ? (
        <section className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Fila de conciliação OFX</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ['todos', 'Todos'],
                ['conciliar', 'Conciliar'],
                ['novo', 'Criar novo'],
                ['duplicado', 'Duplicatas'],
                ['descartado', 'Descartados'],
              ] as [FiltroStatus, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFiltroStatus(value)}
                  className={`rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${filtroStatus === value ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Busque por descrição, favorecido ou motivo da sugestão"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300">
                <Filter className="h-4 w-4" />
                Pronto para confirmação
              </div>
              <p className="mt-2 text-slate-500 dark:text-slate-400">{resumo.semCategoria === 0 ? 'Todos os itens ativos já têm categoria.' : `${resumo.semCategoria} item(ns) ainda precisam de categoria.`}</p>
            </div>
          </div>

          <div className="space-y-4">
            {lancamentosFiltrados.map((lanc) => {
              const acaoBase = ACAO_META[lanc.sugestao_acao || 'CRIAR_NOVO'];
              const categoriasCompativeis = categorias.filter((cat) => categoriaCompativel(cat, lanc.tipo));
              const categoriaOptions: SearchableOption[] = categoriasCompativeis.map((cat) => ({
                id: cat.id,
                label: cat.codigo ? `${cat.codigo} - ${cat.nome}` : cat.nome,
                disabled: !!cat.eh_cabecalho || cat.permite_lancamentos === false,
                searchText: `${cat.nome || ''} ${cat.codigo || ''} ${cat.tipo || ''}`,
              }));
              const entidadeOptions: SearchableOption[] = entidades.map((ent) => ({
                id: ent.id,
                label: ent.nome,
                searchText: ent.nome,
              }));
              const valorClass = lanc.tipo === 'RECEITA' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300';
              const descartado = lanc.sugestao_acao === 'DESCARTAR';
              const conciliacaoAutomatica = isConciliacaoAutomatica(lanc.sugestao_acao);
              const duplicadoAnterior = Boolean(lanc.duplicata_id || lanc.duplicata_resumo);
              const sugestaoPendente = !descartado && !duplicadoAnterior && conciliacaoAutomatica && !lanc.sugestao_confirmada;
              const conciliadoVisual = !descartado && !duplicadoAnterior && Boolean(lanc.sugestao_confirmada);
              const criarNovoVisual = !descartado && !duplicadoAnterior && !conciliadoVisual && !sugestaoPendente && lanc.sugestao_acao === 'CRIAR_NOVO';
              const buscaAberta = buscaDisponiveis.linhaArquivo === lanc.linha_arquivo;
              const acao = duplicadoAnterior
                ? {
                  label: 'Ja importado anteriormente',
                  tone: 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
                }
                : acaoBase;
              const mostrarBadgeAcao = duplicadoAnterior || lanc.sugestao_acao !== 'CRIAR_NOVO';
              const motivoPadraoSemCorrespondencia = 'Nenhum previsto ou atraso compativel foi encontrado com o mesmo tipo e tolerancia de 5% no valor.';
              const motivoConciliacao = String(lanc.motivo_conciliacao || '').trim();
              const mostrarMotivoConciliacao = Boolean(
                motivoConciliacao
                && motivoConciliacao !== motivoPadraoSemCorrespondencia,
              );
              const cardToneClass = duplicadoAnterior
                ? 'border-slate-300 bg-slate-100/95 dark:border-slate-700 dark:bg-slate-900/70'
                : conciliadoVisual
                  ? 'border-emerald-300 bg-emerald-100/50 dark:border-emerald-700/70 dark:bg-emerald-950/25'
                  : sugestaoPendente
                    ? 'border-amber-300 bg-amber-100/55 dark:border-amber-700/70 dark:bg-amber-950/25'
                    : criarNovoVisual
                      ? 'border-lime-300 bg-lime-100/75 dark:border-lime-700/70 dark:bg-lime-950/25'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

              return (
                <article key={`${lanc.linha_arquivo}-${lanc.movimento_uid || 'ofx'}`} className={`rounded-3xl border p-5 shadow-sm transition ${descartado ? 'opacity-65' : ''} ${cardToneClass}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {duplicadoAnterior ? (
                          <span className="rounded-full border border-slate-300 bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            Ja importado
                          </span>
                        ) : null}
                        {sugestaoPendente ? (
                          <span className="rounded-full border border-amber-300 bg-amber-200 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                            Sugestao pendente
                          </span>
                        ) : null}
                        {conciliadoVisual ? (
                          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                            Conciliado
                          </span>
                        ) : null}
                        {mostrarBadgeAcao ? (
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${acao.tone}`}>{acao.label}</span>
                        ) : null}
                      </div>

                      <div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white">{lanc.descricao}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          <span className="font-black text-red-600 dark:text-red-300">{formatDate(lanc.data)}</span>
                          {lanc.razao_social ? ` • ${lanc.razao_social}` : ''}
                        </p>
                      </div>

                      {mostrarMotivoConciliacao ? (
                        <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{motivoConciliacao}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {descartado ? (
                          <>
                            <button
                              type="button"
                              onClick={() => updateLancamento(lanc.linha_arquivo, {
                                sugestao_acao: lanc.sugestao_acao_original,
                                lancamentos_atrasados_relacionados: [],
                                sugestao_confirmada: false,
                              })}
                              className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              Retomar sugestão
                            </button>
                            {!lanc.duplicata_id ? (
                              <button
                                type="button"
                                onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'CRIAR_NOVO', lancamentos_atrasados_relacionados: [] })}
                                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'CRIAR_NOVO' ? 'border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/35 dark:text-lime-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                              >
                                Criar novo
                              </button>
                            ) : null}
                          </>
                        ) : lanc.lancamento_previsto_id ? (
                          <button
                            type="button"
                            onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'BAIXAR_PREVISTO', sugestao_confirmada: false })}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'BAIXAR_PREVISTO' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                          >
                            Baixar previsto
                          </button>
                        ) : null}
                        {!!lanc.lancamentos_atrasados_ids?.length ? (
                          <button
                            type="button"
                            onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'RELACIONAR_ATRASADOS', sugestao_confirmada: false })}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                          >
                            Relacionar atrasados
                          </button>
                        ) : null}
                        {!lanc.duplicata_id ? (
                          <button
                            type="button"
                            onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'CRIAR_NOVO', lancamentos_atrasados_relacionados: [] })}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'CRIAR_NOVO' ? 'border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/35 dark:text-lime-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                          >
                            Criar novo
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'DESCARTAR', lancamentos_atrasados_relacionados: [] })}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${descartado ? 'border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Ignorar sugestao
                        </button>
                        {!descartado && !duplicadoAnterior ? (
                          <button
                            type="button"
                            onClick={() => abrirBuscaDisponiveis(lanc)}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                          >
                            <Search className="h-3.5 w-3.5" />
                            {lanc.tipo === 'DESPESA' ? 'Buscar pagamento' : 'Buscar recebimento'}
                          </button>
                        ) : null}
                        {sugestaoPendente ? (
                          <button
                            type="button"
                            onClick={() => updateLancamento(lanc.linha_arquivo, { sugestao_confirmada: true })}
                            className="rounded-full border border-emerald-400 bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white transition hover:bg-emerald-600"
                          >
                            Confirma sugestao
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {buscaAberta && lancamentoBuscaAberto ? (
                      <div className="mt-4 rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:col-span-2">
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-300">
                              {lancamentoBuscaAberto.tipo === 'DESPESA' ? 'Buscar pagamento' : 'Buscar recebimento'}
                            </p>
                            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Lançamentos disponíveis</h2>
                            <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                              Selecione pagamentos ou recebimentos atrasados, vencendo hoje, ou futuros se necessário. O painel rola por dentro e mantém a revisão no padrão da página.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={fecharBuscaDisponiveis}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                          >
                            Fechar
                          </button>
                        </div>

                        <div className="flex max-h-[72vh] min-h-0 flex-col gap-4 p-4">
                          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(240px,0.7fr)] xl:items-end">
                            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950">
                              <Search className="h-4 w-4 text-slate-400" />
                              <input
                                value={buscaDisponiveis.termo}
                                onChange={(event) => setBuscaDisponiveis((prev) => ({ ...prev, termo: event.target.value }))}
                                placeholder="Filtrar por descricao ou interessado"
                                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                              />
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Centro de custo
                                <select
                                  value={buscaDisponiveis.centroCustoId ?? ''}
                                  onChange={(event) => {
                                    const centroId = event.target.value ? Number(event.target.value) : null;
                                    setBuscaDisponiveis((prev) => ({ ...prev, centroCustoId: centroId }));
                                    carregarLancamentosDisponiveis(lancamentoBuscaAberto, buscaDisponiveis.incluirFuturos, centroId);
                                  }}
                                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                >
                                  <option value="">Sem centro de custo</option>
                                  {centrosCusto.map((centro) => (
                                    <option key={centro.id} value={centro.id}>
                                      {centro.nome}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={buscaDisponiveis.incluirFuturos}
                                  onChange={(event) => {
                                    const incluir = event.target.checked;
                                    setBuscaDisponiveis((prev) => ({ ...prev, incluirFuturos: incluir }));
                                    carregarLancamentosDisponiveis(lancamentoBuscaAberto, incluir, buscaDisponiveis.centroCustoId ?? centroCustoPadraoBusca);
                                  }}
                                />
                                Incluir futuros (opcional)
                              </label>
                            </div>
                          </div>

                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Centro de custo padrão aplicado: {centrosCusto.find((centro) => centro.id === (buscaDisponiveis.centroCustoId ?? centroCustoPadraoBusca))?.nome || 'Sem centro de custo'}.
                          </p>

                          <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
                            <div className="max-h-[48vh] space-y-2 overflow-y-auto p-3 pr-2">
                              {buscaDisponiveis.loading ? (
                                <div className="flex items-center gap-2 px-2 py-6 text-sm text-slate-500 dark:text-slate-400">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Buscando lancamentos...
                                </div>
                              ) : buscaDisponiveis.error ? (
                                <p className="px-2 py-6 text-sm text-rose-600 dark:text-rose-300">{buscaDisponiveis.error}</p>
                              ) : itensDisponiveisFiltrados.length === 0 ? (
                                <p className="px-2 py-6 text-sm text-slate-500 dark:text-slate-400">Nenhum lancamento disponivel para este filtro.</p>
                              ) : (
                                itensDisponiveisFiltrados.map((item) => {
                                  const jaSelecionado = buscaSelecionados.includes(item.id);
                                  const linhasComMesmoId = selecionadosConfirmadosPorId.get(item.id);
                                  const selecionadoEmOutro = Boolean(
                                    linhasComMesmoId && Array.from(linhasComMesmoId).some((linha) => linha !== lancamentoBuscaAberto.linha_arquivo),
                                  );
                                  const bloqueado = !jaSelecionado && selecionadoEmOutro;
                                  return (
                                    <label
                                      key={`disponivel-${lancamentoBuscaAberto.linha_arquivo}-${item.id}`}
                                      className={`flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900 ${bloqueado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={jaSelecionado}
                                        disabled={bloqueado}
                                        onChange={(event) => {
                                          if (bloqueado) return;
                                          setBuscaSelecionados((prev) => {
                                            if (event.target.checked) {
                                              return [...new Set([...prev, item.id])];
                                            }
                                            return prev.filter((id) => id !== item.id);
                                          });
                                        }}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-semibold text-slate-900 dark:text-white">{item.descricao}</p>
                                          <span className="text-xs text-slate-500 dark:text-slate-400">{formatCurrency(item.valor_previsto)}</span>
                                        </div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Vence em {formatDate(item.data_vencimento)}</p>
                                        {item.interessado ? (
                                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Interessado: {item.interessado}</p>
                                        ) : null}
                                        {item.centro_custo_nome ? (
                                          <p className="text-xs text-slate-500 dark:text-slate-400">CC: {item.centro_custo_nome}</p>
                                        ) : null}
                                        {bloqueado ? (
                                          <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">Confirmado em outro lançamento.</p>
                                        ) : null}
                                      </div>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-slate-500 dark:text-slate-400">{buscaSelecionados.length} item(ns) selecionados.</p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setBuscaSelecionados([])}
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                              >
                                Limpar
                              </button>
                              <button
                                type="button"
                                onClick={() => aplicarSelecaoDisponiveis(lancamentoBuscaAberto)}
                                className="rounded-full border border-emerald-300 bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white transition hover:bg-emerald-600"
                              >
                                Aplicar selecao
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="min-w-60 rounded-[22px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                        <Landmark className="h-4 w-4" />
                        Movimento bancário
                      </div>
                      <p className={`mt-3 text-2xl font-black ${valorClass}`}>{formatCurrency(Number(lanc.valor || 0))}</p>
                    </div>
                  </div>

                  {lanc.duplicata_resumo && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                      <p className="font-bold text-slate-800 dark:text-white">Já existe um lançamento equivalente para esta conta.</p>
                      <p className="mt-1">{lanc.duplicata_resumo.descricao}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{lanc.duplicata_resumo.motivo || 'Movimento repetido.'}</p>
                    </div>
                  )}

                  {lanc.sugestao_acao === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_resumo && (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Melhor previsto encontrado</p>
                      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          {lanc.lancamento_previsto_resumo.interessado ? (
                            <p className="text-xs font-bold text-slate-900 dark:text-white">Interessado: {lanc.lancamento_previsto_resumo.interessado}</p>
                          ) : null}
                          <p className="font-bold text-slate-900 dark:text-white">{lanc.lancamento_previsto_resumo.descricao}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-300">Vence em {formatDate(lanc.lancamento_previsto_resumo.data_vencimento)} • {formatCurrency(lanc.lancamento_previsto_resumo.valor_previsto)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' && !!lanc.lancamentos_atrasados_resumo?.length && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Atrasados compatíveis</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Selecione os atrasados que este movimento deve quitar.</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-3">
                        {[...(lanc.lancamentos_atrasados_resumo || [])]
                          .map((resumo, index) => ({
                            resumo,
                            atrasoId: resumo?.id ?? lanc.lancamentos_atrasados_ids?.[index],
                          }))
                          .sort((a, b) => (b.resumo?.score || 0) - (a.resumo?.score || 0))
                          .map(({ resumo: atrasado, atrasoId }, index) => {
                          const marcado = atrasoId ? lanc.lancamentos_atrasados_relacionados.includes(atrasoId) : false;
                          const linhasComMesmoAtraso = atrasoId ? selecionadosConfirmadosPorId.get(atrasoId) : undefined;
                          const selecionadoEmOutroLancamento = Boolean(
                            atrasoId
                              && linhasComMesmoAtraso
                              && Array.from(linhasComMesmoAtraso).some((linha) => linha !== lanc.linha_arquivo),
                          );
                          const bloqueadoPorOutroLancamento = !marcado && selecionadoEmOutroLancamento;
                          return (
                            <label
                              key={`${lanc.linha_arquivo}-${index}`}
                              className={`flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-white/80 p-3 dark:border-amber-900/40 dark:bg-slate-900/60 ${bloqueadoPorOutroLancamento ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                disabled={bloqueadoPorOutroLancamento}
                                onChange={(e) => {
                                  if (!atrasoId) return;
                                  if (bloqueadoPorOutroLancamento) return;
                                  const proximo = e.target.checked
                                    ? [...lanc.lancamentos_atrasados_relacionados, atrasoId]
                                    : lanc.lancamentos_atrasados_relacionados.filter((item) => item !== atrasoId);
                                  updateLancamento(lanc.linha_arquivo, { lancamentos_atrasados_relacionados: proximo });
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                {atrasado.interessado ? (
                                  <p className="text-xs font-bold text-slate-900 dark:text-white">Interessado: {atrasado.interessado}</p>
                                ) : null}
                                <div className="flex flex-col gap-1">
                                  <p className="font-bold text-slate-900 dark:text-white">{atrasado.descricao}</p>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                                    Score {atrasado.score}
                                  </span>
                                  <span>Venceu em {formatDate(atrasado.data_vencimento)}</span>
                                  <span>•</span>
                                  <span>{formatCurrency(atrasado.valor_previsto)}</span>
                                  {atrasado.centro_custo_nome ? (
                                    <>
                                      <span>•</span>
                                      <span>CC: {atrasado.centro_custo_nome}</span>
                                    </>
                                  ) : null}
                                </div>
                                {atrasado.motivo ? (
                                  <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">{atrasado.motivo}</p>
                                ) : null}
                                {bloqueadoPorOutroLancamento ? (
                                  <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">Esta sugestão já foi confirmada em outro lançamento.</p>
                                ) : null}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!descartado && !conciliacaoAutomatica ? (
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Categoria compatível</label>
                        <SearchableDropdown
                          value={lanc.plano_contas_id}
                          options={categoriaOptions}
                          placeholder="A categorizar"
                          onChange={(value) => applyCategoriaPorInteressado(lanc.linha_arquivo, value)}
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Interessado</label>
                        <SearchableDropdown
                          value={lanc.entidade_id}
                          options={entidadeOptions}
                          placeholder="Sem interessado"
                          onChange={(value) => updateLancamento(lanc.linha_arquivo, { entidade_id: value })}
                        />
                        {!lanc.entidade_id && lanc.interessado_sugerido ? (
                          <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-300">
                            Sugestão detectada: {lanc.interessado_sugerido}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {lancamentosFiltrados.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <p className="text-lg font-bold text-slate-900 dark:text-white">Nenhum movimento encontrado para este filtro.</p>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Ajuste a busca ou troque a visão para revisar mais movimentos.</p>
              </div>
            )}
          </div>

          <div className="sticky bottom-4 z-10 rounded-3xl border border-slate-200 bg-white/92 p-4 shadow-xl backdrop-blur dark:border-slate-800 dark:bg-slate-900/92">
            {confirming && confirmProgress ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    Confirmando lote {confirmProgress.currentBatch}/{confirmProgress.totalBatches}
                  </p>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
                    {confirmProgress.processedItems}/{confirmProgress.totalItems} enviados
                  </p>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-emerald-200/70 dark:bg-emerald-900/50">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(100, Math.round((confirmProgress.processedItems / Math.max(1, confirmProgress.totalItems)) * 100)),
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-emerald-700/90 dark:text-emerald-300/90">
                  Criados: {confirmProgress.criados} • Atualizados: {confirmProgress.atualizados}
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Resumo para confirmação</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{lancamentosEditados.length} item(ns) analisados. {resumo.semCategoria === 0 ? 'Os novos lançamentos já têm categoria.' : `${resumo.semCategoria} novo(s) ainda exigem categoria.`}</p>
              </div>
              <button
                onClick={handleConfirmar}
                disabled={confirming || !resultado || resultado.lancamentos.length === 0}
                className="flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {confirming && confirmProgress
                  ? `Confirmando lote ${confirmProgress.currentBatch}/${confirmProgress.totalBatches}`
                  : 'Confirmar importação OFX'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300">
            <UploadCloud className="h-8 w-8" />
          </div>
          <h2 className="mt-5 text-2xl font-black text-slate-900 dark:text-white">Nenhum arquivo analisado ainda</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Envie um OFX para receber sugestões de baixa de previstos, vinculação de atrasados e criação guiada de novos lançamentos dentro do padrão financeiro do sistema.
          </p>
        </section>
      )}
    </div>
  );
}
