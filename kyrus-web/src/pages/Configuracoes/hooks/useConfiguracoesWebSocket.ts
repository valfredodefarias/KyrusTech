import { useKyrusWsListener } from '../../../hooks/useKyrusWebSocket';

export function useUsuariosWebSocket(reloadUser: () => void) {
  useKyrusWsListener('USER_UPDATED', () => {
    reloadUser();
  });
  useKyrusWsListener('USER_PERMISSIONS_UPDATED', () => {
    reloadUser();
  });
}

export function useEmpresaWebSocket(reloadEmpresa: () => void) {
  useKyrusWsListener('EMPRESA_UPDATED', () => {
    reloadEmpresa();
  });
}

export function useIntegracoesWebSocket(reloadIntegracoes: () => void) {
  useKyrusWsListener('INTEGRACAO_BANCARIA_CREATED', () => {
    reloadIntegracoes();
  });
  useKyrusWsListener('INTEGRACAO_BANCARIA_UPDATED', () => {
    reloadIntegracoes();
  });
  useKyrusWsListener('INTEGRACAO_BANCARIA_DELETED', () => {
    reloadIntegracoes();
  });
}
