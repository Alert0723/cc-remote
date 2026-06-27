/**
 * WebSocket 连接 Hook
 */

import { useEffect } from 'react';
import { useConnectionStore } from '../stores/connectionStore.js';

export function useWebSocket(serverUrl: string, token: string) {
  const { status, connect, disconnect } = useConnectionStore();

  useEffect(() => {
    if (serverUrl && token) {
      connect(serverUrl, token);
    }

    return () => {
      disconnect();
    };
  }, [serverUrl, token]);

  return { status };
}
