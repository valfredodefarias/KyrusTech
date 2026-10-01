// kyrus-web/src/pages/Developers/components/Topbar.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Moon,
  Sun,
  Menu,
  X,
  LogIn,
  BookOpen,
  Code2,
  GitBranch,
  ArrowLeft,
} from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';

interface TopbarProps {
  onOpenSearch: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeView: 'guides' | 'reference' | 'changelog';
  onSelectView: (view: 'guides' | 'reference' | 'changelog') => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  onOpenSearch,
  isSidebarOpen,
  onToggleSidebar,
  activeView,
  onSelectView,
}) => {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state: any) => state.isAuthenticated ? state.isAuthenticated() : false);
  const user = useAuthStore((state: any) => state.user);

  const [isDark, setIsDark] = React.useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle('dark', nextDark);
    try {
      localStorage.setItem('theme', nextDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
      {/* Lado Esquerdo: Logo & Navegação Principal */}
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900"
          aria-label="Abrir menu lateral"
        >
          {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Marca Kyrus */}
        <div
          onClick={() => navigate('/developers')}
          className="flex items-center gap-2.5 cursor-pointer select-none"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-700 to-blue-500 flex items-center justify-center shadow-md shadow-blue-500/20 text-white font-black text-base">
            K
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
              Kyrus
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Developers
            </span>
          </div>
        </div>

        {/* Abas Superiores no padrão Asaas */}
        <nav className="hidden md:flex items-center gap-1 ml-4 border-l border-slate-200 dark:border-slate-800 pl-4">
          <button
            type="button"
            onClick={() => onSelectView('guides')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeView === 'guides'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Guias</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('reference')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeView === 'reference'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Referência da API</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectView('changelog')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeView === 'changelog'
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Changelog</span>
          </button>
        </nav>
      </div>

      {/* Lado Direito: Busca, Tema e Login / Retorno */}
      <div className="flex items-center gap-3">
        {/* Campo de Busca Rápida (Ctrl+K) */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex items-center gap-3 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs transition shadow-sm"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Buscar na documentação...</span>
          <span className="sm:hidden">Buscar</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-500 shadow-2xs">
            Ctrl+K
          </kbd>
        </button>

        {/* Toggle Tema Claro / Escuro */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900 transition"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Botão Entrar ou Voltar ao App */}
        {isAuthenticated ? (
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-3.5 py-1.5 text-xs font-bold hover:bg-slate-800 dark:hover:bg-white transition shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Voltar ao App</span>
            <span className="sm:hidden">App</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white px-3.5 py-1.5 text-xs font-bold hover:bg-blue-500 transition shadow-sm"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Entrar</span>
          </button>
        )}
      </div>
    </header>
  );
};
