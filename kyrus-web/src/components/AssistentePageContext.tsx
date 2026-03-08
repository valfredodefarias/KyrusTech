import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { AiAssistenteProps } from './AiAssistente';

type AssistentePageConfig = Partial<AiAssistenteProps>;

type AssistentePageContextValue = {
  config: AssistentePageConfig;
  setConfig: (config: AssistentePageConfig) => void;
  clearConfig: () => void;
};

const AssistentePageContext = createContext<AssistentePageContextValue | null>(null);

export function AssistentePageProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AssistentePageConfig>({});

  const value = useMemo<AssistentePageContextValue>(() => ({
    config,
    setConfig: (nextConfig) => setConfigState(nextConfig),
    clearConfig: () => setConfigState({}),
  }), [config]);

  return <AssistentePageContext.Provider value={value}>{children}</AssistentePageContext.Provider>;
}

export function useAssistentePage(config: AssistentePageConfig) {
  const context = useContext(AssistentePageContext);

  useEffect(() => {
    if (!context) return undefined;
    context.setConfig(config);
    return () => context.clearConfig();
  }, [context, config]);
}

export function useAssistentePageContext() {
  const context = useContext(AssistentePageContext);
  if (!context) {
    throw new Error('useAssistentePageContext must be used within AssistentePageProvider');
  }
  return context;
}