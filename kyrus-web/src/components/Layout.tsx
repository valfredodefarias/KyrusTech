import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { AiAssistente } from './AiAssistente';
import { AssistentePageProvider, useAssistentePageContext } from './AssistentePageContext';
import { Sidebar, MobileSidebar } from './Sidebar';

function resolveAssistenteDefaults(pathname: string) {
  if (pathname.startsWith('/dashboard')) {
    return {
      tela: 'dashboard' as const,
      titulo: 'Assistente KyrusTECH',
      sugestoes: [
        'Analise este dashboard como meu consultor financeiro e empresarial.',
        'Explique o que esta puxando meu resultado e o que exige atencao imediata.',
        'Quais melhorias praticas devo priorizar agora?',
      ],
      contexto: {
        pagina: 'dashboard',
        modo_consultoria: 'financeira_empresarial',
      },
    };
  }

  if (pathname.startsWith('/lancamentos')) {
    return {
      tela: 'lancamentos' as const,
      titulo: 'Assistente KyrusTECH',
      sugestoes: [
        'O que os lancamentos desta tela mostram?',
        'Leia este comprovante e monte uma previa revisavel.',
        'Quais acoes melhoram meu caixa no curto prazo?',
      ],
      contexto: {
        pagina: 'lancamentos',
      },
    };
  }

  return {
    tela: 'geral' as const,
    titulo: 'Assistente KyrusTECH',
    sugestoes: [
      'Explique esta pagina de forma objetiva.',
      'Quais riscos e oportunidades voce enxerga aqui?',
      'O que devo fazer primeiro para melhorar o resultado?',
    ],
    contexto: {
      pagina: pathname.replace(/^\//, '') || 'home',
    },
  };
}

function LayoutShell() {
  const location = useLocation();
  const { config: pageAssistenteConfig } = useAssistentePageContext();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') !== '0');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'light');
  const sidebarHoverTimerRef = useRef<number | null>(null);
  const isLancamentosRoute = location.pathname.startsWith('/lancamentos');
  const assistenteDefaults = useMemo(() => resolveAssistenteDefaults(location.pathname), [location.pathname]);
  const assistenteConfig = useMemo(() => ({
    tela: pageAssistenteConfig.tela ?? assistenteDefaults.tela,
    titulo: pageAssistenteConfig.titulo ?? assistenteDefaults.titulo,
    sugestoes: pageAssistenteConfig.sugestoes ?? assistenteDefaults.sugestoes,
    lookups: pageAssistenteConfig.lookups,
    contexto: {
      ...assistenteDefaults.contexto,
      ...(pageAssistenteConfig.contexto ?? {}),
      rota_atual: location.pathname,
    },
  }), [assistenteDefaults, location.pathname, pageAssistenteConfig]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new Event('theme-change'));
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleSidebarCommand = (event: Event) => {
      const customEvent = event as CustomEvent<{ collapsed?: boolean }>;
      if (typeof customEvent.detail?.collapsed === 'boolean') {
        setSidebarCollapsed(customEvent.detail.collapsed);
        return;
      }
      setSidebarCollapsed((prev) => !prev);
    };

    window.addEventListener('kyrus:sidebar-toggle', handleSidebarCommand as EventListener);
    return () => window.removeEventListener('kyrus:sidebar-toggle', handleSidebarCommand as EventListener);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 1024) return;
    setSidebarCollapsed(true);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (sidebarHoverTimerRef.current) {
        window.clearTimeout(sidebarHoverTimerRef.current);
      }
    };
  }, []);

  const handleSidebarMouseEnter = () => {
    if (!sidebarCollapsed) return;
    if (sidebarHoverTimerRef.current) {
      window.clearTimeout(sidebarHoverTimerRef.current);
    }
    setSidebarCollapsed(false);
  };

  const handleSidebarMouseLeave = () => {
    if (sidebarHoverTimerRef.current) {
      window.clearTimeout(sidebarHoverTimerRef.current);
      sidebarHoverTimerRef.current = null;
    }
    setSidebarCollapsed(true);
  };

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        theme={theme}
        onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
      />
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} theme={theme} onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="md:hidden sticky top-0 z-20 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 transition"
            aria-label="Abrir menu"
          >
            <Menu size={20} />
          </button>
          <div className="font-extrabold text-slate-800 dark:text-white tracking-tight">
            Kyrus<span className="text-blue-600">TECH</span>
          </div>
          <div className="w-8" />
        </header>
        {/* 'Outlet' é onde a página (Home, Dashboard) vai aparecer */}
        <main className={isLancamentosRoute ? 'flex-1 overflow-y-auto p-0' : 'flex-1 overflow-y-auto p-4 md:p-8'}>
          <Outlet />
        </main>
      </div>
      </div>
      <AiAssistente
        tela={assistenteConfig.tela}
        contexto={assistenteConfig.contexto}
        titulo={assistenteConfig.titulo}
        sugestoes={assistenteConfig.sugestoes}
        lookups={assistenteConfig.lookups}
      />
    </div>
  );
}

export function Layout() {
  return (
    <AssistentePageProvider>
      <LayoutShell />
    </AssistentePageProvider>
  );
}