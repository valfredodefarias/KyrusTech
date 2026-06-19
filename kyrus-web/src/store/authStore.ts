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
  otherDeviceConnected: boolean;
  setAuthenticated: (authenticated: boolean) => void;
  setInitialized: (initialized: boolean) => void;
  setUser: (user: AuthUser | null) => void;
  setSessionExpiresAt: (sessionExpiresAt: string | null) => void;
  setOtherDeviceConnected: (val: boolean) => void;
  logout: (keepOtherDeviceFlag?: boolean) => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  authenticated: false,
  initialized: false,
  user: null,
  sessionExpiresAt: null,
  otherDeviceConnected: false,

  setAuthenticated: (authenticated) => set({ authenticated }),

  setInitialized: (initialized) => set({ initialized }),

  setUser: (user) => set({ user }),

  setSessionExpiresAt: (sessionExpiresAt) => set({ sessionExpiresAt }),

  setOtherDeviceConnected: (otherDeviceConnected) => set({ otherDeviceConnected }),

  logout: (keepOtherDeviceFlag) => {
    set({ 
      authenticated: false, 
      initialized: true, 
      user: null, 
      sessionExpiresAt: null,
      otherDeviceConnected: keepOtherDeviceFlag ? get().otherDeviceConnected : false
    });
  },

  isAuthenticated: () => get().authenticated,
}));