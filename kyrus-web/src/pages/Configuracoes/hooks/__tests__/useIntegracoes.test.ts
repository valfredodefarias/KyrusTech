import { renderHook, act } from '@testing-library/react';
import { useIntegracoes } from '../useIntegracoes';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../../../../services/api';

// Mocks
vi.mock('../../../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  normalizeListResponse: vi.fn((data) => data || []),
}));

describe('useIntegracoes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize and load centros and integracoes on mount', async () => {
    const mockCentros = [{ id: 1, nome: 'Matriz', status: 'ATIVO' }];
    const mockIntegracoes = [{ id: 10, tipo: 'NFSTOCK', nome: 'Integração 1' }];
    const mockUser = { id: 1, permissions: ['integracoes:sync'] };

    (api.get as any).mockImplementation((url: string) => {
      if (url === '/centro-custo/') return Promise.resolve({ data: mockCentros });
      if (url === '/integracoes-bancarias/') return Promise.resolve({ data: mockIntegracoes });
      if (url === '/usuarios/me') return Promise.resolve({ data: mockUser });
      return Promise.resolve({ data: [] });
    });

    const { result } = renderHook(() => useIntegracoes());
    
    expect(result.current.loading).toBe(true);
    
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.centros).toEqual(mockCentros);
    expect(result.current.integracoes).toEqual(mockIntegracoes);
    expect(result.current.centroCustoId).toBe('1');
    expect(result.current.canForceSyncByLogin).toBe(true);
  });

  it('should call handleSave to configure NFStock', async () => {
    const { result } = renderHook(() => useIntegracoes());

    // Setup initial state
    act(() => {
      result.current.setCentroCustoId('1');
      result.current.setUsername('teste');
      result.current.setPassword('senha123');
    });

    // Mock successful post
    (api.post as any).mockResolvedValue({ data: {} });
    // Mock loadData get calls
    (api.get as any).mockResolvedValue({ data: [] });

    // override alert since jsdom doesn't have it by default without mocking window.alert
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await act(async () => {
      await result.current.handleSave();
    });

    expect(api.post).toHaveBeenCalledWith('/integracoes-bancarias/nfstock/configurar', {
      nome: 'NFStock',
      username: 'teste',
      password: 'senha123',
      centro_custo_id: 1,
      select_company: false,
      company_name: null,
      ativo: true,
    });
    
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('salva'));
    alertMock.mockRestore();
  });
});
