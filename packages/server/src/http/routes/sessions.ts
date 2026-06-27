/**
 * 会话管理路由
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sessionManager, SessionManager } from '../../session/manager.js';
import type { CCWebSocketServer } from '../../ws/server.js';
import { createServerEvent } from '@cc-remote/shared';

export function registerSessionRoutes(
  app: FastifyInstance,
  getWsServer?: () => CCWebSocketServer | undefined
): void {
  // 获取所有已连接的会话
  app.get('/api/sessions', async () => {
    return { sessions: sessionManager.getSessions() };
  });

  // 获取磁盘上可用的会话列表（含 attach 状态）
  app.get('/api/sessions/available', async () => {
    const entries = SessionManager.scanDiskSessions();
    const attachedIds = new Set(sessionManager.getSessions().map((s) => s.id));

    return {
      sessions: entries.map((e) => ({
        sessionId: e.sessionId,
        projectPath: e.cwd,
        attached: attachedIds.has(e.sessionId),
      })),
    };
  });

  // 创建新会话
  app.post('/api/sessions', async (request) => {
    const body = request.body as { projectPath?: string; model?: string; resume?: boolean } | null;
    const session = await sessionManager.createSession(body || {});
    return session;
  });

  // 附加到已有会话
  app.post('/api/sessions/attach', async (request, reply) => {
    const body = request.body as { sessionId?: string; projectPath?: string; mode?: 'attach' | 'spawn' } | null;

    if (!body?.sessionId) {
      reply.status(400).send({ error: 'Missing sessionId' });
      return;
    }

    try {
      let session;
      if (body.mode === 'spawn') {
        session = await sessionManager.spawnConnectSession({
          sessionId: body.sessionId,
          projectPath: body.projectPath || process.cwd(),
        });
        console.log(`[Spawn Connect] 会话已接管: ${session.id}`);
      } else {
        session = await sessionManager.attachSession({
          sessionId: body.sessionId,
          projectPath: body.projectPath || process.cwd(),
        });
        console.log(`[Attach Mode] 会话已绑定: ${session.id}`);
      }
      return session;
    } catch (err: any) {
      reply.status(404).send({ error: err.message });
    }
  });

  // 获取单个会话
  app.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessionManager.getSession(id);

    if (!session) {
      reply.status(404).send({ error: 'Session not found' });
      return;
    }

    return session;
  });

  // 关闭并删除会话（从内存移除 + 删除磁盘文件）
  app.delete('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    // 路径遍历防护
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      reply.status(400).send({ error: 'Invalid session ID' });
      return;
    }
    await sessionManager.deleteSession(id);
    return { success: true };
  });

  // 接管会话：detach → 删锁 → spawn 全控制进程
  app.post('/api/sessions/:id/takeover', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const info = await sessionManager.takeoverSession(id);
      return info;
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // 断开 attach 模式会话（停止 watcher → 状态变为 stopped）
  app.post('/api/sessions/:id/detach', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await sessionManager.detachSession(id);
      return { success: true };
    } catch (err: any) {
      reply.status(400).send({ error: err.message });
    }
  });

  // 从磁盘删除未连接的会话（无需先 attach）
  app.delete('/api/sessions/disk/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    // 路径遍历防护
    if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      reply.status(400).send({ error: 'Invalid session ID' });
      return;
    }
    const body = request.body as { projectPath?: string } | null;
    try {
      await SessionManager.deleteDiskSession(sessionId, body?.projectPath);
      return { success: true };
    } catch (err: any) {
      reply.status(500).send({ error: err.message });
    }
  });

  // 发送消息
  app.post('/api/sessions/:id/message', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { text: string } | null;

    if (!body?.text) {
      reply.status(400).send({ error: 'Missing text' });
      return;
    }

    await sessionManager.handleCommand({
      type: 'command',
      action: 'send_message',
      sessionId: id,
      data: { text: body.text },
    });

    return { success: true };
  });

  // 中断生成
  app.post('/api/sessions/:id/interrupt', async (request) => {
    const { id } = request.params as { id: string };

    await sessionManager.handleCommand({
      type: 'command',
      action: 'interrupt',
      sessionId: id,
    });

    return { success: true };
  });

  // 审批权限请求
  app.post('/api/sessions/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      requestId?: string;
      decision?: string;
    } | null;

    if (!body?.requestId || !body?.decision) {
      reply.status(400).send({ error: 'Missing requestId or decision' });
      return;
    }

    const validDecisions = ['allow', 'deny', 'allow_always'] as const;
    if (!validDecisions.includes(body.decision as typeof validDecisions[number])) {
      reply.status(400).send({ error: `Invalid decision: ${body.decision}` });
      return;
    }

    await sessionManager.handleCommand({
      type: 'command',
      action: 'approve',
      sessionId: id,
      data: {
        requestId: body.requestId,
        decision: body.decision as 'allow' | 'deny' | 'allow_always',
      },
    });

    return { success: true };
  });

  // 获取可用 Skill 列表（供前端自动补全）
  app.get('/api/skills', async () => {
    const { readdirSync, existsSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const skills: { name: string; description: string; source: string }[] = [];
    const seen = new Set<string>();

    const scanDir = (dir: string, source: string) => {
      if (!existsSync(dir)) return;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const md = join(dir, entry.name, 'SKILL.md');
            if (existsSync(md) && !seen.has(entry.name)) {
              seen.add(entry.name);
              let desc = '';
              try {
                const content = readFileSync(md, 'utf-8');
                const m = content.match(/description:\s*(.+)/);
                if (m) desc = m[1].trim();
              } catch {}
              skills.push({ name: entry.name, description: desc, source });
            }
          }
        }
      } catch {}
    };

    // 全局 skills
    scanDir(join(homedir(), '.claude', 'skills'), 'global');
    // 本项目 skills
    scanDir(join(homedir(), '.claude', 'tools', 'cc-remote', '.claude', 'skills'), 'project');

    return { skills };
  });

  // 关闭整个 CC Remote 服务
  app.post('/api/shutdown', async (request, reply) => {
    reply.send({ status: 'shutting_down' });
    // 延迟触发 SIGTERM，确保响应先发送到客户端
    // SIGTERM 会触发 index.ts 中注册的 gracefulShutdown
    setTimeout(() => {
      process.kill(process.pid, 'SIGTERM');
    }, 100);
  });

  // 热重启：保存状态 → 广播通知 → 优雅关闭
  app.post('/api/restart', async (request, reply) => {
    // 1. 保存当前状态
    const savedCount = await sessionManager.saveState();

    // 2. 广播 restart_notice 通知所有客户端（延迟获取 wsServer，因其在 HTTP 之后初始化）
    const wsServer = getWsServer?.();
    if (wsServer) {
      wsServer.broadcast(createServerEvent('restart_notice', {
        message: '服务器即将重启，客户端将自动重连',
        savedSessions: savedCount,
      }));
    }

    // 3. 先发送 HTTP 响应
    reply.send({ status: 'restarting', savedSessions: savedCount });

    // 4. 延迟触发 SIGTERM，确保 restart_notice 事件先推送到客户端
    setTimeout(() => {
      process.kill(process.pid, 'SIGTERM');
    }, 200);
  });
}
