import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle, Clock3, LogOut, Menu, Moon, RefreshCw, Sun } from 'lucide-react';
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
  const logout = useAuthStore((state) => state.logout);
  const storedUser = useAuthStore((state) => state.user);
  const sessionExpiresAt = useAuthStore((state) => state.sessionExpiresAt);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);
  const setUser = useAuthStore((state) => state.setUser);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'light');
  const [headerUser, setHeaderUser] = useState<AuthUser | null>(storedUser);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [renewingSession, setRenewingSession] = useState(false);
  const isBoletimEmbedMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('embed_boletim') === '1';
  }, [location.search]);

  const sessionExpiresAtMs = useMemo(() => {
    if (!sessionExpiresAt) return null;
    const parsed = Date.parse(sessionExpiresAt);
    return Number.isNaN(parsed) ? null : parsed;
  }, [sessionExpiresAt]);

  const sessionRemainingMs = sessionExpiresAtMs ? sessionExpiresAtMs - now : null;
  const sessionWarningThresholdMs = 15 * 60 * 1000;
  const sessionStatus = sessionRemainingMs === null
    ? null
    : sessionRemainingMs <= 0
      ? 'expired'
      : sessionRemainingMs <= sessionWarningThresholdMs
        ? 'warning'
        : null;

  function formatRemainingTime(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes.toString().padStart(2, '0')}m`;
    }

    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }

  useEffect(() => {
    setHeaderUser(storedUser);
  }, [storedUser]);

  useEffect(() => {
    if (!sessionExpiresAt) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);

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
      window.location.href = '/login';
    });
  };

  const handleRenewSession = async () => {
    setRenewingSession(true);
    try {
      const { data } = await api.post<{ expires_in_minutes: number; expires_at: string }>('/auth/refresh');
      setSessionExpiresAt(data.expires_at);
      setNow(Date.now());
    } catch (error) {
      console.error(error);
      logout();
      window.location.href = '/login';
    } finally {
      setRenewingSession(false);
    }
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
        {sessionStatus && (
          <div className={`mx-3 mt-3 rounded-2xl border px-4 py-3 shadow-sm sm:mx-4 md:mx-6 ${sessionStatus === 'expired' ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100' : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100'}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${sessionStatus === 'expired' ? 'bg-rose-100 dark:bg-rose-900/50' : 'bg-amber-100 dark:bg-amber-900/50'}`}>
                  {sessionStatus === 'expired' ? <AlertTriangle className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {sessionStatus === 'expired'
                      ? 'Sua sessão expirou.'
                      : `Sua sessão expira em ${formatRemainingTime(sessionRemainingMs ?? 0)}.`}
                  </p>
                  <p className="text-xs leading-5 opacity-90">
                    {sessionStatus === 'expired'
                      ? 'Entre novamente para continuar sem perder o contexto.'
                      : 'Renove agora para continuar trabalhando sem interrupção.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleRenewSession()}
                disabled={renewingSession}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-70 ${sessionStatus === 'expired' ? 'bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500' : 'bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400'}`}
              >
                {renewingSession ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {sessionStatus === 'expired' ? 'Entrar novamente' : 'Renovar sessão'}
              </button>
            </div>
          </div>
        )}
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
    </div>
  );
}

export function Layout() {
  return <LayoutShell />;
}