import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

export function TabSyncGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  const [isDisconnected, setIsDisconnected] = useState(false);

  // ID único para identificar esta aba
  const tabId = useMemo(() => Math.random().toString(36).substring(2, 9), []);
  const isDisconnectedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsDisconnected(false);
      isDisconnectedRef.current = false;
      return;
    }

    const channel = new BroadcastChannel('kyrus_tab_channel');

    const handleMessage = (event: MessageEvent) => {
      const { type, senderTabId } = event.data || {};
      if (senderTabId === tabId) return;

      if (type === 'claim-active') {
        // Outra aba assumiu a atividade, então desconectamos esta
        setIsDisconnected(true);
        isDisconnectedRef.current = true;
      } else if (type === 'request-ping') {
        // Outra aba perguntou se há abas ativas
        if (!isDisconnectedRef.current) {
          channel.postMessage({ type: 'reply-pong', senderTabId: tabId });
        }
      } else if (type === 'reply-pong') {
        // Recebemos resposta de outra aba ativa, então esta aba deve ser desconectada/suspensa por padrão
        setIsDisconnected(true);
        isDisconnectedRef.current = true;
      }
    };

    channel.addEventListener('message', handleMessage);

    // Pergunta se já existe outra aba ativa
    channel.postMessage({ type: 'request-ping', senderTabId: tabId });

    // Se ninguém responder em 300ms, assumimos que somos a aba ativa
    const timeout = setTimeout(() => {
      if (!isDisconnectedRef.current) {
        // Assume atividade (avisa qualquer outra aba caso exista por algum motivo)
        channel.postMessage({ type: 'claim-active', senderTabId: tabId });
        setIsDisconnected(false);
        isDisconnectedRef.current = false;
      }
    }, 300);

    return () => {
      clearTimeout(timeout);
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [isAuthenticated, tabId]);

  const handleReconnect = () => {
    setIsDisconnected(false);
    isDisconnectedRef.current = false;
    const channel = new BroadcastChannel('kyrus_tab_channel');
    channel.postMessage({ type: 'claim-active', senderTabId: tabId });
    channel.close();
  };

  if (isAuthenticated && isDisconnected) {
    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/95 p-6 text-center select-none backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700 space-y-6 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-amber-50 dark:bg-amber-950/40 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-800 dark:text-white">O Kyrus ERP já está aberto</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Identificamos que você possui outra aba ativa no sistema. Para evitar conflitos de dados (como lançamentos salvos na empresa errada), esta aba foi suspensa.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg border border-amber-200/50 dark:border-amber-900/50">
                Se você escolher usar esta aba, a outra aba será desconectada.
              </p>
            </div>

            <button
              onClick={handleReconnect}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-lg hover:shadow-xl transition transform active:scale-95 text-sm"
            >
              Usar nesta aba aqui
            </button>
          </div>
        </div>
      );
  }

  return <>{children}</>;
}
