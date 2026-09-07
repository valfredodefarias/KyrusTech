import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Building2, Filter, FileSpreadsheet } from 'lucide-react';
import { ComprasFiltrosSidebar } from '../components/ComprasFiltrosSidebar';
import type { ComprasFiltrosAvancados } from '../components/ComprasFiltrosSidebar';
import ExcelJS from 'exceljs';
import { AsyncApexChart } from '../components/AsyncApexChart';
import { LancamentoFormDrawer } from './Lancamentos/components/LancamentoFormDrawer';
import { SearchableSelect } from '../components/SearchableSelect';
import { api, getPublicBaseUrl, toPublicAssetUrl } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLookupStore } from '../store/lookupStore';
import { useKyrusWsListener } from '../hooks/useKyrusWebSocket';
import { useTransactionStore } from '../store/transactionStore';
import type { LancamentoResumo } from '../store/transactionStore';
import { NfeForm } from '../components/NfeForm/NfeForm';

interface CentroCustoResumo {
  id: number;
  nome: string;
  codigo?: string | null;
}

interface HealthResponse {
  server_date?: string;
  server_datetime?: string;
}

type CompraTipoFilter = 'ALL' | 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
type CompraChartMode = 'LINHA_SEPARADA' | 'COLUNA_EMPILHADA';

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

function parseDestinoCompra(value?: string | null): 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.includes('encomenda')) return 'ENCOMENDA';
  if (normalized.includes('estoque')) return 'ESTOQUE';
  if (normalized.includes('demonstracao') || normalized.includes('demonstração')) return 'DEMONSTRACAO';
  return null;
}

function extractDestinoCompraFromObservacao(observacao?: string | null): 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO' | null {
  const match = String(observacao || '').match(/DestinoCompra\s*[:=]?\s*(ENCOMENDA|ESTOQUE|DEMONSTRACAO)/i);
  return parseDestinoCompra(match?.[1] || null);
}

function extractNfeNumeroFromText(text?: string | null) {
  const match = String(text || '').match(/NF-?e\s*[:#]?\s*\(?\s*(\d+)\)?/i);
  return String(match?.[1] || '').trim() || null;
}

function resolveNfeNumeroFromLancamento(item: LancamentoResumo) {
  return (
    extractNfeNumeroFromText(item.descricao)
    || extractNfeNumeroFromText(item.observacao)
    || String(item.id_parcelamento || '').trim().replace(/^NFE-/, '')
    || null
  );
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

const EMPTY_ARRAY: any[] = [];
export function Compras() {
  const [referenceDate, setReferenceDate] = useState(() => getBusinessTodayIso());
  const referenceYear = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackDate = parseDateOnly(getBusinessTodayIso()) || new Date();
    return (parsedReference || fallbackDate).getFullYear();
  }, [referenceDate]);

  const [editingNfeId, setEditingNfeId] = useState<string | null>(null);
  const [isLancamentoDrawerOpen, setIsLancamentoDrawerOpen] = useState(false);
  const [editingLancamentoId, setEditingLancamentoId] = useState<number | null>(null);
  const refreshCount = useTransactionStore((state) => state.refreshCount);

  // --- WEBSOCKETS ---
  useKyrusWsListener('LANCAMENTO_CREATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_UPDATED', () => useTransactionStore.getState().invalidateAndRefresh());
  useKyrusWsListener('LANCAMENTO_DELETED', () => useTransactionStore.getState().invalidateAndRefresh());

  const handleEditLancamento = (idParcelamento: string | null | undefined) => {
    if (idParcelamento) {
      setEditingNfeId(String(idParcelamento).trim());
    }
  };

  const handleEditCapLancamento = (lancamentoId: number | null | undefined) => {
    if (lancamentoId) {
      setEditingLancamentoId(lancamentoId);
      setIsLancamentoDrawerOpen(true);
    }
  };

  const [loading, setLoading] = useState(() => {
    const initialYear = (parseDateOnly(getBusinessTodayIso()) || new Date()).getFullYear();
    const txCache = useTransactionStore.getState().yearCache[initialYear];
    const hasCachedTransactions = !!txCache && txCache.length > 0;
    const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
    return !hasCachedTransactions || !hasCachedLookups;
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const empresa = useAuthStore((state) => state.empresa);

  const isDark = useIsDarkMode();
  const [showFiltrosSidebar, setShowFiltrosSidebar] = useState(false);
  const [filtrosAvancados, setFiltrosAvancados] = useState<ComprasFiltrosAvancados>({
    fornecedores: new Set<string>(),
    status: new Set<string>(),
    tipos: new Set<string>(),
    centroCustoIds: new Set<number>(),
    dataInicio: '',
    dataFim: ''
  });
  const [comprasLimit, setComprasLimit] = useState(100);
  const [capLimit, setCapLimit] = useState(100);
  const contas = useLookupStore((state) => state.contas);
  const categorias = useLookupStore((state) => state.planoContas);
  const entidades = useLookupStore((state) => state.entidadesLookup);
  const centrosCusto = useLookupStore((state) => state.centrosCusto);

  const [comprasResumo, setComprasResumo] = useState<{
    monthly_pedidos: { ENCOMENDA: number[]; ESTOQUE: number[]; DEMONSTRACAO: number[] };
    monthly_cap: { ENCOMENDA: number[]; ESTOQUE: number[]; DEMONSTRACAO: number[] };
    totals_by_tipo: { ENCOMENDA: number; ESTOQUE: number; DEMONSTRACAO: number };
    counts_by_tipo: { ENCOMENDA: number; ESTOQUE: number; DEMONSTRACAO: number };
    pedidos_rows: any[];
    cap_rows: any[];
  } | null>(null);

  const fetchContas = useLookupStore((state) => state.fetchContas);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
  const fetchCentrosCusto = useLookupStore((state) => state.fetchCentrosCusto);

  const [compraTipoFilter, setCompraTipoFilter] = useState<CompraTipoFilter>('ALL');
  const [selectedCompraMonthIndex, setSelectedCompraMonthIndex] = useState<number | null>(null);
  const [compraChartMode, setCompraChartMode] = useState<CompraChartMode>('COLUNA_EMPILHADA');
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
      const hasCachedLookups = useLookupStore.getState().contasLoaded && useLookupStore.getState().planoLoaded;
      const shouldShowLoader = !comprasResumo || !hasCachedLookups;

      if (force) {
        setIsRefreshing(true);
      } else if (shouldShowLoader) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const [resumoRes] = await Promise.all([
          api.get('/compras/resumo', {
            params: {
              ano: referenceYear,
              centro_custo_id: selectedCentroCustoId ?? undefined,
            },
          }),
          fetchContas(force),
          fetchPlanoContas(force),
          fetchEntidadesLookup(force),
          fetchCentrosCusto(force),
        ]);

        if (active && resumoRes?.data) {
          setComprasResumo(resumoRes.data);
          setSelectedCentroCustoId((currentValue: number | null) =>
            resolveCentroCustoId(currentValue, useLookupStore.getState().centrosCusto)
          );
        }
      } catch (err: any) {
        console.error('Erro ao carregar dados de compras:', err);
        if (active) {
          setLoadError('Parte dos dados de compras não pôde ser carregada.');
        }
      } finally {
        if (active) {
          setLoading(false);
          setIsRefreshing(false);
          initialLoadDoneRef.current = true;
        }
      }
    }

    void loadData(false);

    return () => {
      active = false;
    };
  }, [referenceYear, selectedCentroCustoId, refreshCount]);

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number; target: "pedidos" | "cap" } | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenuPos(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, target: "pedidos" | "cap") => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY, target });
  };

  const handleExportPedidos = async () => {
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Pedidos');

      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de Pedidos - ${comprasView.effectiveMonthLabel} / ${referenceYear}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      const headers = ['Data Emissão', 'Número', 'Emitente', 'Tipo', 'Status', 'Valor Pedido (R$)'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      let totalValor = 0;
      const pedidos = comprasView.pedidosRows; // Todos os registros filtrados no período

      pedidos.forEach((row) => {
        const emitente = row.emitente || '-';
        const tipoCompra = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
        const status = tipoCompra === 'DEMONSTRACAO' ? '-' : (row.mappedStatus === 'ENTREGUE' ? 'ENTREGUE' : (row.mappedStatus === 'CANCELADO' ? 'CANCELADO' : 'AGUARDANDO ENTREGA'));
        const valor = tipoCompra === 'DEMONSTRACAO' ? 0 : Math.abs(Number(row.valor_pago || row.valor_previsto || 0));
        totalValor += valor;

        const excelRow = worksheet.addRow([
          formatDate(row.data_competencia || row.data_vencimento),
          row.numeroNfe || '-',
          emitente,
          tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : tipoCompra,
          status,
          valor
        ]);
        excelRow.getCell(6).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      });

      worksheet.addRow([]);
      const totalRow = worksheet.addRow(['', '', '', '', 'Total de Pedidos:', totalValor]);
      totalRow.getCell(5).font = { bold: true };
      totalRow.getCell(6).font = { bold: true };
      totalRow.getCell(6).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

      worksheet.columns = [
        { width: 16 }, { width: 16 }, { width: 38 }, { width: 18 }, { width: 22 }, { width: 22 }
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Pedidos_${comprasView.effectiveMonthLabel}_${referenceYear}.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro na exportação de Pedidos', error);
      alert('Ocorreu um erro ao exportar os pedidos.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportCap = async () => {
    setIsExportingExcel(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('CAP a Pagar');

      worksheet.mergeCells('A1:E1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = `Relatório de CAP a Pagar - ${comprasView.effectiveMonthLabel} / ${referenceYear}`;
      titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.addRow([]);

      const headers = ['Vencimento', 'Número', 'Emitente', 'Status', 'Valor (R$)'];
      const headerRow = worksheet.addRow(headers);
      headerRow.height = 26;

      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF334155' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        cell.alignment = { vertical: 'middle' };
      });

      let totalValor = 0;
      const capRows = comprasView.capRows || []; // Todos os registros filtrados no período
      const entityMap = new Map(entidades.map((e) => [e.id, e.nome_fantasia || e.nome]));

      capRows.forEach((row) => {
        const emitente = row.interessado || row.emitente || row.emitente_nome || resolveLancamentoInteressado(row, entityMap) || '-';
        const tipoCompra = row.tipo_compra || extractDestinoCompraFromObservacao(row.observacao) || 'ESTOQUE';
        const rowValor = Number(row.valor ?? row.valor_previsto ?? row.valor_pago ?? 0);
        const v = tipoCompra === 'DEMONSTRACAO' ? 0 : -Math.abs(rowValor);
        totalValor += v;

        const excelRow = worksheet.addRow([
          formatDate(row.data_vencimento),
          resolveNfeNumeroFromLancamento(row) || '-',
          emitente,
          tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : (row.status || '-'),
          v
        ]);
        excelRow.getCell(5).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      });

      worksheet.addRow([]);
      const totalRow = worksheet.addRow(['', '', '', 'Total CAP a Pagar:', totalValor]);
      totalRow.getCell(4).font = { bold: true };
      totalRow.getCell(5).font = { bold: true };
      totalRow.getCell(5).numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';

      worksheet.columns = [
        { width: 16 }, { width: 16 }, { width: 38 }, { width: 20 }, { width: 22 }
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `CAP_${comprasView.effectiveMonthLabel}_${referenceYear}.xlsx`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro na exportação de CAP', error);
      alert('Ocorreu um erro ao exportar o CAP.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const dashboardMonthLabels = useMemo(() => [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ], []);

  const dashboard = useMemo(() => {
    const parsedReference = parseDateOnly(referenceDate);
    const fallbackToday = parseDateOnly(getBusinessTodayIso()) || new Date();
    const now = parsedReference
      ? new Date(parsedReference.getFullYear(), parsedReference.getMonth(), parsedReference.getDate())
      : fallbackToday;
    
    return {
      now,
      currentYear: now.getFullYear(),
      fallbackMonthIndex: now.getMonth(),
      monthLabels: dashboardMonthLabels,
    };
  }, [referenceDate, dashboardMonthLabels]);

  const lancamentosNfeRows = useMemo(() => {
    if (!comprasResumo?.cap_rows) return [];
    return comprasResumo.cap_rows.map((item) => ({
      item,
      numeroNfe: item.numero_nfe || resolveNfeNumeroFromLancamento(item),
      interessado: item.interessado || item.emitente || item.emitente_nome || '',
      tipoCompraItem: item.tipo_compra || extractDestinoCompraFromObservacao(item.observacao) || 'ESTOQUE',
      mappedStatus: String(item.status || '').toUpperCase()
    }));
  }, [comprasResumo]);

  const filteredLancamentosNfeRows = useMemo(() => {
    return lancamentosNfeRows.filter(({ item, interessado, tipoCompraItem, mappedStatus }) => {
      if (selectedCentroCustoId !== null && Number(item.centro_custo_id) !== selectedCentroCustoId) return false;
      if (filtrosAvancados.centroCustoIds.size > 0 && (!item.centro_custo_id || !filtrosAvancados.centroCustoIds.has(Number(item.centro_custo_id)))) return false;
      if (filtrosAvancados.tipos.size > 0 && !filtrosAvancados.tipos.has(tipoCompraItem)) return false;
      if (filtrosAvancados.status.size > 0 && !filtrosAvancados.status.has(mappedStatus)) return false;
      if (filtrosAvancados.fornecedores.size > 0 && !filtrosAvancados.fornecedores.has(interessado)) return false;
      if (filtrosAvancados.dataInicio && item.data_vencimento < filtrosAvancados.dataInicio) return false;
      if (filtrosAvancados.dataFim && item.data_vencimento > filtrosAvancados.dataFim) return false;
      return true;
    });
  }, [lancamentosNfeRows, selectedCentroCustoId, filtrosAvancados]);

  const basePedidosRows = useMemo(() => {
    if (!comprasResumo?.pedidos_rows) return [];
    return comprasResumo.pedidos_rows.map((item) => ({
      item: {
        id_parcelamento: item.id_parcelamento,
        numero_nfe: item.numero_nfe,
        emitente_nome: item.emitente_nome || item.emitente || item.interessado,
        centro_custo_id: item.centro_custo_id,
        total_parcelas: item.total_parcelas,
        valor_total: item.valor_total,
        data_emissao: item.data_emissao,
        data_vencimento: item.data_vencimento,
        status: item.status,
        observacao: item.observacao,
        tipo_compra: item.tipo_compra || 'ESTOQUE',
      },
      numeroNfe: item.numero_nfe || '',
      interessado: item.emitente_nome || item.emitente || item.interessado || '',
      tipoCompraItem: item.tipo_compra || 'ESTOQUE',
      mappedStatus: String(item.status || '').toUpperCase()
    }));
  }, [comprasResumo]);

  const filteredPedidosRows = useMemo(() => {
    return basePedidosRows.filter(({ item, interessado, tipoCompraItem, mappedStatus }) => {
      if (selectedCentroCustoId !== null && Number(item.centro_custo_id) !== selectedCentroCustoId) return false;
      if (filtrosAvancados.centroCustoIds.size > 0 && (!item.centro_custo_id || !filtrosAvancados.centroCustoIds.has(Number(item.centro_custo_id)))) return false;
      if (filtrosAvancados.tipos.size > 0 && !filtrosAvancados.tipos.has(tipoCompraItem)) return false;
      if (filtrosAvancados.status.size > 0 && !filtrosAvancados.status.has(mappedStatus)) return false;
      if (filtrosAvancados.fornecedores.size > 0 && !filtrosAvancados.fornecedores.has(interessado)) return false;
      // Pedidos are filtered by data_emissao instead of data_vencimento in advanced filters
      const dataFiltro = item.data_emissao || item.data_vencimento;
      if (filtrosAvancados.dataInicio && dataFiltro && dataFiltro < filtrosAvancados.dataInicio) return false;
      if (filtrosAvancados.dataFim && dataFiltro && dataFiltro > filtrosAvancados.dataFim) return false;
      return true;
    });
  }, [basePedidosRows, selectedCentroCustoId, filtrosAvancados]);

  const comprasView = useMemo(() => {
    const fallbackMonth = dashboard.fallbackMonthIndex;
    const effectiveMonth = selectedCompraMonthIndex ?? fallbackMonth;
    const monthLabels = dashboard.monthLabels;

    const nfeRows = filteredLancamentosNfeRows;
    const nfePedidosRows = filteredPedidosRows;

    const purchaseRows = nfePedidosRows
      .map(({ item, numeroNfe, interessado, tipoCompraItem, mappedStatus }) => {
        const monthIndex = parseDateOnly(item.data_emissao || item.data_vencimento)?.getMonth() ?? -1;
        const valor = Math.abs(Number(item.valor_total || 0));
        return {
          id_parcelamento: item.id_parcelamento,
          id: item.id_parcelamento,
          monthIndex,
          tipoCompra: tipoCompraItem,
          valor,
          numeroNfe,
          parcelas: Number(item.total_parcelas || 1),
          emitente: interessado,
          vencimento: item.data_vencimento,
          data_competencia: item.data_emissao,
          data_vencimento: item.data_vencimento,
          status: mappedStatus,
          mappedStatus,
          observacao: item.observacao,
        };
      })
      .filter((row) => row.monthIndex >= 0 && row.tipoCompra !== null && (row.valor > 0 || row.tipoCompra === 'DEMONSTRACAO'));

    const rowsByTipo = purchaseRows.filter((row) => compraTipoFilter === 'ALL' || row.tipoCompra === compraTipoFilter);
    const mutedColor = isDark ? '#cbd5e1' : '#d1d5db';

    const monthlyPedidos = {
      ENCOMENDA: Array.from({ length: 12 }, () => 0),
      ESTOQUE: Array.from({ length: 12 }, () => 0),
      DEMONSTRACAO: Array.from({ length: 12 }, () => 0),
    };

    rowsByTipo.forEach((row) => {
      if (!row.tipoCompra) return;
      const key = row.tipoCompra as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
      monthlyPedidos[key][row.monthIndex] += row.valor;
    });

    const monthlyCap = {
      ENCOMENDA: Array.from({ length: 12 }, () => 0),
      ESTOQUE: Array.from({ length: 12 }, () => 0),
      DEMONSTRACAO: Array.from({ length: 12 }, () => 0),
    };
    filteredLancamentosNfeRows.forEach((row) => {
      const idx = parseDateOnly(row.item.data_vencimento)?.getMonth() ?? -1;
      if (!Number.isFinite(idx) || idx < 0 || idx > 11) return;
      const key = row.tipoCompraItem as 'ENCOMENDA' | 'ESTOQUE' | 'DEMONSTRACAO';
      if (!key) return;
      const valor = Math.abs(Number(row.item.valor ?? row.item.valor_previsto ?? row.item.valor_pago ?? 0));
      if (compraTipoFilter !== 'ALL' && key !== compraTipoFilter) return;
      monthlyCap[key][idx] += valor;
    });

    const totalsByTipo = {
      ENCOMENDA: monthlyPedidos.ENCOMENDA.reduce((a, b) => a + b, 0),
      ESTOQUE: monthlyPedidos.ESTOQUE.reduce((a, b) => a + b, 0),
      DEMONSTRACAO: monthlyPedidos.DEMONSTRACAO.reduce((a, b) => a + b, 0),
    };

    const countsByTipo = {
      ENCOMENDA: purchaseRows.filter((r) => r.tipoCompra === 'ENCOMENDA').length,
      ESTOQUE: purchaseRows.filter((r) => r.tipoCompra === 'ESTOQUE').length,
      DEMONSTRACAO: purchaseRows.filter((r) => r.tipoCompra === 'DEMONSTRACAO').length,
    };

    const donutSeries = [totalsByTipo.ENCOMENDA, totalsByTipo.ESTOQUE, totalsByTipo.DEMONSTRACAO];

    const pedidosSeries = [
      {
        name: 'Encomenda',
        data: monthlyPedidos.ENCOMENDA.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#3b82f6',
        })),
      },
      {
        name: 'Estoque',
        data: monthlyPedidos.ESTOQUE.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#14b8a6',
        })),
      },
      {
        name: 'Demonstração',
        data: monthlyPedidos.DEMONSTRACAO.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#a855f7',
        })),
      },
    ];

    const capTotal = monthlyCap.ENCOMENDA.map((value, monthIndex) => value + (monthlyCap.ESTOQUE[monthIndex] || 0));

    const isCapMixedStacked = compraChartMode === 'COLUNA_EMPILHADA';
    const capSeries = [
      {
        name: 'CAP Encomenda',
        ...(isCapMixedStacked ? { type: 'column' } : {}),
        data: monthlyCap.ENCOMENDA.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#3b82f6',
        })),
      },
      {
        name: 'CAP Estoque',
        ...(isCapMixedStacked ? { type: 'column' } : {}),
        data: monthlyCap.ESTOQUE.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#14b8a6',
        })),
      },
      {
        name: 'Total a pagar',
        ...(isCapMixedStacked ? { type: 'line' } : {}),
        data: capTotal.map((value, monthIndex) => ({
          x: monthLabels[monthIndex],
          y: value,
          fillColor: selectedCompraMonthIndex !== null && selectedCompraMonthIndex !== monthIndex ? mutedColor : '#f2c94c',
        })),
      },
    ];

    const tableRows = rowsByTipo
      .filter((row) => selectedCompraMonthIndex === null || row.monthIndex === selectedCompraMonthIndex)
      .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)) || b.valor - a.valor)
      .slice(0, 80);

    const chartTheme = isDark ? 'dark' : 'light';
    const labelColor = isDark ? '#cbd5e1' : '#475569';
    const gridColor = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.16)';

    const onMonthSelect = (_event: any, _ctx: any, config: any) => {
      const monthIndex = readChartDataPointIndex(config);
      if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return;
      setSelectedCompraMonthIndex((prev) => (prev === monthIndex ? null : monthIndex));
    };

    const isLineMode = compraChartMode === 'LINHA_SEPARADA';
    const isStackedColumnMode = compraChartMode === 'COLUNA_EMPILHADA';

    const mainChartType: 'line' | 'bar' = isLineMode ? 'line' : 'bar';

    const sharedChartOptions: any = {
      chart: {
        type: mainChartType,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: { dataPointSelection: onMonthSelect },
        ...(isLineMode
          ? {}
          : {
            stacked: isStackedColumnMode,
            ...(isStackedColumnMode ? { stackType: 'normal' } : {}),
          }),
      },
      theme: { mode: chartTheme },
      stroke: isLineMode ? { show: true, width: 3, curve: 'smooth' } : { show: false },
      markers: isLineMode ? { size: 4, hover: { size: 6 } } : { size: 0 },
      ...(isLineMode ? {} : { plotOptions: { bar: { horizontal: false, borderRadius: 2, columnWidth: '56%' } } }),
      dataLabels: { enabled: false },
      grid: { borderColor: gridColor, strokeDashArray: 2 },
      xaxis: { categories: monthLabels, labels: { style: { colors: labelColor, fontSize: '10px' } } },
      yaxis: { labels: { style: { colors: labelColor, fontSize: '10px' }, formatter: (value: number) => formatCurrencyCompact(value) } },
      tooltip: { theme: chartTheme, y: { formatter: (value: number) => formatCurrency(value) } },
      legend: { position: 'top', horizontalAlign: 'left', labels: { colors: labelColor }, itemMargin: { horizontal: 8, vertical: 4 } },
      ...(isLineMode ? { fill: { type: 'solid' } } : {}),
    };

    const donutOptions: any = {
      chart: {
        type: 'donut',
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: true, easing: 'easeinout', speed: 320 },
        events: {
          dataPointSelection: (_event: any, _ctx: any, config: any) => {
            const idx = Number(config?.dataPointIndex);
            if (!Number.isFinite(idx) || idx < 0) return;
            const nextFilter: CompraTipoFilter = idx === 0 ? 'ENCOMENDA' : idx === 1 ? 'ESTOQUE' : 'DEMONSTRACAO';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
          legendClick: (_ctx: any, seriesIndex: number) => {
            const nextFilter: CompraTipoFilter = Number(seriesIndex) === 0 ? 'ENCOMENDA' : Number(seriesIndex) === 1 ? 'ESTOQUE' : 'DEMONSTRACAO';
            setCompraTipoFilter((prev) => (prev === nextFilter ? 'ALL' : nextFilter));
          },
        },
      },
      labels: ['Encomenda', 'Estoque', 'Demonstração'],
      colors: [
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ENCOMENDA' ? (isDark ? '#315ea1' : '#9dbcf1') : '#3b82f6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'ESTOQUE' ? (isDark ? '#0f766e' : '#98e0d8') : '#14b8a6',
        compraTipoFilter !== 'ALL' && compraTipoFilter !== 'DEMONSTRACAO' ? (isDark ? '#5b21b6' : '#c084fc') : '#a855f7',
      ],
      dataLabels: { enabled: true, formatter: (value: number) => `${value.toFixed(0)}%` },
      legend: { show: true, position: 'bottom', labels: { colors: labelColor }, itemMargin: { horizontal: 8, vertical: 4 }, onItemClick: { toggleDataSeries: false } },
      plotOptions: { pie: { donut: { size: '62%', labels: { show: false } } } },
      stroke: { width: 2, colors: [isDark ? '#081124' : '#ffffff'] },
      tooltip: { theme: chartTheme, y: { formatter: (value: number) => formatCurrency(value) } },
    };

    const capRows = nfeRows
      .filter(item => {
         if (selectedCompraMonthIndex === null) return true;
         const capMonthIndex = parseDateOnly(item.item.data_vencimento)?.getMonth() ?? -1;
         return capMonthIndex === selectedCompraMonthIndex;
      })
      .map(i => i.item)
      .sort((a, b) => (a.data_vencimento || '').localeCompare(b.data_vencimento || ''));

    const pedidosRows = nfePedidosRows
      .filter(({ item, tipoCompraItem }) => {
         if (compraTipoFilter !== 'ALL' && tipoCompraItem !== compraTipoFilter) return false;
         if (selectedCompraMonthIndex === null) return true;
         const monthIndex = parseDateOnly(item.data_emissao || item.data_vencimento)?.getMonth() ?? -1;
         return monthIndex === selectedCompraMonthIndex;
      })
      .map(({ item, numeroNfe, interessado, mappedStatus }) => {
         return {
            id_parcelamento: item.id_parcelamento,
            id: item.id_parcelamento,
            numeroNfe,
            data_competencia: item.data_emissao,
            data_vencimento: item.data_vencimento,
            centro_custo_id: item.centro_custo_id,
            valor_previsto: item.valor_total,
            valor_pago: 0, // Not applicable directly to the top level NFE
            observacao: item.observacao,
            status: item.status,
            mappedStatus,
            emitente: interessado,
            origem: 'NFE_XML'
         };
      })
      .sort((a, b) => (a.data_competencia || '').localeCompare(b.data_competencia || ''));

    return {
      capRows,
      pedidosRows,
      effectiveMonth,
      effectiveMonthLabel: selectedCompraMonthIndex !== null ? monthLabels[selectedCompraMonthIndex] : 'Ano Todo',
      totalsByTipo,
      donutSeries,
      donutOptions,
      mainChartType,
      pedidosSeries,
      pedidosOptions: { ...sharedChartOptions },
      capSeries,
      capChartType: isCapMixedStacked ? 'line' : mainChartType,
      capOptions: {
        ...sharedChartOptions,
        ...(isCapMixedStacked
          ? {
            chart: {
              ...sharedChartOptions.chart,
              type: 'line',
              stacked: true,
              stackType: 'normal',
            },
            stroke: { width: [0, 0, 0, 3], curve: 'smooth' },
            markers: { size: [0, 0, 0, 4], hover: { size: 6 } },
          }
          : {}),
        legend: { ...sharedChartOptions.legend, show: true },
      },
      countsByTipo,
    };
  }, [compraChartMode, compraTipoFilter, dashboard.fallbackMonthIndex, dashboard.monthLabels, isDark, filteredLancamentosNfeRows, filteredPedidosRows, selectedCompraMonthIndex]);

  // Consistência removida para não poluir console



  useEffect(() => {
    setComprasLimit(100);
    setCapLimit(100);
  }, [comprasView.pedidosRows, comprasView.capRows]);

  const companyLogo = getFullLogoUrl(empresa?.logo_url || null);
  const companyName = empresa?.nome_fantasia || 'Sua Empresa';

  const fornecedoresList = useMemo(() => {
    if (!comprasResumo) return [];
    const setFornecedores = new Set<string>();
    comprasResumo.cap_rows?.forEach((item) => {
      if (item.interessado) setFornecedores.add(item.interessado);
    });
    comprasResumo.pedidos_rows?.forEach((item) => {
      if (item.emitente_nome) setFornecedores.add(item.emitente_nome);
    });
    return Array.from(setFornecedores).sort();
  }, [comprasResumo]);

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
  const auditPanelShellClass = isDark ? 'border-white/12 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-900';

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
                  onChange={(val: string | number) => {
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

        </header>

        {loadError ? (
          <div className={`rounded-lg border px-5 py-4 text-sm font-semibold ${isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            {loadError}
          </div>
        ) : null}



        
          <section className="space-y-3">
            <div className="grid gap-3 xl:grid-cols-4 xl:items-stretch">
              <section className={`rounded-2xl border px-3 py-3 xl:col-span-1 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Tipo de compra</div>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter('ALL')}
                    className={`text-[10px] font-black uppercase tracking-[0.14em] ${compraTipoFilter === 'ALL' ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    Limpar
                  </button>
                </div>
                <AsyncApexChart type="donut" height={220} series={comprasView.donutSeries} options={comprasView.donutOptions} />
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'ENCOMENDA' ? 'ALL' : 'ENCOMENDA'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'ENCOMENDA' ? isDark ? 'border-blue-300/55 bg-blue-300/12' : 'border-blue-300 bg-blue-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total encomenda</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-blue-300' : 'text-blue-600'}`}>{formatCurrency(comprasView.totalsByTipo.ENCOMENDA)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'ESTOQUE' ? 'ALL' : 'ESTOQUE'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'ESTOQUE' ? isDark ? 'border-teal-300/55 bg-teal-300/12' : 'border-teal-300 bg-teal-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total estoque</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-teal-300' : 'text-teal-600'}`}>{formatCurrency(comprasView.totalsByTipo.ESTOQUE)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompraTipoFilter((prev) => (prev === 'DEMONSTRACAO' ? 'ALL' : 'DEMONSTRACAO'))}
                    className={`rounded-xl border px-3 py-2 text-left transition ${compraTipoFilter === 'DEMONSTRACAO' ? isDark ? 'border-purple-300/55 bg-purple-300/12' : 'border-purple-300 bg-purple-50' : isDark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-slate-50'}`}
                  >
                    <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Total demonstração</div>
                    <div className={`mt-1 text-lg font-black ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                      {formatCurrency(comprasView.totalsByTipo.DEMONSTRACAO)}
                      <span className="text-xs font-normal ml-1.5 opacity-70">({comprasView.countsByTipo.DEMONSTRACAO} nota(s))</span>
                    </div>
                  </button>
                </div>
              </section>

              <section className={`rounded-2xl border px-3 py-3 xl:col-span-3 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>QTDE vs VALOR DE PEDIDOS POR MÊS</div>
                  <button
                    type="button"
                    onClick={() => setSelectedCompraMonthIndex(null)}
                    className={`text-[10px] font-black uppercase tracking-[0.14em] ${selectedCompraMonthIndex === null ? isDark ? 'text-amber-200' : 'text-amber-700' : isDark ? 'text-white/45 hover:text-white/75' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    Limpar mês
                  </button>
                </div>
                <AsyncApexChart type={comprasView.mainChartType} height={380} series={comprasView.pedidosSeries} options={comprasView.pedidosOptions} />
              </section>
              <section className={`rounded-2xl border px-3 py-3 xl:col-span-4 ${tableShellClass}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>CAP por mês do faturamento dos pedidos</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/55' : 'text-slate-500'}`}>{comprasView.effectiveMonthLabel}</div>
                </div>
                <AsyncApexChart type={comprasView.capChartType || comprasView.mainChartType} height={255} series={comprasView.capSeries} options={comprasView.capOptions} />
              </section>
            </div>

            <div className={`rounded-2xl border px-3 py-2 ${tableShellClass}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Modo do gráfico</span>
                <button
                  type="button"
                  onClick={() => setCompraChartMode('LINHA_SEPARADA')}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${compraChartMode === 'LINHA_SEPARADA' ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Linha separada
                </button>
                <button
                  type="button"
                  onClick={() => setCompraChartMode('COLUNA_EMPILHADA')}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${compraChartMode === 'COLUNA_EMPILHADA' ? isDark ? 'bg-amber-300 text-slate-950' : 'bg-slate-950 text-white' : isDark ? 'border border-white/12 bg-white/5 text-white/75 hover:bg-white/10' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  Coluna empilhada
                </button>
              </div>
            </div>

                          <div className="flex flex-col gap-4">
              <section onContextMenu={(e) => handleContextMenu(e, "pedidos")} className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>Pedidos feitos no período</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/45' : 'text-slate-400'}`}>{comprasView.pedidosRows.length} item(ns)</div>
                </div>
                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div 
                    onContextMenu={(e) => handleContextMenu(e, "pedidos")}
                    className="min-h-[30vh] max-h-[52vh] overflow-auto custom-scrollbar"
                    onScroll={(e) => {
                      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                      if (scrollHeight - scrollTop <= clientHeight + 200) {
                        setComprasLimit(prev => Math.min(prev + 100, comprasView.pedidosRows.length));
                      }
                    }}
                  >
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                        <tr>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Data emissão</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Número</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Emitente</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Tipo</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor pedido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comprasView.pedidosRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-sm font-semibold">Nenhum pedido para os filtros atuais.</td>
                          </tr>
                        ) : (
                          <>
                            {comprasView.pedidosRows.slice(0, comprasLimit).map((row, index) => {
                              const emitente = row.emitente;
                              const valor = Math.abs(Number(row.valor_pago || row.valor_previsto || 0));
                              const tipoCompra = extractDestinoCompraFromObservacao(row.observacao) || 'DEMONSTRACAO';
                              
                              return (
                              <tr key={`pedido-row-${row.id || index}`} onClick={() => handleEditLancamento(row.id_parcelamento)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">
                                <td className="px-4 py-2.5 font-medium">{formatDate(row.data_competencia || row.data_vencimento)}</td>
                                <td className="px-4 py-2.5 font-medium">{row.numeroNfe || '-'}</td>
                                <td className="px-4 py-2.5 font-semibold">{emitente || '-'}</td>
                                <td className="px-4 py-2.5">
                                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                    {tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : tipoCompra}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                    {tipoCompra === 'DEMONSTRACAO' ? '-' : (row.mappedStatus === 'ENTREGUE' ? 'ENTREGUE' : (row.mappedStatus === 'CANCELADO' ? 'CANCELADO' : 'AGUARDANDO ENTREGA'))}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-black whitespace-nowrap">{formatCurrency(tipoCompra === 'DEMONSTRACAO' ? 0 : valor)}</td>
                              </tr>
                              );
                            })}
                            {comprasView.pedidosRows.length > comprasLimit && (
                              <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                <td colSpan={6} className="px-4 py-4 text-center text-xs font-semibold">
                                  Exibindo {comprasLimit} de {comprasView.pedidosRows.length} pedidos. <br/>
                                  Role a tabela para carregar mais...
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                      <tfoot className={isDark ? 'sticky bottom-0 z-10 bg-slate-800 text-slate-300 border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]' : 'sticky bottom-0 z-10 bg-slate-100 text-slate-800 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]'}>
                        <tr>
                          <td colSpan={5} className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Total de Pedidos</td>
                          <td className="px-4 py-3 text-right text-sm font-black">
                            {formatCurrency(comprasView.pedidosRows.reduce((acc, row) => acc + (extractDestinoCompraFromObservacao(row.observacao) === 'DEMONSTRACAO' ? 0 : Math.abs(Number(row.valor_pago || row.valor_previsto || 0))), 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </section>

              <section onContextMenu={(e) => handleContextMenu(e, "cap")} className={`rounded-2xl border px-4 py-4 ${tableShellClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className={`text-sm font-black uppercase tracking-[0.18em] ${isDark ? 'text-amber-200' : 'text-amber-700'}`}>CAP a pagar no período</div>
                  <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${isDark ? 'text-white/45' : 'text-slate-400'}`}>{comprasView.capRows?.length || 0} item(ns)</div>
                </div>
                <div className={`overflow-hidden rounded-2xl border ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
                  <div 
                    onContextMenu={(e) => handleContextMenu(e, "cap")}
                    className="min-h-[30vh] max-h-[52vh] overflow-auto custom-scrollbar"
                    onScroll={(e) => {
                      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
                      if (scrollHeight - scrollTop <= clientHeight + 200) {
                        setCapLimit(prev => Math.min(prev + 100, comprasView.capRows?.length || 0));
                      }
                    }}
                  >
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className={isDark ? 'sticky top-0 z-10 bg-[#f2c94c] text-slate-950' : 'sticky top-0 z-10 bg-amber-300 text-slate-950'}>
                        <tr>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Vencimento</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Número</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Emitente</th>
                          <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.14em]">Status</th>
                          <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-[0.14em]">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!comprasView.capRows || comprasView.capRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-sm font-semibold">Nenhum CAP para os filtros atuais.</td>
                          </tr>
                        ) : (
                          <>
                            {comprasView.capRows.slice(0, capLimit).map((row, index) => {
                              const emitente = row.interessado || row.emitente || row.emitente_nome || resolveLancamentoInteressado(row, new Map(entidades.map(e => [e.id, e.nome_fantasia || e.nome])));
                              const tipoCompra = row.tipo_compra || extractDestinoCompraFromObservacao(row.observacao) || 'ESTOQUE';
                              const rowValor = Number(row.valor ?? row.valor_previsto ?? row.valor_pago ?? 0);
                              const valorDisplay = tipoCompra === 'DEMONSTRACAO' ? 0 : -Math.abs(rowValor);
                              return (
                                <tr key={`cap-row-${row.id || index}`} onClick={() => handleEditCapLancamento(row.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">
                                  <td className="px-4 py-2.5 font-medium">{formatDate(row.data_vencimento)}</td>
                                  <td className="px-4 py-2.5 font-medium">{row.numero_nfe || resolveNfeNumeroFromLancamento(row) || '-'}</td>
                                  <td className="px-4 py-2.5 font-semibold">{emitente || '-'}</td>
                                  <td className="px-4 py-2.5">
                                    <span className="inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em]">
                                      {tipoCompra === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO' : (row.status || '-')}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right font-black whitespace-nowrap">
                                    {formatCurrency(valorDisplay)}
                                  </td>
                                </tr>
                              );
                            })}
                            {comprasView.capRows.length > capLimit && (
                              <tr className={isDark ? 'border-t border-white/8 bg-slate-800 text-slate-300' : 'border-t border-slate-100 bg-amber-50 text-amber-800'}>
                                <td colSpan={5} className="px-4 py-4 text-center text-xs font-semibold">
                                  Exibindo {capLimit} de {comprasView.capRows.length} CAPs. <br/>
                                  Role a tabela para carregar mais...
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                      <tfoot className={isDark ? 'sticky bottom-0 z-10 bg-slate-800 text-slate-300 border-t border-white/10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]' : 'sticky bottom-0 z-10 bg-slate-100 text-slate-800 border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]'}>
                        <tr>
                          <td colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase tracking-wider">Total CAP a Pagar</td>
                          <td className="px-4 py-3 text-right text-sm font-black">
                            {formatCurrency((comprasView.capRows || []).reduce((acc, row) => {
                              const tc = row.tipo_compra || extractDestinoCompraFromObservacao(row.observacao) || 'ESTOQUE';
                              const rowValor = Number(row.valor ?? row.valor_previsto ?? row.valor_pago ?? 0);
                              return acc + (tc === 'DEMONSTRACAO' ? 0 : -Math.abs(rowValor));
                            }, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </section>
              </div>
          </section>
          {contextMenuPos && (contextMenuPos.target === 'pedidos' || contextMenuPos.target === 'cap') && (
          <div
            className="fixed z-[9999] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 min-w-[250px]"
            style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const target = contextMenuPos.target;
                setContextMenuPos(null);
                if (target === 'pedidos') {
                    void handleExportPedidos();
                } else if (target === 'cap') {
                    void handleExportCap();
                }
              }}
              disabled={isExportingExcel}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg transition-colors text-left cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{isExportingExcel ? 'Gerando Planilha...' : (contextMenuPos.target === 'pedidos' ? 'Exportar Pedidos em Excel (.xlsx)' : 'Exportar CAP a Pagar em Excel (.xlsx)')}</span>
            </button>
          </div>
        )}
        {editingNfeId && (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 lg:p-8 animate-in fade-in-0 duration-200">
            <div className="h-full w-full max-w-6xl overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-900 shadow-2xl flex flex-col border border-slate-200 dark:border-slate-700 animate-in slide-in-from-right duration-300">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0a0d14] px-6 py-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Edição de NF-e / Pedido</h3>
                <button
                  type="button"
                  onClick={() => setEditingNfeId(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <NfeForm 
                  nfeId={editingNfeId} 
                  onClose={() => setEditingNfeId(null)} 
                  onSuccess={() => {
                    setEditingNfeId(null);
                    useTransactionStore.getState().invalidateAndRefresh();
                  }} 
                />
              </div>
            </div>
          </div>
        )}

        <LancamentoFormDrawer
          showDrawer={isLancamentoDrawerOpen}
          editarId={editingLancamentoId}
          onClose={() => {
            setIsLancamentoDrawerOpen(false);
            setEditingLancamentoId(null);
          }}
          onSaveSuccess={async () => {
            setIsLancamentoDrawerOpen(false);
            setEditingLancamentoId(null);
            useTransactionStore.getState().incrementRefreshCount();
          }}
          categorias={categorias}
          entidades={entidades}
          contas={contas}
          centros={centrosCusto}
        />

        <ComprasFiltrosSidebar
          showFiltrosSidebar={showFiltrosSidebar}
          setShowFiltrosSidebar={setShowFiltrosSidebar}
          filtrosAvancados={filtrosAvancados}
          setFiltrosAvancados={setFiltrosAvancados}
          resetFiltros={() => {
            setFiltrosAvancados({
              fornecedores: new Set<string>(),
              status: new Set<string>(),
              tipos: new Set<string>(),
              centroCustoIds: new Set<number>(),
              dataInicio: '',
              dataFim: ''
            });
          }}
          fornecedoresList={fornecedoresList}
          centrosCusto={centrosCusto.map((c) => ({ id: c.id, nome: `${c.codigo ? `${c.codigo} - ` : ''}${c.nome}` }))}
        />
      </div>
    </div>
  );
}


