import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle, Users, 
  Landmark, CreditCard, Settings, LogOut,
  Briefcase, X,
  ChevronsLeft, ChevronsRight, Sun, Moon
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

// --- TIPAGEM ---
interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  logo_url?: string;
  cor_primaria?: string;
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

function SidebarPanel({ onNavigate, showClose, collapsed, onToggleCollapse, theme, onToggleTheme }: SidebarPanelProps) {
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

        if (user.empresa_id) {
          const { data: emp } = await api.get(`/empresas/${user.empresa_id}`);
          setEmpresa(emp);
          
          // Aplica a cor da empresa em todo o sistema
          if(emp.cor_primaria) {
             document.documentElement.style.setProperty('--color-primary', emp.cor_primaria);
          }
        } else if (user.is_consultor) {
          const { data } = await api.get<ConsultorContextoResponse>('/consultor/meu-contexto');
          setEmpresa(data.empresa_atual);

          if (data.empresa_atual?.cor_primaria) {
            document.documentElement.style.setProperty('--color-primary', data.empresa_atual.cor_primaria);
          }
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
    { icon: BarChart2, label: 'Dashboard', path: '/dashboard' },
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
    if (url.startsWith('/static')) {
        const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
        return `${baseURL}${url}`;
    }
    return url;
  };

  const logoSrc = getLogoUrl(empresa?.logo_url);
  const userFotoSrc = getLogoUrl(user?.foto_url || undefined);
  const companyTitle = empresa?.nome_fantasia || 'KyrusTECH';

  const handleLogout = () => {
    logout();
    onNavigate?.();
  };

  return (
    <>
      {/* --- HEADER DA EMPRESA --- */}
      <div className="relative flex min-h-36 w-full flex-col items-center justify-center gap-2.5 border-b border-slate-100 p-4 text-center transition-all duration-300 dark:border-slate-700">
        {showClose && (
          <button
            onClick={onNavigate}
            className="absolute right-4 top-4 p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        )}
        {!showClose && (
          <button
            onClick={onToggleCollapse}
            className={`absolute top-3 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition ${collapsed ? 'right-1/2 translate-x-1/2' : 'right-4'}`}
            aria-label="Recolher menu"
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        )}
        
        {/* LOGO EM BOLINHA (CROPADA PERFEITA) */}
        <div className={`${collapsed ? 'mt-5 h-11 w-11' : 'h-15 w-15'} rounded-full bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border-4 border-slate-100 dark:border-slate-600 shadow-md shrink-0 transition-all duration-300`}>
            {logoSrc ? (
              <img 
                src={logoSrc} 
                alt={empresa?.nome_fantasia} 
                className="w-full h-full object-cover" // <--- SEGredo: Preenche todo o círculo
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              // Fallback: Iniciais do nome
              <img
                src="/kyrus.png"
                alt="Logo Kyrus"
                className="w-full h-full object-contain p-2 bg-slate-50 dark:bg-slate-800"
              />
            )}
        </div>

        {/* NOME DA EMPRESA */}
        <div className={`w-full px-2 transition-all duration-300 ${collapsed ? 'invisible h-11' : 'visible h-11'}`} aria-hidden={collapsed}>
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
      <nav className={`flex-1 overflow-y-auto custom-scrollbar mt-1 ${collapsed ? 'px-2 py-2 space-y-1.5' : 'p-3 space-y-1'}`}>
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            style={({ isActive }) => {
              if (!isActive) {
                return collapsed
                  ? { border: '1px solid transparent' }
                  : { borderRight: '3px solid transparent' };
              }

              if (collapsed) {
                return {
                  color: primaryColor,
                  border: '1px solid transparent',
                };
              }

              return {
                backgroundColor: `${primaryColor}15`,
                color: primaryColor,
                borderRight: `3px solid ${primaryColor}`,
              };
            }}
            className={({ isActive }) => `
              w-full grid items-center ${collapsed ? 'grid-cols-[2.25rem] justify-center justify-items-center px-2.5 rounded-2xl' : 'grid-cols-[2.25rem_minmax(0,1fr)] px-3 rounded-l-xl'} py-2.5 transition-all duration-300 font-medium text-sm group
              ${!isActive 
                ? collapsed
                  ? 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white hover:-translate-y-0.5'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white'
                : 'shadow-sm'}
            `}
          >
            {({ isActive }) => {
              const collapsedActiveStyle = collapsed && isActive
                ? {
                    backgroundColor: `${primaryColor}18`,
                    borderColor: `${primaryColor}66`,
                    boxShadow: `0 0 0 1px ${primaryColor}22 inset`,
                  }
                : undefined;

              return (
                <>
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all ${collapsed ? 'border-slate-200 bg-slate-50 shadow-sm dark:border-slate-700 dark:bg-slate-900/70' : 'border-transparent'} group-hover:border-slate-200 group-hover:bg-white/80 dark:group-hover:border-slate-600 dark:group-hover:bg-slate-800/80`}
                    style={collapsedActiveStyle}
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
    <aside onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={`${collapsed ? 'w-19' : 'w-60'} bg-[linear-gradient(180deg,#f8fbff_0%,#eef4ff_100%)] dark:bg-[linear-gradient(180deg,#0f172a_0%,#111c34_100%)] border-r border-slate-200/80 dark:border-slate-700 hidden md:flex flex-col h-screen sticky top-0 transition-all duration-300 z-30 shadow-sm overflow-hidden`}> 
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