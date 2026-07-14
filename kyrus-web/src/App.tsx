import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useMemo } from 'react';
import type { JSX } from 'react';

// Components & Store
import { Layout } from './components/Layout';
import { api } from './services/api';
import { useAuthStore, type AuthUser } from './store/authStore';
import { useTabStore } from './store/tabStore';
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
const ImportacaoPDV = lazy(() => import('./pages/ImportacaoPDV'));
const Produtos = lazy(() => import('./pages/Produtos'));
const Apps = lazy(() => import('./pages/Apps').then((module) => ({ default: module.Apps })));
const MovimentacaoPDV = lazy(() => import('./pages/MovimentacaoPDV').then((module) => ({ default: module.MovimentacaoPDV })));

const PAGE_PERMISSIONS: Record<string, string[]> = {
  '/apps': ['page:configuracoes:view'],
  '/apps/:tab': ['page:integracoes:view'],
  '/apps/movimentacao-pdv': ['page:importacao:view'],
  '/produtos': ['PDV_VER_TODAS_VENDAS', 'PDV_SER_VENDEDOR'],
  '/home': ['page:home:view'],
  '/boletim': ['page:boletim:view'],
  '/contas': ['page:contas:view'],
  '/lancamentos': ['page:lancamentos:view'],
  '/caixa': ['page:caixa:view'],
  '/cartoes': ['page:cartoes:view'],
  '/conciliacao-cartoes': ['page:cartoes:view'],
  '/orcamentos': ['page:dre:view'],
  '/budget': ['page:dre:view'],
  '/dre': ['page:dre:view'],
  '/comissoes': ['page:boletim:view'],
  '/consultor': ['page:consultor:view'],
  '/auditoria': ['page:auditoria:view'],
  '/config': ['page:configuracoes:view'],
  '/importacao': ['page:importacao:view'],
  '/importacao_nfe': ['page:importacao_nfe:view', 'page:importacao:view'],
  '/importacao_ofx': ['page:importacao_ofx:view'],
  '/importacao_interessados': ['page:importacao_entidades:view'],
  '/integracoes/asaas': ['page:integracoes:view'],
  '/pdv': [
    'PDV_VER_TODAS_VENDAS',
    'PDV_SER_VENDEDOR',
    'PDV_REALIZAR_SANGRIA',
    'PDV_CANCELAR_VENDA',
    'PDV_CONCEDER_DESCONTO',
  ],
  '/pdv/fechamento': [
    'PDV_VER_TODAS_VENDAS',
    'PDV_SER_VENDEDOR',
    'PDV_REALIZAR_SANGRIA',
    'PDV_CANCELAR_VENDA',
    'PDV_CONCEDER_DESCONTO',
  ],
  '/pdv/importar': [
    'PDV_VER_TODAS_VENDAS',
    'PDV_SER_VENDEDOR',
    'PDV_REALIZAR_SANGRIA',
    'PDV_CANCELAR_VENDA',
    'PDV_CONCEDER_DESCONTO',
  ],
};

const PAGE_LABELS: Record<string, string> = {
  '/home': 'Visão Geral',
  '/boletim': 'Boletim',
  '/dre': 'DRE',
  '/consultor': 'Área do Consultor',
  '/lancamentos': 'Lançamentos',
  '/contas': 'Contas Bancárias',
  '/orcamentos': 'Orçamentos',
  '/budget': 'Budget',
  '/cartoes': 'Cartões',
  '/conciliacao-cartoes': 'Conciliadora de Cartões',
  '/pdv': 'PDV',
  '/pdv/importar': 'Importação PDV',
  '/caixa': 'Caixa',
  '/config': 'Configurações',
  '/importacao_ofx': 'Importação OFX',
  '/importacao_nfe': 'Importação NF-e',
  '/auditoria': 'Auditoria',
  '/comissoes': 'Comissões e Metas',
  '/apps/movimentacao-pdv': 'Movimentação PDV',
  '/apps/ifood': 'iFood PDV',
};

const PAGE_ICONS: Record<string, string> = {
  '/home': 'Home',
  '/boletim': 'BarChart2',
  '/dre': 'LineChart',
  '/consultor': 'Briefcase',
  '/lancamentos': 'PlusCircle',
  '/contas': 'Landmark',
  '/orcamentos': 'Calculator',
  '/budget': 'Table2',
  '/cartoes': 'CreditCard',
  '/conciliacao-cartoes': 'Coins',
  '/pdv': 'ShoppingBag',
  '/pdv/importar': 'FileSpreadsheet',
  '/caixa': 'Banknote',
  '/config': 'Settings',
  '/importacao_ofx': 'Landmark',
  '/importacao_nfe': 'FileText',
  '/auditoria': 'History',
  '/comissoes': 'Award',
  '/apps/movimentacao-pdv': 'Calculator',
  '/apps/ifood': 'Utensils',
};

export function hasPathPermission(path: string, user: AuthUser | null): boolean {
  if (!user) return false;
  const permissions = user.permissions || [];
  if (permissions.includes('*')) return true;
  
  const basePath = path.split('?')[0];
  
  if (basePath === '/pdv' || basePath === '/produtos' || basePath.startsWith('/pdv/')) {
    const empresa = useAuthStore.getState().empresa;
    let activeApps: string[] = [];
    if (empresa?.pdv_config) {
      try {
        const config = JSON.parse(empresa.pdv_config);
        activeApps = config.active_apps || [];
      } catch {}
    }
    if (!activeApps.includes('pdv_estoque')) {
      return false;
    }
  }
  
  const required = PAGE_PERMISSIONS[basePath];
  if (!required) return true;
  
  return required.some((p) => permissions.includes(p));
}

function PdvEstoqueRoute({ children }: { children: React.ReactNode }) {
  const empresa = useAuthStore((state) => state.empresa);
  
  const activeApps = useMemo(() => {
    if (!empresa?.pdv_config) return [];
    try {
      const config = JSON.parse(empresa.pdv_config);
      return config.active_apps || [];
    } catch {
      return [];
    }
  }, [empresa]);

  if (!activeApps.includes('pdv_estoque')) {
    return <Navigate to="/apps" replace />;
  }
  return <>{children}</>;
}

export function getFirstAllowedPath(user: AuthUser | null): string {
  if (!user) return "/login";
  const permissions = user.permissions || [];
  if (permissions.includes('*')) return "/home";
  
  const order = [
    '/home',
    '/boletim',
    '/lancamentos',
    '/contas',
    '/caixa',
    '/cartoes',
    '/pdv',
    '/apps/movimentacao-pdv',
    '/apps/ifood',
    '/dre',
    '/importacao',
    '/config',
    '/consultor',
    '/auditoria'
  ];
  
  for (const path of order) {
    if (hasPathPermission(path, user)) {
      return path;
    }
  }
  
  for (const path of Object.keys(PAGE_PERMISSIONS)) {
    if (hasPathPermission(path, user)) {
      return path;
    }
  }
  
  return "/login";
}

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
    return <Navigate to={getFirstAllowedPath(user)} replace />;
  }

  return children;
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
        const nextTabs = [{
          path: fallback,
          basePath: fallback.split('?')[0],
          label: PAGE_LABELS[fallback] || 'Visão Geral',
          iconName: PAGE_ICONS[fallback] || 'Home',
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
                  ? <Navigate to={isAuthenticated ? getFirstAllowedPath(user) : "/login"} replace />
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
                  <PdvEstoqueRoute>
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
                  </PdvEstoqueRoute>
                }
              />
              <Route
                path="/pdv/fechamento"
                element={
                  <PdvEstoqueRoute>
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
                  </PdvEstoqueRoute>
                }
              />
              <Route
                path="/pdv/importar"
                element={
                  <PdvEstoqueRoute>
                    <ProtectedRoute
                      requiredPermissions={[
                        'PDV_VER_TODAS_VENDAS',
                        'PDV_SER_VENDEDOR',
                        'PDV_REALIZAR_SANGRIA',
                        'PDV_CANCELAR_VENDA',
                        'PDV_CONCEDER_DESCONTO',
                      ]}
                    >
                      <ImportacaoPDV />
                    </ProtectedRoute>
                  </PdvEstoqueRoute>
                }
              />
              <Route
                path="/produtos"
                element={
                  <PdvEstoqueRoute>
                    <ProtectedRoute requiredPermissions={['PDV_VER_TODAS_VENDAS', 'PDV_SER_VENDEDOR']}>
                      <Produtos />
                    </ProtectedRoute>
                  </PdvEstoqueRoute>
                }
              />
              <Route path="/apps" element={<ProtectedRoute requiredPermissions={['page:configuracoes:view']}><Apps /></ProtectedRoute>} />
              <Route path="/apps/movimentacao-pdv" element={<ProtectedRoute requiredPermissions={['page:importacao:view']}><MovimentacaoPDV /></ProtectedRoute>} />
              <Route path="/apps/:tab" element={<ProtectedRoute requiredPermissions={['page:integracoes:view']}><Apps /></ProtectedRoute>} />
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