import { useKyrusWsListener } from '../../../hooks/useKyrusWebSocket';

export function usePdvWebSocket(loadVendas: () => void, loadProdutos: () => void) {
  useKyrusWsListener('VENDA_CREATED', () => {
    void loadVendas();
  });
  useKyrusWsListener('VENDA_UPDATED', () => {
    void loadVendas();
  });
  useKyrusWsListener('VENDA_DELETED', () => {
    void loadVendas();
  });
  useKyrusWsListener('PRODUTO_CREATED', () => {
    void loadProdutos();
  });
  useKyrusWsListener('PRODUTO_UPDATED', () => {
    void loadProdutos();
  });
  useKyrusWsListener('PRODUTO_DELETED', () => {
    void loadProdutos();
  });
}
