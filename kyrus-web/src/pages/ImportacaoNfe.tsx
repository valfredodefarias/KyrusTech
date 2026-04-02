import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from 'lucide-react';

import { api, normalizeListResponse } from '../services/api';

interface CategoriaItem {
  id: number;
  nome: string;
  codigo?: string | null;
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
  requer_categoria_manual: boolean;
}

interface NfeItemAnalise {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  cfop?: string | null;
  ncm?: string | null;
}

interface NfeAnaliseResponse {
  chave_nfe: string;
  numero_nfe: string;
  serie: string;
  tipo_lancamento: 'RECEITA' | 'DESPESA' | string;
  data_emissao: string;
  valor_total: number;
  valor_produtos: number;
  valor_frete: number;
  valor_seguro: number;
  valor_desconto: number;
  valor_outros: number;
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
  itens: NfeItemAnalise[];
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

function normalizeSearchText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findDefaultEntityId(entidadesLista: EntidadeItem[], emitenteNome: string) {
  const nomeNormalizado = normalizeSearchText(emitenteNome);
  if (!nomeNormalizado) return null;

  const entidadeExata = entidadesLista.find((entidade) => normalizeSearchText(entidade.nome) === nomeNormalizado);
  if (entidadeExata) return entidadeExata.id;

  const entidadeContem = entidadesLista.find((entidade) => {
    const nomeEntidade = normalizeSearchText(entidade.nome);
    return nomeEntidade.includes(nomeNormalizado) || nomeNormalizado.includes(nomeEntidade);
  });

  return entidadeContem?.id ?? null;
}

function findDefaultCategoryId(categoriasLista: CategoriaItem[]) {
  const categoriasDespesa = categoriasLista.filter((categoria) => isCategoriaCompativel(categoria, 'DESPESA'));
  if (!categoriasDespesa.length) return null;

  const nomesPrioritarios = [
    'fornecedores',
    'fornecedor',
    'compras',
    'compra',
    'mercadoria',
    'estoque',
    'despesa',
  ];

  for (const termo of nomesPrioritarios) {
    const encontrada = categoriasDespesa.find((categoria) => normalizeSearchText(categoria.nome).includes(termo));
    if (encontrada) return encontrada.id;
  }

  return categoriasDespesa[0]?.id ?? null;
}

function parseLocalXmlItems(xmlText: string): NfeItemAnalise[] {
  try {
    const parser = new DOMParser();
    const documentXml = parser.parseFromString(xmlText, 'text/xml');
    if (documentXml.getElementsByTagName('parsererror').length > 0) return [];

    const allNodes = Array.from(documentXml.getElementsByTagName('*'));
    const getText = (root: Element, tagName: string) => {
      const found = Array.from(root.getElementsByTagName('*')).find((node) => node.localName === tagName);
      return found?.textContent?.trim() || '';
    };

    return allNodes.flatMap((detNode, index) => {
      if (detNode.localName !== 'det') return [];

      const prodNode = Array.from(detNode.getElementsByTagName('*')).find((node) => node.localName === 'prod');
      if (!prodNode) return [];

      const quantidade = Number(getText(prodNode, 'qCom').replace(',', '.') || 0);
      const valorUnitario = Number(getText(prodNode, 'vUnCom').replace(',', '.') || 0);
      const valorTotal = Number(getText(prodNode, 'vProd').replace(',', '.') || 0);

      return [{
        descricao: getText(prodNode, 'xProd') || `Item ${index + 1}`,
        quantidade: Number.isFinite(quantidade) ? quantidade : 0,
        valor_unitario: Number.isFinite(valorUnitario) ? valorUnitario : 0,
        valor_total: Number.isFinite(valorTotal) ? valorTotal : 0,
        cfop: getText(prodNode, 'CFOP') || null,
        ncm: getText(prodNode, 'NCM') || null,
      } satisfies NfeItemAnalise];
    });
  } catch {
    return [];
  }
}

function buildObservacaoNfe(analise: NfeAnaliseResponse) {
  const partes = [
    `NF-e ${analise.numero_nfe}`,
    `Chave ${analise.chave_nfe}`,
  ];

  if (analise.emitente_nome) {
    partes.push(`Emitente ${analise.emitente_nome}`);
  }

  const itens = analise.itens || [];
  if (itens.length) {
    const nomes = itens.slice(0, 3).map((item) => item.descricao).filter(Boolean);
    partes.push(`Itens ${nomes.join(', ')}${itens.length > nomes.length ? ` e mais ${itens.length - nomes.length}` : ''}`);
  }

  if (analise.valor_frete > 0) {
    partes.push(`Frete ${formatCurrency(analise.valor_frete)}`);
  }

  return partes.join(' | ');
}

function isCategoriaCompativel(categoria: CategoriaItem, tipoLancamento: string) {
  const tipo = String(categoria.tipo || '').trim().toUpperCase();
  if (!tipo) return true;
  if (String(tipoLancamento).toUpperCase() === 'RECEITA') return tipo.startsWith('R');
  if (String(tipoLancamento).toUpperCase() === 'DESPESA') return tipo.startsWith('D');
  return true;
}

export function ImportacaoNfe() {
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [planoContasPadraoId, setPlanoContasPadraoId] = useState<number | ''>('');
  const [entidadePadraoId, setEntidadePadraoId] = useState<number | ''>('');
  const [categoriaBusca, setCategoriaBusca] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loadingBase, setLoadingBase] = useState(true);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [analise, setAnalise] = useState<NfeAnaliseResponse | null>(null);
  const [parcelasEditadas, setParcelasEditadas] = useState<ParcelaEditada[]>([]);
  const [itensXmlLocais, setItensXmlLocais] = useState<NfeItemAnalise[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregarBase() {
      try {
        const [categoriasRes, entidadesRes] = await Promise.all([
          api.get<CategoriaItem[]>('/plano-contas/'),
          api.get<EntidadeItem[]>('/entidades/lookup'),
        ]);

        if (!ativo) return;

        const categoriasValidas = normalizeListResponse<CategoriaItem>(categoriasRes.data).filter((item) => {
          const ativa = String(item.status || 'ATIVO').toUpperCase() !== 'INATIVO';
          return ativa && !item.eh_cabecalho && item.permite_lancamentos !== false;
        });

        setCategorias(categoriasValidas);
        setEntidades(normalizeListResponse<EntidadeItem>(entidadesRes.data));
      } catch (error) {
        if (!ativo) return;
        setFeedback({ type: 'error', message: 'Erro ao carregar categorias e entidades.' });
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
    const tipoReferencia = analise?.tipo_lancamento || 'DESPESA';
    return categorias.filter((categoria) => isCategoriaCompativel(categoria, tipoReferencia));
  }, [categorias, analise]);

  const categoriasFiltradas = useMemo(() => {
    const termo = normalizeSearchText(categoriaBusca);
    const base = categoriasCompativeis;
    if (!termo) return base;

    const filtradas = base.filter((categoria) => {
      const nome = normalizeSearchText(categoria.nome);
      const codigo = normalizeSearchText(String(categoria.codigo || ''));
      return nome.includes(termo) || codigo.includes(termo);
    });

    if (planoContasPadraoId) {
      const selecionada = base.find((categoria) => Number(categoria.id) === Number(planoContasPadraoId));
      if (selecionada && !filtradas.some((categoria) => categoria.id === selecionada.id)) {
        filtradas.unshift(selecionada);
      }
    }

    return filtradas;
  }, [categoriasCompativeis, categoriaBusca, planoContasPadraoId]);

  const categoriaSelecionada = useMemo(
    () => categoriasCompativeis.find((categoria) => Number(categoria.id) === Number(planoContasPadraoId)) || null,
    [categoriasCompativeis, planoContasPadraoId],
  );

  const resumoEdicao = useMemo(() => {
    const total = parcelasEditadas.reduce((acc, parcela) => acc + Number(parcela.valor || 0), 0);
    const faltandoCategoria = parcelasEditadas.filter((parcela) => !parcela.plano_contas_id).length;
    return {
      total,
      faltandoCategoria,
    };
  }, [parcelasEditadas]);

  const podeConfirmar = useMemo(() => {
    return (
      !!analise
      && parcelasEditadas.length > 0
      && resumoEdicao.faltandoCategoria === 0
      && !confirmando
    );
  }, [analise, parcelasEditadas.length, resumoEdicao.faltandoCategoria, confirmando]);

  function limparFluxo() {
    setAnalise(null);
    setParcelasEditadas([]);
    setPlanoContasPadraoId('');
    setEntidadePadraoId('');
    setItensXmlLocais([]);
  }

  async function anexarPdfNosLancamentos(lancamentoIds: number[]) {
    if (!pdfFile || lancamentoIds.length === 0) return 0;

    let anexosCriados = 0;
    for (const lancamentoId of lancamentoIds) {
      const fd = new FormData();
      fd.append('files', pdfFile);
      await api.post(`/lancamentos/${lancamentoId}/anexos?tipo=NOTA_FISCAL`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      anexosCriados += 1;
    }

    return anexosCriados;
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

  function handlePdfSelecionado(file: File | null) {
    if (!file) return;
    if (!String(file.name || '').toLowerCase().endsWith('.pdf')) {
      setFeedback({ type: 'error', message: 'Selecione um arquivo PDF válido.' });
      return;
    }

    setPdfFile(file);
    setFeedback(null);
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

      const xmlText = await arquivo.text();
      const localItems = parseLocalXmlItems(xmlText);
      setItensXmlLocais(localItems);

      const { data } = await api.post<NfeAnaliseResponse>(
        '/importacao/nfe/analisar',
        fd,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );

      const analiseNormalizada: NfeAnaliseResponse = {
        ...data,
        tipo_lancamento: 'DESPESA',
        valor_total: Number(data.valor_total || 0),
        valor_produtos: Number(data.valor_produtos || 0),
        valor_frete: Number(data.valor_frete || 0),
        valor_seguro: Number(data.valor_seguro || 0),
        valor_desconto: Number(data.valor_desconto || 0),
        valor_outros: Number(data.valor_outros || 0),
        itens: (data.itens && data.itens.length > 0 ? data.itens : localItems) || [],
        parcelas: data.parcelas || [],
        alertas: (data.alertas || []).filter((alerta) => {
          const texto = normalizeSearchText(alerta);
          return !texto.includes('entidade') && !texto.includes('emitente');
        }),
      };

      const categoriaPadraoId = data.plano_contas_sugerido_id ?? findDefaultCategoryId(categorias);
      const entidadePadraoIdFallback = data.entidade_sugerida_id ?? findDefaultEntityId(entidades, data.entidade_sugerida_nome || data.emitente_nome);

      analiseNormalizada.plano_contas_sugerido_id = categoriaPadraoId;
      analiseNormalizada.plano_contas_sugerido_nome = data.plano_contas_sugerido_nome || categorias.find((categoria) => Number(categoria.id) === Number(categoriaPadraoId))?.nome || null;
      analiseNormalizada.entidade_sugerida_id = entidadePadraoIdFallback;
      analiseNormalizada.entidade_sugerida_nome = data.entidade_sugerida_nome || entidades.find((entidade) => Number(entidade.id) === Number(entidadePadraoIdFallback))?.nome || data.emitente_nome || null;

      setAnalise(analiseNormalizada);
      setPlanoContasPadraoId(analiseNormalizada.plano_contas_sugerido_id ?? '');
      setEntidadePadraoId(analiseNormalizada.entidade_sugerida_id ?? '');
      const parcelas = (analiseNormalizada.parcelas || []).map((parcela) => ({
        indice: parcela.indice,
        numero_parcela: parcela.numero_parcela,
        data_vencimento: parcela.data_vencimento,
        valor: Number(parcela.valor || 0),
        descricao: parcela.descricao || '',
        plano_contas_id: parcela.plano_contas_sugerido_id ?? analiseNormalizada.plano_contas_sugerido_id ?? null,
        entidade_id: parcela.entidade_sugerida_id ?? analiseNormalizada.entidade_sugerida_id ?? null,
        cfop: parcela.cfop ?? null,
        ncm: parcela.ncm ?? null,
      }));
      setParcelasEditadas(parcelas);

      if (analiseNormalizada.alertas.length) {
        setFeedback({ type: 'warning', message: 'Análise concluída com pendências para ajuste.' });
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

  const itensVisiveis = (analise?.itens && analise.itens.length > 0) ? analise.itens : itensXmlLocais;
  const valorProdutosExibido = Number(analise?.valor_produtos || 0) > 0
    ? Number(analise?.valor_produtos || 0)
    : itensVisiveis.reduce((acc, item) => acc + Number(item.valor_total || 0), 0);

  function updateParcela(indice: number, patch: Partial<ParcelaEditada>) {
    setParcelasEditadas((prev) => prev.map((item) => (
      item.indice === indice
        ? { ...item, ...patch }
        : item
    )));
  }

  function aplicarPadroesNasParcelas(planoContasId: number | '', entidadeId: number | '') {
    setParcelasEditadas((prev) => prev.map((parcela) => ({
      ...parcela,
      plano_contas_id: planoContasId ? Number(planoContasId) : null,
      entidade_id: entidadeId ? Number(entidadeId) : null,
    })));
  }

  async function handleConfirmar() {
    if (!analise || parcelasEditadas.length === 0) {
      setFeedback({ type: 'warning', message: 'Nenhuma parcela disponível para confirmar.' });
      return;
    }

    if (!podeConfirmar) {
      setFeedback({ type: 'warning', message: 'Preencha a categoria em todas as parcelas antes de confirmar.' });
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
        emitente_nome: analise.emitente_nome,
        emitente_documento: analise.emitente_documento,
        emitente_nome_fantasia: analise.emitente_nome,
        entidade_id: entidadePadraoId ? Number(entidadePadraoId) : null,
        plano_contas_id: planoContasPadraoId ? Number(planoContasPadraoId) : null,
        observacao: buildObservacaoNfe(analise),
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

      let anexosCriados = 0;
      if (pdfFile && data.lancamento_ids?.length) {
        try {
          anexosCriados = await anexarPdfNosLancamentos(data.lancamento_ids);
        } catch {
          anexosCriados = 0;
        }
      }

      setFeedback({
        type: 'success',
        message: anexosCriados > 0
          ? `Importação NF-e concluída. ${data.lancamentos_criados} lançamento(s) criado(s) e PDF anexado.`
          : `Importação NF-e concluída. ${data.lancamentos_criados} lançamento(s) criado(s).`,
      });
      setArquivo(null);
      setPdfFile(null);
      limparFluxo();
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao confirmar importação NF-e.' });
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-100">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-400">XML NF-e</p>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Importação de NF-e</h1>
            <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">Analise o XML, anexe o PDF quando houver e confirme com categoria aplicada às parcelas.</p>
          </div>
        </div>
      </section>

      {feedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedback.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300' : feedback.type === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300' : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'}`}>
          {feedback.message}
        </div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">Entrada da NF-e</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Use XML para análise automática. O PDF será anexado ao confirmar a importação.</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
          <div className="space-y-4">
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
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">A análise automática preenche as parcelas e sugere categoria quando possível.</p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">PDF do documento</label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-cyan-400 dark:border-slate-700 dark:bg-slate-950">
                <UploadCloud className="h-5 w-5 text-cyan-500" />
                <span className="text-sm text-slate-700 dark:text-slate-200">{pdfFile ? pdfFile.name : 'Selecione o PDF para anexar ao lançamento'}</span>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(event) => handlePdfSelecionado(event.target.files?.[0] || null)}
                />
              </label>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">O PDF será anexado aos lançamentos criados após a confirmação.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAnalisar}
            disabled={!arquivo || analisando || loadingBase}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-900/20 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 xl:self-start"
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
                <p className="mt-1 text-xs text-slate-500">Série: {analise.serie || '-'} | Chave: {analise.chave_nfe}</p>
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
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Emitente</p>
                <p className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">{analise.emitente_nome || '-'}</p>
                <p className="mt-1 text-xs text-slate-500">{analise.emitente_documento || 'Sem documento no XML'}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Produtos</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(valorProdutosExibido)}</p>
                <p className="mt-1 text-xs text-slate-500">{itensVisiveis.length} item(ns) identificados</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Frete</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(analise.valor_frete)}</p>
                <p className="mt-1 text-xs text-slate-500">Seguro: {formatCurrency(analise.valor_seguro)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Desconto</p>
                <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{formatCurrency(analise.valor_desconto)}</p>
                <p className="mt-1 text-xs text-slate-500">Outros: {formatCurrency(analise.valor_outros)}</p>
              </div>
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-200">
                <p className="text-xs uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">Resumo</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-slate-900 dark:text-white">Itens encontrados</h3>
              </div>
              {itensVisiveis.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {itensVisiveis.slice(0, 6).map((item, index) => (
                    <div key={`${item.descricao}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                      <div className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-white">{item.descricao}</div>
                      <div className="mt-1 text-xs text-slate-500">Qtd. {item.quantidade} | Unit. {formatCurrency(item.valor_unitario)}</div>
                      <div className="mt-1 text-sm font-bold text-cyan-700 dark:text-cyan-300">{formatCurrency(item.valor_total)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">CFOP {item.cfop || '-'} | NCM {item.ncm || '-'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">O XML não trouxe itens detalhados para exibição.</p>
              )}
            </div>

            {(analise.alertas || []).length > 0 ? (
              <div className="mt-4 space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                {(analise.alertas || []).map((alerta) => (
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
            <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
              <div className="text-right text-sm text-slate-600 dark:text-slate-300">
                <div>Total das parcelas: <strong>{formatCurrency(resumoEdicao.total)}</strong></div>
                <div>Faltando categoria: <strong>{resumoEdicao.faltandoCategoria}</strong></div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Categoria padrão</span>
                <div className="rounded-2xl border border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                  <input
                    value={categoriaBusca}
                    onChange={(event) => setCategoriaBusca(event.target.value)}
                    placeholder={categoriaSelecionada ? `Buscar ou trocar categoria (${categoriaSelecionada.nome})` : 'Buscar ou selecionar categoria'}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => {
                        setPlanoContasPadraoId('');
                        aplicarPadroesNasParcelas('', entidadePadraoId);
                      }}
                      className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-cyan-50 dark:border-slate-800 dark:hover:bg-cyan-950/20 ${!planoContasPadraoId ? 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-200' : 'text-slate-700 dark:text-slate-200'}`}
                    >
                      <span>Sem categoria padrão</span>
                      {!planoContasPadraoId ? <CheckCircle2 className="h-4 w-4" /> : null}
                    </button>

                    {categoriasFiltradas.map((categoria) => {
                      const selecionada = Number(planoContasPadraoId) === Number(categoria.id);
                      return (
                        <button
                          key={categoria.id}
                          type="button"
                          onClick={() => {
                            const value = Number(categoria.id);
                            setPlanoContasPadraoId(value);
                            aplicarPadroesNasParcelas(value, entidadePadraoId);
                            setCategoriaBusca(categoria.nome);
                          }}
                          className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-cyan-50 dark:border-slate-800 dark:hover:bg-cyan-950/20 ${selecionada ? 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-200' : 'text-slate-700 dark:text-slate-200'}`}
                        >
                          <span className="min-w-0 truncate">{categoria.nome}</span>
                          <span className="flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                            {categoria.codigo ? <span>{categoria.codigo}</span> : null}
                            {selecionada ? <CheckCircle2 className="h-4 w-4 text-cyan-600" /> : null}
                          </span>
                        </button>
                      );
                    })}

                    {categoriaBusca.trim() && categoriasFiltradas.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-amber-600 dark:text-amber-300">Nenhuma categoria encontrada com esse termo.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">Parcelas para lançamento</h2>
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
                  setPdfFile(null);
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
