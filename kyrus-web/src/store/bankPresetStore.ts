import { create } from 'zustand';

import { api } from '../services/api';

export interface BankPreset {
  key: string;
  label: string;
  bank_name: string;
  aliases: string[];
  logo_url?: string | null;
  sort_order: number;
  is_active: boolean;
}

interface BankPresetState {
  presets: BankPreset[];
  loaded: boolean;
  loading: boolean;
  fetchPresets: (force?: boolean) => Promise<BankPreset[]>;
  invalidate: () => void;
  setPresets: (items: BankPreset[]) => void;
}

let presetsPromise: Promise<BankPreset[]> | null = null;

export const useBankPresetStore = create<BankPresetState>((set, get) => ({
  presets: [],
  loaded: false,
  loading: false,

  fetchPresets: async (force = false) => {
    const state = get();
    if (!force && state.loaded) return state.presets;
    if (presetsPromise) return presetsPromise;

    set({ loading: true });
    presetsPromise = api.get<BankPreset[]>('/bank-presets/')
      .then((response) => {
        const data = response.data || [];
        set({ presets: data, loaded: true, loading: false });
        return data;
      })
      .catch((error) => {
        set({ loading: false });
        throw error;
      })
      .finally(() => {
        presetsPromise = null;
      });

    return presetsPromise;
  },

  invalidate: () => set({ loaded: false }),
  setPresets: (items) => set({ presets: items, loaded: true, loading: false }),
}));