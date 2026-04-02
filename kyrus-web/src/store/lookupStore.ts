import { create } from 'zustand';
import { api, normalizeListResponse } from '../services/api';

interface LookupState {
  entidades: any[];
  entidadesLookup: any[];
  planoContas: any[];
  entidadesLoaded: boolean;
  entidadesLookupLoaded: boolean;
  planoLoaded: boolean;
  loadingEntidades: boolean;
  loadingEntidadesLookup: boolean;
  loadingPlano: boolean;
  fetchEntidades: (force?: boolean) => Promise<any[]>;
  fetchEntidadesLookup: (force?: boolean) => Promise<any[]>;
  fetchPlanoContas: (force?: boolean) => Promise<any[]>;
  setEntidades: (entidades: any[]) => void;
  setEntidadesLookup: (entidades: any[]) => void;
  setPlanoContas: (planoContas: any[]) => void;
  invalidateEntidades: () => void;
  invalidateEntidadesLookup: () => void;
  invalidatePlanoContas: () => void;
}

let entidadesPromise: Promise<any[]> | null = null;
let entidadesLookupPromise: Promise<any[]> | null = null;
let planoPromise: Promise<any[]> | null = null;

export const useLookupStore = create<LookupState>((set, get) => ({
  entidades: [],
  entidadesLookup: [],
  planoContas: [],
  entidadesLoaded: false,
  entidadesLookupLoaded: false,
  planoLoaded: false,
  loadingEntidades: false,
  loadingEntidadesLookup: false,
  loadingPlano: false,

  fetchEntidades: async (force = false) => {
    const state = get();
    if (!force && state.entidadesLoaded) return state.entidades;
    if (entidadesPromise) return entidadesPromise;

    set({ loadingEntidades: true });
    entidadesPromise = api.get('/entidades/')
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ entidades: data, entidadesLoaded: true, loadingEntidades: false });
        return data;
      })
      .catch((err) => {
        set({ loadingEntidades: false });
        throw err;
      })
      .finally(() => { entidadesPromise = null; });

    return entidadesPromise;
  },

  fetchEntidadesLookup: async (force = false) => {
    const state = get();
    if (!force && state.entidadesLookupLoaded) return state.entidadesLookup;
    if (entidadesLookupPromise) return entidadesLookupPromise;

    set({ loadingEntidadesLookup: true });
    entidadesLookupPromise = api.get('/entidades/lookup')
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ entidadesLookup: data, entidadesLookupLoaded: true, loadingEntidadesLookup: false });
        return data;
      })
      .catch((err) => {
        set({ loadingEntidadesLookup: false });
        throw err;
      })
      .finally(() => { entidadesLookupPromise = null; });

    return entidadesLookupPromise;
  },

  fetchPlanoContas: async (force = false) => {
    const state = get();
    if (!force && state.planoLoaded) return state.planoContas;
    if (planoPromise) return planoPromise;

    set({ loadingPlano: true });
    planoPromise = api.get('/plano-contas/')
      .then((res) => {
        const data = normalizeListResponse<any>(res.data);
        set({ planoContas: data, planoLoaded: true, loadingPlano: false });
        return data;
      })
      .catch((err) => {
        set({ loadingPlano: false });
        throw err;
      })
      .finally(() => { planoPromise = null; });

    return planoPromise;
  },

  setEntidades: (entidades) => set({ entidades, entidadesLoaded: true }),
  setEntidadesLookup: (entidades) => set({ entidadesLookup: entidades, entidadesLookupLoaded: true }),
  setPlanoContas: (planoContas) => set({ planoContas, planoLoaded: true }),
  invalidateEntidades: () => set({ entidadesLoaded: false }),
  invalidateEntidadesLookup: () => set({ entidadesLookupLoaded: false }),
  invalidatePlanoContas: () => set({ planoLoaded: false }),
}));
