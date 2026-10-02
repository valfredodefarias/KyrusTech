import { create } from 'zustand';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from './authStore';

const CACHE_TTL = 30000; // 30 seconds

export interface MovimentacaoPDV {
  id: number;
  id_parcelamento?: string | null;
  tipo: 'ENTRADA' | 'SAIDA';
  descricao: string;
  valor: number;
  forma_pagamento: string;
  bandeira: string;
  parcelas: number;
  data: string;
  centro_custo_id?: number | null;
  conta_id?: number | null;
  conciliado: boolean;
  criador_nome?: string | null;
  criador_email?: string | null;
  data_criacao?: string | null;
  hora_criacao?: string | null;
  created_at?: string | null;
}

interface PdvMovimentacaoState {
  monthCache: Record<string, MovimentacaoPDV[]>;
  cacheTimestamps: Record<string, number>;
  loadingMonths: Record<string, boolean>;
  
  fetchMovimentacoes: (monthStr: string, force?: boolean) => Promise<MovimentacaoPDV[]>;
  fetchWsSyncItems: (event: string, refId: string) => Promise<void>;
  removeMovimentacao: (idOrRefId: string | number) => void;
  invalidate: () => void;
  clearCache: () => void;
}

// In-flight request controllers
const fetchPromises: Record<string, Promise<MovimentacaoPDV[]> | undefined> = {};
const fetchControllers: Record<string, AbortController | undefined> = {};

export const usePdvMovimentacaoStore = create<PdvMovimentacaoState>((set, get) => {
  let lastCompanyId = useAuthStore.getState().empresa?.id ?? useAuthStore.getState().user?.empresa_id;

  useAuthStore.subscribe((state) => {
    const currentCompanyId = state.empresa?.id ?? state.user?.empresa_id;
    if (currentCompanyId !== lastCompanyId) {
      lastCompanyId = currentCompanyId;
      get().clearCache();
    }
  });

  return {
    monthCache: {},
    cacheTimestamps: {},
    loadingMonths: {},

    fetchMovimentacoes: async (monthStr: string, force = false) => {
      const { monthCache, cacheTimestamps } = get();
      const now = Date.now();
      
      // 1. Resolve cache hit if fresh & not forced
      if (!force && monthCache[monthStr] && cacheTimestamps[monthStr] && (now - cacheTimestamps[monthStr] < CACHE_TTL)) {
        return monthCache[monthStr];
      }

      // 2. Return in-flight query if force is false
      if (!force && fetchPromises[monthStr]) {
        return fetchPromises[monthStr];
      }

      // 3. Cancel and clear previous query if force is true
      if (force) {
        if (fetchControllers[monthStr]) {
          fetchControllers[monthStr].abort();
        }
        delete fetchPromises[monthStr];
      }

      const controller = new AbortController();
      fetchControllers[monthStr] = controller;

      set((state) => ({
        loadingMonths: { ...state.loadingMonths, [monthStr]: true }
      }));

      const fetchPromise = api.get('/pdv/movimentacoes', {
        params: monthStr ? { mes: monthStr } : {},
        signal: controller.signal
      })
      .then((res) => {
        const data = normalizeListResponse<MovimentacaoPDV>(res.data);
        set((state) => ({
          monthCache: { ...state.monthCache, [monthStr]: data },
          cacheTimestamps: { ...state.cacheTimestamps, [monthStr]: Date.now() },
          loadingMonths: { ...state.loadingMonths, [monthStr]: false }
        }));
        return data;
      })
      .catch((err) => {
        set((state) => ({
          loadingMonths: { ...state.loadingMonths, [monthStr]: false }
        }));
        throw err;
      })
      .finally(() => {
        delete fetchPromises[monthStr];
      });

      fetchPromises[monthStr] = fetchPromise;
      return fetchPromise;
    },

    fetchWsSyncItems: async (event: string, refId: string) => {
      try {
        const res = await api.get('/pdv/movimentacoes/ws-sync', {
          params: { event, ref_id: refId }
        });
        const newItems = normalizeListResponse<MovimentacaoPDV>(res.data);
        if (newItems.length === 0) return;

        set((state) => {
          const newCache = { ...state.monthCache };
          
          newItems.forEach((newItem) => {
            const itemMonth = (newItem.data || '').substring(0, 7);
            if (!itemMonth || itemMonth.length < 7) return;

            const currentList = newCache[itemMonth] ? [...newCache[itemMonth]] : [];
            const idx = currentList.findIndex((i) => i.id === newItem.id);
            if (idx >= 0) {
              currentList[idx] = newItem;
            } else {
              currentList.unshift(newItem);
            }
            newCache[itemMonth] = currentList.sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.id - a.id);
          });

          return { monthCache: newCache };
        });
      } catch (err) {
        console.error('[pdvMovimentacaoStore] WS sync error:', err);
      }
    },

    removeMovimentacao: (idOrRefId: string | number) => {
      set((state) => {
        const newCache = { ...state.monthCache };
        let changed = false;

        Object.keys(newCache).forEach((monthStr) => {
          const oldLen = newCache[monthStr].length;
          newCache[monthStr] = newCache[monthStr].filter(
            (item) => item.id !== idOrRefId && item.id_parcelamento !== idOrRefId
          );
          if (newCache[monthStr].length !== oldLen) {
            changed = true;
          }
        });

        return changed ? { monthCache: newCache } : state;
      });
    },

    invalidate: () => {
      Object.values(fetchControllers).forEach((ctrl) => ctrl?.abort());
      Object.keys(fetchPromises).forEach((k) => delete fetchPromises[k]);
      set({ cacheTimestamps: {} });
    },

    clearCache: () => {
      Object.values(fetchControllers).forEach((ctrl) => ctrl?.abort());
      Object.keys(fetchPromises).forEach((k) => delete fetchPromises[k]);
      set({
        monthCache: {},
        cacheTimestamps: {},
        loadingMonths: {}
      });
    }
  };
});
