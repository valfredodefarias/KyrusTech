import { create } from 'zustand';

export interface AuthUser {
  id: number;
  email: string;
  nome?: string | null;
  is_consultor: boolean;
  consultor_role?: string;
  empresa_id?: number | null;
  permissions?: string[] | null;
  foto_url?: string | null;
}

interface AuthState {
  authenticated: boolean;
  initialized: boolean;
  user: AuthUser | null;
  sessionExpiresAt: string | null;
  setAuthenticated: (authenticated: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setUser: (user: AuthUser | null) => void;
  setSessionExpiresAt: (sessionExpiresAt: string | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authenticated: false,
  initialized: false,
  user: null,
  sessionExpiresAt: null,

  setAuthenticated: (authenticated) => set({ authenticated }),

  setInitialized: (initialized) => set({ initialized }),

  setUser: (user) => set({ user }),

  setSessionExpiresAt: (sessionExpiresAt) => set({ sessionExpiresAt }),

  logout: () => {
    set({ authenticated: false, initialized: true, user: null, sessionExpiresAt: null });
  },

  isAuthenticated: () => get().authenticated,
}));