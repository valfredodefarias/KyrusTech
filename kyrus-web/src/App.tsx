import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { JSX } from 'react';

// Pages
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Consultor } from './pages/Consultor';  
import { CentroCusto } from './pages/CentroCusto';
import { Contas } from './pages/Contas';
import { Importacao } from './pages/Importacao';
import { Lancamentos } from './pages/Lancamentos';
import { Entidades } from './pages/Entidades';
import { Cartoes } from './pages/Cartoes';

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
          <Route path="/contas" element={<Contas />} />
          <Route path="/centro-custo" element={<CentroCusto />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/importacao" element={<Importacao />} />
          <Route path="/entidades" element={<Entidades />} />
          <Route path="/cartoes" element={<Cartoes />} />
          
          {/* Placeholder para Dashboard (ainda não criamos) */}
          <Route path="/dashboard" element={<div>Em breve: Dashboard</div>} />
        </Route>

        {/* Fallback: Qualquer rota desconhecida vai para Home */}
        <Route path="*" element={<Navigate to="/home" replace />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;