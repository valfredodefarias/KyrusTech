export interface OfxPreloadedPayload {
  result: any;
  contaId: number;
  contaNome?: string;
  bancoNome?: string;
  timestamp: number;
}

let inMemoryPayload: OfxPreloadedPayload | null = null;
const STORAGE_KEY = 'kyrus_ofx_preloaded_data';

export function setOfxPreloadedData(payload: OfxPreloadedPayload) {
  inMemoryPayload = payload;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[ofxImportBridge] Não foi possível salvar no sessionStorage', err);
  }
}

export function consumeOfxPreloadedData(targetContaId?: number | null): OfxPreloadedPayload | null {
  // 1. Tenta memória
  if (inMemoryPayload) {
    const p = inMemoryPayload;
    if (!targetContaId || Number(p.contaId) === Number(targetContaId)) {
      inMemoryPayload = null;
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
      return p;
    }
  }

  // 2. Tenta sessionStorage como fallback
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: OfxPreloadedPayload = JSON.parse(raw);
      // Válido por até 15 minutos
      if (Date.now() - (parsed.timestamp || 0) < 15 * 60 * 1000) {
        if (!targetContaId || Number(parsed.contaId) === Number(targetContaId)) {
          sessionStorage.removeItem(STORAGE_KEY);
          return parsed;
        }
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch (err) {
    console.warn('[ofxImportBridge] Erro ao ler sessionStorage', err);
  }

  return null;
}
