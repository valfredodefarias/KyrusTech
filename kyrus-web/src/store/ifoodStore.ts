import { create } from 'zustand';
import { api, normalizeListResponse } from '../services/api';
import { useAuthStore } from './authStore';

const CACHE_TTL = 30000; // 30 seconds

export interface iFoodTransaction {
  id: number;
  forma_recebimento: string;
  valor_bruto: number;
  valor_liquido: number;
  data_venda: string;
  hora_venda: string;
  data_recebimento_ajustada: string;
  despesas_extras: string[];
  status_conciliado: boolean;
}

interface IfoodState {
  transactions: iFoodTransaction[];
  cacheTimestamp: number;
  loading: boolean;
  
  fetchTransactions: (force?: boolean) => Promise<iFoodTransaction[]>;
  invalidate: () => void;
  clearCache: () => void;
}

let fetchPromise: Promise<iFoodTransaction[]> | undefined;
let fetchController: AbortController | undefined;

export const useIfoodStore = create<IfoodState>((set, get) => {
  let lastCompanyId = useAuthStore.getState().empresa?.id ?? useAuthStore.getState().user?.empresa_id;

  useAuthStore.subscribe((state) => {
    const currentCompanyId = state.empresa?.id ?? state.user?.empresa_id;
    if (currentCompanyId !== lastCompanyId) {
      lastCompanyId = currentCompanyId;
      get().clearCache();
    }
  });

  return {
    transactions: [],
    cacheTimestamp: 0,
    loading: false,

    fetchTransactions: async (force = false) => {
      const { transactions, cacheTimestamp } = get();
      const now = Date.now();
      
      if (!force && transactions.length > 0 && cacheTimestamp && (now - cacheTimestamp < CACHE_TTL)) {
        return transactions;
      }

      if (!force && fetchPromise) {
        return fetchPromise;
      }

      if (force) {
        if (fetchController) {
          fetchController.abort();
        }
        fetchPromise = undefined;
      }

      const controller = new AbortController();
      fetchController = controller;

      set({ loading: true });

      const promise = api.get('/pdv/ifood/transacoes', { signal: controller.signal })
        .then((res) => {
          const data = normalizeListResponse<iFoodTransaction>(res.data);
          set({
            transactions: data,
            cacheTimestamp: Date.now(),
            loading: false
          });
          return data;
        })
        .catch((err) => {
          set({ loading: false });
          throw err;
        })
        .finally(() => {
          fetchPromise = undefined;
        });

      fetchPromise = promise;
      return promise;
    },

    invalidate: () => {
      if (fetchController) fetchController.abort();
      fetchPromise = undefined;
      set({ cacheTimestamp: 0 });
    },

    clearCache: () => {
      if (fetchController) fetchController.abort();
      fetchPromise = undefined;
      set({
        transactions: [],
        cacheTimestamp: 0,
        loading: false
      });
    }
  };
});
