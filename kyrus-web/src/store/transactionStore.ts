import { create } from 'zustand';
import axios from 'axios';
import { api, normalizeListResponse, onApiMutation } from '../services/api';
import { useAuthStore } from './authStore';
import { useLookupStore } from './lookupStore';

// Time-To-Live (TTL) for caching: 5 minutes (300,000 milliseconds)
const CACHE_TTL = 300000;

export interface LancamentoResumo {
  id: number;
  descricao: string;
  tipo: string;
  status: string;
  origem?: string | null;
  observacao?: string | null;
  id_parcelamento?: string | null;
  data_vencimento: string;
  data_pagamento?: string | null;
  data_competencia?: string | null;
  competencia?: string | null;
  valor_previsto: number;
  valor_pago?: number | null;
  plano_contas_id?: number | null;
  conta_id?: number | null;
  entidade_id?: number | null;
  centro_custo_id?: number | null;
}

export type StatusFilter = 'TODOS' | 'PAGO' | 'EM_ABERTO' | 'ATRASADO' | 'HOJE' | 'AMANHA';
export type FlowFilter = 'ALL' | 'PAGAMENTO' | 'RECEBIMENTO';

export interface NormalizedRow {
  rowKey: string;
  id: number;
  descricao: string;
  flowType: FlowFilter;
  statusKey: StatusFilter;
  statusLabel: string;
  dataVencimento: string;
  monthIndex: number;
  dayOfMonth: number;
  valor: number;
  valorAbsoluto: number;
  interessado: string;
  contaId?: number | null;
  contaNome: string;
  centroCustoId?: number | null;
  origem?: string | null;
  isAtrasada?: boolean;
  bandeira?: string | null;
  tipoPagamento?: string | null;
}

interface IntegracaoBancaria {
  id: number;
  nome: string;
  tipo: string;
  conta_id?: number | null;
  centro_custo_id?: number | null;
}

interface TransactionState {
  yearCache: Record<number, LancamentoResumo[]>;
  asaasCache: Record<number, NormalizedRow[]>;
  cacheTimestamps: Record<string, number>;
  loadingYears: Record<number, boolean>;
  loadingAsaas: Record<number, boolean>;
  refreshCount: number;
  pagedLancamentos: any[];
  pagedCacheKey: string;
  setPagedLancamentos: (key: string, rows: any[]) => void;
  
  fetchYearTransactions: (year: number, force?: boolean) => Promise<LancamentoResumo[]>;
  fetchAsaasRows: (year: number, force?: boolean) => Promise<NormalizedRow[]>;
  invalidate: () => void;
  clearCache: () => void;
  incrementRefreshCount: () => void;
  addTransactionToCache: (transaction: LancamentoResumo) => void;
  updateTransactionInCache: (transaction: LancamentoResumo) => void;
  removeTransactionFromCache: (id: number) => void;
}

// In-flight promise registries for deduplication
const yearPromises: Record<number, Promise<LancamentoResumo[]> | undefined> = {};
const asaasPromises: Record<number, Promise<NormalizedRow[]> | undefined> = {};

// In-flight request controllers for aborting queries
const yearControllers: Record<number, AbortController | undefined> = {};
const asaasControllers: Record<number, AbortController | undefined> = {};

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export const useTransactionStore = create<TransactionState>((set, get) => {
  // Advanced multitenant security guard: reset store completely when company ID changes or user logs out
  let lastCompanyId = useAuthStore.getState().empresa?.id ?? useAuthStore.getState().user?.empresa_id;

  useAuthStore.subscribe((state) => {
    const currentCompanyId = state.empresa?.id ?? state.user?.empresa_id;
    if (currentCompanyId !== lastCompanyId) {
      lastCompanyId = currentCompanyId;
      get().clearCache();
    }
  });

  return {
    yearCache: {},
    asaasCache: {},
    cacheTimestamps: {},
    loadingYears: {},
    loadingAsaas: {},
    refreshCount: 0,
    pagedLancamentos: [],
    pagedCacheKey: '',
    setPagedLancamentos: (key, rows) => set({ pagedCacheKey: key, pagedLancamentos: rows }),

  fetchYearTransactions: async (year: number, force = false) => {
    const { yearCache, cacheTimestamps } = get();
    const cacheKey = `year-${year}`;
    const now = Date.now();

    // 1. Resolve cache hit if fresh & not forced
    if (!force && yearCache[year] && cacheTimestamps[cacheKey] && (now - cacheTimestamps[cacheKey] < CACHE_TTL)) {
      return yearCache[year];
    }

    // 2. Return in-flight query if force is false
    if (!force && yearPromises[year]) {
      return yearPromises[year];
    }

    // 3. Cancel and clear previous query if force is true
    if (force) {
      if (yearControllers[year]) {
        yearControllers[year].abort();
      }
      delete yearPromises[year];
    }

    const controller = new AbortController();
    yearControllers[year] = controller;

    set((state) => ({
      loadingYears: { ...state.loadingYears, [year]: true }
    }));

    const fetchPromise = api.get<LancamentoResumo[]>('/lancamentos/', {
      params: {
        data_inicio: `${year}-01-01`,
        data_fim: `${year}-12-31`,
        minimized: true,
        sem_paginacao: true,
      },
      signal: controller.signal,
    })
      .then((res) => {
        const data = Array.isArray(res.data) ? res.data : [];
        set((state) => ({
          yearCache: { ...state.yearCache, [year]: data },
          cacheTimestamps: { ...state.cacheTimestamps, [cacheKey]: Date.now() },
          loadingYears: { ...state.loadingYears, [year]: false }
        }));
        return data;
      })
      .catch((err) => {
        set((state) => ({
          loadingYears: { ...state.loadingYears, [year]: false }
        }));
        throw err;
      })
      .finally(() => {
        delete yearPromises[year];
      });

    yearPromises[year] = fetchPromise;
    return fetchPromise;
  },

  fetchAsaasRows: async (year: number, force = false) => {
    const { asaasCache, cacheTimestamps } = get();
    const cacheKey = `asaas-${year}`;
    const now = Date.now();

    // 1. Resolve cache hit if fresh & not forced
    if (!force && asaasCache[year] && cacheTimestamps[cacheKey] && (now - cacheTimestamps[cacheKey] < CACHE_TTL)) {
      return asaasCache[year];
    }

    // 2. Return in-flight query if force is false
    if (!force && asaasPromises[year]) {
      return asaasPromises[year];
    }

    // 3. Cancel and clear previous query if force is true
    if (force) {
      if (asaasControllers[year]) {
        asaasControllers[year].abort();
      }
      delete asaasPromises[year];
    }

    const controller = new AbortController();
    asaasControllers[year] = controller;

    set((state) => ({
      loadingAsaas: { ...state.loadingAsaas, [year]: true }
    }));

    const fetchPromise = (async () => {
      try {
        const integracoesRes = await api.get<IntegracaoBancaria[]>('/integracoes-bancarias/', {
          signal: controller.signal
        });
        const activeIntegracoes = normalizeListResponse<IntegracaoBancaria>(integracoesRes.data);
        const asaasIntegracoes = activeIntegracoes.filter(
          (item) => String(item.tipo || '').toUpperCase() === 'ASAAS'
        );

        if (asaasIntegracoes.length === 0) {
          set((state) => ({
            asaasCache: { ...state.asaasCache, [year]: [] },
            cacheTimestamps: { ...state.cacheTimestamps, [cacheKey]: Date.now() },
            loadingAsaas: { ...state.loadingAsaas, [year]: false }
          }));
          return [];
        }

        const cobrancasPromises = asaasIntegracoes.map(async (integracao) => {
          try {
            const response = await api.get<{
              abertas: any[];
              atrasadas: any[];
              recebidas: any[];
            }>(`/integracoes-bancarias/${integracao.id}/asaas/contas-receber`, {
              signal: controller.signal
            });

            const { abertas, atrasadas } = response.data;
            const rows: NormalizedRow[] = [];

            const processCharge = (charge: any, isAtrasada: boolean) => {
              const val = Number(charge.value || 0);
              const dueDateStr = charge.dueDate || '';
              const due = parseDateOnly(dueDateStr);

              const dueMonth = due ? due.getMonth() : -1;
              const dueDay = due ? due.getDate() : -1;

              const asaasDesc = charge.description || '';
              const asaasIdStr = charge.id || '';
              const rowDesc = asaasDesc ? `[Asaas] ${asaasDesc}` : `[Asaas] Cobrança ${asaasIdStr}`;

              let customerInfo = 'Cliente Asaas';
              if (charge.customerName) {
                customerInfo = charge.customerName;
              } else if (charge.customer) {
                if (typeof charge.customer === 'object') {
                  customerInfo = charge.customer.name || charge.customer.company || charge.customer.email || 'Cliente Asaas';
                } else {
                  customerInfo = `Cliente Asaas (${charge.customer})`;
                }
              }

              return {
                rowKey: `asaas-charge-${asaasIdStr}`,
                id: -Number(asaasIdStr.replace(/[^0-9]/g, '')) || -9999,
                descricao: rowDesc,
                flowType: 'RECEBIMENTO' as const,
                statusKey: 'EM_ABERTO' as const,
                statusLabel: 'A vencer',
                dataVencimento: dueDateStr,
                monthIndex: dueMonth,
                dayOfMonth: dueDay,
                valor: val,
                valorAbsoluto: Math.abs(val),
                interessado: customerInfo,
                contaId: integracao.conta_id || null,
                contaNome: integracao.nome || 'Asaas',
                centroCustoId: integracao.centro_custo_id || null,
                origem: 'ASAAS',
                isAtrasada,
              } as NormalizedRow;
            };

            (abertas || []).forEach((c: any) => rows.push(processCharge(c, false)));
            (atrasadas || []).forEach((c: any) => rows.push(processCharge(c, true)));

            return rows;
          } catch (err) {
            if (axios.isCancel(err)) throw err;
            console.error(`Erro ao carregar cobrancas da integracao Asaas ${integracao.id}`, err);
            return [];
          }
        });

        const results = await Promise.all(cobrancasPromises);
        const loadedAsaasRows = results.flat();

        set((state) => ({
          asaasCache: { ...state.asaasCache, [year]: loadedAsaasRows },
          cacheTimestamps: { ...state.cacheTimestamps, [cacheKey]: Date.now() },
          loadingAsaas: { ...state.loadingAsaas, [year]: false }
        }));
        return loadedAsaasRows;
      } catch (err) {
        set((state) => ({
          loadingAsaas: { ...state.loadingAsaas, [year]: false }
        }));
        throw err;
      } finally {
        delete asaasPromises[year];
      }
    })();

    asaasPromises[year] = fetchPromise;
    return fetchPromise;
  },

  invalidate: () => {
    // 1. Abort all active requests
    Object.values(yearControllers).forEach((ctrl) => ctrl?.abort());
    Object.values(asaasControllers).forEach((ctrl) => ctrl?.abort());

    // 2. Clear query promise caches
    Object.keys(yearPromises).forEach((k) => delete yearPromises[Number(k)]);
    Object.keys(asaasPromises).forEach((k) => delete asaasPromises[Number(k)]);

    // 3. Mark all caches as stale by deleting timestamps
    set({
      cacheTimestamps: {},
      pagedCacheKey: '',
    });
  },

  clearCache: () => {
    // 1. Abort all active requests
    Object.values(yearControllers).forEach((ctrl) => ctrl?.abort());
    Object.values(asaasControllers).forEach((ctrl) => ctrl?.abort());

    // 2. Clear promise caches
    Object.keys(yearPromises).forEach((k) => delete yearPromises[Number(k)]);
    Object.keys(asaasPromises).forEach((k) => delete asaasPromises[Number(k)]);

    // 3. Clear entire state (preserving refreshCount)
    set({
      yearCache: {},
      asaasCache: {},
      cacheTimestamps: {},
      loadingYears: {},
      loadingAsaas: {},
      pagedLancamentos: [],
      pagedCacheKey: '',
    });
  },

  incrementRefreshCount: () => set((state) => ({ refreshCount: state.refreshCount + 1 })),

  addTransactionToCache: (transaction) => {
    const date = parseDateOnly(transaction.data_vencimento);
    if (!date) return;
    const year = date.getFullYear();
    set((state) => {
      const yearList = state.yearCache[year] || [];
      if (yearList.some((t) => t.id === transaction.id)) return state;
      const nextList = [...yearList, transaction].sort((a, b) => {
        const da = parseDateOnly(a.data_vencimento)?.getTime() || 0;
        const db = parseDateOnly(b.data_vencimento)?.getTime() || 0;
        return da - db;
      });
      const nextPaged = [...state.pagedLancamentos, transaction].sort((a, b) => {
        const da = parseDateOnly(a.data_vencimento)?.getTime() || 0;
        const db = parseDateOnly(b.data_vencimento)?.getTime() || 0;
        return da - db;
      });
      return {
        yearCache: { ...state.yearCache, [year]: nextList },
        pagedLancamentos: nextPaged,
      };
    });
  },

  updateTransactionInCache: (transaction) => {
    const date = parseDateOnly(transaction.data_vencimento);
    if (!date) return;
    const newYear = date.getFullYear();
    set((state) => {
      const updatedYearCache = { ...state.yearCache };
      // Remove from other years if year changed
      Object.keys(updatedYearCache).forEach((yKey) => {
        const y = Number(yKey);
        if (y !== newYear) {
          updatedYearCache[y] = updatedYearCache[y].filter((t) => t.id !== transaction.id);
        }
      });
      // Add or update in the target year
      const yearList = updatedYearCache[newYear] || [];
      const index = yearList.findIndex((t) => t.id === transaction.id);
      const nextList = [...yearList];
      if (index > -1) {
        nextList[index] = { ...nextList[index], ...transaction };
      } else {
        nextList.push(transaction);
      }
      nextList.sort((a, b) => {
        const da = parseDateOnly(a.data_vencimento)?.getTime() || 0;
        const db = parseDateOnly(b.data_vencimento)?.getTime() || 0;
        return da - db;
      });
      updatedYearCache[newYear] = nextList;

      const nextPaged = state.pagedLancamentos.map((t) =>
        t.id === transaction.id ? { ...t, ...transaction } : t
      ).sort((a, b) => {
        const da = parseDateOnly(a.data_vencimento)?.getTime() || 0;
        const db = parseDateOnly(b.data_vencimento)?.getTime() || 0;
        return da - db;
      });

      return {
        yearCache: updatedYearCache,
        pagedLancamentos: nextPaged,
      };
    });
  },

  removeTransactionFromCache: (id) => {
    set((state) => {
      const updatedYearCache = { ...state.yearCache };
      Object.keys(updatedYearCache).forEach((yKey) => {
        const y = Number(yKey);
        updatedYearCache[y] = updatedYearCache[y].filter((t) => t.id !== id);
      });
      const nextPaged = state.pagedLancamentos.filter((t) => t.id !== id);
      return {
        yearCache: updatedYearCache,
        pagedLancamentos: nextPaged,
      };
    });
  }
  };
});

// Multi-tab synchronization channel
const syncChannel = typeof window !== 'undefined' ? new BroadcastChannel('kyrus-erp-cache') : null;
if (syncChannel) {
  syncChannel.onmessage = (event) => {
    const store = useTransactionStore.getState();
    const data = event.data;
    if (data === 'invalidate') {
      store.invalidate();
      store.incrementRefreshCount();
    } else if (data && typeof data === 'object') {
      if (data.type === 'add' && data.tx) {
        store.addTransactionToCache(data.tx);
        adjustBalanceForTx(data.tx, 'add');
        store.incrementRefreshCount();
      } else if (data.type === 'update' && data.tx) {
        // Revert old balance
        const year = parseDateOnly(data.tx.data_vencimento)?.getFullYear();
        if (year && store.yearCache[year]) {
          const oldTx = store.yearCache[year].find((t) => t.id === data.tx.id);
          if (oldTx) {
            adjustBalanceForTx(oldTx, 'remove');
          }
        }
        store.updateTransactionInCache(data.tx);
        adjustBalanceForTx(data.tx, 'add');
        store.incrementRefreshCount();
      } else if (data.type === 'remove' && data.id) {
        // Revert balance
        let oldTx: LancamentoResumo | undefined;
        for (const year of Object.keys(store.yearCache).map(Number)) {
          oldTx = store.yearCache[year]?.find((t) => t.id === data.id);
          if (oldTx) break;
        }
        if (oldTx) {
          adjustBalanceForTx(oldTx, 'remove');
        }
        store.removeTransactionFromCache(data.id);
        store.incrementRefreshCount();
      }
    }
  };
}

// Window online status listener for auto-sync on reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const store = useTransactionStore.getState();
    store.invalidate();
    store.incrementRefreshCount();
    syncChannel?.postMessage('invalidate');
  });

  // Auto-sync on window focus after 30 seconds of inactivity
  if (typeof document !== 'undefined') {
    let lastBlurTime = Date.now();

    window.addEventListener('blur', () => {
      lastBlurTime = Date.now();
    });

    window.addEventListener('focus', () => {
      const inactiveSeconds = (Date.now() - lastBlurTime) / 1000;
      if (inactiveSeconds > 30) {
        console.log(`[Auto-Sync] Tab focada após ${inactiveSeconds.toFixed(1)}s de inatividade. Atualizando dados...`);
        const store = useTransactionStore.getState();
        store.invalidate();
        store.incrementRefreshCount();
        syncChannel?.postMessage('invalidate');
      }
    });
  }
}

// Coordinated background polling manager (runs every 2 minutes when online)
let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const initTransactionStorePolling = () => {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const store = useTransactionStore.getState();
    const activeYears = Object.keys(store.yearCache).map(Number);
    activeYears.forEach((year) => {
      if (!isNaN(year)) {
        // Trigger background queries silently (force=true)
        void store.fetchYearTransactions(year, true).catch((e) => {
          if (!axios.isCancel(e)) console.error('Silent transaction refresh failed:', e);
        });
        void store.fetchAsaasRows(year, true).catch((e) => {
          if (!axios.isCancel(e)) console.error('Silent Asaas refresh failed:', e);
        });
      }
    });
  }, 120000);
};

// Start background sync polling automatically on module load
initTransactionStorePolling();

// Helper to adjust bank account balances locally in memory
function adjustBalanceForTx(tx: LancamentoResumo, mode: 'add' | 'remove') {
  if (tx.status !== 'PAGO') return;
  const contaId = tx.conta_id;
  if (!contaId) return;

  const value = Number(tx.valor_pago || tx.valor_previsto || 0);
  if (value === 0) return;

  const isReceipt = String(tx.tipo || '').toUpperCase() === 'RECEBIMENTO';
  let amount = 0;
  if (mode === 'add') {
    amount = isReceipt ? value : -value;
  } else {
    amount = isReceipt ? -value : value;
  }

  useLookupStore.getState().adjustAccountBalance(contaId, amount);
}

// Pub/Sub mutation listener: updates/invalidates transaction cache on financial writes
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

onApiMutation((url, response) => {
  const isFinanceMutation =
    url.includes('/lancamentos') ||
    url.includes('/importacao') ||
    url.includes('/pdv') ||
    url.includes('/conciliacao') ||
    url.includes('/contas') ||
    url.includes('/compras') ||
    url.includes('/comissoes');

  if (!isFinanceMutation) return;

  const store = useTransactionStore.getState();

  // Optimistic UI updates for single creation/edit/delete (0ms transitions)
  if (response && response.status >= 200 && response.status < 300) {
    const method = String(response.config?.method || '').toUpperCase();
    const isSinglePost = url.endsWith('/lancamentos/');
    const isSinglePut = /\/lancamentos\/\d+/.test(url);
    const isSingleDelete = /\/lancamentos\/\d+/.test(url) && method === 'DELETE';

    if (isSinglePost && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
      const newTx = response.data as LancamentoResumo;
      store.addTransactionToCache(newTx);
      adjustBalanceForTx(newTx, 'add');
      store.incrementRefreshCount();
      syncChannel?.postMessage({ type: 'add', tx: newTx });
      return;
    }

    if (isSinglePut && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
      const newTx = response.data as LancamentoResumo;
      
      // Revert balance impact of old transaction if it existed in cache
      const year = parseDateOnly(newTx.data_vencimento)?.getFullYear();
      if (year && store.yearCache[year]) {
        const oldTx = store.yearCache[year].find((t) => t.id === newTx.id);
        if (oldTx) {
          adjustBalanceForTx(oldTx, 'remove');
        }
      }

      store.updateTransactionInCache(newTx);
      adjustBalanceForTx(newTx, 'add');
      store.incrementRefreshCount();
      syncChannel?.postMessage({ type: 'update', tx: newTx });
      return;
    }

    if (isSingleDelete) {
      const match = url.match(/\/lancamentos\/(\d+)/);
      if (match) {
        const id = Number(match[1]);
        
        // Revert balance impact of deleted transaction
        let oldTx: LancamentoResumo | undefined;
        for (const year of Object.keys(store.yearCache).map(Number)) {
          oldTx = store.yearCache[year]?.find((t) => t.id === id);
          if (oldTx) break;
        }
        if (oldTx) {
          adjustBalanceForTx(oldTx, 'remove');
        }

        store.removeTransactionFromCache(id);
        store.incrementRefreshCount();
        syncChannel?.postMessage({ type: 'remove', id });
        return;
      }
    }
  }

  // Fallback (DELETE, bulk, or lookup changes) - Debounced 300ms
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    store.invalidate();
    store.incrementRefreshCount();
    syncChannel?.postMessage('invalidate');
  }, 300);
});
