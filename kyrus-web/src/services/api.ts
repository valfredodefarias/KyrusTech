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

let cachedAllowedAssetHosts: Set<string> | null = null;

function getAllowedAssetHosts(): Set<string> {
  if (cachedAllowedAssetHosts) return cachedAllowedAssetHosts;

  const allowedHosts = new Set<string>();
  if (typeof window !== 'undefined') {
    allowedHosts.add(window.location.host);
    try {
      const apiParsed = new URL(baseURL, window.location.origin);
      allowedHosts.add(apiParsed.host);
    } catch {
      // No-op
    }
  }

  cachedAllowedAssetHosts = allowedHosts;
  return allowedHosts;
}

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
  const allowedHosts = getAllowedAssetHosts();

  if (url.startsWith('/static/')) {
    return `${getPublicBaseUrl()}${url}`;
  }
  if (url.startsWith('/')) {
    return null;
  }
  if ((url.startsWith('http://') || url.startsWith('https://')) && url.includes('/static/')) {
    try {
      const parsed = new URL(url);
      if (allowedHosts.size > 0 && !allowedHosts.has(parsed.host)) {
        return null;
      }
      if (!parsed.pathname.startsWith('/static/')) {
        return null;
      }
      return `${getPublicBaseUrl()}${parsed.pathname}`;
    } catch {
      return null;
    }
  }

  return null;
}

export const api = axios.create({
  baseURL: baseURL,
  withCredentials: true,
});

export async function fetchLancamentosPaged<T = any>(
  params: Record<string, any> = {},
  options?: { pageSize?: number; maxPages?: number; signal?: AbortSignal }
) {
  const pageSize = Math.max(1, Math.min(Number(options?.pageSize || 1500), 1500));
  const maxPages = Math.max(1, Number(options?.maxPages || 120));
  let skip = Math.max(0, Number(params.skip || 0));
  const items: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const response = await api.get<T[]>('/lancamentos/', {
      params: { ...params, limit: pageSize, skip },
      signal: options?.signal,
    });

    const chunk = Array.isArray(response.data) ? response.data : [];
    items.push(...chunk);

    if (chunk.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return items;
}

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