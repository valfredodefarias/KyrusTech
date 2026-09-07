import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface TabItem {
  path: string;
  basePath: string;
  label: string;
  iconName: string;
  pinned: boolean;
  dirty: boolean;
  visited: boolean;
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

  splitMode: boolean;
  secondaryTabPath: string | null;
  focusedTabPath: string;
  
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
  disableSplitMode: (paneToClose?: 'left' | 'right') => void;
  setFocusedTab: (path: string) => void;
}

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

export const useTabStore = create<TabStoreState>()(subscribeWithSelector((set, get) => ({
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
  },

  purgeUnauthorizedTabs: (hasPermission, fallbackTab?: TabItem) => {
    const { tabs, activeTabPath } = get();

    const filteredTabs = tabs.filter(t => hasPermission(t.path));
    
    if (filteredTabs.length === 0) {
      const fb = fallbackTab || DEFAULT_TAB;
      set({ tabs: [fb], activeTabPath: fb.path, focusedTabPath: fb.path });
      return;
    }

    let nextActive = activeTabPath;
    if (!hasPermission(activeTabPath)) {
      nextActive = filteredTabs[0].path;
    }

    set({ tabs: filteredTabs, activeTabPath: nextActive, focusedTabPath: nextActive });
  },

  openTab: (path, label, iconName) => {
    const basePath = path.split('?')[0];
    const { tabs, closedTabsHistory, splitMode, secondaryTabPath, focusedTabPath } = get();

    const existingIndex = tabs.findIndex((t) => t.basePath === basePath);

    if (existingIndex !== -1) {
      const updatedTabs = tabs.map((t, idx) =>
        idx === existingIndex ? { ...t, path, visited: true, label, iconName } : t
      );
      
      const isSecondaryFocused = splitMode && focusedTabPath === secondaryTabPath;
      set({ 
        tabs: updatedTabs, 
        ...(isSecondaryFocused ? { secondaryTabPath: path } : { activeTabPath: path }),
        focusedTabPath: path 
      });
      return;
    }

    let finalTabs = [...tabs];
    let prunedTabName: string | null = null;
    let nextHistory = [...closedTabsHistory];

    if (finalTabs.length >= MAX_TABS) {
      const indexToClose = finalTabs.findIndex((t, idx) => idx > 0 && !t.pinned && !t.dirty);

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

    const newTab: TabItem = { path, basePath, label, iconName, pinned: false, dirty: false, visited: true };
    const newTabList = [...finalTabs, newTab];
    
    const isSecondaryFocused = splitMode && focusedTabPath === secondaryTabPath;
    
    set({ 
      tabs: newTabList, 
      ...(isSecondaryFocused ? { secondaryTabPath: path } : { activeTabPath: path }),
      focusedTabPath: path,
      closedTabsHistory: nextHistory,
      ...(prunedTabName ? { lastPrunedTabName: prunedTabName } : {})
    });
  },

  closeTab: (path, force = false) => {
    const basePath = path.split('?')[0];
    const { tabs, activeTabPath, closedTabsHistory, splitMode, secondaryTabPath, focusedTabPath } = get();

    const tabToClose = tabs.find((t) => t.basePath === basePath);
    if (!tabToClose || tabToClose.pinned) return;

    if (tabToClose.dirty && !force) {
      if (!window.confirm('Existem alterações não salvas. Deseja realmente fechar?')) {
        return;
      }
    }

    const filteredTabs = tabs.filter((t) => t.basePath !== basePath);
    
    let nextActiveTab = activeTabPath;
    let nextSplitMode = splitMode;
    let nextSecondaryTab = secondaryTabPath;
    let nextFocused = focusedTabPath;

    if (splitMode && activeTabPath.split('?')[0] === basePath) {
      nextActiveTab = secondaryTabPath!;
      nextSecondaryTab = null;
      nextSplitMode = false;
      nextFocused = nextActiveTab;
    } 
    else if (splitMode && secondaryTabPath && secondaryTabPath.split('?')[0] === basePath) {
      nextSecondaryTab = null;
      nextSplitMode = false;
      nextFocused = nextActiveTab;
    }
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
  },

  setActiveTab: (path) => {
    const { tabs, splitMode, secondaryTabPath, focusedTabPath } = get();
    const basePath = path.split('?')[0];
    
    const tabExists = tabs.find(t => t.basePath === basePath);
    if (!tabExists) return;

    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, path, visited: true } : t
    );

    const isSecondaryFocused = splitMode && focusedTabPath === secondaryTabPath;

    set({ 
      tabs: updatedTabs, 
      ...(isSecondaryFocused && basePath === secondaryTabPath?.split('?')[0] 
          ? { secondaryTabPath: path } 
          : { activeTabPath: path }),
      focusedTabPath: path 
    });
  },

  enableSplitMode: (secondaryPath) => {
    const { activeTabPath } = get();
    
    if (activeTabPath.split('?')[0] === secondaryPath.split('?')[0]) {
      return;
    }

    set({
      splitMode: true,
      secondaryTabPath: secondaryPath,
      focusedTabPath: secondaryPath
    });
  },

  disableSplitMode: (paneToClose: 'left' | 'right' = 'right') => {
    const { activeTabPath, secondaryTabPath } = get();
    // Se fechar o painel esquerdo ('left'), o secundário (direito) é promovido a ativo
    // Se fechar o painel direito ('right'), o primário (esquerdo) é mantido como ativo
    const nextActive = paneToClose === 'left' && secondaryTabPath ? secondaryTabPath : activeTabPath;

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
    const { tabs } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, pinned: !t.pinned } : t
    );
    
    const homeTab = updatedTabs.find(t => t.basePath === '/home');
    const pinned = updatedTabs.filter((t) => t.pinned && t.basePath !== '/home');
    const unpinned = updatedTabs.filter((t) => !t.pinned && t.basePath !== '/home');
    
    const finalTabs = homeTab ? [homeTab, ...pinned, ...unpinned] : [...pinned, ...unpinned];
    set({ tabs: finalTabs });
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
    const { tabs } = get();
    const updatedTabs = tabs.map((t) =>
      t.basePath === basePath ? { ...t, dirty } : t
    );
    set({ tabs: updatedTabs });
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
    const { tabs } = get();
    const result = Array.from(tabs);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    set({ tabs: result });
  },

  clearSession: () => {
    set({ tabs: [DEFAULT_TAB], activeTabPath: '/home', closedTabsHistory: [], tenantKey: null });
  },

  reopenLastTab: () => {
    const { closedTabsHistory, openTab } = get();
    if (closedTabsHistory.length === 0) return;

    const [lastTab, ...remainingHistory] = closedTabsHistory;
    openTab(lastTab.path, lastTab.label, lastTab.iconName);
    set({ closedTabsHistory: remainingHistory });
  },

  setLastPrunedTabName: (name) => {
    set({ lastPrunedTabName: name });
  },
})));

let persistTimeout: any = null;
useTabStore.subscribe(
  (state) => ({ tabs: state.tabs, activeTabPath: state.activeTabPath, tenantKey: state.tenantKey }),
  (current, previous) => {
    if (!current.tenantKey) return;
    
    if (current.tabs === previous.tabs && current.activeTabPath === previous.activeTabPath) return;

    if (persistTimeout) clearTimeout(persistTimeout);
    
    persistTimeout = setTimeout(() => {
      try {
        localStorage.setItem(current.tenantKey!, JSON.stringify(current.tabs));
        sessionStorage.setItem(`${current.tenantKey}_active`, current.activeTabPath);
      } catch (e) {
        console.error('Erro ao salvar abas no storage:', e);
      }
    }, 300);
  },
  { equalityFn: (a, b) => a.tabs === b.tabs && a.activeTabPath === b.activeTabPath && a.tenantKey === b.tenantKey }
);
