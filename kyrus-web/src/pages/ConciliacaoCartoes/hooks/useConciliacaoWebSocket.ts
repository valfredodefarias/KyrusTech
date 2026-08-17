import { useKyrusWsListener } from '../../../hooks/useKyrusWebSocket';

export function useConciliacaoWebSocket(
  fetchAgenda: () => Promise<void>,
  fetchDepositos: () => Promise<void>,
  loadRegras: () => Promise<void>
) {
  // Sincronização de regras
  useKyrusWsListener('REGRA_CARTAO_CREATED', () => {
    void loadRegras();
  });
  useKyrusWsListener('REGRA_CARTAO_UPDATED', () => {
    void loadRegras();
  });
  useKyrusWsListener('REGRA_CARTAO_DELETED', () => {
    void loadRegras();
  });

  // Sincronização de recebíveis da agenda
  useKyrusWsListener('RECEBIVEL_CREATED', () => {
    void fetchAgenda();
  });
  useKyrusWsListener('RECEBIVEL_UPDATED', () => {
    void fetchAgenda();
  });
  useKyrusWsListener('RECEBIVEL_DELETED', () => {
    void fetchAgenda();
  });
  useKyrusWsListener('RECEBIVEL_CONCILIATED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });

  // Sincronização de depósitos bancários
  useKyrusWsListener('LANCAMENTO_CREATED', () => {
    void fetchDepositos();
  });
  useKyrusWsListener('LANCAMENTO_UPDATED', () => {
    void fetchDepositos();
  });
  useKyrusWsListener('LANCAMENTO_DELETED', () => {
    void fetchDepositos();
  });

  // Sincronização de vendas e movimentações de PDV que geram recebíveis ou depósitos
  useKyrusWsListener('MOVIMENTACAO_PDV_CREATED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
  useKyrusWsListener('MOVIMENTACAO_PDV_UPDATED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
  useKyrusWsListener('MOVIMENTACAO_PDV_DELETED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
  useKyrusWsListener('VENDA_CREATED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
  useKyrusWsListener('VENDA_UPDATED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
  useKyrusWsListener('VENDA_DELETED', () => {
    void fetchAgenda();
    void fetchDepositos();
  });
}
