import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import type { JSX } from 'react';

// Components & Store
import { Layout } from './components/Layout';
import { api } from './services/api';
import { useAuthStore } from './store/authStore';

const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const Home = lazy(() => import('./pages/Home').then((module) => ({ default: module.Home })));
const Boletim = lazy(() => import('./pages/Boletim').then((module) => ({ default: module.Boletim })));
const Dre = lazy(() => import('./pages/Dre').then((module) => ({ default: module.Dre })));
const Consultor = lazy(() => import('./pages/Consultor').then((module) => ({ default: module.Consultor })));
const CentroCusto = lazy(() => import('./pages/CentroCusto').then((module) => ({ default: module.CentroCusto })));
const Contas = lazy(() => import('./pages/Contas').then((module) => ({ default: module.Contas })));
const Importacao = lazy(() => import('./pages/Importacao').then((module) => ({ default: module.Importacao })));
const ImportacaoEntidades = lazy(() => import('./pages/ImportacaoEntidades').then((module) => ({ default: module.ImportacaoEntidades })));
const Lancamentos = lazy(() => import('./pages/Lancamentos').then((module) => ({ default: module.Lancamentos })));
const Entidades = lazy(() => import('./pages/Entidades').then((module) => ({ default: module.Entidades })));
const Cartoes = lazy(() => import('./pages/Cartoes').then((module) => ({ default: module.Cartoes })));
const Configuracoes = lazy(() => import('./pages/Configuracoes').then((module) => ({ default: module.Configuracoes })));
const Auditoria = lazy(() => import('./pages/Auditoria').then((module) => ({ default: module.Auditoria })));
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

function App() {
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    let active = true;

    api.get('/usuarios/me')
      .then(({ data }) => {
        if (active) {
          setAuthenticated(true);
          setUser(data);
        }
      })
      .catch(() => {
        if (active) {
          setAuthenticated(false);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) {
          setInitialized(true);
        }
      });

    return () => {
      active = false;
    };
  }, [setAuthenticated, setInitialized]);

  return (
    <BrowserRouter>
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
            <Route path="/home" element={<Home />} />
            <Route path="/boletim" element={<Boletim />} />
            <Route path="/dre" element={<Dre />} />
            <Route path="/consultor" element={<Consultor />} />
            <Route path="/lancamentos" element={<Lancamentos />} />
            <Route path="/entidades" element={<Entidades />} />
            <Route path="/contas" element={<Contas />} />
            <Route path="/cartoes" element={<Cartoes />} />
            <Route path="/centro-custo" element={<CentroCusto />} />
            <Route path="/config" element={<Configuracoes />} />
            <Route path="/importacao" element={<Importacao />} />
            <Route path="/importacao_interessados" element={<ImportacaoEntidades />} />
            <Route path="/importacao_ofx" element={<ImportacaoOfx />} />
            <Route path="/importacao_nfe" element={<ImportacaoNfe />} />
            <Route path="/auditoria" element={<Auditoria />} />
            <Route path="/integracoes" element={<Navigate to="/integracoes/asaas" replace />} />
            <Route path="/integracoes/asaas" element={<IntegracaoAsaas />} />
          </Route>

          <Route path="*" element={<Navigate to="/boletim" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;