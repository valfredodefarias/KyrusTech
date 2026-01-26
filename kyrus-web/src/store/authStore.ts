import { create } from 'zustand';

interface AuthState {
  token: string | null;
  setToken: (token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem('access_token'),

  setToken: (token) => {
    localStorage.setItem('access_token', token);
    set({ token });
  },

  logout: () => {
    localStorage.removeItem('access_token');
    set({ token: null });
  },

  isAuthenticated: () => !!get().token,
}));