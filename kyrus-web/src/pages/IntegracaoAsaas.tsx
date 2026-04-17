import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, normalizeListResponse } from '../services/api';
import { RefreshCw, Link as LinkIcon, Loader2, Save, Search, ChevronDown } from 'lucide-react';

interface Conta {
  id: number;
  nome: string;
  tipo?: string | null;
  status?: string | null;
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
  conta_id?: number | null;
  data_inicio_sincronizacao?: string | null;
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
  const [savingMapeamentos, setSavingMapeamentos] = useState(false);
  const [savingConciliacao, setSavingConciliacao] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dataInicioSync, setDataInicioSync] = useState('');

  const contaSelecionada = useMemo(() => {
    if (!contaIdParamNumber) return null;
    return contas.find((conta) => conta.id === contaIdParamNumber) || null;
  }, [contas, contaIdParamNumber]);

  const integracoesAsaas = useMemo(
    () => integracoes.filter((item) => String(item.tipo || '').toUpperCase() === 'ASAAS'),
    [integracoes]
  );

  const integracaoDaConta = useMemo(() => {
    if (!contaIdParamNumber) return null;
    return integracoesAsaas.find((item) => item.conta_id === contaIdParamNumber) || null;
  }, [integracoesAsaas, contaIdParamNumber]);

  const integracaoSelecionada = useMemo(
    () => integracoesAsaas.find((item) => item.id === selectedIntegracaoId) || null,
    [integracoesAsaas, selectedIntegracaoId]
  );

  const integracaoAtiva = contaIdParamNumber
    ? integracaoDaConta
    : integracaoSelecionada || integracoesAsaas[0] || null;

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

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    const activeId = integracaoAtiva?.id || null;
    if (activeId !== selectedIntegracaoId) {
      setSelectedIntegracaoId(activeId);
    }
  }, [integracaoAtiva?.id, selectedIntegracaoId]);

  useEffect(() => {
    if (!selectedIntegracaoId) {
      setTiposAsaas([]);
      setMapeamentos([]);
      setMappingSelections({});
      return;
    }

    carregarMapeamentos(selectedIntegracaoId);
    carregarTiposAsaas(selectedIntegracaoId);
  }, [selectedIntegracaoId]);

  useEffect(() => {
    setDataInicioSync(integracaoAtiva?.data_inicio_sincronizacao || '');
  }, [integracaoAtiva?.id, integracaoAtiva?.data_inicio_sincronizacao]);

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCategorias, resIntegracoes] = await Promise.all([
        api.get('/contas/'),
        api.get('/plano-contas/'),
        api.get('/integracoes-bancarias/'),
      ]);
      setContas(normalizeListResponse<Conta>(resContas.data));
      setCategorias(normalizeListResponse<PlanoContas>(resCategorias.data));
      setIntegracoes(normalizeListResponse<IntegracaoBancaria>(resIntegracoes.data));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function carregarTiposAsaas(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/tipos-asaas`);
      setTiposAsaas(normalizeListResponse<TipoAsaas>(data));
    } catch (error) {
      console.error(error);
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
      mapeamentosNormalizados.forEach((mapeamento) => {
        nextSelections[String(mapeamento.categoria_externa || '').trim().toUpperCase()] = mapeamento.plano_contas_id;
      });
      setMappingSelections(nextSelections);
    } catch (error) {
      console.error(error);
      setMapeamentos([]);
      setMappingSelections({});
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

        if (!selecionado && !existente) continue;

        if (!selecionado && existente) {
          await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
          removidos += 1;
          continue;
        }

        const planoId = Number(selecionado);
        if (existente && existente.plano_contas_id === planoId) continue;

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
    } catch (error: any) {
      console.error(error);
      const detail = error?.response?.data?.detail;
      alert(typeof detail === 'string' && detail ? detail : 'Erro ao salvar mapeamentos em lote.');
    } finally {
      setSavingMapeamentos(false);
    }
  }

  async function handleSalvarDataInicioSincronizacao() {
    if (!selectedIntegracaoId) return;

    setSavingConciliacao(true);
    try {
      await api.patch(`/integracoes-bancarias/${selectedIntegracaoId}`, {
        data_inicio_sincronizacao: dataInicioSync || null,
      });
      await carregarDados();
      alert('Data de início da conciliação atualizada com sucesso.');
    } catch (error: any) {
      console.error(error);
      const detail = error?.response?.data?.detail;
      alert(typeof detail === 'string' && detail ? detail : 'Erro ao salvar data de início da conciliação.');
    } finally {
      setSavingConciliacao(false);
    }
  }

  async function handleSincronizar() {
    if (!selectedIntegracaoId) return;

    setSyncing(true);
    try {
      const { data } = await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/sincronizar`);
      const processados = Number(data?.total_processado || 0);
      const criados = Number(data?.lancamentos_criados || 0);
      const atualizados = Number(data?.lancamentos_atualizados || 0);
      const inicioUsado = String(data?.data_inicio_utilizada || '-');
      const fimUsado = String(data?.data_fim_utilizada || '-');
      await carregarDados();
      alert(
        `Sincronização concluída.\nProcessados: ${processados}\nCriados: ${criados}\nAtualizados: ${atualizados}\nInício usado: ${inicioUsado}\nFim usado: ${fimUsado}`
      );
    } catch (error: any) {
      console.error(error);
      const detail = error?.response?.data?.detail;
      alert(typeof detail === 'string' && detail ? detail : 'Erro ao sincronizar integração Asaas.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <LinkIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Integração Asaas</h2>
            <p className="text-sm text-slate-400">Mapeamento de categorias por tipo de movimentação.</p>
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
        {contaIdParamNumber ? (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
            {contaSelecionada
              ? `Conta selecionada: ${contaSelecionada.nome}`
              : `Conta selecionada (ID ${contaIdParamNumber})`}
          </div>
        ) : null}

        {!contaIdParamNumber && integracoesAsaas.length > 1 ? (
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Integração</label>
            <select
              className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              value={selectedIntegracaoId || ''}
              onChange={(e) => setSelectedIntegracaoId(e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">Selecione...</option>
              {integracoesAsaas.map((integracao) => (
                <option key={integracao.id} value={integracao.id}>
                  {integracao.nome} ({integracao.ambiente})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!selectedIntegracaoId ? (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">
            {contaIdParamNumber
              ? 'Esta conta ainda não possui integração Asaas configurada.'
              : 'Nenhuma integração Asaas disponível para mapeamento.'}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Data de início da conciliação</label>
                  <input
                    type="date"
                    value={dataInicioSync}
                    onChange={(event) => setDataInicioSync(event.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSalvarDataInicioSincronizacao}
                  disabled={savingConciliacao}
                  className="px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
                >
                  {savingConciliacao ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar data'}
                </button>
                <button
                  type="button"
                  onClick={handleSincronizar}
                  disabled={syncing}
                  className="px-4 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sincronizar agora
                </button>
              </div>
              <p className="text-xs text-slate-500">
                A conciliação busca da data de início até hoje e, nos próximos ciclos, reprocessa 1 dia antes do último dia com lançamentos sem voltar antes da data de início configurada.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Mapeamento de categorias</h3>
                <p className="text-sm text-slate-400">
                  Exibindo tipos detectados nas 100 últimas movimentações do Asaas e tipos já mapeados.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAplicarSugestoesPendentes}
                  disabled={tiposAsaas.length === 0 || savingMapeamentos}
                  className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold disabled:opacity-60"
                >
                  Aplicar sugestões
                </button>
                <button
                  onClick={handleSalvarTodosMapeamentos}
                  disabled={savingMapeamentos || alteracoesPendentesMapeamento === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-60"
                >
                  {savingMapeamentos ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar tudo {alteracoesPendentesMapeamento > 0 ? `(${alteracoesPendentesMapeamento})` : ''}
                </button>
              </div>
            </div>

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
                      const opcoesDropdown =
                        categoriaSelecionada && !opcoesCompativeis.some((item) => item.id === categoriaSelecionada.id)
                          ? [categoriaSelecionada, ...opcoesCompativeis]
                          : opcoesCompativeis;
                      const selecaoIncompativel = Boolean(
                        categoriaSelecionada && !categoriaCompativelComNatureza(categoriaSelecionada, natureza)
                      );

                      return (
                        <tr key={codigoNormalizado || tipo.descricao}>
                          <td className="px-3 py-3 font-mono text-[12px] text-slate-700 dark:text-slate-200">{tipo.codigo}</td>
                          <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{tipo.descricao}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                natureza === 'RECEITA'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : natureza === 'DESPESA'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {natureza === 'RECEITA' ? 'Receita' : natureza === 'DESPESA' ? 'Despesa' : 'Ambos'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <CategoriaSearchableSelect
                              options={opcoesDropdown}
                              suggestions={sugestoes}
                              value={selected}
                              onChange={(novoValor) =>
                                setMappingSelections((prev) => ({ ...prev, [codigoNormalizado]: novoValor }))
                              }
                            />
                            {selecaoIncompativel ? (
                              <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                                Categoria atual incompatível com a natureza deste tipo. Escolha outra e salve tudo.
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
                                mapped
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                              }`}
                            >
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
          </>
        )}
      </div>

      {loading ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="px-6 py-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando...
          </div>
        </div>
      ) : null}
    </div>
  );
}
