/**
 * 连接状态管理（Zustand）
 */

import { create } from 'zustand';
import { WSClient } from '../lib/ws-client.js';
import { ApiClient } from '../lib/api-client.js';
import { eventBridge } from '../lib/event-bridge.js';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface ConnectionState {
  status: ConnectionStatus;
  wsClient: WSClient | null;
  apiClient: ApiClient | null;
  serverUrl: string;
  token: string;

  // Actions
  connect: (serverUrl: string, token: string) => void;
  disconnect: () => void;
  setStatus: (status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  wsClient: null,
  apiClient: null,
  serverUrl: '',
  token: '',

  connect: (serverUrl, token) => {
    const { wsClient: oldWs } = get();
    if (oldWs) {
      oldWs.disconnect();
    }

    // 将 HTTP URL 转换为 WebSocket URL
    const wsUrl = serverUrl.replace('http', 'ws') + '/ws';

    const apiClient = new ApiClient({ baseUrl: serverUrl, token });

    const wsClient = new WSClient({
      url: wsUrl,
      token,
      onStatusChange: (status) => {
        set({ status });
      },
      onEvent: (event) => {
        eventBridge.emit(event);
      },
    });

    wsClient.connect();

    set({
      wsClient,
      apiClient,
      serverUrl,
      token,
      status: 'connecting',
    });
  },

  disconnect: () => {
    const { wsClient } = get();
    if (wsClient) {
      wsClient.disconnect();
    }
    set({
      status: 'disconnected',
      wsClient: null,
      apiClient: null,
    });
  },

  setStatus: (status) => set({ status }),
}));
