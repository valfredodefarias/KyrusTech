import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle,
  Landmark, CreditCard, Settings,
  Briefcase, X, LineChart, FileText,
} from 'lucide-react';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { api } from '../services/api';

interface MenuItem {
  icon: typeof Home;
  label: string;
  path: string;
  requiredPermissions?: string[];
}

function hasAnyPermission(permissions: string[] | null | undefined, requiredPermissions?: string[]) {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  if (!permissions || permissions.length === 0) {
    return true;
  }
  if (permissions.includes('*')) {
    return true;
  }
  return requiredPermissions.some((permission) => permissions.includes(permission));
}

interface SidebarPanelProps {
  onNavigate?: () => void;
  showClose?: boolean;
  collapsed?: boolean;
}

function SidebarPanel({ onNavigate, showClose, collapsed }: SidebarPanelProps) {
  const storedUser = useAuthStore((state) => state.user);
  const [user, setUser] = useState<AuthUser | null>(storedUser);

  useEffect(() => {
    setUser(storedUser);
  }, [storedUser]);

  useEffect(() => {
    let active = true;

    api.get<AuthUser>('/usuarios/me')
      .then(({ data }) => {
        if (active) {
          setUser(data);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const isConsultor = Boolean(user?.is_consultor);
  const permissions = user?.permissions || [];

  const baseMenuItems: MenuItem[] = [
    { icon: Home, label: 'Visão Geral', path: '/home' },
    { icon: Landmark, label: 'Contas Bancárias', path: '/contas' },
    { icon: PlusCircle, label: 'Lançamentos', path: '/lancamentos' },
    { icon: BarChart2, label: 'Boletim', path: '/boletim' },
    { icon: CreditCard, label: 'Cartões', path: '/cartoes' },
    {
      icon: FileText,
      label: 'Importação NF-e',
      path: '/importacao_nfe',
      requiredPermissions: ['page:importacao_nfe:view', 'page:importacao:view'],
    },
    { icon: LineChart, label: 'DRE', path: '/dre' },
    { icon: Settings, label: 'Configurações', path: '/config' },
  ];

  const menuItems = [...baseMenuItems];
  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor' });
  }

  const menuItemsFiltered = menuItems.filter((item) => hasAnyPermission(permissions, item.requiredPermissions));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showClose ? (
        <div className="flex items-center justify-end px-3 pt-2">
          <button
            onClick={onNavigate}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            aria-label="Fechar menu"
          >
            <X size={17} />
          </button>
        </div>
      ) : null}

      <nav className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto ${collapsed ? 'space-y-1 px-2 py-2' : 'space-y-1 px-3 py-2'}`}>
        {menuItemsFiltered.map((item) => (
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
                backgroundColor: 'color-mix(in srgb, var(--color-primary, #2563eb) 14%, transparent)',
                color: 'var(--color-primary, #2563eb)',
                borderColor: 'color-mix(in srgb, var(--color-primary, #2563eb) 28%, transparent)',
              };
            }}
            className={({ isActive }) => `
              grid w-full items-center border px-2 py-2 text-sm font-medium transition-colors duration-150 group
              ${collapsed ? 'grid-cols-[2.1rem] justify-items-center rounded-lg' : 'grid-cols-[2.1rem_minmax(0,1fr)] rounded-lg'}
              ${isActive
                ? 'shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]'
                : 'border-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-white'}
            `}
          >
            {({ isActive }) => {
              const iconStyle = isActive
                ? {
                    backgroundColor: 'color-mix(in srgb, var(--color-primary, #2563eb) 16%, transparent)',
                    color: 'var(--color-primary, #2563eb)',
                  }
                : undefined;

              return (
                <>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${collapsed ? 'bg-slate-100/80 dark:bg-slate-800/70' : ''}`}
                    style={iconStyle}
                  >
                    <item.icon
                      size={16}
                      strokeWidth={2.2}
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
    </div>
  );
}

export function Sidebar({ collapsed, onMouseEnter, onMouseLeave }: { collapsed: boolean; onMouseEnter?: () => void; onMouseLeave?: () => void; }) {
  return (
    <aside className="relative hidden h-full min-h-0 w-[76px] shrink-0 overflow-visible md:flex">
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`${collapsed ? 'w-[76px]' : 'w-[232px]'} absolute inset-y-0 left-0 z-30 min-h-0 overflow-hidden border-r border-slate-200/80 bg-slate-50/90 shadow-sm transition-[width] duration-200 dark:border-slate-700/80 dark:bg-slate-900/80`}
      >
        <SidebarPanel collapsed={collapsed} />
      </div>
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void; }) {
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute left-0 top-0 h-full w-72 border-r border-slate-200 bg-white shadow-xl transition-transform dark:border-slate-700 dark:bg-slate-900 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarPanel onNavigate={onClose} showClose collapsed={false} />
      </aside>
    </div>
  );
}