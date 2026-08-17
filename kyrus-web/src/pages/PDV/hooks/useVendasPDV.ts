import { useState, useCallback } from 'react';
import type { PdvVendasResponse } from '../types';
import { api } from '../../../services/api';

export function useVendasPDV() {
  const [data, setData] = useState<PdvVendasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);

  // Filtros
  const [filtroRv, setFiltroRv] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroVendedor, setFiltroVendedor] = useState('TODOS');

  // Load Vendas
  const loadVendas = useCallback(async (limitVal = limit) => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<PdvVendasResponse>(`/pdv/vendas?limit=${limitVal}`);
      if (response.data && typeof response.data === 'object' && 'error' in response.data) {
        setData(null);
        setError(String((response.data as { error?: string }).error || 'Não foi possível carregar as vendas do PDV.'));
      } else {
        // We'll export data directly. The normalization logic can remain where it is needed or we assume it's done by the caller if needed.
        // Actually, in PDV.tsx it uses normalizePdvResponse. We will assume the component has access to it.
        setData(response.data as any); 
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Não foi possível carregar as vendas do PDV.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  return {
    data, setData,
    loading, setLoading,
    error, setError,
    limit, setLimit,
    filtroRv, setFiltroRv,
    filtroCliente, setFiltroCliente,
    filtroStatus, setFiltroStatus,
    filtroVendedor, setFiltroVendedor,
    loadVendas
  };
}
