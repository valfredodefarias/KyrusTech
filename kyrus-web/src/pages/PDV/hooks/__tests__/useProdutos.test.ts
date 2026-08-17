import { renderHook, act } from '@testing-library/react';
import { useProdutos } from '../useProdutos';
import { describe, it, expect, vi } from 'vitest';

// Mock global API client
vi.mock('../../../services/api', () => ({
  api: {
    get: vi.fn()
  }
}));

describe('useProdutos', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useProdutos());

    expect(result.current.produtos).toEqual([]);
    expect(result.current.loadingProdutos).toBe(false);
    expect(result.current.filtroProdutoTipo).toBe('TODOS');
    expect(result.current.filtroRevisaoPendente).toBe(false);
  });

  it('should filter active products correctly', () => {
    const { result } = renderHook(() => useProdutos());

    act(() => {
      result.current.setProdutos([
        { id: 1, nome: 'Produto A', is_active: true } as any,
        { id: 2, nome: 'Produto B', is_active: false } as any,
        { id: 3, nome: 'Produto C' } as any // Default behavior treats undefined as active
      ]);
    });

    // Expecting 2 active products (1 and 3)
    expect(result.current.activeProdutos).toHaveLength(2);
    expect(result.current.activeProdutos[0].nome).toBe('Produto A');
    expect(result.current.activeProdutos[1].nome).toBe('Produto C');
  });

  it('should update filters properly', () => {
    const { result } = renderHook(() => useProdutos());

    act(() => {
      result.current.setFiltroProdutoTipo('SERVICO');
      result.current.setFiltroRevisaoPendente(true);
      result.current.setFiltroProdutoNome('Cadeira');
    });

    expect(result.current.filtroProdutoTipo).toBe('SERVICO');
    expect(result.current.filtroRevisaoPendente).toBe(true);
    expect(result.current.filtroProdutoNome).toBe('Cadeira');
  });
});
