import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle, Users, 
  Landmark, CreditCard, Settings, LogOut,
  Briefcase, X, LineChart,
  Sun, Moon
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api, toPublicAssetUrl } from '../services/api';

// --- TIPAGEM ---
interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  logo_url?: string;
  cor_primaria?: string;
  is_active?: boolean;
}

interface UserInfo {
  is_consultor: boolean;
  empresa_id?: number | null;
  nome?: string | null;
  email?: string;
  foto_url?: string | null;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

interface SidebarPanelProps {
  onNavigate?: () => void;
  showClose?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

function SidebarPanel({ onNavigate, showClose, collapsed, theme, onToggleTheme }: SidebarPanelProps) {
  const logout = useAuthStore((state) => state.logout);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [isConsultor, setIsConsultor] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);

  // --- CARREGAMENTO DE DADOS ---
  useEffect(() => {
    async function loadData() {
      try {
        const { data: user } = await api.get<UserInfo>('/usuarios/me');
        setIsConsultor(user.is_consultor);
        setUser(user);

        let empresaAtual: EmpresaInfo | null = null;

        if (user.empresa_id) {
          try {
            const { data: emp } = await api.get<EmpresaInfo>(`/empresas/${user.empresa_id}`);
            empresaAtual = emp;
          } catch {
            empresaAtual = null;
          }
        }

        if (!empresaAtual && user.is_consultor) {
          const { data } = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
          empresaAtual = data.empresa_atual;
        }

        setEmpresa(empresaAtual);

        if (empresaAtual?.cor_primaria) {
          document.documentElement.style.setProperty('--color-primary', empresaAtual.cor_primaria);
        }
      } catch (error) {
        console.error("Erro ao carregar sidebar", error);
      }
    }
    loadData();
  }, []);

  // --- ESTRUTURA DO MENU ---
  const menuItems = [
    { icon: Home, label: 'Visão Geral', path: '/home' },
    { icon: BarChart2, label: 'Boletim', path: '/boletim' },
    { icon: LineChart, label: 'DRE', path: '/dre' },
    { icon: PlusCircle, label: 'Lançamentos', path: '/lancamentos' },
    { icon: Users, label: 'Interessados', path: '/entidades' },
    { icon: Landmark, label: 'Contas Bancárias', path: '/contas' },
    { icon: CreditCard, label: 'Cartões', path: '/cartoes' },
    { icon: Settings, label: 'Configurações', path: '/config' },
  ];

  // Adiciona menu de Consultor se for o caso
  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor' });
  }

  // Cor padrão se a empresa não tiver uma definida
  const primaryColor = empresa?.cor_primaria || '#2563eb'; 

  // Helper para montar a URL da imagem
  const getLogoUrl = (url?: string) => {
    if (!url) return undefined;
    return toPublicAssetUrl(url) || undefined;
  };

  const logoSrc = getLogoUrl(empresa?.logo_url);
  const userFotoSrc = getLogoUrl(user?.foto_url || undefined);
  const companyTitle = empresa?.nome_fantasia || 'KyrusTECH';

  const handleLogout = () => {
    api.post('/auth/logout').catch(() => undefined).finally(() => {
      logout();
      onNavigate?.();
      window.location.href = '/';
    });
  };

  return (
    <>
      {/* --- HEADER DA EMPRESA --- */}
      <div className={`relative flex w-full flex-col items-center justify-center gap-2.5 border-b border-slate-100 text-center transition-all duration-300 dark:border-slate-700 ${collapsed ? 'min-h-32 px-0 py-4' : 'min-h-36 p-4'}`}>
        {showClose && (
          <button
            onClick={onNavigate}
            className="absolute right-4 top-4 p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        )}
        
        {/* LOGO EM BOLINHA (CROPADA PERFEITA) */}
        <div className={`${collapsed ? 'mt-2 h-16 w-full -ml-8 justify-start' : 'h-16 w-16 justify-center'} flex items-center overflow-hidden shrink-0 transition-all duration-300`}>
          <div className="h-16 w-16 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border-4 border-slate-100 dark:border-slate-600 shadow-md shrink-0">
              {logoSrc ? (
                <img 
                  src={logoSrc} 
                  alt={empresa?.nome_fantasia} 
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <img
                  src="/kyrus.png"
                  alt="Logo Kyrus"
                  className="h-full w-full object-contain p-2 bg-slate-50 dark:bg-slate-800"
                />
              )}
          </div>
        </div>

        {/* NOME DA EMPRESA */}
        <div className={`w-full px-2 transition-all duration-300 ${collapsed ? 'invisible h-0 opacity-0' : 'visible h-11 opacity-100'}`} aria-hidden={collapsed}>
            {empresa?.nome_fantasia ? (
                <>
                    <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight truncate">
                {companyTitle}
                    </h1>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 block">
                        Gestão Financeira
                    </span>
                </>
            ) : (
                <img
                  src="/kyrusnamegg.png"
                  alt="KyrusTech"
              className="mx-auto h-6 w-auto"
                />
            )}
        </div>

      </div>

      {/* --- NAVEGAÇÃO --- */}
      <nav className={`flex-1 overflow-y-auto custom-scrollbar mt-1 ${collapsed ? 'pl-0 pr-2 py-2 space-y-1.5' : 'pl-0 pr-3 py-3 space-y-1'}`}>
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            style={({ isActive }) => {
              if (!isActive) {
                return undefined;
              }

              return {
                backgroundColor: `${primaryColor}15`,
                color: primaryColor,
              };
            }}
            className={({ isActive }) => `
              w-full grid items-center ${collapsed ? 'grid-cols-[2.25rem] justify-start justify-items-center pl-3 pr-2 rounded-r-2xl rounded-l-none' : 'grid-cols-[2.25rem_minmax(0,1fr)] pl-4 pr-3 rounded-r-2xl rounded-l-none'} py-2.5 transition-[background-color,color,transform] duration-200 font-medium text-sm group
              ${!isActive 
                ? collapsed
                  ? 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white hover:-translate-y-0.5'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                : ''}
            `}
          >
            {({ isActive }) => {
              const iconStyle = isActive
                ? { backgroundColor: `${primaryColor}18`, color: primaryColor }
                : undefined;

              return (
                <>
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${collapsed ? 'bg-slate-50 shadow-sm dark:bg-slate-900/70' : 'bg-transparent'} group-hover:bg-white/80 dark:group-hover:bg-slate-800/80`}
                    style={iconStyle}
                  >
                    <item.icon 
                        size={16} 
                        strokeWidth={2.35} 
                        className="transition-transform"
                    />
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              );
            }}
          </NavLink>
        ))}
      </nav>

      {/* --- FOOTER / SAIR --- */}
      <div className={`border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 transition-all duration-300 ${collapsed ? 'p-3' : 'p-4'}`}>
        {!collapsed ? (
          <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-xl bg-white/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
              {userFotoSrc ? (
                <img src={userFotoSrc} alt="Usuário" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-slate-500">
                  {(user?.nome || user?.email || 'U').substring(0,2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{user?.nome || user?.email || 'Usuário'}</p>
              <p className="text-[10px] text-slate-400 truncate">{user?.email || ''}</p>
            </div>
          </div>
        ) : (
          <div className="mb-3 flex justify-center">
            <div title={user?.nome || user?.email || 'Usuário'} className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
              {userFotoSrc ? (
                <img src={userFotoSrc} alt="Usuário" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-xs font-bold">
                  {(user?.nome || user?.email || 'U').substring(0, 2).toUpperCase()}
                </span>
              )}
            </div>
          </div>
        )}
        <button
          onClick={onToggleTheme}
          title={collapsed ? (theme === 'dark' ? 'Tema Claro' : 'Tema Escuro') : undefined}
          className={`grid items-center ${collapsed ? 'grid-cols-[2.25rem] px-2.5' : 'grid-cols-[2.25rem_minmax(0,1fr)] px-3'} py-2.5 w-full text-left text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors font-bold text-sm mb-2`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70">
            {theme === 'dark' ? <Sun size={16} strokeWidth={2.35} /> : <Moon size={16} strokeWidth={2.35} />}
          </span>
          {!collapsed && <span className="truncate">{theme === 'dark' ? 'Tema Claro' : 'Tema Escuro'}</span>}
        </button>
        <button 
            onClick={handleLogout} 
            title={collapsed ? 'Sair do Sistema' : undefined}
            className={`grid items-center ${collapsed ? 'grid-cols-[2.25rem] px-2.5' : 'grid-cols-[2.25rem_minmax(0,1fr)] px-3'} py-2.5 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors font-bold text-sm`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/30">
            <LogOut size={16} strokeWidth={2.35} />
          </span>
          {!collapsed && <span className="truncate">Sair do Sistema</span>}
        </button>
      </div>
    </>
  );
}

export function Sidebar({ collapsed, onToggleCollapse, onMouseEnter, onMouseLeave, theme, onToggleTheme }: { collapsed: boolean; onToggleCollapse: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void; theme: 'dark' | 'light'; onToggleTheme: () => void; }) {
  return (
    <aside onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={`${collapsed ? 'w-19' : 'w-60'} bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_100%)] dark:bg-[linear-gradient(180deg,#0f172a_0%,#111c34_100%)] border-r border-slate-200/80 dark:border-slate-700 hidden md:flex flex-col h-screen sticky top-0 transition-[width] duration-200 z-30 shadow-sm overflow-hidden`}> 
      <SidebarPanel collapsed={collapsed} onToggleCollapse={onToggleCollapse} theme={theme} onToggleTheme={onToggleTheme} />
    </aside>
  );
}

export function MobileSidebar({ open, onClose, theme, onToggleTheme }: { open: boolean; onClose: () => void; theme: 'dark' | 'light'; onToggleTheme: () => void; }) {
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute left-0 top-0 h-full w-72 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 shadow-xl transform transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarPanel onNavigate={onClose} showClose collapsed={false} theme={theme} onToggleTheme={onToggleTheme} />
      </aside>
    </div>
  );
}