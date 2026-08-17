import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useIfoodStore } from '../ifoodStore';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
  },
  normalizeListResponse: vi.fn((data) => data),
}));

describe('ifoodStore', () => {
  beforeEach(() => {
    useIfoodStore.getState().clearCache();
    vi.clearAllMocks();
  });

  it('deve inicializar com estado vazio', () => {
    const state = useIfoodStore.getState();
    expect(state.transactions).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.cacheTimestamp).toBe(0);
  });

  it('deve buscar transacoes e atualizar o cache', async () => {
    const mockData = [{ id: 1, valor_bruto: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    const result = await useIfoodStore.getState().fetchTransactions();
    
    const state = useIfoodStore.getState();
    expect(state.transactions).toEqual(mockData);
    expect(state.loading).toBe(false);
    expect(state.cacheTimestamp).toBeGreaterThan(0);
    expect(result).toEqual(mockData);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/pdv/ifood/transacoes', expect.any(Object));
  });

  it('deve usar o cache se a proxima chamada for dentro do TTL', async () => {
    const mockData = [{ id: 1, valor_bruto: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    await useIfoodStore.getState().fetchTransactions();
    await useIfoodStore.getState().fetchTransactions(); // Segunda chamada

    expect(api.get).toHaveBeenCalledTimes(1); // Não deve chamar a API novamente
  });

  it('deve forcar a busca na API se force = true for passado', async () => {
    const mockData = [{ id: 1, valor_bruto: 100 }];
    (api.get as any).mockResolvedValue({ data: mockData });

    await useIfoodStore.getState().fetchTransactions();
    await useIfoodStore.getState().fetchTransactions(true); // Força busca

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('deve invalidar o cache', async () => {
    const mockData = [{ id: 1, valor_bruto: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    await useIfoodStore.getState().fetchTransactions();
    useIfoodStore.getState().invalidate();
    
    expect(useIfoodStore.getState().cacheTimestamp).toBe(0);
  });
});
