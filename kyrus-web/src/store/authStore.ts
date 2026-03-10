import { create } from 'zustand';

interface AuthState {
  authenticated: boolean;
  initialized: boolean;
  setAuthenticated: (authenticated: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authenticated: false,
  initialized: false,

  setAuthenticated: (authenticated) => set({ authenticated }),

  setInitialized: (initialized) => set({ initialized }),

  logout: () => {
    set({ authenticated: false, initialized: true });
  },

  isAuthenticated: () => get().authenticated,
}));