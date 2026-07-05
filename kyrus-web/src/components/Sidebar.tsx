import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle,
  Landmark, CreditCard, Settings,
  Briefcase, X, LineChart, FileText,
  Calculator, Table2, ShoppingBag,
  Banknote, Coins, History, Award,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { api } from '../services/api';

interface MenuItem {
  icon: typeof Home;
  label: string;
  path: string;
  category: 'geral' | 'financeiro' | 'vendas' | 'admin';
  requiredPermissions?: string[];
}

function hasAnyPermission(permissions: string[] | null | undefined, requiredPermissions?: string[]) {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  if (!permissions || permissions.length === 0) {
    return false;
  }
  if (permissions.includes('*')) {
    return true;
  }
  return requiredPermissions.some((permission) => permissions.includes(permission));
}

function isSuperConsultor(user: AuthUser | null) {
  return Boolean(user?.is_consultor && user.consultor_role === 'SUPER_CONSULTOR');
}

interface SidebarPanelProps {
  onNavigate?: () => void;
  showClose?: boolean;
  collapsed?: boolean;
}

function SidebarPanel({ onNavigate, showClose, collapsed }: SidebarPanelProps) {
  const storedUser = useAuthStore((state) => state.user);
  const [user, setUser] = useState<AuthUser | null>(storedUser);
  const location = useLocation();

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
  const superConsultor = isSuperConsultor(user);
  const permissions = user?.permissions || [];

  const baseMenuItems: MenuItem[] = [
    { icon: Home, label: 'Visão Geral', path: '/home', category: 'geral', requiredPermissions: ['page:home:view'] },
    { icon: BarChart2, label: 'Boletim', path: '/boletim', category: 'geral', requiredPermissions: ['page:boletim:view'] },
    
    // Financeiro
    { icon: Landmark, label: 'Contas Bancárias', path: '/contas', category: 'financeiro', requiredPermissions: ['page:contas:view'] },
    { icon: PlusCircle, label: 'Lançamentos', path: '/lancamentos', category: 'financeiro', requiredPermissions: ['page:lancamentos:view'] },
    { icon: Banknote, label: 'Caixa', path: '/caixa', category: 'financeiro', requiredPermissions: ['page:caixa:view'] },
    { icon: CreditCard, label: 'Cartões', path: '/cartoes', category: 'financeiro', requiredPermissions: ['page:cartoes:view'] },
    { icon: Coins, label: 'Conciliadora de Cartões', path: '/conciliacao-cartoes', category: 'financeiro', requiredPermissions: ['page:cartoes:view'] },
    { icon: Calculator, label: 'Orçamentos', path: '/orcamentos', category: 'financeiro', requiredPermissions: ['page:dre:view'] },
    { icon: Table2, label: 'Budget', path: '/budget', category: 'financeiro', requiredPermissions: ['page:dre:view'] },
    { icon: LineChart, label: 'DRE', path: '/dre', category: 'financeiro', requiredPermissions: ['page:dre:view'] },
    { icon: Award, label: 'Comissões e Metas', path: '/comissoes', category: 'financeiro', requiredPermissions: ['page:boletim:view'] },

    // Comercial / Vendas
    {
      icon: ShoppingBag,
      label: 'PDV',
      path: '/pdv',
      category: 'vendas',
      requiredPermissions: [
        'PDV_VER_TODAS_VENDAS',
        'PDV_SER_VENDEDOR',
        'PDV_REALIZAR_SANGRIA',
        'PDV_CANCELAR_VENDA',
        'PDV_CONCEDER_DESCONTO',
      ],
    },
    {
      icon: FileText,
      label: 'Importação NF-e',
      path: '/importacao_nfe',
      category: 'vendas',
      requiredPermissions: ['page:importacao_nfe:view', 'page:importacao:view'],
    },
    
    // Administração
    { icon: History, label: 'Auditoria', path: '/auditoria', category: 'admin', requiredPermissions: ['page:auditoria:view'] },
    { icon: Settings, label: 'Configurações', path: '/config', category: 'admin', requiredPermissions: ['page:configuracoes:view'] },
  ];

  const menuItems = [...baseMenuItems];
  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor', category: 'geral', requiredPermissions: ['page:consultor:view'] });
  }

  const menuItemsFiltered = menuItems.filter((item) => {
    if (item.path === '/pdv' && superConsultor) {
      return true;
    }
    return hasAnyPermission(permissions, item.requiredPermissions);
  });

  const geralItems = menuItemsFiltered.filter((item) => item.category === 'geral');

  const categories = [
    {
      id: 'financeiro',
      label: 'Financeiro',
      icon: Landmark,
      items: menuItemsFiltered.filter((item) => item.category === 'financeiro'),
    },
    {
      id: 'vendas',
      label: 'Comercial',
      icon: ShoppingBag,
      items: menuItemsFiltered.filter((item) => item.category === 'vendas'),
    },
    {
      id: 'admin',
      label: 'Administração',
      icon: Settings,
      items: menuItemsFiltered.filter((item) => item.category === 'admin'),
    },
  ].filter((cat) => cat.items.length > 0);

  // Estado local para categorias expandidas/colapsadas
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    const path = location.pathname;
    return {
      financeiro: ['/lancamentos', '/caixa', '/contas', '/cartoes', '/conciliacao-cartoes', '/dre', '/orcamentos', '/budget', '/comissoes'].some(p => path.startsWith(p)),
      vendas: ['/pdv', '/importacao_nfe'].some(p => path.startsWith(p)),
      admin: ['/auditoria', '/config'].some(p => path.startsWith(p)),
    };
  });

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  const renderNavLink = (item: MenuItem) => {
    return (
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
    );
  };

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

      <nav className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto ${collapsed ? 'space-y-1 px-2 py-2' : 'space-y-2 px-3 py-2'}`}>
        {/* Itens do grupo Geral */}
        <div className="space-y-1">
          {geralItems.map((item) => renderNavLink(item))}
        </div>

        {/* Categorias Colapsáveis */}
        {categories.map((cat) => {
          const isExpanded = expandedCategories[cat.id];
          return (
            <div key={cat.id} className="space-y-1">
              <button
                onClick={() => toggleCategory(cat.id)}
                title={collapsed ? cat.label : undefined}
                aria-label={cat.label}
                className={`
                  grid w-full items-center border px-2 py-2 text-sm font-medium transition-colors duration-150 group border-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-white
                  ${collapsed ? 'grid-cols-[2.1rem] justify-items-center rounded-lg' : 'grid-cols-[2.1rem_minmax(0,1fr)_auto] rounded-lg'}
                `}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${collapsed ? 'bg-slate-100/80 dark:bg-slate-800/70' : ''}`}>
                  <cat.icon size={16} strokeWidth={2.2} />
                </span>
                {!collapsed && (
                  <>
                    <span className="text-left truncate font-semibold">{cat.label}</span>
                    <ChevronRight
                      size={14}
                      className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </>
                )}
              </button>

              {/* Subitens */}
              {isExpanded && (
                <div className={`space-y-1 ${collapsed ? '' : 'ml-4 border-l border-slate-200/80 dark:border-slate-800/80 pl-3'}`}>
                  {cat.items.map((item) => renderNavLink(item))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

export function Sidebar({ collapsed, onMouseEnter, onMouseLeave }: { collapsed: boolean; onMouseEnter?: () => void; onMouseLeave?: () => void; }) {
  return (
    <aside className="relative z-40 hidden h-full min-h-0 w-[76px] shrink-0 overflow-visible md:flex">
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