import { create } from 'zustand';
import { api, normalizeListResponse, onApiMutation } from '../services/api';
import { useAuthStore } from './authStore';
import { useTransactionStore } from './transactionStore';

interface LookupState {
  entidades: any[];
  entidadesLookup: any[];
  planoContas: any[];
  contas: any[];
  centrosCusto: any[];
  selectedCentroCustoId: number | 'ALL';
  setSelectedCentroCustoId: (id: number | 'ALL') => void;
  entidadesLoaded: boolean;
  entidadesLookupLoaded: boolean;
  planoLoaded: boolean;
  contasLoaded: boolean;
  centrosLoaded: boolean;
  loadingEntidades: boolean;
  loadingEntidadesLookup: boolean;
  loadingPlano: boolean;
  loadingContas: boolean;
  loadingCentros: boolean;
  fetchEntidades: (force?: boolean) => Promise<any[]>;
  fetchEntidadesLookup: (force?: boolean) => Promise<any[]>;
  fetchPlanoContas: (force?: boolean) => Promise<any[]>;
  fetchContas: (force?: boolean) => Promise<any[]>;
  fetchCentrosCusto: (force?: boolean) => Promise<any[]>;
  setEntidades: (entidades: any[]) => void;
  setEntidadesLookup: (entidades: any[]) => void;
  setPlanoContas: (planoContas: any[]) => void;
  setContas: (contas: any[]) => void;
  setCentrosCusto: (centrosCusto: any[]) => void;
  invalidateEntidades: () => void;
  invalidateEntidadesLookup: () => void;
  invalidatePlanoContas: () => void;
  invalidateContas: () => void;
  invalidateCentrosCusto: () => void;
  adjustAccountBalance: (contaId: number, amount: number) => void;
  clearStore: () => void;
}

let entidadesPromise: Promise<any[]> | null = null;
let entidadesLookupPromise: Promise<any[]> | null = null;
let planoPromise: Promise<any[]> | null = null;
let contasPromise: Promise<any[]> | null = null;
let centrosPromise: Promise<any[]> | null = null;

const lookupControllers: Record<string, AbortController | null> = {
  entidades: null,
  entidadesLookup: null,
  planoContas: null,
  contas: null,
  centrosCusto: null,
};

export const useLookupStore = create<LookupState>((set, get) => {
  // Guard multitenant security: clear lookups completely when company ID changes or user logs out
  let lastLookupCompanyId = useAuthStore.getState().empresa?.id ?? useAuthStore.getState().user?.empresa_id;

  useAuthStore.subscribe((state) => {
    const currentCompanyId = state.empresa?.id ?? state.user?.empresa_id;
    if (currentCompanyId !== lastLookupCompanyId) {
      lastLookupCompanyId = currentCompanyId;
      get().clearStore();
    }
  });

  return {
    selectedCentroCustoId: 'ALL',
    setSelectedCentroCustoId: (id) => set({ selectedCentroCustoId: id }),
    entidades: [],
    entidadesLookup: [],
  planoContas: [],
  contas: [],
  centrosCusto: [],
  entidadesLoaded: false,
  entidadesLookupLoaded: false,
  planoLoaded: false,
  contasLoaded: false,
  centrosLoaded: false,
  loadingEntidades: false,
  loadingEntidadesLookup: false,
  loadingPlano: false,
  loadingContas: false,
  loadingCentros: false,

  fetchEntidades: async (force = false) => {
    const state = get();
    if (!force && state.entidadesLoaded) return state.entidades;
    
    if (force && lookupControllers.entidades) {
      lookupControllers.entidades.abort();
      entidadesPromise = null;
    }
    
    if (entidadesPromise) return entidadesPromise;

    set({ loadingEntidades: true });
    const controller = new AbortController();
    lookupControllers.entidades = controller;

    entidadesPromise = api.get('/entidades/', { signal: controller.signal })
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ entidades: data, entidadesLoaded: true, loadingEntidades: false });
        return data;
      })
      .catch((err) => {
        set({ loadingEntidades: false });
        throw err;
      })
      .finally(() => {
        entidadesPromise = null;
        lookupControllers.entidades = null;
      });

    return entidadesPromise;
  },

  fetchEntidadesLookup: async (force = false) => {
    const state = get();
    if (!force && state.entidadesLookupLoaded) return state.entidadesLookup;

    if (force && lookupControllers.entidadesLookup) {
      lookupControllers.entidadesLookup.abort();
      entidadesLookupPromise = null;
    }

    if (entidadesLookupPromise) return entidadesLookupPromise;

    set({ loadingEntidadesLookup: true });
    const controller = new AbortController();
    lookupControllers.entidadesLookup = controller;

    entidadesLookupPromise = api.get('/entidades/lookup', { signal: controller.signal })
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ entidadesLookup: data, entidadesLookupLoaded: true, loadingEntidadesLookup: false });
        return data;
      })
      .catch((err) => {
        set({ loadingEntidadesLookup: false });
        throw err;
      })
      .finally(() => {
        entidadesLookupPromise = null;
        lookupControllers.entidadesLookup = null;
      });

    return entidadesLookupPromise;
  },

  fetchPlanoContas: async (force = false) => {
    const state = get();
    if (!force && state.planoLoaded) return state.planoContas;

    if (force && lookupControllers.planoContas) {
      lookupControllers.planoContas.abort();
      planoPromise = null;
    }

    if (planoPromise) return planoPromise;

    set({ loadingPlano: true });
    const controller = new AbortController();
    lookupControllers.planoContas = controller;

    planoPromise = api.get('/plano-contas/', { signal: controller.signal })
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ planoContas: data, planoLoaded: true, loadingPlano: false });
        return data;
      })
      .catch((err) => {
        set({ loadingPlano: false });
        throw err;
      })
      .finally(() => {
        planoPromise = null;
        lookupControllers.planoContas = null;
      });

    return planoPromise;
  },

  fetchContas: async (force = false) => {
    const state = get();
    if (!force && state.contasLoaded) return state.contas;

    if (force && lookupControllers.contas) {
      lookupControllers.contas.abort();
      contasPromise = null;
    }

    if (contasPromise) return contasPromise;

    set({ loadingContas: true });
    const controller = new AbortController();
    lookupControllers.contas = controller;

    contasPromise = api.get('/contas/', { signal: controller.signal })
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ contas: data, contasLoaded: true, loadingContas: false });
        return data;
      })
      .catch((err) => {
        set({ loadingContas: false });
        throw err;
      })
      .finally(() => {
        contasPromise = null;
        lookupControllers.contas = null;
      });

    return contasPromise;
  },

  fetchCentrosCusto: async (force = false) => {
    const state = get();
    if (!force && state.centrosLoaded) return state.centrosCusto;

    if (force && lookupControllers.centrosCusto) {
      lookupControllers.centrosCusto.abort();
      centrosPromise = null;
    }

    if (centrosPromise) return centrosPromise;

    set({ loadingCentros: true });
    const controller = new AbortController();
    lookupControllers.centrosCusto = controller;

    centrosPromise = api.get('/centro-custo/', { signal: controller.signal })
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ centrosCusto: data, centrosLoaded: true, loadingCentros: false });
        return data;
      })
      .catch((err) => {
        set({ loadingCentros: false });
        throw err;
      })
      .finally(() => {
        centrosPromise = null;
        lookupControllers.centrosCusto = null;
      });

    return centrosPromise;
  },

  setEntidades: (entidades) => set({ entidades, entidadesLoaded: true }),
  setEntidadesLookup: (entidadesLookup) => set({ entidadesLookup, entidadesLookupLoaded: true }),
  setPlanoContas: (planoContas) => set({ planoContas, planoLoaded: true }),
  setContas: (contas) => set({ contas, contasLoaded: true }),
  setCentrosCusto: (centrosCusto) => set({ centrosCusto, centrosLoaded: true }),

  invalidateEntidades: () => {
    if (lookupControllers.entidades) lookupControllers.entidades.abort();
    entidadesPromise = null;
    set({ entidades: [], entidadesLoaded: false });
  },

  invalidateEntidadesLookup: () => {
    if (lookupControllers.entidadesLookup) lookupControllers.entidadesLookup.abort();
    entidadesLookupPromise = null;
    set({ entidadesLookup: [], entidadesLookupLoaded: false });
  },

  invalidatePlanoContas: () => {
    if (lookupControllers.planoContas) lookupControllers.planoContas.abort();
    planoPromise = null;
    set({ planoContas: [], planoLoaded: false });
  },

  invalidateContas: () => {
    if (lookupControllers.contas) lookupControllers.contas.abort();
    contasPromise = null;
    set({ contas: [], contasLoaded: false });
  },

  invalidateCentrosCusto: () => {
    if (lookupControllers.centrosCusto) lookupControllers.centrosCusto.abort();
    centrosPromise = null;
    set({ centrosCusto: [], centrosLoaded: false });
  },

  adjustAccountBalance: (contaId: number, amount: number) => {
    set((state) => {
      const updatedContas = state.contas.map((c) => {
        if (c.id === contaId) {
          const currentSaldo = Number(c.saldo_atual || 0);
          return { ...c, saldo_atual: currentSaldo + amount };
        }
        return c;
      });
      return { contas: updatedContas };
    });
  },

  clearStore: () => {
    // Abort all active requests
    Object.values(lookupControllers).forEach((ctrl) => ctrl?.abort());
    entidadesPromise = null;
    entidadesLookupPromise = null;
    planoPromise = null;
    contasPromise = null;
    centrosPromise = null;

    set({
      selectedCentroCustoId: 'ALL',
      entidades: [],
      entidadesLookup: [],
      planoContas: [],
      contas: [],
      centrosCusto: [],
      entidadesLoaded: false,
      entidadesLookupLoaded: false,
      planoLoaded: false,
      contasLoaded: false,
      centrosLoaded: false,
      loadingEntidades: false,
      loadingEntidadesLookup: false,
      loadingPlano: false,
      loadingContas: false,
      loadingCentros: false,
    });
  }
  };
});

// Canal de sincronização de lookups entre abas
const syncLookupChannel = typeof window !== 'undefined' ? new BroadcastChannel('kyrus-erp-lookup') : null;
if (syncLookupChannel) {
  syncLookupChannel.onmessage = (event) => {
    const store = useLookupStore.getState();
    const type = event.data;
    if (type === 'invalidate-entidades') {
      store.invalidateEntidades();
      store.invalidateEntidadesLookup();
      useTransactionStore.getState().incrementRefreshCount();
    } else if (type === 'invalidate-plano-contas') {
      store.invalidatePlanoContas();
      useTransactionStore.getState().incrementRefreshCount();
    } else if (type === 'invalidate-contas') {
      store.invalidateContas();
      useTransactionStore.getState().incrementRefreshCount();
    } else if (type === 'invalidate-centro-custo') {
      store.invalidateCentrosCusto();
      useTransactionStore.getState().incrementRefreshCount();
    }
  };
}

// Listen to successful mutations to selectively invalidate lookups and notify transactions view
onApiMutation((url) => {
  const store = useLookupStore.getState();
  let hasChanges = false;
  if (url.includes('/entidades')) {
    store.invalidateEntidades();
    store.invalidateEntidadesLookup();
    syncLookupChannel?.postMessage('invalidate-entidades');
    hasChanges = true;
  }
  if (url.includes('/plano-contas')) {
    store.invalidatePlanoContas();
    syncLookupChannel?.postMessage('invalidate-plano-contas');
    hasChanges = true;
  }
  if (url.includes('/contas')) {
    store.invalidateContas();
    syncLookupChannel?.postMessage('invalidate-contas');
    hasChanges = true;
  }
  if (url.includes('/centro-custo')) {
    store.invalidateCentrosCusto();
    syncLookupChannel?.postMessage('invalidate-centro-custo');
    hasChanges = true;
  }

  // Propagate lookup invalidations to refresh transactions views/dropdowns
  if (hasChanges) {
    useTransactionStore.getState().incrementRefreshCount();
  }
});
