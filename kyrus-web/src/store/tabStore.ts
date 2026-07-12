import { create } from 'zustand';

export interface TabItem {
  path: string;       // Caminho completo (ex: /contas?id=12)
  basePath: string;   // Pathname base (ex: /contas)
  label: string;      // Rótulo amigável (ex: Contas Bancárias)
  iconName: string;   // Nome do ícone da biblioteca lucide-react
  pinned: boolean;    // Aba fixada
  dirty: boolean;     // Modificada sem salvar
  visited: boolean;   // Controla o Lazy Mount
}

export interface TabStoreState {
  tabs: TabItem[];
  activeTabPath: string;
  favorites: string[];
  online: boolean;
  refreshCounters: Record<string, number>;
  closedTabsHistory: { path: string; label: string; iconName: string }[];
  lastPrunedTabName: string | null;
  
  // Ações
  openTab: (path: string, label: string, iconName: string) => void;
  closeTab: (path: string, force?: boolean) => void;
  setActiveTab: (path: string) => void;
  togglePin: (basePath: string) => void;
  toggleFavorite: (path: string) => void;
  setTabDirty: (basePath: string, dirty: boolean) => void;
  triggerRefresh: (basePath: string) => void;
  setOnline: (online: boolean) => void;
  reorderTabs: (startIndex: number, endIndex: number) => void;
  clearSession: () => void;
  reopenLastTab: () => void;
  setLastPrunedTabName: (name: string | null) => void;
}

// Auxiliares de armazenamento
const SESSION_KEYS = {
  TABS: 'kyrus_session_tabs',
  ACTIVE_TAB: 'kyrus_session_active_tab',
};

const LOCAL_KEYS = {
  FAVORITES: 'kyrus_local_favorites',
};

// Aba padrão (Visão Geral)
export const DEFAULT_TAB: TabItem = {
  path: '/home',
  basePath: '/home',
  label: 'Visão Geral',
  iconName: 'Home',
  pinned: true,
  dirty: false,
  visited: true,
};

// Auxiliar para salvar apenas abas fixadas persistentes
const savePinnedTabs = (tabs: TabItem[]) => {
  try {
    const pinned = tabs.filter((t) => t.pinned);
    localStorage.setItem('kyrus_pinned_tabs', JSON.stringify(pinned));
  } catch {}
};

// Carregar estado inicial
const getInitialTabs = (): TabItem[] => {
  try {
    const stored = sessionStorage.getItem(SESSION_KEYS.TABS);
    if (stored) {
      const parsed = JSON.parse(stored) as TabItem[];
      if (parsed.length > 0) {
        // Garantir que a Visão Geral sempre exista e esteja no topo
        const hasHome = parsed.some((t) => t.basePath === '/home');
        if (!hasHome) {
          return [DEFAULT_TAB, ...parsed];
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error('Erro ao ler abas do sessionStorage:', e);
  }

  // Se for nova sessão (sessionStorage vazio), carregar abas fixadas persistentes do localStorage
  try {
    const storedPinned = localStorage.getItem('kyrus_pinned_tabs');
    if (storedPinned) {
      const pinned = JSON.parse(storedPinned) as TabItem[];
      if (pinned.length > 0) {
        const hasHome = pinned.some((t) => t.basePath === '/home');
        if (!hasHome) {
          return [DEFAULT_TAB, ...pinned];
        }
        return pinned;
      }
    }
  } catch {}

  return [DEFAULT_TAB];
};

const getInitialActiveTab = (): string => {
  return sessionStorage.getItem(SESSION_KEYS.ACTIVE_TAB) || '/home';
};

const getInitialFavorites = (): string[] => {
  try {
    const stored = localStorage.getItem(LOCAL_KEYS.FAVORITES);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const MAX_TABS = 12;

export const useTabStore = create<TabStoreState>((set, get) => ({
  tabs: getInitialTabs(),
  activeTabPath: getInitialActiveTab(),
  favorites: getInitialFavorites(),
  online: navigator.onLine,
  refreshCounters: {},
  closedTabsHistory: [],
  lastPrunedTabName: null,

  openTab: (path, label, iconName) => {
    const basePath = path.split('?')[0];
    const { tabs, closedTabsHistory } = get();

    // 1. Verificar se a aba já está aberta
    const existingIndex = tabs.findIndex((t) => t.basePath === basePath);

    if (existingIndex !== -1) {
      // Atualizar o path completo da aba com os novos parâmetros e marcar como visitada
      const updatedTabs = tabs.map((t, idx) =>
        idx === existingIndex
          ? { ...t, path, visited: true }
          : t
      );
      set({ tabs: updatedTabs, activeTabPath: path });
      sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(updatedTabs));
      sessionStorage.setItem(SESSION_KEYS.ACTIVE_TAB, path);
      savePinnedTabs(updatedTabs);
      return;
    }

    // 2. Trava de limite de abas (Max Tabs Guard)
    let finalTabs = [...tabs];
    let prunedTabName: string | null = null;
    let nextHistory = [...closedTabsHistory];

    if (finalTabs.length >= MAX_TABS) {
      // Encontrar a aba não-fixada, não-dirty mais antiga para fechar
      // Ignorar a primeira aba (geralmente /home)
      const indexToClose = finalTabs.findIndex(
        (t, idx) => idx > 0 && !t.pinned && !t.dirty
      );
      if (indexToClose !== -1) {
        const closed = finalTabs[indexToClose];
        prunedTabName = closed.label;
        finalTabs.splice(indexToClose, 1);
        
        // Registrar aba podada no histórico
        nextHistory = [
          { path: closed.path, label: closed.label, iconName: closed.iconName },
          ...nextHistory
        ].slice(0, 10);
      }
    }

    // 3. Adicionar nova aba
    const newTab: TabItem = {
      path,
      basePath,
      label,
      iconName,
      pinned: false,
      dirty: false,
      visited: true,
    };

    const newTabList = [...finalTabs, newTab];
    set({ 
      tabs: newTabList, 
      activeTabPath: path,
      closedTabsHistory: nextHistory,
      lastPrunedTabName: prunedTabName 
    });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(newTabList));
    sessionStorage.setItem(SESSION_KEYS.ACTIVE_TAB, path);
    savePinnedTabs(newTabList);
  },

  closeTab: (path, force = false) => {
    const basePath = path.split('?')[0];
    const { tabs, activeTabPath, closedTabsHistory } = get();

    const tabToClose = tabs.find((t) => t.basePath === basePath);
    if (!tabToClose || tabToClose.pinned) return;

    // Alerta de confirmação se for dirty (não salvo) e não for forçado
    if (tabToClose.dirty && !force) {
      const confirm = window.confirm(
        `A aba "${tabToClose.label}" tem alterações não salvas. Deseja realmente fechar?`
      );
      if (!confirm) return;
    }

    // Registrar aba fechada no histórico
    const updatedHistory = [
      { path: tabToClose.path, label: tabToClose.label, iconName: tabToClose.iconName },
      ...closedTabsHistory
    ].slice(0, 10);

    // Apagar rascunho de formulário do sessionStorage se aplicável
    try {
      sessionStorage.removeItem(`kyrus_draft_${basePath}`);
    } catch {}

    const remainingTabs = tabs.filter((t) => t.basePath !== basePath);
    let nextActivePath = activeTabPath;

    // Se a aba fechada era a aba ativa atual, precisamos focar outra aba
    if (activeTabPath.split('?')[0] === basePath) {
      const closedIndex = tabs.findIndex((t) => t.basePath === basePath);
      const newIndex = Math.max(0, closedIndex - 1);
      nextActivePath = remainingTabs[newIndex]?.path || '/home';
    }

    // Fallback de segurança se esvaziar todas as abas
    if (remainingTabs.length === 0) {
      remainingTabs.push(DEFAULT_TAB);
      nextActivePath = '/home';
    }

    set({ 
      tabs: remainingTabs, 
      activeTabPath: nextActivePath,
      closedTabsHistory: updatedHistory 
    });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(remainingTabs));
    sessionStorage.setItem(SESSION_KEYS.ACTIVE_TAB, nextActivePath);
    savePinnedTabs(remainingTabs);
  },

  setActiveTab: (path) => {
    const { tabs } = get();
    // Marcar aba como visitada no lazy loading
    const updatedTabs = tabs.map((t) =>
      t.path === path || t.basePath === path.split('?')[0]
        ? { ...t, visited: true }
        : t
    );

    set({ tabs: updatedTabs, activeTabPath: path });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(updatedTabs));
    sessionStorage.setItem(SESSION_KEYS.ACTIVE_TAB, path);
  },

  togglePin: (basePath) => {
    const { tabs } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, pinned: !t.pinned } : t
    );

    // Reordenar abas: Pinned primeiro
    const pinned = updatedTabs.filter((t) => t.pinned);
    const unpinned = updatedTabs.filter((t) => !t.pinned);
    const reordered = [...pinned, ...unpinned];

    set({ tabs: reordered });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(reordered));
    savePinnedTabs(reordered);
  },

  toggleFavorite: (path) => {
    const { favorites } = get();
    const basePath = path.split('?')[0];
    let nextFavorites: string[];

    if (favorites.includes(basePath)) {
      nextFavorites = favorites.filter((f) => f !== basePath);
    } else {
      nextFavorites = [...favorites, basePath];
    }

    set({ favorites: nextFavorites });
    localStorage.setItem(LOCAL_KEYS.FAVORITES, JSON.stringify(nextFavorites));
  },

  setTabDirty: (basePath, dirty) => {
    const { tabs } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, dirty } : t
    );
    set({ tabs: updatedTabs });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(updatedTabs));
  },

  triggerRefresh: (basePath) => {
    set((state) => ({
      refreshCounters: {
        ...state.refreshCounters,
        [basePath]: (state.refreshCounters[basePath] || 0) + 1,
      },
    }));
  },

  setOnline: (online) => {
    set({ online });
  },

  reorderTabs: (startIndex, endIndex) => {
    const { tabs } = get();
    const result = Array.from(tabs);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);

    set({ tabs: result });
    sessionStorage.setItem(SESSION_KEYS.TABS, JSON.stringify(result));
    savePinnedTabs(result);
  },

  clearSession: () => {
    set({ tabs: [DEFAULT_TAB], activeTabPath: '/home', closedTabsHistory: [] });
    sessionStorage.removeItem(SESSION_KEYS.TABS);
    sessionStorage.removeItem(SESSION_KEYS.ACTIVE_TAB);
  },

  reopenLastTab: () => {
    const { closedTabsHistory } = get();
    if (closedTabsHistory.length === 0) return;

    const [lastTab, ...remainingHistory] = closedTabsHistory;
    
    // Abrir a aba
    const { openTab } = get();
    openTab(lastTab.path, lastTab.label, lastTab.iconName);
    
    // Atualizar o histórico
    set({ closedTabsHistory: remainingHistory });
  },

  setLastPrunedTabName: (name) => {
    set({ lastPrunedTabName: name });
  },
}));

