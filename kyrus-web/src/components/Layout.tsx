import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { AiAssistente } from './AiAssistente';
import { AssistentePageProvider, useAssistentePageContext } from './AssistentePageContext';
import { Sidebar, MobileSidebar } from './Sidebar';
import { api, toPublicAssetUrl } from '../services/api';
import { useAuthStore, type AuthUser } from '../store/authStore';

interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  logo_url?: string | null;
  cor_primaria?: string;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

function resolveAssistenteDefaults(pathname: string) {
  if (pathname.startsWith('/boletim')) {
    return {
      tela: 'dashboard' as const,
      titulo: 'Assistente KyrusTECH',
      sugestoes: [
        'Resuma o que este boletim mostra de forma objetiva.',
        'Quais movimentos exigem atenção imediata nesta semana?',
        'O que mais está pressionando o caixa agora?',
      ],
      contexto: {
        pagina: 'boletim',
        modo_consultoria: 'financeira_empresarial',
      },
    };
  }

  if (pathname.startsWith('/dre')) {
    return {
      tela: 'dashboard' as const,
      titulo: 'Assistente KyrusTECH',
      sugestoes: [
        'Resuma a DRE deste mês em linguagem de gestão.',
        'Quais despesas mais comprimem minha margem?',
        'Quais ações posso tomar para melhorar o resultado no próximo mês?',
      ],
      contexto: {
        pagina: 'dre',
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

function getInitials(text: string) {
  const normalized = String(text || '').trim();
  if (!normalized) return 'US';
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function resolveUserName(user: AuthUser | null) {
  if (!user) return 'Usuário';
  if (user.nome && user.nome.trim()) return user.nome.trim();
  if (user.email) return user.email.split('@')[0];
  return 'Usuário';
}

function LayoutShell() {
  const location = useLocation();
  const { config: pageAssistenteConfig } = useAssistentePageContext();
  const logout = useAuthStore((state) => state.logout);
  const storedUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'light');
  const [headerUser, setHeaderUser] = useState<AuthUser | null>(storedUser);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const isBoletimEmbedMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('embed_boletim') === '1';
  }, [location.search]);
  const assistenteDefaults = useMemo(() => resolveAssistenteDefaults(location.pathname), [location.pathname]);
  const assistenteTriggerPlacement = location.pathname.startsWith('/boletim') ? 'left' as const : 'right' as const;
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
    setHeaderUser(storedUser);
  }, [storedUser]);

  useEffect(() => {
    let active = true;

    async function loadHeaderContext() {
      try {
        let currentUser = storedUser;

        if (!currentUser) {
          const { data } = await api.get<AuthUser>('/usuarios/me');
          if (!active) return;
          currentUser = data;
          setHeaderUser(data);
          setUser(data);
        }

        if (!currentUser || !active) {
          return;
        }

        let empresaAtual: EmpresaInfo | null = null;

        if (currentUser.empresa_id) {
          try {
            const { data } = await api.get<EmpresaInfo>(`/empresas/${currentUser.empresa_id}`);
            empresaAtual = data;
          } catch {
            empresaAtual = null;
          }
        }

        if (!empresaAtual && currentUser.is_consultor) {
          try {
            const { data } = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
            empresaAtual = data.empresa_atual;
          } catch {
            empresaAtual = null;
          }
        }

        if (!active) return;

        setEmpresa(empresaAtual);
        document.documentElement.style.setProperty('--color-primary', empresaAtual?.cor_primaria || '#2563eb');
        window.dispatchEvent(new Event('kyrus:primary-color-changed'));
      } catch {
        if (!active) return;
        setEmpresa(null);
      }
    }

    void loadHeaderContext();

    return () => {
      active = false;
    };
  }, [storedUser, setUser]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
    window.dispatchEvent(new Event('theme-change'));
  }, [theme]);

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

  const handleSidebarMouseEnter = () => {
    setSidebarCollapsed((prev) => (prev ? false : prev));
  };

  const handleSidebarMouseLeave = () => {
    setSidebarCollapsed((prev) => (prev ? prev : true));
  };

  const companyName = empresa?.nome_fantasia || 'Empresa não selecionada';
  const companyLogo = toPublicAssetUrl(empresa?.logo_url || undefined);
  const userName = resolveUserName(headerUser);
  const userAvatar = toPublicAssetUrl(headerUser?.foto_url || undefined);
  const userEmail = headerUser?.email || '';
  const themeLabel = theme === 'dark' ? 'Tema Claro' : 'Tema Escuro';

  const handleLogout = () => {
    api.post('/auth/logout').catch(() => undefined).finally(() => {
      logout();
      window.location.href = '/';
    });
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  if (isBoletimEmbedMode) {
    return (
      <div className={`kyrus-shell ${theme === 'dark' ? 'dark' : ''}`}>
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200">
          <main className="h-screen overflow-y-auto p-0">
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`kyrus-shell ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="flex h-screen flex-col overflow-hidden bg-slate-100/90 font-sans text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        <header className="sticky top-0 z-20 border-b border-slate-200/85 bg-white/92 backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/92">
          <div className="flex h-[66px] w-full items-center justify-between gap-3 px-3 sm:px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 md:hidden"
                aria-label="Abrir menu"
              >
                <Menu size={18} />
              </button>

              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {companyLogo ? (
                    <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold">{getInitials(companyName)}</span>
                  )}
                </div>

                <div className="min-w-0 leading-tight">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Empresa ativa</p>
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{companyName}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                title={themeLabel}
                aria-label={themeLabel}
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                <span className="hidden lg:inline">{themeLabel}</span>
              </button>

              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-100">
                  {userAvatar ? (
                    <img src={userAvatar} alt={userName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold">{getInitials(userName)}</span>
                  )}
                </div>
                <div className="hidden min-w-0 lg:block">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{userName}</p>
                  <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{userEmail}</p>
                </div>
              </div>

              <button
                onClick={handleLogout}
                title="Sair do Sistema"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40"
                aria-label="Sair do Sistema"
              >
                <LogOut size={15} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </header>
        <div className="flex h-[calc(100vh-66px)] min-h-0 overflow-hidden">
          <Sidebar
            collapsed={sidebarCollapsed}
            onMouseEnter={handleSidebarMouseEnter}
            onMouseLeave={handleSidebarMouseLeave}
          />
          <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
          <main className="min-w-0 flex-1 overflow-y-auto p-0">
            <div className="min-h-full w-full">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <AiAssistente
        tela={assistenteConfig.tela}
        contexto={assistenteConfig.contexto}
        titulo={assistenteConfig.titulo}
        sugestoes={assistenteConfig.sugestoes}
        lookups={assistenteConfig.lookups}
        triggerPlacement={assistenteTriggerPlacement}
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