import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

export interface SprintDetail {
  nome: string;
  dias_uteis: number;
  peso_pct: number;
  meta_sprint: number;
  realizado_sprint: number;
  atingimento_pct: number;
}

export interface VendedorMétricas {
  vendedor_id: number;
  vendedor: string;
  meta_total: number;
  realizado: number;
  realizado_comissao: number;
  atingimento_pct: number;
  atingimento_proj_pct: number;
  media_atual: number;
  meta_diaria: number;
  projecao: number;
  comissao_acumulada: number;
  status_rag: 'green' | 'amber' | 'red';
  a_realizar_para_meta: number;
  meta_para_hoje: number;
  sprints: SprintDetail[];
}

export interface DashboardPayload {
  mes: number;
  ano: number;
  hoje: string;
  total_dias_uteis: number;
  dias_decorridos: number;
  dias_restantes: number;
  vendedores: VendedorMétricas[];
}

export function useComissoesDashboard(mes: number, ano: number) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<DashboardPayload>('/comissoes/dashboard', {
        params: { mes, ano },
      });
      setData(response.data);
    } catch (err: any) {
      console.error('Erro ao buscar dados do dashboard de comissões:', err);
      const msg = err?.response?.data?.detail || 'Erro ao carregar dados do servidor.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mes, ano]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
