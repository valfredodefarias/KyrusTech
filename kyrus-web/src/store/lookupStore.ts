import { create } from 'zustand';
import { api } from '../services/api';

interface LookupState {
  entidades: any[];
  planoContas: any[];
  entidadesLoaded: boolean;
  planoLoaded: boolean;
  loadingEntidades: boolean;
  loadingPlano: boolean;
  fetchEntidades: (force?: boolean) => Promise<any[]>;
  fetchPlanoContas: (force?: boolean) => Promise<any[]>;
  setEntidades: (entidades: any[]) => void;
  setPlanoContas: (planoContas: any[]) => void;
  invalidateEntidades: () => void;
  invalidatePlanoContas: () => void;
}

let entidadesPromise: Promise<any[]> | null = null;
let planoPromise: Promise<any[]> | null = null;

export const useLookupStore = create<LookupState>((set, get) => ({
  entidades: [],
  planoContas: [],
  entidadesLoaded: false,
  planoLoaded: false,
  loadingEntidades: false,
  loadingPlano: false,

  fetchEntidades: async (force = false) => {
    const state = get();
    if (!force && state.entidadesLoaded) return state.entidades;
    if (entidadesPromise) return entidadesPromise;

    set({ loadingEntidades: true });
    entidadesPromise = api.get('/entidades/')
      .then((res) => {
        const data = res.data || [];
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

  fetchPlanoContas: async (force = false) => {
    const state = get();
    if (!force && state.planoLoaded) return state.planoContas;
    if (planoPromise) return planoPromise;

    set({ loadingPlano: true });
    planoPromise = api.get('/plano-contas/')
      .then((res) => {
        const data = res.data || [];
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
  setPlanoContas: (planoContas) => set({ planoContas, planoLoaded: true }),
  invalidateEntidades: () => set({ entidadesLoaded: false }),
  invalidatePlanoContas: () => set({ planoLoaded: false }),
}));
