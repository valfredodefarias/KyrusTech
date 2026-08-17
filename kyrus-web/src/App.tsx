import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useMemo } from 'react';
import type { JSX } from 'react';

// Components & Store
import { Layout } from './components/Layout';
import { api } from './services/api';
import { useAuthStore } from './store/authStore';
import { useTabStore } from './store/tabStore';
import { TabSyncGuard } from './components/TabSyncGuard';
import { ROUTE_RULES, hasPathPermission, getFirstAllowedPath } from './utils/routeRegistry';

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
const ImportacaoPDV = lazy(() => import('./pages/ImportacaoPDV'));
const Produtos = lazy(() => import('./pages/Produtos'));
const Apps = lazy(() => import('./pages/Apps').then((module) => ({ default: module.Apps })));
const MovimentacaoPDV = lazy(() => import('./pages/MovimentacaoPDV').then((module) => ({ default: module.MovimentacaoPDV })));
const Entidades = lazy(() => import('./pages/Entidades').then((module) => ({ default: module.Entidades })));


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

function ProtectedRoute({ children, path }: { children: React.ReactNode, path: string }) {
  const initialized = useAuthStore(state => state.initialized);
  const user = useAuthStore(state => state.user);
  const empresa = useAuthStore(state => state.empresa);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated());

  if (!initialized) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" />;
  }

  const basePath = path.split('?')[0];
  const rule = ROUTE_RULES[basePath];

  const permissions = user?.permissions || [];
  const hasPermission = 
    permissions.includes('*') || 
    !rule || 
    !rule.permissions || 
    rule.permissions.length === 0 || 
    rule.permissions.some((p: string) => permissions.includes(p));

  let hasRequiredApp = true;
  if (rule?.requiredApps && rule.requiredApps.length > 0 && empresa?.pdv_config) {
    try {
      const pdvConfig = JSON.parse(empresa.pdv_config);
      const activeApps = pdvConfig.active_apps || [];
      hasRequiredApp = rule.requiredApps.every((app: string) => activeApps.includes(app));
    } catch (e) {
      console.error("Erro ao parsear pdv_config em ProtectedRoute", e);
      hasRequiredApp = false;
    }
  }

  if (!hasPermission || !hasRequiredApp) {
    return <Navigate to={getFirstAllowedPath(user)} replace />;
  }

  return <>{children}</>;
}

function App() {
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);
  const authenticated = useAuthStore((state) => state.authenticated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);

  useEffect(() => {
    if (user) {
      const { tabs, activeTabPath } = useTabStore.getState();
      const filteredTabs = tabs.filter(t => hasPathPermission(t.path, user));
      
      if (filteredTabs.length === 0) {
        const fallback = getFirstAllowedPath(user);
        const rule = ROUTE_RULES[fallback.split('?')[0]];
        const nextTabs = [{
          path: fallback,
          basePath: fallback.split('?')[0],
          label: rule?.defaultLabel || 'Início',
          iconName: rule?.defaultIcon || 'Layout',
          pinned: true,
          dirty: false,
          visited: true
        }];
        useTabStore.setState({ tabs: nextTabs, activeTabPath: fallback });
      } else {
        let nextActive = activeTabPath;
        if (!hasPathPermission(activeTabPath, user)) {
          nextActive = filteredTabs[0].path;
        }
        useTabStore.setState({ tabs: filteredTabs, activeTabPath: nextActive });
      }
    }
  }, [user]);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/index.html', { cache: 'no-store' });
        if (!response.ok) return;
        const html = await response.text();
        
        const match = html.match(/src="[^"]*assets\/index-([A-Za-z0-9_-]+)\.js"/);
        if (!match) return;
        const serverHash = match[1];

        const scriptElement = document.querySelector('script[src*="assets/index-"]');
        const currentSrc = scriptElement?.getAttribute('src') || '';
        const currentMatch = currentSrc.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
        
        if (currentMatch && currentMatch[1] !== serverHash) {
          window.location.reload();
        }
      } catch (err) {
        console.error('[AutoUpdate] Erro ao verificar atualizações:', err);
      }
    }, 180000);

    return () => clearInterval(interval);
  }, []);

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
    }, 30000);

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
                  ? <Navigate to={isAuthenticated ? getFirstAllowedPath(user) : "/login"} replace />
                  : <RouteFallback />
              }
            />
            <Route path="/login" element={<Login />} />

            <Route path="/*" element={<PrivateRoute><Layout /></PrivateRoute>} />

            <Route path="*" element={<Navigate to="/boletim" replace />} />
          </Routes>
        </Suspense>
      </TabSyncGuard>
    </BrowserRouter>
  );
}

export default App;