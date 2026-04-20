import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Info,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';

import { api, normalizeListResponse } from '../services/api';

type NfeStatus = 'PAGO' | 'ATRASADO' | 'EM_ABERTO';
type SortKey = 'descricao' | 'valor' | 'status' | 'data';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'TODOS' | 'PAGO' | 'ATRASADO' | 'EM_ABERTO';

interface NfeListItem {
  id_parcelamento: string;
  numero_nfe: string;
  chave_nfe?: string | null;
  descricao: string;
  centro_custo_nome?: string | null;
  total_parcelas: number;
  valor_total: number;
  data_vencimento?: string | null;
  status: NfeStatus;
}

interface NfeListResponse {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  items: NfeListItem[];
}

interface NfeNovoForm {
  numero: string;
  serie: string;
  modelo: string;
  chaveNfe: string;
  emitente: string;
  cpfCnpj: string;
  cfop: string;
  naturezaOperacao: string;
  finalidade: string;
  situacao: string;
  dataDocumento: string;
  dataEntrada: string;
  horaEntrada: string;
  dataCriacao: string;
  dataConfirmacao: string;
}

interface EntidadeFornecedorOption {
  id: number;
  nome: string;
  nome_fantasia?: string | null;
  cpf_cnpj?: string | null;
  tipo?: string | null;
}

interface CentroCustoOption {
  id: number;
  nome: string;
  codigo?: string | null;
  status?: string | null;
}

interface NfeDraftItem {
  id: number;
  produtoServico: string;
  qtd: number;
  cfop: string;
  valorUnitario: number;
  desconto: number;
}

interface NfeDraftPagamento {
  id: number;
  formaPagamento: string;
  parcelas: number;
  valor: number;
}

interface ParsedNfeXml {
  form: Partial<NfeNovoForm>;
  itens: Array<Omit<NfeDraftItem, 'id'>>;
  pagamentos: Array<Omit<NfeDraftPagamento, 'id'>>;
}

interface NfeAnaliseItem {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  cfop?: string | null;
  ncm?: string | null;
}

interface NfeAnaliseParcela {
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
  serie: string;
  tipo_lancamento: string;
  data_emissao: string;
  valor_total: number;
  emitente_nome: string;
  emitente_documento: string;
  entidade_sugerida_id?: number | null;
  entidade_sugerida_nome?: string | null;
  plano_contas_sugerido_id?: number | null;
  plano_contas_sugerido_nome?: string | null;
  itens: NfeAnaliseItem[];
  parcelas: NfeAnaliseParcela[];
  alertas: string[];
  pode_confirmar: boolean;
}

interface NfeConfirmarParcelaPayload {
  indice: number;
  numero_parcela: string;
  data_vencimento: string;
  valor: number;
  descricao: string;
  plano_contas_id?: number;
  entidade_id?: number;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function parseXmlNumber(value: string) {
  const normalized = String(value || '').trim().replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function onlyDigits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

function parseXmlDateTime(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return { date: '', time: '' };

  const isoMatch = clean.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (isoMatch) {
    return {
      date: isoMatch[1] || '',
      time: isoMatch[2] || '',
    };
  }

  const compactMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return {
      date: `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`,
      time: '',
    };
  }

  return { date: '', time: '' };
}

function xmlFirstText(parent: Document | Element | null | undefined, ...tagNames: string[]) {
  if (!parent) return '';

  for (const tagName of tagNames) {
    const value = String(parent.getElementsByTagName(tagName)[0]?.textContent || '').trim();
    if (value) return value;
  }

  return '';
}

function mapFinalidadeFromXml(finNFe: string) {
  const normalized = String(finNFe || '').trim().toUpperCase();
  if (normalized === '2' || normalized === 'COMPLEMENTAR') return 'COMPLEMENTAR';
  return 'NORMAL';
}

function mapFormaPagamentoFromTPag(tPag: string) {
  const code = String(tPag || '').trim();
  if (code === '17') return 'PIX';
  if (code === '03') return 'CARTAO_CREDITO';
  if (code === '04') return 'CARTAO_DEBITO';
  if (code === '11' || code === '15') return 'BOLETO';
  if (code === '16' || code === '18') return 'TRANSFERENCIA';
  return 'DINHEIRO';
}

function parseNfeXml(xmlContent: string): ParsedNfeXml {
  const xmlDoc = new DOMParser().parseFromString(xmlContent, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('XML invalido. Verifique o arquivo selecionado.');
  }

  const infNFe = xmlDoc.getElementsByTagName('infNFe')[0];
  if (!infNFe) {
    throw new Error('Arquivo nao parece ser um XML de NF-e valido.');
  }

  const ide = infNFe.getElementsByTagName('ide')[0];
  const emit = infNFe.getElementsByTagName('emit')[0];

  const dhEmi = xmlFirstText(ide, 'dhEmi', 'dEmi');
  const dhSaiEnt = xmlFirstText(ide, 'dhSaiEnt', 'dSaiEnt');
  const dataDocumentoRaw = parseXmlDateTime(dhEmi);
  const dataEntradaRaw = parseXmlDateTime(dhSaiEnt || dhEmi);

  const detNodes = Array.from(infNFe.getElementsByTagName('det'));
  const itens = detNodes
    .map((det) => {
      const prod = det.getElementsByTagName('prod')[0];
      if (!prod) return null;

      const qtd = parseXmlNumber(xmlFirstText(prod, 'qCom', 'qTrib'));
      const valorUnitario = parseXmlNumber(xmlFirstText(prod, 'vUnCom', 'vUnTrib'));
      const desconto = parseXmlNumber(xmlFirstText(prod, 'vDesc'));

      return {
        produtoServico: xmlFirstText(prod, 'xProd'),
        qtd: qtd > 0 ? qtd : 1,
        cfop: xmlFirstText(prod, 'CFOP'),
        valorUnitario,
        desconto,
      };
    })
    .filter((item): item is Omit<NfeDraftItem, 'id'> => Boolean(item));

  const detPagNodes = Array.from(infNFe.getElementsByTagName('detPag'));
  let pagamentos = detPagNodes
    .map((detPag) => ({
      formaPagamento: mapFormaPagamentoFromTPag(xmlFirstText(detPag, 'tPag')),
      parcelas: 1,
      valor: parseXmlNumber(xmlFirstText(detPag, 'vPag')),
    }))
    .filter((item) => item.valor > 0);

  if (pagamentos.length === 0) {
    pagamentos = Array.from(infNFe.getElementsByTagName('dup'))
      .map((dup) => ({
        formaPagamento: 'BOLETO',
        parcelas: 1,
        valor: parseXmlNumber(xmlFirstText(dup, 'vDup')),
      }))
      .filter((item) => item.valor > 0);
  }

  if (pagamentos.length === 0) {
    const valorTotalNf = parseXmlNumber(xmlFirstText(infNFe, 'vNF'));
    if (valorTotalNf > 0) {
      pagamentos = [{
        formaPagamento: 'DINHEIRO',
        parcelas: 1,
        valor: valorTotalNf,
      }];
    }
  }

  const chaveDaNfe = xmlFirstText(xmlDoc, 'chNFe');
  const chaveViaAtributo = String(infNFe.getAttribute('Id') || '').trim();
  const chaveNfe = chaveDaNfe || (chaveViaAtributo.toUpperCase().startsWith('NFE') ? chaveViaAtributo.slice(3) : chaveViaAtributo);

  const form: Partial<NfeNovoForm> = {
    numero: xmlFirstText(ide, 'nNF'),
    serie: xmlFirstText(ide, 'serie') || '0',
    modelo: xmlFirstText(ide, 'mod') || '55',
    chaveNfe,
    emitente: xmlFirstText(emit, 'xNome', 'xFant'),
    cpfCnpj: xmlFirstText(emit, 'CNPJ', 'CPF'),
    cfop: itens.find((item) => item.cfop)?.cfop || '',
    naturezaOperacao: xmlFirstText(ide, 'natOp'),
    finalidade: mapFinalidadeFromXml(xmlFirstText(ide, 'finNFe')),
    situacao: 'AGUARDANDO_ENTREGA',
    dataDocumento: dataDocumentoRaw.date || todayISODate(),
    dataEntrada: dataEntradaRaw.date || dataDocumentoRaw.date || '',
    horaEntrada: dataEntradaRaw.time || dataDocumentoRaw.time || '',
    dataCriacao: todayISODate(),
    dataConfirmacao: '',
  };

  return {
    form,
    itens,
    pagamentos,
  };
}

function createDefaultNovoForm(): NfeNovoForm {
  const hoje = todayISODate();
  return {
    numero: '',
    serie: '0',
    modelo: '55',
    chaveNfe: '',
    emitente: '',
    cpfCnpj: '',
    cfop: '',
    naturezaOperacao: '',
    finalidade: 'NORMAL',
    situacao: 'AGUARDANDO_ENTREGA',
    dataDocumento: hoje,
    dataEntrada: '',
    horaEntrada: '',
    dataCriacao: hoje,
    dataConfirmacao: '',
  };
}

function normalizeSearchText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isFornecedorTipo(tipo?: string | null) {
  const normalized = String(tipo || '').trim().toUpperCase();
  return normalized === 'FORNECEDOR' || normalized === 'AMBOS';
}

function formatFornecedorLabel(item: EntidadeFornecedorOption) {
  const fantasia = String(item.nome_fantasia || '').trim();
  if (!fantasia) return item.nome;
  if (fantasia.toLowerCase() === String(item.nome || '').trim().toLowerCase()) return item.nome;
  return `${item.nome} (${fantasia})`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('pt-BR');
}

function statusLabel(status: NfeStatus) {
  if (status === 'EM_ABERTO') return 'EM ABERTO';
  return status;
}

function statusClasses(status: NfeStatus) {
  if (status === 'PAGO') {
    return 'bg-emerald-200/90 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
  }
  if (status === 'ATRASADO') {
    return 'bg-red-200/90 dark:bg-red-900/35 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800';
  }
  return 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600';
}

function rowClasses(status: NfeStatus) {
  if (status === 'PAGO') return 'bg-emerald-100/70 dark:bg-emerald-900/25';
  if (status === 'ATRASADO') return 'bg-red-200/80 dark:bg-red-900/40';
  return '';
}

function nextSortDirection(currentKey: SortKey, currentDir: SortDirection, clickedKey: SortKey): SortDirection {
  if (currentKey !== clickedKey) {
    return clickedKey === 'descricao' ? 'asc' : 'desc';
  }
  return currentDir === 'asc' ? 'desc' : 'asc';
}

function sortIconClass(active: boolean, dir: SortDirection) {
  if (!active) return 'h-3.5 w-3.5 text-slate-300';
  return `h-3.5 w-3.5 transition ${dir === 'asc' ? 'rotate-180 text-blue-500' : 'text-blue-500'}`;
}

export function ImportacaoNfe() {
  const [items, setItems] = useState<NfeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [sortKey, setSortKey] = useState<SortKey>('data');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [mostrarNovoFormulario, setMostrarNovoFormulario] = useState(false);
  const [novoForm, setNovoForm] = useState<NfeNovoForm>(createDefaultNovoForm);
  const [fornecedores, setFornecedores] = useState<EntidadeFornecedorOption[]>([]);
  const [loadingFornecedores, setLoadingFornecedores] = useState(false);
  const [erroFornecedores, setErroFornecedores] = useState<string | null>(null);
  const [centrosCusto, setCentrosCusto] = useState<CentroCustoOption[]>([]);
  const [loadingCentrosCusto, setLoadingCentrosCusto] = useState(false);
  const [erroCentrosCusto, setErroCentrosCusto] = useState<string | null>(null);
  const [centroCustoSelecionadoId, setCentroCustoSelecionadoId] = useState<number | null>(null);
  const [mostrarSugestoesEmitente, setMostrarSugestoesEmitente] = useState(false);
  const [emitenteSelecionadoId, setEmitenteSelecionadoId] = useState<number | null>(null);
  const [itensNota, setItensNota] = useState<NfeDraftItem[]>([]);
  const [pagamentosNota, setPagamentosNota] = useState<NfeDraftPagamento[]>([]);
  const [pdfAnexo, setPdfAnexo] = useState<File | null>(null);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [importandoXml, setImportandoXml] = useState(false);
  const [confirmandoImportacao, setConfirmandoImportacao] = useState(false);
  const [analiseNfe, setAnaliseNfe] = useState<NfeAnaliseResponse | null>(null);
  const draftIdRef = useRef(1);
  const importXmlInputRef = useRef<HTMLInputElement | null>(null);

  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearchTerm(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const carregarLista = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get<NfeListResponse>('/importacao/nfe/list', {
        params: {
          page,
          page_size: pageSize,
          search: searchTerm || undefined,
          status: statusFilter,
          order_by: sortKey,
          order_dir: sortDirection,
        },
      });

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotalItems(Number(data.total_items || 0));
      setTotalPages(Math.max(1, Number(data.total_pages || 1)));
      if (Number(data.page || page) !== page) {
        setPage(Number(data.page || 1));
      }
    } catch (err: any) {
      setItems([]);
      setTotalItems(0);
      setTotalPages(1);
      setError(err?.response?.data?.detail || 'Erro ao carregar a listagem de NF-e.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchTerm, sortDirection, sortKey, statusFilter]);

  useEffect(() => {
    void carregarLista();
  }, [carregarLista, refreshToken]);

  useEffect(() => {
    if (!mostrarNovoFormulario) {
      setMostrarSugestoesEmitente(false);
      return;
    }

    let ativo = true;

    async function carregarFornecedores() {
      setLoadingFornecedores(true);
      setErroFornecedores(null);
      try {
        const { data } = await api.get<EntidadeFornecedorOption[]>('/entidades/');
        if (!ativo) return;

        const fornecedoresFiltrados = normalizeListResponse<EntidadeFornecedorOption>(data)
          .filter((item) => isFornecedorTipo(item.tipo))
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

        setFornecedores(fornecedoresFiltrados);
      } catch {
        if (!ativo) return;
        setFornecedores([]);
        setErroFornecedores('Nao foi possivel carregar os fornecedores.');
      } finally {
        if (ativo) setLoadingFornecedores(false);
      }
    }

    void carregarFornecedores();

    return () => {
      ativo = false;
    };
  }, [mostrarNovoFormulario]);

  useEffect(() => {
    if (!mostrarNovoFormulario) return;

    let ativo = true;

    async function carregarCentrosCusto() {
      setLoadingCentrosCusto(true);
      setErroCentrosCusto(null);
      try {
        const { data } = await api.get<CentroCustoOption[]>('/centro-custo/');
        if (!ativo) return;

        const centrosAtivos = normalizeListResponse<CentroCustoOption>(data)
          .filter((item) => String(item.status || 'ATIVO').trim().toUpperCase() === 'ATIVO')
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

        setCentrosCusto(centrosAtivos);
        setCentroCustoSelecionadoId((atual) => {
          if (atual && centrosAtivos.some((item) => item.id === atual)) return atual;
          const principal = centrosAtivos.find((item) => normalizeSearchText(item.nome) === 'principal');
          if (principal) return principal.id;
          return centrosAtivos.length === 1 ? centrosAtivos[0].id : null;
        });
      } catch {
        if (!ativo) return;
        setCentrosCusto([]);
        setErroCentrosCusto('Nao foi possivel carregar os centros de custo.');
      } finally {
        if (ativo) setLoadingCentrosCusto(false);
      }
    }

    void carregarCentrosCusto();

    return () => {
      ativo = false;
    };
  }, [mostrarNovoFormulario]);

  const rangeInfo = useMemo(() => {
    if (totalItems === 0) {
      return { start: 0, end: 0 };
    }
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalItems);
    return { start, end };
  }, [page, pageSize, totalItems]);

  const fornecedoresFiltrados = useMemo(() => {
    const termo = normalizeSearchText(novoForm.emitente);
    if (!termo) return fornecedores.slice(0, 20);

    return fornecedores
      .filter((item) => {
        const nome = normalizeSearchText(item.nome);
        const fantasia = normalizeSearchText(String(item.nome_fantasia || ''));
        const documento = String(item.cpf_cnpj || '').replace(/\D/g, '');
        const termoNumerico = termo.replace(/\D/g, '');

        return nome.includes(termo)
          || fantasia.includes(termo)
          || (termoNumerico.length > 0 && documento.includes(termoNumerico));
      })
      .slice(0, 20);
  }, [fornecedores, novoForm.emitente]);

  function toggleSort(clickedKey: SortKey) {
    const nextDirection = nextSortDirection(sortKey, sortDirection, clickedKey);
    setSortKey(clickedKey);
    setSortDirection(nextDirection);
    setPage(1);
  }

  function resetFiltros() {
    setSearchInput('');
    setSearchTerm('');
    setStatusFilter('TODOS');
    setSortKey('data');
    setSortDirection('desc');
    setPage(1);
  }

  function irPaginaAnterior() {
    setPage((prev) => Math.max(1, prev - 1));
  }

  function irProximaPagina() {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }

  function abrirNovoFormulario() {
    setNovoForm(createDefaultNovoForm());
    setAnaliseNfe(null);
    setCentroCustoSelecionadoId(null);
    setEmitenteSelecionadoId(null);
    setMostrarSugestoesEmitente(false);
    setItensNota([]);
    setPagamentosNota([]);
    setPdfAnexo(null);
    setErroPdf(null);
    draftIdRef.current = 1;
    setMostrarNovoFormulario(true);
  }

  function fecharFormulario() {
    setAnaliseNfe(null);
    setMostrarNovoFormulario(false);
  }

  async function confirmarFormulario() {
    if (!analiseNfe) {
      setMostrarNovoFormulario(false);
      return;
    }

    if (centrosCusto.length > 0 && !centroCustoSelecionadoId) {
      setError('Selecione o centro de custo da NF-e antes de confirmar.');
      return;
    }

    const tipoLancamento = String(analiseNfe.tipo_lancamento || 'DESPESA').trim().toUpperCase();
    if (tipoLancamento !== 'DESPESA') {
      setError('A NF-e analisada nao pode ser confirmada porque o tipo de lancamento nao e DESPESA.');
      return;
    }

    if (!analiseNfe.pode_confirmar || analiseNfe.parcelas.length === 0) {
      setError('A analise do XML nao retornou parcelas para confirmar a importacao.');
      return;
    }

    const parcelasPayload: NfeConfirmarParcelaPayload[] = analiseNfe.parcelas.map((parcela, index) => {
      const valorEditado = Number(pagamentosNota[index]?.valor || 0);
      const valorParcela = valorEditado > 0 ? valorEditado : Number(parcela.valor || 0);

      return {
        indice: Number(parcela.indice || index + 1),
        numero_parcela: String(parcela.numero_parcela || index + 1),
        data_vencimento: String(parcela.data_vencimento || novoForm.dataDocumento || todayISODate()),
        valor: valorParcela,
        descricao: String(parcela.descricao || '').trim() || `NFE: (${novoForm.numero || analiseNfe.numero_nfe}) Parcela ${index + 1}/${analiseNfe.parcelas.length}`,
        plano_contas_id: Number(parcela.plano_contas_sugerido_id || analiseNfe.plano_contas_sugerido_id || 0) || undefined,
        entidade_id: Number(emitenteSelecionadoId || parcela.entidade_sugerida_id || analiseNfe.entidade_sugerida_id || 0) || undefined,
      };
    }).filter((parcela) => parcela.valor > 0);

    if (parcelasPayload.length === 0) {
      setError('Nao foi possivel confirmar: nenhuma parcela com valor valido.');
      return;
    }

    setConfirmandoImportacao(true);
    setError(null);

    try {
      await api.post('/importacao/nfe/confirmar', {
        chave_nfe: onlyDigits(novoForm.chaveNfe || analiseNfe.chave_nfe),
        numero_nfe: String(novoForm.numero || analiseNfe.numero_nfe || '').trim(),
        tipo_lancamento: tipoLancamento,
        data_emissao: String(novoForm.dataDocumento || analiseNfe.data_emissao || todayISODate()),
        emitente_nome: String(novoForm.emitente || analiseNfe.emitente_nome || '').trim() || undefined,
        emitente_documento: onlyDigits(novoForm.cpfCnpj || analiseNfe.emitente_documento || ''),
        entidade_id: Number(emitenteSelecionadoId || analiseNfe.entidade_sugerida_id || 0) || undefined,
        plano_contas_id: Number(analiseNfe.plano_contas_sugerido_id || 0) || undefined,
        centro_custo_id: Number(centroCustoSelecionadoId || 0) || undefined,
        observacao: `NF-e ${novoForm.numero || analiseNfe.numero_nfe} | Chave ${onlyDigits(novoForm.chaveNfe || analiseNfe.chave_nfe)}`,
        parcelas: parcelasPayload,
      });

      fecharFormulario();
      setRefreshToken((prev) => prev + 1);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Nao foi possivel confirmar a importacao da NF-e.');
    } finally {
      setConfirmandoImportacao(false);
    }
  }

  function confirmarEntregaInfGerais() {
    setNovoForm((prev) => ({
      ...prev,
      situacao: 'ENTREGUE',
      dataConfirmacao: todayISODate(),
    }));
  }

  function atualizarNovoForm<K extends keyof NfeNovoForm>(campo: K, valor: NfeNovoForm[K]) {
    setNovoForm((prev) => ({ ...prev, [campo]: valor }));
  }

  function handleEmitenteChange(value: string) {
    setEmitenteSelecionadoId(null);
    setMostrarSugestoesEmitente(true);
    setNovoForm((prev) => ({
      ...prev,
      emitente: value,
      cpfCnpj: '',
    }));
  }

  function selecionarEmitente(item: EntidadeFornecedorOption) {
    setEmitenteSelecionadoId(item.id);
    setNovoForm((prev) => ({
      ...prev,
      emitente: formatFornecedorLabel(item),
      cpfCnpj: String(item.cpf_cnpj || ''),
    }));
    setMostrarSugestoesEmitente(false);
  }

  function proximoDraftId() {
    const nextId = draftIdRef.current;
    draftIdRef.current += 1;
    return nextId;
  }

  function parseNumericInput(value: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function subtotalItem(item: NfeDraftItem) {
    return Math.max(0, (item.qtd || 0) * (item.valorUnitario || 0) - (item.desconto || 0));
  }

  function adicionarNovoItem() {
    setItensNota((prev) => ([
      ...prev,
      {
        id: proximoDraftId(),
        produtoServico: '',
        qtd: 1,
        cfop: novoForm.cfop || '',
        valorUnitario: 0,
        desconto: 0,
      },
    ]));
  }

  function atualizarItem<K extends keyof NfeDraftItem>(id: number, campo: K, valor: NfeDraftItem[K]) {
    setItensNota((prev) => prev.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)));
  }

  function adicionarNovoPagamento() {
    setPagamentosNota((prev) => ([
      ...prev,
      {
        id: proximoDraftId(),
        formaPagamento: 'DINHEIRO',
        parcelas: 1,
        valor: 0,
      },
    ]));
  }

  function atualizarPagamento<K extends keyof NfeDraftPagamento>(id: number, campo: K, valor: NfeDraftPagamento[K]) {
    setPagamentosNota((prev) => prev.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)));
  }

  function anexarPdf(file: File | null) {
    if (!file) return;
    const nome = String(file.name || '').toLowerCase();
    const isPdf = file.type === 'application/pdf' || nome.endsWith('.pdf');
    if (!isPdf) {
      setErroPdf('Selecione um arquivo PDF valido.');
      return;
    }
    setErroPdf(null);
    setPdfAnexo(file);
  }

  function abrirSeletorXml() {
    if (importandoXml) return;
    importXmlInputRef.current?.click();
  }

  async function importarXmlParaFormulario(file: File | null) {
    if (!file) return;

    const nome = String(file.name || '').toLowerCase();
    const isXml = file.type.includes('xml') || nome.endsWith('.xml');
    if (!isXml) {
      setError('Selecione um arquivo XML valido.');
      return;
    }

    setImportandoXml(true);
    setError(null);
    setAnaliseNfe(null);

    try {
      const formData = new FormData();
      formData.append('arquivo', file);

      const { data: analise } = await api.post<NfeAnaliseResponse>('/importacao/nfe/analisar', formData);
      if (!analise?.chave_nfe) {
        throw new Error('Nao foi possivel analisar o XML selecionado.');
      }

      const xmlContent = await file.text();
      const parsed = parseNfeXml(xmlContent);

      const itensDaAnalise: Array<Omit<NfeDraftItem, 'id'>> = Array.isArray(analise.itens)
        ? analise.itens.map((item) => ({
          produtoServico: String(item.descricao || '').trim() || 'Item',
          qtd: Number(item.quantidade || 0) > 0 ? Number(item.quantidade) : 1,
          cfop: String(item.cfop || '').trim(),
          valorUnitario: Number(item.valor_unitario || 0),
          desconto: 0,
        }))
        : [];

      const pagamentosDaAnalise: Array<Omit<NfeDraftPagamento, 'id'>> = Array.isArray(analise.parcelas)
        ? analise.parcelas
          .map((parcela) => ({
            formaPagamento: 'BOLETO',
            parcelas: 1,
            valor: Number(parcela.valor || 0),
          }))
          .filter((pagamento) => pagamento.valor > 0)
        : [];

      const itensFonte = itensDaAnalise.length > 0 ? itensDaAnalise : parsed.itens;
      const pagamentosFonte = pagamentosDaAnalise.length > 0 ? pagamentosDaAnalise : parsed.pagamentos;

      let nextId = 1;
      const itensImportados: NfeDraftItem[] = itensFonte.map((item) => ({
        ...item,
        id: nextId++,
      }));
      const pagamentosImportados: NfeDraftPagamento[] = pagamentosFonte.map((item) => ({
        ...item,
        id: nextId++,
      }));

      setNovoForm({
        ...createDefaultNovoForm(),
        ...parsed.form,
        numero: String(analise.numero_nfe || parsed.form.numero || '').trim(),
        serie: String(analise.serie || parsed.form.serie || '0').trim(),
        chaveNfe: String(analise.chave_nfe || parsed.form.chaveNfe || '').trim(),
        emitente: String(analise.emitente_nome || parsed.form.emitente || '').trim(),
        cpfCnpj: String(analise.emitente_documento || parsed.form.cpfCnpj || '').trim(),
        dataDocumento: String(analise.data_emissao || parsed.form.dataDocumento || todayISODate()).slice(0, 10),
      });

      setAnaliseNfe(analise);
      setCentroCustoSelecionadoId(null);
      setEmitenteSelecionadoId(null);
      setMostrarSugestoesEmitente(false);
      setItensNota(itensImportados);
      setPagamentosNota(pagamentosImportados);
      setPdfAnexo(null);
      setErroPdf(null);
      draftIdRef.current = nextId;
      setMostrarNovoFormulario(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel importar o XML da NF-e.';
      setError(message);
    } finally {
      setImportandoXml(false);
    }
  }

  const labelClassName = 'mb-1 flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200';
  const inputClassName = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
  const tableInputClassName = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <div className="flex min-h-[calc(100vh-140px)] flex-col gap-3 text-slate-800 dark:text-slate-100">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center">
          {!mostrarNovoFormulario ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1 shadow-inner dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={irPaginaAnterior}
                    disabled={page <= 1 || loading}
                    className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="w-36 pt-1 text-center text-xs font-bold uppercase text-slate-800 dark:text-white">
                    pagina {page} de {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={irProximaPagina}
                    disabled={page >= totalPages || loading}
                    className="rounded-md p-1.5 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setRefreshToken((prev) => prev + 1)}
                  className="rounded-lg border border-slate-300 p-2 text-slate-500 transition hover:border-blue-500 hover:text-blue-500 dark:border-slate-600 dark:text-slate-300"
                  title="Atualizar listagem"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="relative min-w-0 flex-1 xl:max-w-2xl">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar descricao, numero da NF-e, chave ou interessado"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="flex w-full items-center gap-2 overflow-x-auto xl:ml-auto xl:w-auto xl:justify-end">
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="TODOS">Todos os status</option>
                  <option value="EM_ABERTO">Em aberto</option>
                  <option value="ATRASADO">Atrasado</option>
                  <option value="PAGO">Pago</option>
                </select>

                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size} por pagina</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={resetFiltros}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <Filter className="h-4 w-4" />
                  Limpar
                </button>

              <button
                type="button"
                onClick={abrirNovoFormulario}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                Novo
              </button>

              <button
                type="button"
                onClick={abrirSeletorXml}
                disabled={importandoXml}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Plus className="h-4 w-4" />
                {importandoXml ? 'Importando XML...' : 'Importar XML'}
              </button>

              <input
                ref={importXmlInputRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                className="hidden"
                onChange={(event) => {
                  void importarXmlParaFormulario(event.target.files?.[0] || null);
                  event.currentTarget.value = '';
                }}
              />
              </div>
            </>
          ) : (
            <div className="flex w-full items-center justify-end gap-2">
              <button
                type="button"
                onClick={fecharFormulario}
                disabled={confirmandoImportacao}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Voltar
              </button>

              <button
                type="button"
                onClick={confirmarEntregaInfGerais}
                disabled={novoForm.situacao === 'ENTREGUE' || confirmandoImportacao}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {novoForm.situacao === 'ENTREGUE' ? 'Entrega confirmada' : 'Confirmar entrega'}
              </button>

              <button
                type="button"
                onClick={confirmarFormulario}
                disabled={confirmandoImportacao}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {confirmandoImportacao ? 'Confirmando...' : 'Confirmar'}
              </button>
            </div>
          )}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {mostrarNovoFormulario ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-blue-300 bg-white p-4 shadow-sm dark:border-blue-800 dark:bg-slate-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Dados Fiscais</h2>
                <span className="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white">Em digitacao</span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label>
                <span className={labelClassName}><span className="text-rose-500">*</span>Numero</span>
                <input className={inputClassName} value={novoForm.numero} onChange={(event) => atualizarNovoForm('numero', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}><span className="text-rose-500">*</span>Serie</span>
                <input className={inputClassName} value={novoForm.serie} onChange={(event) => atualizarNovoForm('serie', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}>Modelo</span>
                <select className={inputClassName} value={novoForm.modelo} onChange={(event) => atualizarNovoForm('modelo', event.target.value)}>
                  <option value="55">55</option>
                  <option value="65">65</option>
                </select>
              </label>

              <label className="md:col-span-3">
                <span className={labelClassName}><span className="text-rose-500">*</span>Chave NF-e</span>
                <input className={inputClassName} value={novoForm.chaveNfe} onChange={(event) => atualizarNovoForm('chaveNfe', event.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Inf. Gerais</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-6">
              <label className="md:col-span-4">
                <span className={labelClassName}><span className="text-rose-500">*</span>Emitente</span>
                <div className="relative">
                  <input
                    className={inputClassName}
                    placeholder="Selecione um fornecedor..."
                    value={novoForm.emitente}
                    onFocus={() => setMostrarSugestoesEmitente(true)}
                    onBlur={() => {
                      window.setTimeout(() => setMostrarSugestoesEmitente(false), 120);
                    }}
                    onChange={(event) => handleEmitenteChange(event.target.value)}
                  />

                  {mostrarSugestoesEmitente ? (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {loadingFornecedores ? (
                        <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Carregando fornecedores...</div>
                      ) : null}

                      {!loadingFornecedores && fornecedoresFiltrados.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">Nenhum fornecedor encontrado.</div>
                      ) : null}

                      {!loadingFornecedores && fornecedoresFiltrados.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            selecionarEmitente(item);
                          }}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800 ${emitenteSelecionadoId === item.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                        >
                          <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{formatFornecedorLabel(item)}</span>
                          <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{item.cpf_cnpj || '-'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {erroFornecedores ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{erroFornecedores}</p> : null}
              </label>

              <label className="md:col-span-2">
                <span className={labelClassName}>CPF/CNPJ</span>
                <input className={inputClassName} value={novoForm.cpfCnpj} onChange={(event) => atualizarNovoForm('cpfCnpj', event.target.value)} />
              </label>

              <label className="md:col-span-1">
                <span className={labelClassName}><span className="text-rose-500">*</span>CFOP</span>
                <input className={inputClassName} value={novoForm.cfop} onChange={(event) => atualizarNovoForm('cfop', event.target.value)} />
              </label>

              <label className="md:col-span-5">
                <span className={labelClassName}>Natureza da operacao</span>
                <input className={inputClassName} value={novoForm.naturezaOperacao} onChange={(event) => atualizarNovoForm('naturezaOperacao', event.target.value)} />
              </label>

              <label className="md:col-span-3">
                <span className={labelClassName}>Finalidade</span>
                <select className={inputClassName} value={novoForm.finalidade} onChange={(event) => atualizarNovoForm('finalidade', event.target.value)}>
                  <option value="NORMAL">Normal</option>
                  <option value="COMPLEMENTAR">Complementar</option>
                </select>
              </label>

              <label className="md:col-span-3">
                <span className={labelClassName}>Situacao</span>
                <select className={inputClassName} value={novoForm.situacao} onChange={(event) => atualizarNovoForm('situacao', event.target.value)}>
                  <option value="AGUARDANDO_ENTREGA">Aguardando Entrega</option>
                  <option value="ENTREGUE">Entregue</option>
                  <option value="CANCELADA">Cancelada</option>
                </select>
              </label>

              <div className="md:col-span-6">
                <span className={labelClassName}>Centro de custo da NF-e</span>
                {loadingCentrosCusto ? (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carregando centros de custo...
                  </div>
                ) : null}

                {!loadingCentrosCusto && centrosCusto.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    Nenhum centro de custo ativo encontrado.
                  </div>
                ) : null}

                {!loadingCentrosCusto && centrosCusto.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {centrosCusto.map((centro) => {
                      const ativo = centroCustoSelecionadoId === centro.id;
                      return (
                        <button
                          key={centro.id}
                          type="button"
                          onClick={() => setCentroCustoSelecionadoId(centro.id)}
                          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${ativo ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                        >
                          {centro.nome}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {erroCentrosCusto ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{erroCentrosCusto}</p> : null}
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">O mesmo centro de custo selecionado aqui sera aplicado em todos os lancamentos financeiros da NF-e.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-5">
              <label>
                <span className={labelClassName}>
                  <span className="text-rose-500">*</span>
                  Data documento
                  <Info className="h-3.5 w-3.5 text-blue-500" />
                </span>
                <input type="date" className={inputClassName} value={novoForm.dataDocumento} onChange={(event) => atualizarNovoForm('dataDocumento', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}><span className="text-rose-500">*</span>Data entrada</span>
                <input type="date" className={inputClassName} value={novoForm.dataEntrada} onChange={(event) => atualizarNovoForm('dataEntrada', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}>Hora entrada</span>
                <input type="time" className={inputClassName} value={novoForm.horaEntrada} onChange={(event) => atualizarNovoForm('horaEntrada', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}><span className="text-rose-500">*</span>Data Criacao</span>
                <input type="date" className={inputClassName} value={novoForm.dataCriacao} onChange={(event) => atualizarNovoForm('dataCriacao', event.target.value)} />
              </label>

              <label>
                <span className={labelClassName}>
                  Data Confirmacao
                  <Info className="h-3.5 w-3.5 text-blue-500" />
                </span>
                <input type="date" className={inputClassName} value={novoForm.dataConfirmacao} onChange={(event) => atualizarNovoForm('dataConfirmacao', event.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Itens</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={adicionarNovoItem}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-500"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar novo item
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 dark:border-slate-700">
                  <tr>
                    <th className="px-2 py-2">Item</th>
                    <th className="px-2 py-2">Produto/servico</th>
                    <th className="px-2 py-2">Qtd</th>
                    <th className="px-2 py-2">CFOP</th>
                    <th className="px-2 py-2 text-right">Valor un</th>
                    <th className="px-2 py-2 text-right">Subtotal</th>
                    <th className="px-2 py-2 text-right">Desconto</th>
                  </tr>
                </thead>
                <tbody>
                  {itensNota.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-2 py-8 text-center text-slate-400">Sem dados</td>
                    </tr>
                  ) : itensNota.map((item, index) => (
                    <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <td className="px-2 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">{index + 1}</td>
                      <td className="px-2 py-2">
                        <input
                          className={tableInputClassName}
                          value={item.produtoServico}
                          onChange={(event) => atualizarItem(item.id, 'produtoServico', event.target.value)}
                          placeholder="Digite o produto/servico"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step="1"
                          className={tableInputClassName}
                          value={item.qtd}
                          onChange={(event) => atualizarItem(item.id, 'qtd', parseNumericInput(event.target.value))}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className={tableInputClassName}
                          value={item.cfop}
                          onChange={(event) => atualizarItem(item.id, 'cfop', event.target.value)}
                          placeholder="CFOP"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={tableInputClassName}
                          value={item.valorUnitario}
                          onChange={(event) => atualizarItem(item.id, 'valorUnitario', parseNumericInput(event.target.value))}
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-slate-700 dark:text-slate-200">
                        {formatCurrency(subtotalItem(item))}
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={tableInputClassName}
                          value={item.desconto}
                          onChange={(event) => atualizarItem(item.id, 'desconto', parseNumericInput(event.target.value))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">{itensNota.length} item(ns)</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Faturamento</h3>
              <button
                type="button"
                onClick={adicionarNovoPagamento}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-500"
              >
                <Plus className="h-4 w-4" />
                Novo pagamento
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 dark:border-slate-700">
                  <tr>
                    <th className="px-2 py-2">Item</th>
                    <th className="px-2 py-2">Forma de pagamento</th>
                    <th className="px-2 py-2 text-center">Parcelas</th>
                    <th className="px-2 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {pagamentosNota.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-slate-400">Sem dados</td>
                    </tr>
                  ) : pagamentosNota.map((pagamento, index) => (
                    <tr key={pagamento.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <td className="px-2 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">{index + 1}</td>
                      <td className="px-2 py-2">
                        <select
                          className={tableInputClassName}
                          value={pagamento.formaPagamento}
                          onChange={(event) => atualizarPagamento(pagamento.id, 'formaPagamento', event.target.value)}
                        >
                          <option value="DINHEIRO">Dinheiro</option>
                          <option value="PIX">PIX</option>
                          <option value="CARTAO_CREDITO">Cartao de credito</option>
                          <option value="CARTAO_DEBITO">Cartao de debito</option>
                          <option value="BOLETO">Boleto</option>
                          <option value="TRANSFERENCIA">Transferencia</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={1}
                          step="1"
                          className={tableInputClassName}
                          value={pagamento.parcelas}
                          onChange={(event) => atualizarPagamento(pagamento.id, 'parcelas', Math.max(1, parseNumericInput(event.target.value)))}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={tableInputClassName}
                          value={pagamento.valor}
                          onChange={(event) => atualizarPagamento(pagamento.id, 'valor', parseNumericInput(event.target.value))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Anexo PDF</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Anexe o PDF da nota fiscal para conferencias futuras.</p>
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-blue-500 dark:border-slate-700 dark:bg-slate-900">
              <Paperclip className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                {pdfAnexo ? pdfAnexo.name : 'Clique para selecionar um arquivo PDF'}
              </span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(event) => {
                  anexarPdf(event.target.files?.[0] || null);
                  event.currentTarget.value = '';
                }}
              />
            </label>

            {erroPdf ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{erroPdf}</p> : null}
            {pdfAnexo ? (
              <button
                type="button"
                onClick={() => setPdfAnexo(null)}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Remover PDF
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 dark:bg-slate-900/40">
                  <tr>
                    <th className="w-28 p-2.5 text-center">
                      <span className="inline-flex items-center px-1 py-0.5">Numero</span>
                    </th>
                    <th className="w-[42%] p-2.5" aria-sort={sortKey === 'descricao' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => toggleSort('descricao')}
                        className="group inline-flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Descricao</span>
                        <ChevronDown className={sortIconClass(sortKey === 'descricao', sortDirection)} />
                      </button>
                    </th>
                    <th className="w-36 p-2.5 text-right" aria-sort={sortKey === 'valor' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => toggleSort('valor')}
                        className="group inline-flex w-full items-center justify-end gap-1 rounded-md px-1 py-0.5 text-right transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Valor</span>
                        <ChevronDown className={sortIconClass(sortKey === 'valor', sortDirection)} />
                      </button>
                    </th>
                    <th className="w-32 p-2.5 text-center" aria-sort={sortKey === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => toggleSort('status')}
                        className="group inline-flex w-full items-center justify-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>Status</span>
                        <ChevronDown className={sortIconClass(sortKey === 'status', sortDirection)} />
                      </button>
                    </th>
                    <th className="w-56 p-2.5">
                      <span className="inline-flex items-center px-1 py-0.5">Centro de custo</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200 text-[15px] dark:divide-slate-700">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Carregando NF-e...
                        </span>
                      </td>
                    </tr>
                  ) : null}

                  {!loading && items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        Nenhuma NF-e encontrada para os filtros atuais.
                      </td>
                    </tr>
                  ) : null}

                  {!loading && items.map((item) => (
                    <tr key={item.id_parcelamento} className={`transition hover:bg-slate-50 dark:hover:bg-slate-700/50 ${rowClasses(item.status)}`}>
                      <td className="p-2.5 text-center align-middle font-bold text-slate-700 dark:text-slate-200">
                        {item.numero_nfe || '-'}
                      </td>

                      <td className="p-2.5 align-middle font-semibold text-slate-800 dark:text-white">
                        <div className="min-w-0 truncate">{item.descricao}</div>
                        <div className="mt-0.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          Chave: {item.chave_nfe || 'nao informada'} • Parcelas: {item.total_parcelas} • Venc.: {formatDate(item.data_vencimento)}
                        </div>
                      </td>

                      <td className="p-2.5 text-right align-middle font-bold tabular-nums text-red-500 dark:text-red-300">
                        {formatCurrency(item.valor_total)}
                      </td>

                      <td className="p-2.5 text-center align-middle">
                        <span className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase border ${statusClasses(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>

                      <td className="p-2.5 align-middle">
                        <div className="truncate text-sm font-semibold text-slate-700 dark:text-slate-300">{item.centro_custo_nome || '-'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-slate-500 dark:text-slate-400">
              Mostrando {rangeInfo.start}-{rangeInfo.end} de {totalItems} NF-e
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={irPaginaAnterior}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Anterior
              </button>

              <span className="min-w-[92px] text-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                Pagina {page}/{totalPages}
              </span>

              <button
                type="button"
                onClick={irProximaPagina}
                disabled={page >= totalPages || loading}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Proxima
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
