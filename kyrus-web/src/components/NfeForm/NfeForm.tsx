import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Edit2,
  ExternalLink,
  FileText,
  Filter,
  Info,
  LinkIcon,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Package,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  TrendingDown,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import { SearchableSelect } from '../SearchableSelect';
import { toast } from 'sonner';

import { useKyrusWsListener } from '../../hooks/useKyrusWebSocket';
import { api, normalizeListResponse, toPublicAssetUrl } from '../../services/api';

type NfeStatus = 'AGUARDANDO_ENTREGA' | 'ENTREGUE' | 'CANCELADA' | 'DEMONSTRACAO';
type SortKey = 'descricao' | 'valor' | 'status' | 'data';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'TODOS' | 'AGUARDANDO_ENTREGA' | 'ENTREGUE' | 'CANCELADA' | 'DEMONSTRACAO';
type FormMode = 'NOVO' | 'EDITAR';

interface CategoriaItem {
  id: number;
  nome: string;
  tipo?: string;
  codigo?: string | null;
  eh_cabecalho?: boolean;
  permite_lancamentos?: boolean;
}

interface NfeListItem {
  id_parcelamento: string;
  numero_nfe: string;
  chave_nfe?: string | null;
  descricao: string;
  emitente_nome?: string | null;
  emitente_documento?: string | null;
  centro_custo_nome?: string | null;
  total_parcelas: number;
  valor_total: number;
  data_emissao?: string | null;
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
  destinoCompra: string;
  transportadora: string;
  valorFrete: string;
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
  codigoFornecedor: string;
  codigoBarras: string;
  ncm: string;
}

interface NfeDraftPagamento {
  id: number;
  formaPagamento: string;
  parcelas: number;
  valor: number;
  lancamentoId?: number;
  dataVencimento?: string;
  descricaoLancamento?: string;
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
  natureza_operacao?: string | null;
  is_demonstracao?: boolean;
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

interface NfeConfirmarResponse {
  id_parcelamento: string;
  chave_nfe: string;
  numero_nfe: string;
  tipo_lancamento: string;
  total_parcelas: number;
  lancamentos_criados: number;
  lancamento_ids: number[];
}

interface NfeDetalheParcela {
  id: number;
  indice: number;
  numero_parcela: string;
  data_vencimento: string;
  valor: number;
  descricao: string;
  status: string;
}

interface NfeDetalheResponse {
  id_parcelamento: string;
  numero_nfe: string;
  chave_nfe?: string | null;
  cfop?: string | null;
  tipo_lancamento: string;
  data_emissao: string;
  natureza_operacao?: string | null;
  destino_compra?: string | null;
  valor_frete?: number | null;
  transportadora_nome?: string | null;
  transportadora_documento?: string | null;
  cte_numero?: string | null;
  cte_chave?: string | null;
  cte_data_emissao?: string | null;
  frete_financeiro_importado?: boolean;
  emitente_nome: string;
  emitente_documento: string;
  anexo_pdf_nome?: string | null;
  anexo_pdf_url?: string | null;
  anexo_frete_nome?: string | null;
  anexo_frete_url?: string | null;
  entidade_id?: number | null;
  plano_contas_id?: number | null;
  centro_custo_id?: number | null;
  centro_custo_nome?: string | null;
  total_parcelas: number;
  valor_total: number;
  status: NfeStatus;
  itens?: NfeAnaliseItem[];
  parcelas: NfeDetalheParcela[];
}

interface NfeEditarParcelaPayload {
  id: number;
  valor: number;
  data_vencimento?: string;
  descricao?: string;
}

interface NfeImportarFreteCteResponse {
  id_parcelamento: string;
  chave_nfe: string;
  numero_nfe: string;
  chave_cte: string;
  numero_cte: string;
  valor_frete: number;
  transportadora_nome: string;
  transportadora_documento?: string | null;
  data_emissao_cte: string;
  lancamentos_atualizados: number;
  cte_ja_existia: boolean;
}

interface NfeImportarFreteFinanceiroResponse {
  id_parcelamento: string;
  cte_chave: string;
  lancamento_id: number;
  valor_frete: number;
  atualizado: boolean;
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
        codigoFornecedor: xmlFirstText(prod, 'cProd'),
        codigoBarras: xmlFirstText(prod, 'cEAN'),
        ncm: xmlFirstText(prod, 'NCM'),
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
    destinoCompra: 'ESTOQUE',
    transportadora: '',
    valorFrete: '',
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

function formaPagamentoLabel(value: string) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CARTAO_CREDITO') return 'Cartao de credito';
  if (normalized === 'CARTAO_DEBITO') return 'Cartao de debito';
  if (normalized === 'TRANSFERENCIA') return 'Transferencia';
  if (normalized === 'BOLETO') return 'Boleto';
  if (normalized === 'PIX') return 'PIX';
  if (normalized === 'DINHEIRO') return 'Dinheiro';
  return normalized || 'Nao informado';
}

function statusLabel(status: NfeStatus) {
  if (status === 'AGUARDANDO_ENTREGA') return 'AGUARDANDO ENTREGA';
  if (status === 'DEMONSTRACAO') return 'DEMONSTRA\u00c7\u00c3O';
  return status.replace('_', ' ');
}

function statusClasses(status: NfeStatus) {
  if (status === 'ENTREGUE') {
    return 'bg-emerald-200/90 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
  }
  if (status === 'CANCELADA') {
    return 'bg-red-200/90 dark:bg-red-900/35 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800';
  }
  if (status === 'DEMONSTRACAO') {
    return 'bg-purple-200/90 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800';
  }
  return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800';
}

function rowClasses(status: NfeStatus) {
  if (status === 'ENTREGUE') return 'bg-emerald-100/70 dark:bg-emerald-900/25';
  if (status === 'CANCELADA') return 'bg-red-200/80 dark:bg-red-900/40';
  if (status === 'DEMONSTRACAO') return 'bg-purple-100/70 dark:bg-purple-900/25';
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

export function NfeForm({
  nfeId,
  onClose,
  onSuccess
}: {
  nfeId?: string | null;
  onClose?: () => void;
  onSuccess?: () => void;
}) {
  const [formMode, setFormMode] = useState<FormMode>('NOVO');
  
  useEffect(() => {
    if (nfeId) {
      void abrirEdicaoDaLinhaId(nfeId);
    }
  }, [nfeId]);

  useKyrusWsListener('NFE_UPDATED', useCallback((payload: any) => {
    if (nfeId && payload?.id_parcelamento && String(payload.id_parcelamento) === nfeId) {
      toast.info('Esta NF-e foi atualizada externamente.');
      void abrirEdicaoDaLinhaId(nfeId);
    }
  }, [nfeId]));

  useKyrusWsListener('LANCAMENTO_UPDATED', useCallback((payload: any) => {
    // If it's a lancamento, we might want to refresh if it belongs to this NFe
    if (nfeId && formMode === 'EDITAR') {
      // Unconditional refresh might be too aggressive, but since we don't have parcelamento info in LANCAMENTO_UPDATED easily...
      // Let's just listen to NFE_UPDATED.
    }
  }, [nfeId, formMode]));



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
  const [pdfAnexoExistente, setPdfAnexoExistente] = useState<{ nome: string; url: string } | null>(null);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [freteAnexo, setFreteAnexo] = useState<File | null>(null);
  const [freteAnexoExistente, setFreteAnexoExistente] = useState<{ nome: string; url: string } | null>(null);
  const [erroFrete, setErroFrete] = useState<string | null>(null);
  const [importandoXml, setImportandoXml] = useState(false);
  const [confirmandoImportacao, setConfirmandoImportacao] = useState(false);
  const [importandoFreteCte, setImportandoFreteCte] = useState(false);
  const [importandoFreteFinanceiro, setImportandoFreteFinanceiro] = useState(false);
  const [analiseNfe, setAnaliseNfe] = useState<NfeAnaliseResponse | null>(null);

  const [idParcelamentoEditando, setIdParcelamentoEditando] = useState<string | null>(null);
  const [planoContasSelecionadoId, setPlanoContasSelecionadoId] = useState<number | null>(null);
  const [carregandoEdicaoId, setCarregandoEdicaoId] = useState<string | null>(null);
  const [planoContas, setPlanoContas] = useState<CategoriaItem[]>([]);
  const [loadingPlanoContas, setLoadingPlanoContas] = useState(false);
  const [erroPlanoContas, setErroPlanoContas] = useState<string | null>(null);
  const draftIdRef = useRef(1);
  const importXmlInputRef = useRef<HTMLInputElement | null>(null);
  const importFreteXmlInputRef = useRef<HTMLInputElement | null>(null);
  const [cteNumero, setCteNumero] = useState('');
  const [cteChave, setCteChave] = useState('');
  const [cteDataEmissao, setCteDataEmissao] = useState('');
  const [freteFinanceiroImportado, setFreteFinanceiroImportado] = useState(false);
  const [freteVencimento, setFreteVencimento] = useState('');

  // Unified XML import state variables
  const [isDragging, setIsDragging] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{
    status: 'sucesso' | 'sucesso_parcial';
    chave_nfe: string;
    numero_nfe: string;
    fornecedor_nome: string;
    valor_total: number;
    itens_mapeados: any[];
    lancamentos_criados: number[];
    movimentacoes_estoque_criadas: number[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // De/Para mapping state variables
  const [showMappingDrawer, setShowMappingDrawer] = useState(false);
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<Record<string, number>>({});
  const [fornecedorId, setFornecedorId] = useState<number | null>(null);
  const [fornecedorNome, setFornecedorNome] = useState('');

  const [refreshToken, setRefreshToken] = useState(0);

  const carregarCentrosCusto = useCallback(async () => {
    setLoadingCentrosCusto(true);
    setErroCentrosCusto(null);
    try {
      const { data } = await api.get<CentroCustoOption[]>('/centro-custo/');

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
      setCentrosCusto([]);
      setErroCentrosCusto('Nao foi possivel carregar os centros de custo.');
    } finally {
      setLoadingCentrosCusto(false);
    }
  }, []);


  const carregarPlanoContas = useCallback(async () => {
    setLoadingPlanoContas(true);
    setErroPlanoContas(null);
    try {
      const { data } = await api.get<CategoriaItem[]>('/plano-contas/');
      const cats = normalizeListResponse<CategoriaItem>(data)
        .filter((item) => item.eh_cabecalho !== true && item.permite_lancamentos !== false)
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
      setPlanoContas(cats);
    } catch {
      setPlanoContas([]);
      setErroPlanoContas('Nao foi possivel carregar o plano de contas.');
    } finally {
      setLoadingPlanoContas(false);
    }
  }, []);

  useEffect(() => {
    void carregarPlanoContas();
  }, [carregarPlanoContas]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0] || null;
      if (file) {
        void handleUnifiedXmlUpload(file);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  useEffect(() => {
    void carregarCentrosCusto();
  }, [carregarCentrosCusto]);

  useEffect(() => {
    let ativo = true;

    async function carregarFornecedores() {
      setLoadingFornecedores(true);
      setErroFornecedores(null);
      try {
        const { data } = await api.get<EntidadeFornecedorOption[]>('/entidades/lookup');
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
  }, []);

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

  const gruposPagamento = useMemo(() => {
    const mapa = new Map<string, {
      formaPagamento: string;
      valorTotal: number;
      pagamentos: Array<{ pagamento: NfeDraftPagamento; index: number }>;
    }>();

    pagamentosNota.forEach((pagamento, index) => {
      const forma = String(pagamento.formaPagamento || 'DINHEIRO').trim().toUpperCase() || 'DINHEIRO';
      const atual = mapa.get(forma);

      if (!atual) {
        mapa.set(forma, {
          formaPagamento: forma,
          valorTotal: Number(pagamento.valor || 0),
          pagamentos: [{ pagamento, index }],
        });
        return;
      }

      atual.valorTotal += Number(pagamento.valor || 0);
      atual.pagamentos.push({ pagamento, index });
    });

    return Array.from(mapa.values()).sort((a, b) => a.formaPagamento.localeCompare(b.formaPagamento, 'pt-BR'));
  }, [pagamentosNota]);



  function limparFormularioDraft() {
    setNovoForm(createDefaultNovoForm());
    setAnaliseNfe(null);
    setCentroCustoSelecionadoId(null);
    setEmitenteSelecionadoId(null);
    setMostrarSugestoesEmitente(false);
    setItensNota([]);
    setPagamentosNota([]);
    setPdfAnexo(null);
    setPdfAnexoExistente(null);
    setErroPdf(null);
    setFreteAnexo(null);
    setFreteAnexoExistente(null);
    setErroFrete(null);
    setCteNumero('');
    setCteChave('');
    setCteDataEmissao('');
    setFreteFinanceiroImportado(false);
    setFreteVencimento('');
    setPlanoContasSelecionadoId(null);
    draftIdRef.current = 1;
  }

  function abrirNovoFormulario() {
    limparFormularioDraft();
    setFormMode('NOVO');
    setIdParcelamentoEditando(null);
    setPlanoContasSelecionadoId(null);
    // setMostrarNovoFormulario(true);
  }

  function fecharFormulario() {
    if (onClose) onClose();
  }

  async function abrirEdicaoDaLinha(item: NfeListItem) {
    const idParcelamento = String(item.id_parcelamento || '').trim();
    return abrirEdicaoDaLinhaId(idParcelamento);
  }

  async function abrirEdicaoDaLinhaId(idParcelamento: string) {
    if (confirmandoImportacao || carregandoEdicaoId) return;

    if (!idParcelamento) {
      toast.error('Nao foi possivel abrir a NF-e para edicao. Identificador invalido.');
      return;
    }

    setCarregandoEdicaoId(idParcelamento);
    

    try {
      const { data } = await api.get<NfeDetalheResponse>(`/importacao/nfe/${encodeURIComponent(idParcelamento)}/detalhe`);

      let nextId = 1;
      const itensDoDetalhe = Array.isArray(data.itens) ? data.itens : [];
      const itensImportados: NfeDraftItem[] = itensDoDetalhe
        .map((item) => {
          const quantidade = Number(item.quantidade || 0);
          const valorUnitario = Number(item.valor_unitario || 0);
          const valorTotal = Number(item.valor_total || 0);
          const desconto = Math.max(0, (quantidade > 0 ? quantidade * valorUnitario : valorUnitario) - valorTotal);
          return {
            id: nextId++,
            produtoServico: String(item.descricao || '').trim() || 'Item',
            qtd: quantidade > 0 ? quantidade : 1,
            cfop: String(item.cfop || data.cfop || '').trim(),
            valorUnitario: valorUnitario > 0 ? valorUnitario : valorTotal,
            desconto,
            codigoFornecedor: '',
            codigoBarras: '',
            ncm: String(item.ncm || '').trim(),
          };
        })
        .filter((item) => item.valorUnitario > 0 || item.produtoServico.length > 0);

      const itensImportadosFallback = itensImportados.length > 0
        ? itensImportados
        : [{
          id: nextId++,
          produtoServico: `NF-e ${String(data.numero_nfe || '').trim() || 'importada'}`,
          qtd: 1,
          cfop: String(data.cfop || '').trim(),
          valorUnitario: Number(data.valor_total || 0),
          desconto: 0,
          codigoFornecedor: '',
          codigoBarras: '',
          ncm: '',
        }].filter((fallback) => fallback.valorUnitario > 0);

      const pagamentosImportados: NfeDraftPagamento[] = (Array.isArray(data.parcelas) ? data.parcelas : []).map((parcela) => ({
        id: nextId++,
        formaPagamento: 'BOLETO',
        parcelas: 1,
        valor: Number(parcela.valor || 0),
        lancamentoId: Number(parcela.id || 0) || undefined,
        dataVencimento: String(parcela.data_vencimento || '').trim() || undefined,
        descricaoLancamento: String(parcela.descricao || '').trim() || undefined,
      }));

      const situacaoDetalhe = String(data.status || '').trim().toUpperCase();
      const situacaoNormalizada = situacaoDetalhe === 'ENTREGUE' || situacaoDetalhe === 'CANCELADA'
        ? situacaoDetalhe
        : 'AGUARDANDO_ENTREGA';
      const anexoPdfNome = String(data.anexo_pdf_nome || '').trim();
      const anexoPdfUrl = String(data.anexo_pdf_url || '').trim();
      const anexoFreteNome = String(data.anexo_frete_nome || '').trim();
      const anexoFreteUrl = String(data.anexo_frete_url || '').trim();

      setNovoForm({
        ...createDefaultNovoForm(),
        numero: String(data.numero_nfe || '').trim(),
        chaveNfe: String(data.chave_nfe || '').trim(),
        emitente: String(data.emitente_nome || '').trim(),
        cpfCnpj: String(data.emitente_documento || '').trim(),
        cfop: String(data.cfop || '').trim(),
        naturezaOperacao: String(data.natureza_operacao || '').trim(),
        destinoCompra: String(data.destino_compra || 'ESTOQUE').trim().toUpperCase() || 'ESTOQUE',
        transportadora: String(data.transportadora_nome || '').trim(),
        valorFrete: Number(data.valor_frete || 0) > 0 ? String(data.valor_frete) : '',
        dataDocumento: String(data.data_emissao || todayISODate()).slice(0, 10),
        situacao: situacaoNormalizada,
      });

      setCteNumero(String(data.cte_numero || '').trim());
      setCteChave(String(data.cte_chave || '').trim());
      setCteDataEmissao(String(data.cte_data_emissao || '').trim());
      setFreteFinanceiroImportado(Boolean(data.frete_financeiro_importado));
      setFreteVencimento('');

      setFormMode('EDITAR');
      setIdParcelamentoEditando(String(data.id_parcelamento || idParcelamento));
      setPlanoContasSelecionadoId(Number(data.plano_contas_id || 0) || null);
      setAnaliseNfe(null);
      setEmitenteSelecionadoId(Number(data.entidade_id || 0) || null);
      setCentroCustoSelecionadoId(Number(data.centro_custo_id || 0) || null);
      setMostrarSugestoesEmitente(false);
      setItensNota(itensImportadosFallback);
      setPagamentosNota(pagamentosImportados);
      setPdfAnexo(null);
      setPdfAnexoExistente(anexoPdfUrl ? {
        nome: anexoPdfNome || 'PDF da NF-e',
        url: toPublicAssetUrl(anexoPdfUrl) || anexoPdfUrl,
      } : null);
      setErroPdf(null);
      setFreteAnexo(null);
      setFreteAnexoExistente(anexoFreteUrl ? {
        nome: anexoFreteNome || 'Arquivo do frete',
        url: toPublicAssetUrl(anexoFreteUrl) || anexoFreteUrl,
      } : null);
      setErroFrete(null);
      draftIdRef.current = Math.max(1, nextId);
      // setMostrarNovoFormulario(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Nao foi possivel abrir a NF-e para edicao.');
    } finally {
      setCarregandoEdicaoId(null);
    }
  }

  async function anexarPdfAoParcelamento(idParcelamento: string) {
    if (!pdfAnexo) return;

    const parcelamento = String(idParcelamento || '').trim();
    if (!parcelamento) return;

    const formData = new FormData();
    formData.append('arquivo', pdfAnexo);
    await api.post(`/importacao/nfe/${encodeURIComponent(parcelamento)}/anexo-pdf`, formData);
  }

  async function anexarFreteAoParcelamento(idParcelamento: string) {
    if (!freteAnexo) return;

    const parcelamento = String(idParcelamento || '').trim();
    if (!parcelamento) return;

    const formData = new FormData();
    formData.append('arquivo', freteAnexo);
    await api.post(`/importacao/nfe/${encodeURIComponent(parcelamento)}/anexo-frete`, formData);
  }

  async function confirmarFormulario(forceEntregue = false) {
    const finalSituacao = forceEntregue ? 'ENTREGUE' : String(novoForm.situacao || 'AGUARDANDO_ENTREGA').toUpperCase();

    if (!planoContasSelecionadoId) {
      toast.error('Selecione o plano de contas da NF-e antes de confirmar.');
      return;
    }

    if (centrosCusto.length > 0 && !centroCustoSelecionadoId) {
      toast.error('Selecione o centro de custo da NF-e antes de confirmar.');
      return;
    }

    if (formMode === 'NOVO' && pendingImportFile) {
      setConfirmandoImportacao(true);
      
      try {
        await processarXmlComoCompra(pendingImportFile, planoContasSelecionadoId, centroCustoSelecionadoId);
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || 'Erro ao processar importacao de compras.');
      } finally {
        setConfirmandoImportacao(false);
      }
      return;
    }

    if (formMode === 'EDITAR' && idParcelamentoEditando) {
      const parcelasPayload: NfeEditarParcelaPayload[] = pagamentosNota
        .map((pagamento) => ({
          id: Number(pagamento.lancamentoId || 0),
          valor: Number(pagamento.valor || 0),
          data_vencimento: pagamento.dataVencimento || undefined,
          descricao: pagamento.descricaoLancamento || undefined,
        }))
        .filter((parcela) => parcela.id > 0 && parcela.valor > 0);

      if (parcelasPayload.length === 0) {
        toast.error('Nao foi possivel salvar: nenhuma parcela com valor valido.');
        return;
      }

      setConfirmandoImportacao(true);
      

      try {
        await api.put(`/importacao/nfe/${encodeURIComponent(idParcelamentoEditando)}`, {
          numero_nfe: String(novoForm.numero || '').trim(),
          chave_nfe: onlyDigits(novoForm.chaveNfe || ''),
          situacao: finalSituacao,
          cfop: String(novoForm.cfop || '').trim() || undefined,
          natureza_operacao: String(novoForm.naturezaOperacao || '').trim() || undefined,
          destino_compra: String(novoForm.destinoCompra || '').trim() || undefined,
          valor_frete: Number(String(novoForm.valorFrete || '').replace(',', '.')) > 0
            ? Number(String(novoForm.valorFrete || '').replace(',', '.'))
            : undefined,
          data_emissao: String(novoForm.dataDocumento || todayISODate()),
          emitente_nome: String(novoForm.emitente || '').trim() || undefined,
          emitente_documento: onlyDigits(novoForm.cpfCnpj || ''),
          entidade_id: Number(emitenteSelecionadoId || 0) || undefined,
          plano_contas_id: Number(planoContasSelecionadoId || 0) || undefined,
          centro_custo_id: Number(centroCustoSelecionadoId || 0) || undefined,
          observacao: onlyDigits(novoForm.chaveNfe || '').length > 0
            ? `NF-e ${String(novoForm.numero || '').trim()} | Chave ${onlyDigits(novoForm.chaveNfe)}`
            : `NF-e ${String(novoForm.numero || '').trim()}`,
          itens: itensNota
            .map((item) => ({
              descricao: String(item.produtoServico || '').trim() || 'Item',
              quantidade: Number(item.qtd || 0) > 0 ? Number(item.qtd) : 1,
              valor_unitario: Number(item.valorUnitario || 0),
              valor_total: subtotalItem(item),
              cfop: String(item.cfop || novoForm.cfop || '').trim() || undefined,
              ncm: item.ncm || undefined,
            }))
            .filter((item) => item.valor_total > 0 || item.descricao.length > 0),
          parcelas: parcelasPayload,
        });

        let avisoAnexo: string | null = null;
        if (pdfAnexo) {
          try {
            await anexarPdfAoParcelamento(idParcelamentoEditando);
          } catch (err: any) {
            avisoAnexo = err?.response?.data?.detail || 'NF-e salva, mas nao foi possivel referenciar o PDF nos anexos dos lancamentos.';
          }
        }
        if (freteAnexo) {
          try {
            await anexarFreteAoParcelamento(idParcelamentoEditando);
          } catch (err: any) {
            avisoAnexo = avisoAnexo || err?.response?.data?.detail || 'NF-e salva, mas nao foi possivel referenciar o arquivo de frete nos anexos dos lancamentos.';
          }
        }

        fecharFormulario();
        setRefreshToken((prev) => prev + 1);
        if (avisoAnexo) {
          toast.error(avisoAnexo);
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || 'Nao foi possivel salvar a edicao da NF-e.');
      } finally {
        setConfirmandoImportacao(false);
      }
      return;
    }

    if (!analiseNfe) {
      // setMostrarNovoFormulario(false);
      return;
    }

    const tipoLancamento = String(analiseNfe.tipo_lancamento || 'DESPESA').trim().toUpperCase();
    if (tipoLancamento !== 'DESPESA') {
      toast.error('A NF-e analisada nao pode ser confirmada porque o tipo de lancamento nao e DESPESA.');
      return;
    }

    const isDemonstracao = Boolean(analiseNfe.is_demonstracao) || String(novoForm.destinoCompra || '').trim().toUpperCase() === 'DEMONSTRACAO';

    if (!isDemonstracao && (!analiseNfe.pode_confirmar || analiseNfe.parcelas.length === 0)) {
      toast.error('A analise do XML nao retornou parcelas para confirmar a importacao.');
      return;
    }

    const parcelasPayload: NfeConfirmarParcelaPayload[] = isDemonstracao ? [] : analiseNfe.parcelas.map((parcela, index) => {
      const valorEditado = Number(pagamentosNota[index]?.valor || 0);
      const valorParcela = valorEditado > 0 ? valorEditado : Number(parcela.valor || 0);
      const dataVencimentoEditada = String(pagamentosNota[index]?.dataVencimento || '').trim();

      return {
        indice: Number(parcela.indice || index + 1),
        numero_parcela: String(parcela.numero_parcela || index + 1),
        data_vencimento: dataVencimentoEditada || String(parcela.data_vencimento || novoForm.dataDocumento || todayISODate()),
        valor: valorParcela,
        descricao: String(parcela.descricao || '').trim() || `NFE: (${novoForm.numero || analiseNfe.numero_nfe})`,
        plano_contas_id: Number(parcela.plano_contas_sugerido_id || analiseNfe.plano_contas_sugerido_id || 0) || undefined,
        entidade_id: Number(emitenteSelecionadoId || parcela.entidade_sugerida_id || analiseNfe.entidade_sugerida_id || 0) || undefined,
      };
    }).filter((parcela) => parcela.valor > 0);

    if (!isDemonstracao && parcelasPayload.length === 0) {
      toast.error('Nao foi possivel confirmar: nenhuma parcela com valor valido.');
      return;
    }

    setConfirmandoImportacao(true);
    

    try {
      const { data: confirmacao } = await api.post<NfeConfirmarResponse>('/importacao/nfe/confirmar', {
        chave_nfe: onlyDigits(novoForm.chaveNfe || analiseNfe.chave_nfe),
        numero_nfe: String(novoForm.numero || analiseNfe.numero_nfe || '').trim(),
        tipo_lancamento: tipoLancamento,
        situacao: isDemonstracao ? 'DEMONSTRACAO' : finalSituacao,
        cfop: String(novoForm.cfop || '').trim() || undefined,
        natureza_operacao: String(novoForm.naturezaOperacao || analiseNfe.natureza_operacao || '').trim() || undefined,
        destino_compra: isDemonstracao ? 'DEMONSTRACAO' : (String(novoForm.destinoCompra || '').trim() || undefined),
        valor_frete: Number(String(novoForm.valorFrete || '').replace(',', '.')) > 0
          ? Number(String(novoForm.valorFrete || '').replace(',', '.'))
          : undefined,
        data_emissao: String(novoForm.dataDocumento || analiseNfe.data_emissao || todayISODate()),
        emitente_nome: String(novoForm.emitente || analiseNfe.emitente_nome || '').trim() || undefined,
        emitente_documento: onlyDigits(novoForm.cpfCnpj || analiseNfe.emitente_documento || ''),
        entidade_id: Number(emitenteSelecionadoId || analiseNfe.entidade_sugerida_id || 0) || undefined,
        plano_contas_id: Number(planoContasSelecionadoId || analiseNfe.plano_contas_sugerido_id || 0) || undefined,
        centro_custo_id: Number(centroCustoSelecionadoId || 0) || undefined,
        observacao: `NF-e ${novoForm.numero || analiseNfe.numero_nfe} | Chave ${onlyDigits(novoForm.chaveNfe || analiseNfe.chave_nfe)}`,
        itens: itensNota
          .map((item) => ({
            descricao: String(item.produtoServico || '').trim() || 'Item',
            quantidade: Number(item.qtd || 0) > 0 ? Number(item.qtd) : 1,
            valor_unitario: Number(item.valorUnitario || 0),
            valor_total: subtotalItem(item),
            cfop: String(item.cfop || novoForm.cfop || '').trim() || undefined,
            ncm: item.ncm || undefined,
          }))
          .filter((item) => item.valor_total > 0 || item.descricao.length > 0),
        parcelas: parcelasPayload,
      });

      const idParcelamentoConfirmado = String(confirmacao?.id_parcelamento || '').trim();
      let avisoAnexo: string | null = null;
      if (pdfAnexo && idParcelamentoConfirmado) {
        try {
          await anexarPdfAoParcelamento(idParcelamentoConfirmado);
        } catch (err: any) {
          avisoAnexo = err?.response?.data?.detail || 'NF-e confirmada, mas nao foi possivel referenciar o PDF nos anexos dos lancamentos.';
        }
      }
      if (freteAnexo && idParcelamentoConfirmado) {
        try {
          await anexarFreteAoParcelamento(idParcelamentoConfirmado);
        } catch (err: any) {
          avisoAnexo = avisoAnexo || err?.response?.data?.detail || 'NF-e confirmada, mas nao foi possivel referenciar o arquivo de frete nos anexos dos lancamentos.';
        }
      }

      fecharFormulario();
      setRefreshToken((prev) => prev + 1);
      if (avisoAnexo) {
        toast.error(avisoAnexo);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Nao foi possivel confirmar a importacao da NF-e.');
    } finally {
      setConfirmandoImportacao(false);
    }
  }

  function confirmarEntregaInfGerais() {
    confirmarFormulario(true);
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
        codigoFornecedor: '',
        codigoBarras: '',
        ncm: '',
      },
    ]));
  }

  function atualizarItem<K extends keyof NfeDraftItem>(id: number, campo: K, valor: NfeDraftItem[K]) {
    setItensNota((prev) => prev.map((item) => (item.id === id ? { ...item, [campo]: valor } : item)));
  }

  function adicionarNovoPagamento() {
    if (formMode === 'EDITAR') return;

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

  const carregarProdutos = async () => {
    setLoadingProdutos(true);
    try {
      const { data } = await api.get<any[]>('/pdv/produtos');
      setProdutos(data || []);
    } catch (err) {
      console.error('Erro ao carregar produtos:', err);
    } finally {
      setLoadingProdutos(false);
    }
  };

  useEffect(() => {
    if (showMappingDrawer) {
      void carregarProdutos();
    }
  }, [showMappingDrawer]);

  async function processarXmlComoCompra(file: File | null, planoContasId?: number | null, centroCustoId?: number | null) {
    if (!file) return;
    setImportandoXml(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('arquivo', file);

      const params: Record<string, any> = {};
      if (planoContasId) params.plano_contas_id = planoContasId;
      if (centroCustoId) params.centro_custo_id = centroCustoId;

      const { data } = await api.post<any>('/compras/importar-xml', formData, { params });

      if (data.status === 'sucesso') {
        setImportResult({
          status: 'sucesso',
          chave_nfe: data.chave_nfe,
          numero_nfe: data.numero_nfe,
          fornecedor_nome: data.fornecedor_nome,
          valor_total: data.valor_total,
          itens_mapeados: data.itens_mapeados || [],
          lancamentos_criados: data.lancamentos_criados || [],
          movimentacoes_estoque_criadas: data.movimentacoes_estoque_criadas || [],
        });
        setPendingImportFile(null);
        setShowMappingDrawer(false);
        setRefreshToken((prev) => prev + 1);
        fecharFormulario();
      } else if (data.status === 'sucesso_parcial') {
        setFornecedorId(data.fornecedor_id);
        setFornecedorNome(data.fornecedor_nome);
        setPendingItems(data.itens_pendentes || []);
        setSelectedMapping({});
        setShowMappingDrawer(true);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Erro ao processar importacao de compras.';
      setImportError(msg);
      toast.error(msg);
    } finally {
      setImportandoXml(false);
    }
  }

  async function salvarEquivalencia(codigoFornecedor: string, produtoInternoId: number) {
    if (!fornecedorId) return;
    try {
      await api.post('/compras/equivalencias', {
        fornecedor_id: fornecedorId,
        codigo_produto_fornecedor: codigoFornecedor,
        produto_interno_id: produtoInternoId,
      });
      setSelectedMapping((prev) => ({
        ...prev,
        [codigoFornecedor]: produtoInternoId,
      }));
    } catch (err) {
      setImportError('Nao foi possivel salvar o mapeamento do produto.');
    }
  }

  async function handleUnifiedXmlUpload(file: File | null) {
    if (!file) return;

    const nome = String(file.name || '').toLowerCase();
    const isXml = file.type.includes('xml') || nome.endsWith('.xml');
    if (!isXml) {
      setImportError('Selecione um arquivo XML valido.');
      return;
    }

    setImportError(null);
    setImportResult(null);

    try {
      const xmlContent = await file.text();

      // CTe auto routing
      if (xmlContent.includes('<infCte>') || xmlContent.includes('<CTe')) {
        void importarXmlFreteCte(file);
        return;
      }

      const parsed = parseNfeXml(xmlContent);

      if (parsed.itens && parsed.itens.length > 0) {
        setPendingImportFile(file);
      } else {
        setPendingImportFile(null);
      }
      void importarXmlParaFormulario(file);
    } catch (err: any) {
      setImportError(err.message || 'Erro ao ler ou processar o arquivo XML.');
    }
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
      toast.error('Selecione um arquivo XML valido.');
      return;
    }

    setImportandoXml(true);
    
    setAnaliseNfe(null);
    setFormMode('NOVO');
    setIdParcelamentoEditando(null);
    setPlanoContasSelecionadoId(null);

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
          codigoFornecedor: '',
          codigoBarras: '',
          ncm: String(item.ncm || '').trim(),
        }))
        : [];

      const pagamentosDaAnalise: Array<Omit<NfeDraftPagamento, 'id'>> = Array.isArray(analise.parcelas)
        ? analise.parcelas
          .map((parcela) => ({
            formaPagamento: 'BOLETO',
            parcelas: 1,
            valor: Number(parcela.valor || 0),
            dataVencimento: String(parcela.data_vencimento || '').trim() || undefined,
          }))
          .filter((pagamento) => pagamento.valor > 0)
        : [];

      const itensFonte = itensDaAnalise.length > 0 ? itensDaAnalise : parsed.itens;
      const pagamentosFonte = pagamentosDaAnalise.length > 0 ? pagamentosDaAnalise : parsed.pagamentos;

      let nextId = 1;
      const itensImportados: NfeDraftItem[] = itensFonte.map((item, idx) => ({
        ...item,
        id: nextId++,
        codigoFornecedor: item.codigoFornecedor || parsed.itens[idx]?.codigoFornecedor || '',
        codigoBarras: item.codigoBarras || parsed.itens[idx]?.codigoBarras || '',
        ncm: item.ncm || parsed.itens[idx]?.ncm || '',
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
        destinoCompra: String(parsed.form.destinoCompra || 'ESTOQUE').trim().toUpperCase() || 'ESTOQUE',
      });

      setAnaliseNfe(analise);
      setPlanoContasSelecionadoId(Number(analise.plano_contas_sugerido_id || 0) || null);
      setCentroCustoSelecionadoId(null);
      setEmitenteSelecionadoId(null);
      setMostrarSugestoesEmitente(false);
      setItensNota(itensImportados);
      setPagamentosNota(pagamentosImportados);
      setPdfAnexo(null);
      setPdfAnexoExistente(null);
      setFreteAnexo(null);
      setFreteAnexoExistente(null);
      setErroPdf(null);
      setCteNumero('');
      setCteChave('');
      setCteDataEmissao('');
      setFreteFinanceiroImportado(false);
      setFreteVencimento('');
      draftIdRef.current = nextId;
      // setMostrarNovoFormulario(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nao foi possivel importar o XML da NF-e.';
      toast.error(message);
    } finally {
      setImportandoXml(false);
    }
  }

  async function importarXmlFreteCte(file: File | null) {
    if (!file) return;

    const nome = String(file.name || '').toLowerCase();
    const isXml = file.type.includes('xml') || nome.endsWith('.xml');
    if (!isXml) {
      toast.error('Selecione um arquivo XML valido para o frete (CTe).');
      return;
    }

    setImportandoFreteCte(true);
    

    try {
      const formData = new FormData();
      formData.append('arquivo', file);

      const { data } = await api.post<NfeImportarFreteCteResponse>('/importacao/nfe/importar-frete-cte', formData);

      setCteNumero(String(data.numero_cte || '').trim());
      setCteChave(String(data.chave_cte || '').trim());
      setCteDataEmissao(String(data.data_emissao_cte || '').trim());
      setNovoForm((prev) => ({
        ...prev,
        transportadora: String(data.transportadora_nome || prev.transportadora || '').trim(),
        valorFrete: Number(data.valor_frete || 0) > 0 ? String(data.valor_frete) : prev.valorFrete,
      }));
      setFreteFinanceiroImportado(false);

      if (onSuccess) onSuccess();

      if (data.cte_ja_existia) {
        toast.error('CTe ja estava vinculado. Os dados de frete foram atualizados.');
      }
      setRefreshToken((prev) => prev + 1);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Nao foi possivel importar o XML de frete (CTe).');
    } finally {
      setImportandoFreteCte(false);
    }
  }

  async function importarFreteNoFinanceiro() {
    const parcelamentoId = String(idParcelamentoEditando || '').trim();
    if (!parcelamentoId) {
      toast.error('Abra uma NF-e para importar o frete no financeiro.');
      return;
    }

    if (!freteVencimento) {
      toast.error('Informe a data de vencimento do frete para importar no financeiro.');
      return;
    }

    setImportandoFreteFinanceiro(true);
    
    try {
      const payload = {
        data_vencimento: freteVencimento,
        plano_contas_id: planoContasSelecionadoId || undefined,
        centro_custo_id: centroCustoSelecionadoId || undefined,
      };
      await api.post<NfeImportarFreteFinanceiroResponse>(
        `/importacao/nfe/${encodeURIComponent(parcelamentoId)}/importar-frete-financeiro`,
        payload,
      );

      setFreteFinanceiroImportado(true);
      setRefreshToken((prev) => prev + 1);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Nao foi possivel importar o frete no financeiro.');
    } finally {
      setImportandoFreteFinanceiro(false);
    }
  }

  const labelClassName = 'mb-1 flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200';
  const inputClassName = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
  const tableInputClassName = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <div className="w-full h-full bg-slate-50 dark:bg-[#0d1117] overflow-y-auto p-4 sm:p-6 text-slate-800 dark:text-slate-100">
      { <section className="space-y-3">
          <div className="rounded-xl border border-blue-300 bg-white p-4 shadow-sm dark:border-blue-800 dark:bg-slate-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">Dados Fiscais</h2>
                <span className="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white">{formMode === 'EDITAR' ? 'Em edicao' : 'Em digitacao'}</span>
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
                <div className="mt-1">
                  <SearchableSelect
                    value={novoForm.modelo}
                    onChange={(val) => atualizarNovoForm('modelo', String(val))}
                    options={[{
                      label: 'Modelo',
                      options: [
                        { id: '55', label: '55' },
                        { id: '65', label: '65' }
                      ]
                    }]}
                  />
                </div>
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
                <div className="mt-1">
                  <SearchableSelect
                    value={novoForm.finalidade}
                    onChange={(val) => atualizarNovoForm('finalidade', String(val))}
                    options={[{
                      label: 'Finalidade',
                      options: [
                        { id: 'NORMAL', label: 'Normal' },
                        { id: 'COMPLEMENTAR', label: 'Complementar' }
                      ]
                    }]}
                  />
                </div>
              </label>

              <label className="md:col-span-3">
                <span className={labelClassName}>Situacao</span>
                <div className="mt-1">
                  <SearchableSelect
                    value={novoForm.situacao}
                    onChange={(val) => atualizarNovoForm('situacao', String(val))}
                    options={[{
                      label: 'Situação',
                      options: [
                        { id: 'AGUARDANDO_ENTREGA', label: 'Aguardando Entrega' },
                        { id: 'ENTREGUE', label: 'Entregue' },
                        { id: 'CANCELADA', label: 'Cancelada' }
                      ]
                    }]}
                  />
                </div>
              </label>

              <div className="md:col-span-3">
                <span className={labelClassName}>
                  <span className="text-rose-500">*</span>
                  Plano de contas (Categoria)
                </span>
                {loadingPlanoContas ? (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carregando plano de contas...
                  </div>
                ) : (
                  <SearchableSelect
                    value={planoContasSelecionadoId ? String(planoContasSelecionadoId) : ''}
                    onChange={(val) => setPlanoContasSelecionadoId(Number(val) || null)}
                    options={[{
                      label: 'Plano de Contas',
                      options: [
                        { id: '', label: '-- Selecione a categoria --' },
                        ...planoContas.map((cat) => ({ id: String(cat.id), label: cat.codigo ? `${cat.codigo} - ${cat.nome}` : cat.nome }))
                      ]
                    }]}
                  />
                )}
                {erroPlanoContas ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-300">{erroPlanoContas}</p> : null}
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  A categoria selecionada será vinculada a todos os lançamentos gerados pela nota.
                </p>
              </div>

              <div className="md:col-span-3">
                <span className={labelClassName}>
                  <span className="text-rose-500">*</span>
                  Centro de custo da NF-e
                </span>
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
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">O mesmo centro de custo selecionado aqui será aplicado em todos os lançamentos financeiros da NF-e.</p>
              </div>

              <div className="md:col-span-6 mt-2">
                <span className={labelClassName}>Tipo de compra</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: 'ESTOQUE', label: 'Estoque', activeClass: 'border-blue-550 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-550/10 dark:text-blue-200' },
                    { value: 'ENCOMENDA', label: 'Encomenda', activeClass: 'border-blue-50 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/10 dark:text-blue-200' },
                    { value: 'DEMONSTRACAO', label: 'Demonstração', activeClass: 'border-purple-55 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-500/10 dark:text-purple-200' },
                  ].map((opcao) => {
                    const ativo = String(novoForm.destinoCompra || '').toUpperCase() === opcao.value;
                    return (
                      <button
                        key={opcao.value}
                        type="button"
                        onClick={() => atualizarNovoForm('destinoCompra', opcao.value)}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${ativo ? opcao.activeClass : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                      >
                        {opcao.label}
                      </button>
                    );
                  })}
                </div>
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
                    <th className="px-2 py-2 w-12">Item</th>
                    <th className="px-2 py-2 w-28">Cód. Forn.</th>
                    <th className="px-2 py-2 w-36">EAN (Barras)</th>
                    <th className="px-2 py-2">Produto/Serviço</th>
                    <th className="px-2 py-2 w-28">NCM</th>
                    <th className="px-2 py-2 w-16">Qtd</th>
                    <th className="px-2 py-2 w-20">CFOP</th>
                    <th className="px-2 py-2 text-right w-24">Valor un</th>
                    <th className="px-2 py-2 text-right w-24">Subtotal</th>
                    <th className="px-2 py-2 text-right w-24">Desconto</th>
                  </tr>
                </thead>
                <tbody>
                  {itensNota.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-2 py-8 text-center text-slate-400">Sem dados</td>
                    </tr>
                  ) : itensNota.map((item, index) => (
                    <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <td className="px-2 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">{index + 1}</td>

                      <td className="px-2 py-2">
                        <input
                          className={tableInputClassName}
                          value={item.codigoFornecedor || ''}
                          onChange={(event) => atualizarItem(item.id, 'codigoFornecedor', event.target.value)}
                          placeholder="Código"
                        />
                      </td>

                      <td className="px-2 py-2">
                        <input
                          className={tableInputClassName}
                          value={item.codigoBarras || ''}
                          onChange={(event) => atualizarItem(item.id, 'codigoBarras', event.target.value)}
                          placeholder="EAN"
                        />
                      </td>

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
                          className={tableInputClassName}
                          value={item.ncm || ''}
                          onChange={(event) => atualizarItem(item.id, 'ncm', event.target.value)}
                          placeholder="NCM"
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
                disabled={formMode === 'EDITAR'}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {formMode === 'EDITAR' ? 'Parcelas fixas na edicao' : 'Novo pagamento'}
              </button>
            </div>

            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Resumo agrupado por forma de pagamento. Abaixo, veja e ajuste vencimento e valor de cada parcela.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 dark:border-slate-700">
                  <tr>
                    <th className="px-2 py-2">Item</th>
                    <th className="px-2 py-2">Forma de pagamento</th>
                    <th className="px-2 py-2 text-center">Qtde parcelas</th>
                    <th className="px-2 py-2 text-right">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposPagamento.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-8 text-center text-slate-400">Sem dados</td>
                    </tr>
                  ) : gruposPagamento.map((grupo, index) => (
                    <tr key={grupo.formaPagamento} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <td className="px-2 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">{index + 1}</td>
                      <td className="px-2 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {formaPagamentoLabel(grupo.formaPagamento)}
                      </td>
                      <td className="px-2 py-2 text-center text-sm font-bold text-slate-700 dark:text-slate-200">
                        {grupo.pagamentos.length}
                      </td>
                      <td className="px-2 py-2 text-right text-sm font-bold text-slate-700 dark:text-slate-200">
                        {formatCurrency(grupo.valorTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gruposPagamento.length > 0 ? (
              <div className="mt-4 space-y-3">
                {gruposPagamento.map((grupo) => (
                  <div
                    key={`detalhe-${grupo.formaPagamento}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {formaPagamentoLabel(grupo.formaPagamento)}
                      </p>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {grupo.pagamentos.length} parcela(s)
                      </p>
                    </div>

                    <div className="space-y-2">
                      {grupo.pagamentos.map(({ pagamento }, parcelaIndex) => (
                        <div
                          key={`pagamento-${pagamento.id}`}
                          className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-800 md:grid-cols-[110px_1fr_1fr_170px]"
                        >
                          <div className="flex items-center font-bold text-slate-700 dark:text-slate-200">
                            Parcela {parcelaIndex + 1}
                          </div>

                          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Forma
                            <SearchableSelect
                              value={pagamento.formaPagamento}
                              onChange={(val) => atualizarPagamento(pagamento.id, 'formaPagamento', String(val))}
                              options={[{
                                label: 'Forma',
                                options: [
                                  { id: 'DINHEIRO', label: 'Dinheiro' },
                                  { id: 'PIX', label: 'PIX' },
                                  { id: 'CARTAO_CREDITO', label: 'Cartao de credito' },
                                  { id: 'CARTAO_DEBITO', label: 'Cartao de debito' },
                                  { id: 'BOLETO', label: 'Boleto' },
                                  { id: 'TRANSFERENCIA', label: 'Transferencia' }
                                ]
                              }]}
                            />
                          </label>

                          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Vencimento
                            <input
                              type="date"
                              className={tableInputClassName}
                              value={String(pagamento.dataVencimento || '').slice(0, 10)}
                              onChange={(event) => atualizarPagamento(pagamento.id, 'dataVencimento', event.target.value)}
                            />
                          </label>

                          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Valor
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className={tableInputClassName}
                              value={pagamento.valor}
                              onChange={(event) => atualizarPagamento(pagamento.id, 'valor', parseNumericInput(event.target.value))}
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Anexo PDF</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Anexe o PDF da nota fiscal. O mesmo arquivo sera referenciado nos anexos de todas as parcelas financeiras desta NF-e.</p>
            </div>

            {pdfAnexoExistente ? (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                PDF atual:&nbsp;
                <a
                  href={toPublicAssetUrl(pdfAnexoExistente.url) || pdfAnexoExistente.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline"
                >
                  {pdfAnexoExistente.nome}
                </a>
              </div>
            ) : null}

            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-blue-500 dark:border-slate-700 dark:bg-slate-900">
              <Paperclip className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                {pdfAnexo ? pdfAnexo.name : (pdfAnexoExistente?.nome || 'Clique para selecionar um arquivo PDF')}
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
            {pdfAnexo && pdfAnexoExistente ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Um novo PDF foi selecionado e sera referenciado no lugar do arquivo atual apos salvar/confirmar.
              </p>
            ) : null}
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

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Frete</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Informe a transportadora e o valor do frete, e anexe o arquivo do frete quando houver.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label>
                <span className={labelClassName}>Transportadora</span>
                <input
                  className={inputClassName}
                  placeholder="Nome da transportadora"
                  value={novoForm.transportadora}
                  onChange={(event) => atualizarNovoForm('transportadora', event.target.value)}
                />
              </label>

              <label>
                <span className={labelClassName}>Valor do frete</span>
                <input
                  className={inputClassName}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={novoForm.valorFrete}
                  onChange={(event) => atualizarNovoForm('valorFrete', event.target.value)}
                />
              </label>
            </div>

            {cteNumero || cteChave ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                <div><strong>CTE:</strong> N° {cteNumero || '-'} {cteDataEmissao ? `• Emissao ${formatDate(cteDataEmissao)}` : ''}</div>
                <div className="truncate"><strong>Chave:</strong> {cteChave || '-'}</div>
              </div>
            ) : null}

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Financeiro do frete (CTe)</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                O frete do CTe so entra no financeiro apos informar vencimento.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-[190px]">
                  <span className={labelClassName}>Vencimento do frete</span>
                  <input
                    type="date"
                    className={inputClassName}
                    value={freteVencimento}
                    onChange={(event) => setFreteVencimento(event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  onClick={importarFreteNoFinanceiro}
                  disabled={!cteChave || freteFinanceiroImportado || importandoFreteFinanceiro}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importandoFreteFinanceiro ? 'Importando...' : (freteFinanceiroImportado ? 'Frete ja importado' : 'Importar para o financeiro')}
                </button>
              </div>
            </div>

            {freteAnexoExistente ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                Arquivo atual:&nbsp;
                <a
                  href={toPublicAssetUrl(freteAnexoExistente.url) || freteAnexoExistente.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline"
                >
                  {freteAnexoExistente.nome}
                </a>
              </div>
            ) : null}

            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 transition hover:border-blue-500 dark:border-slate-700 dark:bg-slate-900">
              <Paperclip className="h-4 w-4 text-slate-500 dark:text-slate-300" />
              <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                {freteAnexo ? freteAnexo.name : (freteAnexoExistente?.nome || 'Clique para selecionar o arquivo do frete')}
              </span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setFreteAnexo(file);
                  setErroFrete(null);
                  event.currentTarget.value = '';
                }}
              />
            </label>

            {erroFrete ? <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{erroFrete}</p> : null}
            {freteAnexo && freteAnexoExistente ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Um novo arquivo de frete foi selecionado e sera referenciado no lugar do arquivo atual apos salvar/confirmar.
              </p>
            ) : null}
            {freteAnexo ? (
              <button
                type="button"
                onClick={() => setFreteAnexo(null)}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Remover arquivo de frete
              </button>
            ) : null}
          </div>
        </section> }

        {/* Botoes de Acao do Formulario */}
        <div className="mt-8 flex w-full items-center justify-end gap-2 border-t border-slate-200 pt-6 dark:border-slate-700">
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
            onClick={() => confirmarFormulario(false)}
            disabled={confirmandoImportacao}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {confirmandoImportacao ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {confirmandoImportacao
              ? (formMode === 'EDITAR' ? 'Salvando...' : 'Confirmando...')
              : (formMode === 'EDITAR' ? 'Salvar' : 'Confirmar')}
          </button>
        </div>
    </div>
  );
}
