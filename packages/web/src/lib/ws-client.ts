/**
 * WebSocket 客户端封装
 * 支持自动重连、断线恢复
 */

import ReconnectingWebSocket from 'reconnecting-websocket';
import type { ServerEvent, ClientCommand } from '@cc-remote/shared';
import { isValidServerEvent, RECONNECT_CONFIG } from '@cc-remote/shared';

export interface WSClientOptions {
  url: string;
  token: string;
  onEvent?: (event: ServerEvent) => void;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

export class WSClient {
  private ws: ReconnectingWebSocket | null = null;
  private url: string;
  private token: string;
  private lastSeq: number = 0;
  private onEvent?: (event: ServerEvent) => void;
  private onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;

  constructor(options: WSClientOptions) {
    this.url = options.url;
    this.token = options.token;
    this.onEvent = options.onEvent;
    this.onStatusChange = options.onStatusChange;
  }

  /**
   * 连接 WebSocket
   */
  connect(): void {
    // Token 不再通过 URL 传递（改为首条消息认证，避免浏览器历史/日志泄露）
    const wsUrl = this.url;

    this.ws = new ReconnectingWebSocket(wsUrl, [], {
      maxRetries: RECONNECT_CONFIG.maxRetries,
      connectionTimeout: 5000,
    });

    this.ws.onopen = () => {
      // 首条消息：发送认证 Token
      this.ws!.send(JSON.stringify({
        type: 'command',
        action: 'auth',
        data: { token: this.token },
      }));

      this.onStatusChange?.('connecting');

      // 重连后请求断线恢复
      if (this.lastSeq > 0) {
        this.sendCommand({
          type: 'command',
          action: 'sync_from',
          data: { lastSeq: this.lastSeq },
        });
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this._handleMessage(event.data);
    };

    this.ws.onclose = () => {
      this.onStatusChange?.('disconnected');
    };

    this.ws.onerror = () => {
      this.onStatusChange?.('disconnected');
    };

    this.onStatusChange?.('connecting');
  }

  /**
   * 处理服务端消息
   */
  private _handleMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.error('WebSocket 消息解析失败:', data);
      return;
    }

    if (!isValidServerEvent(parsed)) {
      console.error('无效的服务端事件:', parsed);
      return;
    }

    // 收到 connected 事件：认证成功，更新连接状态
    if (parsed.type === 'connected') {
      this.onStatusChange?.('connected');
      // 继续向下转发给 sessionStore（保持兼容）
    }

    // 更新 lastSeq
    if (parsed.seq > this.lastSeq) {
      this.lastSeq = parsed.seq;
    }

    // 处理断线恢复响应
    if (parsed.type === 'sync_response') {
      const events = parsed.data.events;
      if (Array.isArray(events)) {
        for (const evt of events) {
          this.onEvent?.(evt);
          if (evt.seq > this.lastSeq) {
            this.lastSeq = evt.seq;
          }
        }
      }
      return;
    }

    this.onEvent?.(parsed);
  }

  /**
   * 发送客户端指令
   */
  sendCommand(command: ClientCommand): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket 未连接');
      return;
    }

    this.ws.send(JSON.stringify(command));
  }

  /**
   * 发送用户消息
   */
  sendMessage(sessionId: string, text: string): void {
    this.sendCommand({
      type: 'command',
      action: 'send_message',
      sessionId,
      data: { text },
    });
  }

  /**
   * 创建新会话
   */
  createSession(options?: { projectPath?: string; model?: string; resume?: boolean }): void {
    this.sendCommand({
      type: 'command',
      action: 'create_session',
      data: options || {},
    });
  }

  /**
   * 中断生成
   */
  interrupt(sessionId: string): void {
    this.sendCommand({
      type: 'command',
      action: 'interrupt',
      sessionId,
    });
  }

  /**
   * 切换到其他会话
   */
  switchSession(targetSessionId: string): void {
    this.sendCommand({
      type: 'command',
      action: 'switch_session',
      sessionId: targetSessionId,
      data: { targetSessionId },
    });
  }

  /**
   * 审批权限请求
   */
  approve(sessionId: string, requestId: string, decision: 'allow' | 'deny' | 'allow_always'): void {
    this.sendCommand({
      type: 'command',
      action: 'approve',
      sessionId,
      data: { requestId, decision },
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
