import { renderHook, act } from '@testing-library/react';
import { useCarrinho } from '../useCarrinho';
import { describe, it, expect } from 'vitest';

describe('useCarrinho', () => {
  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCarrinho());

    // Basic state tests
    expect(result.current.showVendaForm).toBe(false);
    expect(result.current.vendaStatus).toBe('REALIZADO');
    expect(result.current.vendaItens).toHaveLength(1);
    expect(result.current.vendaItens[0].quantidade).toBe(1);
    expect(result.current.paymentTotal).toBe(0);
    expect(result.current.troco).toBe(0);
  });

  it('should update vendaStatus correctly', () => {
    const { result } = renderHook(() => useCarrinho());

    act(() => {
      result.current.setVendaStatus('CANCELADO');
    });

    expect(result.current.vendaStatus).toBe('CANCELADO');
  });

  it('should update paymentTotal and troco correctly', () => {
    const { result } = renderHook(() => useCarrinho());

    act(() => {
      result.current.setPaymentTotal(150);
      result.current.setTroco(50);
    });

    expect(result.current.paymentTotal).toBe(150);
    expect(result.current.troco).toBe(50);
  });

  it('should allow adding multiple venda itens', () => {
    const { result } = renderHook(() => useCarrinho());

    act(() => {
      result.current.setVendaItens([
        { produtoId: '1', quantidade: 2, desconto: '0', precoUnitario: '100' },
        { produtoId: '2', quantidade: 1, desconto: '10', precoUnitario: '50' }
      ]);
    });

    expect(result.current.vendaItens).toHaveLength(2);
    expect(result.current.vendaItens[0].produtoId).toBe('1');
    expect(result.current.vendaItens[1].produtoId).toBe('2');
  });
});
