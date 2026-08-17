import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePdvMovimentacaoStore } from '../pdvMovimentacaoStore';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
  },
  normalizeListResponse: vi.fn((data) => data),
}));

describe('pdvMovimentacaoStore', () => {
  beforeEach(() => {
    usePdvMovimentacaoStore.getState().clearCache();
    vi.clearAllMocks();
  });

  it('deve inicializar com caches vazios', () => {
    const state = usePdvMovimentacaoStore.getState();
    expect(state.monthCache).toEqual({});
    expect(state.loadingMonths).toEqual({});
    expect(state.cacheTimestamps).toEqual({});
  });

  it('deve buscar movimentacoes por mes e atualizar o cache', async () => {
    const mockData = [{ id: 1, valor: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    const result = await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10');
    
    const state = usePdvMovimentacaoStore.getState();
    expect(state.monthCache['2023-10']).toEqual(mockData);
    expect(state.loadingMonths['2023-10']).toBe(false);
    expect(state.cacheTimestamps['2023-10']).toBeGreaterThan(0);
    expect(result).toEqual(mockData);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/pdv/movimentacoes', expect.any(Object));
  });

  it('deve usar o cache se a proxima chamada para o mesmo mes for dentro do TTL', async () => {
    const mockData = [{ id: 1, valor: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10');
    await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10'); // Segunda chamada

    expect(api.get).toHaveBeenCalledTimes(1); // Não deve chamar a API novamente
  });

  it('deve forcar a busca se force = true', async () => {
    const mockData = [{ id: 1, valor: 100 }];
    (api.get as any).mockResolvedValue({ data: mockData });

    await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10');
    await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10', true); // Força busca

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('deve limpar os caches', async () => {
    const mockData = [{ id: 1, valor: 100 }];
    (api.get as any).mockResolvedValueOnce({ data: mockData });

    await usePdvMovimentacaoStore.getState().fetchMovimentacoes('2023-10');
    usePdvMovimentacaoStore.getState().clearCache();
    
    const state = usePdvMovimentacaoStore.getState();
    expect(state.monthCache).toEqual({});
    expect(state.cacheTimestamps).toEqual({});
  });
});
