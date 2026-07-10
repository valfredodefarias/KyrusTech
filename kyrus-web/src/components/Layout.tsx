import { useEffect, useMemo, useState, useRef, Component, type ReactNode, type DragEvent, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  AlertTriangle, Clock3, LogOut, Menu, Moon, RefreshCw, Sun, 
  Search, Star, Pin, X, ChevronLeft, ChevronRight, CheckCircle2,
  AlertCircle, HelpCircle
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { api, toPublicAssetUrl } from '../services/api';
import { useAuthStore, type AuthUser } from '../store/authStore';
import { useTabStore, type TabItem, DEFAULT_TAB } from '../store/tabStore';

interface EmpresaInfo {
  id?: number;
  nome_fantasia: string;
  logo_url?: string | null;
  cor_primaria?: string;
}

interface ConsultorContextoResponse {
  empresa_atual: EmpresaInfo;
}

// Mapeador de ícones Lucide dinâmico
function TabIcon({ name, className, size = 13 }: { name: string; className?: string; size?: number }) {
  const IconComponent = (Icons as any)[name] || Icons.FileText;
  return <IconComponent className={className} size={size} />;
}

// Error Boundary para isolar crashes de abas individuais
interface ErrorBoundaryProps {
  children: ReactNode;
  tab: TabItem;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class TabErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: any) {
    console.error('Erro detectado na aba:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false });
    useTabStore.getState().triggerRefresh(this.props.tab.basePath);
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-center h-[50vh] bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-md mx-6 mt-6">
          <AlertCircle className="w-12 h-12 text-rose-500 mb-4 animate-bounce" />
          <h3 className="text-base font-bold text-slate-800 dark:text-white">Ocorreu um erro nesta tela</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
            Houve um problema de renderização na aba "{this.props.tab.label}". Você pode tentar recarregar esta tela específica.
          </p>
          <button
            onClick={this.handleReset}
            className="mt-5 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-md transition"
          >
            <RefreshCw size={14} /> Recarregar Tela
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lista de páginas mapeadas para as abas do sistema com categorias e tags
interface SearchPageItem {
  path: string;
  label: string;
  iconName: string;
  category: 'Geral' | 'Financeiro' | 'Comercial' | 'Administração';
  tags: string[];
}

const SEARCH_PAGES: SearchPageItem[] = [
  { path: '/home', label: 'Visão Geral', iconName: 'Home', category: 'Geral', tags: ['dashboard', 'resumo', 'indicadores', 'inicio'] },
  { path: '/boletim', label: 'Boletim Financeiro', iconName: 'BarChart2', category: 'Geral', tags: ['caixa', 'diario', 'fluxo', 'saldo'] },
  { path: '/dre', label: 'DRE', iconName: 'LineChart', category: 'Financeiro', tags: ['demonstrativo', 'resultado', 'lucro', 'contas'] },
  { path: '/consultor', label: 'Área do Consultor', iconName: 'Briefcase', category: 'Geral', tags: ['consultor', 'ia', 'inteligencia', 'chat', 'ajuda'] },
  { path: '/lancamentos', label: 'Lançamentos', iconName: 'PlusCircle', category: 'Financeiro', tags: ['contas', 'pagar', 'receber', 'despesa', 'receita'] },
  { path: '/contas', label: 'Contas Bancárias', iconName: 'Landmark', category: 'Financeiro', tags: ['banco', 'itau', 'bradesco', 'saldo', 'extrato'] },
  { path: '/orcamentos', label: 'Orçamentos', iconName: 'Calculator', category: 'Financeiro', tags: ['planejamento', 'orcamento', 'metas'] },
  { path: '/budget', label: 'Budget', iconName: 'Table2', category: 'Financeiro', tags: ['budget', 'despesas', 'investimento'] },
  { path: '/cartoes', label: 'Cartões', iconName: 'CreditCard', category: 'Financeiro', tags: ['credito', 'limite', 'fatura', 'nubank'] },
  { path: '/conciliacao-cartoes', label: 'Conciliadora de Cartões', iconName: 'Coins', category: 'Financeiro', tags: ['cartao', 'visa', 'master', 'conciliacao'] },
  { path: '/pdv', label: 'PDV', iconName: 'ShoppingBag', category: 'Comercial', tags: ['vendas', 'caixa', 'cupom', 'cliente'] },
  { path: '/caixa', label: 'Caixa', iconName: 'Banknote', category: 'Financeiro', tags: ['dinheiro', 'sangria', 'suprimento', 'fluxo'] },
  { path: '/config', label: 'Configurações', iconName: 'Settings', category: 'Administração', tags: ['preferencias', 'usuarios', 'permissao'] },
  { path: '/importacao_ofx', label: 'Importação OFX', iconName: 'Landmark', category: 'Financeiro', tags: ['extrato', 'banco', 'ofx', 'conciliacao'] },
  { path: '/importacao_nfe', label: 'Importação NF-e', iconName: 'FileText', category: 'Comercial', tags: ['nota', 'fiscal', 'xml', 'compra'] },
  { path: '/auditoria', label: 'Auditoria', iconName: 'History', category: 'Administração', tags: ['log', 'historico', 'atividades'] },
  { path: '/comissoes', label: 'Comissões e Metas', iconName: 'Award', category: 'Financeiro', tags: ['vendedor', 'comissao', 'premios'] },
];

const MAIN_PAGES: Record<string, { label: string; iconName: string }> = SEARCH_PAGES.reduce((acc, page) => {
  acc[page.path] = { label: page.label, iconName: page.iconName };
  return acc;
}, {} as Record<string, { label: string; iconName: string }>);

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

function normalizeText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function highlightText(text: string, query: string) {
  if (!query) return <span>{text}</span>;
  const normalizedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  
  const idx = normalizedText.toLowerCase().indexOf(normalizedQuery);
  if (idx === -1) return <span>{text}</span>;
  
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  
  return (
    <span>
      {before}
      <strong className="text-yellow-600 dark:text-yellow-450 font-extrabold">{match}</strong>
      {after}
    </span>
  );
}

function LayoutShell() {
  const location = useLocation();
  const navigate = useNavigate();
  
  const logout = useAuthStore((state) => state.logout);
  const storedUser = useAuthStore((state) => state.user);
  const sessionExpiresAt = useAuthStore((state) => state.sessionExpiresAt);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);
  const setUser = useAuthStore((state) => state.setUser);
  
  // Abas do Zustand
  const tabs = useTabStore((state) => state.tabs);
  const activeTabPath = useTabStore((state) => state.activeTabPath);
  const openTab = useTabStore((state) => state.openTab);
  const closeTab = useTabStore((state) => state.closeTab);
  const setActiveTab = useTabStore((state) => state.setActiveTab);
  const togglePin = useTabStore((state) => state.togglePin);
  const toggleFavorite = useTabStore((state) => state.toggleFavorite);
  const favorites = useTabStore((state) => state.favorites);
  const refreshCounters = useTabStore((state) => state.refreshCounters);
  const triggerRefresh = useTabStore((state) => state.triggerRefresh);
  const reorderTabs = useTabStore((state) => state.reorderTabs);
  const clearSession = useTabStore((state) => state.clearSession);
  const online = useTabStore((state) => state.online);
  const setOnline = useTabStore((state) => state.setOnline);
  const lastPrunedTabName = useTabStore((state) => state.lastPrunedTabName);
  const setLastPrunedTabName = useTabStore((state) => state.setLastPrunedTabName);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isSidebarDocked, setIsSidebarDocked] = useState<boolean>(() => {
    return localStorage.getItem('kyrus_sidebar_docked') === 'true';
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'light');
  const [headerUser, setHeaderUser] = useState<AuthUser | null>(storedUser);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [renewingSession, setRenewingSession] = useState(false);
  
  // States Locais para Abas e Usabilidade
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(0);
  const [activeContextMenu, setActiveContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [mobileTabsOpen, setMobileTabsOpen] = useState(false);
  const [isTabNavigating, setIsTabNavigating] = useState(false);
  const [draggedTabPath, setDraggedTabPath] = useState<string | null>(null);
  
  const [showOnlineToast, setShowOnlineToast] = useState(false);
  const [prunedToastName, setPrunedToastName] = useState<string | null>(null);
  const [previousActiveElement, setPreviousActiveElement] = useState<HTMLElement | null>(null);
  const prevOnline = useRef(online);

  const tabScrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const handleCloseTab = useCallback((path: string, force = false) => {
    const isActive = path === activeTabPath || path.split('?')[0] === activeTabPath.split('?')[0];
    closeTab(path, force);
    if (isActive) {
      setTimeout(() => {
        const nextActivePath = useTabStore.getState().activeTabPath;
        navigate(nextActivePath);
      }, 0);
    }
  }, [activeTabPath, closeTab, navigate]);

  const isBoletimEmbedMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('embed_boletim') === '1';
  }, [location.search]);

  // Sincronizar conexão e disparar Toast de reconexão
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [setOnline]);

  useEffect(() => {
    if (online && !prevOnline.current) {
      setShowOnlineToast(true);
      const timer = setTimeout(() => setShowOnlineToast(false), 3000);
      return () => clearTimeout(timer);
    }
    prevOnline.current = online;
  }, [online]);

  // Toast de aba podada (auto-pruned)
  useEffect(() => {
    if (lastPrunedTabName) {
      setPrunedToastName(lastPrunedTabName);
      setLastPrunedTabName(null);
      const timer = setTimeout(() => setPrunedToastName(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastPrunedTabName, setLastPrunedTabName]);

  // Sincronizar título do navegador
  useEffect(() => {
    const activeTab = tabs.find((t) => t.path === activeTabPath || t.basePath === activeTabPath.split('?')[0]);
    if (activeTab) {
      document.title = `Kyrus ERP - ${activeTab.label}`;
    } else {
      document.title = 'Kyrus ERP';
    }
  }, [activeTabPath, tabs]);

  // Sincronizar Rota -> Abas
  useEffect(() => {
    const currentPath = location.pathname + location.search;
    const basePath = location.pathname;

    if (MAIN_PAGES[basePath]) {
      const pageInfo = MAIN_PAGES[basePath];
      setIsTabNavigating(true);
      const timer = setTimeout(() => setIsTabNavigating(false), 250);
      
      openTab(currentPath, pageInfo.label, pageInfo.iconName);
      
      return () => clearTimeout(timer);
    }
  }, [location.pathname, location.search, openTab]);



  // Centralizar aba ativa no scroll horizontal
  useEffect(() => {
    if (tabScrollRef.current) {
      const activeEl = tabScrollRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
    checkScrollArrows();
  }, [activeTabPath]);

  // Checar transbordamento horizontal da barra de abas
  const checkScrollArrows = () => {
    if (tabScrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabScrollRef.current;
      setShowLeftArrow(scrollLeft > 2);
      setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 2);
    }
  };

  const handleTabScroll = (direction: 'left' | 'right') => {
    if (tabScrollRef.current) {
      const offset = direction === 'left' ? -150 : 150;
      tabScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // Mouse wheel horizontal scrolling nas abas
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Interceptador de Modificações (Dirty State) para Formulários
  useEffect(() => {
    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        const basePath = location.pathname;
        if (MAIN_PAGES[basePath]) {
          useTabStore.getState().setTabDirty(basePath, true);
        }
      }
    };
    
    const handleSubmit = () => {
      const basePath = location.pathname;
      if (MAIN_PAGES[basePath]) {
        useTabStore.getState().setTabDirty(basePath, false);
      }
    };

    (window as any).kyrusClearDirtyTab = () => {
      const basePath = location.pathname;
      useTabStore.getState().setTabDirty(basePath, false);
    };

    document.addEventListener('input', handleInput);
    document.addEventListener('submit', handleSubmit);
    return () => {
      document.removeEventListener('input', handleInput);
      document.removeEventListener('submit', handleSubmit);
    };
  }, [location.pathname]);

  // Alerta beforeunload para alterações pendentes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasDirty = tabs.some((t) => t.dirty);
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = 'Você possui alterações não salvas no ERP. Deseja realmente sair?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tabs]);

  // Restauração de foco ao fechar a Command Palette
  useEffect(() => {
    if (showSearchModal) {
      setPreviousActiveElement(document.activeElement as HTMLElement);
    } else {
      if (previousActiveElement) {
        previousActiveElement.focus();
        setPreviousActiveElement(null);
      }
    }
  }, [showSearchModal]);

  // Ouvir atalhos globais de teclado (Alt + PageUp/Down / Alt+Shift+Setas / Alt+P / Alt+S / ? / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + K ou Cmd + K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (showSearchModal) {
          // Re-focar e selecionar tudo
          if (searchInputRef.current) {
            searchInputRef.current.focus();
            searchInputRef.current.select();
          }
        } else {
          setShowSearchModal(true);
          setSearchQuery('');
          setSelectedSearchIdx(0);
        }
        return;
      }

      // Tecla '?' para Ajuda (Cheat Sheet) se não estiver focando escrita
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'SELECT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      );
      if (e.key === '?' && !isInputFocused) {
        e.preventDefault();
        setShowHelpModal((prev) => !prev);
        return;
      }

      // Atalhos baseados na tecla Alt
      if (e.altKey) {
        // Alt + W: Fechar aba ativa
        if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
          e.preventDefault();
          const activeTab = tabs.find((t) => t.path === activeTabPath);
          if (activeTab && !activeTab.pinned) {
            handleCloseTab(activeTab.path);
          }
        }
        
        // Alt + Shift + W: Fechar todas as abas
        if (e.key.toLowerCase() === 'w' && e.shiftKey) {
          e.preventDefault();
          handleCloseAll();
        }

        // Alt + P: Alternar estado de Fixado (Pin)
        if (e.key.toLowerCase() === 'p' && !e.shiftKey) {
          e.preventDefault();
          const activeTab = tabs.find((t) => t.path === activeTabPath);
          if (activeTab) {
            handlePinTab(activeTab.path);
          }
        }

        // Alt + S: Alternar favorito
        if (e.key.toLowerCase() === 's' && !e.shiftKey) {
          e.preventDefault();
          toggleFavorite(activeTabPath);
        }

        // Alt + Shift + T: Reabrir última aba fechada
        if (e.key.toLowerCase() === 't' && e.shiftKey) {
          e.preventDefault();
          useTabStore.getState().reopenLastTab();
        }

        // Alt + PageUp / PageDown ou Alt + ArrowLeft / ArrowRight para navegar
        if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.shiftKey)) {
          e.preventDefault();
          const activeIdx = tabs.findIndex((t) => t.path === activeTabPath);
          if (activeIdx !== -1) {
            const nextIdx = (activeIdx - 1 + tabs.length) % tabs.length;
            const nextTab = tabs[nextIdx];
            if (nextTab) {
              navigate(nextTab.path);
              setActiveTab(nextTab.path);
            }
          }
        }

        if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.shiftKey)) {
          e.preventDefault();
          const activeIdx = tabs.findIndex((t) => t.path === activeTabPath);
          if (activeIdx !== -1) {
            const nextIdx = (activeIdx + 1) % tabs.length;
            const nextTab = tabs[nextIdx];
            if (nextTab) {
              navigate(nextTab.path);
              setActiveTab(nextTab.path);
            }
          }
        }

        // Alt + Shift + ArrowLeft / ArrowRight: Reordenar abas via teclado
        if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const activeIdx = tabs.findIndex((t) => t.path === activeTabPath);
          if (activeIdx !== -1) {
            const targetIdx = e.key === 'ArrowRight' ? activeIdx + 1 : activeIdx - 1;
            if (targetIdx >= 0 && targetIdx < tabs.length) {
              reorderTabs(activeIdx, targetIdx);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabPath, navigate, setActiveTab, handleCloseTab, showSearchModal]);

  // Lista de páginas filtradas ou histórico de recentes na busca
  const searchResults = useMemo(() => {
    const permissions = headerUser?.permissions || [];
    const superConsultor = headerUser?.is_consultor && headerUser.consultor_role === 'SUPER_CONSULTOR';
    const normalizedQuery = normalizeText(searchQuery);
    
    // Se a busca estiver vazia, exibir o histórico de páginas recentes do localStorage ou sugestões
    if (!normalizedQuery) {
      try {
        const storedRecents = localStorage.getItem('kyrus_recent_searches');
        const recentPaths: string[] = storedRecents ? JSON.parse(storedRecents) : [];
        if (recentPaths.length > 0) {
          return SEARCH_PAGES.filter((p) => recentPaths.includes(p.path));
        }
      } catch {}
      
      // Fallback: se não houver buscas recentes, mostrar 5 sugestões populares!
      return SEARCH_PAGES.filter((p) => 
        ['/home', '/lancamentos', '/boletim', '/dre', '/consultor'].includes(p.path)
      );
    }

    const matches = SEARCH_PAGES.filter((page) => {
      // Filtragem por permissão
      let hasAccess = true;
      if (page.path === '/pdv' && !superConsultor && !permissions.includes('*')) {
        hasAccess = false;
      }
      if (!hasAccess) return false;

      const normLabel = normalizeText(page.label);
      const normPath = normalizeText(page.path);
      const matchesLabel = normLabel.includes(normalizedQuery);
      const matchesPath = normPath.includes(normalizedQuery);
      const matchesTags = page.tags.some((tag) => normalizeText(tag).includes(normalizedQuery));
      return matchesLabel || matchesPath || matchesTags;
    });

    // Classificação por relevância de prefixo (prefixo do rótulo no topo)
    return matches.sort((a, b) => {
      const normA = normalizeText(a.label);
      const normB = normalizeText(b.label);
      
      const aStarts = normA.startsWith(normalizedQuery);
      const bStarts = normB.startsWith(normalizedQuery);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      
      return normA.localeCompare(normB);
    });
  }, [searchQuery, headerUser]);

  const isShowingRecents = useMemo(() => {
    if (searchQuery) return false;
    try {
      const stored = localStorage.getItem('kyrus_recent_searches');
      const recentPaths: string[] = stored ? JSON.parse(stored) : [];
      return recentPaths.length > 0;
    } catch {
      return false;
    }
  }, [searchQuery]);

  // Rolar item selecionado na busca para visualização (Scroll-Into-View)
  useEffect(() => {
    const el = document.getElementById(`search-item-${selectedSearchIdx}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedSearchIdx]);

  // Autocompletar inteligente via Tab / Seta Direita
  const autocompleteSuggestion = useMemo(() => {
    if (!searchQuery || searchResults.length === 0) return '';
    const firstResult = searchResults[0];
    const normalizedQuery = searchQuery.toLowerCase();
    const normalizedLabel = firstResult.label.toLowerCase();
    if (normalizedLabel.startsWith(normalizedQuery) && normalizedLabel !== normalizedQuery) {
      return searchQuery + firstResult.label.slice(searchQuery.length);
    }
    return '';
  }, [searchQuery, searchResults]);

  const handleOpenSearchPage = (path: string) => {
    setShowSearchModal(false);
    
    // Salvar recente no localStorage
    try {
      const stored = localStorage.getItem('kyrus_recent_searches');
      const recents: string[] = stored ? JSON.parse(stored) : [];
      const updated = [path, ...recents.filter((p) => p !== path)].slice(0, 5);
      localStorage.setItem('kyrus_recent_searches', JSON.stringify(updated));
    } catch {}

    navigate(path);
  };

  const handleClearRecents = () => {
    try {
      localStorage.removeItem('kyrus_recent_searches');
      setSearchQuery(' ');
      setTimeout(() => setSearchQuery(''), 10);
    } catch {}
  };

  // Agrupar resultados por categoria contábil para exibição
  const groupedResults = useMemo(() => {
    const groups: Record<string, typeof searchResults> = {};
    searchResults.forEach((item) => {
      const cat = item.category || 'Geral';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [searchResults]);

  // Configuração de Sessão
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
    if (!sessionExpiresAt) return;
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

        if (!currentUser || !active) return;

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
        
        // Sincronizar theme-color do navegador
        let metaTheme = document.querySelector('meta[name="theme-color"]');
        if (!metaTheme) {
          metaTheme = document.createElement('meta');
          metaTheme.setAttribute('name', 'theme-color');
          document.head.appendChild(metaTheme);
        }
        metaTheme.setAttribute('content', empresaAtual?.cor_primaria || '#2563eb');

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

  const toggleSidebarDock = () => {
    setIsSidebarDocked((prev) => {
      const next = !prev;
      localStorage.setItem('kyrus_sidebar_docked', next ? 'true' : 'false');
      return next;
    });
  };

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
      clearSession();
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

  // Drag and Drop de Abas
  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number, path: string) => {
    e.dataTransfer.setData('tabIndex', index.toString());
    setDraggedTabPath(path);
  };

  const handleDragEnd = () => {
    setDraggedTabPath(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetIndex: number) => {
    const sourceIndex = parseInt(e.dataTransfer.getData('tabIndex'), 10);
    if (!isNaN(sourceIndex) && sourceIndex !== targetIndex) {
      reorderTabs(sourceIndex, targetIndex);
    }
    setDraggedTabPath(null);
  };

  // Menu de Contexto (Right Click)
  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    const menuWidth = 170;
    const menuHeight = 220;
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }

    setActiveContextMenu({ path, x, y });
  };

  useEffect(() => {
    const closeMenu = () => setActiveContextMenu(null);
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  const handlePinTab = (path: string) => {
    const basePath = path.split('?')[0];
    togglePin(basePath);
  };

  // Fechamentos direcionais e confirmação dirty (Bulk Close Dirty Guard)
  const handleCloseOthers = (path: string) => {
    const basePath = path.split('?')[0];
    const candidates = tabs.filter((t) => t.basePath !== basePath && !t.pinned);
    const dirtyCandidates = candidates.filter((t) => t.dirty);
    if (dirtyCandidates.length > 0) {
      const confirm = window.confirm(
        `Existem ${dirtyCandidates.length} outra(s) aba(s) com alterações não salvas. Deseja fechar tudo mesmo assim?`
      );
      if (!confirm) return;
    }
    candidates.forEach((t) => {
      handleCloseTab(t.path, true);
    });
  };

  const handleCloseLeft = (path: string) => {
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx !== -1) {
      const candidates = tabs.slice(0, idx);
      const dirtyCandidates = candidates.filter((t) => t.dirty && !t.pinned);
      if (dirtyCandidates.length > 0) {
        const confirm = window.confirm(
          `Existem ${dirtyCandidates.length} aba(s) com alterações não salvas à esquerda. Deseja fechar tudo mesmo assim?`
        );
        if (!confirm) return;
      }
      candidates.forEach((t) => {
        if (!t.pinned) handleCloseTab(t.path, true);
      });
    }
  };

  const handleCloseRight = (path: string) => {
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx !== -1) {
      const candidates = tabs.slice(idx + 1);
      const dirtyCandidates = candidates.filter((t) => t.dirty && !t.pinned);
      if (dirtyCandidates.length > 0) {
        const confirm = window.confirm(
          `Existem ${dirtyCandidates.length} aba(s) com alterações não salvas à direita. Deseja fechar tudo mesmo assim?`
        );
        if (!confirm) return;
      }
      candidates.forEach((t) => {
        if (!t.pinned) handleCloseTab(t.path, true);
      });
    }
  };

  const handleCloseAll = () => {
    const candidates = tabs.filter((t) => !t.pinned);
    const dirtyCandidates = candidates.filter((t) => t.dirty);
    if (dirtyCandidates.length > 0) {
      const confirm = window.confirm(
        `Existem ${dirtyCandidates.length} aba(s) com alterações não salvas. Deseja fechar todas mesmo assim?`
      );
      if (!confirm) return;
    }
    candidates.forEach((t) => {
      handleCloseTab(t.path, true);
    });
  };

  const handleCopyTabLink = (path: string) => {
    const fullUrl = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      alert('Link da aba copiado para a área de transferência!');
    });
  };

  if (isBoletimEmbedMode) {
    return (
      <div className={`kyrus-shell ${theme === 'dark' ? 'dark' : ''}`}>
        <div className="min-h-screen bg-slate-50 dark:bg-[#0d1117] font-sans text-slate-800 dark:text-slate-200">
          <main className="h-screen overflow-y-auto p-0">
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  const activeTabItem = tabs.find((t) => t.path === activeTabPath || t.basePath === activeTabPath.split('?')[0]) || DEFAULT_TAB;

  return (
    <div className={`kyrus-shell ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fa] font-sans text-slate-800 dark:bg-[#090d16] dark:text-slate-200">
        
        {/* CABEÇALHO COMPACTO (52px) */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-[#161b22] px-4">
          <div className="flex h-[52px] w-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 md:hidden"
                aria-label="Abrir menu"
              >
                <Menu size={16} />
              </button>

              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-slate-650 dark:border-slate-850 dark:bg-slate-800 dark:text-slate-100">
                  {companyLogo ? (
                    <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-bold">{getInitials(companyName)}</span>
                  )}
                </div>

                <div className="min-w-0 leading-tight">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{companyName}</p>
                    <span 
                      title={online ? 'Sistema Online' : 'Você está offline'} 
                      className={`h-2 w-2 rounded-full border border-white dark:border-slate-900 shrink-0 transition-colors ${online ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`}
                    />
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Kyrus ERP</p>
                </div>
              </div>
            </div>

            {/* BARRA DE PESQUISA ESTILO GITHUB (Ctrl+K) */}
            <div className="hidden md:flex max-w-sm flex-1 items-center">
              <button
                onClick={() => { setShowSearchModal(true); setSearchQuery(''); setSelectedSearchIdx(0); }}
                className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-[#0d1117] dark:hover:bg-slate-900 text-[11px]"
              >
                <Search size={12} className="shrink-0" />
                <span className="flex-1 text-left">Buscar página ou comando...</span>
                <kbd className="hidden sm:inline-block rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-slate-400 dark:border-slate-850 dark:bg-slate-800">
                  Ctrl K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-[#0d1117] dark:text-slate-350 dark:hover:bg-slate-900"
                title={themeLabel}
                aria-label={themeLabel}
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                <span className="hidden lg:inline">{themeLabel}</span>
              </button>

              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-[#0d1117]">
                <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-600 dark:bg-slate-850 dark:text-slate-100">
                  {userAvatar ? (
                    <img src={userAvatar} alt={userName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[9px] font-bold">{getInitials(userName)}</span>
                  )}
                </div>
                <div className="hidden min-w-0 lg:block">
                  <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{userName}</p>
                </div>
              </div>

              <button
                onClick={handleLogout}
                title="Sair do Sistema"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-350 dark:hover:bg-rose-900/20"
                aria-label="Sair do Sistema"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </header>

        {/* BARRA DE TABS MULTI-ABAS (36px) */}
        {!isBoletimEmbedMode && (
          <div className="relative shrink-0 flex h-9 w-full items-center justify-between border-b border-slate-200 bg-slate-50 dark:border-slate-850 dark:bg-[#161b22] px-2 select-none z-10">
            {/* Atalho Mobile para Visualizador de Abas */}
            <div className="flex md:hidden items-center">
              <button
                onClick={() => setMobileTabsOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-350 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-md"
              >
                <span>Tabs</span>
                <span className="bg-blue-600 text-white rounded-full px-1 text-[9px]">{tabs.length}</span>
              </button>
            </div>

            {/* Setas de Scroll Esquerda/Direita (Desktop) */}
            {showLeftArrow && (
              <button 
                onClick={() => handleTabScroll('left')} 
                className="hidden md:flex absolute left-0 z-10 h-9 w-6 items-center justify-center bg-gradient-to-r from-slate-50 to-transparent dark:from-[#161b22] text-slate-500"
              >
                <ChevronLeft size={14} />
              </button>
            )}

            {/* Máscaras Dinâmicas de Degradê na rolagem horizontal das abas */}
            {showLeftArrow && (
              <div className="absolute left-6 bottom-0 top-[6px] w-8 bg-gradient-to-r from-slate-50 to-transparent dark:from-[#161b22] pointer-events-none z-10" />
            )}
            {showRightArrow && (
              <div className="absolute right-[120px] bottom-0 top-[6px] w-8 bg-gradient-to-l from-slate-50 to-transparent dark:from-[#161b22] pointer-events-none z-10" />
            )}

            {/* Listagem de Abas Horizontal (Desktop) */}
            <div 
              ref={tabScrollRef}
              onScroll={checkScrollArrows}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowSearchModal(true);
                  setSearchQuery('');
                  setSelectedSearchIdx(0);
                }
              }}
              className="hidden md:flex flex-1 h-full items-end gap-0.5 overflow-x-auto custom-scrollbar-none pr-10 pl-6"
            >
              {tabs.map((tab, idx) => {
                const isActive = tab.path === activeTabPath;
                const isGhost = draggedTabPath === tab.path;
                return (
                  <div
                    key={tab.path}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx, tab.path)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, idx)}
                    onContextMenu={(e) => handleContextMenu(e, tab.path)}
                    onClick={() => { navigate(tab.path); setActiveTab(tab.path); }}
                    onAuxClick={(e) => {
                      if (e.button === 1) { // Middle click
                        e.preventDefault();
                        handleCloseTab(tab.path);
                      }
                    }}
                    onDoubleClick={() => triggerRefresh(tab.basePath)}
                    data-active={isActive ? 'true' : 'false'}
                    className={`
                      group relative flex h-[31px] items-center gap-2 px-3 border border-b-0 cursor-pointer text-xs transition-all select-none rounded-t-md font-medium border-slate-200 dark:border-slate-850/80 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none focus-visible:ring-blue-500
                      ${isActive 
                        ? 'bg-white dark:bg-[#0d1117] text-slate-850 dark:text-white font-bold border-slate-200 dark:border-slate-850 border-t-2 z-10' 
                        : 'bg-slate-100/50 hover:bg-white/40 dark:bg-slate-900/30 dark:hover:bg-slate-900/60 text-slate-500 dark:text-slate-400'}
                      ${isGhost ? 'opacity-40 border-dashed border-slate-350 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50' : ''}
                    `}
                    tabIndex={0}
                    style={isActive ? { borderTopColor: empresa?.cor_primaria || '#2563eb' } : undefined}
                  >
                    <TabIcon name={tab.iconName} className={isActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'} />
                    
                    {/* Hide label text if pinned (compact pinned tab) */}
                    {!tab.pinned && (
                      <span className="max-w-[100px] truncate">{tab.label}</span>
                    )}
                    
                    {/* VS Code Amber Circle indicator or hover close button */}
                    {tab.dirty ? (
                      <div className="h-4.5 w-4.5 shrink-0 flex items-center justify-center relative ml-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 group-hover:hidden" />
                        {!tab.pinned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseTab(tab.path);
                            }}
                            className="hidden group-hover:flex text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-sm p-0.5"
                            title="Fechar aba"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    ) : (
                      !tab.pinned ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseTab(tab.path);
                          }}
                          className="ml-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-sm p-0.5 transition-opacity"
                          title="Fechar aba"
                        >
                          <X size={10} />
                        </button>
                      ) : (
                        // Hover Pin Indicador nas abas fixadas
                        <div className="opacity-0 group-hover:opacity-100 text-slate-400 shrink-0 transition-opacity ml-1">
                          <Pin size={9} />
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {showRightArrow && (
              <button 
                onClick={() => handleTabScroll('right')} 
                className="hidden md:flex absolute right-24 z-10 h-9 w-6 items-center justify-center bg-gradient-to-l from-slate-50 to-transparent dark:from-[#161b22] text-slate-500"
              >
                <ChevronRight size={14} />
              </button>
            )}

            {/* Ações Rápidas no canto direito (Desktop) */}
            <div className="hidden md:flex items-center gap-1 text-slate-500 shrink-0">
              {/* Tecla "?" de atalhos explicativos */}
              <button
                onClick={() => setShowHelpModal(true)}
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400"
                title="Atalhos e Ajuda (?)"
              >
                <HelpCircle size={13} />
              </button>

              {/* Botão de Favorito Star */}
              <button
                onClick={() => toggleFavorite(activeTabPath)}
                className={`p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 ${favorites.includes(activeTabPath) ? 'text-amber-500' : 'text-slate-400'}`}
                title={favorites.includes(activeTabPath) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              >
                <Star size={13} fill={favorites.includes(activeTabPath) ? 'currentColor' : 'none'} />
              </button>

              {/* Botão de Refresh */}
              <button
                onClick={() => triggerRefresh(activeTabItem.basePath)}
                className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800"
                title="Recarregar tela da aba (Soft Refresh)"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>
        )}

        {/* LOADING BAR TIPO GITHUB (1.5px) */}
        {isTabNavigating && (
          <div className="w-full h-[1.5px] bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0">
            <div 
              className="h-full bg-blue-500 transition-all duration-300 animate-pulse"
              style={{ width: '70%', backgroundColor: empresa?.cor_primaria || '#2563eb' }}
            />
          </div>
        )}

        {/* CONTEÚDO PRINCIPAL */}
        {userEmail.startsWith('convidado_') && userEmail.endsWith('@kyrustech.com') && (
          <div className="shrink-0 bg-blue-600 dark:bg-blue-700 text-white px-4 py-1.5 text-[10px] font-semibold text-center flex justify-center items-center gap-2 animate-in slide-in-from-top-1 duration-200 border-b border-blue-700/50">
            <span>💡</span>
            <span><strong>Ambiente de Testes Isolado</strong>: Suas alterações são exclusivas e este ambiente temporário será apagado após 2 horas de inatividade.</span>
          </div>
        )}

        {sessionStatus && (
          <div className={`mx-4 mt-3 shrink-0 rounded-md border px-4 py-2.5 shadow-none ${sessionStatus === 'expired' ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-100' : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100'}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-2.5">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${sessionStatus === 'expired' ? 'bg-rose-100 dark:bg-rose-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                  {sessionStatus === 'expired' ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-xs font-bold">
                    {sessionStatus === 'expired'
                      ? 'Sua sessão expirou.'
                      : `Sua sessão expira em ${formatRemainingTime(sessionRemainingMs ?? 0)}.`}
                  </p>
                  <p className="text-[10px] opacity-90">
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
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-70 ${sessionStatus === 'expired' ? 'bg-rose-700 text-white hover:bg-rose-850' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
              >
                <RefreshCw className="h-3 w-3" />
                {sessionStatus === 'expired' ? 'Entrar novamente' : 'Renovar'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar
            collapsed={sidebarCollapsed}
            isDocked={isSidebarDocked}
            toggleDock={toggleSidebarDock}
            onMouseEnter={handleSidebarMouseEnter}
            onMouseLeave={handleSidebarMouseLeave}
          />
          <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
          
          {/* Espaçamento Flush (padding 0) */}
          <main className="min-w-0 flex-1 overflow-y-auto p-0">
            <div key={activeTabItem.path} className="min-h-full w-full animate-tab-content">
              {/* RENDERIZADOR CONDICIONAL DE ABA COM ERROR BOUNDARY E CHAVE DE SOFT REFRESH */}
              {!online && !activeTabItem.visited ? (
                <div className="flex flex-col items-center justify-center p-12 text-center h-[50vh] bg-white dark:bg-[#0d1117] rounded-md m-6 border border-dashed border-slate-200 dark:border-slate-800">
                  <AlertTriangle className="w-12 h-12 text-amber-500 mb-4 animate-pulse" />
                  <h3 className="text-base font-bold text-slate-850 dark:text-white">Sem Conexão com a Internet</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
                    Esta página ("{activeTabItem.label}") ainda não foi carregada. Conecte-se à internet para carregá-la pela primeira vez.
                  </p>
                </div>
              ) : (
                <TabErrorBoundary key={`${activeTabItem.basePath}-${refreshCounters[activeTabItem.basePath] || 0}`} tab={activeTabItem}>
                  <Outlet />
                </TabErrorBoundary>
              )}
            </div>
          </main>
        </div>

        {/* MENU DE CONTEXTO FLUTUANTE (CLIQUE DIREITO NAS ABAS) */}
        {activeContextMenu && (
          <div
            className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-lg py-1 text-xs text-slate-750 dark:text-slate-200 min-w-[170px]"
            style={{ top: activeContextMenu.y, left: activeContextMenu.x }}
          >
            <button
              onClick={() => handlePinTab(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center justify-between"
            >
              <span className="flex items-center gap-2"><Pin size={11} /> <span>Fixar / Desafixar</span></span>
              <kbd className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded">Alt P</kbd>
            </button>
            <button
              onClick={() => toggleFavorite(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center justify-between"
            >
              <span className="flex items-center gap-2"><Star size={11} /> <span>Favoritar</span></span>
              <kbd className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded">Alt S</kbd>
            </button>
            <button
              onClick={() => handleCopyTabLink(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center"
            >
              <X size={11} className="rotate-45" />
              <span>Copiar Link</span>
            </button>
            <hr className="border-slate-200 dark:border-slate-800 my-1" />
            <button
              onClick={() => handleCloseOthers(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center"
            >
              <X size={11} />
              <span>Fechar Outras Abas</span>
            </button>
            <button
              onClick={() => handleCloseLeft(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center"
            >
              <X size={11} />
              <span>Fechar à Esquerda</span>
            </button>
            <button
              onClick={() => handleCloseRight(activeContextMenu.path)}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center"
            >
              <X size={11} />
              <span>Fechar à Direita</span>
            </button>
            <button
              onClick={() => handleCloseAll()}
              className="flex w-full px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-left gap-2 items-center text-rose-500 justify-between"
            >
              <span className="flex items-center gap-2"><X size={11} /> <span>Fechar Todas</span></span>
              <kbd className="text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded">Alt Shift W</kbd>
            </button>
          </div>
        )}

        {/* CHEAT SHEET ATALHOS MODAL ("?") */}
        {showHelpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-md" onClick={() => setShowHelpModal(false)} />
            <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-2xl overflow-hidden p-6 animate-tab-fade">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                <h3 className="text-sm font-bold text-slate-850 dark:text-white flex items-center gap-2">
                  <span>⌨️</span> Atalhos e Gestos de Teclado
                </h3>
                <button onClick={() => setShowHelpModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3.5 text-xs text-slate-650 dark:text-slate-350 overflow-y-auto max-h-[60vh]">
                <div className="flex justify-between items-center">
                  <span>Buscar página ou comando</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Ctrl + K</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Fechar aba ativa</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + W</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Ciclar abas (anterior / posterior)</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + ← / →</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Ciclar abas (alternativa)</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + PgUp / PgDn</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Reordenar posições da aba ativa</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + Shift + ← / →</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Fixar / desafixar aba</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + P</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Favoritar / desfatoritar aba</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + S</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Reabrir última aba fechada</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + Shift + T</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Fechar todas as abas</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">Alt + Shift + W</kbd>
                </div>
                <div className="flex justify-between items-center">
                  <span>Abrir este painel de ajuda</span>
                  <kbd className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">?</kbd>
                </div>
                <div className="pt-2 border-t border-slate-150 dark:border-slate-800 flex justify-between items-center text-[11px] font-semibold text-slate-500">
                  <span>Duplo clique na aba</span>
                  <span>Recarregar aba (Soft Refresh)</span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-semibold text-slate-500">
                  <span>Duplo clique no fundo vazio</span>
                  <span>Abrir busca de páginas</span>
                </div>
                <div className="flex justify-between items-center text-[11px] font-semibold text-slate-500">
                  <span>Clique do meio nas abas</span>
                  <span>Fechar a aba selecionada</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* COMMAND PALETTE (Ctrl+K MODAL) COM ÊNFASE REDUZIDA */}
        {showSearchModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4">
            <div className="fixed inset-0 bg-slate-900/10 dark:bg-slate-950/20" onClick={() => setShowSearchModal(false)} />
            <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-2xl overflow-hidden animate-simple-fade">
              
              <div className="flex items-center border-b border-slate-200 dark:border-slate-800 px-3 py-2.5 relative">
                <Search className="text-slate-400 mr-2.5 shrink-0" size={15} />
                
                <div className="relative flex-1">
                  {autocompleteSuggestion && (
                    <div className="absolute inset-0 pointer-events-none text-sm text-slate-350 dark:text-slate-655 select-none flex items-center pr-10">
                      {autocompleteSuggestion}
                    </div>
                  )}
                  <input
                    ref={searchInputRef}
                    type="text"
                    autoFocus
                    placeholder='Pesquise por nome, tags ou atalhos (ex: "itau", "xml", "dre", "despesa")...'
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSelectedSearchIdx(0); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (searchResults.length > 0) {
                          setSelectedSearchIdx((prev) => (prev + 1) % searchResults.length);
                        }
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (searchResults.length > 0) {
                          setSelectedSearchIdx((prev) => (prev - 1 + searchResults.length) % searchResults.length);
                        }
                      } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
                        if (autocompleteSuggestion) {
                          e.preventDefault();
                          const firstResult = searchResults[0];
                          if (firstResult) {
                            setSearchQuery(firstResult.label);
                          }
                        }
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const selection = searchResults[selectedSearchIdx];
                        if (selection) handleOpenSearchPage(selection.path);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        if (searchQuery) {
                          setSearchQuery('');
                        } else {
                          setShowSearchModal(false);
                        }
                      }
                    }}
                    className="w-full bg-transparent text-sm text-slate-850 dark:text-white placeholder-slate-400 outline-none border-0 p-0 relative z-10"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="Limpar pesquisa"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <button 
                    onClick={() => setShowSearchModal(false)} 
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-1"
                    title="Fechar busca"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="max-h-[300px] overflow-y-auto py-1">
                {searchResults.length === 0 ? (
                  // Caso de busca vazia (Redirecionamento para Consultor IA)
                  searchQuery ? (
                    <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col items-center">
                      <AlertTriangle className="w-8 h-8 text-slate-400 dark:text-slate-600 mb-2" />
                      <p className="font-semibold">Nenhuma página encontrada para "{searchQuery}"</p>
                      <p className="text-[10px] opacity-80 mt-1 max-w-xs">
                        Não encontrou a tela que procurava? Tente perguntar ao Consultor Financeiro de Inteligência Artificial do ERP!
                      </p>
                      <button
                        onClick={() => handleOpenSearchPage('/consultor')}
                        className="mt-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-md transition"
                      >
                        Ir para Área do Consultor IA
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 p-6 text-center">Nenhuma página recente visitada.</div>
                  )
                ) : (
                  // Exibição categorizada
                  !searchQuery ? (
                    // Páginas Recentes ou Sugestões
                    <div>
                      <div className="px-4 py-1.5 bg-slate-100/60 dark:bg-slate-800/30 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 border-y border-slate-150 dark:border-slate-850 flex items-center justify-between">
                        <span>{isShowingRecents ? 'Páginas Recentes' : 'Sugestões Rápidas'}</span>
                        {isShowingRecents && (
                          <button onClick={handleClearRecents} className="text-[9px] hover:underline font-bold text-blue-500 dark:text-blue-400 capitalize">Limpar</button>
                        )}
                      </div>
                      {searchResults.map((result, idx) => {
                        const isSelected = idx === selectedSearchIdx;
                        return (
                          <button
                            key={result.path}
                            id={`search-item-${idx}`}
                            onClick={() => handleOpenSearchPage(result.path)}
                            onMouseEnter={() => setSelectedSearchIdx(idx)}
                            className={`
                              flex w-full items-center gap-3 px-4 py-2.5 text-xs text-left transition-colors
                              ${isSelected 
                                ? 'bg-blue-600 text-white font-semibold' 
                                : 'text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}
                            `}
                          >
                            <TabIcon name={result.iconName} className={isSelected ? 'text-white' : 'text-slate-450'} size={14} />
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-semibold">{result.label}</p>
                              <p className={`text-[10px] truncate ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>{result.path}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // Resultados filtrados e agrupados
                    Object.entries(groupedResults).map(([category, items]) => (
                      <div key={category}>
                        <div className="px-4 py-1.5 bg-slate-100/60 dark:bg-slate-800/30 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 border-y border-slate-150 dark:border-slate-850 flex items-center justify-between">
                          <span>{category}</span>
                          <span className="text-[9px] font-bold text-slate-450 dark:text-slate-500">{items.length} {items.length === 1 ? 'página' : 'páginas'}</span>
                        </div>
                        {items.map((result) => {
                          const absoluteIdx = searchResults.findIndex((r) => r.path === result.path);
                          const isSelected = absoluteIdx === selectedSearchIdx;
                          const isOpen = tabs.some((t) => t.path === result.path || t.basePath === result.path.split('?')[0]);
                          
                          return (
                            <button
                              key={result.path}
                              id={`search-item-${absoluteIdx}`}
                              onClick={() => handleOpenSearchPage(result.path)}
                              onMouseEnter={() => setSelectedSearchIdx(absoluteIdx)}
                              className={`
                                flex w-full items-center gap-3 px-4 py-2.5 text-xs text-left transition-colors
                                ${isSelected 
                                  ? 'bg-blue-600 text-white font-semibold' 
                                  : 'text-slate-750 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800'}
                              `}
                            >
                              <TabIcon name={result.iconName} className={isSelected ? 'text-white' : 'text-slate-450'} size={14} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <p className="truncate font-semibold">{highlightText(result.label, searchQuery)}</p>
                                  {isOpen && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none shrink-0 ${isSelected ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-850 text-slate-500 dark:text-slate-400'}`}>
                                      Aberta
                                    </span>
                                  )}
                                </div>
                                <p className={`text-[10px] truncate ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>{result.path}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* GAVETA INFERIOR DE ABAS PARA MOBILE (BOTTOM SHEET) */}
        {mobileTabsOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center md:hidden">
            <div className="fixed inset-0 bg-slate-950/40" onClick={() => setMobileTabsOpen(false)} />
            <div className="relative w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-xl max-h-[70vh] overflow-hidden flex flex-col z-10">
              
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-800 dark:text-white">Abas Abertas ({tabs.length})</span>
                <button onClick={() => setMobileTabsOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {tabs.map((tab) => {
                  const isActive = tab.path === activeTabPath;
                  return (
                    <div
                      key={tab.path}
                      onClick={() => {
                        navigate(tab.path);
                        setActiveTab(tab.path);
                        setMobileTabsOpen(false);
                      }}
                      className={`
                        flex items-center justify-between gap-3 p-2.5 rounded-md border text-xs cursor-pointer
                        ${isActive 
                          ? 'border-blue-500 bg-blue-50/30 text-blue-700 dark:bg-blue-950/10 dark:text-blue-400 font-semibold' 
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-650 dark:text-slate-350'}
                      `}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <TabIcon name={tab.iconName} className={isActive ? 'text-blue-500' : 'text-slate-450'} size={14} />
                        <span className="truncate">{tab.label}</span>
                      </div>
                      
                      {!tab.pinned && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseTab(tab.path);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TOASTS FLUTUANTES DE STATUS */}
        {showOnlineToast && (
          <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white text-xs font-semibold px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2 animate-tab-fade border border-emerald-700">
            <CheckCircle2 size={14} className="animate-bounce" />
            <span>Conexão restabelecida! Você está online.</span>
          </div>
        )}

        {prunedToastName && (
          <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white dark:bg-slate-800 text-xs font-semibold px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2 animate-tab-fade border border-slate-200 dark:border-slate-700">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <span>Aba "{prunedToastName}" arquivada para liberação de memória (limite de 12 abas).</span>
          </div>
        )}

      </div>
    </div>
  );
}

export function Layout() {
  return <LayoutShell />;
}