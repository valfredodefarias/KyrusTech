import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from 'lucide-react';

import { api } from '../services/api';

interface ContaItem {
  id: number;
  nome: string;
  banco?: string | null;
  status?: string;
}

interface CategoriaItem {
  id: number;
  nome: string;
  tipo?: string | null;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
  status?: string;
}

interface EntidadeItem {
  id: number;
  nome: string;
}

interface NfeParcelaAnalise {
  indice: number;
  numero_parcela: string;
  data_vencimento: string;
  valor: number;
  descricao: string;
  cfop?: string | null;
  ncm?: string | null;
  plano_contas_sugerido_id?: number | null;
  plano_contas_sugerido_nome?: string | null;
  entidade_sugerida_id?: number | null;
  entidade_sugerida_nome?: string | null;
  requer_entidade_manual: boolean;
  requer_categoria_manual: boolean;
}

interface NfeAnaliseResponse {
  chave_nfe: string;
  numero_nfe: string;
  tipo_lancamento: 'RECEITA' | 'DESPESA' | string;
  data_emissao: string;
  valor_total: number;
  emitente_nome: string;
  emitente_documento: string;
  destinatario_nome: string;
  destinatario_documento: string;
  entidade_referencia_nome: string;
  entidade_referencia_documento: string;
  entidade_sugerida_id?: number | null;
  entidade_sugerida_nome?: string | null;
  plano_contas_sugerido_id?: number | null;
  plano_contas_sugerido_nome?: string | null;
  parcelas: NfeParcelaAnalise[];
  alertas: string[];
  pode_confirmar: boolean;
}

interface NfeConfirmarResponse {
  chave_nfe: string;
  numero_nfe: string;
  tipo_lancamento: string;
  total_parcelas: number;
  lancamentos_criados: number;
  lancamento_ids: number[];
}

interface ParcelaEditada {
  indice: number;
  numero_parcela: string;
  data_vencimento: string;
  valor: number;
  descricao: string;
  plano_contas_id: number | null;
  entidade_id: number | null;
  cfop?: string | null;
  ncm?: string | null;
}

type Feedback = {
  type: 'success' | 'error' | 'warning';
  message: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function isCategoriaCompativel(categoria: CategoriaItem, tipoLancamento: string) {
  const tipo = String(categoria.tipo || '').trim().toUpperCase();
  if (!tipo) return true;
  if (String(tipoLancamento).toUpperCase() === 'RECEITA') return tipo.startsWith('R');
  if (String(tipoLancamento).toUpperCase() === 'DESPESA') return tipo.startsWith('D');
  return true;
}

export function ImportacaoNfe() {
  const [contas, setContas] = useState<ContaItem[]>([]);
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [contaId, setContaId] = useState<number | ''>('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [analise, setAnalise] = useState<NfeAnaliseResponse | null>(null);
  const [parcelasEditadas, setParcelasEditadas] = useState<ParcelaEditada[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregarBase() {
      try {
        const [contasRes, categoriasRes, entidadesRes] = await Promise.all([
          api.get<ContaItem[]>('/contas/?include_saldo=false'),
          api.get<CategoriaItem[]>('/plano-contas/'),
          api.get<EntidadeItem[]>('/entidades/lookup'),
        ]);

        if (!ativo) return;

        const contasAtivas = (contasRes.data || []).filter((item) => String(item.status || 'ATIVO').toUpperCase() !== 'INATIVO');
        const categoriasValidas = (categoriasRes.data || []).filter((item) => {
          const ativa = String(item.status || 'ATIVO').toUpperCase() !== 'INATIVO';
          return ativa && !item.eh_cabecalho && item.permite_lancamentos !== false;
        });

        setContas(contasAtivas);
        setCategorias(categoriasValidas);
        setEntidades(entidadesRes.data || []);
      } catch (error) {
        if (!ativo) return;
        setFeedback({ type: 'error', message: 'Erro ao carregar contas, categorias e entidades.' });
      } finally {
        if (ativo) setLoadingBase(false);
      }
    }

    carregarBase();

    return () => {
      ativo = false;
    };
  }, []);

  const categoriasCompativeis = useMemo(() => {
    if (!analise) return categorias;
    return categorias.filter((categoria) => isCategoriaCompativel(categoria, analise.tipo_lancamento));
  }, [categorias, analise]);

  const resumoEdicao = useMemo(() => {
    const total = parcelasEditadas.reduce((acc, parcela) => acc + Number(parcela.valor || 0), 0);
    const faltandoCategoria = parcelasEditadas.filter((parcela) => !parcela.plano_contas_id).length;
    const faltandoEntidade = parcelasEditadas.filter((parcela) => !parcela.entidade_id).length;
    return {
      total,
      faltandoCategoria,
      faltandoEntidade,
    };
  }, [parcelasEditadas]);

  const podeConfirmar = useMemo(() => {
    return (
      !!analise
      && parcelasEditadas.length > 0
      && resumoEdicao.faltandoCategoria === 0
      && resumoEdicao.faltandoEntidade === 0
      && !confirmando
    );
  }, [analise, parcelasEditadas.length, resumoEdicao.faltandoCategoria, resumoEdicao.faltandoEntidade, confirmando]);

  function limparFluxo() {
    setAnalise(null);
    setParcelasEditadas([]);
  }

  function handleArquivoSelecionado(file: File | null) {
    if (!file) return;
    if (!String(file.name || '').toLowerCase().endsWith('.xml')) {
      setFeedback({ type: 'error', message: 'Selecione um arquivo XML de NF-e.' });
      return;
    }

    setArquivo(file);
    setFeedback(null);
    limparFluxo();
  }

  async function handleAnalisar() {
    if (!arquivo) {
      setFeedback({ type: 'warning', message: 'Selecione um arquivo XML para analisar.' });
      return;
    }

    setAnalisando(true);
    setFeedback(null);

    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);

      const params: Record<string, number> = {};
      if (contaId) params.conta_id = Number(contaId);

      const { data } = await api.post<NfeAnaliseResponse>(
        '/importacao/nfe/analisar',
        fd,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          params,
        },
      );

      setAnalise(data);
      const parcelas = (data.parcelas || []).map((parcela) => ({
        indice: parcela.indice,
        numero_parcela: parcela.numero_parcela,
        data_vencimento: parcela.data_vencimento,
        valor: Number(parcela.valor || 0),
        descricao: parcela.descricao,
        plano_contas_id: parcela.plano_contas_sugerido_id ?? data.plano_contas_sugerido_id ?? null,
        entidade_id: parcela.entidade_sugerida_id ?? data.entidade_sugerida_id ?? null,
        cfop: parcela.cfop ?? null,
        ncm: parcela.ncm ?? null,
      }));
      setParcelasEditadas(parcelas);

      if (data.alertas?.length) {
        setFeedback({ type: 'warning', message: 'Análise concluída com pendências para ajuste manual.' });
      } else {
        setFeedback({ type: 'success', message: 'XML analisado com sucesso. Revise as parcelas antes de confirmar.' });
      }
    } catch (error: any) {
      setAnalise(null);
      setParcelasEditadas([]);
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao analisar XML da NF-e.' });
    } finally {
      setAnalisando(false);
    }
  }

  function updateParcela(indice: number, patch: Partial<ParcelaEditada>) {
    setParcelasEditadas((prev) => prev.map((item) => (
      item.indice === indice
        ? { ...item, ...patch }
        : item
    )));
  }

  async function handleConfirmar() {
    if (!analise || parcelasEditadas.length === 0) {
      setFeedback({ type: 'warning', message: 'Nenhuma parcela disponível para confirmar.' });
      return;
    }

    if (!podeConfirmar) {
      setFeedback({ type: 'warning', message: 'Preencha categoria e entidade em todas as parcelas antes de confirmar.' });
      return;
    }

    setConfirmando(true);
    setFeedback(null);

    try {
      const payload = {
        chave_nfe: analise.chave_nfe,
        numero_nfe: analise.numero_nfe,
        tipo_lancamento: analise.tipo_lancamento,
        data_emissao: analise.data_emissao,
        conta_id: contaId ? Number(contaId) : null,
        parcelas: parcelasEditadas.map((parcela) => ({
          indice: parcela.indice,
          numero_parcela: parcela.numero_parcela,
          data_vencimento: parcela.data_vencimento,
          valor: parcela.valor,
          descricao: parcela.descricao,
          plano_contas_id: parcela.plano_contas_id,
          entidade_id: parcela.entidade_id,
        })),
      };

      const { data } = await api.post<NfeConfirmarResponse>('/importacao/nfe/confirmar', payload);
      setFeedback({
        type: 'success',
        message: `Importação NF-e concluída. ${data.lancamentos_criados} lançamento(s) criado(s).`,
      });
      setArquivo(null);
      limparFluxo();
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao confirmar importação NF-e.' });
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(140deg,#111827,#1d4ed8_55%,#0f766e)] px-6 py-7 text-white shadow-[0_25px_80px_-45px_rgba(15,23,42,0.9)] dark:border-slate-800 md:px-8 md:py-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200">XML NF-e</p>
            <h1 className="max-w-3xl text-3xl font-black tracking-tight md:text-4xl">Importe e gere faturamento por parcela.</h1>
            <p className="max-w-2xl text-sm text-slate-100/90">O sistema analisa a NF-e, sugere categoria por CFOP/NCM, exige entidade válida e cria lançamentos com descrição automática no padrão NFE: (número) Parcela X/Y.</p>
          </div>

          <div className="rounded-3xl border border-white/20 bg-white/10 p-4 backdrop-blur">
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.18em] text-slate-200">Conta bancária (opcional)</label>
            <select
              value={contaId}
              onChange={(event) => setContaId(event.target.value ? Number(event.target.value) : '')}
              className="w-full rounded-2xl border border-white/30 bg-white/90 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-cyan-400"
            >
              <option value="">Sem conta vinculada</option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>
                  {conta.nome}{conta.banco ? ` - ${conta.banco}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-200/85">Sem conta: os lançamentos ficam previstos e podem ser pagos depois no financeiro.</p>
          </div>
        </div>
      </section>

      {feedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300' : feedback.type === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300' : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'}`}>
          {feedback.message}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Arquivo XML</label>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-cyan-400 dark:border-slate-700 dark:bg-slate-950">
              <UploadCloud className="h-5 w-5 text-cyan-500" />
              <span className="text-sm text-slate-700 dark:text-slate-200">{arquivo ? arquivo.name : 'Selecione um XML de NF-e'}</span>
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(event) => handleArquivoSelecionado(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleAnalisar}
            disabled={!arquivo || analisando || loadingBase}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-900/20 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {analisando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {analisando ? 'Analisando XML...' : 'Analisar NF-e'}
          </button>
        </div>
      </section>

      {analise ? (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">NF-e</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{analise.numero_nfe}</p>
                <p className="mt-1 text-xs text-slate-500">Chave: {analise.chave_nfe}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Tipo</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{analise.tipo_lancamento}</p>
                <p className="mt-1 text-xs text-slate-500">Emissão: {formatDate(analise.data_emissao)}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Valor total</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(analise.valor_total)}</p>
                <p className="mt-1 text-xs text-slate-500">Parcelas: {parcelasEditadas.length}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Entidade referência</p>
                <p className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">{analise.entidade_referencia_nome || '-'}</p>
                <p className="mt-1 text-xs text-slate-500">{analise.entidade_referencia_documento || 'Sem documento no XML'}</p>
              </div>
            </div>

            {analise.alertas.length > 0 ? (
              <div className="mt-4 space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                {analise.alertas.map((alerta) => (
                  <div key={alerta} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{alerta}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Regras automáticas concluídas sem pendências.
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">Parcelas para lançamento</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Preencha categoria e entidade em cada parcela antes de confirmar.</p>
              </div>
              <div className="text-right text-sm text-slate-600 dark:text-slate-300">
                <div>Total das parcelas: <strong>{formatCurrency(resumoEdicao.total)}</strong></div>
                <div>Faltando categoria: <strong>{resumoEdicao.faltandoCategoria}</strong></div>
                <div>Faltando entidade: <strong>{resumoEdicao.faltandoEntidade}</strong></div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Parcela</th>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Vencimento</th>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Valor</th>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Descrição</th>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Categoria</th>
                    <th className="px-3 py-2 text-left font-bold uppercase tracking-[0.12em] text-slate-500">Entidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parcelasEditadas.map((parcela) => (
                    <tr key={parcela.indice} className="bg-white dark:bg-slate-900">
                      <td className="px-3 py-3 font-semibold text-slate-800 dark:text-slate-200">{parcela.indice}/{parcelasEditadas.length}</td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{formatDate(parcela.data_vencimento)}</td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{formatCurrency(parcela.valor)}</td>
                      <td className="px-3 py-3">
                        <input
                          value={parcela.descricao}
                          onChange={(event) => updateParcela(parcela.indice, { descricao: event.target.value })}
                          className="w-full min-w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                        <div className="mt-1 text-[11px] text-slate-500">CFOP {parcela.cfop || '-'} | NCM {parcela.ncm || '-'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={parcela.plano_contas_id ?? ''}
                          onChange={(event) => updateParcela(parcela.indice, { plano_contas_id: event.target.value ? Number(event.target.value) : null })}
                          className={`w-full min-w-52 rounded-xl border px-3 py-2 text-sm outline-none transition dark:bg-slate-950 ${parcela.plano_contas_id ? 'border-slate-300 text-slate-800 focus:border-cyan-400 dark:border-slate-700 dark:text-slate-200' : 'border-amber-400 text-amber-700 focus:border-amber-500 dark:border-amber-800 dark:text-amber-300'}`}
                        >
                          <option value="">Selecione...</option>
                          {categoriasCompativeis.map((categoria) => (
                            <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={parcela.entidade_id ?? ''}
                          onChange={(event) => updateParcela(parcela.indice, { entidade_id: event.target.value ? Number(event.target.value) : null })}
                          className={`w-full min-w-52 rounded-xl border px-3 py-2 text-sm outline-none transition dark:bg-slate-950 ${parcela.entidade_id ? 'border-slate-300 text-slate-800 focus:border-cyan-400 dark:border-slate-700 dark:text-slate-200' : 'border-amber-400 text-amber-700 focus:border-amber-500 dark:border-amber-800 dark:text-amber-300'}`}
                        >
                          <option value="">Selecione...</option>
                          {entidades.map((entidade) => (
                            <option key={entidade.id} value={entidade.id}>{entidade.nome}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setArquivo(null);
                  limparFluxo();
                }}
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={handleConfirmar}
                disabled={!podeConfirmar}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {confirmando ? 'Confirmando...' : 'Confirmar importação NF-e'}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {loadingBase ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando dados base...
        </div>
      ) : null}
    </div>
  );
}
