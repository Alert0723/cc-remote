/**
 * WebSocket 服务
 * 管理客户端连接、广播事件、处理断线恢复
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import type { ServerEvent, ClientCommand } from '@cc-remote/shared';
import { isValidClientCommand, DEFAULT_WS_PORT } from '@cc-remote/shared';
import { RingBuffer } from './buffer.js';

export interface WebSocketServerOptions {
  server?: Server;
  port?: number;
  authToken?: string;
  onCommand?: (command: ClientCommand, ws: WebSocket) => void;
  onConnection?: (ws: WebSocket) => void;
}

export class CCWebSocketServer {
  private wss: WebSocketServer;
  private buffer: RingBuffer;
  private clients: Set<WebSocket> = new Set();
  private pendingClients: Set<WebSocket> = new Set();
  private clientAlive: WeakMap<WebSocket, boolean> = new WeakMap();
  private clientAuth: WeakMap<WebSocket, boolean> = new WeakMap();
  private authToken?: string;
  private onCommand?: (command: ClientCommand, ws: WebSocket) => void;
  private onConnection?: (ws: WebSocket) => void;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: WebSocketServerOptions = {}) {
    const port = options.port || DEFAULT_WS_PORT;

    if (options.server) {
      // 与 HTTP 服务共享端口，通过 path 限定 WebSocket 路径
      this.wss = new WebSocketServer({ server: options.server, path: '/ws' });
    } else {
      // 独立端口模式
      this.wss = new WebSocketServer({ port });
    }

    this.buffer = new RingBuffer();
    this.authToken = options.authToken;
    this.onCommand = options.onCommand;
    this.onConnection = options.onConnection;

    this._setupConnectionHandler();

    // 心跳检测：30s 清理僵尸连接
    this.pingInterval = setInterval(() => {
      for (const client of this.clients) {
        if (this.clientAlive.get(client) === false) {
          try { client.terminate(); } catch { /* socket 已关闭 */ }
          this.clients.delete(client);
          this.clientAlive.delete(client);
          continue;
        }
        this.clientAlive.set(client, false);
        client.ping();
      }
    }, 30_000);
  }

  /**
   * 设置连接处理器
   */
  private _setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      // 向后兼容：URL 参数 Token 有效 → 直接认证
      if (token && this.authToken && token === this.authToken) {
        this._authenticate(ws);
      } else if (token && this.authToken && token !== this.authToken) {
        // URL Token 不匹配 → 直接拒绝
        ws.close(4001, 'Unauthorized');
        return;
      } else {
        // 无 Token（新客户端）→ 进入 pending 状态，等待首条 auth 消息
        this.pendingClients.add(ws);
      }

      // 心跳存活标记
      this.clientAlive.set(ws, true);
      ws.on('pong', () => { this.clientAlive.set(ws, true); });

      ws.on('message', (data: Buffer) => {
        this._handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.pendingClients.delete(ws);
      });

      ws.on('error', (err: Error) => {
        console.error('WebSocket error:', err);
        this.clients.delete(ws);
        this.pendingClients.delete(ws);
      });
    });
  }

  /**
   * 认证并升级连接：pending → active
   */
  private _authenticate(ws: WebSocket): void {
    this.pendingClients.delete(ws);
    this.clients.add(ws);
    this.clientAuth.set(ws, true);

    ws.send(JSON.stringify({
      type: 'connected',
      data: { status: 'ok', serverVersion: '0.1.0' },
      seq: this.buffer.getLatestSeq(),
      ts: Date.now(),
    }));

    this.onConnection?.(ws);
  }

  /**
   * 处理客户端消息
   */
  private _handleMessage(ws: WebSocket, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn('[WS] 收到非法 JSON:', data.slice(0, 100));
      ws.send(
        JSON.stringify({
          type: 'error',
          data: { code: 'INVALID_JSON', message: 'Invalid JSON' },
          seq: this.buffer.getLatestSeq(),
          ts: Date.now(),
        })
      );
      return;
    }

    // 未认证客户端：仅接受 auth 指令
    if (this.pendingClients.has(ws)) {
      const rawCmd = parsed as Record<string, unknown>;
      if (rawCmd.type === 'command' && rawCmd.action === 'auth' && (rawCmd.data as Record<string, unknown>)?.token === this.authToken) {
        this._authenticate(ws);
      } else {
        ws.close(4001, 'Unauthorized');
      }
      return;
    }

    if (!isValidClientCommand(parsed)) {
      ws.send(
        JSON.stringify({
          type: 'error',
          data: { code: 'INVALID_COMMAND', message: 'Invalid command' },
          seq: this.buffer.getLatestSeq(),
          ts: Date.now(),
        })
      );
      return;
    }

    // 处理断线恢复
    if (parsed.action === 'sync_from') {
      const lastSeq = parsed.data.lastSeq;
      this._handleSyncFrom(ws, lastSeq);
      return;
    }

    // 转发其他指令
    if (this.onCommand) {
      this.onCommand(parsed, ws);
    }
  }

  /**
   * 处理断线恢复请求
   */
  private _handleSyncFrom(ws: WebSocket, lastSeq: number): void {
    const truncated = !this.buffer.isInBuffer(lastSeq);
    const events = this.buffer.getSince(lastSeq);

    ws.send(
      JSON.stringify({
        type: 'sync_response',
        data: {
          events,
          currentSeq: this.buffer.getLatestSeq(),
          truncated,
        },
        seq: this.buffer.getLatestSeq(),
        ts: Date.now(),
      })
    );
  }

  /**
   * 发送事件到指定客户端
   */
  sendToClient(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * 广播事件到所有客户端
   */
  broadcast(event: ServerEvent): void {
    this.buffer.push(event);

    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {
          // 单个客户端发送失败不影响其他客户端
          console.warn('[WS] 广播发送到客户端失败');
        }
      }
    }
  }

  /**
   * 关闭服务
   */
  close(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  /**
   * 当前连接数（调试用）
   */
  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取 RingBuffer 实例（供状态持久化模块使用）
   */
  getBuffer(): RingBuffer {
    return this.buffer;
  }
}
