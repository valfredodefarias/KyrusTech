import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle,
  Landmark, CreditCard, Settings,
  Briefcase, X, LineChart, FileText,
  Calculator, Table2, ShoppingBag,
  Banknote, Coins, History, Award,
  ChevronRight, Pin, Package, Puzzle, Utensils
} from 'lucide-react';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
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
  isDocked?: boolean;
  toggleDock?: () => void;
}

function SidebarPanel({ onNavigate, showClose, collapsed, isDocked, toggleDock }: SidebarPanelProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const { favorites } = useTabStore();

  const [activeApps, setActiveApps] = useState<string[]>([]);

  const fetchActiveApps = async () => {
    try {
      const response = await api.get('/pdv/config');
      if (response.data && Array.isArray(response.data.active_apps)) {
        setActiveApps(response.data.active_apps);
      }
    } catch (err) {
      console.error('Erro ao buscar aplicativos ativos:', err);
    }
  };

  useEffect(() => {
    void fetchActiveApps();

    const handleAppsChange = () => {
      void fetchActiveApps();
    };

    window.addEventListener('active-apps-changed', handleAppsChange);
    return () => {
      window.removeEventListener('active-apps-changed', handleAppsChange);
    };
  }, [user?.empresa_id]);

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
      icon: Package,
      label: 'Produtos e Estoque',
      path: '/produtos',
      category: 'vendas',
      requiredPermissions: ['PDV_VER_TODAS_VENDAS', 'PDV_SER_VENDEDOR'],
    },
    {
      icon: FileText,
      label: 'Importação NF-e',
      path: '/importacao_nfe',
      category: 'vendas',
      requiredPermissions: ['page:importacao_nfe:view'],
    },
    
    // Administração
    { icon: History, label: 'Auditoria', path: '/auditoria', category: 'admin', requiredPermissions: ['page:auditoria:view'] },
    { icon: Settings, label: 'Configurações', path: '/config', category: 'admin', requiredPermissions: ['page:configuracoes:view'] },
    { icon: Puzzle, label: 'Aplicativos', path: '/apps', category: 'admin', requiredPermissions: ['page:configuracoes:view'] },
  ];

  const menuItems = [...baseMenuItems];
  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor', category: 'geral', requiredPermissions: ['page:consultor:view'] });
  }
  
  // Filter baseMenuItems based on activeApps status
  let finalMenuItems = menuItems.filter((item) => {
    if (item.path === '/pdv' || item.path === '/produtos') {
      return activeApps.includes('pdv_estoque');
    }
    return true;
  });

  if (activeApps.includes('ifood')) {
    finalMenuItems.push({
      icon: Utensils,
      label: 'iFood PDV',
      path: '/apps/ifood',
      category: 'vendas',
      requiredPermissions: ['page:integracoes:view'],
    });
  }

  if (activeApps.includes('movimentacao_pdv')) {
    finalMenuItems.push({
      icon: Calculator,
      label: 'Movimentação PDV',
      path: '/apps/movimentacao-pdv',
      category: 'vendas',
      requiredPermissions: ['page:importacao:view'],
    });
  }

  const menuItemsFiltered = finalMenuItems.filter((item) => {
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
      vendas: ['/pdv', '/importacao_nfe', '/produtos', '/apps/ifood'].some(p => path.startsWith(p)),
      admin: ['/auditoria', '/config', '/apps'].some(p => {
        if (path.startsWith('/apps/ifood')) return false;
        return path.startsWith(p);
      }),
    };
  });

  useEffect(() => {
    if (collapsed) {
      setExpandedCategories({
        financeiro: false,
        vendas: false,
        admin: false,
      });
    } else {
      const path = location.pathname;
      setExpandedCategories({
        financeiro: ['/lancamentos', '/caixa', '/contas', '/cartoes', '/conciliacao-cartoes', '/dre', '/orcamentos', '/budget', '/comissoes'].some(p => path.startsWith(p)),
        vendas: ['/pdv', '/importacao_nfe', '/produtos', '/apps/ifood'].some(p => path.startsWith(p)),
        admin: ['/auditoria', '/config', '/apps'].some(p => {
          if (path.startsWith('/apps/ifood')) return false;
          return path.startsWith(p);
        }),
      });
    }
  }, [collapsed, location.pathname]);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  // Filtrar itens estrelados que existem no menu ativo
  const estreladosItems = menuItemsFiltered.filter((item) => favorites.includes(item.path));

  const renderNavLink = (item: MenuItem, isFavoriteItem = false) => {
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
            borderLeftColor: collapsed ? 'transparent' : 'var(--color-primary, #2563eb)',
            color: 'var(--color-primary, #2563eb)',
            backgroundColor: 'color-mix(in srgb, var(--color-primary, #2563eb) 8%, transparent)',
          };
        }}
        className={({ isActive }) => `
          relative flex w-full items-center py-1.5 transition-colors duration-150 group border-y-0 border-r-0
          ${collapsed ? 'px-0 border-l-0 justify-center h-9 w-9 rounded-md mx-auto' : 'border-l-2 rounded-r-md pl-3 gap-2.5'}
          ${isActive
            ? 'font-bold'
            : 'border-transparent text-slate-500 hover:bg-slate-100/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-white'}
        `}
      >
        {({ isActive }) => {
          return (
            <>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${collapsed && isActive ? 'bg-slate-200/50 dark:bg-slate-800/60' : ''}`}
              >
                {isFavoriteItem ? (
                  <span className="text-amber-500 text-xs shrink-0 flex items-center justify-center">★</span>
                ) : (
                  <item.icon
                    size={15}
                    strokeWidth={2}
                    className="transition-transform group-hover:scale-105"
                  />
                )}
              </span>
              {!collapsed && <span className="truncate text-xs">{item.label}</span>}
            </>
          );
        }}
      </NavLink>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col justify-between">
      <div className="flex-1 flex flex-col min-h-0">
        {showClose ? (
          <div className="flex items-center justify-end px-2 pt-2">
            <button
              onClick={onNavigate}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="Fechar menu"
            >
              <X size={16} />
            </button>
          </div>
        ) : null}

        <nav className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto ${collapsed ? 'space-y-0.5 px-1 py-2' : 'space-y-1 px-2 py-2'}`}>
          {/* Itens do grupo Geral */}
          <div className="space-y-0.5">
            {geralItems.map((item) => renderNavLink(item))}
          </div>

          {/* Seção Estrelados */}
          {!collapsed && estreladosItems.length > 0 && (
            <div className="pt-2 pb-1 border-t border-slate-100 dark:border-slate-800/40 my-2">
              <p className="px-3 text-[9px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 mb-1.5">Estrelados</p>
              <div className="space-y-0.5">
                {estreladosItems.map((item) => renderNavLink(item, true))}
              </div>
            </div>
          )}

          {/* Categorias Colapsáveis */}
          <div className="pt-1">
            {categories.map((cat) => {
              const isExpanded = expandedCategories[cat.id];
              return (
                <div key={cat.id} className="space-y-0.5">
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    title={collapsed ? cat.label : undefined}
                    aria-label={cat.label}
                    className={`
                      relative flex w-full items-center py-1.5 transition-colors duration-150 group border-y-0 border-r-0 border-l-2 border-transparent text-slate-500 hover:bg-slate-100/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/40 dark:hover:text-white
                      ${collapsed ? 'px-0 justify-center h-9 w-9 rounded-md mx-auto' : 'rounded-r-md pl-3 gap-2.5'}
                    `}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md">
                      <cat.icon size={15} strokeWidth={2} />
                    </span>
                    {!collapsed && (
                      <>
                        <span className="text-left truncate font-semibold text-xs flex-1">{cat.label}</span>
                        <ChevronRight
                          size={13}
                          className={`text-slate-400 dark:text-slate-500 transition-transform duration-150 mr-1 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                      </>
                    )}
                  </button>

                  {/* Subitens */}
                  {isExpanded && (
                    <div className={`space-y-0.5 ${collapsed ? '' : 'ml-3 border-l border-slate-200 dark:border-slate-800 pl-2'}`}>
                      {cat.items.map((item) => renderNavLink(item))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Footer do Menu com Botão de Pino (Docking) */}
      {!collapsed && !showClose && toggleDock && (
        <div className="p-2 border-t border-slate-200 dark:border-slate-800/60 bg-slate-100/40 dark:bg-slate-900/30 flex items-center justify-between">
          <span className="text-[10px] pl-1 font-bold text-slate-400 dark:text-slate-500 tracking-wider">FIXAR MENU</span>
          <button
            onClick={toggleDock}
            title={isDocked ? "Desafixar menu (flutuante)" : "Fixar menu na tela"}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-colors"
          >
            <Pin size={12} className={`transition-transform duration-150 ${isDocked ? 'rotate-45 text-blue-500 dark:text-blue-400' : ''}`} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ 
  collapsed, 
  isDocked, 
  toggleDock, 
  onMouseEnter, 
  onMouseLeave 
}: { 
  collapsed: boolean; 
  isDocked: boolean; 
  toggleDock: () => void; 
  onMouseEnter?: () => void; 
  onMouseLeave?: () => void; 
}) {
  return (
    <aside className={`relative z-10 hidden h-full min-h-0 shrink-0 overflow-visible md:flex transition-[width] duration-150 ${isDocked ? (collapsed ? 'w-[60px]' : 'w-[200px]') : 'w-[60px]'}`}>
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`${collapsed ? 'w-[60px]' : 'w-[200px]'} absolute inset-y-0 left-0 z-30 min-h-0 overflow-hidden border-r border-slate-200 bg-slate-50/70 ${!isDocked && !collapsed ? 'shadow-xl dark:shadow-2xl bg-white dark:bg-[#0d1117] border-r-slate-350 dark:border-r-slate-800' : 'shadow-sm dark:bg-[#0d1117]/60'} transition-[width,box-shadow,background-color] duration-150`}
      >
        <SidebarPanel collapsed={collapsed} isDocked={isDocked} toggleDock={toggleDock} />
      </div>
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void; }) {
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white shadow-xl transition-transform dark:border-slate-700 dark:bg-[#0d1117] ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarPanel onNavigate={onClose} showClose collapsed={false} />
      </aside>
    </div>
  );
}