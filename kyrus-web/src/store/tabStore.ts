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
  tenantKey: string | null;

  // Split Screen
  splitMode: boolean;
  secondaryTabPath: string | null;
  focusedTabPath: string;
  
  // Ações
  hydrateTabs: (userId: number, empresaId: number) => void;
  purgeUnauthorizedTabs: (hasPermission: (path: string) => boolean, fallbackTab?: TabItem) => void;
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

  enableSplitMode: (secondaryPath: string) => void;
  disableSplitMode: () => void;
  setFocusedTab: (path: string) => void;
}

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

const MAX_TABS = 12;

const persistTabs = (tenantKey: string | null, tabs: TabItem[], activePath: string) => {
  if (!tenantKey) return;
  try {
    localStorage.setItem(tenantKey, JSON.stringify(tabs));
    sessionStorage.setItem(`${tenantKey}_active`, activePath);
  } catch (e) {
    console.error('Erro ao salvar abas no storage:', e);
  }
};

export const useTabStore = create<TabStoreState>((set, get) => ({
  tabs: [DEFAULT_TAB],
  activeTabPath: '/home',
  favorites: [],
  online: navigator.onLine,
  refreshCounters: {},
  closedTabsHistory: [],
  lastPrunedTabName: null,
  tenantKey: null,
  
  splitMode: false,
  secondaryTabPath: null,
  focusedTabPath: '/home',

  hydrateTabs: (userId: number, empresaId: number) => {
    const tenantKey = `kyrus_tabs_u${userId}_e${empresaId}`;
    
    let nextTabs: TabItem[] = [DEFAULT_TAB];
    let nextActive = '/home';

    try {
      const stored = localStorage.getItem(tenantKey);
      if (stored) {
        const parsed = JSON.parse(stored) as TabItem[];
        if (parsed.length > 0) {
          nextTabs = parsed;
        }
      } else {
        // Zero Data Loss Migration from legacy keys
        const legacyStoredSession = sessionStorage.getItem('kyrus_session_tabs');
        const legacyStoredLocal = localStorage.getItem('kyrus_pinned_tabs');
        
        if (legacyStoredSession) {
          const parsed = JSON.parse(legacyStoredSession) as TabItem[];
          if (parsed.length > 0) nextTabs = parsed;
        } else if (legacyStoredLocal) {
          const parsed = JSON.parse(legacyStoredLocal) as TabItem[];
          if (parsed.length > 0) nextTabs = parsed;
        }
      }

      // Não força mais o Home se o usuário fechou ou não tem permissão

      const storedActive = sessionStorage.getItem(`${tenantKey}_active`);
      if (storedActive) {
        nextActive = storedActive;
      } else {
        nextActive = nextTabs[0].path;
      }
    } catch (e) {
      console.error("Erro na hidratação das abas:", e);
    }

    set({ tabs: nextTabs, activeTabPath: nextActive, tenantKey, focusedTabPath: nextActive });
    persistTabs(tenantKey, nextTabs, nextActive);
  },

  purgeUnauthorizedTabs: (hasPermission, fallbackTab?: TabItem) => {
    const { tabs, activeTabPath, tenantKey } = get();
    if (!tenantKey) return;

    const filteredTabs = tabs.filter(t => hasPermission(t.path));
    
    if (filteredTabs.length === 0) {
      const fb = fallbackTab || DEFAULT_TAB;
      set({ tabs: [fb], activeTabPath: fb.path, focusedTabPath: fb.path });
      persistTabs(tenantKey, [fb], fb.path);
      return;
    }

    let nextActive = activeTabPath;
    if (!hasPermission(activeTabPath)) {
      nextActive = filteredTabs[0].path;
    }

    set({ tabs: filteredTabs, activeTabPath: nextActive, focusedTabPath: nextActive });
    persistTabs(tenantKey, filteredTabs, nextActive);
  },

  openTab: (path, label, iconName) => {
    const basePath = path.split('?')[0];
    const { tabs, closedTabsHistory, tenantKey } = get();

    // 1. Verificar se a aba já está aberta
    const existingIndex = tabs.findIndex((t) => t.basePath === basePath);

    if (existingIndex !== -1) {
      const updatedTabs = tabs.map((t, idx) =>
        idx === existingIndex
          ? { ...t, path, visited: true, label, iconName }
          : t
      );
      
      const { splitMode, secondaryTabPath } = get();
      if (splitMode) {
        const focusedBase = get().focusedTabPath?.split('?')[0];
        const secondaryBase = secondaryTabPath?.split('?')[0];
        if (focusedBase === secondaryBase) {
          set({ tabs: updatedTabs, secondaryTabPath: path, focusedTabPath: path });
        } else {
          set({ tabs: updatedTabs, activeTabPath: path, focusedTabPath: path });
        }
      } else {
        set({ tabs: updatedTabs, activeTabPath: path, focusedTabPath: path });
      }
      
      persistTabs(tenantKey, updatedTabs, path);
      return;
    }

    // 2. Trava de limite de abas (Max Tabs Guard)
    let finalTabs = [...tabs];
    let prunedTabName: string | null = null;
    let nextHistory = [...closedTabsHistory];

    if (finalTabs.length >= MAX_TABS) {
      const indexToClose = finalTabs.findIndex(
        (t, idx) => idx > 0 && !t.pinned && !t.dirty
      );
      if (indexToClose !== -1) {
        const closed = finalTabs[indexToClose];
        prunedTabName = closed.label;
        finalTabs.splice(indexToClose, 1);
        
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
    
    const { splitMode, secondaryTabPath } = get();
    if (splitMode) {
      const focusedBase = get().focusedTabPath?.split('?')[0];
      const secondaryBase = secondaryTabPath?.split('?')[0];
      if (focusedBase === secondaryBase) {
        set({ 
          tabs: newTabList, 
          secondaryTabPath: path,
          focusedTabPath: path,
          closedTabsHistory: nextHistory,
          lastPrunedTabName: prunedTabName 
        });
      } else {
        set({ 
          tabs: newTabList, 
          activeTabPath: path,
          focusedTabPath: path,
          closedTabsHistory: nextHistory,
          lastPrunedTabName: prunedTabName 
        });
      }
    } else {
      set({ 
        tabs: newTabList, 
        activeTabPath: path,
        focusedTabPath: path,
        closedTabsHistory: nextHistory,
        lastPrunedTabName: prunedTabName 
      });
    }

    persistTabs(tenantKey, newTabList, path);
  },

  closeTab: (path, force = false) => {
    const basePath = path.split('?')[0];
    const { tabs, activeTabPath, closedTabsHistory, tenantKey } = get();

    const tabToClose = tabs.find((t) => t.basePath === basePath);
    if (!tabToClose || tabToClose.pinned) return;

    if (tabToClose.dirty && !force) {
      if (!window.confirm('Existem alterações não salvas. Deseja realmente fechar?')) {
        return;
      }
    }

    const filteredTabs = tabs.filter((t) => t.basePath !== basePath);
    
    let nextActiveTab = activeTabPath;
    const { splitMode, secondaryTabPath, focusedTabPath } = get();
    let nextSplitMode = splitMode;
    let nextSecondaryTab = secondaryTabPath;
    let nextFocused = focusedTabPath;

    // Se estamos fechando a aba principal no modo split
    if (splitMode && activeTabPath.split('?')[0] === basePath) {
      nextActiveTab = secondaryTabPath!;
      nextSecondaryTab = null;
      nextSplitMode = false;
      nextFocused = nextActiveTab;
    } 
    // Se estamos fechando a aba secundária no modo split
    else if (splitMode && secondaryTabPath && secondaryTabPath.split('?')[0] === basePath) {
      nextSecondaryTab = null;
      nextSplitMode = false;
      nextFocused = nextActiveTab;
    }
    // Se não é modo split e fechamos a aba ativa
    else if (activeTabPath.split('?')[0] === basePath) {
      const closedIndex = tabs.findIndex((t) => t.basePath === basePath);
      const newActiveTab = filteredTabs[closedIndex] || filteredTabs[closedIndex - 1] || filteredTabs[0];
      nextActiveTab = newActiveTab.path;
      nextFocused = newActiveTab.path;
    }

    const nextHistory = [
      { path: tabToClose.path, label: tabToClose.label, iconName: tabToClose.iconName },
      ...closedTabsHistory
    ].slice(0, 10);

    set({ 
      tabs: filteredTabs, 
      activeTabPath: nextActiveTab,
      secondaryTabPath: nextSecondaryTab,
      splitMode: nextSplitMode,
      focusedTabPath: nextFocused,
      closedTabsHistory: nextHistory 
    });
    persistTabs(tenantKey, filteredTabs, nextActiveTab);
  },

  setActiveTab: (path) => {
    const { tabs, tenantKey, splitMode, activeTabPath, secondaryTabPath } = get();
    const basePath = path.split('?')[0];
    
    const tabExists = tabs.find(t => t.basePath === basePath);
    if (!tabExists) return;

    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, path, visited: true } : t
    );

    if (splitMode) {
      if (basePath === secondaryTabPath?.split('?')[0]) {
        set({ tabs: updatedTabs, secondaryTabPath: path, focusedTabPath: path });
      } else {
        // Se clicar em uma aba não ativa nem secundária, troca a focada.
        const focusedBase = get().focusedTabPath?.split('?')[0];
        const secondaryBase = secondaryTabPath?.split('?')[0];
        if (focusedBase === secondaryBase) {
           set({ tabs: updatedTabs, secondaryTabPath: path, focusedTabPath: path });
        } else {
           set({ tabs: updatedTabs, activeTabPath: path, focusedTabPath: path });
        }
      }
    } else {
      set({ tabs: updatedTabs, activeTabPath: path, focusedTabPath: path });
    }

    persistTabs(tenantKey, updatedTabs, path);
  },

  enableSplitMode: (secondaryPath) => {
    const { tabs, activeTabPath } = get();
    
    // Se já estiver dividida ou tentar dividir com a mesma aba
    if (activeTabPath.split('?')[0] === secondaryPath.split('?')[0]) {
      return;
    }

    set({
      splitMode: true,
      secondaryTabPath: secondaryPath,
      focusedTabPath: secondaryPath
    });
  },

  disableSplitMode: () => {
    const { activeTabPath, focusedTabPath, secondaryTabPath } = get();
    // A aba que permanecerá é a aba que estava em foco
    const nextActive = focusedTabPath === secondaryTabPath ? secondaryTabPath : activeTabPath;

    set({
      splitMode: false,
      secondaryTabPath: null,
      activeTabPath: nextActive,
      focusedTabPath: nextActive
    });
  },

  setFocusedTab: (path) => {
    set({ focusedTabPath: path });
  },

  togglePin: (basePath) => {
    const { tabs, tenantKey, activeTabPath } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, pinned: !t.pinned } : t
    );
    
    // Reordenar abas fixadas para o começo (após o Home)
    const homeTab = updatedTabs.find(t => t.basePath === '/home');
    const pinned = updatedTabs.filter((t) => t.pinned && t.basePath !== '/home');
    const unpinned = updatedTabs.filter((t) => !t.pinned && t.basePath !== '/home');
    
    const finalTabs = homeTab ? [homeTab, ...pinned, ...unpinned] : [...pinned, ...unpinned];

    set({ tabs: finalTabs });
    persistTabs(tenantKey, finalTabs, activeTabPath);
  },

  toggleFavorite: (path) => {
    const { favorites } = get();
    const newFavorites = favorites.includes(path)
      ? favorites.filter((p) => p !== path)
      : [...favorites, path];

    set({ favorites: newFavorites });
    try {
      localStorage.setItem('kyrus_local_favorites', JSON.stringify(newFavorites));
    } catch {}
  },

  setTabDirty: (basePath, dirty) => {
    const { tabs, tenantKey, activeTabPath } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, dirty } : t
    );
    set({ tabs: updatedTabs });
    persistTabs(tenantKey, updatedTabs, activeTabPath);
  },

  triggerRefresh: (basePath) => {
    set((state) => ({
      refreshCounters: {
        ...state.refreshCounters,
        [basePath]: (state.refreshCounters[basePath] || 0) + 1,
      },
    }));
  },

  setOnline: (online) => set({ online }),

  reorderTabs: (startIndex, endIndex) => {
    const { tabs, tenantKey, activeTabPath } = get();
    const result = Array.from(tabs);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);

    set({ tabs: result });
    persistTabs(tenantKey, result, activeTabPath);
  },

  clearSession: () => {
    set({ tabs: [DEFAULT_TAB], activeTabPath: '/home', closedTabsHistory: [], tenantKey: null });
    // Na limpeza de sessão, deixamos o localStorage daquela empresa quieto, apenas limpamos o estado em memória.
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
