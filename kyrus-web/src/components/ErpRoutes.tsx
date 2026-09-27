import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import type { JSX } from 'react';
import { useAuthStore } from '../store/authStore';
import { getFirstAllowedPath, hasPathPermission } from '../utils/routeRegistry';
import { KyrusLoadingScreen } from './KyrusLoadingScreen';

const Home = lazy(() => import('../pages/Home').then((module) => ({ default: module.Home })));
const Boletim = lazy(() => import('../pages/Boletim').then((module) => ({ default: module.Boletim })));
const Indicadores = lazy(() => import('../pages/Indicadores').then((module) => ({ default: module.Indicadores })));
const Compras = lazy(() => import('../pages/Compras').then((module) => ({ default: module.Compras })));
const Dre = lazy(() => import('../pages/Dre').then((module) => ({ default: module.Dre })));
const Consultor = lazy(() => import('../pages/Consultor').then((module) => ({ default: module.Consultor })));
const CentroCusto = lazy(() => import('../pages/CentroCusto').then((module) => ({ default: module.CentroCusto })));
const Contas = lazy(() => import('../pages/Contas').then((module) => ({ default: module.Contas })));
const Orcamentos = lazy(() => import('../pages/Orcamentos').then((module) => ({ default: module.Orcamentos })));
const Budget = lazy(() => import('../pages/Budget').then((module) => ({ default: module.Budget })));
const Importacao = lazy(() => import('../pages/Importacao').then((module) => ({ default: module.Importacao })));
const ImportacaoEntidades = lazy(() => import('../pages/ImportacaoEntidades').then((module) => ({ default: module.ImportacaoEntidades })));
const Lancamentos = lazy(() => import('../pages/Lancamentos').then((module) => ({ default: module.Lancamentos })));
const Cartoes = lazy(() => import('../pages/Cartoes').then((module) => ({ default: module.Cartoes })));
const ConciliacaoCartoes = lazy(() => import('../pages/ConciliacaoCartoes').then((module) => ({ default: module.ConciliacaoCartoes })));
const Pdv = lazy(() => import('../pages/PDV').then((module) => ({ default: module.PDV })));
const PdvFechamento = lazy(() => import('../pages/PDVFechamento').then((module) => ({ default: module.PDVFechamento })));
const Caixa = lazy(() => import('../pages/Caixa').then((module) => ({ default: module.Caixa })));
const Configuracoes = lazy(() => import('../pages/Configuracoes').then((module) => ({ default: module.Configuracoes })));
const Auditoria = lazy(() => import('../pages/Auditoria').then((module) => ({ default: module.Auditoria })));
const ComissoesDashboard = lazy(() => import('../pages/ComissoesDashboard').then((module) => ({ default: module.ComissoesDashboard })));
const IntegracaoAsaas = lazy(() => import('../pages/IntegracaoAsaas').then((module) => ({ default: module.IntegracaoAsaas })));
const AsaasApp = lazy(() => import('../pages/Asaas').then((module) => ({ default: module.AsaasApp })));
const ImportacaoOfx = lazy(() => import('../pages/ImportacaoOfx').then((module) => ({ default: module.ImportacaoOfx })));
const ImportacaoNfe = lazy(() => import('../pages/ImportacaoNfe').then((module) => ({ default: module.ImportacaoNfe })));
const ImportacaoPDV = lazy(() => import('../pages/ImportacaoPDV'));
const Produtos = lazy(() => import('../pages/Produtos'));
const Apps = lazy(() => import('../pages/Apps').then((module) => ({ default: module.Apps })));
const MovimentacaoPDV = lazy(() => import('../pages/MovimentacaoPDV').then((module) => ({ default: module.MovimentacaoPDV })));
const Entidades = lazy(() => import('../pages/Entidades').then((module) => ({ default: module.Entidades })));

function ProtectedRoute({ children, path }: { children: React.ReactNode, path: string }) {
  const user = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const initialized = useAuthStore((state) => state.initialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());

  if (!initialized) {
    return <KyrusLoadingScreen targetPath={path} />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasPathPermission(path, user, empresa)) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
        <div className="mb-4 rounded-full bg-rose-100 p-4 text-rose-500 dark:bg-rose-900/30">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="mb-2 text-xl font-bold text-slate-800 dark:text-slate-200">Acesso Restrito</h2>
        <p className="max-w-md">Você não possui permissão para acessar esta tela ou este módulo não está ativo para a sua empresa.</p>
      </div>
    );
  }

  try {
    const roles = (user as any)?.pdv_config ? JSON.parse((user as any).pdv_config) : [];
    if (roles && typeof roles === 'object' && roles.menus_liberados && Array.isArray(roles.menus_liberados)) {
      if (!roles.menus_liberados.includes(path)) {
        return (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500 dark:text-slate-400">
            <div className="mb-4 rounded-full bg-rose-100 p-4 text-rose-500 dark:bg-rose-900/30">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold text-slate-800 dark:text-slate-200">Acesso Restrito</h2>
            <p className="max-w-md">Você não possui permissão para acessar esta tela. Caso precise, solicite ao administrador do sistema.</p>
          </div>
        );
      }
    }
  } catch (e) {
    console.error("Erro ao parsear pdv_config em ProtectedRoute", e);
  }

  return <>{children}</>;
}

export function ErpRoutes({ customLocation }: { customLocation?: any }) {
  const user = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const fallbackPath = getFirstAllowedPath(user, empresa);

  return (
    <Suspense fallback={<KyrusLoadingScreen targetPath={customLocation?.pathname} />}>
      <Routes location={customLocation}>
        <Route path="/home" element={<ProtectedRoute path='/home'><Home /></ProtectedRoute>} />
        <Route path="/boletim" element={<ProtectedRoute path='/boletim'><Boletim /></ProtectedRoute>} />
        <Route path="/indicadores" element={<ProtectedRoute path='/indicadores'><Indicadores /></ProtectedRoute>} />
        <Route path="/compras" element={<ProtectedRoute path='/compras'><Compras /></ProtectedRoute>} />
        <Route path="/dre" element={<ProtectedRoute path='/dre'><Dre /></ProtectedRoute>} />
        <Route path="/consultor" element={<ProtectedRoute path='/consultor'><Consultor /></ProtectedRoute>} />
        <Route path="/lancamentos" element={<ProtectedRoute path='/lancamentos'><Lancamentos /></ProtectedRoute>} />
        <Route path="/contas" element={<ProtectedRoute path='/contas'><Contas /></ProtectedRoute>} />
        <Route path="/orcamentos" element={<ProtectedRoute path='/orcamentos'><Orcamentos /></ProtectedRoute>} />
        <Route path="/budget" element={<ProtectedRoute path='/budget'><Budget /></ProtectedRoute>} />
        <Route path="/cartoes" element={<ProtectedRoute path='/cartoes'><Cartoes /></ProtectedRoute>} />
        <Route path="/conciliacao-cartoes" element={<ProtectedRoute path='/conciliacao-cartoes'><ConciliacaoCartoes /></ProtectedRoute>} />
        <Route path="/entidades" element={<ProtectedRoute path='/entidades'><Entidades /></ProtectedRoute>} />
        <Route path="/entidades/clientes" element={<ProtectedRoute path='/entidades'><Entidades tipoDefault="cliente" /></ProtectedRoute>} />
        <Route path="/entidades/fornecedores" element={<ProtectedRoute path='/entidades'><Entidades tipoDefault="fornecedor" /></ProtectedRoute>} />
        <Route path="/produtos" element={<ProtectedRoute path='/produtos'><Produtos /></ProtectedRoute>} />
        <Route path="/apps" element={<ProtectedRoute path='/apps'><Apps /></ProtectedRoute>} />
        <Route path="/apps/ifood" element={<ProtectedRoute path='/apps/ifood'><Apps /></ProtectedRoute>} />
        <Route path="/apps/movimentacao-pdv" element={<ProtectedRoute path='/apps/movimentacao-pdv'><MovimentacaoPDV /></ProtectedRoute>} />
        <Route path="/apps/:tab" element={<ProtectedRoute path='/apps/:tab'><Apps /></ProtectedRoute>} />
        <Route path="/caixa" element={<ProtectedRoute path='/caixa'><Caixa /></ProtectedRoute>} />
        <Route path="/centro-custo" element={<ProtectedRoute path='/centro-custo'><CentroCusto /></ProtectedRoute>} />
        <Route path="/config" element={<ProtectedRoute path='/config'><Configuracoes /></ProtectedRoute>} />
        <Route path="/importacao" element={<ProtectedRoute path='/importacao'><Importacao /></ProtectedRoute>} />
        <Route path="/importacao_interessados" element={<ProtectedRoute path='/importacao_interessados'><ImportacaoEntidades /></ProtectedRoute>} />
        <Route path="/importacao_ofx" element={<ProtectedRoute path='/importacao_ofx'><ImportacaoOfx /></ProtectedRoute>} />
        <Route path="/importacao_nfe" element={<ProtectedRoute path='/importacao_nfe'><ImportacaoNfe /></ProtectedRoute>} />
        <Route path="/auditoria" element={<ProtectedRoute path='/auditoria'><Auditoria /></ProtectedRoute>} />
        <Route path="/comissoes" element={<ProtectedRoute path='/comissoes'><ComissoesDashboard /></ProtectedRoute>} />
        <Route path="/integracoes/asaas" element={<ProtectedRoute path='/integracoes/asaas'><IntegracaoAsaas /></ProtectedRoute>} />
        <Route path="/apps/asaas" element={<ProtectedRoute path='/apps/asaas'><AsaasApp /></ProtectedRoute>} />
        <Route path="/asaas" element={<Navigate to="/apps/asaas" replace />} />
        <Route path="/pdv" element={<ProtectedRoute path='/pdv'><Pdv /></ProtectedRoute>} />
        <Route path="/pdv/fechamento" element={<ProtectedRoute path='/pdv/fechamento'><PdvFechamento /></ProtectedRoute>} />
        <Route path="/pdv/importar" element={<ProtectedRoute path='/pdv/importar'><ImportacaoPDV /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to={fallbackPath} replace />} />
      </Routes>
    </Suspense>
  );
}