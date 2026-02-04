import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { JSX } from 'react';

// Pages
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Consultor } from './pages/Consultor';  
import { Tarefas } from './pages/Tarefas';
import { CentroCusto } from './pages/CentroCusto';
import { Contas } from './pages/Contas';
import { Importacao } from './pages/Importacao';
import { Lancamentos } from './pages/Lancamentos';
import { Entidades } from './pages/Entidades';
import { Cartoes } from './pages/Cartoes';
import { Configuracoes } from './pages/Configuracoes'; // <--- NOVO IMPORT
import { Auditoria } from './pages/Auditoria';
import { IntegracaoAsaas } from './pages/IntegracaoAsaas';

// Components & Store
import { Layout } from './components/Layout';
import { useAuthStore } from './store/authStore';

function PrivateRoute({ children }: { children: JSX.Element }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  return isAuthenticated ? children : <Navigate to="/" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota Pública */}
        <Route path="/" element={<Login />} />
        
        {/* Rotas Protegidas */}
        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route path="/home" element={<Home />} />
          <Route path="/consultor" element={<Consultor />} />
          <Route path="/tarefas" element={<Tarefas />} />
          
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/entidades" element={<Entidades />} />
          
          {/* Financeiro / Cadastros */}
          <Route path="/contas" element={<Contas />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="/centro-custo" element={<CentroCusto />} />
          
          {/* Sistema */}
          <Route path="/config" element={<Configuracoes />} /> {/* <--- NOVA ROTA */}
          <Route path="/importacao" element={<Importacao />} /> {/* Mantido para acesso direto se precisar */}
          
          {/* Placeholder para Dashboard */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="/integracoes" element={<Navigate to="/integracoes/asaas" replace />} />
          <Route path="/integracoes/asaas" element={<IntegracaoAsaas />} />
        </Route>

        {/* Fallback: Qualquer rota desconhecida vai para Home */}
        <Route path="*" element={<Navigate to="/home" replace />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;