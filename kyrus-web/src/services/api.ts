import axios from 'axios';
import { useAuthStore } from '../store/authStore';

function resolveConfiguredApiUrl() {
  const configured = String(import.meta.env.VITE_API_URL || '').trim();

  if (!configured) {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        if (window.location.port && window.location.port !== '8000' && window.location.port !== '80' && window.location.port !== '443') {
          return `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
        }
        return '/api/v1';
      }
      if (host.startsWith('api.')) {
        return `${window.location.origin}/api/v1`;
      }
      const baseHost = host.startsWith('www.') ? host.slice(4) : host;
      return `https://api.${baseHost}/api/v1`;
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
  const normalizedUrl = url.trim();

  if (!normalizedUrl) return null;

  if (normalizedUrl.startsWith('/static/')) {
    return `${getPublicBaseUrl()}${normalizedUrl}`;
  }

  if (normalizedUrl.startsWith('static/')) {
    return `${getPublicBaseUrl()}/${normalizedUrl}`;
  }

  if (normalizedUrl.startsWith('/')) {
    return null;
  }

  if ((normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) && normalizedUrl.includes('/static/')) {
    try {
      const parsed = new URL(normalizedUrl);
      if (!parsed.pathname.startsWith('/static/')) {
        return null;
      }
      return `${getPublicBaseUrl()}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }

  return null;
}

type ApiMutationCallback = (url: string, response?: any) => void;
const mutationCallbacks: ApiMutationCallback[] = [];

export function onApiMutation(callback: ApiMutationCallback) {
  mutationCallbacks.push(callback);
  return () => {
    const index = mutationCallbacks.indexOf(callback);
    if (index !== -1) mutationCallbacks.splice(index, 1);
  };
}

function notifyMutation(url: string, response?: any) {
  mutationCallbacks.forEach((cb) => {
    try {
      cb(url, response);
    } catch (e) {
      console.error('Error in api mutation listener:', e);
    }
  });
}

export const api = axios.create({
  baseURL: baseURL,
  withCredentials: true,
  timeout: 30000, // 30 seconds default timeout
});

api.interceptors.request.use(
  (config) => {
    const authState = useAuthStore.getState();
    const companyId = authState.empresa?.id ?? authState.user?.empresa_id;
    if (companyId) {
      config.headers['X-Company-ID'] = String(companyId);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export function normalizeListResponse<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }

  if (data && typeof data === 'object') {
    const payload = data as {
      data?: unknown;
      items?: unknown;
      results?: unknown;
      items_list?: unknown;
      contas?: unknown;
      categorias?: unknown;
      centros?: unknown;
      entidades?: unknown;
      presets?: unknown;
    };

    const candidate = payload.data ?? payload.items ?? payload.results ?? payload.items_list ?? payload.contas ?? payload.categorias ?? payload.centros ?? payload.entidades ?? payload.presets;
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
}

export async function fetchLancamentosPaged<T = any>(
  params: Record<string, any> = {},
  options?: { pageSize?: number; maxPages?: number; signal?: AbortSignal }
) {
  // Se sem_paginacao ou minimized estiver ativo, faz apenas uma chamada direta
  if (params.sem_paginacao || params.minimized) {
    const response = await api.get<T[]>('/lancamentos/', {
      params,
      signal: options?.signal,
    });
    return Array.isArray(response.data) ? response.data : [];
  }

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
  (response) => {
    const method = String(response.config.method || '').toUpperCase();
    const url = String(response.config.url || '');
    if (['POST', 'PUT', 'DELETE'].includes(method)) {
      notifyMutation(url, response);
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    if (config) {
      const isRetryableError =
        !error.response ||
        [502, 503, 504].includes(error.response?.status);

      if (isRetryableError) {
        config.__retryCount = config.__retryCount || 0;
        if (config.__retryCount < 3) {
          config.__retryCount += 1;
          console.warn(`[API Retry] Requisição falhou. Tentativa ${config.__retryCount} de 3 em 1.5s...`, config.url);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return api(config);
        }
      }
    }

    const status = error?.response?.status;
    const detail = String(error?.response?.data?.detail || error?.message || '').toLowerCase();
    const authErrorMarkers = [
      'nao autenticado',
      'não autenticado',
      'credenciais invalidas',
      'credenciais inválidas',
      'token invalido',
      'token inválido',
      'token sem expiração',
      'token sem expiracao',
      'usuario nao encontrado',
      'usuário não encontrado',
      'usuario inativo',
      'usuário inativo',
    ];

    const shouldClearSession = status === 401 || (status === 403 && authErrorMarkers.some((marker) => detail.includes(marker)));

    if (shouldClearSession) {
      const requestUrl = String(error?.config?.url || '');
      const isAuthFlowRequest =
        requestUrl.includes('/usuarios/me') ||
        requestUrl.includes('/auth/login') ||
        requestUrl.includes('/auth/logout') ||
        requestUrl.includes('/auth/session') ||
        requestUrl.includes('/auth/refresh');

      if (status === 401 && (detail.includes('outro dispositivo') || detail.includes('sessão ativa em outro'))) {
        useAuthStore.getState().setOtherDeviceConnected(true);
        useAuthStore.getState().logout(true); // Keep the flag!
      } else if (!isAuthFlowRequest) {
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);