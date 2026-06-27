/**
 * 启动编排模块
 * 负责服务端初始化顺序：HTTP → WebSocket → SessionManager 注入
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { HttpServer } from './http/app.js';
import { CCWebSocketServer } from './ws/server.js';
import { sessionManager } from './session/manager.js';

// 配置目录
const CONFIG_DIR = join(homedir(), '.cc-remote');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

/** 服务上下文 */
export interface ServerContext {
  http: HttpServer;
  ws: CCWebSocketServer;
  authToken: string;
  port: number;
}

/**
 * 加载或生成认证 Token
 */
export function getAuthToken(): string {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.token) return config.token;
    } catch {
      // 配置文件损坏，重新生成
    }
  }

  const token = randomUUID();
  writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2));
  return token;
}

/**
 * 启动服务端核心组件
 * HTTP → WebSocket → SessionManager 注入，显式依赖流
 */
export async function bootstrap(port: number): Promise<ServerContext> {
  const token = getAuthToken();

  // 1. 创建并启动 HTTP 服务
  const http = new HttpServer({ port, authToken: token });
  await http.start();

  // 2. 创建 WebSocket 服务（附着在 HTTP 服务器上）
  const ws = new CCWebSocketServer({
    server: http.getServer(),
    authToken: token,
    onCommand: (cmd, wsConn) => {
      sessionManager.handleCommand(cmd, wsConn).catch((err) => {
        console.error('指令处理失败:', err);
      });
    },
    onConnection: (wsConn) => {
      sessionManager.sendStateToNewClient(wsConn);
    },
  });

  // 3. 注入依赖：ws → HttpServer（restart 端点用） + SessionManager（广播用）
  http.setWsGetter(() => ws);
  sessionManager.setWebSocketServer(ws);

  return { http, ws, authToken: token, port };
}
