import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

interface WebSocketMessage {
  type: string;
  payload: any;
}

export function useKyrusWebSocket(empresaId?: number) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!empresaId) return;

    // Use ws:// for http and wss:// for https
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use getPublicBaseUrl() to correctly parse the api URL, but fallback to relative path if possible
    // This ensures that we connect through Nginx/Vite proxy which handles the WS upgrade properly
    let wsHost = window.location.host;
    let wsPath = `/api/v1/ws/empresa/${empresaId}`;
    
    if (api.defaults.baseURL && api.defaults.baseURL.startsWith('http')) {
      const parsed = new URL(api.defaults.baseURL);
      wsHost = parsed.host;
    }
    
    const wsUrl = `${protocol}//${wsHost}${wsPath}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setIsConnected(true);
        console.log(`[WebSocket] Connected for empresa ${empresaId}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Dispatch a custom event so other components can listen to it
          window.dispatchEvent(new CustomEvent('kyrus-ws-event', { detail: data }));
        } catch (e) {
          console.error('[WebSocket] Error parsing message:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log(`[WebSocket] Disconnected`);
        // Retry connection after 5 seconds
        setTimeout(connect, 5000);
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        ws.close();
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      if (wsRef.current) {
        // Prevent reconnect on unmount
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [empresaId]);

  return { isConnected };
}

// Helper hook to listen to specific events
export function useKyrusWsListener(eventType: string, callback: (payload: any) => void) {
  useEffect(() => {
    const handleEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.type === eventType) {
        callback(customEvent.detail.payload);
      }
    };

    window.addEventListener('kyrus-ws-event', handleEvent);
    return () => {
      window.removeEventListener('kyrus-ws-event', handleEvent);
    };
  }, [eventType, callback]);
}
