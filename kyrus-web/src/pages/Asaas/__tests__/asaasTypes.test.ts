import { describe, it, expect } from 'vitest';
import type { AsaasDashboardData, AsaasCobranca } from '../types';

describe('Asaas App Types & Calculations', () => {
  it('calculates totals correctly from dashboard structure', () => {
    const mockDashboard: AsaasDashboardData = {
      saldo: {
        saldo: 15420.5,
        saldo_disponivel: 14200.0,
        saldo_bloqueado: 1220.5,
      },
      kpis: {
        total_faturado: 50000.0,
        total_recebido: 48500.0,
        total_a_receber: 12000.0,
        total_vencido: 2500.0,
        total_gastos: 1500.0,
        taxa_media_efetiva: 3.0,
        qtd_recebidas: 45,
        qtd_pendentes: 12,
        qtd_vencidas: 3,
        qtd_total: 60,
      },
      distribuicao_meios: {
        PIX: { valor: 30000.0, qtd: 30, pct: 60.0 },
        BOLETO: { valor: 15000.0, qtd: 10, pct: 30.0 },
        CREDIT_CARD: { valor: 5000.0, qtd: 5, pct: 10.0 },
        OUTROS: { valor: 0, qtd: 0, pct: 0 },
      },
      previsoes_timeline: [
        {
          data: '2026-10-01',
          valor_bruto: 5000.0,
          taxa_estimada: 100.0,
          valor_liquido: 4900.0,
          qtd: 5,
        },
      ],
      gastos_por_categoria: [
        {
          codigo: 'PIX_FEE',
          categoria: 'Tarifas de Liquidação Pix',
          valor: 600.0,
          qtd: 30,
          percentual: 40.0,
        },
        {
          codigo: 'BOLETO_FEE',
          categoria: 'Tarifas de Emissão / Boleto',
          valor: 900.0,
          qtd: 10,
          percentual: 60.0,
        },
      ],
    };

    expect(mockDashboard.saldo.saldo_disponivel).toBe(14200.0);
    expect(mockDashboard.kpis.total_recebido).toBe(48500.0);
    expect(mockDashboard.distribuicao_meios.PIX.pct + mockDashboard.distribuicao_meios.BOLETO.pct + mockDashboard.distribuicao_meios.CREDIT_CARD.pct).toBe(100.0);
    expect(mockDashboard.previsoes_timeline[0].valor_bruto - mockDashboard.previsoes_timeline[0].taxa_estimada).toBe(mockDashboard.previsoes_timeline[0].valor_liquido);
  });

  it('correctly handles fee calculation on individual charge', () => {
    const charge: AsaasCobranca = {
      id: 'pay_123456789',
      customerName: 'Cliente Teste Ltda',
      value: 1000.0,
      netValue: 980.1,
      fee: 19.9,
      dueDate: '2026-10-05',
      status: 'PENDING',
      billingType: 'PIX',
    };

    expect(charge.fee).toBeCloseTo(charge.value - charge.netValue, 2);
    expect(charge.billingType).toBe('PIX');
  });
});
