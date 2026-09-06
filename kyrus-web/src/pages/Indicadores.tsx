import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Building2,
  FileSpreadsheet,
  Filter,
} from 'lucide-react';
import { BoletimFiltrosSidebar } from '../components/BoletimFiltrosSidebar';
import type { BoletimFiltrosAvancados } from '../components/BoletimFiltrosSidebar';
import { SearchableSelect } from '../components/SearchableSelect';
import ExcelJS from 'exceljs';
import { AsyncApexChart } from '../components/AsyncApexChart';
import axios from 'axios';
import { api, getPublicBaseUrl, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { useKyrusWsListener } from '../hooks/useKyrusWebSocket';
import { useTransactionStore } from '../store/transactionStore';
import type { LancamentoResumo, NormalizedRow, StatusFilter, FlowFilter } from '../store/transactionStore';

interface ContaResumo {
  id: number;
  nome: string;
  banco?: string | null;
  logo_url?: string | null;
  centro_custo_id?: number | null;
  tipo: string;
  saldo_inicial: number;
  saldo_atual?: number;
  status?: 'ATIVO' | 'INATIVO' | string;
  conta_como_disponibilidade?: boolean;
}

interface PlanoContaResumo {
  id: number;
  nome: string;
  tipo: string;
  conta_pai_id?: number | null;
  eh_operacional?: boolean;
  dre_grupo?: string;
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

interface HealthResponse {
  server_date?: string;
  server_datetime?: string;
}

function resolveCentroCustoId(currentValue: number | null, centros: CentroCustoResumo[]): number | null {
  if (currentValue === null) {
    return null;
  }
  if (centros.some((centro) => centro.id === currentValue)) {
    return currentValue;
  }
  return null;
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function getTodayInTimeZoneIso(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return toIsoDate(new Date());
  }

  return `${year}-${month}-${day}`;
}

function getBusinessTodayIso() {
  return getTodayInTimeZoneIso('America/Sao_Paulo');
}

function extractIsoDate(value?: string | null) {
  const match = String(value || '').trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function buildLancamentoFingerprint(item: Partial<LancamentoResumo>) {
  const idPart = Number(item.id);
  if (Number.isFinite(idPart) && idPart > 0) {
    return `id:${idPart}`;
  }

  const due = extractIsoDate(item.data_vencimento) || '';
  const descricao = normalizeText(item.descricao || '');
  const tipo = normalizeText(item.tipo || '');
  const previsto = Number(item.valor_previsto || 0);
  const pago = Number(item.valor_pago || 0);
  return `fp:${due}|${descricao}|${tipo}|${previsto}|${pago}`;
}

function dedupeLancamentos(items: LancamentoResumo[]) {
  const seen = new Set<string>();
  const unique: LancamentoResumo[] = [];

  items.forEach((item) => {
    const key = buildLancamentoFingerprint(item);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(item);
  });

  return unique;
}

function formatDate(value?: string | null) {
  const parsed = parseDateOnly(value);
  return parsed ? parsed.toLocaleDateString('pt-BR') : '-';
}

function formatCurrency(value: number) {
  return BRL.format(value).replace(/\s/g, '\u00A0');
}

function formatCurrencyCompact(value: number) {
  const abs = Math.abs(Number(value || 0));
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} bi`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mi`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return `${Math.round(value)}`;
}

function readChartDataPointIndex(config: any) {
  const directIndex = Number(config?.dataPointIndex);
  if (Number.isFinite(directIndex) && directIndex >= 0) return directIndex;

  const globalsIndex = Number(config?.w?.globals?.dataPointIndex);
  if (Number.isFinite(globalsIndex) && globalsIndex >= 0) return globalsIndex;

  const selectedDataPoints = config?.w?.globals?.selectedDataPoints;
  if (Array.isArray(selectedDataPoints)) {
    for (const seriesPoints of selectedDataPoints) {
      if (!Array.isArray(seriesPoints) || seriesPoints.length === 0) continue;
      const idx = Number(seriesPoints[seriesPoints.length - 1]);
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
  }

  return -1;
}

function resolveContaDisplayName(conta?: Pick<ContaResumo, 'nome' | 'banco'> | null) {
  const accountName = String(conta?.nome || '').trim();
  if (accountName) return accountName;
  const bankName = String(conta?.banco || '').trim();
  return bankName || 'Sem banco';
}

function extractAsaasInterestedFromDescricao(descricao?: string | null) {
  const text = String(descricao || '').trim();
  if (!text) return null;

  const patterns = [
    /(?:cliente|customer|pagador)\s*:\s*([^\n|;,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || '').trim().replace(/[\s.]+$/, '');
    if (value) return value;
  }

  return null;
}

function extractAsaasIdFromObservacao(observacao?: string | null) {
  const text = String(observacao || '').trim();
  if (!text) return null;

  const patterns = [
    /asaas\s*id\s*:\s*([A-Za-z0-9_\-]+)/i,
    /\bid\s*:\s*([A-Za-z0-9_\-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || '').trim();
    if (value) return value;
  }

  return null;
}

function resolveLancamentoInteressado(
  item: Pick<LancamentoResumo, 'entidade_id' | 'descricao'>,
  entityMap: Map<number, string>
) {
  const defaultInterested = String(entityMap.get(Number(item.entidade_id)) || '').trim();
  const isGenericAsaas = normalizeText(defaultInterested).includes('asaas');

  if (!defaultInterested || isGenericAsaas) {
    const extracted = extractAsaasInterestedFromDescricao(item.descricao);
    if (extracted) return extracted;
  }

  return defaultInterested || 'Sem interessado';
}

function getValueTone(value: number, isDark: boolean) {
  if (value < 0) return isDark ? 'text-rose-300' : 'text-rose-600';
  if (value > 0) return isDark ? 'text-emerald-300' : 'text-emerald-600';
  return isDark ? 'text-white' : 'text-slate-900';
}

function getStatusLabel(status: StatusFilter) {
  const labels: Record<StatusFilter, string> = {
    TODOS: 'Todos',
    PAGO: 'Pago',
    EM_ABERTO: 'Em aberto',
    ATRASADO: 'Atrasado',
    HOJE: 'Vence hoje',
    AMANHA: 'Vence amanhã',
  };
  return labels[status];
}

function normalizeLancamentoTipo(tipo?: string | null) {
  return normalizeText(tipo).replace(/\s+/g, '');
}

function isReceita(tipo?: string | null) {
  const normalized = normalizeLancamentoTipo(tipo);
  if (!normalized) return false;
  return (
    normalized.startsWith('r')
    || normalized.startsWith('receita')
    || normalized.startsWith('recebimento')
    || normalized.startsWith('entrada')
    || normalized.startsWith('credito')
  );
}

function isDespesa(tipo?: string | null) {
  const normalized = normalizeLancamentoTipo(tipo);
  if (!normalized) return false;
  return (
    normalized.startsWith('d')
    || normalized.startsWith('despesa')
    || normalized.startsWith('pagamento')
    || normalized.startsWith('saida')
    || normalized.startsWith('debito')
  );
}

function isPago(itemOrStatus?: Pick<LancamentoResumo, 'status' | 'data_pagamento' | 'valor_pago'> | string | null) {
  if (typeof itemOrStatus === 'string' || itemOrStatus == null) {
    const s = normalizeText(itemOrStatus as string | null);
    return s === 'pago' || s.startsWith('parcial');
  }

  const normalizedStatus = normalizeText(itemOrStatus.status);
  if (
    normalizedStatus === 'pago' ||
    normalizedStatus === 'quitado' ||
    normalizedStatus === 'liquidado' ||
    normalizedStatus.startsWith('parcial')
  ) {
    return true;
  }

  if (Boolean(itemOrStatus.data_pagamento)) {
    return true;
  }

  return Number(itemOrStatus.valor_pago || 0) > 0;
}

function getFullLogoUrl(url?: string | null) {
  return toPublicAssetUrl(url);
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



function FilterPill({ active, label, onClick, isDark }: { active: boolean; label: string; onClick: () => void; isDark: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition ${active ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white' : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}
    >
      {label}
    </button>
  );
}

function getStatusKey(item: LancamentoResumo, todayIso: string, tomorrowIso: string): StatusFilter {
  if (isPago(item)) return 'PAGO';
  const due = item.data_vencimento?.slice(0, 10);
  if (due === todayIso) return 'HOJE';
  if (due === tomorrowIso) return 'AMANHA';
  if (due && due < todayIso) return 'ATRASADO';
  return 'EM_ABERTO';
}

function buildMonthLabel(monthIndex: number, year: number) {
  return `${MONTH_NAMES[monthIndex]}/${String(year).slice(2)}`;
}

function applyFilters(
  rows: NormalizedRow[],
  filters: {
    flowType: FlowFilter;
    status: StatusFilter;
    monthIndex: number | null;
    dayOfMonth: number | null;
    fallbackMonthIndex: number;
  },
  options?: {
    ignoreFlow?: boolean;
    ignoreStatus?: boolean;
    ignoreMonth?: boolean;
    ignoreDay?: boolean;
  },
) {
  const effectiveMonth = filters.monthIndex ?? filters.fallbackMonthIndex;
  return rows.filter((row) => {
    if (!options?.ignoreFlow && filters.flowType !== 'ALL' && row.flowType !== filters.flowType) return false;
    if (!options?.ignoreStatus && filters.status !== 'TODOS' && row.statusKey !== filters.status) return false;
    if (!options?.ignoreMonth && filters.monthIndex !== null && row.monthIndex !== filters.monthIndex) return false;
    if (!options?.ignoreDay && filters.dayOfMonth !== null) {
      if (row.monthIndex !== effectiveMonth) return false;
      if (row.dayOfMonth !== filters.dayOfMonth) return false;
    }
    return true;
  });
}

const EMPTY_ARRAY: any[] = [];

export function Indicadores() {
  const [referenceDate, setReferenceDate] = useState(() => getBusinessTodayIso());
  const referenceYear = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackDate = parseDateOnly(getBusinessTodayIso()) || new Date();
    return (parsedReference || fallbackDate).getFullYear();
  }, [referenceDate]);

  const refreshCount = useTransactionStore((state) => state.refreshCount);

  // --- WEBSOCKETS ---
  useKyrusWsListener('LANCAMENTO_CREATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_UPDATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_DELETED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_CREATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_UPDATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('MOVIMENTACAO_PDV_DELETED', () => useTransactionStore.getState().invalidateAndRefresh());

  const [loading, setLoading] = useState(() => {
    const initialYear = (parseDateOnly(getBusinessTodayIso()) || new Date()).getFullYear();
    const txCache = useTransactionStore.getState().yearCache[initialYear];
    const hasCachedTransactions = !!txCache && txCache.length > 0;
    const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
    return !hasCachedTransactions || !hasCachedLookups;
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const empresa = useAuthStore((state) => state.empresa);

  const isDark = useIsDarkMode();
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosAvancados, setFiltrosAvancados] = useState<BoletimFiltrosAvancados>({
    categoriaIds: new Set<number>(),
    contaIds: new Set<number>(),
    interessados: new Set<string>(),
    dataInicio: '',
    dataFim: ''
  });
  const [indicadoresLimit, setIndicadoresLimit] = useState(100);
  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);

  const lancamentos = useTransactionStore((state) => state.yearCache[referenceYear] || EMPTY_ARRAY);
  const asaasRows = useTransactionStore((state) => state.asaasCache[referenceYear] || EMPTY_ARRAY);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);
  const fetchYearTransactions = useTransactionStore((state) => state.fetchYearTransactions);
  const fetchAsaasRows = useTransactionStore((state) => state.fetchAsaasRows);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('ALL');
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number | null>(null);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState<number | null>(null);

  const globalSelectedCentroCustoId = useLookupStore((state) => state.selectedCentroCustoId);
  const setSelectedCentroCustoIdGlobally = useLookupStore((state) => state.setSelectedCentroCustoId);
  const selectedCentroCustoId = useMemo(() => {
    return globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId;
  }, [globalSelectedCentroCustoId]);
  const setSelectedCentroCustoId = useCallback((id: number | null | ((prev: number | null) => number | null)) => {
    const computedVal = typeof id === 'function' ? id(globalSelectedCentroCustoId === 'ALL' ? null : globalSelectedCentroCustoId) : id;
    setSelectedCentroCustoIdGlobally(computedVal === null ? 'ALL' : computedVal);
  }, [globalSelectedCentroCustoId, setSelectedCentroCustoIdGlobally]);

  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function syncReferenceDateWithServer() {
      try {
        const response = await api.get<HealthResponse>('/health', { baseURL: getPublicBaseUrl() });
        if (!active) return;
        const serverDate = extractIsoDate(response.data?.server_date || response.data?.server_datetime);
        if (!serverDate) return;

        setReferenceDate((current) => {
          const fallbackToday = getBusinessTodayIso();
          const currentDate = extractIsoDate(current);
          if (!currentDate || currentDate === fallbackToday) {
            return serverDate;
          }
          return current;
        });
      } catch {
        // Mantem fallback local quando nao for possivel consultar a data do servidor.
      }
    }

    void syncReferenceDateWithServer();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadData(force = false) {
      const hasCachedTransactions = !!useTransactionStore.getState().yearCache[referenceYear];
      const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
      const shouldShowLoader = !hasCachedTransactions || !hasCachedLookups;

      if (shouldShowLoader) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        await Promise.all([
          fetchContas(force),
          fetchPlanoContas(force),
          fetchEntidadesLookup(force),
          fetchCentrosCusto(force),
          fetchYearTransactions(referenceYear, force),
        ]);

        if (active) {
          setSelectedCentroCustoId((currentValue: number | null) =>
            resolveCentroCustoId(currentValue, useLookupStore.getState().centrosCusto)
          );
        }

        void fetchAsaasRows(referenceYear, force).catch((err) => {
          if (!axios.isCancel(err)) {
            console.error('Erro ao carregar cobranças Asaas:', err);
          }
        });
      } catch (err: any) {
        if (axios.isCancel(err)) return;
        console.error('Erro ao carregar dados dos indicadores:', err);
        if (active) {
          setLoadError('Parte dos dados dos indicadores não pôde ser carregada.');
        }
      } finally {
        if (active) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        }
      }
    }

    void loadData(false);

    return () => {
      active = false;
    };
  }, [referenceYear, refreshCount]);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenuPos(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleExportExcel = async (customRows?: NormalizedRow[], prefix?: string) => {
    setIsExportingExcel(true);
    try {
      const rowsToExport = customRows || dashboard.tableRows;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Indicadores');

      // Title Row
      worksheet.mergeCells('A1:H1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de Indicadores - ${dashboard.effectiveMonthLabel}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      // Header Row
      const headers = ['Data Vencimento', 'Interessado / Entidade', 'Descrição', 'Valor (R$)', 'Operação', 'Categoria', 'Banco / Conta', 'Status'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const catMap = new Map(categorias.map((c) => [c.id, c.nome]));
      const contaMap = new Map(contas.map((c) => [c.id, c.nome]));

      // Data Rows
      rowsToExport.forEach((row) => {
        const catNome = row.contaId ? catMap.get(Number(row.contaId)) || '-' : '-';
        const contaNome = row.contaNome || (row.contaId ? contaMap.get(Number(row.contaId)) || '-' : '-');

        const addedRow = worksheet.addRow([
          formatDate(row.dataVencimento),
          row.interessado || '-',
          row.descricao || '-',
          Number(row.valorAbsoluto || 0),
          row.flowType === 'RECEBIMENTO' ? 'Receita' : 'Despesa',
          catNome,
          contaNome,
          row.statusLabel || '-',
        ]);

        addedRow.height = 20;

        const valCell = addedRow.getCell(4);
        valCell.numFmt = '"R$"#,##0.00;[Red]-"R$"#,##0.00';
        valCell.alignment = { horizontal: 'right', vertical: 'middle' };

        addedRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
        addedRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Auto width
      worksheet.columns.forEach((column) => {
        let maxLen = 14;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const len = cell.value ? String(cell.value).length : 10;
          if (len > maxLen) maxLen = len;
        });
        column.width = Math.min(maxLen + 4, 45);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = `${prefix || 'Indicadores_Boletim'}_${dashboard.effectiveMonthLabel.replace('/', '_')}.xlsx`;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao exportar planilha de Indicadores:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };




  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackToday = parseDateOnly(getBusinessTodayIso()) || new Date();
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : fallbackToday;
    const currentYear = now.getFullYear();
    const fallbackMonthIndex = now.getMonth();
    const todayIso = toIsoDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowIso = toIsoDate(tomorrow);
    const effectiveMonthIndex = selectedMonthIndex ?? fallbackMonthIndex;
    const entityMap = new Map(entidades.map((item) => [item.id, item.nome_fantasia || item.nome]));
    const contaMap = new Map(contas.map((item) => [item.id, item]));
    const relevantes = categorias.filter((conta) => isReceita(conta.tipo) || isDespesa(conta.tipo));
    const contaPorId = new Map<number, PlanoContaResumo>();
    relevantes.forEach((conta) => contaPorId.set(conta.id, conta));

    const resolvedDreGroupsCache: Record<number, string> = {};

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
      if (contaId in resolvedDreGroupsCache) {
        return resolvedDreGroupsCache[contaId];
      }
      const conta = contaPorId.get(contaId);
      const grupoNormalizado = String(conta?.dre_grupo || '').trim().toUpperCase();
      let res = grupoNormalizado;
      if (!res) {
        if (conta && isReceita(conta.tipo)) {
          res = 'RECEITA_BRUTA';
        } else {
          res = classificarHeuristicaLegada(contaId);
        }
      }
      resolvedDreGroupsCache[contaId] = res;
      return res;
    };

    const EXCLUDED_BOLETIM_DRE_GROUPS = new Set([
      'FORA_DRE',
      'FORA DRE',
      'FORA DA DRE',
      'NAO_OPERACIONAL',
      'NÃO_OPERACIONAL',
      'NAO OPERACIONAL',
      'NÃO OPERACIONAL',
      'NAO OPERACIONAL / FORA DA DRE',
      'NAO OP.',
      'NAO_DRE',
      'NÃO_DRE',
    ]);

    const isForaDre = (contaId: number): boolean => {
      if (!contaId || contaId <= 0) return false;
      const conta = contaPorId.get(contaId);
      if (conta) {
        if (conta.eh_operacional === false) return true;
        if ((conta as any).considerar_nos_resultados === false) return true;
        const grupoNormalizado = String(conta.dre_grupo || '').trim().toUpperCase();
        if (EXCLUDED_BOLETIM_DRE_GROUPS.has(grupoNormalizado)) return true;
      }
      const dreGrupo = resolverDreGrupo(contaId);
      if (EXCLUDED_BOLETIM_DRE_GROUPS.has(dreGrupo)) return true;
      return false;
    };

    const dbAsaasIds = new Set<string>();

    const baseRows = [
      ...lancamentos
        .filter((item) => selectedCentroCustoId === null || Number(item.centro_custo_id) === selectedCentroCustoId)
        .filter((item) => {
          if (filtrosAvancados.categoriaIds.size > 0 && !filtrosAvancados.categoriaIds.has(Number(item.plano_contas_id))) return false;
          if (filtrosAvancados.contaIds.size > 0 && !filtrosAvancados.contaIds.has(Number(item.conta_id || (item as any).conta_bancaria_id))) return false;
          if (filtrosAvancados.interessados.size > 0) {
            const int = resolveLancamentoInteressado(item, entityMap);
            if (!filtrosAvancados.interessados.has(int)) return false;
          }
          if (filtrosAvancados.dataInicio && item.data_vencimento < filtrosAvancados.dataInicio) return false;
          if (filtrosAvancados.dataFim && item.data_vencimento > filtrosAvancados.dataFim) return false;

          const isPaid = getStatusKey(item, todayIso, tomorrowIso) === 'PAGO' || Boolean(item.data_pagamento) || Number(item.valor_pago || 0) > 0;
          const bankId = Number(item.conta_id || (item as any).conta_bancaria_id || 0);
          if (isPaid && bankId <= 0) return false;
          const contaId = Number(item.plano_contas_id);
          if (contaId > 0 && isForaDre(contaId)) return false;
          return true;
        })
        .map((item) => {
          const due = parseDateOnly(item.data_vencimento);
          const flowType: FlowFilter = isReceita(item.tipo) ? 'RECEBIMENTO' : 'PAGAMENTO';
          const statusKey = getStatusKey(item, todayIso, tomorrowIso);
          const hasPaidValue = item.valor_pago !== null && item.valor_pago !== undefined && Number(item.valor_pago) > 0;
          const baseValue = Number(statusKey === 'PAGO' && hasPaidValue ? item.valor_pago : item.valor_previsto ?? item.valor_pago ?? 0);
          const signedValue = flowType === 'RECEBIMENTO' ? baseValue : baseValue * -1;
          const rawId = Number(item.id);
          const safeId = Number.isFinite(rawId) ? rawId : -1;

          const asaasId = extractAsaasIdFromObservacao(item.observacao);
          if (asaasId) {
            dbAsaasIds.add(asaasId);
          }

          let bandeira: string | null = null;
          let tipoPagamento: string | null = null;
          if (item.observacao && item.observacao.trim().startsWith('{') && item.observacao.trim().endsWith('}')) {
            try {
              const meta = JSON.parse(item.observacao);
              tipoPagamento = meta.tipo_pagamento || meta.forma_pagamento || null;
              bandeira = meta.bandeira || null;
            } catch { /* não é JSON */ }
          }

          return {
            rowKey: `${buildLancamentoFingerprint(item)}|cc:${Number(item.centro_custo_id || 0)}|conta:${Number(item.conta_id || 0)}`,
            id: safeId,
            descricao: item.descricao,
            flowType,
            statusKey,
            statusLabel: getStatusLabel(statusKey),
            dataVencimento: item.data_vencimento,
            monthIndex: due ? due.getMonth() : -1,
            dayOfMonth: due ? due.getDate() : -1,
            valor: signedValue,
            valorAbsoluto: Math.abs(signedValue),
            interessado: resolveLancamentoInteressado(item, entityMap),
            contaId: item.conta_id,
            contaNome: resolveContaDisplayName(contaMap.get(Number(item.conta_id))),
            centroCustoId: item.centro_custo_id,
            origem: item.origem,
            bandeira,
            tipoPagamento,
          } satisfies NormalizedRow;
        })
        .filter((item) => item.monthIndex >= 0 && item.dayOfMonth >= 0),
      ...asaasRows
        .filter((item) => {
          const parsed = parseDateOnly(item.dataVencimento);
          return parsed !== null && parsed.getFullYear() === currentYear;
        })
        .filter((item) => selectedCentroCustoId === null || Number(item.centroCustoId) === selectedCentroCustoId)
        .filter((item) => {
          if (filtrosAvancados.categoriaIds.size > 0) return false;
          if (filtrosAvancados.contaIds.size > 0) return false;
          if (filtrosAvancados.interessados.size > 0 && !filtrosAvancados.interessados.has(item.interessado)) return false;
          if (filtrosAvancados.dataInicio && item.dataVencimento < filtrosAvancados.dataInicio) return false;
          if (filtrosAvancados.dataFim && item.dataVencimento > filtrosAvancados.dataFim) return false;

          const asaasId = item.rowKey.replace('asaas-charge-', '');
          return !dbAsaasIds.has(asaasId);
        })
        .map((item) => {
          let statusKey = 'EM_ABERTO' as StatusFilter;
          let statusLabel = 'A vencer';

          if (item.isAtrasada || (item.dataVencimento && item.dataVencimento < todayIso)) {
            statusKey = 'ATRASADO';
            statusLabel = 'Atrasado';
          } else if (item.dataVencimento === todayIso) {
            statusKey = 'HOJE';
            statusLabel = 'Hoje';
          } else if (item.dataVencimento === tomorrowIso) {
            statusKey = 'AMANHA';
            statusLabel = 'Amanhã';
          }

          return {
            ...item,
            statusKey,
            statusLabel,
          };
        })
    ];

    const activeRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    });

    const sumValues = (rows: NormalizedRow[]) => rows.reduce((acc, item) => acc + item.valorAbsoluto, 0);

    const situacaoRows = applyFilters(baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex,
    }, { ignoreStatus: true });

    const situacao = {
      PAGO: sumValues(situacaoRows.filter((item) => item.statusKey === 'PAGO')),
      EM_ABERTO: sumValues(situacaoRows.filter((item) => item.statusKey === 'EM_ABERTO')),
      ATRASADO: sumValues(situacaoRows.filter((item) => item.statusKey === 'ATRASADO')),
      AMANHA: sumValues(situacaoRows.filter((item) => item.statusKey === 'AMANHA')),
      HOJE: sumValues(situacaoRows.filter((item) => item.statusKey === 'HOJE')),
    };

    const tableRows = [...activeRows]
      .filter((row) => {
        if (!searchTerm) return true;
        const term = normalizeText(searchTerm);
        return (
          normalizeText(row.descricao).includes(term) ||
          normalizeText(row.interessado).includes(term) ||
          String(row.valorAbsoluto).includes(term)
        );
      })
      .sort((left, right) => {
        if (left.dataVencimento !== right.dataVencimento) return String(left.dataVencimento).localeCompare(String(right.dataVencimento));
        return right.valorAbsoluto - left.valorAbsoluto;
      });

    return {
      now,
      currentYear,
      fallbackMonthIndex,
      effectiveMonthIndex,
      effectiveMonthLabel: buildMonthLabel(effectiveMonthIndex, currentYear),
      monthLabels: MONTH_NAMES.map((label) => `${label}/${String(currentYear).slice(2)}`),
      baseRows,
      tableRows,
      situacao,
      todayIso,
      tomorrowIso,
    };
  }, [categorias, contas, entidades, lancamentos, selectedCentroCustoId, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter, referenceDate, asaasRows, searchTerm, filtrosAvancados]);

  useEffect(() => {
    const daysInSelectedMonth = new Date(dashboard.currentYear, dashboard.effectiveMonthIndex + 1, 0).getDate();
    if (selectedDayOfMonth && selectedDayOfMonth > daysInSelectedMonth) {
      setSelectedDayOfMonth(null);
    }
  }, [dashboard.currentYear, dashboard.effectiveMonthIndex, selectedDayOfMonth]);

  const activeFilterTags = useMemo(() => {
    const tags: Array<{ key: string; label: string; onClear: () => void }> = [];
    if (flowFilter !== 'ALL') {
      tags.push({ key: 'flow', label: flowFilter === 'PAGAMENTO' ? 'Tipo: Pagamento' : 'Tipo: Recebimento', onClear: () => setFlowFilter('ALL') });
    }
    if (selectedMonthIndex !== null) {
      tags.push({ key: 'month', label: `Mês: ${dashboard.monthLabels[selectedMonthIndex]}`, onClear: () => { setSelectedMonthIndex(null); setSelectedDayOfMonth(null); } });
    }
    if (selectedDayOfMonth !== null) {
      tags.push({ key: 'day', label: `Dia: ${String(selectedDayOfMonth).padStart(2, '0')}/${String(dashboard.effectiveMonthIndex + 1).padStart(2, '0')}`, onClear: () => setSelectedDayOfMonth(null) });
    }
    if (statusFilter !== 'TODOS') {
      const labels: Record<StatusFilter, string> = {
        TODOS: 'Todos',
        PAGO: 'Pago',
        EM_ABERTO: 'Em aberto',
        ATRASADO: 'Atrasado',
        HOJE: 'Vence hoje',
        AMANHA: 'Vence amanhã',
      };
      tags.push({ key: 'status', label: `Situação: ${labels[statusFilter]}`, onClear: () => setStatusFilter('TODOS') });
    }
    return tags;
  }, [dashboard.effectiveMonthIndex, dashboard.monthLabels, flowFilter, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

  const situacaoCards: Array<{ label: string; key: StatusFilter; value: number }> = [
    { label: 'Pago', key: 'PAGO', value: dashboard.situacao.PAGO },
    { label: 'Em Aberto', key: 'EM_ABERTO', value: dashboard.situacao.EM_ABERTO },
    { label: 'Atrasado', key: 'ATRASADO', value: dashboard.situacao.ATRASADO },
    { label: 'Vcto Amanhã', key: 'AMANHA', value: dashboard.situacao.AMANHA },
    { label: 'Vcto Hoje', key: 'HOJE', value: dashboard.situacao.HOJE },
  ];

  const payReceiveCharts = useMemo(() => {
    const pagamentoColor = '#ff4d4f';
    const recebimentoColor = '#4d8cf3';
    const destaqueColor = '#f2c94c';
    const mutedColor = isDark ? '#cbd5e1' : '#d1d5db';
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.16)';
    const cardStrokeColor = isDark ? '#081124' : '#ffffff';
    const chartTheme = isDark ? 'dark' : 'light';
    const effectiveMonth = selectedMonthIndex ?? dashboard.fallbackMonthIndex;

    const resolveFlowColor = (flow: FlowFilter) => flow === 'PAGAMENTO' ? pagamentoColor : recebimentoColor;
    const shouldDimFlow = (flow: FlowFilter) => flowFilter !== 'ALL' && flowFilter !== flow;

    const rowsForFlow = applyFilters(dashboard.baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex: dashboard.fallbackMonthIndex,
    }, {
      ignoreFlow: true,
    });

    const flowTotals = rowsForFlow.reduce((acc, row) => {
      if (row.flowType === 'PAGAMENTO') acc.pagamento += row.valorAbsoluto;
      if (row.flowType === 'RECEBIMENTO') acc.recebimento += row.valorAbsoluto;
      return acc;
    }, { pagamento: 0, recebimento: 0 });

    const rowsForTimeline = applyFilters(dashboard.baseRows, {
      flowType: flowFilter,
      status: statusFilter,
      monthIndex: selectedMonthIndex,
      dayOfMonth: selectedDayOfMonth,
      fallbackMonthIndex: dashboard.fallbackMonthIndex,
    }, {
      ignoreFlow: true,
      ignoreMonth: true,
      ignoreDay: true,
    });

    const monthlyPagamento = Array.from({ length: 12 }, () => 0);
    const monthlyRecebimento = Array.from({ length: 12 }, () => 0);

    rowsForTimeline.forEach((row) => {
      if (row.monthIndex < 0 || row.monthIndex > 11) return;
      if (row.flowType === 'PAGAMENTO') monthlyPagamento[row.monthIndex] += row.valorAbsoluto;
      if (row.flowType === 'RECEBIMENTO') monthlyRecebimento[row.monthIndex] += row.valorAbsoluto;
    });

    const daysInMonth = new Date(dashboard.currentYear, effectiveMonth + 1, 0).getDate();
    const dailyPagamento = Array.from({ length: daysInMonth }, () => 0);
    const dailyRecebimento = Array.from({ length: daysInMonth }, () => 0);

    rowsForTimeline
      .filter((row) => row.monthIndex === effectiveMonth)
      .forEach((row) => {
        const dayIndex = Number(row.dayOfMonth || 0) - 1;
        if (dayIndex < 0 || dayIndex >= daysInMonth) return;
        if (row.flowType === 'PAGAMENTO') dailyPagamento[dayIndex] += row.valorAbsoluto;
        if (row.flowType === 'RECEBIMENTO') dailyRecebimento[dayIndex] += row.valorAbsoluto;
      });

    const donutSeries = [flowTotals.pagamento, flowTotals.recebimento];
    const donutColors = [
      shouldDimFlow('PAGAMENTO') ? mutedColor : pagamentoColor,
      shouldDimFlow('RECEBIMENTO') ? mutedColor : recebimentoColor,
    ];

    const monthlySeries = flowFilter === 'ALL'
      ? [
        {
          name: 'Pagamento',
          data: monthlyPagamento.map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: resolveFlowColor('PAGAMENTO'),
          })),
        },
        {
          name: 'Recebimento',
          data: monthlyRecebimento.map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ]
      : [
        {
          name: flowFilter === 'PAGAMENTO' ? 'Pagamento' : 'Recebimento',
          data: (flowFilter === 'PAGAMENTO' ? monthlyPagamento : monthlyRecebimento).map((value, monthIndex) => ({
            x: dashboard.monthLabels[monthIndex],
            y: value,
            fillColor: flowFilter === 'PAGAMENTO' ? resolveFlowColor('PAGAMENTO') : resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ];

    const dailySeries = flowFilter === 'ALL'
      ? [
        {
          name: 'Pagamento',
          data: dailyPagamento.map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: resolveFlowColor('PAGAMENTO'),
          })),
        },
        {
          name: 'Recebimento',
          data: dailyRecebimento.map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ]
      : [
        {
          name: flowFilter === 'PAGAMENTO' ? 'Pagamento' : 'Recebimento',
          data: (flowFilter === 'PAGAMENTO' ? dailyPagamento : dailyRecebimento).map((value, dayIndex) => ({
            x: String(dayIndex + 1),
            y: value,
            fillColor: flowFilter === 'PAGAMENTO' ? resolveFlowColor('PAGAMENTO') : resolveFlowColor('RECEBIMENTO'),
          })),
        },
      ];

    const resolveFlowBySeriesIndex = (seriesIndex: number): FlowFilter | null => {
      if (flowFilter === 'ALL') {
        if (seriesIndex === 0) return 'PAGAMENTO';
        if (seriesIndex === 1) return 'RECEBIMENTO';
      } else {
        return flowFilter;
      }
      return null;
    };

    const donutOptions: any = {
      chart: {
        type: 'donut',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const idx = Number(config?.dataPointIndex);
            if (idx < 0) return;
            const nextFlow: FlowFilter = idx === 0 ? 'PAGAMENTO' : 'RECEBIMENTO';
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
        },
      },
      noData: { text: 'Sem dados' },
      labels: ['Pagamento', 'Recebimento'],
      colors: donutColors,
      stroke: { width: 2, colors: [cardStrokeColor] },
      states: {
        hover: { filter: { type: 'none', value: 0 } },
        active: { filter: { type: 'none', value: 0 } },
      },
      theme: { mode: chartTheme },
      dataLabels: {
        enabled: true,
        formatter: (value: number) => `${value.toFixed(0)}%`,
      },
      legend: {
        show: true,
        position: 'bottom',
        fontSize: '11px',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      plotOptions: {
        pie: {
          donut: {
            size: '62%',
            labels: {
              show: false,
            },
          },
        },
      },
      tooltip: {
        theme: chartTheme,
        y: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
    };

    const monthlyOptions: any = {
      chart: {
        type: 'bar',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const monthIndex = readChartDataPointIndex(config);
            const nextFlow = resolveFlowBySeriesIndex(Number(config?.seriesIndex));
            if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return;

            setSelectedDayOfMonth(null);

            if (nextFlow) {
              const sameSelection = selectedMonthIndex === monthIndex && flowFilter === nextFlow;
              if (sameSelection) {
                setSelectedMonthIndex(null);
                setFlowFilter('ALL');
                return;
              }
              setSelectedMonthIndex(monthIndex);
              setFlowFilter(nextFlow);
              return;
            }

            setSelectedMonthIndex((prev) => (prev === monthIndex ? null : monthIndex));
          },
        },
      },
      noData: { text: 'Sem dados' },
      theme: { mode: chartTheme },
      colors: [pagamentoColor, recebimentoColor, destaqueColor],
      plotOptions: {
        bar: {
          horizontal: false,
          borderRadius: 2,
          columnWidth: '58%',
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      states: {
        hover: { filter: { type: 'lighten', value: 0.08 } },
        active: { filter: { type: 'lighten', value: 0.18 } },
      },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      xaxis: {
        categories: dashboard.monthLabels,
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
          formatter: (value: number) => formatCurrencyCompact(value),
        },
      },
      tooltip: {
        theme: chartTheme,
        y: { formatter: (value: number) => formatCurrency(value) },
      },
    };

    const dailyOptions: any = {
      chart: {
        type: 'bar',
        background: 'transparent',
        toolbar: { show: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          legendClick: (_chartCtx: any, seriesIndex: number) => {
            const nextFlow = resolveFlowBySeriesIndex(Number(seriesIndex));
            if (!nextFlow) return;
            setFlowFilter((prev) => (prev === nextFlow ? 'ALL' : nextFlow));
          },
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const dayIndex = readChartDataPointIndex(config);
            const nextFlow = resolveFlowBySeriesIndex(Number(config?.seriesIndex));
            if (!Number.isFinite(dayIndex) || dayIndex < 0) return;

            const day = dayIndex + 1;

            if (nextFlow) {
              const sameSelection = selectedMonthIndex === effectiveMonth && selectedDayOfMonth === day && flowFilter === nextFlow;
              if (sameSelection) {
                setSelectedDayOfMonth(null);
                setFlowFilter('ALL');
                return;
              }
              setSelectedMonthIndex(effectiveMonth);
              setSelectedDayOfMonth(day);
              setFlowFilter(nextFlow);
              return;
            }

            setSelectedMonthIndex(effectiveMonth);
            setSelectedDayOfMonth((prev) => (prev === day ? null : day));
          },
        },
      },
      noData: { text: 'Sem dados' },
      theme: { mode: chartTheme },
      colors: [pagamentoColor, recebimentoColor],
      plotOptions: {
        bar: {
          horizontal: false,
          borderRadius: 2,
          columnWidth: '66%',
        },
      },
      dataLabels: { enabled: false },
      stroke: { show: false },
      states: {
        hover: { filter: { type: 'lighten', value: 0.08 } },
        active: { filter: { type: 'lighten', value: 0.18 } },
      },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      legend: {
        position: 'top',
        horizontalAlign: 'left',
        labels: { colors: labelColor },
        onItemClick: { toggleDataSeries: false },
      },
      xaxis: {
        categories: Array.from({ length: daysInMonth }, (_, index) => String(index + 1)),
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
        },
      },
      yaxis: {
        labels: {
          style: { colors: labelColor, fontSize: '10px' },
          formatter: (value: number) => formatCurrencyCompact(value),
        },
      },
      tooltip: {
        theme: chartTheme,
        y: { formatter: (value: number) => formatCurrency(value) },
      },
    };

    return {
      donutSeries,
      donutOptions,
      monthlySeries,
      monthlyOptions,
      dailySeries,
      dailyOptions,
      effectiveMonthLabel: dashboard.monthLabels[effectiveMonth],
    };
  }, [dashboard.baseRows, dashboard.currentYear, dashboard.fallbackMonthIndex, dashboard.monthLabels, flowFilter, isDark, selectedDayOfMonth, selectedMonthIndex, statusFilter]);

  useEffect(() => {
    setIndicadoresLimit(100);
  }, [dashboard.tableRows]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  if (loading && !initialLoadDoneRef.current) {
    return (
      <div className={`p-8 space-y-6 ${isDark ? 'bg-[#0d1117] text-white' : 'bg-slate-50'}`}>
        {/* Skeleton Header */}
        <div className="flex items-center gap-4 animate-pulse">
          <div className="w-16 h-16 rounded-lg bg-slate-300 dark:bg-slate-700" />
          <div className="space-y-2">
            <div className="w-48 h-6 rounded bg-slate-300 dark:bg-slate-700" />
            <div className="w-32 h-4 rounded bg-slate-300 dark:bg-slate-700" />
          </div>
        </div>
        {/* Skeleton Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-28 rounded-xl bg-slate-300 dark:bg-slate-700 p-4 space-y-3">
              <div className="w-20 h-4 rounded bg-slate-200 dark:bg-slate-600" />
              <div className="w-32 h-8 rounded bg-slate-200 dark:bg-slate-600" />
            </div>
          ))}
        </div>
        {/* Skeleton Main Chart */}
        <div className="h-96 rounded-xl bg-slate-300 dark:bg-slate-700 animate-pulse flex items-center justify-center">
          <div className="text-slate-400 dark:text-slate-500 font-bold">Carregando dados financeiros...</div>
        </div>
      </div>
    );
  }

  const pageClass = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.10),transparent_28%),linear-gradient(180deg,#030712_0%,#0b1220_100%)] text-white'
    : 'bg-white text-slate-900';
  const shellClass = isDark ? 'border-white/12 bg-slate-900/50' : 'border-slate-200 bg-white/94';
  const tableShellClass = isDark ? 'border-white/12 bg-slate-900/50' : 'border-slate-200 bg-white/94';

  return (
    <div className={`min-h-full ${pageClass}`}>
      <div className="mx-auto w-full space-y-3">
        <header className={`relative z-20 rounded-none border px-4 py-4 ${shellClass}`}>
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border ${isDark ? 'border-white/10 bg-white/95' : 'border-slate-200 bg-slate-100'}`}>
                {companyLogo ? <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" /> : <Building2 className="h-8 w-8 text-slate-400" />}
              </div>
              <div>
                <div className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{companyName}</div>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto xl:justify-end">

              <div className="w-full md:w-72">
                <SearchableSelect
                  value={selectedCentroCustoId === null ? 'TODOS' : String(selectedCentroCustoId)}
                  onChange={(val) => {
                    if (val === 'TODOS') {
                      setSelectedCentroCustoId(null);
                    } else {
                      setSelectedCentroCustoId(Number(val));
                    }
                  }}
                  options={[{
                    label: 'Centro de Custo',
                    options: [
                      { id: 'TODOS', label: 'Todos os centros de custo' },
                      ...centrosCusto.map((centro) => ({
                        id: centro.id,
                        label: `${centro.codigo ? `${centro.codigo} - ` : ''}${centro.nome}`
                      }))
                    ]
                  }]}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowFiltrosSidebar(true)}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${isDark ? 'border-white/10 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'} transition shadow-sm`}
                title="Filtros avançados"
              >
                <Filter className="h-5 w-5" />
              </button>
            </div>
          </div>

          {activeFilterTags.length > 0 ? (
            <div className={`mt-4 flex flex-wrap items-center gap-2 border-t pt-4 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
              {activeFilterTags.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  onClick={tag.onClear}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`}
                >
                  {tag.label} x
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFlowFilter('ALL');
                  setStatusFilter('TODOS');
                  setSelectedMonthIndex(null);
                  setSelectedDayOfMonth(null);
                }}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-amber-200 hover:text-amber-100' : 'text-amber-700 hover:text-amber-800'}`}
              >
                Limpar tudo
              </button>
            </div>
          ) : null}
        </header>

        {loadError ? (
          <div className={`rounded-lg border px-5 py-4 text-sm font-semibold ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {loadError}
          </div>
        ) : null}

        {/* TOP BAR OF INTERACTIVE SUMMARY BADGES */}

        
          <section className="space-y-3">
            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1040px] gap-3 xl:grid-cols-[250px_minmax(0,1fr)_minmax(0,1fr)]">
                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Filtro</div>
                    <button
                      type="button"
                      onClick={() => setFlowFilter('ALL')}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${flowFilter === 'ALL' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Limpar
                    </button>
                  </div>
                  <AsyncApexChart type="donut" height={235} series={payReceiveCharts.donutSeries} options={payReceiveCharts.donutOptions} />
                  <div className={`mt-1 text-[10px] ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Clique na rosca para filtrar por pagamento ou recebimento.</div>
                </section>

                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A pagar vs receber por mês (vcto)</div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMonthIndex(null);
                        setSelectedDayOfMonth(null);
                      }}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${selectedMonthIndex === null ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Limpar mês
                    </button>
                  </div>
                  <AsyncApexChart type="bar" height={235} series={payReceiveCharts.monthlySeries} options={payReceiveCharts.monthlyOptions} />
                </section>

                <section className={`rounded-2xl border px-3 py-3 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>A pagar vs receber por dia (vcto)</div>
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{payReceiveCharts.effectiveMonthLabel}</div>
                  </div>
                  <AsyncApexChart type="bar" height={235} series={payReceiveCharts.dailySeries} options={payReceiveCharts.dailyOptions} />
                </section>
              </div>
            </div>

            <div className="overflow-x-auto pb-1 custom-scrollbar">
              <div className="grid min-w-[1040px] gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                <section onContextMenu={handleContextMenu} className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Indicadores</div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-white/45' : 'text-slate-500'}`}>Grade rolável para não estourar a tela. Clique com botão direito na tabela para exportar em Excel.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        placeholder="Pesquisar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs outline-none transition w-full sm:w-60 ${isDark ? 'border-white/15 bg-slate-950/50 text-white focus:border-amber-300/60' : 'border-slate-300 bg-white text-slate-700 focus:border-blue-500'}`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <FilterPill active={statusFilter === 'TODOS'} label="Todos" onClick={() => setStatusFilter('TODOS')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'PAGO'} label="Pago" onClick={() => setStatusFilter('PAGO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'EM_ABERTO'} label="Em aberto" onClick={() => setStatusFilter('EM_ABERTO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'ATRASADO'} label="Atrasado" onClick={() => setStatusFilter('ATRASADO')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'AMANHA'} label="Vcto amanha" onClick={() => setStatusFilter('AMANHA')} isDark={isDark} />
                        <FilterPill active={statusFilter === 'HOJE'} label="Vcto hoje" onClick={() => setStatusFilter('HOJE')} isDark={isDark} />
                        
                        <button
                          type="button"
                          onClick={() => void handleExportExcel()}
                          disabled={isExportingExcel}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                            isDark
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                          title="Exportar lançamentos filtrados para Excel (.xlsx)"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>{isExportingExcel ? 'Exportando...' : 'Exportar (.xlsx)'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col min-h-0 relative">
                      <div 
                        className="max-h-[52vh] overflow-auto custom-scrollbar"
                        onScroll={(e) => {
                          const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                          if (scrollHeight - scrollTop <= clientHeight + 200) {
                            setIndicadoresLimit(prev => Math.min(prev + 100, dashboard.tableRows.length));
                          }
                        }}
                      >
                        <table className="w-full min-w-[980px] text-[13px]">
                        <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                          <tr>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data Vcto</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Nome Interessado</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Descrição</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Tipo</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.tableRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className={`px-4 py-12 text-center text-sm font-semibold ${isDark ? 'text-white/45' : 'text-slate-400'}`}>Nenhum lançamento para os filtros atuais.</td>
                            </tr>
                          ) : (
                            <>
                              {dashboard.tableRows.slice(0, indicadoresLimit).map((row) => (
                                <tr key={row.rowKey} className={isDark ? 'border-t border-white/8 bg-black/10 text-white hover:bg-white/4' : 'border-t border-slate-100 bg-white text-slate-800 hover:bg-amber-50/40'}>
                                  <td className="px-4 py-2.5 font-medium">{formatDate(row.dataVencimento)}</td>
                                  <td className="px-4 py-2.5 font-semibold">{row.interessado}</td>
                                  <td className="max-w-85 truncate px-4 py-2.5" title={row.descricao}>
                                    <div className="flex items-center gap-1.5">
                                      <span className="truncate">{row.descricao}</span>
                                      {(row.id <= 0 || row.origem === 'ASAAS') && (
                                        <span className="shrink-0 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-700/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20">
                                          Asaas
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span
                                      title={row.flowType === 'RECEBIMENTO' ? 'Recebimento' : 'Pagamento'}
                                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${row.flowType === 'RECEBIMENTO' ? isDark ? 'border border-blue-400/35 bg-blue-500/20 text-blue-300' : 'border border-blue-200 bg-blue-100 text-blue-700' : isDark ? 'border border-rose-400/35 bg-rose-500/20 text-rose-300' : 'border border-rose-200 bg-rose-100 text-rose-700'}`}
                                    >
                                      {row.flowType === 'RECEBIMENTO' ? 'R' : 'P'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${row.statusKey === 'PAGO' ? isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700' : row.statusKey === 'ATRASADO' ? isDark ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-rose-200 bg-rose-50 text-rose-700' : isDark ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                      {row.statusLabel}
                                    </span>
                                  </td>
                                  <td className={`px-4 py-2.5 text-right font-black whitespace-nowrap ${getValueTone(row.valor, isDark)}`}>{formatCurrency(row.valor)}</td>
                                </tr>
                              ))}
                              {dashboard.tableRows.length > indicadoresLimit && (
                                <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                  <td colSpan={6} className="px-4 py-4 text-center text-xs font-semibold">
                                    Exibindo {indicadoresLimit} de {dashboard.tableRows.length} lançamentos. <br/>
                                    Role a tabela para carregar mais ou clique no botão "Exportar" para baixar todos.
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                        </tbody>
                        <tfoot className="sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                          <tr className={isDark ? 'border-t-2 border-white/20 bg-slate-900/95 backdrop-blur-md text-white' : 'border-t-2 border-slate-300 bg-white/95 backdrop-blur-md text-slate-900'}>
                            <td colSpan={5} className="px-4 py-3 text-right font-black uppercase tracking-[0.14em]">Total geral</td>
                            <td className={`px-4 py-3 text-right font-black whitespace-nowrap ${getValueTone(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0), isDark)}`}>{formatCurrency(dashboard.tableRows.reduce((sum, row) => sum + row.valor, 0))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </section>

                <section className={`rounded-2xl border px-3 py-4 ${tableShellClass}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Situação</div>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('TODOS')}
                      className={`text-[10px] font-black uppercase tracking-[0.14em] ${statusFilter === 'TODOS' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                    >
                      Mostrar tudo
                    </button>
                  </div>
                  <div className="space-y-2.5 max-h-[62vh] overflow-y-auto custom-scrollbar pr-1">
                    {situacaoCards.map((item) => {
                      const active = statusFilter === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setStatusFilter((current) => current === item.key ? 'TODOS' : item.key)}
                          className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? isDark ? 'border-amber-300/50 bg-amber-300/10' : 'border-amber-300 bg-amber-50' : isDark ? 'border-white/10 bg-white/[0.035] hover:bg-white/6' : 'border-slate-200 bg-white/85 hover:bg-slate-50'}`}
                        >
                          <span className={`font-black ${isDark ? 'text-white/85' : 'text-slate-800'}`}>{item.label}</span>
                          <span className={`font-black whitespace-nowrap ${active ? isDark ? 'text-amber-200' : 'text-amber-700' : getValueTone(item.value, isDark)}`}>{formatCurrency(item.value)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </section>


        {contextMenuPos && (
          <div
            className="fixed z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 min-w-[240px]"
            style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setContextMenuPos(null);
                void handleExportExcel();
              }}
              disabled={isExportingExcel}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors text-left"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{isExportingExcel ? 'Gerando Planilha...' : 'Exportar Indicadores em Excel (.xlsx)'}</span>
            </button>
          </div>
        )}
        <BoletimFiltrosSidebar
          showFiltrosSidebar={showFiltrosSidebar}
          setShowFiltrosSidebar={setShowFiltrosSidebar}
          filtrosAvancados={filtrosAvancados}
          setFiltrosAvancados={setFiltrosAvancados}
          resetFiltros={() => {
            setFiltrosAvancados({
              categoriaIds: new Set<number>(),
              contaIds: new Set<number>(),
              interessados: new Set<string>(),
              dataInicio: '',
              dataFim: ''
            });
          }}
          categorias={categorias}
          contas={contas}
          interessadosList={Array.from(new Set(entidades.map(e => e.nome)))}
        />
      </div>
    </div>
  );
}