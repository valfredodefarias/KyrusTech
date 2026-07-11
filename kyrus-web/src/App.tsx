import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import type { JSX } from 'react';

// Components & Store
import { Layout } from './components/Layout';
import { api } from './services/api';
import { useAuthStore } from './store/authStore';
import { TabSyncGuard } from './components/TabSyncGuard';

const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const Home = lazy(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const Boletim = lazy(() => import('./pages/Boletim').then((module) => ({ default: module.Boletim })));
const Dre = lazy(() => import('./pages/Dre').then((module) => ({ default: module.Dre })));
const Consultor = lazy(() => import('./pages/Consultor').then((module) => ({ default: module.Consultor })));
const CentroCusto = lazy(() => import('./pages/CentroCusto').then((module) => ({ default: module.CentroCusto })));
const Contas = lazy(() => import('./pages/Contas').then((module) => ({ default: module.Contas })));
const Orcamentos = lazy(() => import('./pages/Orcamentos').then((module) => ({ default: module.Orcamentos })));
const Budget = lazy(() => import('./pages/Budget').then((module) => ({ default: module.Budget })));
const Importacao = lazy(() => import('./pages/Importacao').then((module) => ({ default: module.Importacao })));
const ImportacaoEntidades = lazy(() => import('./pages/ImportacaoEntidades').then((module) => ({ default: module.ImportacaoEntidades })));
const Lancamentos = lazy(() => import('./pages/Lancamentos').then((module) => ({ default: module.Lancamentos })));
const Cartoes = lazy(() => import('./pages/Cartoes').then((module) => ({ default: module.Cartoes })));
const ConciliacaoCartoes = lazy(() => import('./pages/ConciliacaoCartoes').then((module) => ({ default: module.ConciliacaoCartoes })));
const Pdv = lazy(() => import('./pages/PDV').then((module) => ({ default: module.PDV })));
const PdvFechamento = lazy(() => import('./pages/PDVFechamento').then((module) => ({ default: module.PDVFechamento })));
const Caixa = lazy(() => import('./pages/Caixa').then((module) => ({ default: module.Caixa })));
const Configuracoes = lazy(() => import('./pages/Configuracoes').then((module) => ({ default: module.Configuracoes })));
const Auditoria = lazy(() => import('./pages/Auditoria').then((module) => ({ default: module.Auditoria })));
const ComissoesDashboard = lazy(() => import('./pages/ComissoesDashboard').then((module) => ({ default: module.ComissoesDashboard })));
const IntegracaoAsaas = lazy(() => import('./pages/IntegracaoAsaas').then((module) => ({ default: module.IntegracaoAsaas })));
const ImportacaoOfx = lazy(() => import('./pages/ImportacaoOfx').then((module) => ({ default: module.ImportacaoOfx })));
const ImportacaoNfe = lazy(() => import('./pages/ImportacaoNfe').then((module) => ({ default: module.ImportacaoNfe })));

const RouteFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center px-6 text-sm font-semibold text-slate-500 dark:text-slate-300">
    Carregando módulo...
  </div>
);

function PrivateRoute({ children }: { children: JSX.Element }) {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());

  if (!initialized) {
    return <RouteFallback />;
  }

  return isAuthenticated ? children : <Navigate to="/" />;
}

function ProtectedRoute({ children, requiredPermissions }: { children: JSX.Element; requiredPermissions?: string[] }) {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const user = useAuthStore((state) => state.user);

  if (!initialized) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" />;
  }

  const permissions = user?.permissions || [];
  const hasPermission = 
    permissions.includes('*') || 
    !requiredPermissions || 
    requiredPermissions.length === 0 || 
    requiredPermissions.some((p) => permissions.includes(p));

  if (!hasPermission) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

function App() {
  const initialized = useAuthStore((state) => state.initialized);
  const authenticated = useAuthStore((state) => state.authenticated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);

  type SessionInfo = {
    expires_in_minutes: number;
    expires_at: string;
  };

  useEffect(() => {
    let active = true;

    async function initializeSession() {
      const [userResult, sessionResult] = await Promise.allSettled([
        api.get('/usuarios/me'),
        api.get<SessionInfo>('/auth/session'),
      ]);

      if (!active) {
        return;
      }

      if (userResult.status === 'fulfilled') {
        setAuthenticated(true);
        setUser(userResult.value.data);
      } else {
        setAuthenticated(false);
        setUser(null);
      }

      if (sessionResult.status === 'fulfilled') {
        setSessionExpiresAt(sessionResult.value.data.expires_at);
      } else {
        setSessionExpiresAt(null);
      }

      setInitialized(true);
    }

    void initializeSession();

    return () => {
      active = false;
    };
  }, []);

  // Rastrear atividade da sessão em background para desconectar imediatamente se outro dispositivo logar
  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const interval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      try {
        await api.get('/auth/session');
      } catch (err) {
        console.error('Erro de validação em background da sessão:', err);
      }
    }, 30000); // Executa a cada 30 segundos

    return () => clearInterval(interval);
  }, [authenticated]);

  return (
    <BrowserRouter>
      <TabSyncGuard>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                initialized
                  ? <Navigate to={isAuthenticated ? "/home" : "/login"} replace />
                  : <RouteFallback />
              }
            />
            <Route path="/login" element={<Login />} />

            <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
              <Route path="/home" element={<ProtectedRoute requiredPermissions={['page:home:view']}><Home /></ProtectedRoute>} />
              <Route path="/boletim" element={<ProtectedRoute requiredPermissions={['page:boletim:view']}><Boletim /></ProtectedRoute>} />
              <Route path="/dre" element={<ProtectedRoute requiredPermissions={['page:dre:view']}><Dre /></ProtectedRoute>} />
              <Route path="/consultor" element={<ProtectedRoute requiredPermissions={['page:consultor:view']}><Consultor /></ProtectedRoute>} />
              <Route path="/lancamentos" element={<ProtectedRoute requiredPermissions={['page:lancamentos:view']}><Lancamentos /></ProtectedRoute>} />
              <Route path="/entidades" element={<Navigate to="/config?tab=INTERESSADOS" replace />} />
              <Route path="/contas" element={<ProtectedRoute requiredPermissions={['page:contas:view']}><Contas /></ProtectedRoute>} />
              <Route path="/orcamentos" element={<ProtectedRoute requiredPermissions={['page:dre:view']}><Orcamentos /></ProtectedRoute>} />
              <Route path="/budget" element={<ProtectedRoute requiredPermissions={['page:dre:view']}><Budget /></ProtectedRoute>} />
              <Route path="/cartoes" element={<ProtectedRoute requiredPermissions={['page:cartoes:view']}><Cartoes /></ProtectedRoute>} />
              <Route path="/conciliacao-cartoes" element={<ProtectedRoute requiredPermissions={['page:cartoes:view']}><ConciliacaoCartoes /></ProtectedRoute>} />
              <Route
                path="/pdv"
                element={
                  <ProtectedRoute
                    requiredPermissions={[
                      'PDV_VER_TODAS_VENDAS',
                      'PDV_SER_VENDEDOR',
                      'PDV_REALIZAR_SANGRIA',
                      'PDV_CANCELAR_VENDA',
                      'PDV_CONCEDER_DESCONTO',
                    ]}
                  >
                    <Pdv />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pdv/fechamento"
                element={
                  <ProtectedRoute
                    requiredPermissions={[
                      'PDV_VER_TODAS_VENDAS',
                      'PDV_SER_VENDEDOR',
                      'PDV_REALIZAR_SANGRIA',
                      'PDV_CANCELAR_VENDA',
                      'PDV_CONCEDER_DESCONTO',
                    ]}
                  >
                    <PdvFechamento />
                  </ProtectedRoute>
                }
              />
              <Route path="/caixa" element={<ProtectedRoute requiredPermissions={['page:caixa:view']}><Caixa /></ProtectedRoute>} />
              <Route path="/centro-custo" element={<ProtectedRoute requiredPermissions={['page:centro_custo:view']}><CentroCusto /></ProtectedRoute>} />
              <Route path="/config" element={<ProtectedRoute requiredPermissions={['page:configuracoes:view']}><Configuracoes /></ProtectedRoute>} />
              <Route path="/importacao" element={<ProtectedRoute requiredPermissions={['page:importacao:view']}><Importacao /></ProtectedRoute>} />
              <Route path="/importacao_interessados" element={<ProtectedRoute requiredPermissions={['page:importacao_entidades:view']}><ImportacaoEntidades /></ProtectedRoute>} />
              <Route path="/importacao_ofx" element={<ProtectedRoute requiredPermissions={['page:importacao_ofx:view']}><ImportacaoOfx /></ProtectedRoute>} />
              <Route path="/importacao_nfe" element={<ProtectedRoute requiredPermissions={['page:importacao_nfe:view', 'page:importacao:view']}><ImportacaoNfe /></ProtectedRoute>} />
              <Route path="/auditoria" element={<ProtectedRoute requiredPermissions={['page:auditoria:view']}><Auditoria /></ProtectedRoute>} />
              <Route path="/comissoes" element={<ProtectedRoute requiredPermissions={['page:boletim:view']}><ComissoesDashboard /></ProtectedRoute>} />
              <Route path="/integracoes" element={<Navigate to="/integracoes/asaas" replace />} />
              <Route path="/integracoes/asaas" element={<ProtectedRoute requiredPermissions={['page:integracoes:view']}><IntegracaoAsaas /></ProtectedRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/boletim" replace />} />
          </Routes>
        </Suspense>
      </TabSyncGuard>
    </BrowserRouter>
  );
}

export default App;