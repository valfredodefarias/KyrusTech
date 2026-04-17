import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, normalizeListResponse } from '../services/api';
import { RefreshCw, Link as LinkIcon, Loader2, X, Plug, Save, Search, ChevronDown } from 'lucide-react';

interface Conta {
  id: number;
  nome: string;
  tipo?: string | null;
  status?: string | null;
  saldo_inicial?: number;
  saldo_atual?: number;
  banco?: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  centro_custo_id?: number | null;
  tipo_integracao?: string | null;
}


interface PlanoContas {
  id: number;
  nome: string;
  tipo: string;
  permite_lancamentos?: boolean;
}

interface IntegracaoBancaria {
  id: number;
  nome: string;
  tipo: string;
  ambiente: string;
  ativo: boolean;
  token_configurado?: boolean;
  ultima_sincronizacao?: string | null;
  data_inicio_sincronizacao?: string | null;
  conta_id?: number | null;
  centro_custo_id?: number | null;
}

interface TipoAsaas {
  codigo: string;
  descricao: string;
  natureza_sugerida?: 'RECEITA' | 'DESPESA' | 'AMBOS';
  mapeado?: boolean;
  categoria_mapeada?: string | null;
}

interface MapeamentoCategoria {
  id: number;
  categoria_externa: string;
  plano_contas_id: number;
}

interface CobrancaAsaas {
  id: string;
  customer?: string;
  description?: string;
  status?: string;
  dueDate?: string;
  value?: number;
}

interface AssinaturaAsaas {
  id: string;
  customer?: string;
  description?: string;
  status?: string;
  nextDueDate?: string;
  value?: number;
}

interface SaldoAsaasResumo {
  saldo_asaas: number;
  saldo_bloqueado: number;
  saldo_disponivel: number;
  atualizado_em?: string;
  conta_vinculada_id?: number | null;
  conta_vinculada_nome?: string | null;
}

interface UsuarioMe {
  email?: string;
}

const AUTHORIZED_ASAAS_RESET_EMAILS = ['cirocue12@gmail.com', 'cirocaue12@gmail.com'];

type NaturezaAsaas = 'RECEITA' | 'DESPESA' | 'AMBOS';

const normalizeSearchText = (value?: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const inferirNaturezaAsaas = (tipo: TipoAsaas): NaturezaAsaas => {
  const sugerida = String(tipo.natureza_sugerida || '').trim().toUpperCase();
  if (sugerida === 'RECEITA' || sugerida === 'DESPESA') {
    return sugerida as NaturezaAsaas;
  }

  const codigo = String(tipo.codigo || '').trim().toUpperCase();
  if (!codigo) return 'AMBOS';

  if (codigo.includes('REFUND') || codigo.includes('REVERSAL') || codigo.includes('CANCEL')) {
    return 'AMBOS';
  }
  if (codigo.endsWith('_CREDIT') || codigo.includes('PAYMENT_RECEIVED') || codigo.includes('CASHBACK')) {
    return 'RECEITA';
  }
  if (codigo.endsWith('_DEBIT') || codigo.includes('_FEE') || codigo === 'TRANSFER' || codigo === 'BILL_PAYMENT') {
    return 'DESPESA';
  }

  return 'AMBOS';
};

const categoriaCompativelComNatureza = (categoria: PlanoContas, natureza: NaturezaAsaas) => {
  if (natureza === 'AMBOS') return true;
  const tipoCategoria = String(categoria.tipo || '').trim().toUpperCase();
  if (natureza === 'RECEITA') return tipoCategoria.startsWith('R');
  return tipoCategoria.startsWith('D');
};

const extrairTokensSugestao = (tipo: TipoAsaas) => {
  const base = normalizeSearchText(`${tipo.codigo} ${tipo.descricao}`).replace(/_/g, ' ');
  const tokensBase = base
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);

  const tokens = new Set<string>(tokensBase);
  const codigo = String(tipo.codigo || '').toUpperCase();
  const descricao = normalizeSearchText(tipo.descricao);

  if (codigo.includes('PIX')) tokens.add('pix');
  if (codigo.includes('TRANSFER')) tokens.add('transferencia');
  if (codigo.includes('FEE') || descricao.includes('taxa')) {
    tokens.add('taxa');
    tokens.add('tarifa');
  }
  if (codigo.includes('CHARGEBACK')) tokens.add('chargeback');
  if (codigo.includes('INVOICE')) {
    tokens.add('nota');
    tokens.add('fiscal');
  }
  if (codigo.includes('MOBILE_PHONE_RECHARGE')) {
    tokens.add('recarga');
    tokens.add('celular');
  }

  return Array.from(tokens);
};

const sugerirCategoriasPorTipo = (tipo: TipoAsaas, categorias: PlanoContas[]) => {
  if (categorias.length === 0) return [] as PlanoContas[];
  const tokens = extrairTokensSugestao(tipo);

  const scored = categorias
    .map((categoria) => {
      const nome = normalizeSearchText(categoria.nome);
      let score = 0;
      for (const token of tokens) {
        if (!token) continue;
        if (nome.includes(token)) score += token.length >= 6 ? 3 : 2;
      }
      return { categoria, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.categoria.nome.localeCompare(b.categoria.nome, 'pt-BR'))
    .slice(0, 3)
    .map((item) => item.categoria);

  if (scored.length > 0) return scored;
  return categorias.slice(0, 3);
};

interface CategoriaSearchableSelectProps {
  options: PlanoContas[];
  suggestions: PlanoContas[];
  value: number | '';
  onChange: (value: number | '') => void;
  placeholder?: string;
}

function CategoriaSearchableSelect({ options, suggestions, value, onChange, placeholder = 'Selecione categoria...' }: CategoriaSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((item) => item.id === value) || null, [options, value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const query = normalizeSearchText(search);
    if (!query) return options;
    return options.filter((categoria) => normalizeSearchText(categoria.nome).includes(query));
  }, [options, search]);

  const sugestoesVisiveis = useMemo(() => {
    if (search.trim()) return [] as PlanoContas[];
    return suggestions.filter((item) => item.id !== value).slice(0, 3);
  }, [suggestions, value, search]);

  const sugestoesIds = useMemo(() => new Set(sugestoesVisiveis.map((item) => item.id)), [sugestoesVisiveis]);

  const filteredSemDuplicar = useMemo(() => {
    if (search.trim()) return filtered;
    return filtered.filter((item) => !sugestoesIds.has(item.id));
  }, [filtered, sugestoesIds, search]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm flex items-center justify-between gap-2"
      >
        <span className={`truncate ${selected ? 'text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-400'}`}>
          {selected ? selected.nome : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen ? (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar categoria..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm outline-none"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setIsOpen(false);
                setSearch('');
              }}
              className={`w-full text-left px-3 py-2 rounded text-sm ${value === '' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Sem categoria
            </button>

            {sugestoesVisiveis.length > 0 ? (
              <div className="mt-2">
                <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] font-bold text-emerald-600 dark:text-emerald-300">
                  Sugestoes
                </div>
                {sugestoesVisiveis.map((categoria) => {
                  const selecionada = value === categoria.id;
                  return (
                    <button
                      key={`sug-${categoria.id}`}
                      type="button"
                      onClick={() => {
                        onChange(categoria.id);
                        setIsOpen(false);
                        setSearch('');
                      }}
                      className={`w-full text-left px-3 py-2 rounded text-sm ${selecionada ? 'bg-blue-600 text-white' : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                    >
                      {categoria.nome}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {filteredSemDuplicar.map((categoria) => {
              const selecionada = value === categoria.id;
              return (
                <button
                  key={categoria.id}
                  type="button"
                  onClick={() => {
                    onChange(categoria.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-sm ${selecionada ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  {categoria.nome}
                </button>
              );
            })}

            {filteredSemDuplicar.length === 0 && sugestoesVisiveis.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">Nenhuma categoria encontrada.</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function IntegracaoAsaas() {
  const [searchParams] = useSearchParams();
  const contaIdParam = searchParams.get('conta_id');
  const contaIdParamNumber = useMemo(() => {
    if (!contaIdParam) return null;
    const parsed = Number.parseInt(contaIdParam, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [contaIdParam]);

  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<PlanoContas[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegracaoBancaria[]>([]);
  const [selectedIntegracaoId, setSelectedIntegracaoId] = useState<number | null>(null);
  const [tiposAsaas, setTiposAsaas] = useState<TipoAsaas[]>([]);
  const [mapeamentos, setMapeamentos] = useState<MapeamentoCategoria[]>([]);
  const [mappingSelections, setMappingSelections] = useState<Record<string, number | ''>>({});
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMapeamentos, setSavingMapeamentos] = useState(false);
  const [cobrancas, setCobrancas] = useState<CobrancaAsaas[]>([]);
  const [assinaturas, setAssinaturas] = useState<AssinaturaAsaas[]>([]);
  const [contasReceberAbertas, setContasReceberAbertas] = useState<CobrancaAsaas[]>([]);
  const [contasReceberAtrasadas, setContasReceberAtrasadas] = useState<CobrancaAsaas[]>([]);
  const [contasReceberRecebidas, setContasReceberRecebidas] = useState<CobrancaAsaas[]>([]);
  const [limiteCobrancas, setLimiteCobrancas] = useState(20);
  const [limiteAssinaturas, setLimiteAssinaturas] = useState(20);
  const [limiteContasReceber, setLimiteContasReceber] = useState(20);
  const [saldoAsaas, setSaldoAsaas] = useState<SaldoAsaasResumo | null>(null);
  const [loadingSaldoAsaas, setLoadingSaldoAsaas] = useState(false);

  const [formNome, setFormNome] = useState('Asaas');
  const [formAmbiente] = useState('PRODUCAO');
  const [formToken, setFormToken] = useState('');
  const [formContaId, setFormContaId] = useState<number | ''>(contaIdParamNumber ?? '');
  const [showTokenEditor, setShowTokenEditor] = useState(false);
  const [novoToken, setNovoToken] = useState('');
  const [dataInicioSync, setDataInicioSync] = useState('');
  const [isResettingAsaas, setIsResettingAsaas] = useState(false);
  const [canManageAsaasReset, setCanManageAsaasReset] = useState(false);

  const contasAtivasNaoCaixa = useMemo(
    () =>
      contas.filter(
        (conta) =>
          String(conta.status || 'ATIVO').toUpperCase() === 'ATIVO' &&
          String(conta.tipo || '').toUpperCase() !== 'CAIXA'
      ),
    [contas]
  );

  const contasAsaasAtivas = useMemo(
    () => contasAtivasNaoCaixa.filter((conta) => String(conta.tipo_integracao || '').toUpperCase() === 'ASAAS'),
    [contasAtivasNaoCaixa]
  );

  const usandoFallbackContas = contasAsaasAtivas.length === 0;

  const contasVinculaveis = useMemo(() => {
    const base = usandoFallbackContas ? contasAtivasNaoCaixa : contasAsaasAtivas;
    if (contaIdParamNumber && base.some((conta) => conta.id === contaIdParamNumber)) {
      return base.filter((conta) => conta.id === contaIdParamNumber);
    }
    return base;
  }, [usandoFallbackContas, contasAtivasNaoCaixa, contasAsaasAtivas, contaIdParamNumber]);

  const categoriasLancaveis = useMemo(
    () => categorias.filter((categoria) => categoria.permite_lancamentos !== false),
    [categorias]
  );

  const categoriasPorId = useMemo(() => {
    const map = new Map<number, PlanoContas>();
    categoriasLancaveis.forEach((categoria) => map.set(categoria.id, categoria));
    return map;
  }, [categoriasLancaveis]);

  const mapeamentosPorCodigo = useMemo(() => {
    const map = new Map<string, MapeamentoCategoria>();
    mapeamentos.forEach((mapeamento) => {
      const codigo = String(mapeamento.categoria_externa || '').trim().toUpperCase();
      if (codigo) map.set(codigo, mapeamento);
    });
    return map;
  }, [mapeamentos]);

  const naturezaPorCodigo = useMemo(() => {
    const map = new Map<string, NaturezaAsaas>();
    tiposAsaas.forEach((tipo) => {
      const codigo = String(tipo.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      map.set(codigo, inferirNaturezaAsaas(tipo));
    });
    return map;
  }, [tiposAsaas]);

  const categoriasCompativeisPorCodigo = useMemo(() => {
    const map = new Map<string, PlanoContas[]>();
    tiposAsaas.forEach((tipo) => {
      const codigo = String(tipo.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      const natureza = naturezaPorCodigo.get(codigo) || 'AMBOS';
      const opcoes = categoriasLancaveis.filter((categoria) => categoriaCompativelComNatureza(categoria, natureza));
      map.set(codigo, opcoes);
    });
    return map;
  }, [tiposAsaas, categoriasLancaveis, naturezaPorCodigo]);

  const sugestoesPorCodigo = useMemo(() => {
    const map = new Map<string, PlanoContas[]>();
    tiposAsaas.forEach((tipo) => {
      const codigo = String(tipo.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      const opcoes = categoriasCompativeisPorCodigo.get(codigo) || [];
      map.set(codigo, sugerirCategoriasPorTipo(tipo, opcoes));
    });
    return map;
  }, [tiposAsaas, categoriasCompativeisPorCodigo]);

  const alteracoesPendentesMapeamento = useMemo(() => {
    let total = 0;
    tiposAsaas.forEach((tipo) => {
      const codigo = String(tipo.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      const selecionado = mappingSelections[codigo] || '';
      const atual = mapeamentosPorCodigo.get(codigo)?.plano_contas_id || '';
      if (String(selecionado || '') !== String(atual || '')) {
        total += 1;
      }
    });
    return total;
  }, [tiposAsaas, mappingSelections, mapeamentosPorCodigo]);

  const integracoesAsaas = useMemo(
    () => integracoes.filter(i => (i.tipo || '').toUpperCase() === 'ASAAS'),
    [integracoes]
  );

  const integracaoSelecionada = useMemo(
    () => integracoesAsaas.find((item) => item.id === selectedIntegracaoId) || null,
    [integracoesAsaas, selectedIntegracaoId]
  );

  const integracaoDaContaSelecionada = useMemo(() => {
    if (formContaId === '') return null;
    return integracoesAsaas.find((item) => item.conta_id === formContaId) || null;
  }, [integracoesAsaas, formContaId]);

  const integracaoAtiva = integracaoSelecionada || integracoesAsaas[0] || null;
  const integracaoConfig = formContaId !== '' ? integracaoDaContaSelecionada : integracaoAtiva;
  const deveCriarIntegracao = formContaId !== '' ? !integracaoDaContaSelecionada : integracoesAsaas.length === 0;

  useEffect(() => {
    setDataInicioSync(integracaoConfig?.data_inicio_sincronizacao || '');
  }, [integracaoConfig?.id, integracaoConfig?.data_inicio_sincronizacao]);

  const contaVinculadaAtiva = useMemo(() => {
    if (!integracaoConfig?.conta_id) return null;
    return contas.find((conta) => conta.id === integracaoConfig.conta_id) || null;
  }, [contas, integracaoConfig]);

  const saldoContaVinculada = Number(contaVinculadaAtiva?.saldo_atual ?? contaVinculadaAtiva?.saldo_inicial ?? 0);
  const saldoAsaasAtual = Number(saldoAsaas?.saldo_asaas ?? 0);
  const diferencaSaldo = saldoAsaas ? saldoContaVinculada - saldoAsaasAtual : null;

  const contaSelecionada = useMemo(() => {
    if (formContaId === '') return null;
    return contasVinculaveis.find(c => c.id === formContaId) || null;
  }, [formContaId, contasVinculaveis]);

  const contaParamValida = useMemo(() => {
    if (!contaIdParamNumber) return false;
    return contasVinculaveis.some((conta) => conta.id === contaIdParamNumber);
  }, [contaIdParamNumber, contasVinculaveis]);

  const bloqueioPorContaParam = Boolean(contaIdParamNumber && contaParamValida && contaSelecionada);

  useEffect(() => {
    if (contaIdParamNumber && contaParamValida) {
      if (formContaId !== contaIdParamNumber) {
        setFormContaId(contaIdParamNumber);
      }
      return;
    }

    if (formContaId !== '' && !contasVinculaveis.some((conta) => conta.id === formContaId)) {
      setFormContaId('');
      return;
    }

    if (contasVinculaveis.length === 1 && formContaId === '') {
      setFormContaId(contasVinculaveis[0].id);
    }
  }, [contaIdParamNumber, contaParamValida, contasVinculaveis, formContaId]);

  useEffect(() => {
    if (!contaSelecionada) return;
    const nomeSugerido = String(contaSelecionada.banco || contaSelecionada.nome || 'Asaas').trim() || 'Asaas';
    if (formNome !== nomeSugerido) {
      setFormNome(nomeSugerido);
    }
  }, [contaSelecionada, formNome]);

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (formContaId !== '') {
      const daConta = integracoesAsaas.find((item) => item.conta_id === formContaId);
      if (daConta) {
        if (selectedIntegracaoId !== daConta.id) {
          setSelectedIntegracaoId(daConta.id);
        }
      } else if (selectedIntegracaoId !== null) {
        setSelectedIntegracaoId(null);
      }
      return;
    }

    if (integracoesAsaas.length > 0 && !selectedIntegracaoId) {
      setSelectedIntegracaoId(integracoesAsaas[0].id);
    }
  }, [integracoesAsaas, selectedIntegracaoId, formContaId]);

  useEffect(() => {
    if (!selectedIntegracaoId) return;
    carregarMapeamentos(selectedIntegracaoId);
    carregarTiposAsaas(selectedIntegracaoId);
    carregarCobrancas(selectedIntegracaoId, limiteCobrancas);
    carregarAssinaturas(selectedIntegracaoId, limiteAssinaturas);
    carregarContasReceber(selectedIntegracaoId, limiteContasReceber);
    carregarSaldoAsaas(selectedIntegracaoId);
  }, [selectedIntegracaoId, limiteCobrancas, limiteAssinaturas, limiteContasReceber]);

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCategorias, resIntegracoes, resMe] = await Promise.all([
        api.get('/contas/'),
        api.get('/plano-contas/'),
        api.get('/integracoes-bancarias/'),
        api.get<UsuarioMe>('/usuarios/me'),
      ]);
      setContas(normalizeListResponse<Conta>(resContas.data));
      setCategorias(normalizeListResponse<PlanoContas>(resCategorias.data));
      setIntegracoes(normalizeListResponse<IntegracaoBancaria>(resIntegracoes.data));
      const email = String(resMe?.data?.email || '').trim().toLowerCase();
      setCanManageAsaasReset(AUTHORIZED_ASAAS_RESET_EMAILS.includes(email));
    } catch (e) {
      console.error(e);
      setCanManageAsaasReset(false);
    } finally {
      setLoading(false);
    }
  }

  async function carregarTiposAsaas(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/tipos-asaas`);
      setTiposAsaas(normalizeListResponse<TipoAsaas>(data));
    } catch (e) {
      console.error(e);
      setTiposAsaas([]);
    }
  }

  async function carregarMapeamentos(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/mapeamentos`);
      const mapeamentosNormalizados = normalizeListResponse<MapeamentoCategoria>(data).map((item) => ({
        ...item,
        categoria_externa: String(item.categoria_externa || '').trim().toUpperCase(),
      }));
      setMapeamentos(mapeamentosNormalizados);
      const nextSelections: Record<string, number | ''> = {};
      mapeamentosNormalizados.forEach((m) => {
        nextSelections[String(m.categoria_externa || '').trim().toUpperCase()] = m.plano_contas_id;
      });
      setMappingSelections(nextSelections);
    } catch (e) {
      console.error(e);
      setMapeamentos([]);
    }
  }

  async function carregarCobrancas(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/cobrancas`, {
        params: { limit }
      });
      setCobrancas(normalizeListResponse<CobrancaAsaas>(data));
    } catch (e) {
      console.error(e);
      setCobrancas([]);
    }
  }

  async function carregarAssinaturas(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/assinaturas`, {
        params: { limit }
      });
      setAssinaturas(normalizeListResponse<AssinaturaAsaas>(data));
    } catch (e) {
      console.error(e);
      setAssinaturas([]);
    }
  }

  async function carregarContasReceber(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/contas-receber`, {
        params: { limit }
      });
      setContasReceberAbertas(normalizeListResponse<CobrancaAsaas>(data?.abertas));
      setContasReceberAtrasadas(normalizeListResponse<CobrancaAsaas>(data?.atrasadas));
      setContasReceberRecebidas(normalizeListResponse<CobrancaAsaas>(data?.recebidas));
    } catch (e) {
      console.error(e);
      setContasReceberAbertas([]);
      setContasReceberAtrasadas([]);
      setContasReceberRecebidas([]);
    }
  }

  async function carregarSaldoAsaas(integracaoId: number) {
    setLoadingSaldoAsaas(true);
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/saldo`);
      setSaldoAsaas(data as SaldoAsaasResumo);
    } catch (e) {
      console.error(e);
      setSaldoAsaas(null);
    } finally {
      setLoadingSaldoAsaas(false);
    }
  }

  async function handleCriarIntegracao() {
    if (!formToken.trim()) return alert('Informe o token do Asaas.');
    if (!formContaId) return alert('Selecione a conta bancária para vincular ao Asaas.');

    setSaving(true);
    try {
      const centroId = contaSelecionada?.centro_custo_id || null;
      const nomeIntegracao = String(formNome || contaSelecionada?.banco || contaSelecionada?.nome || 'Asaas').trim() || 'Asaas';
      const payload = {
        nome: nomeIntegracao,
        tipo: 'ASAAS',
        ambiente: formAmbiente,
        token: formToken.trim(),
        conta_id: contaSelecionada?.id || null,
        centro_custo_id: centroId,
        ativo: true,
        sincronizar_automaticamente: true,
        intervalo_sincronizacao_minutos: 60,
        usar_categoria_a_categorizar: true
      };
      const { data } = await api.post('/integracoes-bancarias/', payload);
      setFormToken('');
      await carregarDados();
      if (data?.id) {
        setSelectedIntegracaoId(data.id);
      }
      alert('Integração Asaas criada com sucesso. O token foi salvo com segurança e não será exibido novamente.');
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar integração.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAtualizarToken() {
    if (!selectedIntegracaoId) return;
    if (!novoToken.trim()) return alert('Informe o novo token do Asaas.');

    setSaving(true);
    try {
      await api.patch(`/integracoes-bancarias/${selectedIntegracaoId}`, {
        token: novoToken.trim(),
      });
      setNovoToken('');
      setShowTokenEditor(false);
      await carregarDados();
      alert('Token atualizado com sucesso.');
    } catch (e) {
      console.error(e);
      alert('Erro ao atualizar token.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSincronizar() {
    if (!selectedIntegracaoId) return;
    setSyncing(true);
    try {
      const { data } = await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/sincronizar`);
      const criados = Number(data?.lancamentos_criados || 0);
      const atualizados = Number(data?.lancamentos_atualizados || 0);
      const processado = Number(data?.total_processado || 0);
      const dataInicio = data?.data_inicio_utilizada ? String(data.data_inicio_utilizada) : 'início padrão da API';
      const dataInicioConfigurada = data?.data_inicio_configurada ? String(data.data_inicio_configurada) : 'não configurada';
      const ultimaConciliacao = data?.data_ultima_conciliacao ? String(data.data_ultima_conciliacao) : 'sem conciliação prévia';
      await carregarSaldoAsaas(selectedIntegracaoId);
      alert(
        `Sincronização concluída.\nProcessados: ${processado}\nCriados: ${criados}\nAtualizados: ${atualizados}\nInício configurado: ${dataInicioConfigurada}\nInício usado: ${dataInicio}\nÚltima conciliação: ${ultimaConciliacao}`
      );
    } catch (e) {
      console.error(e);
      alert('Erro ao sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSalvarDataInicioSincronizacao() {
    if (!selectedIntegracaoId) return;

    setSaving(true);
    try {
      await api.patch(`/integracoes-bancarias/${selectedIntegracaoId}`, {
        data_inicio_sincronizacao: dataInicioSync || null,
      });
      await carregarDados();
      alert('Data de início da sincronização atualizada com sucesso.');
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar data de início da sincronização.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetarLancamentosAsaas() {
    if (!selectedIntegracaoId) return;
    if (!window.confirm('Essa ação vai apagar todos os lançamentos de origem Asaas desta empresa e manter apenas os próximos syncs. Deseja continuar?')) {
      return;
    }

    setIsResettingAsaas(true);
    try {
      const { data } = await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/asaas/reset`, {
        data_inicio_sincronizacao: dataInicioSync || null,
      });
      const totalResetado = Number(data?.lancamentos_resetados || 0);
      await carregarDados();
      await carregarContasReceber(selectedIntegracaoId, limiteContasReceber);
      await carregarCobrancas(selectedIntegracaoId, limiteCobrancas);
      await carregarAssinaturas(selectedIntegracaoId, limiteAssinaturas);
      alert(`Reset Asaas concluído. Lançamentos removidos: ${totalResetado}.`);
    } catch (e: any) {
      console.error(e);
      const detail = e?.response?.data?.detail;
      alert(typeof detail === 'string' && detail ? detail : 'Erro ao resetar lançamentos Asaas.');
    } finally {
      setIsResettingAsaas(false);
    }
  }

  function handleAplicarSugestoesPendentes() {
    setMappingSelections((prev) => {
      const next = { ...prev };
      tiposAsaas.forEach((tipo) => {
        const codigo = String(tipo.codigo || '').trim().toUpperCase();
        if (!codigo) return;
        const valorAtual = next[codigo] || '';
        if (valorAtual) return;
        const sugestoes = sugestoesPorCodigo.get(codigo) || [];
        if (sugestoes.length > 0) {
          next[codigo] = sugestoes[0].id;
        }
      });
      return next;
    });
  }

  async function handleSalvarTodosMapeamentos() {
    if (!selectedIntegracaoId) return;

    if (alteracoesPendentesMapeamento === 0) {
      alert('Não há alterações de mapeamento pendentes.');
      return;
    }

    const incompatibilidades: string[] = [];
    tiposAsaas.forEach((tipo) => {
      const codigo = String(tipo.codigo || '').trim().toUpperCase();
      if (!codigo) return;
      const planoId = mappingSelections[codigo];
      if (!planoId) return;
      const categoria = categoriasPorId.get(Number(planoId));
      if (!categoria) return;
      const natureza = naturezaPorCodigo.get(codigo) || 'AMBOS';
      if (!categoriaCompativelComNatureza(categoria, natureza)) {
        incompatibilidades.push(`${codigo} -> ${categoria.nome}`);
      }
    });

    if (incompatibilidades.length > 0) {
      const preview = incompatibilidades.slice(0, 6).join('\n');
      alert(
        `Foram encontradas categorias incompatíveis com a natureza do tipo Asaas:\n${preview}${
          incompatibilidades.length > 6 ? '\n...' : ''
        }\n\nAjuste os itens e tente novamente.`
      );
      return;
    }

    setSavingMapeamentos(true);
    try {
      let criados = 0;
      let atualizados = 0;
      let removidos = 0;

      for (const tipo of tiposAsaas) {
        const codigo = String(tipo.codigo || '').trim().toUpperCase();
        if (!codigo) continue;

        const selecionado = mappingSelections[codigo] || '';
        const existente = mapeamentosPorCodigo.get(codigo);

        if (!selecionado && !existente) {
          continue;
        }

        if (!selecionado && existente) {
          await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
          removidos += 1;
          continue;
        }

        const planoId = Number(selecionado);
        if (existente && existente.plano_contas_id === planoId) {
          continue;
        }

        if (existente) {
          await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
          await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos`, {
            categoria_externa: codigo,
            plano_contas_id: planoId,
          });
          atualizados += 1;
          continue;
        }

        await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos`, {
          categoria_externa: codigo,
          plano_contas_id: planoId,
        });
        criados += 1;
      }

      await carregarMapeamentos(selectedIntegracaoId);
      await carregarTiposAsaas(selectedIntegracaoId);
      alert(
        `Mapeamentos salvos com sucesso.\nCriados: ${criados}\nAtualizados: ${atualizados}\nRemovidos: ${removidos}\n` +
          'Os lançamentos Asaas já importados desse tipo são recategorizados automaticamente.'
      );
    } catch (e: any) {
      console.error(e);
      const detail = e?.response?.data?.detail;
      alert(typeof detail === 'string' && detail ? detail : 'Erro ao salvar mapeamentos em lote.');
    } finally {
      setSavingMapeamentos(false);
    }
  }

  const contaLabel = (conta: Conta) => {
    const agencia = conta.agencia ? `Ag ${conta.agencia}` : 'Ag -';
    const numero = conta.conta_numero ? `Cc ${conta.conta_numero}${conta.conta_digito ? '-' + conta.conta_digito : ''}` : 'Cc -';
    return `${conta.nome} (${conta.banco || 'Asaas'}) - ${agencia} / ${numero}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <LinkIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Integração Asaas</h2>
            <p className="text-sm text-slate-400">Token seguro, mapeamento de categorias e sincronização financeira.</p>
          </div>
        </div>
        <button
          onClick={carregarDados}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Configuração da integração</h3>

        {contasAtivasNaoCaixa.length === 0 && (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">
            Crie ao menos uma conta bancária ativa em Contas para configurar esta conexão.
          </div>
        )}

        {usandoFallbackContas && contasAtivasNaoCaixa.length > 0 ? (
          <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/20 text-xs text-amber-700 dark:text-amber-300">
            Nenhuma conta está marcada como Asaas nesta empresa. Você pode selecionar uma conta ativa agora e ela será marcada automaticamente ao conectar.
          </div>
        ) : null}

        {deveCriarIntegracao ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Nome da integração</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {formNome || 'Asaas'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Ambiente</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  Produção (fixo)
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta Asaas vinculada</label>
                {bloqueioPorContaParam ? (
                  <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                    {contaSelecionada ? contaLabel(contaSelecionada) : 'Selecione a conta Asaas em Contas para continuar.'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {contaIdParamNumber && !contaParamValida ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-300">
                        A conta enviada no link não está disponível para integração Asaas nesta empresa. Escolha uma conta abaixo.
                      </p>
                    ) : null}
                    <select
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      value={formContaId}
                      onChange={(e) => setFormContaId(e.target.value ? Number.parseInt(e.target.value, 10) : '')}
                    >
                      <option value="">Selecione...</option>
                      {contasVinculaveis.map((conta) => (
                        <option key={conta.id} value={conta.id}>{contaLabel(conta)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Token Asaas</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  value={formToken}
                  onChange={e => setFormToken(e.target.value)}
                  placeholder="Token de API"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400">Solicitado apenas nesta configuração inicial. O backend guarda o token criptografado.</p>

            <button
              onClick={handleCriarIntegracao}
              disabled={saving || !contaSelecionada}
              className="px-5 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              Conectar Asaas
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-200">
              Integração conectada. O token fica salvo com criptografia e não precisa ser informado novamente no dia a dia.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Integração ativa</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {integracaoConfig ? `${integracaoConfig.nome} (Produção)` : 'Integração Asaas'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Token</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {integracaoConfig?.token_configurado ? 'Configurado com segurança' : 'Não configurado'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta Asaas vinculada</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {contaVinculadaAtiva ? contaLabel(contaVinculadaAtiva) : 'Nenhuma conta vinculada'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Conferência de saldo Asaas x ERP</p>
                <button
                  type="button"
                  onClick={() => selectedIntegracaoId && carregarSaldoAsaas(selectedIntegracaoId)}
                  disabled={loadingSaldoAsaas || !selectedIntegracaoId}
                  className="text-xs font-bold text-blue-600 hover:underline disabled:opacity-60"
                >
                  {loadingSaldoAsaas ? 'Atualizando...' : 'Atualizar saldo'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Saldo Asaas</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">
                    {saldoAsaasAtual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Saldo no ERP (conta vinculada)</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">
                    {saldoContaVinculada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Diferença (ERP - Asaas)</div>
                  <div className={`text-lg font-black ${diferencaSaldo !== null && Math.abs(diferencaSaldo) > 0.009 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                    {(diferencaSaldo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              </div>
              {saldoAsaas?.atualizado_em ? (
                <p className="text-[11px] text-slate-500">Atualizado em {new Date(saldoAsaas.atualizado_em).toLocaleString('pt-BR')}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Reconfigurar token (opcional)</p>
                <button
                  type="button"
                  onClick={() => setShowTokenEditor((prev) => !prev)}
                  className="text-xs font-bold text-blue-600 hover:underline"
                >
                  {showTokenEditor ? 'Fechar' : 'Atualizar token'}
                </button>
              </div>

              {showTokenEditor ? (
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Novo token Asaas</label>
                    <input
                      type="password"
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      value={novoToken}
                      onChange={e => setNovoToken(e.target.value)}
                      placeholder="Novo token de API"
                    />
                  </div>
                  <button
                    onClick={handleAtualizarToken}
                    disabled={saving || !selectedIntegracaoId}
                    className="px-4 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
                  >
                    Salvar token
                  </button>
                </div>
              ) : null}
            </div>

            {canManageAsaasReset ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/20 p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Controle de corte e limpeza Asaas</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Defina a data mínima para sincronização. Nada antes dessa data será buscado.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold uppercase text-amber-700 dark:text-amber-300 mb-1">Data de início da sincronização</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900"
                    value={dataInicioSync}
                    onChange={(e) => setDataInicioSync(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleSalvarDataInicioSincronizacao}
                  disabled={saving || !selectedIntegracaoId}
                  className="px-4 py-3 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-60"
                >
                  Salvar corte
                </button>
              </div>
              <button
                onClick={handleResetarLancamentosAsaas}
                disabled={isResettingAsaas || !selectedIntegracaoId}
                className="px-4 py-3 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {isResettingAsaas ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                Apagar lançamentos Asaas e reiniciar sincronização
              </button>
            </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Mapeamento de categorias</h3>
            <p className="text-sm text-slate-400">Mapeie tipos financeiros do Asaas para o plano de contas.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAplicarSugestoesPendentes}
              disabled={!selectedIntegracaoId || tiposAsaas.length === 0 || savingMapeamentos}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold disabled:opacity-60"
            >
              Aplicar sugestões
            </button>
            <button
              onClick={handleSalvarTodosMapeamentos}
              disabled={!selectedIntegracaoId || savingMapeamentos || alteracoesPendentesMapeamento === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-60"
            >
              {savingMapeamentos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar tudo {alteracoesPendentesMapeamento > 0 ? `(${alteracoesPendentesMapeamento})` : ''}
            </button>
            <button
              onClick={handleSincronizar}
              disabled={!selectedIntegracaoId || syncing}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar agora
            </button>
          </div>
        </div>

        {selectedIntegracaoId ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
            Exibindo tipos detectados nas 100 últimas movimentações do Asaas e todos os tipos já mapeados anteriormente. O seletor permite pesquisa e sugere opções compatíveis com a natureza.
          </div>
        ) : null}

        {integracoesAsaas.length > 1 && (
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Integração</label>
            <select
              className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              value={selectedIntegracaoId || ''}
              onChange={e => setSelectedIntegracaoId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Selecione...</option>
              {integracoesAsaas.map(integ => (
                <option key={integ.id} value={integ.id}>{integ.nome} ({integ.ambiente})</option>
              ))}
            </select>
          </div>
        )}

        {!selectedIntegracaoId && (
          <div className="text-sm text-slate-400">Selecione uma integração Asaas para mapear.</div>
        )}

        {selectedIntegracaoId && (
          <div className="space-y-3">
            {tiposAsaas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhum tipo carregado.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-300 text-xs uppercase tracking-[0.12em]">
                    <tr>
                      <th className="px-3 py-3 text-left">Tipo</th>
                      <th className="px-3 py-3 text-left">Descrição</th>
                      <th className="px-3 py-3 text-left">Natureza</th>
                      <th className="px-3 py-3 text-left">Categoria mapeada</th>
                      <th className="px-3 py-3 text-center">Status</th>
                      <th className="px-3 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {tiposAsaas.map((tipo) => {
                      const codigoNormalizado = String(tipo.codigo || '').trim().toUpperCase();
                      const selected = mappingSelections[codigoNormalizado] || '';
                      const mapped = mapeamentosPorCodigo.get(codigoNormalizado);
                      const natureza = naturezaPorCodigo.get(codigoNormalizado) || 'AMBOS';
                      const opcoesCompativeis = categoriasCompativeisPorCodigo.get(codigoNormalizado) || [];
                      const sugestoes = sugestoesPorCodigo.get(codigoNormalizado) || [];
                      const categoriaSelecionada = selected ? categoriasPorId.get(Number(selected)) || null : null;
                      const opcoesDropdown = categoriaSelecionada && !opcoesCompativeis.some((item) => item.id === categoriaSelecionada.id)
                        ? [categoriaSelecionada, ...opcoesCompativeis]
                        : opcoesCompativeis;
                      const selecaoIncompativel = Boolean(categoriaSelecionada && !categoriaCompativelComNatureza(categoriaSelecionada, natureza));

                      return (
                        <tr key={tipo.codigo}>
                          <td className="px-3 py-3 font-mono text-[12px] text-slate-700 dark:text-slate-200">{tipo.codigo}</td>
                          <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{tipo.descricao}</td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${natureza === 'RECEITA' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : natureza === 'DESPESA' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>
                              {natureza === 'RECEITA' ? 'Receita' : natureza === 'DESPESA' ? 'Despesa' : 'Ambos'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <CategoriaSearchableSelect
                              options={opcoesDropdown}
                              suggestions={sugestoes}
                              value={selected}
                              onChange={(novoValor) => setMappingSelections((prev) => ({ ...prev, [codigoNormalizado]: novoValor }))}
                            />
                            {selecaoIncompativel ? (
                              <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                                Categoria atual incompatível com a natureza deste tipo. Escolha outra e salve tudo.
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${mapped ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                              {mapped ? 'Mapeado' : 'Pendente'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-200"
                                onClick={() => setMappingSelections((prev) => ({ ...prev, [codigoNormalizado]: '' }))}
                              >
                                Limpar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Cobranças</h3>
            <p className="text-sm text-slate-400">Últimas cobranças do Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarCobrancas(selectedIntegracaoId, limiteCobrancas)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteCobrancas(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        {cobrancas.length === 0 ? (
          <div className="text-sm text-slate-400">Nenhuma cobrança encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase">
                <tr>
                  <th className="py-2 text-left">Descrição</th>
                  <th className="py-2 text-left">Vencimento</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {cobrancas.map(cobranca => (
                  <tr key={cobranca.id}>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{cobranca.description || cobranca.id}</td>
                    <td className="py-2 text-slate-500">{cobranca.dueDate || '-'}</td>
                    <td className="py-2 text-slate-500">{cobranca.status || '-'}</td>
                    <td className="py-2 text-right text-slate-700 dark:text-slate-200">{cobranca.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Assinaturas</h3>
            <p className="text-sm text-slate-400">Assinaturas ativas do Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarAssinaturas(selectedIntegracaoId, limiteAssinaturas)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteAssinaturas(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        {assinaturas.length === 0 ? (
          <div className="text-sm text-slate-400">Nenhuma assinatura encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase">
                <tr>
                  <th className="py-2 text-left">Descrição</th>
                  <th className="py-2 text-left">Próximo vencimento</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {assinaturas.map(assinatura => (
                  <tr key={assinatura.id}>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{assinatura.description || assinatura.id}</td>
                    <td className="py-2 text-slate-500">{assinatura.nextDueDate || '-'}</td>
                    <td className="py-2 text-slate-500">{assinatura.status || '-'}</td>
                    <td className="py-2 text-right text-slate-700 dark:text-slate-200">{assinatura.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Contas a receber</h3>
            <p className="text-sm text-slate-400">Abertas e atrasadas no Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarContasReceber(selectedIntegracaoId, limiteContasReceber)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteContasReceber(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Abertas</h4>
            {contasReceberAbertas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhuma cobrança aberta.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {contasReceberAbertas.map(item => (
                  <li key={item.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{item.description || item.id}</span>
                    <span className="text-slate-700 dark:text-slate-100 font-semibold">{item.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Recebidas</h4>
            {contasReceberRecebidas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhuma cobrança recebida.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {contasReceberRecebidas.map(item => (
                  <li key={item.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{item.description || item.id}</span>
                    <span className="text-slate-700 dark:text-slate-100 font-semibold">{item.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Atrasadas</h4>
            {contasReceberAtrasadas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhuma cobrança atrasada.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {contasReceberAtrasadas.map(item => (
                  <li key={item.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{item.description || item.id}</span>
                    <span className="text-slate-700 dark:text-slate-100 font-semibold">{item.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="px-6 py-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando...
          </div>
        </div>
      )}
    </div>
  );
}
