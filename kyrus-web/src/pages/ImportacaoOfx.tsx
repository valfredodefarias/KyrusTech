import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  ChevronDown,
  Edit,
  FileSpreadsheet,
  Filter,
  Landmark,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react';
import { BankAvatar } from '../components/BrandAvatar';
import { api, normalizeListResponse } from '../services/api';
import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';

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

  const chaveWords = chave.split(' ');

  const contida = entidades.find((entidade) => {
    const candidato = normalizarDescricao(entidade.nome);
    if (!candidato) return false;

    const candidatoWords = candidato.split(' ');

    if (candidato.length < 3) {
      if (!chaveWords.includes(candidato)) return false;
    } else {
      if (!chave.includes(candidato)) return false;
    }

    if (chave.length < 3) {
      if (!candidatoWords.includes(chave)) return false;
    } else {
      if (!candidato.includes(chave)) return false;
    }

    return true;
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
  movimento_id?: number | null;
}

interface AlocacaoItemUI {
  lancamento_id?: number;
  lancamento_temp_id?: string;
  valor_alocado: number;
  tipo_baixa: 'PRINCIPAL' | 'JUROS' | 'MULTA' | 'DESCONTO';
  descricao?: string;
  interessado?: string | null;
  data_vencimento?: string;
  valor_previsto?: number;
  decisao_excedido?: 'MANTER';
}

interface LancamentoEditado extends LancamentoImportado {
  lancamentos_atrasados_relacionados: number[];
  auto_preenchido: boolean;
  sugestao_acao_original: NonNullable<LancamentoImportado['sugestao_acao']>;
  sugestao_confirmada: boolean;
  interessado_digitado?: string;
  criar_novo_interessado?: boolean;
  alocacoes?: AlocacaoItemUI[];
}

type FeedbackState = {
  type: 'success' | 'error' | 'warning';
  message: string;
  conflitos?: string[];
};

interface ProcessarArquivoResponse {
  lancamentos: LancamentoImportado[];
  total_processado: number;
  duplicatas_encontradas: number;
  lancamentos_previstos_encontrados: number;
  lancamentos_atrasados_encontrados: number;
  gap_detectado?: boolean;
  gap_data_ultimo?: string | null;
  gap_data_inicio_arquivo?: string | null;
  gap_dias?: number;
  saldo_ofx?: number | null;
  saldo_ofx_data?: string | null;
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
  if (lanc.sugestao_acao) return lanc.sugestao_acao;
  if (lanc.lancamento_previsto_id) return 'BAIXAR_PREVISTO';
  if ((lanc.lancamentos_atrasados_ids || []).length > 0) return 'RELACIONAR_ATRASADOS';
  if (lanc.duplicata_id) return 'IGNORAR_DUPLICATA';
  return 'CRIAR_NOVO';
}

function getAlocacoesOrDefault(item: LancamentoEditado): AlocacaoItemUI[] {
  if (item.alocacoes && item.alocacoes.length > 0) {
    return item.alocacoes;
  }
  if (item.sugestao_acao === 'BAIXAR_PREVISTO' && item.lancamento_previsto_id) {
    return [{
      lancamento_id: item.lancamento_previsto_id,
      valor_alocado: Math.abs(item.valor),
      tipo_baixa: 'PRINCIPAL',
      descricao: item.lancamento_previsto_resumo?.descricao || undefined,
      interessado: item.lancamento_previsto_resumo?.interessado || undefined,
      data_vencimento: item.lancamento_previsto_resumo?.data_vencimento || '',
      valor_previsto: item.lancamento_previsto_resumo?.valor_previsto || 0,
    }];
  }
  if (item.sugestao_acao === 'RELACIONAR_ATRASADOS' && item.lancamentos_atrasados_relacionados) {
    const relatedIds = item.lancamentos_atrasados_relacionados;
    return relatedIds.map((id) => {
      const res = item.lancamentos_atrasados_resumo?.find((r) => r.id === id);
      return {
        lancamento_id: id,
        valor_alocado: relatedIds.length === 1 ? Math.abs(item.valor) : (res?.valor_previsto ?? Math.abs(item.valor)),
        tipo_baixa: 'PRINCIPAL',
        descricao: res?.descricao || undefined,
        interessado: res?.interessado || undefined,
        data_vencimento: res?.data_vencimento || '',
        valor_previsto: res?.valor_previsto || 0,
      };
    });
  }
  return [];
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
  onChange: (value: number | null, query?: string) => void;
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
    if (option.id === -1) return true; // Always keep the "+ Criar novo" option visible
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
                onChange(null, query);
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
                  onChange(option.id, query);
                  setIsOpen(false);
                }}
                className={`w-full border-b border-slate-100 px-3 py-2 text-left text-sm transition last:border-b-0 dark:border-slate-800 ${option.disabled ? 'cursor-not-allowed bg-slate-50 text-slate-400 dark:bg-slate-900 dark:text-slate-500' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900'}`}
              >
                <span className="truncate">
                  {option.id === -1 && query.trim() ? `+ Criar novo: "${query.trim()}"` : option.label}
                </span>
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const state = location.state as {
    preLoadedResult?: ProcessarArquivoResponse;
    preSelectedContaId?: number;
    directFlow?: boolean;
  } | undefined;
  const [isDirectFlow, setIsDirectFlow] = useState(!!state?.directFlow);
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
  const [linhaEditandoDescricao, setLinhaEditandoDescricao] = useState<number | null>(null);
  const [descricaoTemporaria, setDescricaoTemporaria] = useState('');
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


  const [transferenciaConfirmacao, setTransferenciaConfirmacao] = useState<{
    linhaArquivo: number;
    atrasoId: number;
    atrasado: RelacionamentoResumo | LancamentoDisponivel;
    outrasLinhas: number[];
  } | null>(null);

  const [limiteResultados, setLimiteResultados] = useState(15);
  const [formDrawerConfig, setFormDrawerConfig] = useState<{
    show: boolean;
    prefilledData?: any;
    editarId?: number | null;
    linhaArquivo?: number;
    diffVal?: number;
  }>({ show: false });

  useEffect(() => {
    return () => {
      setContas([]);
      setCartoes([]);
      setCentrosCusto([]);
      setResultado(null);
      setLancamentosEditados([]);
      setCategorias([]);
      setEntidades([]);
      setSugestoes({});
    };
  }, []);

  const scrollCardIntoView = (linhaArquivo: number) => {
    setTimeout(() => {
      const el = document.getElementById(`card-lancamento-${linhaArquivo}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const obterOutrosLancamentosComSelecao = (atrasoId: number, linhaArquivoAtual: number) => {
    return lancamentosEditados.filter((item) => {
      if (item.linha_arquivo === linhaArquivoAtual) return false;
      if (item.sugestao_acao === 'BAIXAR_PREVISTO' && Number(item.lancamento_previsto_id) === atrasoId) {
        return true;
      }
      if (
        item.sugestao_acao === 'RELACIONAR_ATRASADOS'
        && Array.isArray(item.lancamentos_atrasados_relacionados)
        && item.lancamentos_atrasados_relacionados.includes(atrasoId)
      ) {
        return true;
      }
      return false;
    });
  };

  const confirmarTransferencia = () => {
    if (!transferenciaConfirmacao) return;
    const { linhaArquivo, atrasoId, atrasado, outrasLinhas } = transferenciaConfirmacao;

    setLancamentosEditados((prev) =>
      prev.map((item) => {
        if (outrasLinhas.includes(item.linha_arquivo)) {
          let nextPatch: Partial<LancamentoEditado> = {};
          if (item.sugestao_acao === 'BAIXAR_PREVISTO' && Number(item.lancamento_previsto_id) === atrasoId) {
            nextPatch = {
              lancamento_previsto_id: null,
              lancamento_previsto_resumo: null,
              sugestao_confirmada: false,
              alocacoes: [],
            };
          }
          if (item.sugestao_acao === 'RELACIONAR_ATRASADOS') {
            const nextAtrasados = (item.lancamentos_atrasados_relacionados || []).filter((id) => id !== atrasoId);
            const nextResumo = (item.lancamentos_atrasados_resumo || []).filter((r) => r.id !== atrasoId);
            const nextAlocacoes = (item.alocacoes || []).filter((a) => a.lancamento_id !== atrasoId);
            nextPatch = {
              lancamentos_atrasados_relacionados: nextAtrasados,
              lancamentos_atrasados_resumo: nextResumo,
              sugestao_confirmada: false,
              alocacoes: nextAlocacoes,
            };
          }
          return { ...item, ...nextPatch };
        }
        return item;
      })
    );

    setLancamentosEditados((prev) =>
      prev.map((item) => {
        if (item.linha_arquivo === linhaArquivo) {
          const proximo = [...(item.lancamentos_atrasados_relacionados || []), atrasoId];
          const originalAtrasado = item.lancamentos_atrasados_resumo?.find((r) => r.id === atrasoId);
          const itemResumo = 'score' in atrasado 
            ? (atrasado as RelacionamentoResumo) 
            : mapDisponivelToResumo(atrasado as LancamentoDisponivel, 'Selecionado manualmente');
          const resumos = originalAtrasado
            ? item.lancamentos_atrasados_resumo
            : [...(item.lancamentos_atrasados_resumo || []), itemResumo];
          
          const newAloc = {
            lancamento_id: atrasoId,
            valor_alocado: itemResumo.valor_previsto,
            tipo_baixa: 'PRINCIPAL' as const,
            descricao: itemResumo.descricao,
            interessado: itemResumo.interessado,
            data_vencimento: itemResumo.data_vencimento,
            valor_previsto: itemResumo.valor_previsto,
          };
          const nextAlocacoes = [...(item.alocacoes || []), newAloc];

          return {
            ...item,
            lancamentos_atrasados_relacionados: proximo,
            lancamentos_atrasados_resumo: resumos,
            alocacoes: nextAlocacoes,
          };
        }
        return item;
      })
    );

    setTransferenciaConfirmacao(null);
    scrollCardIntoView(linhaArquivo);
  };

  const confirmarRateio = () => {
    if (!transferenciaConfirmacao) return;
    const { linhaArquivo, atrasoId, atrasado, outrasLinhas } = transferenciaConfirmacao;

    let totalAlocadoEmOutros = 0;
    lancamentosEditados.forEach((item) => {
      if (outrasLinhas.includes(item.linha_arquivo)) {
        const aloc = item.alocacoes?.find((a) => a.lancamento_id === atrasoId);
        if (aloc) {
          totalAlocadoEmOutros += aloc.valor_alocado;
        }
      }
    });

    const valorPrevisto = 'valor_previsto' in atrasado ? (atrasado as any).valor_previsto : 0;
    const restante = Math.max(0.01, valorPrevisto - totalAlocadoEmOutros);

    setLancamentosEditados((prev) =>
      prev.map((item) => {
        if (item.linha_arquivo === linhaArquivo) {
          const proximo = [...(item.lancamentos_atrasados_relacionados || [])];
          if (!proximo.includes(atrasoId)) {
            proximo.push(atrasoId);
          }

          const originalAtrasado = item.lancamentos_atrasados_resumo?.find((r) => r.id === atrasoId);
          const itemResumo = 'score' in atrasado 
            ? (atrasado as RelacionamentoResumo) 
            : mapDisponivelToResumo(atrasado as LancamentoDisponivel, 'Selecionado manualmente');
          
          const resumos = originalAtrasado
            ? item.lancamentos_atrasados_resumo
            : [...(item.lancamentos_atrasados_resumo || []), itemResumo];

          const jaTemAloc = item.alocacoes?.find((a) => a.lancamento_id === atrasoId);
          let nextAlocacoes = [...(item.alocacoes || [])];
          if (!jaTemAloc) {
            nextAlocacoes.push({
              lancamento_id: atrasoId,
              valor_alocado: restante,
              tipo_baixa: 'PRINCIPAL' as const,
              descricao: itemResumo.descricao,
              interessado: itemResumo.interessado,
              data_vencimento: itemResumo.data_vencimento,
              valor_previsto: itemResumo.valor_previsto,
            });
          }

          return {
            ...item,
            lancamentos_atrasados_relacionados: proximo,
            lancamentos_atrasados_resumo: resumos,
            alocacoes: nextAlocacoes,
          };
        }
        return item;
      })
    );

    setTransferenciaConfirmacao(null);
    scrollCardIntoView(linhaArquivo);
  };

  const handleAjustarVencimento = (linhaArquivo: number, lancamentoId: number, novoValor: number) => {
    setLancamentosEditados((prev) =>
      prev.map((item) => {
        if (item.linha_arquivo === linhaArquivo) {
          const currentAlocs = getAlocacoesOrDefault(item);
          const nextAlocs = currentAlocs.map((a) => {
            if (a.lancamento_id === lancamentoId) {
              return { ...a, valor_previsto: novoValor };
            }
            return a;
          });
          let nextPrevistoResumo = item.lancamento_previsto_resumo;
          if (item.lancamento_previsto_id === lancamentoId && nextPrevistoResumo) {
            nextPrevistoResumo = { ...nextPrevistoResumo, valor_previsto: novoValor };
          }
          let nextAtrasadosResumo = item.lancamentos_atrasados_resumo;
          if (nextAtrasadosResumo) {
            nextAtrasadosResumo = nextAtrasadosResumo.map((r) => {
              if (r.id === lancamentoId) {
                return { ...r, valor_previsto: novoValor };
              }
              return r;
            });
          }
          return {
            ...item,
            alocacoes: nextAlocs,
            lancamento_previsto_resumo: nextPrevistoResumo,
            lancamentos_atrasados_resumo: nextAtrasadosResumo,
          };
        }
        return item;
      })
    );
    setFeedback({ type: 'success', message: 'Ajuste de valor previsto agendado! Será salvo ao confirmar a importação.' });
    scrollCardIntoView(linhaArquivo);
  };

  const handleManterPrevisto = (linhaArquivo: number, lancamentoId: number) => {
    setLancamentosEditados((prev) =>
      prev.map((item) => {
        if (item.linha_arquivo === linhaArquivo) {
          const currentAlocs = getAlocacoesOrDefault(item);
          const nextAlocs = currentAlocs.map((a) => {
            if (a.lancamento_id === lancamentoId) {
              return { ...a, decisao_excedido: 'MANTER' as const };
            }
            return a;
          });
          return { ...item, alocacoes: nextAlocs };
        }
        return item;
      })
    );
  };

  const handleAbrirFormJurosMulta = async (lanc: LancamentoEditado, diffVal: number) => {
    try {
      setLoading(true);
      const originalAloc = lanc.alocacoes?.[0] || lanc.lancamento_previsto_resumo;
      const originalId = (originalAloc as any)?.lancamento_id || (originalAloc as any)?.id;
      
      let originalEntidadeId: number | null = null;
      let originalDesc = lanc.descricao;

      if (originalId) {
        const origRes = await api.get(`/lancamentos/${originalId}`);
        originalEntidadeId = origRes.data.entidade_id || null;
        originalDesc = origRes.data.descricao || lanc.descricao;
      }

      const prefilledDescription = `Juros e multa referente a ${originalDesc}`;
      
      const prefilled: any = {
        descricao: prefilledDescription,
        tipo: lanc.tipo || 'DESPESA',
        valor_previsto: diffVal,
        valor_pago: diffVal,
        data_vencimento: lanc.data,
        data_pagamento: lanc.data,
        status: 'PAGO',
        previsto: true,
        conta_id: contaId || '',
        cartao_id: cartaoId || '',
        centro_custo_id: centroCustoPadraoBusca || '',
        entidade_id: originalEntidadeId ? String(originalEntidadeId) : '',
      };

      setFormDrawerConfig({
        show: true,
        prefilledData: prefilled,
        linhaArquivo: lanc.linha_arquivo,
        diffVal: diffVal,
      });
    } catch (err) {
      console.error('Erro ao obter dados do lançamento original', err);
      const originalDesc = lanc.lancamento_previsto_resumo?.descricao 
        || (lanc.alocacoes && lanc.alocacoes.length > 0 ? lanc.alocacoes[0].descricao : null)
        || lanc.descricao;

      setFormDrawerConfig({
        show: true,
        prefilledData: {
          descricao: `Juros e multa referente a ${originalDesc}`,
          tipo: lanc.tipo || 'DESPESA',
          valor_previsto: diffVal,
          valor_pago: diffVal,
          data_vencimento: lanc.data,
          data_pagamento: lanc.data,
          status: 'PAGO',
          previsto: true,
          conta_id: contaId || '',
          cartao_id: cartaoId || '',
          centro_custo_id: centroCustoPadraoBusca || '',
        },
        linhaArquivo: lanc.linha_arquivo,
        diffVal: diffVal,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditarLancamentoExistente = (linhaArquivo: number, lancamentoId: number) => {
    setFormDrawerConfig({
      show: true,
      editarId: lancamentoId,
      linhaArquivo,
    });
  };

  const handleFormDrawerSalvo = async (createdId?: number) => {
    if (formDrawerConfig.editarId) {
      const editedId = formDrawerConfig.editarId;
      setFormDrawerConfig({ show: false });
      try {
        setLoading(true);
        const res = await api.get(`/lancamentos/${editedId}`);
        const updated = res.data;
        setLancamentosEditados((prev) =>
          prev.map((item) => {
            const hasAloc = item.alocacoes?.some((a) => a.lancamento_id === editedId) ||
                            (item.lancamento_previsto_id === editedId) ||
                            (item.lancamentos_atrasados_relacionados?.includes(editedId));
            if (hasAloc) {
              const currentAlocs = getAlocacoesOrDefault(item);
              const nextAlocs = currentAlocs.map((a) => {
                if (a.lancamento_id === editedId) {
                  return {
                    ...a,
                    descricao: updated.descricao,
                    interessado: updated.entidade?.nome || null,
                    data_vencimento: updated.data_vencimento,
                    valor_previsto: updated.valor_previsto,
                  };
                }
                return a;
              });
              
              let nextPrevistoResumo = item.lancamento_previsto_resumo;
              if (item.lancamento_previsto_id === editedId && nextPrevistoResumo) {
                nextPrevistoResumo = {
                  ...nextPrevistoResumo,
                  descricao: updated.descricao,
                  interessado: updated.entidade?.nome || null,
                  data_vencimento: updated.data_vencimento,
                  valor_previsto: updated.valor_previsto,
                };
              }
              
              let nextAtrasadosResumo = item.lancamentos_atrasados_resumo;
              if (nextAtrasadosResumo) {
                nextAtrasadosResumo = nextAtrasadosResumo.map((r) => {
                  if (r.id === editedId) {
                    return {
                      ...r,
                      descricao: updated.descricao,
                      interessado: updated.entidade?.nome || null,
                      data_vencimento: updated.data_vencimento,
                      valor_previsto: updated.valor_previsto,
                    };
                  }
                  return r;
                });
              }

              return {
                ...item,
                alocacoes: nextAlocs,
                lancamento_previsto_resumo: nextPrevistoResumo,
                lancamentos_atrasados_resumo: nextAtrasadosResumo,
              };
            }
            return item;
          })
        );
        setFeedback({ type: 'success', message: 'Lançamento atualizado com sucesso!' });
      } catch (error) {
        console.error('Erro ao atualizar lançamento após edição', error);
      } finally {
        setLoading(false);
      }
    } else {
      if (!createdId || formDrawerConfig.linhaArquivo === undefined || formDrawerConfig.diffVal === undefined) {
        setFormDrawerConfig({ show: false });
        return;
      }

      const { linhaArquivo, diffVal } = formDrawerConfig;
      setFormDrawerConfig({ show: false });

      try {
        setLoading(true);
        const res = await api.get(`/lancamentos/${createdId}`);
        const createdLaunch = res.data;

        setLancamentosEditados((prev) =>
          prev.map((item) => {
            if (item.linha_arquivo === linhaArquivo) {
              const currentAlocs = item.alocacoes || [];
              const newAloc: AlocacaoItemUI = {
                lancamento_id: createdId,
                valor_alocado: diffVal,
                tipo_baixa: 'PRINCIPAL',
                descricao: createdLaunch.descricao,
                interessado: createdLaunch.entidade?.nome || null,
                data_vencimento: createdLaunch.data_vencimento,
                valor_previsto: createdLaunch.valor_previsto,
              };

              let nextAtrasados = item.lancamentos_atrasados_relacionados || [];
              let nextAtrasadosResumo = item.lancamentos_atrasados_resumo || [];

              const resumoItem = {
                id: createdId,
                descricao: createdLaunch.descricao,
                interessado: createdLaunch.entidade?.nome || null,
                data_vencimento: createdLaunch.data_vencimento,
                valor_previsto: createdLaunch.valor_previsto,
                score: 0,
                motivo: 'Criado para diferença (juros/multa)',
              };

              if (item.sugestao_acao === 'RELACIONAR_ATRASADOS') {
                if (!nextAtrasados.includes(createdId)) {
                  nextAtrasados = [...nextAtrasados, createdId];
                }
                if (!nextAtrasadosResumo.some((r) => r.id === createdId)) {
                  nextAtrasadosResumo = [...nextAtrasadosResumo, resumoItem];
                }
              } else {
                const originalId = item.lancamento_previsto_id;
                nextAtrasados = [];
                if (originalId) nextAtrasados.push(originalId);
                nextAtrasados.push(createdId);

                nextAtrasadosResumo = [];
                if (originalId && item.lancamento_previsto_resumo) {
                  nextAtrasadosResumo.push({
                    id: originalId,
                    descricao: item.lancamento_previsto_resumo.descricao,
                    interessado: item.lancamento_previsto_resumo.interessado,
                    data_vencimento: item.lancamento_previsto_resumo.data_vencimento,
                    valor_previsto: item.lancamento_previsto_resumo.valor_previsto,
                    score: 1,
                    motivo: 'Original',
                  });
                }
                nextAtrasadosResumo.push(resumoItem);
              }

              return {
                ...item,
                sugestao_acao: 'RELACIONAR_ATRASADOS' as const,
                lancamentos_atrasados_relacionados: nextAtrasados,
                lancamentos_atrasados_resumo: nextAtrasadosResumo,
                alocacoes: [...currentAlocs, newAloc],
              };
            }
            return item;
          })
        );

        setFeedback({ type: 'success', message: 'Lançamento de diferença criado e vinculado com sucesso!' });
      } catch (error) {
        console.error('Erro ao buscar lançamento recém-criado', error);
        setLancamentosEditados((prev) =>
          prev.map((item) => {
            if (item.linha_arquivo === linhaArquivo) {
              const currentAlocs = item.alocacoes || [];
              const newAloc: AlocacaoItemUI = {
                lancamento_id: createdId,
                valor_alocado: diffVal,
                tipo_baixa: 'PRINCIPAL',
                descricao: `Juros e multa referente a...`,
                valor_previsto: diffVal,
              };
              return {
                ...item,
                alocacoes: [...currentAlocs, newAloc],
              };
            }
            return item;
          })
        );
      } finally {
        setLoading(false);
      }
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const contaParam = searchParams.get('conta_id');
    if (contaParam && !Number.isNaN(Number(contaParam))) {
      setContaId(Number(contaParam));
    }
  }, [searchParams]);

  useEffect(() => {
    if (buscaDisponiveis.linhaArquivo != null && !buscaDisponiveis.loading) {
      scrollCardIntoView(buscaDisponiveis.linhaArquivo);
    }
  }, [buscaDisponiveis.linhaArquivo, buscaDisponiveis.loading]);

  useEffect(() => {
    setLimiteResultados(15);
  }, [buscaDisponiveis.termo, buscaDisponiveis.linhaArquivo]);

  useEffect(() => {
    if (state?.preLoadedResult) {
      setResultado(state.preLoadedResult);
      setIsDirectFlow(true);
      if (state.preSelectedContaId) {
        setContaId(Number(state.preSelectedContaId));
        setModoImportacao('CONTA');
      }
    }
  }, [state]);

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
          api.get<any[]>('/lancamentos/?limit=5000&minimized=true'),
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
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          params,
          timeout: 120000 // 2 minutes timeout for processing OFX
        }
      );
      setResultado(data);
      await reloadEntidadesLookup();
      setFeedback({ type: 'success', message: 'Arquivo OFX processado com sucesso.' });
    } catch (error: any) {
      if (axios.isCancel(error)) return;
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
      let criados = 0;
      let atualizados = 0;
      const erros: string[] = [];

      if (modoImportacao === 'CONTA') {
        const listCopy = lancamentosEditados.map((item) => ({
          ...item,
          alocacoes: item.alocacoes ? item.alocacoes.map((a) => ({ ...a })) : undefined,
        }));
        const lancamentosParaCriar: any[] = [];
        const atualizarLancamentos: any[] = [];

        // 1. Resolve entities and prepare new launches / updates
        for (let idx = 0; idx < listCopy.length; idx++) {
          const lanc = listCopy[idx];
          if (lanc.sugestao_acao === 'DESCARTAR' || lanc.sugestao_acao === 'IGNORAR_DUPLICATA') {
            continue;
          }

          if (lanc.sugestao_acao === 'CRIAR_NOVO') {
            try {
              let entId = lanc.entidade_id;
              if (!entId && lanc.criar_novo_interessado && lanc.interessado_digitado) {
                const entRes = await api.post('/entidades/', {
                  nome: lanc.interessado_digitado,
                  tipo: 'AMBOS',
                  tipo_pessoa: 'PJ',
                  status: 'ATIVO',
                });
                entId = entRes.data.id;
                await reloadEntidadesLookup();
              }

              const tempId = `new-${lanc.linha_arquivo}`;
              const newLaunchPayload = {
                temp_id: tempId,
                descricao: lanc.descricao,
                tipo: lanc.tipo,
                status: 'PENDENTE',
                origem: 'OFX',
                valor: Math.abs(lanc.valor),
                valor_previsto: Math.abs(lanc.valor),
                data: lanc.data,
                data_vencimento: lanc.data,
                plano_contas_id: lanc.plano_contas_id || 1,
                entidade_id: entId || null,
                conta_id: Number(contaId),
                centro_custo_id: centroCustoPadraoBusca,
                import_hash: lanc.import_hash || null,
              };

              lancamentosParaCriar.push(newLaunchPayload);

              lanc.lancamento_previsto_id = undefined;
              lanc.sugestao_acao = 'BAIXAR_PREVISTO';
              lanc.alocacoes = [{
                lancamento_temp_id: tempId,
                valor_alocado: Math.abs(lanc.valor),
                tipo_baixa: 'PRINCIPAL',
              }];
            } catch (err: any) {
              const errMsg = err?.response?.data?.detail || err.message || 'Erro ao preparar lançamento';
              erros.push(`Erro no movimento "${lanc.descricao}": ${errMsg}`);
              lanc.sugestao_acao = 'DESCARTAR';
            }
          } else {
            // Track updates for existing launches in this conc
            const alocs = lanc.alocacoes || [];
            alocs.forEach((aloc) => {
              if (aloc.lancamento_id && aloc.valor_previsto !== undefined) {
                atualizarLancamentos.push({
                  id: aloc.lancamento_id,
                  valor_previsto: aloc.valor_previsto,
                });
              }
            });
          }
        }

        // 2. Compile conciliacoes
        const conciliacoesList: {
          movimento_id: number;
          alocacoes: {
            lancamento_id?: number;
            lancamento_temp_id?: string;
            valor_alocado: number;
            tipo_baixa: 'PRINCIPAL' | 'JUROS' | 'MULTA' | 'DESCONTO';
          }[];
        }[] = [];

        listCopy.forEach((lanc) => {
          if (lanc.sugestao_acao === 'DESCARTAR' || lanc.sugestao_acao === 'IGNORAR_DUPLICATA') {
            return;
          }

          let alocs = lanc.alocacoes || [];
          if (alocs.length === 0) {
            if (lanc.sugestao_acao === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_id) {
              alocs = [{
                lancamento_id: lanc.lancamento_previsto_id,
                valor_alocado: Math.abs(lanc.valor),
                tipo_baixa: 'PRINCIPAL',
              }];
            } else if (lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_relacionados) {
              alocs = lanc.lancamentos_atrasados_relacionados.map((id) => {
                const res = lanc.lancamentos_atrasados_resumo?.find((r) => r.id === id);
                return {
                  lancamento_id: id,
                  valor_alocado: lanc.lancamentos_atrasados_relacionados.length === 1 ? Math.abs(lanc.valor) : (res?.valor_previsto ?? Math.abs(lanc.valor)),
                  tipo_baixa: 'PRINCIPAL' as const,
                };
              });
            }
          }

          if (lanc.movimento_id) {
            conciliacoesList.push({
              movimento_id: lanc.movimento_id,
              alocacoes: alocs.map((a) => ({
                lancamento_id: a.lancamento_id,
                lancamento_temp_id: a.lancamento_temp_id,
                valor_alocado: Number(a.valor_alocado),
                tipo_baixa: a.tipo_baixa,
              })),
            });
          }
        });

        if (conciliacoesList.length === 0 && erros.length > 0) {
          throw new Error(`Falha ao conciliar lançamentos: ${erros.join(' | ')}`);
        }

        const chunks = chunkArray(conciliacoesList, OFX_CONFIRM_CHUNK_SIZE);
        const totalItems = conciliacoesList.length;
        let processedItems = 0;

        for (let i = 0; i < chunks.length; i += 1) {
          const batchIndex = i + 1;
          const chunk = chunks[i];

          const payload = {
            lancamentos: i === 0 ? lancamentosParaCriar : [],
            atualizar_lancamentos: i === 0 ? atualizarLancamentos : [],
            conciliacoes: chunk,
            conta_id: Number(contaId),
            modo_importacao: 'CONTA',
            ignorar_divergencia: false,
            saldo_ofx: resultado?.saldo_ofx ?? null,
            saldo_ofx_data: resultado?.saldo_ofx_data ?? null,
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
      } else {
        // --- LEGACY/CARTÃO FLOW ---
        const chunks = chunkArray(lancamentosEditados, OFX_CONFIRM_CHUNK_SIZE);
        const totalItems = lancamentosEditados.length;
        let processedItems = 0;

        for (let i = 0; i < chunks.length; i += 1) {
          const batchIndex = i + 1;
          const chunk = chunks[i];

          const payload = {
            lancamentos: chunk.map((lanc) => {
              if (!lanc.entidade_id && !lanc.criar_novo_interessado) {
                return {
                  ...lanc,
                  interessado_digitado: '',
                  interessado_sugerido: '',
                  razao_social: '',
                };
              }
              return lanc;
            }),
            cartao_id: Number(cartaoId),
            modo_importacao: 'CARTAO',
            ignorar_divergencia: false,
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
        const conflitos = detail?.conflitos as string[] | undefined;
        if (divergenciaDepois) {
          const blocoAntes = divergenciaAntes
            ? ` Antes: ${formatCurrency(divergenciaAntes.diferenca)}.`
            : '';
          const msgDivergencia = `${message}${blocoAntes} Depois: ${formatCurrency(divergenciaDepois.diferenca)}. Saldo OFX: ${formatCurrency(divergenciaDepois.saldo_ofx)} | Saldo sistema: ${formatCurrency(divergenciaDepois.saldo_sistema)}.`;
          setFeedback({ type: 'error', message: msgDivergencia, conflitos: Array.isArray(conflitos) ? conflitos : undefined });
        } else {
          setFeedback({ type: 'error', message, conflitos: Array.isArray(conflitos) ? conflitos : undefined });
        }
      } else {
        const detailMsg = typeof detail === 'string' ? detail : null;
        const fallbackMsg = error.response?.data?.message || error.message || 'Erro ao confirmar importação.';
        setFeedback({ type: 'error', message: detailMsg || fallbackMsg });
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
      const criar_novo_interessado = !entidade_id && !!entidadeSugestaoTexto;
      const interessado_digitado = criar_novo_interessado ? String(entidadeSugestaoTexto) : '';

      const sugestaoOriginal = getSugestaoInicial(lanc);
      const initialAlocacoes: AlocacaoItemUI[] = [];
      if (sugestaoOriginal === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_id && lanc.lancamento_previsto_resumo) {
        initialAlocacoes.push({
          lancamento_id: lanc.lancamento_previsto_id,
          valor_alocado: Math.abs(lanc.valor),
          tipo_baixa: 'PRINCIPAL',
          descricao: lanc.lancamento_previsto_resumo.descricao,
          interessado: lanc.lancamento_previsto_resumo.interessado,
          data_vencimento: lanc.lancamento_previsto_resumo.data_vencimento,
          valor_previsto: lanc.lancamento_previsto_resumo.valor_previsto,
        });
      } else if (sugestaoOriginal === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_resumo) {
        const relatedIds = lanc.lancamentos_atrasados_ids || [];
        lanc.lancamentos_atrasados_resumo.forEach((atr) => {
          if (atr.id && relatedIds.includes(atr.id)) {
            initialAlocacoes.push({
              lancamento_id: atr.id,
              valor_alocado: relatedIds.length === 1 ? Math.abs(lanc.valor) : atr.valor_previsto,
              tipo_baixa: 'PRINCIPAL',
              descricao: atr.descricao,
              interessado: atr.interessado,
              data_vencimento: atr.data_vencimento,
              valor_previsto: atr.valor_previsto,
            });
          }
        });
      }

      return {
        ...lanc,
        plano_contas_id,
        entidade_id,
        interessado_digitado,
        criar_novo_interessado,
        auto_preenchido,
        interessado_sugerido: entidadeSugestaoTexto,
        sugestao_acao_original: sugestaoOriginal,
        sugestao_acao: lanc.sugestao_acao || sugestaoOriginal,
        lancamentos_atrasados_relacionados: sugestaoOriginal === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_ids ? lanc.lancamentos_atrasados_ids : [],
        sugestao_confirmada: false,
        alocacoes: initialAlocacoes,
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
    const cleanTerm = buscaDisponiveis.termo.trim().replace(/[^\d.,]/g, '').replace(',', '.');
    const termNum = cleanTerm ? parseFloat(cleanTerm) : NaN;

    const filtered = buscaDisponiveis.itens.filter((item) => {
      if (!buscaDisponiveis.termo.trim()) return true;
      const haystack = normalizarDescricao(`${item.descricao} ${item.interessado || ''}`);
      const matchesText = haystack.includes(termoBuscaDisponiveis);
      const matchesVal = !isNaN(termNum) && (
        Math.abs(item.valor_previsto - termNum) < 0.01 || 
        String(item.valor_previsto).includes(cleanTerm)
      );
      return matchesText || matchesVal;
    });

    const descMov = normalizarDescricao(lancamentoBuscaAberto.descricao);
    const wordsMov = descMov.split(' ').filter(w => w.length > 2);
    const movVal = Math.abs(lancamentoBuscaAberto.valor);

    return filtered.map(item => {
      const descItem = normalizarDescricao(item.descricao);
      const wordsItem = descItem.split(' ').filter(w => w.length > 2);
      let overlapCount = 0;
      wordsMov.forEach(w => {
        if (wordsItem.includes(w)) overlapCount++;
      });
      const textSimilarity = wordsMov.length > 0 ? (overlapCount / wordsMov.length) : 0;

      const diffVal = Math.abs(item.valor_previsto - movVal);
      const valueProximity = diffVal === 0 ? 1.0 : (1.0 / (1.0 + diffVal));

      const score = textSimilarity * 0.7 + valueProximity * 0.3;

      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item);
  }, [buscaDisponiveis.itens, buscaDisponiveis.termo, lancamentoBuscaAberto]);

  const itensExibidos = useMemo(() => {
    return itensDisponiveisFiltrados.slice(0, limiteResultados);
  }, [itensDisponiveisFiltrados, limiteResultados]);



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
    const linha = buscaDisponiveis.linhaArquivo;
    setBuscaDisponiveis((prev) => ({
      ...prev,
      linhaArquivo: null,
      termo: '',
      error: null,
      loading: false,
    }));
    if (linha != null) {
      scrollCardIntoView(linha);
    }
  };

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      {isDirectFlow ? (
        <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Conciliação de Extrato Bancário</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Revisando importação direta para:{' '}
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {contaSelecionada ? `${contaSelecionada.nome}${contaSelecionada.banco ? ` (${contaSelecionada.banco})` : ''}` : 'Conta selecionada'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(contaId ? `/contas?extrato_conta_id=${contaId}` : '/contas')}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-bold transition active:scale-95"
          >
            Cancelar e Voltar
          </button>
        </div>
      ) : (
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
      )}

      {feedback && (
        <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 text-sm shadow-sm ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300' : feedback.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'}`}>
          <div className="flex items-start gap-3">
            {feedback.type === 'success' ? <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          {feedback.conflitos && feedback.conflitos.length > 0 && (
            <ul className="mt-1 list-disc pl-8 space-y-1 font-semibold text-rose-600 dark:text-rose-300">
              {feedback.conflitos.map((c, idx) => (
                <li key={idx}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resultado?.gap_detectado && (
        <div className="flex items-start gap-4 rounded-3xl border border-amber-200 bg-amber-50/50 p-6 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-base font-black tracking-tight">Intervalo de Extrato Ausente (Gap de Datas)</h4>
            <p className="text-slate-600 dark:text-slate-300">
              Detectamos um intervalo de <span className="font-extrabold text-amber-700 dark:text-amber-300">{resultado.gap_dias} dia(s)</span> sem conciliação bancária entre o último movimento importado (<span className="font-bold">{formatDate(resultado.gap_data_ultimo)}</span>) e o início deste arquivo (<span className="font-bold">{formatDate(resultado.gap_data_inicio_arquivo)}</span>).
            </p>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              Recomenda-se importar o extrato do período ausente antes de prosseguir para garantir a consistência do saldo e evitar travas.
            </p>
          </div>
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
              const entidadeOptions: SearchableOption[] = [
                {
                  id: -1,
                  label: '+ Criar novo...',
                  searchText: '',
                },
                ...entidades.map((ent) => ({
                  id: ent.id,
                  label: ent.nome,
                  searchText: ent.nome,
                })),
              ];
              const valorClass = lanc.tipo === 'RECEITA' ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300';
              const descartado = lanc.sugestao_acao === 'DESCARTAR';
              const conciliacaoAutomatica = isConciliacaoAutomatica(lanc.sugestao_acao);
              const duplicadoAnterior = Boolean(lanc.duplicata_id || lanc.duplicata_resumo);
              const sugestaoPendente = !descartado && !duplicadoAnterior && conciliacaoAutomatica && !lanc.sugestao_confirmada;
              const conciliadoVisual = !descartado && !duplicadoAnterior && Boolean(lanc.sugestao_confirmada);
              const criarNovoVisual = !descartado && !duplicadoAnterior && !conciliadoVisual && !sugestaoPendente && lanc.sugestao_acao === 'CRIAR_NOVO';
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
                <article
                  id={`card-lancamento-${lanc.linha_arquivo}`}
                  key={`${lanc.linha_arquivo}-${lanc.movimento_uid || 'ofx'}`}
                  className={`rounded-3xl border p-3.5 shadow-sm transition ${descartado ? 'opacity-65' : ''} ${cardToneClass}`}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3 flex-1 min-w-0">
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
                        {linhaEditandoDescricao === lanc.linha_arquivo ? (
                          <input
                            type="text"
                            value={descricaoTemporaria}
                            onChange={(e) => setDescricaoTemporaria(e.target.value)}
                            onBlur={() => {
                              if (descricaoTemporaria.trim()) {
                                updateLancamento(lanc.linha_arquivo, { descricao: descricaoTemporaria.trim() });
                              }
                              setLinhaEditandoDescricao(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (descricaoTemporaria.trim()) {
                                  updateLancamento(lanc.linha_arquivo, { descricao: descricaoTemporaria.trim() });
                                }
                                setLinhaEditandoDescricao(null);
                              } else if (e.key === 'Escape') {
                                setLinhaEditandoDescricao(null);
                              }
                            }}
                            autoFocus
                            className="w-full rounded-2xl border border-emerald-400 bg-white px-3 py-1.5 text-lg font-black text-slate-900 outline-none dark:bg-slate-950 dark:text-white focus:ring-1 focus:ring-emerald-400"
                          />
                        ) : (
                          <h3
                            onDoubleClick={() => {
                              setLinhaEditandoDescricao(lanc.linha_arquivo);
                              setDescricaoTemporaria(lanc.descricao);
                            }}
                            title="Clique duas vezes para editar a descrição"
                            className="text-lg font-black text-slate-900 dark:text-white cursor-pointer hover:text-emerald-500 dark:hover:text-emerald-400 transition flex flex-wrap items-center gap-2 group"
                          >
                            {lanc.descricao}
                            <span className="hidden group-hover:inline text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-500/80">
                              (Duplo clique para editar)
                            </span>
                          </h3>
                        )}
                        {lanc.razao_social ? (
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {lanc.razao_social}
                          </p>
                        ) : null}
                      </div>

                      {mostrarMotivoConciliacao ? (
                        <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{motivoConciliacao}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {descartado ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const originalSug = lanc.sugestao_acao_original;
                                const originalAloc: AlocacaoItemUI[] = [];
                                if (originalSug === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_id && lanc.lancamento_previsto_resumo) {
                                  originalAloc.push({
                                    lancamento_id: lanc.lancamento_previsto_id,
                                    valor_alocado: Math.abs(lanc.valor),
                                    tipo_baixa: 'PRINCIPAL',
                                    descricao: lanc.lancamento_previsto_resumo.descricao,
                                    data_vencimento: lanc.lancamento_previsto_resumo.data_vencimento,
                                    valor_previsto: lanc.lancamento_previsto_resumo.valor_previsto,
                                  });
                                } else if (originalSug === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_resumo) {
                                  lanc.lancamentos_atrasados_resumo.forEach(atr => {
                                    if (atr.id && lanc.lancamentos_atrasados_ids?.includes(atr.id)) {
                                      originalAloc.push({
                                        lancamento_id: atr.id,
                                        valor_alocado: atr.valor_previsto,
                                        tipo_baixa: 'PRINCIPAL',
                                        descricao: atr.descricao,
                                        data_vencimento: atr.data_vencimento,
                                        valor_previsto: atr.valor_previsto,
                                      });
                                    }
                                  });
                                }
                                updateLancamento(lanc.linha_arquivo, {
                                  sugestao_acao: originalSug,
                                  lancamentos_atrasados_relacionados: originalSug === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_ids ? lanc.lancamentos_atrasados_ids : [],
                                  sugestao_confirmada: false,
                                  alocacoes: originalAloc,
                                });
                                scrollCardIntoView(lanc.linha_arquivo);
                              }}
                              className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              Retomar sugestão
                            </button>
                            {!lanc.duplicata_id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'CRIAR_NOVO', lancamentos_atrasados_relacionados: [], alocacoes: [] });
                                  scrollCardIntoView(lanc.linha_arquivo);
                                }}
                                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'CRIAR_NOVO' ? 'border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/35 dark:text-lime-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                              >
                                Criar novo
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {!duplicadoAnterior && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'RELACIONAR_ATRASADOS', sugestao_confirmada: false, lancamentos_atrasados_relacionados: [], alocacoes: [] });
                                  abrirBuscaDisponiveis(lanc);
                                  scrollCardIntoView(lanc.linha_arquivo);
                                }}
                                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                              >
                                Relacionar lançamentos
                              </button>
                            )}
                            {!lanc.duplicata_id && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'CRIAR_NOVO', lancamentos_atrasados_relacionados: [], alocacoes: [] });
                                  scrollCardIntoView(lanc.linha_arquivo);
                                }}
                                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] transition ${lanc.sugestao_acao === 'CRIAR_NOVO' ? 'border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/35 dark:text-lime-300' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'}`}
                              >
                                Criar novo
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                updateLancamento(lanc.linha_arquivo, { sugestao_acao: 'DESCARTAR', lancamentos_atrasados_relacionados: [], alocacoes: [] });
                                scrollCardIntoView(lanc.linha_arquivo);
                              }}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Ignorar sugestao
                            </button>
                            {sugestaoPendente && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateLancamento(lanc.linha_arquivo, { sugestao_confirmada: true });
                                  if (buscaDisponiveis.linhaArquivo === lanc.linha_arquivo) {
                                    setBuscaDisponiveis((prev) => ({
                                      ...prev,
                                      linhaArquivo: null,
                                      itens: [],
                                    }));
                                  }
                                  scrollCardIntoView(lanc.linha_arquivo);
                                }}
                                className="rounded-full border border-emerald-400 bg-emerald-500 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white transition hover:bg-emerald-600"
                              >
                                Confirma sugestao
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Data</span>
                        <p className="text-sm font-black text-slate-700 dark:text-slate-300">{formatDate(lanc.data)}</p>
                      </div>
                      <div className="min-w-44 rounded-[22px] border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          <Landmark className="h-3.5 w-3.5" />
                          Movimento
                        </div>
                        <p className={`mt-1 text-xl font-black ${valorClass}`}>{formatCurrency(Number(lanc.valor || 0))}</p>
                      </div>
                    </div>
                  </div>

                  {lanc.duplicata_resumo && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-4 text-sm text-slate-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-slate-300">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-slate-800 dark:text-white">Alerta de Duplicidade / Auditoria</p>
                            <span className="px-1.5 py-0.5 text-[9px] font-black tracking-wider uppercase rounded bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              Auditor de Anomalias
                            </span>
                          </div>
                          <p className="mt-1 text-slate-600 dark:text-slate-300 text-xs">
                            Já existe um lançamento equivalente para esta conta. Nosso motor de auditoria de segurança detectou um possível movimento duplicado.
                          </p>
                          <div className="mt-2.5 pl-3 border-l-2 border-amber-300 dark:border-amber-700 text-xs">
                            <p className="font-semibold text-slate-700 dark:text-slate-200">{lanc.duplicata_resumo.descricao}</p>
                            <p className="text-slate-500 dark:text-slate-400 mt-0.5">{lanc.duplicata_resumo.motivo || 'Movimento repetido.'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}




                  {modoImportacao === 'CONTA' && (lanc.sugestao_acao === 'BAIXAR_PREVISTO' || lanc.sugestao_acao === 'RELACIONAR_ATRASADOS') && (
                    <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-950/30 backdrop-blur-sm space-y-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Alocações / Liquidação Financeira</p>
                        <p className="mt-1 text-xs text-slate-500">Especifique o valor alocado e o tipo de baixa para cada título.</p>
                      </div>

                      {(() => {
                        const currentAlocs = lanc.alocacoes || [];
                        let displayedAlocs = currentAlocs;
                        if (displayedAlocs.length === 0) {
                          if (lanc.sugestao_acao === 'BAIXAR_PREVISTO' && lanc.lancamento_previsto_id) {
                            displayedAlocs = [{
                              lancamento_id: lanc.lancamento_previsto_id,
                              valor_alocado: Math.abs(lanc.valor),
                              tipo_baixa: 'PRINCIPAL',
                              descricao: lanc.lancamento_previsto_resumo?.descricao,
                              interessado: lanc.lancamento_previsto_resumo?.interessado,
                              data_vencimento: lanc.lancamento_previsto_resumo?.data_vencimento,
                              valor_previsto: lanc.lancamento_previsto_resumo?.valor_previsto,
                            }];
                          } else if (lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' && lanc.lancamentos_atrasados_relacionados) {
                            const relatedIds = lanc.lancamentos_atrasados_relacionados;
                            displayedAlocs = relatedIds.map((id) => {
                              const res = lanc.lancamentos_atrasados_resumo?.find((r) => r.id === id);
                              return {
                                lancamento_id: id,
                                valor_alocado: relatedIds.length === 1 ? Math.abs(lanc.valor) : (res?.valor_previsto ?? Math.abs(lanc.valor)),
                                tipo_baixa: 'PRINCIPAL',
                                descricao: res?.descricao,
                                interessado: res?.interessado,
                                data_vencimento: res?.data_vencimento,
                                valor_previsto: res?.valor_previsto,
                              };
                            });
                          }
                        }

                        const handleUpdateAloc = (alocId: number, patch: Partial<AlocacaoItemUI>) => {
                          const nextAlocs = displayedAlocs.map((a) => {
                            if (a.lancamento_id === alocId) {
                              const updated = { ...a, ...patch };
                              if (patch.valor_alocado !== undefined && patch.valor_alocado !== a.valor_alocado) {
                                delete (updated as any).decisao_excedido;
                              }
                              return updated;
                            }
                            return a;
                          });
                          updateLancamento(lanc.linha_arquivo, { alocacoes: nextAlocs });
                        };

                        const handleRemoveAloc = (alocId: number) => {
                          const nextAlocs = displayedAlocs.filter((a) => a.lancamento_id !== alocId);
                          const nextAtrasados = (lanc.lancamentos_atrasados_relacionados || []).filter((id) => id !== alocId);
                          const nextResumo = (lanc.lancamentos_atrasados_resumo || []).filter((r) => r.id !== alocId);
                          const nextPrevistoId = lanc.lancamento_previsto_id === alocId ? null : lanc.lancamento_previsto_id;
                          const nextPrevistoResumo = lanc.lancamento_previsto_id === alocId ? null : lanc.lancamento_previsto_resumo;
                          
                          updateLancamento(lanc.linha_arquivo, {
                            alocacoes: nextAlocs,
                            lancamentos_atrasados_relacionados: nextAtrasados,
                            lancamentos_atrasados_resumo: nextResumo,
                            lancamento_previsto_id: nextPrevistoId,
                            lancamento_previsto_resumo: nextPrevistoResumo,
                          });
                        };

                        let totalAlocado = 0;
                        displayedAlocs.forEach((aloc) => {
                          const val = Number(aloc.valor_alocado || 0);
                          if (aloc.tipo_baixa === 'DESCONTO') {
                            totalAlocado -= val;
                          } else {
                            totalAlocado += val;
                          }
                        });
                        const diffVal = Number((Math.abs(lanc.valor) - totalAlocado).toFixed(2));

                        return (
                          <div className="space-y-3">
                            {displayedAlocs.length === 0 ? (
                              <p className="text-xs italic text-slate-500 py-2">Nenhum lançamento alocado. Selecione lançamentos na busca abaixo.</p>
                            ) : (
                              <>
                                {displayedAlocs.map((aloc) => (
                                  <div key={aloc.lancamento_id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 md:flex-row md:items-center md:justify-between">
                                    <div className="min-w-0 flex-1">
                                      {aloc.interessado && (
                                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                          {aloc.interessado}
                                        </p>
                                      )}
                                      <p className="font-bold text-slate-900 dark:text-white truncate">{aloc.descricao || `Lançamento #${aloc.lancamento_id}`}</p>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                        <span>Previsto: {formatCurrency(aloc.valor_previsto || 0)}</span>
                                      </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap items-center gap-3 shrink-0">
                                      <div className="text-right mr-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Vencimento</span>
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-300">{formatDate(aloc.data_vencimento)}</p>
                                      </div>
                                      
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase">R$</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={aloc.valor_alocado}
                                          onChange={(e) => handleUpdateAloc(aloc.lancamento_id!, { valor_alocado: Number(e.target.value) })}
                                          className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                                        />
                                      </div>
                                      
                                      <button
                                        type="button"
                                        onClick={() => handleEditarLancamentoExistente(lanc.linha_arquivo, aloc.lancamento_id!)}
                                        className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition mr-1"
                                        title="Editar lançamento"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveAloc(aloc.lancamento_id!)}
                                        className="rounded-xl p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition"
                                        title="Remover alocação"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}

                                {displayedAlocs.length === 1 && (() => {
                                  const aloc = displayedAlocs[0];
                                  const diff = Number((aloc.valor_alocado - (aloc.valor_previsto || 0)).toFixed(2));
                                  if (diff !== 0 && aloc.decisao_excedido !== 'MANTER') {
                                    const isExcedido = diff > 0;
                                    return (
                                      <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-950/10 space-y-3">
                                        <div className="flex items-start gap-2.5">
                                          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                                          <div className="flex-1">
                                            <h4 className="font-extrabold text-sm text-amber-800 dark:text-amber-300">
                                              {isExcedido ? 'Valor Alocado Excede o Previsto' : 'Valor Alocado é Menor que o Previsto'}
                                            </h4>
                                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                              O valor da movimentação ({formatCurrency(aloc.valor_alocado)}) é {isExcedido ? 'maior' : 'menor'} que o valor previsto original do título ({formatCurrency(aloc.valor_previsto || 0)}). Como deseja ajustar?
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          <button
                                            type="button"
                                            onClick={() => handleAjustarVencimento(lanc.linha_arquivo, aloc.lancamento_id!, aloc.valor_alocado)}
                                            className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] transition text-xs font-bold text-white shadow-sm"
                                          >
                                            Ajustar valor do lançamento para {formatCurrency(aloc.valor_alocado)}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleManterPrevisto(lanc.linha_arquivo, aloc.lancamento_id!)}
                                            className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 dark:bg-slate-950 dark:border-slate-800 dark:hover:bg-slate-900 dark:text-slate-300 transition text-xs font-bold shadow-sm"
                                          >
                                            {isExcedido ? 'Manter previsto e pagar com valor maior (juros/multa)' : 'Manter previsto e pagar valor menor (parcial)'}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </>
                            )}

                            {/* Totalizer */}
                            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200/60 pt-4 dark:border-slate-800/40">
                              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                <span>Movimento: <strong className="text-slate-900 dark:text-white">{formatCurrency(Math.abs(lanc.valor))}</strong></span>
                                <span>Alocado: <strong className="text-slate-900 dark:text-white">{formatCurrency(totalAlocado)}</strong></span>
                              </div>
                              
                              <div>
                                {diffVal === 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <Check className="h-3 w-3" />
                                    Alocação completa
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${diffVal > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                                      <AlertTriangle className="h-3 w-3" />
                                      {diffVal > 0 ? `Falta alocar: ${formatCurrency(diffVal)}` : `Excedido em: ${formatCurrency(Math.abs(diffVal))}`}
                                    </span>
                                    {diffVal > 0 && displayedAlocs.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleAbrirFormJurosMulta(lanc, diffVal)}
                                        className="inline-flex items-center gap-1 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm transition"
                                      >
                                        Lançar Diferença
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Checklist search trigger / available launches */}
                            <div className="mt-4 border-t border-slate-200/60 pt-4 dark:border-slate-800/40">
                              {buscaDisponiveis.linhaArquivo === lanc.linha_arquivo ? (
                                <div className="space-y-4">
                                  <div className="grid gap-3 p-3 rounded-2xl bg-amber-100/30 dark:bg-slate-900/30 border border-amber-200/30 dark:border-slate-800">
                                    <div className="flex flex-col md:flex-row md:items-end gap-3">
                                      <div className="flex-1">
                                        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Filtrar descrição / interessado</label>
                                        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                                          <Search className="h-4 w-4 text-slate-400" />
                                          <input
                                            value={buscaDisponiveis.termo}
                                            onChange={(event) => setBuscaDisponiveis((prev) => ({ ...prev, termo: event.target.value }))}
                                            placeholder="Ex: Nome, NF, descrição..."
                                            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 text-slate-800 dark:text-white"
                                          />
                                        </div>
                                      </div>

                                      <div className="w-full md:w-64">
                                        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Centro de custo</label>
                                        <select
                                          value={buscaDisponiveis.centroCustoId ?? ''}
                                          onChange={(event) => {
                                            const centroId = event.target.value ? Number(event.target.value) : null;
                                            setBuscaDisponiveis((prev) => ({ ...prev, centroCustoId: centroId }));
                                            carregarLancamentosDisponiveis(lanc, buscaDisponiveis.incluirFuturos, centroId);
                                          }}
                                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                                        >
                                          <option value="">Sem centro de custo</option>
                                          {centrosCusto.map((centro) => (
                                            <option key={centro.id} value={centro.id}>
                                              {centro.nome}
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="flex items-center">
                                        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 transition">
                                          <input
                                            type="checkbox"
                                            checked={buscaDisponiveis.incluirFuturos}
                                            onChange={(event) => {
                                              const incluir = event.target.checked;
                                              setBuscaDisponiveis((prev) => ({ ...prev, incluirFuturos: incluir }));
                                              carregarLancamentosDisponiveis(lanc, incluir, buscaDisponiveis.centroCustoId);
                                            }}
                                          />
                                          Incluir futuros
                                        </label>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                    {buscaDisponiveis.loading ? (
                                      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                                        Buscando lançamentos...
                                      </div>
                                    ) : itensExibidos.length === 0 ? (
                                      <p className="text-sm text-slate-500 italic py-2">Nenhum lançamento encontrado para os filtros informados.</p>
                                    ) : (
                                      itensExibidos.map((atrasado) => {
                                        const atrId = atrasado.id;
                                        const marcado = atrId != null && displayedAlocs.some((a) => a.lancamento_id === atrId);
                                        const outros = atrId ? obterOutrosLancamentosComSelecao(atrId, lanc.linha_arquivo) : [];
                                        const selecionadoEmOutro = outros.length > 0;

                                        return (
                                          <label
                                            key={`candidate-${lanc.linha_arquivo}-${atrId}`}
                                            className={`flex items-start gap-3 rounded-2xl border p-3 bg-white/80 dark:bg-slate-900/60 transition cursor-pointer ${selecionadoEmOutro ? 'border-rose-200 hover:bg-rose-50/10 dark:border-rose-950/40' : marcado ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50/50'}`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={marcado}
                                              className="mt-1"
                                              onChange={(e) => {
                                                if (!atrId) return;
                                                if (e.target.checked && selecionadoEmOutro) {
                                                  setTransferenciaConfirmacao({
                                                    linhaArquivo: lanc.linha_arquivo,
                                                    atrasoId: atrId,
                                                    atrasado,
                                                    outrasLinhas: outros.map((o) => o.linha_arquivo),
                                                  });
                                                } else {
                                                  const proximoIds = e.target.checked
                                                    ? [...(lanc.lancamentos_atrasados_relacionados || []), atrId]
                                                    : (lanc.lancamentos_atrasados_relacionados || []).filter((id) => id !== atrId);
                                                  
                                                  const res = 'score' in atrasado ? (atrasado as RelacionamentoResumo) : mapDisponivelToResumo(atrasado as LancamentoDisponivel, 'Selecionado manualmente');
                                                  const proximoResumos = e.target.checked
                                                    ? [...(lanc.lancamentos_atrasados_resumo || []), res]
                                                    : (lanc.lancamentos_atrasados_resumo || []).filter((r) => r.id !== atrId);
                                                  
                                                  const proximoAlocs = e.target.checked
                                                    ? [
                                                        ...currentAlocs,
                                                        {
                                                          lancamento_id: atrId,
                                                          valor_alocado: res.valor_previsto,
                                                          tipo_baixa: 'PRINCIPAL' as const,
                                                          descricao: res.descricao,
                                                          interessado: res.interessado,
                                                          data_vencimento: res.data_vencimento,
                                                          valor_previsto: res.valor_previsto,
                                                        }
                                                      ]
                                                    : currentAlocs.filter((a) => a.lancamento_id !== atrId);

                                                  updateLancamento(lanc.linha_arquivo, {
                                                    lancamentos_atrasados_relacionados: proximoIds,
                                                    lancamentos_atrasados_resumo: proximoResumos,
                                                    alocacoes: proximoAlocs,
                                                  });
                                                }
                                              }}
                                            />
                                            
                                            <div className="flex flex-1 items-start justify-between gap-4 min-w-0">
                                              <div className="min-w-0 flex-1">
                                                {atrasado.interessado && <p className="text-xs font-bold text-slate-950 dark:text-white">Interessado: {atrasado.interessado}</p>}
                                                <p className="font-bold text-slate-900 dark:text-white break-words">{atrasado.descricao}</p>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                  <span>Vence em {formatDate(atrasado.data_vencimento)}</span>
                                                </div>
                                                {selecionadoEmOutro && (
                                                  <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
                                                    Selecionado em outra movimentação.
                                                  </p>
                                                )}
                                              </div>
                                              <div className="text-right shrink-0">
                                                <p className="text-sm font-black text-slate-900 dark:text-white">{formatCurrency('valor_previsto' in atrasado ? (atrasado as any).valor_previsto : (atrasado as any).valor)}</p>
                                              </div>
                                            </div>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>

                                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/40">
                                    {itensDisponiveisFiltrados.length > limiteResultados && (
                                      <button
                                        type="button"
                                        onClick={() => setLimiteResultados((prev) => prev + 15)}
                                        className="rounded-full bg-emerald-500 hover:bg-emerald-600 px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-950"
                                      >
                                        Carregar mais (+15)
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={fecharBuscaDisponiveis}
                                      className="rounded-full border border-slate-300 bg-white hover:bg-slate-100 px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-700"
                                    >
                                      Recolher busca
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => abrirBuscaDisponiveis(lanc)}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 transition"
                                >
                                  + Buscar e vincular outros lançamentos previstos
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {modoImportacao === 'CARTAO' && lanc.sugestao_acao === 'RELACIONAR_ATRASADOS' && (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b border-amber-200/40 pb-3 mb-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Atrasados compatíveis</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Selecione os atrasados que este movimento deve quitar.</p>
                        </div>
                      </div>

                      {lanc.sugestao_confirmada ? (
                        <div className="space-y-3">
                          {(() => {
                            const selecionados = (lanc.lancamentos_atrasados_resumo || [])
                              .filter((r) => r.id != null && lanc.lancamentos_atrasados_relacionados?.includes(r.id));
                            if (selecionados.length === 0) {
                              return (
                                <p className="text-xs italic text-slate-500">Nenhum lançamento selecionado.</p>
                              );
                            }
                            return selecionados.map((atrasado, index) => (
                              <div
                                key={`confirmed-${lanc.linha_arquivo}-${atrasado.id}-${index}`}
                                className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-300 bg-emerald-50/50 p-3 dark:border-emerald-800/40 dark:bg-slate-900/40"
                              >
                                <div className="min-w-0 flex-1">
                                  {atrasado.interessado ? (
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">Interessado: {atrasado.interessado}</p>
                                  ) : null}
                                  <p className="font-bold text-slate-900 dark:text-white">{atrasado.descricao}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span>Venceu em {formatDate(atrasado.data_vencimento)}</span>
                                    {atrasado.centro_custo_nome ? (
                                      <>
                                        <span>•</span>
                                        <span>CC: {atrasado.centro_custo_nome}</span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-base font-black text-emerald-700 dark:text-emerald-300">
                                    {formatCurrency(atrasado.valor_previsto)}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Uncheck item: set confirm to false, remove item
                                      const proximoIds = (lanc.lancamentos_atrasados_relacionados || []).filter((id) => id !== atrasado.id);
                                      const proximoResumos = (lanc.lancamentos_atrasados_resumo || []).filter((r) => r.id !== atrasado.id);
                                      updateLancamento(lanc.linha_arquivo, {
                                        lancamentos_atrasados_relacionados: proximoIds,
                                        lancamentos_atrasados_resumo: proximoResumos,
                                        sugestao_confirmada: false,
                                      });
                                      abrirBuscaDisponiveis(lanc);
                                      scrollCardIntoView(lanc.linha_arquivo);
                                    }}
                                    className="mt-2 text-xs font-bold uppercase tracking-wider text-rose-600 hover:text-rose-700 transition"
                                  >
                                    Desassociar
                                  </button>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      ) : (
                        /* Edit mode: show search filters and candidates list */
                        <div className="space-y-4">
                          {/* Search & Filter Inputs (rendered inline when this card is active for search) */}
                          {buscaDisponiveis.linhaArquivo === lanc.linha_arquivo ? (
                            <div className="grid gap-3 p-3 rounded-2xl bg-amber-100/40 dark:bg-slate-950/20 border border-amber-200/50">
                              <div className="flex flex-col md:flex-row md:items-end gap-3">
                                <div className="flex-1">
                                  <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Filtrar descrição / interessado</label>
                                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950">
                                    <Search className="h-4 w-4 text-slate-400" />
                                    <input
                                      value={buscaDisponiveis.termo}
                                      onChange={(event) => setBuscaDisponiveis((prev) => ({ ...prev, termo: event.target.value }))}
                                      placeholder="Ex: Nome, NF, descrição..."
                                      className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 text-slate-850 dark:text-white"
                                    />
                                  </div>
                                </div>

                                <div className="w-full md:w-64">
                                  <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">Centro de custo</label>
                                  <select
                                    value={buscaDisponiveis.centroCustoId ?? ''}
                                    onChange={(event) => {
                                      const centroId = event.target.value ? Number(event.target.value) : null;
                                      setBuscaDisponiveis((prev) => ({ ...prev, centroCustoId: centroId }));
                                      carregarLancamentosDisponiveis(lanc, buscaDisponiveis.incluirFuturos, centroId);
                                    }}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                                  >
                                    <option value="">Sem centro de custo</option>
                                    {centrosCusto.map((centro) => (
                                      <option key={centro.id} value={centro.id}>
                                        {centro.nome}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="flex items-center">
                                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 transition">
                                    <input
                                      type="checkbox"
                                      checked={buscaDisponiveis.incluirFuturos}
                                      onChange={(event) => {
                                        const incluir = event.target.checked;
                                        setBuscaDisponiveis((prev) => ({ ...prev, incluirFuturos: incluir }));
                                        carregarLancamentosDisponiveis(lanc, incluir, buscaDisponiveis.centroCustoId);
                                      }}
                                    />
                                    Incluir futuros
                                  </label>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {/* Candidates checklist */}
                          <div className="space-y-3">
                            {(() => {
                              // If this card is active for search, use search results. Otherwise, use backend suggested list.
                              const isSearchActive = buscaDisponiveis.linhaArquivo === lanc.linha_arquivo;
                              
                              if (isSearchActive && buscaDisponiveis.loading) {
                                return (
                                  <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                                    <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                                    Buscando lançamentos...
                                  </div>
                                );
                              }

                              const listToRender = isSearchActive 
                                ? itensExibidos 
                                : (lanc.lancamentos_atrasados_resumo || []).slice(0, 5); // display up to 5 initial suggestions

                              if (listToRender.length === 0) {
                                return (
                                  <p className="text-sm text-slate-500 italic py-2">
                                    {isSearchActive 
                                      ? "Nenhum lançamento encontrado para os filtros informados." 
                                      : "Nenhum lançamento compatível sugerido."}
                                  </p>
                                );
                              }

                              return listToRender.map((atrasado, index) => {
                                const atrasoId = atrasado.id;
                                const marcado = atrasoId != null && lanc.lancamentos_atrasados_relacionados?.includes(atrasoId);
                                const outros = atrasoId ? obterOutrosLancamentosComSelecao(atrasoId, lanc.linha_arquivo) : [];
                                const selecionadoEmOutroLancamento = outros.length > 0;

                                return (
                                  <label
                                    key={`candidate-${lanc.linha_arquivo}-${atrasoId}-${index}`}
                                    className={`flex items-start gap-3 rounded-2xl border bg-white/80 p-3 dark:bg-slate-900/60 transition duration-150 cursor-pointer ${selecionadoEmOutroLancamento ? 'border-rose-200 hover:bg-rose-50/10 dark:border-rose-950/40' : marcado ? 'border-emerald-300 bg-emerald-50/30' : 'border-amber-200/50 hover:bg-amber-50/40 dark:border-amber-900/40'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={marcado}
                                      className="mt-1"
                                      onChange={(e) => {
                                        if (!atrasoId) return;
                                        if (e.target.checked && selecionadoEmOutroLancamento) {
                                          setTransferenciaConfirmacao({
                                            linhaArquivo: lanc.linha_arquivo,
                                            atrasoId,
                                            atrasado,
                                            outrasLinhas: outros.map((o) => o.linha_arquivo),
                                          });
                                        } else {
                                          const proximoIds = e.target.checked
                                            ? [...(lanc.lancamentos_atrasados_relacionados || []), atrasoId]
                                            : (lanc.lancamentos_atrasados_relacionados || []).filter((id) => id !== atrasoId);
                                          
                                          const resumo = 'score' in atrasado ? (atrasado as RelacionamentoResumo) : mapDisponivelToResumo(atrasado as LancamentoDisponivel, 'Selecionado manualmente');
                                          const proximoResumos = e.target.checked
                                            ? [...(lanc.lancamentos_atrasados_resumo || []), resumo]
                                            : (lanc.lancamentos_atrasados_resumo || []).filter((r) => r.id !== atrasoId);

                                          updateLancamento(lanc.linha_arquivo, {
                                            lancamentos_atrasados_relacionados: proximoIds,
                                            lancamentos_atrasados_resumo: proximoResumos,
                                          });
                                        }
                                      }}
                                    />
                                    
                                    <div className="flex flex-1 items-start justify-between gap-4 min-w-0">
                                      <div className="min-w-0 flex-1">
                                        {atrasado.interessado ? (
                                          <p className="text-xs font-bold text-slate-950 dark:text-white">Interessado: {atrasado.interessado}</p>
                                        ) : null}
                                        <p className="font-bold text-slate-900 dark:text-white break-words">{atrasado.descricao}</p>
                                        
                                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                                            Score {'score' in atrasado ? atrasado.score : 100}
                                          </span>
                                          <span>Vence em {formatDate(atrasado.data_vencimento)}</span>
                                          {atrasado.centro_custo_nome ? (
                                            <>
                                              <span>•</span>
                                              <span>CC: {atrasado.centro_custo_nome}</span>
                                            </>
                                          ) : null}
                                        </div>

                                        {'motivo' in atrasado && (atrasado as any).motivo ? (
                                          <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">{(atrasado as any).motivo}</p>
                                        ) : null}

                                        {selecionadoEmOutroLancamento ? (
                                          <p className="mt-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                                            Este lançamento está selecionado em outra movimentação. Selecionar aqui irá desassociá-lo de lá.
                                          </p>
                                        ) : null}
                                      </div>

                                      <div className="text-right shrink-0">
                                        <p className="text-base font-black text-amber-700 dark:text-amber-400">
                                          {formatCurrency('valor_previsto' in atrasado ? (atrasado as any).valor_previsto : (atrasado as any).valor)}
                                        </p>
                                      </div>
                                    </div>
                                  </label>
                                );
                              });
                            })()}
                          </div>

                          {/* Footer Action buttons: Listar todos, Carregar mais, Fechar */}
                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-amber-200/40">
                            {(() => {
                              const isSearchActive = buscaDisponiveis.linhaArquivo === lanc.linha_arquivo;
                              const selecionadosCount = lanc.lancamentos_atrasados_relacionados?.length || 0;
                              return (
                                <>
                                  <p className="text-xs font-bold text-slate-500">
                                    {selecionadosCount} lançamento(s) selecionado(s) para conciliar.
                                  </p>

                                  <div className="flex gap-2">
                                    {isSearchActive ? (
                                      <>
                                        {itensDisponiveisFiltrados.length > limiteResultados && (
                                          <button
                                            type="button"
                                            onClick={() => setLimiteResultados((prev) => prev + 15)}
                                            className="rounded-full bg-amber-500 hover:bg-amber-600 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950 transition"
                                          >
                                            Carregar mais (+15)
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={fecharBuscaDisponiveis}
                                          className="rounded-full border border-slate-300 bg-white hover:bg-slate-100 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-700 transition"
                                        >
                                          Recolher busca
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          abrirBuscaDisponiveis(lanc);
                                          scrollCardIntoView(lanc.linha_arquivo);
                                        }}
                                        className="rounded-full bg-amber-500 hover:bg-amber-600 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950 transition"
                                      >
                                        Listar todos os lançamentos
                                      </button>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}
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
                        {lanc.criar_novo_interessado ? (
                          <div className="relative flex items-center">
                            <input
                              type="text"
                              value={lanc.interessado_digitado || ''}
                              onChange={(e) => updateLancamento(lanc.linha_arquivo, { interessado_digitado: e.target.value })}
                              placeholder="Digite o nome do novo interessado..."
                              className="w-full rounded-2xl border border-emerald-400 bg-white pl-4 pr-24 py-3 text-sm outline-none transition dark:border-emerald-700 dark:bg-slate-950 dark:text-white focus:ring-1 focus:ring-emerald-400"
                              autoFocus
                            />
                            <span className="absolute right-12 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg pointer-events-none">
                              Novo
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                updateLancamento(lanc.linha_arquivo, { criar_novo_interessado: false, interessado_digitado: '' });
                              }}
                              className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              title="Voltar para seleção"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <SearchableDropdown
                            value={lanc.entidade_id}
                            options={entidadeOptions}
                            placeholder="Sem interessado"
                            onChange={(value, query) => {
                              if (value === -1) {
                                updateLancamento(lanc.linha_arquivo, {
                                  criar_novo_interessado: true,
                                  entidade_id: null,
                                  interessado_digitado: query || lanc.interessado_sugerido || '',
                                });
                              } else {
                                updateLancamento(lanc.linha_arquivo, {
                                  entidade_id: value,
                                  criar_novo_interessado: false,
                                });
                              }
                            }}
                          />
                        )}
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
              <div className="space-y-2.5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Resumo para confirmação</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{lancamentosEditados.length} item(ns) analisados. {resumo.semCategoria === 0 ? 'Os novos lançamentos já têm categoria.' : `${resumo.semCategoria} novo(s) ainda exigem categoria.`}</p>
                </div>

              </div>
              <button
                onClick={() => handleConfirmar()}
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
      {transferenciaConfirmacao && (() => {
        const { atrasado, outrasLinhas } = transferenciaConfirmacao;
        const conflitosText = outrasLinhas.map(linha => {
          const l = lancamentosEditados.find(item => item.linha_arquivo === linha);
          return l ? `Movimento: "${l.descricao}" (${formatCurrency(l.valor)})` : `Linha ${linha}`;
        });

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md">
            <div className="w-full max-w-lg scale-95 transform rounded-[32px] border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900/95 transition-all">
              {/* Header */}
              <div className="flex items-center gap-3.5 text-amber-500 dark:text-amber-400 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Conflito de Seleção</h3>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-500">Este lançamento já possui vínculo</p>
                </div>
              </div>

              {/* Conflict details */}
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Lançamento Selecionado</p>
                  <p className="mt-1.5 font-extrabold text-slate-800 dark:text-slate-200">{atrasado.descricao}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>Vencimento: <strong className="text-slate-700 dark:text-slate-300">{formatDate((atrasado as any).data_vencimento)}</strong></span>
                    <span>Valor total: <strong className="text-slate-700 dark:text-slate-300">{formatCurrency((atrasado as any).valor_previsto)}</strong></span>
                  </div>
                </div>

                {/* Associations */}
                <div className="rounded-2xl border border-rose-100/50 bg-rose-50/20 p-4 dark:border-rose-950/10 dark:bg-rose-950/5">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-rose-600 dark:text-rose-400">Atualmente vinculado em:</p>
                  <ul className="mt-2 space-y-2">
                    {conflitosText.map((txt, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 font-medium">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        <span>{txt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 mb-3">Escolha como deseja prosseguir:</p>
                  
                  <div className="space-y-2.5">
                    {/* Option 1: Ratear */}
                    <button
                      type="button"
                      onClick={confirmarRateio}
                      className="w-full flex items-center gap-4 rounded-2xl border border-amber-200 bg-amber-50/20 p-3.5 text-left transition hover:bg-amber-100/30 hover:border-amber-300 active:scale-[0.99] dark:border-amber-900/30 dark:bg-amber-950/5 dark:hover:bg-amber-950/20 dark:hover:border-amber-700"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <Layers className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white">Vincular a ambos (Ratear)</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Associa o lançamento a ambos os movimentos e distribui os saldos automaticamente.</p>
                      </div>
                    </button>

                    {/* Option 2: Transferir */}
                    <button
                      type="button"
                      onClick={confirmarTransferencia}
                      className="w-full flex items-center gap-4 rounded-2xl border border-rose-200 bg-rose-50/25 p-3.5 text-left transition hover:bg-rose-100/30 hover:border-rose-300 active:scale-[0.99] dark:border-rose-900/30 dark:bg-rose-950/5 dark:hover:bg-rose-950/25 dark:hover:border-rose-700"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                        <RefreshCw className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white">Transferir lançamento totalmente</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Associa exclusivamente a este movimento, removendo o vínculo de outras movimentações.</p>
                      </div>
                    </button>

                    {/* Option 3: Cancelar */}
                    <button
                      type="button"
                      onClick={() => setTransferenciaConfirmacao(null)}
                      className="w-full flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950/10 dark:hover:bg-slate-900/60 dark:hover:border-slate-700"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        <X className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white">Cancelar</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">Mantém as associações originais e fecha esta janela.</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {formDrawerConfig.show && (
        <LancamentoFormDrawer
          showDrawer={formDrawerConfig.show}
          onClose={() => setFormDrawerConfig({ show: false })}
          editarId={formDrawerConfig.editarId}
          prefilledData={formDrawerConfig.prefilledData}
          onSaveSuccess={handleFormDrawerSalvo}
          categorias={categorias}
          entidades={entidades}
          contas={contas}
          cartoes={cartoes}
          centros={centrosCusto}
        />
      )}
    </div>
  );
}
