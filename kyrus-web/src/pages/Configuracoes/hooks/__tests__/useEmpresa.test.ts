import { renderHook, act } from '@testing-library/react';
import { useEmpresa } from '../useEmpresa';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../../../../services/api';

// Mocks
vi.mock('../../../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  normalizeListResponse: vi.fn((data) => data || []),
  toPublicAssetUrl: vi.fn((url) => `/public/${url}`),
}));

vi.mock('../../../../store/authStore', () => ({
  useAuthStore: vi.fn((selector) => {
    const state = {
      user: { id: 1, email: 'admin@empresa.com', permissions: ['*'] },
      empresa: { id: 1, nome_fantasia: 'Minha Empresa', cnpj: '00.000.000/0001-00', cor_primaria: '#ff0000' },
      setEmpresa: vi.fn(),
    };
    return selector(state);
  })
}));

vi.mock('../../../../store/lookupStore', () => ({
  useLookupStore: vi.fn((selector) => {
    const state = { invalidatePlanoContas: vi.fn() };
    return selector(state);
  })
}));

(globalThis as any).URL.createObjectURL = vi.fn();
(globalThis as any).URL.revokeObjectURL = vi.fn();

describe('useEmpresa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with store data', () => {
    const { result } = renderHook(() => useEmpresa());
    
    expect(result.current.empresa).toEqual({ id: 1, nome_fantasia: 'Minha Empresa', cnpj: '00.000.000/0001-00', cor_primaria: '#ff0000' });
    expect(result.current.cor).toBe('#ff0000');
    expect(result.current.canResetEmpresa).toBe(false); // because email is not cirocaue12@gmail.com
  });

  it('should call api.get on loadEmpresa to load categorias', async () => {
    const mockData = { data: [{ id: 10, nome: 'Despesas Gerais', tipo: 'DESPESA' }] };
    (api.get as any).mockResolvedValue(mockData);

    const { result } = renderHook(() => useEmpresa());

    await act(async () => {
      await result.current.loadEmpresa();
    });

    expect(api.get).toHaveBeenCalledWith('/plano-contas/');
  });

  it('should update cor locally', () => {
    const { result } = renderHook(() => useEmpresa());
    
    act(() => {
      result.current.setCor('#00ff00');
    });

    expect(result.current.cor).toBe('#00ff00');
  });

  it('should call api.patch when handleSave is called', async () => {
    const { result } = renderHook(() => useEmpresa());
    
    (api.patch as any).mockResolvedValue({ data: { id: 1, cor_primaria: '#00ff00' } });

    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await act(async () => {
      await result.current.handleSave();
    });

    expect(api.patch).toHaveBeenCalledWith('/empresas/1', {
      cor_primaria: '#ff0000',
      categoria_nfe_fornecedores_id: null,
    });
    alertMock.mockRestore();
  });
});
