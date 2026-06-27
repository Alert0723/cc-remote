/**
 * HTTP API 服务
 * 提供会话管理、消息发送等 REST API
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Server } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { DEFAULT_HTTP_PORT } from '@cc-remote/shared';
import { registerSessionRoutes } from './routes/sessions.js';
import type { CCWebSocketServer } from '../ws/server.js';

export interface HttpServerOptions {
  port?: number;
  authToken?: string;
}

export class HttpServer {
  private app: FastifyInstance;
  private authToken?: string;
  private _wsGetter?: () => CCWebSocketServer | undefined;

  constructor(options: HttpServerOptions = {}) {
    this.app = Fastify({ logger: false });
    this.authToken = options.authToken;

    this._setupMiddleware();
    this._setupRoutes();
  }

  /** 设置 WS 服务器 getter（在 WS 实例创建后调用，供 restart 端点使用） */
  setWsGetter(getter: () => CCWebSocketServer | undefined): void {
    this._wsGetter = getter;
  }

  /**
   * 设置中间件
   */
  private _setupMiddleware(): void {
    // CORS + 禁用缓存：移动端 Web 需要跨域支持，且每次加载最新版本
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      // 静态文件禁用缓存，确保手机端每次加载最新前端
      if (!request.url.startsWith('/api/')) {
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      }

      if (request.method === 'OPTIONS') {
        reply.status(204).send();
        return;
      }
    });

    // 认证：Bearer token 方式（仅 API 路由需要认证）
    if (this.authToken) {
      this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        // 静态文件请求跳过认证（前端页面加载后自己用 query param 中的 token 调 API）
        if (!request.url.startsWith('/api/')) {
          return;
        }

        const auth = request.headers.authorization;
        const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

        if (token !== this.authToken) {
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }
      });
    }
  }

  /**
   * 设置路由
   */
  private _setupRoutes(): void {
    // 静态文件托管：serve Web 前端
    // 兼容 tsx 开发模式（src/http/）和 tsup 编译后（dist/）两种目录结构
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      join(__dirname, '..', '..', '..', 'web', 'dist'),   // dev:  src/http/ → server/src → server → packages → web/dist
      join(__dirname, '..', '..', 'web', 'dist'),         // prod: dist/ → server → packages → web/dist
    ];
    const webDistPath = candidatePaths.find((p) => existsSync(p));
    if (webDistPath) {
      this.app.register(fastifyStatic, {
        root: webDistPath,
        prefix: '/',
        wildcard: false,
        index: 'index.html',
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) {
            // index.html 禁止缓存：构建后哈希文件名会变，缓存会导致 404
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        },
      });
    }

    // 健康检查
    this.app.get('/api/health', async () => {
      return { status: 'ok', timestamp: Date.now() };
    });

    // 获取配置
    this.app.get('/api/config', async () => {
      return {
        version: '0.1.0',
        features: ['stream', 'approval', 'interrupt'],
      };
    });

    // 注册会话管理路由（延迟获取 wsServer 供 restart 端点使用）
    registerSessionRoutes(this.app, () => this._wsGetter?.());
  }

  /**
   * 启动服务
   */
  async start(port?: number): Promise<void> {
    const p = port || DEFAULT_HTTP_PORT;
    await this.app.listen({ port: p, host: '0.0.0.0' });
  }

  /**
   * 获取 HTTP server 实例（用于 WebSocket 共享端口）
   */
  getServer(): Server | undefined {
    return this.app.server;
  }

  /**
   * 关闭服务
   */
  async close(): Promise<void> {
    await this.app.close();
  }
}
