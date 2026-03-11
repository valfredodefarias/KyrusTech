import axios from 'axios';
import { useAuthStore } from '../store/authStore';

function resolveConfiguredApiUrl() {
  const configured = String(import.meta.env.VITE_API_URL || '').trim();

  if (!configured) {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:8000/api/v1';
      }
      return '/api/v1';
    }
    return 'http://localhost:8000/api/v1';
  }

  if (typeof window === 'undefined') {
    return configured;
  }

  try {
    const parsed = new URL(configured, window.location.origin);
    if (window.location.protocol === 'https:' && parsed.protocol === 'http:' && parsed.hostname === window.location.hostname) {
      parsed.protocol = 'https:';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return configured;
  }
}

export const baseURL = resolveConfiguredApiUrl();

export function getPublicBaseUrl() {
  if (typeof window !== 'undefined') {
    if (baseURL.startsWith('/')) {
      return window.location.origin;
    }
    try {
      const parsed = new URL(baseURL, window.location.origin);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return window.location.origin;
    }
  }
  return String(baseURL || '').replace(/\/api\/v1\/?$/, '');
}

export function toPublicAssetUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.startsWith('/static/')) {
    return `${getPublicBaseUrl()}${url}`;
  }
  if (url.startsWith('/')) return url;
  if ((url.startsWith('http://') || url.startsWith('https://')) && url.includes('/static/')) {
    try {
      return `${getPublicBaseUrl()}${new URL(url).pathname}`;
    } catch {
      return url;
    }
  }
  return url;
}

export const api = axios.create({
  baseURL: baseURL,
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);